import { UNITS } from './units.js';
import { TERRAIN } from './terrain.js';

/**
 * Apply one attack from attacker to defender.
 * Returns { hit, shieldDmg, hpDmg, totalDmg, missed }
 *
 * Rules:
 * - Ranged attacker shooting UP to elevated tile: 30% miss chance
 * - Shields absorb damage first (no armor reduction vs shields)
 * - Remaining damage reduced by defender's armor (minimum 1)
 * - Siege mode (siege-tank): uses siegeAttack/siegeRange, applies splash
 * - Self-destruct (scourge): deals full attack, then attacker dies
 */
export function resolveAttack(attacker, defender, state, rng) {
  const atkStats = UNITS[attacker.type];

  // High-ground miss: ranged attacker on low ground shooting at elevated defender
  if (atkStats.range > 1) {
    const atkTile = state.board.tiles[`${attacker.position.x},${attacker.position.y}`];
    const defTile = state.board.tiles[`${defender.position.x},${defender.position.y}`];
    if (atkTile?.terrain !== 'elevated' && defTile?.terrain === 'elevated') {
      if (rng() < 0.30) return { hit: false, shieldDmg: 0, hpDmg: 0, totalDmg: 0, missed: true };
    }
  }

  // Determine base attack
  let baseAtk = atkStats.attack;
  if (attacker.type === 'siege-tank' && attacker.attrs?.sieged) {
    baseAtk = 70;
  }

  // Bonus vs air/ground (goliath, wraith)
  if (defender.domain === 'air') {
    if (atkStats.special.includes('bonus-air-20')) baseAtk += 20;
    if (atkStats.special.includes('anti-air'))     baseAtk = Math.max(baseAtk, 20);
  }
  if (defender.domain === 'ground') {
    if (atkStats.special.includes('bonus-ground-20')) baseAtk += 20;
  }

  // Scourge: only attacks air
  if (atkStats.special.includes('anti-air') && defender.domain !== 'air') {
    return { hit: false, shieldDmg: 0, hpDmg: 0, totalDmg: 0, missed: true };
  }

  const defStats = UNITS[defender.type];

  // Shields absorb damage first (no armor vs shields)
  let remaining = baseAtk;
  const shieldDmg = Math.min(remaining, defender.shields ?? 0);
  remaining -= shieldDmg;

  // HP damage with armor reduction
  const hpDmg = remaining > 0 ? Math.max(1, remaining - (defStats.armor ?? 0)) : 0;

  return { hit: true, shieldDmg, hpDmg, totalDmg: shieldDmg + hpDmg, missed: false };
}

/**
 * Apply attack result against a building.
 * Buildings don't have shields unless specified (Protoss photon cannon).
 */
export function resolveAttackVsBuilding(attacker, building, state, rng) {
  const atkStats = UNITS[attacker.type];

  // High-ground miss
  if (atkStats.range > 1) {
    const atkTile = state.board.tiles[`${attacker.position.x},${attacker.position.y}`];
    const defTile = state.board.tiles[`${building.position.x},${building.position.y}`];
    if (atkTile?.terrain !== 'elevated' && defTile?.terrain === 'elevated') {
      if (rng() < 0.30) return { hit: false, shieldDmg: 0, hpDmg: 0, totalDmg: 0, missed: true };
    }
  }

  let baseAtk = atkStats.attack;
  if (attacker.type === 'siege-tank' && attacker.attrs?.sieged) baseAtk = 70;

  const shieldDmg = Math.min(baseAtk, building.shields ?? 0);
  const remaining  = baseAtk - shieldDmg;
  const hpDmg = remaining > 0 ? Math.max(1, remaining) : 0;

  return { hit: true, shieldDmg, hpDmg, totalDmg: shieldDmg + hpDmg, missed: false };
}

/**
 * Chebyshev distance between two positions.
 */
export function chebyshev(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * Whether unit can attack a target at targetPos given its range.
 * Siege tanks in siege mode use range 8.
 */
export function inRange(unit, targetPos) {
  const stats = UNITS[unit.type];
  let range = stats.range;
  if (unit.type === 'siege-tank' && unit.attrs?.sieged) range = 8;
  if (stats.range === 0) return false;
  return chebyshev(unit.position, targetPos) <= range;
}
