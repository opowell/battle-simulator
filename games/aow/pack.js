// What The Ancient Art of War lends the battle-simulator core's library: its units
// in the common vocabulary (the core's scripts/export-pack.mjs and
// src/engine/foreignUnits.js). The game itself fields only its own units, so
// nothing here is read in play.
//
// A squad is the piece that marches and fights, so it is what this game lends
// out: ten men of one kind. Its hp is its men, its attack each man's power, its
// move his marching pace; a fight is a brawl at contact (range 1). The conversion
// factor is a squad of ten archers; nobody wears armour, so a squad has no
// defense of its own (`fold`).
import { tableUnits } from '#core/engine/foreignUnits.js';
import { UNITS } from './units.js';
import { SQUAD_SIZE } from './AowGame.js';

export const pack = {
  ...tableUnits({
    table: UNITS,
    scale: { hp: SQUAD_SIZE, attack: UNITS.archer.power, defense: 1, range: 1, move: UNITS.archer.speed },
    read: (e) => ({ hp: SQUAD_SIZE, attack: e.power, range: 1, move: e.speed, domain: 'land' }),
    art: (type) => ({ glyph: UNITS[type]?.symbol, name: UNITS[type]?.name ?? type }),
  }),
  fold: { defense: 'hp' },
};
