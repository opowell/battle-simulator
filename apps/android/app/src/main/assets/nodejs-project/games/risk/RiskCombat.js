function rollDice(count, rng) {
  return Array.from({ length: count }, () => Math.floor(rng() * 6) + 1)
    .sort((a, b) => b - a);
}

/**
 * One round of Risk combat. Attacker rolls up to 3 dice (limited by armies-1),
 * defender rolls up to 2 dice. Highest pair compared, then second if both have ≥2.
 * Defender wins ties.
 *
 * Returns { attackerLosses, defenderLosses, attackerRolls, defenderRolls }.
 */
export function resolveCombat(attackerArmies, defenderArmies, attackerDice, rng) {
  const numAttacker = Math.min(attackerDice, 3, attackerArmies - 1);
  const numDefender = Math.min(2, defenderArmies);

  const aRolls = rollDice(numAttacker, rng);
  const dRolls = rollDice(numDefender, rng);

  let attackerLosses = 0;
  let defenderLosses = 0;

  const pairs = Math.min(aRolls.length, dRolls.length);
  for (let i = 0; i < pairs; i++) {
    if (aRolls[i] > dRolls[i]) {
      defenderLosses++;
    } else {
      attackerLosses++;
    }
  }

  return { attackerLosses, defenderLosses, attackerRolls: aRolls, defenderRolls: dRolls };
}
