// What Combat Mission lends the battle-simulator core's library: its units in the
// common vocabulary (the core's scripts/export-pack.mjs and src/engine/foreignUnits.js).
// The game itself fields only its own units, so nothing here is read in play.
//
// The conversion factor is the rifle squad: 10 hp, 5 attack, range 5, 2 moves; armour
// is read one higher than it is, so a squad's 0 is one point of defence and a
// Tiger's 7 is eight.
import { tableUnits } from '#core/engine/foreignUnits.js';
import { UNIT_DEFS } from './units.js';
import { UNIT_PORTRAITS } from './CombatMissionGame.js';

export const pack = tableUnits({
  table: UNIT_DEFS,
  scale: { hp: 10, attack: 5, defense: 1, range: 5, move: 2 },
  read: (e) => ({ hp: e.hp, attack: e.attack, defense: (e.armor ?? 0) + 1, range: e.range, move: e.moveRange, domain: 'land' }),
  art: (type) => ({
    imagePath: UNIT_PORTRAITS.has(type) ? `/images/combatmission/units/${type}` : null,
    glyph: UNIT_DEFS[type]?.symbol, name: UNIT_DEFS[type]?.label ?? type,
  }),
});
