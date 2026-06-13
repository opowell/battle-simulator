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
  const strBonus = Math.max(0, Math.floor((hero.attrs.strength - 16) / 2));
  const damage   = Math.max(1, rollDice(dice, sides, rng) + strBonus);
  return { hit: true, damage, roll };
}

// Monster attacks hero. Returns { hit, damage, roll }.
// Hero defense = 10 + armorClass (higher AC → harder to hit)
export function monsterAttack(monster, hero, rng) {
  const roll      = 1 + Math.floor(rng() * 20);
  const threshold = 10 + hero.attrs.armorClass;
  const hit       = (roll + monster.attrs.level) > threshold;
  if (!hit) return { hit: false, damage: 0, roll };

  const [dice, sides] = monster.attrs.attack;
  const damage = Math.max(1, rollDice(dice, sides, rng));
  return { hit: true, damage, roll };
}
