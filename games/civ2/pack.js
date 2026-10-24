// What Civ2 lends the battle-simulator core's library: its units in the common
// vocabulary (the core's scripts/export-pack.mjs and src/engine/foreignUnits.js).
// The game itself fields only its own units, so nothing here is read in play.
//
// Read as civ1's are: an ancient line unit is one point of each stat, every
// attack is melee.
import { tableUnits } from '#core/engine/foreignUnits.js';
import { UNITS } from './units.js';
import { assets } from './assets/index.js';

export const pack = tableUnits({
  table: UNITS,
  scale: { hp: 10, attack: 2, defense: 2, range: 4, move: 1 },
  read: (e) => ({ hp: e.hp, attack: e.attack, defense: e.defense, range: 1, move: e.moves, domain: e.domain }),
  art: (type) => ({ imagePath: assets.units?.[type]?.img ?? null, glyph: type[0].toUpperCase(), name: type }),
});
