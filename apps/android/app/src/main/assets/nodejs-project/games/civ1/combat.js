import { UNITS } from './units.js';
import { TERRAIN } from './terrain.js';

export function getCombatStrengths(attacker, defender, state) {
  const atkStats = UNITS[attacker.type];
  const defStats = UNITS[defender.type];

  let att = atkStats.attack;
  let def = defStats.defense;

  const defTile = state.board.tiles[`${defender.position.x},${defender.position.y}`];
  if (defTile) {
    const terrainDef = TERRAIN[defTile.terrain];
    if (terrainDef) def *= (1 + terrainDef.defBonus);
  }

  // City defense: +50% (city walls not modeled separately)
  const inCity = state.cities.some(
    c => c.position.x === defender.position.x && c.position.y === defender.position.y
  );
  if (inCity) def *= 1.5;

  // Veteran bonus: +50% to both
  if (attacker.attrs?.veteran) att *= 1.5;
  if (defender.attrs?.veteran) def *= 1.5;

  return { att, def };
}

// Round-by-round combat: each round attacker wins with prob=att/(att+def).
// Loser takes firepower damage (all Civ1 units have firepower=1).
export function resolveCombat(attacker, defender, state, rng) {
  const atkStats = UNITS[attacker.type];
  const defStats = UNITS[defender.type];

  const { att, def } = getCombatStrengths(attacker, defender, state);
  const prob = att / (att + def);

  let atkHp = attacker.hp;
  let defHp = defender.hp;
  let rounds = 0;

  while (atkHp > 0 && defHp > 0) {
    rounds++;
    if (rng() < prob) {
      defHp -= atkStats.firepower;
    } else {
      atkHp -= defStats.firepower;
    }
    if (rounds > 1000) break;
  }

  return {
    attackerSurvived: atkHp > 0,
    attackerHpLeft: Math.max(0, atkHp),
    defenderHpLeft: Math.max(0, defHp),
    rounds,
    prob: Math.round(prob * 100),
  };
}
