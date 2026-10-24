// What Memoir '44 lends the battle-simulator core's library: its units in the
// common vocabulary (the core's scripts/export-pack.mjs and
// src/engine/foreignUnits.js). The game itself fields only its own units, so
// nothing here is read in play.
//
// The conversion factor is the infantry block: 4 figures, 3 dice at close range,
// reaching 3 hexes, moving 2. Its defense is how many die faces it shrugs off — a
// die kills infantry one time in two and armor one in three, so 2 and 3 — and
// that is all the rules know of it.
import { tableUnits } from '#core/engine/foreignUnits.js';
import { UNIT_TYPES } from './units.js';

export const pack = tableUnits({
  table: UNIT_TYPES,
  scale: { hp: 4, attack: 3, defense: 2, range: 3, move: 2 },
  read: (e) => ({
    hp: e.figures, attack: e.diceByRange[0], defense: e.kind === 'armor' ? 3 : 2,
    range: e.diceByRange.length, move: e.moveMax, domain: 'land',
  }),
  art: (type) => ({ glyph: UNIT_TYPES[type]?.glyph, name: UNIT_TYPES[type]?.name ?? type }),
});
