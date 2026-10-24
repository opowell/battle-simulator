// What civ1 lends the battle-simulator core's library: its units in the common
// vocabulary (the core's scripts/export-pack.mjs and src/engine/foreignUnits.js).
// The game itself fields only its own units, so nothing here is read in play.
//
// The conversion factor is an ancient line unit — 10 hp, attack and defence 2, one
// move. Every attack is made on the next square: a melee reach, which the common
// vocabulary counts as a quarter of a standard rifle's.
import { tableUnits } from '#core/engine/foreignUnits.js';
import { UNITS } from './units.js';

const BASE = '/images/civ1';

export const pack = tableUnits({
  table: UNITS,
  scale: { hp: 10, attack: 2, defense: 2, range: 4, move: 1 },
  read: (e) => ({ hp: e.hp, attack: e.attack, defense: e.defense, range: 1, move: e.moves, domain: e.domain }),
  art: (type) => ({ imagePath: `${BASE}/units/${type}`, glyph: type[0].toUpperCase(), name: type }),
});
