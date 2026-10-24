// What Mud and Blood 2 lends the battle-simulator core's library: its units in
// the common vocabulary (the core's scripts/export-pack.mjs and
// src/engine/foreignUnits.js). The game itself fields only its own units, so
// nothing here is read in play.
//
// The conversion factor is the rifleman: 8 hp, 4 damage a hit (its 3–5 roll),
// range 10, 2 moves; there is no armour, so no unit has a defense of its own
// (`fold`).
import { meanOf } from '#core/engine/foreignUnits.js';
import { UNIT_DEFS } from './units.js';

export const pack = {
  scale: { hp: 8, attack: 4, defense: 1, range: 10, move: 2 },
  fold: { defense: 'hp' },
  profiles: () => Object.fromEntries(Object.entries(UNIT_DEFS).map(([type, d]) => [type, {
    hp: d.maxHP, attack: meanOf(d.damage), range: d.maxRange, move: d.moveRange, domain: 'land',
  }])),
  art: (type) => ({ imagePath: `/images/mudandblood/units/${type}`, glyph: UNIT_DEFS[type]?.symbol, name: type }),
};
