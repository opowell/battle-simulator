import { UNITS } from './units.js';

function rollD6(rng) {
  return Math.floor(rng() * 6) + 1;
}

// Remove `hits` casualties from a unit list, cheapest first.
// Mutli-hp units (battleship, carrier) absorb a hit before dying.
function removeCasualties(units, hits) {
  if (hits <= 0) return units;
  const sorted = [...units].sort((a, b) => UNITS[a.type].cost - UNITS[b.type].cost);
  let left = hits;
  const result = [];
  for (const u of sorted) {
    if (left <= 0) { result.push(u); continue; }
    if (u.hp > 1) {
      result.push({ ...u, hp: u.hp - 1 });
      left--;
    } else {
      left--; // unit destroyed
    }
  }
  return result;
}

/**
 * Auto-resolve one battle.
 * Returns { survivingAttackers, survivingDefenders, attackerWon }.
 * Units passed in are plain objects (copies are made internally).
 */
export function resolveBattle(attackers, defenders, rng) {
  let atk = attackers.map(u => ({ ...u }));
  let def = defenders.map(u => ({ ...u }));

  for (let round = 0; round < 100 && atk.length > 0 && def.length > 0; round++) {
    // Infantry+artillery pairing: each artillery boosts one infantry to attack 2
    const atkArt = atk.filter(u => u.type === 'artillery').length;
    let infPaired = 0;

    let atkHits = 0;
    for (const u of atk) {
      let val = UNITS[u.type].attack;
      if (u.type === 'infantry' && infPaired < atkArt) { val = 2; infPaired++; }
      if (val > 0 && rollD6(rng) <= val) atkHits++;
    }

    let defHits = 0;
    for (const u of def) {
      if (UNITS[u.type].defense > 0 && rollD6(rng) <= UNITS[u.type].defense) defHits++;
    }

    // Simultaneous casualties
    def = removeCasualties(def, atkHits);
    atk = removeCasualties(atk, defHits);
  }

  return {
    survivingAttackers: atk,
    survivingDefenders: def,
    attackerWon: atk.length > 0 && def.length === 0,
  };
}
