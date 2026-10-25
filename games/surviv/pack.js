// What surviv lends the battle-simulator core's library: its units in the common
// vocabulary (the core's scripts/export-pack.mjs and src/engine/foreignUnits.js).
// The game itself fields only its own units, so nothing here is read in play.
//
// The conversion factor is the rifleman (the FAMAS: 24 a hit, 8 squares) with his 100
// hp and 4 squares a turn. Vests and helmets come off the ground, not with a unit,
// so a player has no defense of its own (`fold`): it reads as the standard.
import { WEAPONS, STARTING_HP, MOVE_RANGE } from './weapons.js';
import { KIND_WEAPON, WEAPON_ICON } from './SurvivGame.js';

export const pack = {
  scale: { hp: STARTING_HP, attack: WEAPONS.famas.damage, defense: 1, range: WEAPONS.famas.range, move: MOVE_RANGE },
  fold: { defense: 'hp' },
  profiles: () => Object.fromEntries(Object.entries(KIND_WEAPON).map(([kind, w]) => [kind, {
    hp: STARTING_HP, attack: WEAPONS[w].damage, range: WEAPONS[w].range, move: MOVE_RANGE, domain: 'land',
  }])),
  art: (kind) => ({
    imagePath: KIND_WEAPON[kind] && KIND_WEAPON[kind] !== 'fists' ? WEAPON_ICON(KIND_WEAPON[kind]) : null,
    glyph: 'P', name: `${kind} player`,
  }),
};
