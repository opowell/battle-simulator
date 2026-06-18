import { UNITS } from './units.js';
import { TERRAIN } from './terrain.js';

/**
 * Effective attack stat for a unit, accounting for siege mode and assault mode.
 */
function effectiveAttack(unit) {
  if (unit.type === 'siege-tank' && unit.attrs?.sieged) return 40;
  if (unit.type === 'viking' && unit.attrs?.assaultMode) return 10;
  return UNITS[unit.type].attack;
}

/**
 * Effective range for a unit.
 */
export function effectiveRange(unit) {
  if (unit.type === 'siege-tank' && unit.attrs?.sieged) return 9;
  if (unit.type === 'viking' && unit.attrs?.assaultMode) return 1;
  return UNITS[unit.type].range;
}

/**
 * Whether a unit can attack a target at targetPos given its range.
 */
export function inRange(unit, targetPos) {
  const range = effectiveRange(unit);
  if (range === 0) return false;
  return chebyshev(unit.position, targetPos) <= range;
}

/**
 * Chebyshev distance between two positions.
 */
export function chebyshev(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * Apply one attack from attacker to defender.
 * Returns { hit, shieldDmg, hpDmg, totalDmg, missed }
 *
 * Rules:
 * - Ranged attacker shooting up to elevated tile: 30% miss chance
 * - Shields absorb damage first (no armor reduction vs shields)
 *   Immortal hardened-shield: incoming shield damage capped at 10
 * - Remaining damage reduced by defender's armor (minimum 1)
 * - Bonus damage: bonus-armored-N vs armored, bonus-light-N vs light, bonus-air-N vs air
 * - Domain restrictions: anti-air units can only hit air; anti-ground only hit ground
 * - Stimmed units add their stim bonus to base attack
 */
export function resolveAttack(attacker, defender, state, rng) {
  const atkStats = UNITS[attacker.type];
  const defStats = UNITS[defender.type];

  // Domain restrictions
  if (atkStats.special.includes('anti-air') && defender.domain !== 'air') {
    return { hit: false, shieldDmg: 0, hpDmg: 0, totalDmg: 0, missed: true };
  }
  if (atkStats.special.includes('anti-ground') && defender.domain !== 'ground') {
    return { hit: false, shieldDmg: 0, hpDmg: 0, totalDmg: 0, missed: true };
  }

  // Viking in assault mode can't attack air; in fighter mode can't attack ground (anti-air only)
  if (attacker.type === 'viking') {
    if (attacker.attrs?.assaultMode && defender.domain === 'air') {
      return { hit: false, shieldDmg: 0, hpDmg: 0, totalDmg: 0, missed: true };
    }
    if (!attacker.attrs?.assaultMode && defender.domain === 'ground') {
      return { hit: false, shieldDmg: 0, hpDmg: 0, totalDmg: 0, missed: true };
    }
  }

  // Air units can't be attacked by ground-only melee attackers unless they have range
  if (defender.domain === 'air' && !atkStats.special.includes('anti-air') &&
      atkStats.range <= 1 && atkStats.domain !== 'air') {
    return { hit: false, shieldDmg: 0, hpDmg: 0, totalDmg: 0, missed: true };
  }

  // High-ground miss: ranged attacker on low ground shooting at elevated defender
  if (effectiveRange(attacker) > 1) {
    const atkTile = state.board.tiles[`${attacker.position.x},${attacker.position.y}`];
    const defTile = state.board.tiles[`${defender.position.x},${defender.position.y}`];
    if (atkTile?.terrain !== 'elevated' && defTile?.terrain === 'elevated') {
      if (rng() < 0.30) return { hit: false, shieldDmg: 0, hpDmg: 0, totalDmg: 0, missed: true };
    }
  }

  // Base attack value
  let baseAtk = effectiveAttack(attacker);

  // Stim bonus
  if (attacker.attrs?.stimmed) {
    baseAtk += attacker.type === 'marauder' ? 5 : 3;
  }

  // Bonus vs armored
  if (defStats.special.includes('armored')) {
    for (const sp of atkStats.special) {
      const m = sp.match(/^bonus-armored-(\d+)$/);
      if (m) baseAtk += parseInt(m[1], 10);
    }
  }

  // Bonus vs light
  if (defStats.special.includes('light')) {
    for (const sp of atkStats.special) {
      const m = sp.match(/^bonus-light-(\d+)$/);
      if (m) baseAtk += parseInt(m[1], 10);
    }
  }

  // Bonus vs air
  if (defender.domain === 'air') {
    for (const sp of atkStats.special) {
      const m = sp.match(/^bonus-air-(\d+)$/);
      if (m) baseAtk += parseInt(m[1], 10);
    }
  }

  // Colossus: +10 vs light with its laser
  if (attacker.type === 'colossus' && defStats.special.includes('light')) {
    baseAtk += 10;
  }

  // Shields absorb first (no armor reduction vs shields)
  let remaining = baseAtk;
  let rawShieldDmg = Math.min(remaining, defender.shields ?? 0);

  // Immortal hardened shield: cap incoming shield damage at 10
  if (defender.type === 'immortal' && defStats.special.includes('hardened-shield')) {
    rawShieldDmg = Math.min(rawShieldDmg, 10);
  }

  const shieldDmg = rawShieldDmg;
  remaining -= shieldDmg;

  // HP damage with armor reduction (minimum 1 if there is remaining)
  const hpDmg = remaining > 0 ? Math.max(1, remaining - (defStats.armor ?? 0)) : 0;

  return { hit: true, shieldDmg, hpDmg, totalDmg: shieldDmg + hpDmg, missed: false };
}

/**
 * Apply attack result against a building.
 */
export function resolveAttackVsBuilding(attacker, building, state, rng) {
  const atkStats = UNITS[attacker.type];

  // Domain restriction for banshee (anti-ground only)
  if (atkStats.special.includes('anti-air')) {
    return { hit: false, shieldDmg: 0, hpDmg: 0, totalDmg: 0, missed: true };
  }

  // High-ground miss
  if (effectiveRange(attacker) > 1) {
    const atkTile = state.board.tiles[`${attacker.position.x},${attacker.position.y}`];
    const defTile = state.board.tiles[`${building.position.x},${building.position.y}`];
    if (atkTile?.terrain !== 'elevated' && defTile?.terrain === 'elevated') {
      if (rng() < 0.30) return { hit: false, shieldDmg: 0, hpDmg: 0, totalDmg: 0, missed: true };
    }
  }

  let baseAtk = effectiveAttack(attacker);
  if (attacker.attrs?.stimmed) {
    baseAtk += attacker.type === 'marauder' ? 5 : 3;
  }

  const shieldDmg = Math.min(baseAtk, building.shields ?? 0);
  const remaining  = baseAtk - shieldDmg;
  const hpDmg = remaining > 0 ? Math.max(1, remaining) : 0;

  return { hit: true, shieldDmg, hpDmg, totalDmg: shieldDmg + hpDmg, missed: false };
}
