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

import { ObscuroAgent as GenericObscuroAgent } from '../../agents/ObscuroAgent.js';
import { makeHooks, runObscuroSearch } from '../../agents/obscuro/search.js';
import { isAttackedBy } from './board.js';
import { evaluate } from './ChessAgent.js';
import { toFEN, uciToAction } from './fen.js';
import {
  multiPV, stockfishBestAction, sfOptsForDifficulty, difficultyToNumber,
  available as stockfishAvailable,
} from './stockfish.js';

// Per-leaf scores are clamped so an imagined king capture from phantom hidden
// pieces can't swamp a concrete material decision.
const LEAF_CLAMP = 1500;
const clip = v => (v > LEAF_CLAMP ? LEAF_CLAMP : v < -LEAF_CLAMP ? -LEAF_CLAMP : v);

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
      if (!k || isAttackedBy(board, k, them)) { out[i] = -LEAF_CLAMP; continue; } // hung king → loss
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

  // Chess's batched Stockfish node heuristic, its depth/width scaled by the dial.
  _leafEval(observation) {
    const t = difficultyToNumber(observation.gameSpecific?.difficulty) / 100;
    const sfDepth = Math.max(1, Math.round(1 + t * 7)); // 1..8
    const cols = Math.round(4 + t * 8);                 // 4..12
    return makeChessLeafEval(sfDepth, cols);
  }

  async chooseAction(state, legalActions) {
    if (!legalActions?.length) return null;
    if (legalActions.length === 1) return legalActions[0];
    await this._game();

    const gs = state.gameSpecific;
    // Perfect information (fog off): play Stockfish's best move directly, scaled
    // by difficulty. Difficulty 0 falls through to the generic random branch.
    if (!gs.fogOfWar && gs.difficulty !== 0) {
      const sf = await stockfishBestAction(state, legalActions, sfOptsForDifficulty(gs.difficulty));
      if (sf) return this._matchLegal(sf, legalActions) ?? sf;
    }
    return super.chooseAction(state, legalActions);
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
  const me = state.activePlayers[0];
  const game = (await import('./ChessGame.js')).ChessGame;
  const fog = !!state.gameSpecific.fogOfWar;

  let worlds = fog ? game.sampleWorlds(state, me, opts.particles ?? 8, rng) : null;
  if (!worlds || worlds.length === 0) worlds = [state];

  const hooks = makeHooks(game, me, { rng });
  const opp = (state.players ?? []).find(p => p.id !== me)?.id ?? null;
  const res = await runObscuroSearch(hooks, worlds, {
    opp, rootActions: legalActions, rng,
    timeBudgetMs: opts.timeBudgetMs ?? 0,
    maxRounds: opts.maxRounds ?? 30,
    expandPerRound: opts.expandPerRound ?? 8,
    cfrPerRound: opts.cfrPerRound ?? 4,
    purifyMax: opts.purifyMax ?? 3,
  });

  const k = game.actionKey;
  const action = legalActions.find(a => k(a) === k(res.action)) ?? res.action ?? legalActions[0];
  return { mode: fog ? 'cfr' : 'minimax', action, dist: res.dist, rows: res.rows, value: res.value, particles: worlds.length };
}
