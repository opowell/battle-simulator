import { getAllLegalMoves, getAllFogMoves } from './moves.js';
import { applyMoveToBoard, isKingInCheck, fileIndex, rankOf, getVisibleSquares } from './board.js';

const PIECE_VALUE = { pawn: 100, knight: 320, bishop: 330, rook: 500, queen: 900, king: 20000 };

// Piece-square tables: index 0 = rank 8 file a, index 63 = rank 1 file h.
// All tables written from the moving side's perspective (mirrored for black).
const PST = {
  pawn: [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0,
  ],
  knight: [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50,
  ],
  bishop: [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20,
  ],
  rook: [
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0,
  ],
  queen: [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20,
  ],
  king: [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0,  0, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20,
  ],
};

function pstIndex(sq, color) {
  const fi = fileIndex(sq);
  const r  = rankOf(sq);
  return color === 'white' ? (8 - r) * 8 + fi : (r - 1) * 8 + fi;
}

function pieceScore(p) {
  const table = PST[p.type];
  return PIECE_VALUE[p.type] + (table ? table[pstIndex(p.position, p.ownerId)] : 0);
}

// Standard evaluation: sum of (material + PST) relative to aiColor
function evaluate(board, aiColor) {
  let score = 0;
  for (const sq of Object.keys(board)) {
    const p = board[sq];
    if (!p) continue;
    const s = pieceScore(p);
    score += p.ownerId === aiColor ? s : -s;
  }
  return score;
}

// Fog evaluation: known material + visibility bonus (reward information advantage)
function fogEvaluate(board, aiColor) {
  let score = 0;
  for (const sq of Object.keys(board)) {
    const p = board[sq];
    if (!p) continue;
    const s = pieceScore(p);
    score += p.ownerId === aiColor ? s : -s;
  }
  score += getVisibleSquares(board, aiColor).size * 3;
  return score;
}

// Propagate castling rights and en-passant across a search ply
function advanceGs(gs, board, action, color) {
  let { castlingRights, halfMoveClock } = gs;
  let enPassantTarget = null;

  if (action.type === 'castle') {
    castlingRights = { ...castlingRights, [color]: { kingSide: false, queenSide: false } };
    halfMoveClock++;
  } else {
    const piece = board[action.from];
    halfMoveClock = (piece?.type === 'pawn' || action.isCapture) ? 0 : halfMoveClock + 1;

    if (action.isDoublePush) {
      const fi = fileIndex(action.from);
      const r  = rankOf(action.from);
      enPassantTarget = 'abcdefgh'[fi] + (r + (color === 'white' ? 1 : -1));
    }

    if (piece?.type === 'king') {
      castlingRights = { ...castlingRights, [color]: { kingSide: false, queenSide: false } };
    } else if (piece?.type === 'rook') {
      const rank = color === 'white' ? 1 : 8;
      const cr = { ...castlingRights[color] };
      if (action.from === 'a' + rank) cr.queenSide = false;
      if (action.from === 'h' + rank) cr.kingSide  = false;
      castlingRights = { ...castlingRights, [color]: cr };
    }

    if (action.isCapture) {
      const captured = board[action.to];
      if (captured?.type === 'rook') {
        const opp  = captured.ownerId;
        const rank = opp === 'white' ? 1 : 8;
        const cr   = { ...castlingRights[opp] };
        if (action.to === 'a' + rank) cr.queenSide = false;
        if (action.to === 'h' + rank) cr.kingSide  = false;
        castlingRights = { ...castlingRights, [opp]: cr };
      }
    }
  }

  return { ...gs, enPassantTarget, castlingRights, halfMoveClock, inCheck: false };
}

// MVV-LVA move ordering: captures first (big victim, small attacker), then promotions
function moveScore(m, board) {
  let s = 0;
  if (m.isCapture) {
    const victim   = board[m.to];
    const attacker = board[m.from];
    s += (PIECE_VALUE[victim?.type] ?? 0) - (PIECE_VALUE[attacker?.type] ?? 0) * 0.1;
  }
  if (m.payload?.promote === 'queen') s += 800;
  return s;
}

function orderMoves(moves, board) {
  return [...moves].sort((a, b) => moveScore(b, board) - moveScore(a, board));
}

// ---------------------------------------------------------------------------
// Standard minimax with alpha-beta pruning
// ---------------------------------------------------------------------------

const STANDARD_DEPTH = 4;

function alphaBeta(board, gs, color, aiColor, depth, alpha, beta) {
  if (depth === 0) return evaluate(board, aiColor);

  const opp   = color === 'white' ? 'black' : 'white';
  const moves = getAllLegalMoves(board, color, gs);

  if (moves.length === 0) {
    if (isKingInCheck(board, color)) {
      // Checkmate — prefer mates delivered sooner (higher depth remaining = fewer moves away)
      return color === aiColor ? -19000 - depth : 19000 + depth;
    }
    return 0; // stalemate
  }

  const sorted = orderMoves(moves, board);

  if (color === aiColor) {
    let best = -Infinity;
    for (const m of sorted) {
      const score = alphaBeta(applyMoveToBoard(board, m), advanceGs(gs, board, m, color), opp, aiColor, depth - 1, alpha, beta);
      if (score > best) { best = score; if (best > alpha) alpha = best; }
      if (alpha >= beta) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const m of sorted) {
      const score = alphaBeta(applyMoveToBoard(board, m), advanceGs(gs, board, m, color), opp, aiColor, depth - 1, alpha, beta);
      if (score < best) { best = score; if (best < beta) beta = best; }
      if (alpha >= beta) break;
    }
    return best;
  }
}

function standardSearch(board, gs, color, legalActions) {
  const opp    = color === 'white' ? 'black' : 'white';
  const sorted = orderMoves(legalActions, board);
  let bestScore = -Infinity;
  let bestMove  = sorted[0];

  for (const m of sorted) {
    const score = alphaBeta(applyMoveToBoard(board, m), advanceGs(gs, board, m, color), opp, color, STANDARD_DEPTH - 1, -Infinity, Infinity);
    if (score > bestScore) { bestScore = score; bestMove = m; }
  }
  return bestMove;
}

// ---------------------------------------------------------------------------
// Fog-of-war minimax
//
// The board received by the agent already has invisible enemy pieces removed.
// We search using fog (pseudo-legal) moves for both sides. Our reasoning about
// the opponent is limited to what we can currently see — hidden threats are
// implicitly handled by the visibility bonus in fogEvaluate.
// ---------------------------------------------------------------------------

const FOG_DEPTH = 3;

function fogAlphaBeta(board, gs, color, aiColor, depth, alpha, beta) {
  // In fog mode the king can be captured — detect win/loss
  let hasAiKing = false, hasOppKing = false;
  for (const sq of Object.keys(board)) {
    const p = board[sq];
    if (!p || p.type !== 'king') continue;
    if (p.ownerId === aiColor) hasAiKing = true; else hasOppKing = true;
  }
  if (!hasAiKing)  return -20000;
  if (!hasOppKing) return  20000;

  if (depth === 0) return fogEvaluate(board, aiColor);

  const opp   = color === 'white' ? 'black' : 'white';
  const moves = getAllFogMoves(board, color, gs);
  if (moves.length === 0) return color === aiColor ? -5000 : 5000;

  const sorted = orderMoves(moves, board);

  if (color === aiColor) {
    let best = -Infinity;
    for (const m of sorted) {
      const score = fogAlphaBeta(applyMoveToBoard(board, m), advanceGs(gs, board, m, color), opp, aiColor, depth - 1, alpha, beta);
      if (score > best) { best = score; if (best > alpha) alpha = best; }
      if (alpha >= beta) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const m of sorted) {
      const score = fogAlphaBeta(applyMoveToBoard(board, m), advanceGs(gs, board, m, color), opp, aiColor, depth - 1, alpha, beta);
      if (score < best) { best = score; if (best < beta) beta = best; }
      if (alpha >= beta) break;
    }
    return best;
  }
}

// Map a fog move (from the visible board) to the nearest valid full-board legal action.
// Handles the case where a sliding piece intends to move past a hidden blocking piece.
function resolveToFullAction(fogMove, fullLegalActions) {
  if (!fogMove) return fullLegalActions[0];
  // Direct match by from+to (captures of visible pieces, non-sliding moves, etc.)
  const exact = fullLegalActions.find(a => a.from === fogMove.from && a.to === fogMove.to);
  if (exact) return exact;

  // Castling with no exact match — shouldn't happen but fall through to random
  if (fogMove.type === 'castle') return fullLegalActions[0];

  // Sliding piece overshot a hidden blocker: find farthest reachable square in same direction
  if (fogMove.from && fogMove.to) {
    const fromFi = fileIndex(fogMove.from);
    const fromR  = rankOf(fogMove.from);
    const dfi    = Math.sign(fileIndex(fogMove.to) - fromFi);
    const dr     = Math.sign(rankOf(fogMove.to)    - fromR);

    const candidates = fullLegalActions.filter(a => {
      if (!a.from || !a.to || a.from !== fogMove.from) return false;
      return Math.sign(fileIndex(a.to) - fromFi) === dfi &&
             Math.sign(rankOf(a.to)    - fromR)  === dr;
    });

    if (candidates.length > 0) {
      return candidates.reduce((best, a) => {
        const d = Math.max(Math.abs(fileIndex(a.to) - fromFi), Math.abs(rankOf(a.to) - fromR));
        const bd = Math.max(Math.abs(fileIndex(best.to) - fromFi), Math.abs(rankOf(best.to) - fromR));
        return d > bd ? a : best;
      });
    }
  }

  return fullLegalActions[0];
}

function fogSearch(board, gs, color, fullLegalActions) {
  const opp = color === 'white' ? 'black' : 'white';

  // Generate candidate moves from the VISIBLE board so the AI only considers moves
  // it can actually see — hidden blocking pieces don't restrict the choice set.
  const fogMoves  = getAllFogMoves(board, color, gs);
  const sorted    = orderMoves(fogMoves, board);
  let bestScore   = -Infinity;
  let bestFogMove = sorted[0];

  for (const m of sorted) {
    const score = fogAlphaBeta(applyMoveToBoard(board, m), advanceGs(gs, board, m, color), opp, color, FOG_DEPTH - 1, -Infinity, Infinity);
    if (score > bestScore) { bestScore = score; bestFogMove = m; }
  }

  // The chosen fog move may target a square that a hidden piece is blocking in the real game.
  // Resolve it to the nearest valid full-board legal action before returning.
  return resolveToFullAction(bestFogMove, fullLegalActions);
}

// ---------------------------------------------------------------------------
// Agent export
// ---------------------------------------------------------------------------

export const ChessAgent = {
  id: 'chess-ai',
  name: 'Chess AI',

  async chooseAction(state, legalActions) {
    if (legalActions.length === 0) return null;
    if (legalActions.length === 1) return legalActions[0];

    // Yield to the event loop so the server can respond with the human's move
    // before the synchronous minimax search blocks the event loop.
    await new Promise(r => setImmediate(r));

    const color = state.activePlayers[0];
    const { board, gameSpecific } = state;

    return gameSpecific.fogOfWar
      ? fogSearch(board, gameSpecific, color, legalActions)
      : standardSearch(board, gameSpecific, color, legalActions);
  },
};
