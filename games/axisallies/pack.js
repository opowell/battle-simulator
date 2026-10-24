// What Axis & Allies lends the battle-simulator core's library: its units in the
// common vocabulary (the core's scripts/export-pack.mjs and
// src/engine/foreignUnits.js). The game itself fields only its own units, so
// nothing here is read in play.
//
// The conversion factor is the infantryman: 1 hp, attacking on a 1 and defending
// on a 2 (what a d6 must roll at or under to hit), 1 territory a turn. A battle is
// fought within one territory, so every unit's range is that territory.
import { tableUnits } from '#core/engine/foreignUnits.js';
import { UNITS } from './units.js';
import { UNIT_PORTRAITS } from './AxisAlliesGame.js';

export const pack = tableUnits({
  table: UNITS,
  scale: { hp: 1, attack: 1, defense: 2, range: 1, move: 1 },
  read: (e) => ({ hp: e.hp, attack: e.attack, defense: e.defense, range: 1, move: e.moves, domain: e.domain }),
  art: (type) => ({ imagePath: UNIT_PORTRAITS.has(type) ? `/images/axisallies/units/${type}` : null, glyph: type[0].toUpperCase(), name: type }),
});
