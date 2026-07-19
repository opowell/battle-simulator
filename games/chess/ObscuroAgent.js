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

// The batched Stockfish leaf evaluator (the paper's node heuristic). Signature
// matches the generic search's expectation: given a node `state` where `mover`
// is to play and the `actions` leading to its non-terminal children (with the
// already-applied `childStates`), return the value TO THE MOVER of each child.
//
// One MultiPV call on the parent position scores all the mover's moves at once
// (cp is already from the mover's perspective). Children that hang the mover's
// king are a fog-of-war loss the engine cannot see, so they are scored directly.
export function makeChessLeafEval(sfDepth, cols) {
  return async (state, mover, actions, childStates) => {
    const them = otherColor(mover);
    const out = new Array(actions.length);
    const need = [];
    for (let i = 0; i < actions.length; i++) {
      const board = (childStates?.[i] ?? state).board;
      const k = findKingSquare(board, mover);
      if (!k || isAttackedBy(board, k, them)) { out[i] = -KING_HANG; continue; } // hung own king → losing move
      need.push(i);
    }
    if (need.length) {
      let pv = null;
      if (await stockfishAvailable()) {
        const side = mover === 'white' ? 'w' : 'b';
        try {
          pv = await multiPV(toFEN(state.board, state.gameSpecific, side, state.turnNumber ?? 1),
            { multipv: Math.max(need.length, cols), depth: sfDepth });
        } catch { pv = null; }
      }
      const cpByIdx = new Map();
      if (pv && pv.length) {
        for (const { move, cp } of pv) {
          const a = uciToAction(move, actions);
          if (a) { const i = actions.indexOf(a); if (i >= 0) cpByIdx.set(i, cp); }
        }
      }
      for (const i of need) {
        out[i] = cpByIdx.has(i) ? clip(cpByIdx.get(i)) : clip(evaluate(childStates[i].board, mover));
      }
    }
    return out;
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
  _leafEval(observation) {
    const t = difficultyToNumber(observation.gameSpecific?.difficulty) / 100;
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

  let worlds = fog ? game.sampleWorlds(state, me, opts.particles ?? 8, rng) : null;
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
  });

  const k = game.actionKey;
  const action = legalActions.find(a => k(a) === k(res.action)) ?? res.action ?? legalActions[0];
  return { mode: fog ? 'cfr' : 'minimax', action, dist: res.dist, rows: res.rows, value: res.value, particles: worlds.length };
}

// Shared with the onRound progress callback above so a mid-search snapshot and
// the final result are ranked identically.
function rankCandidates(rows, dist) {
  return (rows ?? [])
    .map((action, i) => ({ move: action, prob: dist?.[i] ?? 0 }))
    .sort((a, b) => b.prob - a.prob);
}

// ---------------------------------------------------------------------------
// Read-only position analysis for the UI's "suggest a move" panel: runs the
// exact same solve as obscuroStrategy (fog-aware via sampleWorlds/belief when
// applicable, perfect-info minimax otherwise) and reshapes its output into
// ranked candidates, without ever selecting/committing a move for real play.
// ---------------------------------------------------------------------------
export async function analyzeObscuro(state, legalActions, opts = {}) {
  if (!legalActions?.length) return { engine: 'obscuro', mode: 'none', candidates: [] };
  const r = await obscuroStrategy(state, legalActions, opts);
  const candidates = rankCandidates(r.rows, r.dist);
  return { engine: 'obscuro', mode: r.mode, value: r.value, candidates };
}
