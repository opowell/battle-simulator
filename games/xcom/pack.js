// What X-Com lends the battle-simulator core's library: its units in the common
// vocabulary (the core's scripts/export-pack.mjs and src/engine/foreignUnits.js).
// The game itself fields only its own units, so nothing here is read in play.
//
// The conversion factor is the rookie soldier: 8 hp, 4 damage a hit (its 3–5 roll),
// 3 moves. X-Com has no armour, so no unit has a defense of its own (`fold`). Nor
// a range: anything in sight can be shot at, the odds falling 4 points a square —
// its reading is how far it shoots before those odds have halved (a sniper's
// fall only 1).
import { meanOf } from '#core/engine/foreignUnits.js';
import { UNIT_DEFS } from './units.js';

export const pack = {
  scale: { hp: 8, attack: 4, defense: 1, range: 75 / 8, move: 3 },
  fold: { defense: 'hp' },
  profiles: () => Object.fromEntries(Object.entries(UNIT_DEFS).map(([type, d]) => (
    [type, { hp: d.maxHP, attack: meanOf(d.damage), range: d.aim / (2 * (type === 'sniper' ? 1 : 4)), move: d.moveRange, domain: 'land' }]))),
  art: (type) => ({ imagePath: `/images/xcom/${type}`, glyph: UNIT_DEFS[type]?.symbol, name: type }),
};
