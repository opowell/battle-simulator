// ---------------------------------------------------------------------------
// Obscuro search driver — the Move() orchestrator (Zhang & Sandholm 2026, §3,
// Fig. 8). It ties together the three generic pieces:
//   • infoset.js  — the extensive-form tree + PCFR+ value propagation (solve)
//   • gtcfr.js    — one-sided GT-CFR tree growth (expand)
//   • purify      — last-iterate move selection
//
// The paper runs a solver thread and expander threads in parallel until a time
// budget; JavaScript is single-threaded, so we INTERLEAVE them in one loop —
// behaviourally the same. Everything here is game-agnostic: all game knowledge
// arrives through the `hooks` built by makeHooks from a GameDefinition, whose
// only genuinely game-specific input is the leaf evaluator (`evaluateLeaves`;
// chess supplies Stockfish, every other game falls back to `evaluateState`).
// ---------------------------------------------------------------------------

import { runCFR, observationKey, Infoset } from './infoset.js';
import { makeLeaf, expandRoot, doExpansionStep, warmStartInfoset } from './gtcfr.js';
import { purify } from './purify.js';

const DEFAULT_WIN = 1e6;

function defaultActionKey(a) {
  return JSON.stringify([a.type ?? null, a.unitId ?? null, a.from ?? null, a.to ?? null, a.targetId ?? null, a.side ?? null, a.payload ?? null]);
}

// Build the game-agnostic hook bundle the search runs against. `me` is the max
// player; `opts.leafEval(state, mover, actions, childStates) => number[]` (value
// to the mover of each child) overrides the default per-child `evaluateState`.
export function makeHooks(game, me, opts = {}) {
  const rng = opts.rng ?? Math.random;
  const WIN = opts.win ?? DEFAULT_WIN;
  const key = game.actionKey ? (a => game.actionKey(a)) : defaultActionKey;
  const heuristicFor = (state, player) => (game.evaluateState ? game.evaluateState(state, player) : 0);
  const terminalValue = (state) => {
    const r = game.getResult ? game.getResult(state) : null;
    if (!r) return null;
    return r.outcome === 'draw' ? 0 : (r.winnerId === me ? WIN : -WIN);
  };
  const defaultEval = (state, mover, actions, childStates) =>
    childStates.map(cs => heuristicFor(cs, mover));
  const evalChildren = opts.leafEval
    ?? (game.evaluateLeaves
      ? ((state, mover, actions, childStates) => game.evaluateLeaves(state, mover, actions, { childStates, rng }))
      : defaultEval);
  return {
    me,
    legal: (s, p) => game.getLegalActions(s, p),
    apply: (s, p, a) => { try { return game.applyActions(s, [{ playerId: p, action: a }], rng); } catch { return null; } },
    key,
    obsKey: (s, p) => observationKey(game, s, p),
    terminalValue, heuristicFor, evalChildren, win: WIN,
  };
}

/**
 * Run Obscuro's search for one move and return the chosen action plus the solved
 * tree (which becomes the next move's blueprint under KLUSS).
 *
 * @param {object} hooks         from makeHooks
 * @param {GameState[]} worlds   sampled belief particles (states where it is `me`'s turn)
 * @param {object} cfg           { timeBudgetMs, maxRounds, expandPerRound, cfrPerRound, purifyMax, rng, opp }
 */
export async function runObscuroSearch(hooks, worlds, cfg = {}) {
  const rng = cfg.rng ?? Math.random;
  const nW = worlds.length;
  const tree = {
    me: hooks.me,
    worlds: worlds.map(s => ({ node: makeLeaf(hooks, s), prob: 1 / nW })),
    infosets: new Map(),
    rootInfoset: null,
    blueprint: cfg.blueprint ?? null, // previous move's infosets (KLUSS reuse)
    blueprintHits: 0,
  };
  // The searcher always knows its OWN exact legal moves (they are identical
  // across every world consistent with its observation — an FoW invariant), so
  // pin the root infoset's action set to the true legal moves rather than a
  // sampled world's. This guarantees the chosen move is legal in the real game
  // even when belief phantoms would change a sampled world's move set.
  if (cfg.rootActions && cfg.rootActions.length && nW) {
    const key = hooks.obsKey(worlds[0], hooks.me);
    const rootI = new Infoset(key, hooks.me, cfg.rootActions, cfg.rootActions.map(hooks.key));
    tree.infosets.set(key, rootI);
    warmStartInfoset(tree, rootI);
  }
  await expandRoot(tree, hooks);
  const root = tree.rootInfoset;
  if (!root) return { action: null, dist: [], rows: [], value: 0, tree };

  const expandPerRound = cfg.expandPerRound ?? 8;
  const cfrPerRound = cfg.cfrPerRound ?? 4;
  const maxRounds = cfg.maxRounds ?? 200;
  const maxInfosets = cfg.maxInfosets ?? Infinity;
  const budgetMs = cfg.timeBudgetMs ?? 0;
  const t0 = Date.now();
  let step = 0;
  // Snapshot the root strategy after each solve so purification can tell which
  // actions were "stable since T½" (App. C.8).
  const snapshots = [];
  for (let round = 0; round < maxRounds; round++) {
    if (tree.infosets.size < maxInfosets) {
      for (let e = 0; e < expandPerRound; e++) {
        // Alternate the exploring player every step (App. C.4).
        const exploring = (step++ % 2 === 0) ? hooks.me : cfg.opp;
        await doExpansionStep(tree, hooks, exploring, rng);
      }
    }
    runCFR(tree, cfrPerRound);
    snapshots.push([...root.rm.lastStrategy()]);
    if (budgetMs && Date.now() - t0 >= budgetMs) break;
  }
  // A final, longer solve so the equilibrium settles on the frozen tree (Fig. 8:
  // expander threads stop first, solver runs on a little longer).
  runCFR(tree, cfg.finalCfr ?? 40);
  snapshots.push([...root.rm.lastStrategy()]);

  // An action is "stable" if it stayed in the support of the last iterate for
  // every snapshot since the half-time point T½ — only stable actions may join
  // the mixed support during purification.
  const half = Math.floor(snapshots.length / 2);
  const eps = 1e-3;
  root.stableSince = root.actions.map((_, k) => snapshots.slice(half).every(s => (s[k] ?? 0) > eps));

  const strat = [...root.rm.lastStrategy()];
  let value = 0;
  for (let k = 0; k < strat.length; k++) value += strat[k] * root.uCond[k];
  // Mixing is only worthwhile when there is genuine hidden information for the
  // opponent to be uncertain about — i.e. more than one belief world. With a
  // single world (perfect information) there is nothing to hide, so play purely.
  const safe = cfg.safe ?? (tree.worlds.length > 1);
  const { action, dist } = purify(strat, root.actions, {
    maxSupport: cfg.purifyMax ?? 3,
    rng,
    infoset: root,
    safe,
  });
  return { action, dist, rawDist: strat, rows: root.actions, value, tree };
}
