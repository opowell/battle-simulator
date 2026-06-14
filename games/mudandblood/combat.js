import { getCoverDefense } from './map.js';

export function calcHitChance(shooter, target, board, officerBonus = 0) {
  const dist = Math.abs(shooter.position.x - target.position.x)
             + Math.abs(shooter.position.y - target.position.y);
  const cover       = getCoverDefense(board, target.position.x, target.position.y);
  const suppPenalty = (shooter.suppression ?? 0) * 10;
  let chance = shooter.attrs.aim - dist * 3 - cover - suppPenalty + officerBonus;
  // Snipers improve with distance rather than suffer from it
  if (shooter.type === 'sniper') chance += dist * 2;
  return Math.max(5, Math.min(95, chance));
}

export function rollHit(hitChance, rng) {
  const roll = Math.floor(rng() * 100) + 1;
  return { hit: roll <= hitChance, crit: roll <= Math.floor(hitChance / 5), roll };
}

export function rollDamage(unit, crit, rng) {
  const [min, max] = unit.attrs.damage;
  const base = min + Math.floor(rng() * (max - min + 1));
  return crit ? base * 2 : base;
}
