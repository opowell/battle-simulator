// ---------------------------------------------------------------------------
// ChessObscuroAgent — the chess specialisation of the generic ObscuroAgent.
//
// The search itself is now entirely generic and lives in agents/obscuro/ (the
// paper's real extensive-form machinery: a growing game tree, PCFR+ on the last
// iterate, one-sided GT-CFR expansion, purification). This file adds only the
// two things that are genuinely chess-specific, exactly matching the paper's
// division of labour ("game-independent search + a perfect-information eval"):
//
//   1. The LEAF EVALUATOR — a batched Stockfish node heuristic (`_leafEval`).
//      For each expanded node it asks Stockfish, in one MultiPV call, to score
//      every child of that node, and handles the two fog-of-war terminals a
//      standard engine cannot see: capturing the enemy king (a win, surfaced by
//      the game's getResult) and leaving one's own king capturable (a loss).
//
//   2. The PERFECT-INFORMATION SHORTCUT — with nothing hidden there is no belief
//      to reason over, so the strongest move is simply Stockfish's best move.
//      Routing it through the fog subgame would only flatten winning lines to the
//      same clamped leaf value (shuffling instead of converting), so we play the
//      engine directly, its strength scaled by the difficulty dial. This is an
//      information-model distinction, not a per-difficulty branch.
//
// Everything else — belief sampling, difficulty scaling, move selection — is
// inherited unchanged from the generic agent.
// ---------------------------------------------------------------------------

import { ObscuroAgent as GenericObscuroAgent, compactAction } from '../../agents/ObscuroAgent.js';
import { makeHooks, runObscuroSearch } from '../../agents/obscuro/search.js';
import { isAttackedBy } from './board.js';
import { evaluate } from './ChessAgent.js';
import { toFEN, uciToAction } from './fen.js';
import {
  multiPV, stockfishBestAction, difficultyToNumber,
  available as stockfishAvailable,
} from './stockfish.js';

// Material (Stockfish cp) scores are clamped so an imagined king capture from
// phantom hidden pieces can't swamp a concrete material decision.
const LEAF_CLAMP = 1500;
const clip = v => (v > LEAF_CLAMP ? LEAF_CLAMP : v < -LEAF_CLAMP ? -LEAF_CLAMP : v);

// The search's terminal win/loss magnitude, on the same cp scale as the leaves.
// The paper bounds ALL utilities (u: Z → [−1,+1], evals clamped inside it):
// under fog, values are averaged across belief worlds, so a real game-ending
// outcome must outweigh material decisively but boundedly — with the generic
// default (±10⁶) a single phantom world in which the enemy king looked
// capturable would swamp every real consideration and send the AI lunging.
// 8000 ≈ 5.3× the material clamp: game-deciding, not belief-noise-proof.
export const SEARCH_WIN = 8000;

// Leaving your OWN king capturable is not merely "down some material" — it IS
// the terminal loss (−SEARCH_WIN), and it is a consequence of a move the mover
// CHOSE. Otherwise, under fog, a move that hangs the king in half the belief
// worlds gets averaged against ordinary material evals in the other half and
// comes out looking playable — which is exactly how the AI walked its king onto
// a square a hidden pawn was covering. This is deliberately asymmetric with the
// +LEAF_CLAMP cap on *capturing the enemy* king at a LEAF: an imagined capture
// is phantom-prone and must not be banked on, while exposing our own king is a
// real, self-inflicted loss we must avoid.
const KING_HANG = SEARCH_WIN;

const otherColor = c => (c === 'white' ? 'black' : 'white');

function findKingSquare(board, color) {
  for (const sq of Object.keys(board)) {
    const p = board[sq];
    if (p && p.ownerId === color && p.type === 'king') return sq;
  }
  return null;
}

// The top of the iterative-deepening ladder. A CEILING the ladder climbs toward,
// not a depth it will usually reach: measured on this vendored engine (Stockfish
// 11, single-threaded WASM, no NNUE) at multipv 16 on an ordinary middlegame,
// depth 14 takes ~1.4 s, depth 18 ~7 s, and everything past ~19 blows through
// multiPV's per-call timeout. Whatever rung the caller's budget affords is the
// rung that gets reported, so the number the UI shows is always a real,
// completed search rather than an aspiration.
export const MAX_SF_DEPTH = 30;

// ONE rung of the ladder — the batched Stockfish node heuristic of the paper.
// Given a node `state` where `mover` is to play and the `actions` leading to its
// non-terminal children (with the already-applied `childStates`), returns the
// value TO THE MOVER of each child, plus whether the engine actually answered
// (`engineOk`) so a ladder above can tell "searched to depth d" from "fell back
// to the static evaluator because the engine timed out at depth d".
//
// One MultiPV call on the parent position scores all the mover's moves at once
// (cp is already from the mover's perspective). Children that hang the mover's
// king are a fog-of-war loss the engine cannot see, so they are scored directly.
async function scoreChildren(state, mover, actions, childStates, { sfDepth, cols, isCancelled }) {
  const them = otherColor(mover);
  const out = new Array(actions.length);
  const need = [];
  for (let i = 0; i < actions.length; i++) {
    const board = (childStates?.[i] ?? state).board;
    const k = findKingSquare(board, mover);
    if (!k || isAttackedBy(board, k, them)) { out[i] = -KING_HANG; continue; } // hung own king → losing move
    need.push(i);
  }
  // Nothing left for the engine to price (every child hangs the king) — the
  // answer is exact and depth-independent, so it counts as a completed rung.
  let engineOk = need.length === 0;
  let truncated = false;
  if (need.length) {
    let pv = null;
    if (await stockfishAvailable()) {
      const side = mover === 'white' ? 'w' : 'b';
      try {
        pv = await multiPV(toFEN(state.board, state.gameSpecific, side, state.turnNumber ?? 1),
          {
            multipv: Math.max(need.length, cols), depth: sfDepth,
            isCancelled, onStopped: () => { truncated = true; },
          });
      } catch { pv = null; }
    }
    const cpByIdx = new Map();
    if (pv && pv.length) {
      engineOk = !truncated;
      for (const { move, cp } of pv) {
        const a = uciToAction(move, actions);
        if (a) { const i = actions.indexOf(a); if (i >= 0) cpByIdx.set(i, cp); }
      }
    }
    for (const i of need) {
      out[i] = cpByIdx.has(i) ? clip(cpByIdx.get(i)) : clip(evaluate(childStates[i].board, mover));
    }
  }
  return { scores: out, engineOk };
}

// Fixed-depth leaf evaluator: the search asks for depth `sfDepth` and gets it.
// Stockfish deepens internally on the way (`go depth N` sweeps 1..N), so a
// single call already IS the ladder when the target depth is known up front —
// which is the power-mode case, where the dial fixes depth and breadth.
export function makeChessLeafEval(sfDepth, cols, { isCancelled } = {}) {
  return async (state, mover, actions, childStates) =>
    (await scoreChildren(state, mover, actions, childStates, { sfDepth, cols, isCancelled })).scores;
}

// Time-bounded leaf evaluator: climb the ladder one rung at a time — depth 1,
// then 2, then 3 … — re-scoring every child from scratch at each rung, and keep
// the deepest rung that COMPLETED before the budget ran out. Each rung is a
// self-contained `go depth d`, so a rung that gets cut short is simply discarded
// in favour of the last complete one; the caller always holds a coherent set of
// scores all measured at the same depth.
//
// Why re-search from depth 1 instead of one `go depth 30`: the point is to have
// a usable answer at every instant, not only at the end. That matters for a wall
// clock that can expire at any moment, and it is what lets the analysis panel
// report "these are the top moves as of depth d" for a whole population of
// belief worlds at once — every world must sit at the SAME depth for its scores
// to be averaged together. Stockfish's own internal deepening cannot do that,
// because it is private to a single call on a single position.
//
//   perCallMs — the slice of the move budget this one evaluation may spend.
//   deadline  — absolute wall-clock stop for the whole move; never overrun it.
export function makeIterativeChessLeafEval({
  maxDepth = MAX_SF_DEPTH, cols = 0, perCallMs = 250, deadline = Infinity, isCancelled,
} = {}) {
  return async (state, mover, actions, childStates) => {
    const stopAt = Math.min(deadline, Date.now() + perCallMs);
    // Rungs past the first are also stoppable mid-search, so overshoot is
    // bounded by the poll interval rather than by a whole rung's cost.
    const rungCancelled = () => (isCancelled?.() ?? false) || Date.now() > stopAt;
    let best = null;
    for (let d = 1; d <= maxDepth; d++) {
      // Depth 1 always runs: an evaluator that returns nothing would leave the
      // search with no values at all, which is worse than a shallow answer.
      if (d > 1 && rungCancelled()) break;
      const { scores, engineOk } = await scoreChildren(state, mover, actions, childStates, {
        sfDepth: d, cols, isCancelled: d > 1 ? rungCancelled : undefined,
      });
      if (!engineOk && best) break; // rung cut short or engine gave up — keep the last complete one
      best = scores;
      if (!engineOk) break;         // no engine at all: deeper rungs would be identical
    }
    return best;
  };
}

export class ChessObscuroAgent extends GenericObscuroAgent {
  constructor(opts = {}) {
    // The generic base needs a truthy game; the real ChessGame is attached
    // lazily on first use to avoid a circular import (ChessGame imports us).
    super({}, { id: 'obscuro', name: 'Obscuro (CFR)', ...opts });
    this._chessGame = null;
  }

  async _game() {
    if (!this._chessGame) this._chessGame = (await import('./ChessGame.js')).ChessGame;
    this.game = this._chessGame;
    return this._chessGame;
  }

  // Bounded terminal value for the fog search (see SEARCH_WIN above).
  _winValue() { return SEARCH_WIN; }

  // Chess's batched Stockfish node heuristic, its depth/width scaled by the dial.
  // The paper runs its leaf evaluation at DEPTH 1 (App. C.5) and gets its
  // strength from the search aggregating many worlds and growing the tree. Deep
  // leaves here (the old 2..10 ramp) dated from when the multi-world
  // aggregation was broken and each leaf had to carry the position alone; they
  // also made a cold-cache expansion so slow that only a couple of belief
  // worlds fit in the budget — reintroducing single-world behaviour through the
  // back door. Shallow-ish leaves keep every world expandable within budget;
  // the dial still buys leaf depth at the top: depth 6–7 is where the engine
  // starts pricing two-ply tactics (e.g. "quiet move → pawn takes the hanging
  // bishop") into the parent MultiPV scores, which our small trees cannot be
  // relied on to discover in-tree for every belief world.
  //
  // The two dials pick the two forms of the SAME evaluator (see
  // makeIterativeChessLeafEval): POWER fixes the ladder's top rung and its
  // breadth outright, so every leaf is priced at exactly the depth the dial
  // bought. A TIME limit buys no fixed depth at all — it buys full breadth
  // (every legal child, always) and as many rungs as the clock allows, which is
  // the same iterative deepening the analysis panel runs.
  _leafEval(observation) {
    const gs = observation.gameSpecific ?? {};
    const timeMs = gs.aiTimeMs;
    if (typeof timeMs === 'number' && timeMs > 0) {
      // Spread the move's wall clock over the evaluations a search actually
      // makes rather than letting the first one swallow it: root expansion alone
      // costs one evaluation per belief world BEFORE the round loop starts, so a
      // per-call slice of budget/(worlds × 8) keeps root expansion at an eighth
      // of the budget and leaves the rest for tree growth. cols 0 = no minimum
      // breadth, because breadth is already full: scoreChildren always asks for
      // at least one MultiPV line per child that needs one.
      const cfg = this._config(observation);
      const perCallMs = Math.max(30, Math.round(timeMs / (Math.max(1, cfg.worlds ?? 1) * 8)));
      return makeIterativeChessLeafEval({
        maxDepth: MAX_SF_DEPTH, cols: 0, perCallMs, deadline: Date.now() + timeMs,
      });
    }
    const t = difficultyToNumber(gs.difficulty) / 100;
    const sfDepth = Math.max(1, Math.round(2 + t * 5)); // 2..7
    const cols = Math.round(5 + t * 9);                 // 5..14
    return makeChessLeafEval(sfDepth, cols);
  }

  async chooseAction(state, legalActions) {
    if (!legalActions?.length) return null;
    if (legalActions.length === 1) return legalActions[0];
    await this._game();

    const gs = state.gameSpecific;
    // Perfect information (fog off): play Stockfish at FULL strength — no Skill Level
    // handicap. A 0 power level / 0 ms limit is random and falls through to the generic
    // random branch. Otherwise:
    //   • time mode  → the single strongest move within the movetime budget.
    //   • power mode → the engine scores every move at full strength and we SAMPLE one
    //     in proportion to its score (see _proportionalPick). Weaker play at lower power
    //     comes from the softer sampling, not from a hobbled engine, so the AI plays
    //     worse gradually instead of dropping pieces outright.
    const timeMs = gs.aiTimeMs;
    const isRandom = timeMs === 0 || (timeMs == null && gs.difficulty === 0);
    if (!gs.fogOfWar && !isRandom) {
      if (typeof timeMs === 'number') {
        const sfOpts = { movetime: Math.min(Math.max(timeMs, 1), 600000), skill: 20 };
        const sf = await stockfishBestAction(state, legalActions, sfOpts);
        if (sf) {
          await this._captureStockfishAnalysis(state, legalActions, sf, sfOpts, gs);
          return this._matchLegal(sf, legalActions) ?? sf;
        }
      } else {
        const picked = await this._proportionalPick(state, legalActions, gs);
        if (picked) return picked;
      }
    }
    return super.chooseAction(state, legalActions);
  }

  // NOTE: there is deliberately no selection-time king-safety backstop any more.
  // An earlier `_kingSafetyGuard` (via _adjustChosenAction) re-sampled the belief
  // and vetoed near-tie moves that hung the king in many worlds, back when the
  // search itself mispriced king-hangs. After the search fixes (infoset
  // action-set invariant, uCond reach weighting, bounded terminals, exact belief,
  // tree carryover) a 24-game / 1787-ply validation measured the with-safe-move
  // king-hang rate at 1.4% with the guard firing on only 0.34% of plies — and
  // batches where it never fired still met the <2% target — so it was removed:
  // play is now genuinely equilibrium-driven (plan doc Phase 4).

  // Power mode, perfect information: score every legal move at full strength, then
  // pick one at random weighted by its score. Scores are converted to win
  // probabilities (a principled, always-positive measure), so a move worth ~twice
  // the win chance of another is played ~twice as often. The power dial only sets
  // the SHARPNESS of that sampling (β): at power 50 the probability is exactly
  // proportional to the win-prob score; higher power sharpens toward the best move,
  // lower power flattens toward uniform. No Skill Level, so no gratuitous blunders.
  async _proportionalPick(state, legalActions, gs) {
    try {
      const us = state.activePlayers[0];
      const fen = toFEN(state.board, state.gameSpecific, us === 'white' ? 'w' : 'b', state.turnNumber ?? 1);
      const t = difficultyToNumber(gs.difficulty) / 100;
      // Score broadly so weak-but-legal moves stay reachable at low power; deeper at
      // higher power for more accurate scores (strength there comes from sharper β too).
      const multipv = Math.min(legalActions.length, 20);
      const depth = Math.round(10 + t * 6); // 10..16
      const pv = await multiPV(fen, { multipv, depth });
      if (!pv || !pv.length) return null;

      // cp (mover's perspective) → win probability in (0,1). Mate scores saturate.
      const winProb = cp => (cp >= 90000 ? 1 : cp <= -90000 ? 0 : 1 / (1 + Math.pow(10, -cp / 400)));
      // β: 0 → uniform, 1 → probability exactly proportional to win-prob score, →12 → near-best.
      const beta = t <= 0.5 ? (t / 0.5) : (1 + (t - 0.5) / 0.5 * 11);

      const scored = [];
      for (const { move, cp } of pv) {
        const a = uciToAction(move, legalActions);
        if (!a) continue;
        const wp = winProb(cp);
        scored.push({ action: a, cp, weight: Math.pow(wp, beta) });
      }
      if (!scored.length) return null;

      // Full power is the true perfect-information special case: it collapses to
      // PURE Stockfish play (deterministic best move), no sampling softness left.
      if (t >= 0.999) {
        let best = scored[0];
        for (const x of scored) if (x.cp > best.cp) best = x;
        for (const x of scored) { x.weight = x === best ? 1 : 0; }
      }
      const total = scored.reduce((s, x) => s + x.weight, 0) || 1;
      for (const x of scored) x.prob = x.weight / total;

      // Sample proportional to weight.
      let r = this._rng() * total, chosen = scored[0].action;
      for (const x of scored) { r -= x.weight; if (r <= 0) { chosen = x.action; break; } }

      const chosenKey = this._key(chosen);
      const rank = scored.findIndex(x => this._key(x.action) === chosenKey);
      this.lastAnalysis = {
        ts: Date.now(),
        player: us,
        engine: 'stockfish',
        mode: 'Stockfish · proportional',
        difficulty: gs.difficulty ?? null,
        depth,
        chosenRank: rank >= 0 ? rank + 1 : null,
        candidates: scored.map(x => ({
          key: this._key(x.action), move: compactAction(x.action),
          cp: x.cp, prob: x.prob, chosen: this._key(x.action) === chosenKey,
        })),
        totalCandidates: legalActions.length,
      };
      return this._matchLegal(chosen, legalActions) ?? chosen;
    } catch { return null; } // any engine hiccup → fall back to the generic search
  }

  // Time mode (perfect information): the strongest move within the movetime budget.
  // The MultiPV ranking is captured purely for the analysis panel.
  async _captureStockfishAnalysis(state, legalActions, chosen, sfOpts, gs) {
    try {
      const us = state.activePlayers[0];
      const fen = toFEN(state.board, state.gameSpecific, us === 'white' ? 'w' : 'b', state.turnNumber ?? 1);
      const pv = await multiPV(fen, { multipv: 8, depth: 12 });
      const chosenKey = this._key(chosen);
      let cands = [];
      if (pv && pv.length) {
        cands = pv.map(({ move, cp }) => {
          const a = uciToAction(move, legalActions);
          return a ? { key: this._key(a), move: compactAction(a), cp, chosen: this._key(a) === chosenKey } : null;
        }).filter(Boolean);
      }
      if (!cands.some(c => c.chosen)) {
        cands.push({ key: chosenKey, move: compactAction(chosen), cp: null, chosen: true });
      }
      const rank = cands.findIndex(c => c.chosen);
      this.lastAnalysis = {
        ts: Date.now(),
        player: us,
        engine: 'stockfish',
        mode: 'Stockfish · best',
        difficulty: gs.difficulty ?? null,
        movetimeMs: sfOpts.movetime ?? null,
        chosenRank: rank >= 0 ? rank + 1 : null,
        candidates: cands,
        totalCandidates: cands.length,
      };
    } catch { /* analysis is best-effort; never break move selection */ }
  }
}

export const ObscuroAgent = new ChessObscuroAgent();

// ---------------------------------------------------------------------------
// Inspection helper (used by tests): run Obscuro's search for one position and
// return the candidate moves, the last-iterate distribution over them, the
// chosen move, its value and the solve mode ('minimax' with perfect info, 'cfr'
// under fog). Uses the generic static evaluation (not Stockfish) so it is
// deterministic and does not require the engine.
// ---------------------------------------------------------------------------
export async function obscuroStrategy(state, legalActions, opts = {}) {
  const rng = opts.rng ?? Math.random;
  // Defaults to whoever's actually to move, but a caller may override — e.g.
  // the analysis API always passes the requesting viewer's own colour under
  // fog, so "what's good for my side" stays answerable even when it isn't
  // literally their turn yet (see api-server.js's handleAnalyze). When it
  // overrides to a colour that ISN'T state.activePlayers[0], the state itself
  // is patched to match: the generic search's tree-building derives whose
  // move a node represents from activePlayers at every level it touches, not
  // just this root call's `me`, so a root that internally still claims "black
  // to move" while search/tree code is told `me = white` desyncs partway
  // through and returns nonsense (a piece move for a side that isn't even on
  // this board). Presenting a state that honestly says "white to move" keeps
  // the whole tree self-consistent for this hypothetical/counterfactual read.
  const me = opts.color ?? state.activePlayers[0];
  if (me !== state.activePlayers[0]) state = { ...state, activePlayers: [me] };
  const game = (await import('./ChessGame.js')).ChessGame;
  const fog = !!state.gameSpecific.fogOfWar;

  // opts.worlds lets a caller supply the belief cloud explicitly (the batched
  // enumeration cursor passes the next slice of the population — see
  // analyzeObscuroProgressive) instead of sampling a fresh one here.
  let worlds = opts.worlds ?? (fog ? game.sampleWorlds(state, me, opts.particles ?? 8, rng) : null);
  if (!worlds || worlds.length === 0) worlds = [state];

  const hooks = makeHooks(game, me, { rng });
  const opp = (state.players ?? []).find(p => p.id !== me)?.id ?? null;
  // Live "round N/M" progress (lichess-style depth ticks, but for CFR rounds) —
  // purely a side channel; see runObscuroSearch's cfg.onRound.
  const onRound = opts.onProgress
    ? (round, maxRounds, info) => opts.onProgress({ kind: 'round', round, maxRounds, candidates: rankCandidates(info.rows, info.dist) })
    : undefined;
  const res = await runObscuroSearch(hooks, worlds, {
    opp, rootActions: legalActions, rng,
    timeBudgetMs: opts.timeBudgetMs ?? 0,
    maxRounds: opts.maxRounds ?? 30,
    expandPerRound: opts.expandPerRound ?? 8,
    cfrPerRound: opts.cfrPerRound ?? 4,
    purifyMax: opts.purifyMax ?? 3,
    onRound,
    // So a solve stops mid-flight when the analysis position changes (rather
    // than running out its rounds after the viewer has already moved on).
    isCancelled: opts.isCancelled,
  });

  const k = game.actionKey;
  const action = legalActions.find(a => k(a) === k(res.action)) ?? res.action ?? legalActions[0];
  return { mode: fog ? 'cfr' : 'minimax', action, dist: res.dist, rows: res.rows, value: res.value, particles: worlds.length };
}

// Shared with the onRound progress callback above so a mid-search snapshot and
// the final result are ranked identically. Sorted by probability (how much of
// the equilibrium's mass this move gets) descending, ties — most of them,
// since only a handful of moves ever get nonzero mass — broken by cp
// (highest first) once one's available (see analyzeObscuroProgressive's eval
// ladder below; mid-search progress ticks have no cp yet, so ties there just
// keep whatever order `rows` came in).
function rankCandidates(rows, dist) {
  return (rows ?? [])
    .map((action, i) => ({ move: action, prob: dist?.[i] ?? 0 }))
    .sort((a, b) => (b.prob - a.prob) || ((b.cp ?? -Infinity) - (a.cp ?? -Infinity)));
}

// ---------------------------------------------------------------------------
// Read-only position analysis for the UI's "suggest a move" panel: runs the
// exact same solve as obscuroStrategy (fog-aware via the belief population when
// applicable, perfect-info minimax otherwise) and reshapes its output into
// ranked candidates, without ever selecting/committing a move for real play.
//
// There used to be two disconnected branches here: a perfect-information one
// that asked Stockfish directly (deep, live "Depth N/14" ticks, no belief
// framing) and a fog one that walked belief worlds at a fixed shallow depth
// (wider and wider, never deeper). That split was artificial. PERFECT
// INFORMATION IS JUST A BELIEF POPULATION OF SIZE 1 — nothing is hidden, so
// exactly one world is consistent with the observation — and once
// ChessGame.beliefPopulation says so, the one progressive walk below covers both
// regimes: it refines along BOTH axes, more worlds and more depth, and a
// population of 1 simply spends every batch on the single real position.
// ---------------------------------------------------------------------------
export async function analyzeObscuro(state, legalActions, opts = {}) {
  if (!legalActions?.length) return { engine: 'obscuro', mode: 'none', candidates: [] };
  return await analyzeObscuroProgressive(state, legalActions, opts);
}

// Batched Stockfish leaf eval over an EXPLICIT set of belief worlds, all scored
// at the SAME depth (`opts.sfDepth`) so their scores are commensurable: returns
// the per-legal-move SUM of cp across the worlds it managed to score, and the
// count `n` of those worlds. Kept raw (sum + count, not a mean) so a caller
// folding many batches together forms the exact population mean — Σsum / Σn —
// instead of averaging per-batch means (which would misweight unequal final
// batches). Bails promptly when the caller has moved on or the budget is spent,
// discarding any world whose evaluation was interrupted part-way rather than
// folding a half-searched score into the mean.
export async function cpSumsOverWorlds(game, worlds, color, legalActions, cols, opts = {}) {
  const { sfDepth = MAX_SF_DEPTH, isCancelled, deadline, onWorld } = opts;
  const stop = () => (isCancelled?.() ?? false) || (deadline != null && Date.now() > deadline);
  const leafEval = makeChessLeafEval(sfDepth, cols, { isCancelled: stop });
  const sums = new Array(legalActions.length).fill(0);
  let n = 0;
  for (let w = 0; w < worlds.length; w++) {
    const world = worlds[w];
    if (stop()) break;
    const childStates = legalActions.map(a => game.applyActions(world, [{ playerId: color, action: a }]));
    const scores = await leafEval(world, color, legalActions, childStates);
    if (!scores) continue;
    if (stop()) break; // interrupted mid-world — its scores are partial, drop them
    n++;
    for (let i = 0; i < scores.length; i++) sums[i] += scores[i];
    // Side channel for the UI's per-world view: the aggregate above answers
    // "how good is this move on average", but the panel also lets a viewer ask
    // "which board makes THIS move look best", which needs the individual
    // world's scores kept rather than summed away.
    onWorld?.(w, world, scores);
  }
  return { sums, n };
}

// Fisher-Yates permutation of [0, n) so the batched enumeration walks the belief
// population in a random order — every world covered exactly once, but early
// batches aren't spatially biased toward one region of the position set. Built
// once per analysis session (not per batch); an n-int array for n up to the
// exact tracker's cap (~200k) is a few MB, released when the walk ends.
function shuffledIndices(n, rng) {
  const idx = new Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
  }
  return idx;
}

// ---------------------------------------------------------------------------
// The single analysis walk. It refines along TWO axes at once:
//
//   • WIDTH — the belief population. Walk every world consistent with what the
//     viewer can see, in batches, folding each batch into a running estimate.
//   • DEPTH — an iterative-deepening ladder over the Stockfish leaf eval. Score
//     the whole population at depth 1, then re-score it all at depth 2, then 3 …
//     up to MAX_SF_DEPTH, so there is a complete, self-consistent answer at
//     every rung instead of one long opaque wait for a deep one.
//
// Depth is the OUTER loop and the population the inner one, because an average
// is only meaningful over worlds scored at the same depth: mixing a depth-20
// world with a depth-3 world would weight the position by how far down the
// batch queue it happened to land. So each rung is a complete sweep, and its
// cp aggregates are discarded and rebuilt from scratch at the next rung.
//
// The MIXING probabilities are not re-derived per rung: they come from the CFR
// tree, which prices its own leaves with the game's cheap static evaluator and
// never consults Stockfish, so they do not depend on `sfDepth` at all. Each
// batch of NEW worlds contributes its equilibrium once — which for the exact
// population means the first sweep alone, since later sweeps revisit the very
// same worlds, and for the generative fallback means every sweep, since each
// draws fresh samples.
//
// Two population regimes (see ChessGame.beliefPopulation):
//   • EXACT belief (perfect information, and the common fog case after the
//     opening): P is a real array, enumerated WITHOUT replacement via a one-time
//     shuffled cursor — every world covered exactly once per rung, `total`
//     known, coverage marching to 100%. Perfect information is this regime with
//     total === 1.
//   • Heuristic fallback (exact tracking lost): belief.js is generative with no
//     enumerable set, so each sweep samples fresh worlds (with replacement),
//     `total` is null, and a sweep is capped at a fixed batch count so the
//     ladder can still climb.
//
// Aggregation (see OBSCURO-UNLIMITED-BELIEF-PLAN.md's "crux"): the cp EVAL per
// move is additive over worlds, so a world-count-weighted running mean converges
// to the exact population expectation. The move PROBABILITY is an ensemble
// average of each batch's own CFR equilibrium (weighted by batch size) — a
// well-defined blend, but NOT the single joint-equilibrium mixing (that would
// need the KLUSS gadget to grow its world set mid-solve — Design A, not
// attempted). Cancellation is checked between AND within batches, and now also
// inside the engine call itself (stockfish.js's UCI `stop`), so a stale walk
// stops within a round of the position changing rather than a deep rung later.
// maxTotalMs is a safety net for a missed disconnect, not a quality cap.
// ---------------------------------------------------------------------------
export async function analyzeObscuroProgressive(state, legalActions, opts) {
  const maxTotalMs = opts.maxTotalMs ?? 5 * 60 * 1000;
  const t0 = Date.now();
  const deadline = t0 + maxTotalMs;
  const game = (await import('./ChessGame.js')).ChessGame;
  const k = game.actionKey;
  const rng = opts.rng ?? Math.random;
  const isCancelled = opts.isCancelled;
  const spent = () => (isCancelled?.() ?? false) || Date.now() >= deadline;

  // Analyze the requesting side's move — patch activePlayers up front (mirrors
  // obscuroStrategy) so every enumerated world is built with the right side to
  // move; the players-array identity is preserved, so the maintained belief is
  // still found by ChessGame.beliefPopulation's WeakMap lookup.
  const me = opts.color ?? state.activePlayers[0];
  if (me !== state.activePlayers[0]) state = { ...state, activePlayers: [me] };

  const cols = Math.min(legalActions.length, 16);
  const batchSize = opts.batchSize ?? 16;
  const maxDepth = opts.maxSfDepth ?? MAX_SF_DEPTH;
  // Generative fallback only: how many batches count as one "sweep" of an
  // unbounded population before the ladder moves up a rung.
  const sweepBatches = opts.sweepBatches ?? 4;

  // cp source: run Stockfish over each batch, wherever it's available — server
  // (Node worker thread) or browser (nested Worker over the vendored WASM
  // build; see stockfish.js). `opts.cpEval` is an optional override some
  // caller can still supply instead. When neither is available, candidates
  // stay prob-only (cp: null) and the depth ladder is meaningless, so the walk
  // does a single sweep.
  const cpEval = opts.cpEval
    // `onWorld` is forwarded so an override can feed the per-world view too (the
    // real evaluator below reports every world it prices through it).
    ? ((worlds, sfDepth, onWorld) => opts.cpEval(worlds, legalActions, sfDepth, onWorld))
    : ((await stockfishAvailable())
        ? ((worlds, sfDepth, onWorld) => cpSumsOverWorlds(game, worlds, me, legalActions, cols, { sfDepth, isCancelled, deadline, onWorld }))
        : null);

  const pop = game.beliefPopulation(state, me);
  const order = pop.exact ? shuffledIndices(pop.total, rng) : null;
  const total = pop.exact ? pop.total : null;

  // ── the per-world view (see buildBeliefWorlds) ────────────────────────────
  // Everything above collapses the belief population into ONE ranked move list.
  // The panel additionally lets a viewer look at the population itself: step
  // through the most plausible boards, or ask which board makes a particular
  // candidate move look best. Both need individual worlds kept, so gather them
  // alongside the aggregates — bounded, since the population runs to ~200k and
  // this is a payload that crosses a Worker/SSE boundary every few frames.
  //
  // Only under fog. With perfect information there is nothing hidden to guess at
  // — the population is the one board already on screen — so the whole per-world
  // channel would be an empty payload on every frame.
  const perWorldView = !!state.gameSpecific.fogOfWar;
  const likelyCap = opts.likelyWorldsCap ?? 32;
  const scoredCap = opts.scoredWorldsCap ?? 96;
  const hiddenOf = (world) => game.hiddenPiecesOf?.(world, state, me) ?? [];
  const ranked = perWorldView ? (game.rankBeliefWorlds?.(state, me, likelyCap) ?? null) : null;
  // The most-plausible boards, materialised once: they don't depend on the
  // engine at all, so the overlay can be on screen before the first rung lands.
  const likelyWorlds = [];
  if (ranked?.top?.length) {
    const idx = ranked.top.map(t => t.index);
    const worlds = game.enumerateWorlds(state, me, idx);
    for (let i = 0; i < worlds.length; i++) {
      likelyWorlds.push({ index: idx[i], prob: ranked.top[i].prob, hidden: hiddenOf(worlds[i]) });
    }
  }
  // index → { index, prob, hidden, cp[] }, for the worlds the engine actually
  // priced at the current rung. Rebuilt per rung like the cp aggregates, so
  // every cp in it was searched to the same depth and the "best world for this
  // move" ordering compares like with like.
  let scoredWorlds = new Map();
  let settledWorlds = new Map();

  // Mixing aggregate — accumulated across every batch of NEW worlds (see above).
  const probSum = new Map(); let probW = 0;
  // Eval aggregate — rebuilt from scratch at each rung of the ladder. `settledCp`
  // holds the deepest rung that actually produced numbers, so the eval column
  // never blanks out while a deeper rung is still being computed (or is being
  // abandoned because the engine can't reach it inside the budget).
  let cpSum = new Map(), cpN = new Map();
  const settledCp = new Map();
  let settledDepth = 0;

  // Nothing hidden (population of exactly one world) makes the mixing degenerate
  // — purification commits to a single move, so every other move sits at 0% and
  // the probability column carries no ranking information at all. Rank by the
  // engine's evaluation there, which is what the old perfect-information branch
  // showed. Under a real belief cloud the mixing IS the answer to "what should I
  // play", so it stays primary and cp only breaks its (very common) ties.
  const rankByCp = pop.exact && pop.total === 1;
  const buildCandidates = () => legalActions
    .map(a => {
      const key = k(a);
      const cnt = cpN.get(key);
      return {
        move: a,
        // Same identity the per-world cp vectors are indexed by (`moves` in the
        // belief payload below), so the panel can line a candidate row up with
        // its column without re-deriving move equality from the action object.
        key,
        prob: probW ? (probSum.get(key) ?? 0) / probW : 0,
        cp: cnt ? Math.round(cpSum.get(key) / cnt) : (settledCp.get(key) ?? null),
      };
    })
    .sort(rankByCp
      ? (a, b) => ((b.cp ?? -Infinity) - (a.cp ?? -Infinity)) || (b.prob - a.prob)
      : (a, b) => (b.prob - a.prob) || ((b.cp ?? -Infinity) - (a.cp ?? -Infinity)));

  // The population itself, for the panel's world stepper — the union of the most
  // PLAUSIBLE boards (engine-free, so they are on screen immediately) and the
  // boards the engine has actually priced at the current rung (which carry a cp
  // per candidate move, so "which board makes THIS move look best" is
  // answerable). `moves` fixes the column order of every cp vector.
  const buildBeliefWorlds = () => {
    if (!perWorldView) return null;
    const scored = scoredWorlds.size ? scoredWorlds : settledWorlds;
    const byId = new Map();
    for (const w of likelyWorlds) byId.set(w.index, { id: String(w.index), prob: w.prob, hidden: w.hidden, cp: null });
    for (const [id, w] of scored) {
      const prior = byId.get(id);
      if (prior) prior.cp = w.cp;
      else byId.set(id, { id: String(id), prob: w.prob, hidden: w.hidden, cp: w.cp });
    }
    return {
      total, exact: pop.exact, depth: settledDepth || null,
      // A re-acquired superset, not the history-exact set: the panel must not
      // present these boards as certainties (see ExactBelief.rankByPlausibility).
      approx: ranked?.approx ?? null,
      moves: legalActions.map(k),
      worlds: [...byId.values()],
    };
  };

  let batches = 0, last = null, covered = false, settledCovered = false;
  // The plausible boards need nothing from the engine, so hand them over before
  // the first batch's CFR solve + leaf eval (seconds, on a large population)
  // rather than making the viewer stare at bare fog until then.
  if (likelyWorlds.length) opts.onProgress?.({ kind: 'belief', total, beliefWorlds: buildBeliefWorlds() });
  for (let depth = 1; depth <= maxDepth; depth++) {
    // A fresh rung: previous depths' evals are superseded, not blended into.
    cpSum = new Map(); cpN = new Map();
    scoredWorlds = new Map();
    let cursor = 0, evaluated = 0, sweepCount = 0, rungCp = 0;
    covered = false;
    // Every batch of NEW worlds contributes its equilibrium once; the exact
    // population is only new on the first sweep.
    const foldProb = !pop.exact || depth === 1;

    while (!spent()) {
      // Next batch of belief worlds.
      let worlds;
      // Absolute population indices of `worlds`, so a world the engine prices
      // can be filed under the same id the plausibility ranking uses. Null in
      // the generative regime, which has no enumerable population to index into.
      let batchIdx = null;
      if (pop.exact) {
        if (cursor >= order.length) break; // (unreachable: `covered` breaks below first)
        const idx = order.slice(cursor, cursor + batchSize);
        cursor += idx.length;
        worlds = game.enumerateWorlds(state, me, idx);
        batchIdx = idx;
      } else {
        const w = game.sampleWorlds(state, me, batchSize, rng);
        worlds = (w && w.length) ? w : [state];
      }
      if (!worlds.length) break;

      // Mixing: one CFR equilibrium over this batch, folded in weighted by size.
      let mode = last?.mode ?? (state.gameSpecific.fogOfWar ? 'cfr' : 'minimax');
      if (foldProb) {
        const r = await obscuroStrategy(state, legalActions, {
          worlds, color: me, rng, isCancelled,
          maxRounds: opts.maxRounds ?? 100, expandPerRound: opts.expandPerRound ?? 16, cfrPerRound: opts.cfrPerRound ?? 8,
        });
        if (isCancelled?.()) break; // moved on mid-solve — discard this partial batch
        mode = r.mode;
        const w = worlds.length;
        probW += w;
        for (let i = 0; i < r.rows.length; i++) {
          const key = k(r.rows[i]);
          probSum.set(key, (probSum.get(key) ?? 0) + w * (r.dist?.[i] ?? 0));
        }
      }

      // Eval: raw cp sums over the SAME batch at THIS rung's depth, so the
      // running mean stays exact and every world in it is equally deep.
      if (cpEval) {
        // Keep each world's own scores as they go by, up to the cap — the
        // aggregate below sums them away, but the per-world view needs them.
        const onWorld = !perWorldView ? undefined : (w, world, scores) => {
          if (scoredWorlds.size >= scoredCap) return;
          const id = batchIdx ? batchIdx[w] : `s${batches}:${w}`;
          if (scoredWorlds.has(id)) return;
          scoredWorlds.set(id, {
            prob: (ranked?.probs && typeof id === 'number') ? ranked.probs[id] : null,
            hidden: hiddenOf(world),
            cp: scores.map(s => Math.round(s)),
          });
        };
        const { sums, n } = (await cpEval(worlds, depth, onWorld)) ?? { sums: null, n: 0 };
        if (n > 0 && sums) {
          rungCp += n;
          for (let i = 0; i < legalActions.length; i++) {
            const key = k(legalActions[i]);
            cpSum.set(key, (cpSum.get(key) ?? 0) + sums[i]);
            cpN.set(key, (cpN.get(key) ?? 0) + n);
          }
        }
      }
      if (spent()) break;
      // The engine could not finish a single world at this depth. Sweeping the
      // rest of the population at a rung it cannot reach would burn one full
      // per-call timeout per world for nothing, so abandon the rung now and let
      // the ladder top out on the last one that worked.
      if (cpEval && depth > 1 && rungCp === 0) break;

      batches++; evaluated += worlds.length; sweepCount++;
      covered = pop.exact ? cursor >= order.length : sweepCount >= sweepBatches;
      // Fully settled: the whole population, at the top of the ladder. Nothing
      // left to refine on either axis.
      const exhaustive = covered && (depth >= maxDepth || !cpEval) && pop.exact;
      const candidates = buildCandidates();
      last = { engine: 'obscuro', mode, candidates, depth, maxDepth, batches, evaluated, total, exhaustive };
      // The world list is bulky (one hidden-piece layout + one cp vector each)
      // and only meaningfully changes as new worlds get priced, so it rides
      // along on a fraction of the frames rather than every one. The panel keeps
      // the last one it saw.
      const belief = (batches === 1 || covered || batches % 8 === 0) ? buildBeliefWorlds() : null;
      opts.onProgress?.({ kind: 'batch', depth, maxDepth, batch: batches, evaluated, total, exhaustive, candidates,
        ...(belief ? { beliefWorlds: belief } : {}) });
      if (covered) break; // sweep complete — climb to the next rung
    }

    if (rungCp > 0) {
      // This rung produced real numbers: they become the floor the next rung's
      // partial results fall back to while it is still filling in.
      settledDepth = depth;
      settledCovered = covered;
      for (const [key, cnt] of cpN) settledCp.set(key, Math.round(cpSum.get(key) / cnt));
      if (scoredWorlds.size) settledWorlds = scoredWorlds;
    } else if (cpEval && depth > 1) {
      break; // engine can't reach this depth inside the budget — the ladder tops out
    }
    if (!cpEval) break; // no engine: depth is meaningless, one sweep is the whole answer
    if (spent() || !covered) break; // cancelled, out of budget, or the sweep was cut short
  }

  if (last) {
    last.depth = settledDepth || last.depth;
    // The ladder may have topped out below maxDepth (a deeper rung simply cannot
    // be searched in the time available). If the population is nonetheless fully
    // covered and we stopped of our own accord, the answer IS settled.
    if (settledCovered && pop.exact && !spent()) last.exhaustive = true;
    last.beliefWorlds = buildBeliefWorlds();
    return last;
  }
  return {
    engine: 'obscuro', mode: state.gameSpecific.fogOfWar ? 'cfr' : 'minimax', candidates: [],
    // Even with no move ranking to show (cancelled before the first batch), the
    // plausible-board list is already built and costs nothing to hand over.
    beliefWorlds: buildBeliefWorlds(),
  };
}
