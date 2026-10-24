// What KDice lends the battle-simulator core's library: its die in the common
// vocabulary (the core's scripts/export-pack.mjs and src/engine/foreignUnits.js).
// The game itself fields only its own dice, so nothing here is read in play.
//
// The conversion factor is one die. A die has no punch or guard of its own —
// every die rolls the same. A battle is between neighbours, and so is a move.
export const pack = {
  scale: { hp: 1, attack: 1, defense: 1, range: 1, move: 1 },
  profiles: () => ({ die: { hp: 1, attack: 1, defense: 1, range: 1, move: 1, domain: 'land' } }),
  art: () => ({ glyph: '⚀', name: 'die' }),
};
