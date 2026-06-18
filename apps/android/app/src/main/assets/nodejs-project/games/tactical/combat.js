const UNIT_STATS = {
  warrior: { hp: 30, maxHp: 30, attack: 8, defense: 4, moveRange: 2, attackRange: 1, speed: 2, attackSpeed: 1.2 },
  archer:  { hp: 20, maxHp: 20, attack: 10, defense: 2, moveRange: 2, attackRange: 3, speed: 2, attackSpeed: 0.8 },
  mage:    { hp: 15, maxHp: 15, attack: 15, defense: 1, moveRange: 2, attackRange: 2, speed: 2, attackSpeed: 0.5 },
};

export { UNIT_STATS };

/**
 * Calculate damage dealt by attacker to defender.
 * damage = max(1, atk - def) × variance(0.8–1.2)
 *
 * @param {object} attacker  Unit with type
 * @param {object} defender  Unit with type
 * @param {() => number} rng  Returns [0, 1)
 * @returns {number}
 */
export function calculateDamage(attacker, defender, rng) {
  const atkStats = UNIT_STATS[attacker.type];
  const defStats = UNIT_STATS[defender.type];
  const base = Math.max(1, atkStats.attack - defStats.defense);
  const variance = 0.8 + rng() * 0.4; // 0.8 – 1.2
  return Math.round(base * variance);
}
