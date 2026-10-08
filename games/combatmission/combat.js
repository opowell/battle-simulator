import { UNIT_DEFS } from './units.js';
import { getCoverBonus } from './map.js';
import { num } from '../coord.js';

// Base hit chance before modifiers
const BASE_HIT = 65;

// `penalty` lowers the chance further — area fire (see rules.js) shoots at a spot,
// not at the man, and is that much likelier to miss.
export function calcHitChance(shooter, target, board, penalty = 0) {
  const dist = Math.sqrt(
    (num(shooter.position.x) - num(target.position.x)) ** 2 +
    (num(shooter.position.y) - num(target.position.y)) ** 2
  );
  let chance = BASE_HIT;
  chance -= Math.max(0, dist - 1) * 5;                    // range penalty
  chance -= getCoverBonus(board, target.position.x, target.position.y); // target cover
  chance -= shooter.suppression * 5;                       // shooter suppression
  chance -= penalty;
  return Math.max(penalty ? 5 : 10, Math.min(90, Math.round(chance)));
}

export function resolveFire(shooter, target, board, rng, penalty = 0) {
  const hitChance = calcHitChance(shooter, target, board, penalty);
  const roll = Math.floor(rng() * 100) + 1;
  const hit = roll <= hitChance;

  let damage = 0;
  if (hit) {
    const atk   = UNIT_DEFS[shooter.type].attack;
    const armor = UNIT_DEFS[target.type].armor ?? 0;
    const variance = 0.8 + rng() * 0.4;
    damage = Math.max(1, Math.round(atk * variance) - armor);
  }

  // Even a miss adds suppression to the target
  const targetSuppression = hit ? 2 : 1;

  return { hit, roll, hitChance, damage, targetSuppression };
}
