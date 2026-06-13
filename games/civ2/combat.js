import { UNITS } from './units.js';
import { TERRAIN } from './terrain.js';

/**
 * Compute modified attack/defense strengths for a combat pair.
 * Applies terrain bonus, city bonus, veteran status, and anti-mounted bonus.
 */
export function getCombatStrengths(attacker, defender, state) {
  const atkStats = UNITS[attacker.type];
  const defStats = UNITS[defender.type];

  let att = atkStats.attack;
  let def = defStats.defense;

  // Terrain defense bonus (applied to defender)
  const defTile = state.board.tiles[`${defender.position.x},${defender.position.y}`];
  if (defTile) {
    const terrainDef = TERRAIN[defTile.terrain];
    if (terrainDef) def *= (1 + terrainDef.defBonus);

    // River crossing: +50% extra defense
    if (defTile.hasRiver) def *= 1.5;
  }

  // City defense: +50%
  const inCity = state.cities.some(
    c => c.position.x === defender.position.x && c.position.y === defender.position.y
  );
  if (inCity) def *= 1.5;

  // Fortress defense: +100%
  if (defTile?.fortress) def *= 2;

  // Veteran bonus: +50% to both
  if (attacker.attrs?.veteran) att *= 1.5;
  if (defender.attrs?.veteran) def *= 1.5;

  // Anti-mounted bonus: pikemen, etc. get +50% defense vs mounted attackers
  if (atkStats.special.includes('mounted') && defStats.special.includes('anti-mounted')) {
    def *= 1.5;
  }

  return { att, def };
}

/**
 * Resolve combat between attacker and defender using the Civ2 round-by-round system.
 * Each round: attacker wins with prob = att/(att+def), loser takes firepower damage.
 * Fight continues until one side reaches 0 HP.
 *
 * Returns { attackerSurvived, attackerHpLeft, defenderHpLeft, rounds }
 */
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
    // Safety valve against infinite loops with firepower=0 (shouldn't happen per unit data)
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
