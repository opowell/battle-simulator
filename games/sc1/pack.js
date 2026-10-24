// What SC1 lends the battle-simulator core's library: its units in the common
// vocabulary (the core's scripts/export-pack.mjs and src/engine/foreignUnits.js).
// The game itself fields only its own units, so nothing here is read in play.
//
// The conversion factor is the marine: 40 hp, 6 damage, range 4, 2 moves. Shields
// count as hp, and armour is read one higher than it is, so a marine's 0 is one
// point of defence rather than none and scales like every other stat.
import { tableUnits } from '#core/engine/foreignUnits.js';
import { UNITS } from './units.js';
import { UNIT_SPRITES } from './Sc1Game.js';

export const pack = tableUnits({
  table: UNITS,
  scale: { hp: 40, attack: 6, defense: 1, range: 4, move: 2 },
  read: (e) => ({
    hp: e.hp + (e.shields ?? 0), attack: e.attack, defense: (e.armor ?? 0) + 1, range: e.range, move: e.moves,
    domain: e.domain === 'air' ? 'air' : 'land',
  }),
  art: (type) => ({ imagePath: UNIT_SPRITES.has(type) ? `/images/sc1/units/${type}` : null, glyph: type[0].toUpperCase(), name: type }),
});
