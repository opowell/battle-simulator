// What cs lends the battle-simulator core's library: its units in the common
// vocabulary (the core's scripts/export-pack.mjs and src/engine/foreignUnits.js).
// The game itself fields only its own units, so nothing here is read in play.
//
// The conversion factor is the rifleman: 100 hp, an M4A4 (33 a hit, 9 squares),
// walking at a rifle's pace. Kevlar is bought, not brought, so a player has no
// defense of its own (`fold`): it reads as the standard.
import { WEAPONS } from './weapons.js';
import { KIND_WEAPON, WEAPON_ICON, WEAPON_SLOT, MOVE_RANGE, SLOT_MOVE_MULT } from './CsGame.js';

export const pack = {
  scale: { hp: 100, attack: WEAPONS.m4a4.damage, defense: 1, range: WEAPONS.m4a4.range, move: MOVE_RANGE * SLOT_MOVE_MULT.primary },
  fold: { defense: 'hp' },
  profiles: () => Object.fromEntries(Object.entries(KIND_WEAPON).map(([kind, w]) => [kind, {
    hp: 100, attack: WEAPONS[w].damage, range: WEAPONS[w].range, move: MOVE_RANGE * SLOT_MOVE_MULT[WEAPON_SLOT(kind)], domain: 'land',
  }])),
  art: (kind) => ({ imagePath: KIND_WEAPON[kind] ? WEAPON_ICON(KIND_WEAPON[kind]) : null, glyph: 'P', name: `${kind} player` }),
};
