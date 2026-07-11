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

import { observationKey, Infoset } from './infoset.js';
import { makeLeaf, expandRoot, doExpansionStep, warmStartInfoset } from './gtcfr.js';
import { buildGadget, runGadgetCFR } from './kluss.js';
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
  // A continuous-location game (games/coord.js) exposes getSearchActions: a
  // deterministic action set whose moves are exact continuous points rather than the
  // discrete tile candidates getLegalActions enumerates, so the tree search reasons
  // over the real continuous action space. `searchRes = { rings, spokes }` is the
  // difficulty-scaled resolution. It MUST be deterministic in (state, player): an
  // infoset's action set is fixed at creation and re-derived per world to filter
  // (gtcfr.js expandNode), so an rng-sampled set would desync.
  return {
    me,
    legal: game.getSearchActions
      ? ((s, p) => game.getSearchActions(s, p, opts.searchRes ?? {}))
      : ((s, p) => game.getLegalActions(s, p)),
    apply: (s, p, a) => { try { return game.applyActions(s, [{ playerId: p, action: a }], rng); } catch { return null; } },
    key,
    obsKey: (s, p) => observationKey(game, s, p),
    // Optional chance-node outcomes for a stochastic transition (most games,
    // including FoW chess, have none — this stays null and the tree is unchanged).
    chanceOutcomes: game.getChanceOutcomes ? ((s, p, a) => game.getChanceOutcomes(s, a)) : null,
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
  // Start the wall-clock budget before expandRoot: on a game with a huge root
  // action set (e.g. CS's continuous move/throw lattice, up to hundreds of
  // actions per unit) expanding every belief world at the root can itself run
  // long, and previously did so entirely outside the budget — the AI would hang
  // well past its configured time limit before the round loop below ever got a
  // chance to check the clock.
  const budgetMs = cfg.timeBudgetMs ?? 0;
  const t0 = Date.now();
  await expandRoot(tree, hooks, { deadline: budgetMs ? t0 + budgetMs : Infinity });
  const root = tree.rootInfoset;
  if (!root) return { action: null, dist: [], rows: [], value: 0, tree };

  // Build the KLUSS Resolve/Maxmargin gadget over the belief's opponent-infoset
  // partition (the order-2 knowledge-limited subgame root). Built once — the root
  // worlds are fixed; only the tree below grows.
  const gadget = buildGadget(tree, hooks, { opp: cfg.opp, prevValue: cfg.prevValue });
  tree.gadget = gadget;

  const expandPerRound = cfg.expandPerRound ?? 8;
  const cfrPerRound = cfg.cfrPerRound ?? 4;
  const maxRounds = cfg.maxRounds ?? 200;
  const maxInfosets = cfg.maxInfosets ?? Infinity;
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
        if (budgetMs && Date.now() - t0 >= budgetMs) break; // don't overrun mid-round
      }
    }
    // Solve one iteration at a time so the wall-clock budget is respected even on
    // a large tree where a single CFR iteration is not free.
    for (let c = 0; c < cfrPerRound; c++) {
      runGadgetCFR(tree, hooks, gadget, 1);
      if (budgetMs && Date.now() - t0 >= budgetMs) break;
    }
    snapshots.push([...root.rm.lastStrategy()]);
    if (budgetMs && Date.now() - t0 >= budgetMs) break;
  }
  // A final, longer solve so the equilibrium settles on the frozen tree (Fig. 8:
  // expander threads stop first, solver runs on a little longer). Bounded by a
  // small extra time allowance so a large tree can't blow past the budget.
  const finalCfr = cfg.finalCfr ?? 40;
  const finalDeadline = budgetMs ? t0 + budgetMs * 1.35 : Infinity;
  const chunk = Math.max(1, Math.min(finalCfr, 10));
  for (let done = 0; done < finalCfr; done += chunk) {
    runGadgetCFR(tree, hooks, gadget, chunk);
    if (Date.now() > finalDeadline) break;
  }
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
  // Safety (App. C.8): mixing is allowed only in the Maxmargin regime — when the
  // opponent has no incentive to *enter* the Resolve gadget (it always exits, so
  // p_max ≈ 0), meaning our strategy is safe. When Resolve is entering (a real
  // threat) we commit to the top move. Perfect information (one world) is always
  // pure — there is nothing to hide.
  const safe = cfg.safe ?? (tree.worlds.length > 1 && gadget.pmax < 0.05);
  const { action, dist } = purify(strat, root.actions, {
    maxSupport: cfg.purifyMax ?? 3,
    rng,
    infoset: root,
    safe,
  });
  return { action, dist, rawDist: strat, rows: root.actions, value, tree, safe, pmax: gadget.pmax };
}
