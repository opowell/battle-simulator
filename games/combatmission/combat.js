import { UNIT_DEFS } from './units.js';
import { getCoverBonus } from './map.js';

// Base hit chance before modifiers
const BASE_HIT = 65;

export function calcHitChance(shooter, target, board) {
  const dist = Math.sqrt(
    (shooter.position.x - target.position.x) ** 2 +
    (shooter.position.y - target.position.y) ** 2
  );
  let chance = BASE_HIT;
  chance -= Math.max(0, dist - 1) * 5;                    // range penalty
  chance -= getCoverBonus(board, target.position.x, target.position.y); // target cover
  chance -= shooter.suppression * 5;                       // shooter suppression
  return Math.max(10, Math.min(90, Math.round(chance)));
}

export function resolveFire(shooter, target, board, rng) {
  const hitChance = calcHitChance(shooter, target, board);
  const roll = Math.floor(rng() * 100) + 1;
  const hit = roll <= hitChance;

  let damage = 0;
  if (hit) {
    const atk = UNIT_DEFS[shooter.type].attack;
    const variance = 0.8 + rng() * 0.4;
    damage = Math.max(1, Math.round(atk * variance));
  }

  // Even a miss adds suppression to the target
  const targetSuppression = hit ? 2 : 1;

  return { hit, roll, hitChance, damage, targetSuppression };
}
