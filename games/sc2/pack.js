// What SC2 lends the battle-simulator core's library: its units in the common
// vocabulary (the core's scripts/export-pack.mjs and src/engine/foreignUnits.js).
// The game itself fields only its own units, so nothing here is read in play.
//
// Read as SC1's are: the marine (45 hp here, 6 damage, range 4, 2 moves) is one
// point of each stat, shields count as hp, armour is read one higher than it is.
import { tableUnits } from '#core/engine/foreignUnits.js';
import { UNITS } from './units.js';
import { UNIT_PORTRAITS } from './Sc2Game.js';

export const pack = tableUnits({
  table: UNITS,
  scale: { hp: 45, attack: 6, defense: 1, range: 4, move: 2 },
  read: (e) => ({
    hp: e.hp + (e.shields ?? 0), attack: e.attack, defense: (e.armor ?? 0) + 1, range: e.range, move: e.moves,
    domain: e.domain === 'air' ? 'air' : 'land',
  }),
  art: (type) => ({ imagePath: UNIT_PORTRAITS.has(type) ? `/images/sc2/units/${type}` : null, glyph: type[0].toUpperCase(), name: type }),
});
