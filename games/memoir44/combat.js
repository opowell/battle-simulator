// Battle dice. The classic Memoir '44 six-sided die: two Infantry faces, one
// Armor, one Grenade (hits anything), one Star, one Flag (forces a retreat).
export const DIE_FACES = ['infantry', 'infantry', 'armor', 'grenade', 'star', 'flag'];

export function rollDie(rng = Math.random) {
  return DIE_FACES[Math.floor(rng() * DIE_FACES.length)];
}

// Which die faces score a figure kill against a defender of `defenderType`.
// Infantry AND artillery are hit by Infantry or Grenade; Armor by Armor or Grenade.
function killsFor(defenderType) {
  return defenderType === 'armor' ? ['armor', 'grenade'] : ['infantry', 'grenade'];
}

// Roll `n` battle dice against a defender and tally the result. Pure given `rng`.
// Returns { rolls, hits, flags, stars } where `hits` is figures the defender
// loses outright and `flags` forces retreats (resolved by the caller, since
// retreat depends on board geometry).
export function rollBattle(n, defenderType, rng = Math.random) {
  const rolls = [];
  for (let i = 0; i < n; i++) rolls.push(rollDie(rng));
  const kills = killsFor(defenderType);
  let hits = 0, flags = 0, stars = 0;
  for (const face of rolls) {
    if (kills.includes(face)) hits++;
    else if (face === 'flag') flags++;
    else if (face === 'star') stars++;
  }
  return { rolls, hits, flags, stars };
}
