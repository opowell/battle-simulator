function rollDice(dice, sides, rng) {
  let total = 0;
  for (let i = 0; i < dice; i++) total += 1 + Math.floor(rng() * sides);
  return total;
}

// Hero attacks monster. Returns { hit, damage, roll }.
export function heroAttack(hero, monster, rng) {
  const roll = 1 + Math.floor(rng() * 20);
  const hit  = (roll + hero.attrs.heroLevel) > monster.attrs.defense;
  if (!hit) return { hit: false, damage: 0, roll };

  const [dice, sides] = hero.attrs.weaponDmg;
  const enchBonus = hero.attrs.weaponEnchant ?? 0;
  const strBonus  = Math.max(0, Math.floor((hero.attrs.strength - 16) / 2));
  const damage    = Math.max(1, rollDice(dice, sides, rng) + strBonus + enchBonus);
  return { hit: true, damage, roll };
}

// Monster attacks hero. Returns { hit, damage, roll, effect? }.
// effect: string matching monster specialAbility — caller handles the consequence.
// Hero defense = 10 + armorClass + armorEnchant (higher AC → harder to hit).
export function monsterAttack(monster, hero, rng) {
  const roll      = 1 + Math.floor(rng() * 20);
  const acBonus   = (hero.attrs.armorEnchant ?? 0);
  const threshold = 10 + hero.attrs.armorClass + acBonus;
  const hit       = (roll + monster.attrs.level) > threshold;
  if (!hit) return { hit: false, damage: 0, roll };

  const ability = monster.attrs.specialAbility;

  // Special abilities that deal no normal damage
  const noDmgAbilities = new Set(['rust','hold','freeze','steal_gold','steal_item']);
  if (ability && noDmgAbilities.has(ability)) {
    return { hit: true, damage: 0, roll, effect: ability };
  }

  const [dice, sides] = monster.attrs.attack;
  const damage = sides === 0 ? 0 : Math.max(1, rollDice(dice, sides, rng));

  // Abilities that deal damage AND apply an effect
  const effect = (ability && !noDmgAbilities.has(ability)) ? ability : undefined;
  return { hit: true, damage, roll, effect };
}
