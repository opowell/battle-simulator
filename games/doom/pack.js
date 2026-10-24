// What Doom lends the battle-simulator core's library: its units in the common
// vocabulary (the core's scripts/export-pack.mjs and src/engine/foreignUnits.js).
// The game itself fields only its own units, so nothing here is read in play.
//
// The conversion factor is the zombieman: 20 hp, 7.5 damage a shot, range 6, 6 tiles
// of AP a turn; there is no armour to read (only the marine wears any, and only
// what it picks up), so no unit has a defense of its own (`fold`). A shot's
// damage is every pellet of it.
import { meanOf } from '#core/engine/foreignUnits.js';
import { WEAPONS } from './weapons.js';
import { MONSTER_DEFS } from './units.js';
import { UNIT_PORTRAITS } from './DoomGame.js';

export const pack = {
  scale: { hp: 20, attack: 7.5, defense: 1, range: 6, move: 6 },
  fold: { defense: 'hp' },
  profiles: () => ({
    doomguy: { hp: 100, attack: meanOf(WEAPONS.shotgun.damage) * WEAPONS.shotgun.pellets, range: WEAPONS.shotgun.range, move: 8, domain: 'land' },
    ...Object.fromEntries(Object.entries(MONSTER_DEFS).map(([type, d]) => [type, {
      hp: d.hp, attack: meanOf(d.damage) * d.pellets, range: d.range, move: d.maxAP, domain: 'land',
    }])),
  }),
  art: (type) => ({ imagePath: UNIT_PORTRAITS.has(type) ? `/images/doom/units/${type}` : null, glyph: type === 'doomguy' ? '@' : MONSTER_DEFS[type]?.symbol, name: type }),
};
