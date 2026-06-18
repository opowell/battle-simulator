import { UNITS } from './units.js';
import { TERRAIN } from './terrain.js';

/**
 * Resolve combat round-by-round. Each round the attacker wins with prob = att/(att+def).
 * Loser takes 1 HP damage. Fight ends when either side hits 0 HP.
 *
 * Terrain and camp bonuses apply to the defender.
 */
export function resolveCombat(attacker, defender, state, rng) {
  const atkStats = UNITS[attacker.type];
  const defStats = UNITS[defender.type];

  let att = atkStats.attack;
  let def = defStats.defense;

  const defTile = state.board.tiles[`${defender.position.x},${defender.position.y}`];
  if (defTile) {
    const terrain = TERRAIN[defTile.terrain];
    if (terrain?.passable) def *= (1 + terrain.defBonus);
    if (defTile.hasCamp) def *= 2; // camp: fortified position doubles defense
  }

  const prob = att / (att + def);
  let atkHp = attacker.hp;
  let defHp = defender.hp;
  let rounds = 0;

  while (atkHp > 0 && defHp > 0 && rounds < 500) {
    rounds++;
    if (rng() < prob) defHp--;
    else atkHp--;
  }

  return {
    attackerSurvived: atkHp > 0,
    attackerHpLeft: Math.max(0, atkHp),
    defenderHpLeft: Math.max(0, defHp),
    rounds,
    prob: Math.round(prob * 100),
  };
}
