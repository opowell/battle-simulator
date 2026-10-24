// What War of Dots lends the battle-simulator core's library: its units in the
// common vocabulary (the core's scripts/export-pack.mjs and
// src/engine/foreignUnits.js). The game itself fields only its own units, so
// nothing here is read in play.
//
// The conversion factor is the light infantryman: 60 hp, 5.4 damage a second (6 a
// blow, 0.9 blows a second), reaching 38 px, marching 75 px a second. Nobody
// wears armour — only terrain covers — so its units have no defense of their own
// (`fold`): they read as the standard.
import { tableUnits } from '#core/engine/foreignUnits.js';
import { UNIT_DEF, kindOf } from './WarodDotsGame.js';

export const pack = {
  ...tableUnits({
    table: UNIT_DEF,
    scale: { hp: 60, attack: 5.4, defense: 1, range: 38, move: 75 },
    read: (e) => ({ hp: e.hp, attack: e.dmg * e.atkRate, range: e.range, move: e.speed, domain: 'land' }),
    art: (type) => ({ glyph: kindOf(type) === 'heavy' ? 'H' : 'L', name: kindOf(type) === 'heavy' ? 'Heavy Infantry' : 'Light Infantry' }),
  }),
  fold: { defense: 'hp' },
};
