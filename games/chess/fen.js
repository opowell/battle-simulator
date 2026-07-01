// ---------------------------------------------------------------------------
// FEN <-> internal representation helpers, used to talk to Stockfish over UCI.
// ---------------------------------------------------------------------------

const LETTER = { king: 'k', queen: 'q', rook: 'r', bishop: 'b', knight: 'n', pawn: 'p' };
const PROMO = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' };

/**
 * Convert an internal board + game-state to a FEN string.
 * @param {object} board            square -> piece ({ ownerId, type })
 * @param {object} gs               gameSpecific (castlingRights, enPassantTarget, halfMoveClock)
 * @param {'w'|'b'} sideToMove
 * @param {number} [fullmove=1]     full-move counter (cosmetic for search)
 */
export function toFEN(board, gs, sideToMove = 'w', fullmove = 1) {
  const rows = [];
  for (let rank = 8; rank >= 1; rank--) {
    let row = '';
    let empty = 0;
    for (const f of 'abcdefgh') {
      const p = board[f + rank];
      if (!p) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      const ch = LETTER[p.type] ?? 'p';
      row += p.ownerId === 'white' ? ch.toUpperCase() : ch;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  const cr = gs?.castlingRights;
  let castle = '';
  if (cr) {
    if (cr.white?.kingSide)  castle += 'K';
    if (cr.white?.queenSide) castle += 'Q';
    if (cr.black?.kingSide)  castle += 'k';
    if (cr.black?.queenSide) castle += 'q';
  }
  return `${rows.join('/')} ${sideToMove} ${castle || '-'} ${gs?.enPassantTarget || '-'} ${gs?.halfMoveClock ?? 0} ${fullmove}`;
}

/**
 * Map a UCI move string (e.g. "e2e4", "e7e8q", "e1g1" for castling) to the
 * matching action from a list of legal actions, or null if none matches.
 */
export function uciToAction(uci, legalActions) {
  if (!uci || uci.length < 4) return null;
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promo = uci[4] ? PROMO[uci[4].toLowerCase()] : null;
  return (
    legalActions.find(a => a.from === from && a.to === to &&
      (promo ? a.payload?.promote === promo : !a.payload?.promote)) ??
    legalActions.find(a => a.from === from && a.to === to) ??
    null
  );
}
