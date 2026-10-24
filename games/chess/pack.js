// What chess lends the battle-simulator core's library: its pieces in the common
// vocabulary (the core's scripts/export-pack.mjs and src/engine/foreignUnits.js).
// The game itself fields only its own pieces, so nothing here is read in play.
//
// Chess has no stats, so a piece is read by its material value: a pawn is the
// standard infantryman, and a piece worth v pawns is √v times as tough and as
// hard-hitting — √v·√v = v times the fighting power, the way two armies'
// strengths compare (Lanchester's square law). The long-range pieces move three,
// the knight two, pawn and king one. Every capture is made by moving onto the
// piece: a melee reach, which the common vocabulary counts as a quarter of a
// standard rifle's.
const LETTER = { pawn: 'P', knight: 'N', bishop: 'B', rook: 'R', queen: 'Q', king: 'K' };

export const pack = {
  scale: { hp: 1, attack: 1, defense: 1, range: 4, move: 1 },
  profiles: () => {
    const piece = (value, move) => ({ hp: Math.sqrt(value), attack: Math.sqrt(value), defense: Math.sqrt(value), range: 1, move, domain: 'land' });
    return { pawn: piece(1, 1), knight: piece(3, 2), bishop: piece(3, 3), rook: piece(5, 3), queen: piece(9, 3), king: piece(4, 1) };
  },
  art: (type, seat = 0) => ({ imagePath: `/images/chess/${seat % 2 ? 'b' : 'w'}${LETTER[type]}`, glyph: LETTER[type], name: type }),
};
