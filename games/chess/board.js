export const FILES = 'abcdefgh';

export function fileOf(sq) { return sq[0]; }
export function rankOf(sq) { return parseInt(sq[1], 10); }
export function fileIndex(sq) { return FILES.indexOf(sq[0]); }

/** Convert 0-based file index + rank (1–8) → algebraic square, or null if off-board. */
export function squareAt(fi, rank) {
  if (fi < 0 || fi > 7 || rank < 1 || rank > 8) return null;
  return FILES[fi] + rank;
}

/** Starting square for a rook given color and side. */
export function rookStartSquare(color, side) {
  const rank = color === 'white' ? 1 : 8;
  return (side === 'queenside' ? 'a' : 'h') + rank;
}

/** King starting square for a color. */
export function kingStartSquare(color) {
  return color === 'white' ? 'e1' : 'e8';
}

/**
 * Return true if any piece of `byColor` attacks `square`.
 * Uses ray-casting from the target square backward — no need to iterate all pieces.
 * @param {object} board
 * @param {string} square
 * @param {string} byColor  'white' | 'black'
 */
export function isAttackedBy(board, square, byColor) {
  const fi = fileIndex(square);
  const r = rankOf(square);

  // Pawns attack diagonally: a white pawn at (fi±1, r-1) attacks (fi, r).
  const pawnRankOffset = byColor === 'white' ? -1 : 1;
  for (const dfi of [-1, 1]) {
    const sq = squareAt(fi + dfi, r + pawnRankOffset);
    if (sq) {
      const p = board[sq];
      if (p && p.ownerId === byColor && p.type === 'pawn') return true;
    }
  }

  // Knights
  for (const [dfi, dr] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
    const sq = squareAt(fi + dfi, r + dr);
    if (sq) {
      const p = board[sq];
      if (p && p.ownerId === byColor && p.type === 'knight') return true;
    }
  }

  // Rooks / queens (rank & file rays)
  for (const [dfi, dr] of [[0,1],[0,-1],[1,0],[-1,0]]) {
    let cfi = fi, cr = r;
    while (true) {
      cfi += dfi; cr += dr;
      const sq = squareAt(cfi, cr);
      if (!sq) break;
      const p = board[sq];
      if (p) {
        if (p.ownerId === byColor && (p.type === 'rook' || p.type === 'queen')) return true;
        break;
      }
    }
  }

  // Bishops / queens (diagonal rays)
  for (const [dfi, dr] of [[1,1],[1,-1],[-1,1],[-1,-1]]) {
    let cfi = fi, cr = r;
    while (true) {
      cfi += dfi; cr += dr;
      const sq = squareAt(cfi, cr);
      if (!sq) break;
      const p = board[sq];
      if (p) {
        if (p.ownerId === byColor && (p.type === 'bishop' || p.type === 'queen')) return true;
        break;
      }
    }
  }

  // King
  for (const [dfi, dr] of [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]]) {
    const sq = squareAt(fi + dfi, r + dr);
    if (sq) {
      const p = board[sq];
      if (p && p.ownerId === byColor && p.type === 'king') return true;
    }
  }

  return false;
}

/** Return true if the king of `color` is in check on `board`. */
export function isKingInCheck(board, color) {
  const kingSq = Object.keys(board).find(sq => {
    const p = board[sq];
    return p && p.ownerId === color && p.type === 'king';
  });
  if (!kingSq) return false;
  const opp = color === 'white' ? 'black' : 'white';
  return isAttackedBy(board, kingSq, opp);
}

/**
 * Apply a chess action to a board object, returning a new board.
 * Used for check detection only — does not update state.units or gameSpecific.
 */
export function applyMoveToBoard(board, action) {
  const next = { ...board };

  if (action.type === 'castle') {
    const king = board[action.from];
    next[action.from] = undefined;
    next[action.to] = { ...king, position: action.to };
    const rook = board[action.rookFrom];
    next[action.rookFrom] = undefined;
    next[action.rookTo] = { ...rook, position: action.rookTo };
    return next;
  }

  const piece = board[action.from];
  next[action.from] = undefined;
  const newType = action.payload?.promote ?? piece.type;
  next[action.to] = { ...piece, position: action.to, type: newType };

  if (action.isEnPassant && action.capturedSquare) {
    next[action.capturedSquare] = undefined;
  }

  return next;
}

/**
 * Render the board as an ASCII diagram.
 * @param {object} board
 * @returns {string}
 */
export function renderBoard(board) {
  const SYMBOLS = {
    white: { king:'K', queen:'Q', rook:'R', bishop:'B', knight:'N', pawn:'P' },
    black: { king:'k', queen:'q', rook:'r', bishop:'b', knight:'n', pawn:'p' },
  };
  const rows = [];
  rows.push('  a b c d e f g h');
  for (let rank = 8; rank >= 1; rank--) {
    let row = rank + ' ';
    for (const file of FILES) {
      const sq = file + rank;
      const p = board[sq];
      row += p ? SYMBOLS[p.ownerId][p.type] : '.';
      row += ' ';
    }
    rows.push(row.trimEnd());
  }
  rows.push('  a b c d e f g h');
  return rows.join('\n');
}
