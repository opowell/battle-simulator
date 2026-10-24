// What Risk lends the battle-simulator core's library: its pieces in the common
// vocabulary (the core's scripts/export-pack.mjs and src/engine/foreignUnits.js).
// The game itself fields only its own armies, so nothing here is read in play.
//
// The conversion factor is one army. An army has no punch or guard of its own —
// every army rolls the same die — so a piece is as strong as the armies it is
// worth. A battle is between neighbours, and a turn's move one border.
import { PIECES } from './RiskGame.js';

export const pack = {
  scale: { hp: 1, attack: 1, defense: 1, range: 1, move: 1 },
  profiles: () => Object.fromEntries(Object.entries(PIECES).map(([type, n]) => [type, {
    hp: n, attack: 1, defense: 1, range: 1, move: 1, domain: 'land',
  }])),
  art: (type) => ({ glyph: type[0].toUpperCase(), name: type }),
};
