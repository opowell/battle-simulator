import { UNITS } from './units.js';
import { TERRAIN } from './terrain.js';
import { wonderEffectsFor } from './improvements.js';
import { THIRDS } from './moves.js';

/**
 * How much of a move an attacker has to swing with, in whole thirds (moves.js), capped
 * at 3 (a full blow).
 *
 * A unit with no moves at all (an enemy between its own turns, a defender asked
 * "what could it do to me") is weighed at full strength: what it would hit with next
 * turn, which is the only question anyone asks about it.
 */
export function attackThirds(unit) {
  const left = unit.moveThirds;
  if (!(left > 0)) return THIRDS;
  return Math.min(THIRDS, left);
}

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

  // City defense: +50% base. City Walls (or the Great Wall, which acts as walls in
  // every city) triple the defence against land attackers, as in the original.
  const city = state.cities.find(
    c => c.position.x === defender.position.x && c.position.y === defender.position.y
  );
  if (city) {
    def *= 1.5;
    const walls = (city.buildings ?? []).includes('city-walls')
      || wonderEffectsFor(state.cities, city.ownerId).has('walls-all');
    if (walls && atkStats.domain === 'land') def *= 3;
  }

  // Veteran bonus: +50% to both
  if (attacker.attrs?.veteran) att *= 1.5;
  if (defender.attrs?.veteran) def *= 1.5;

  // An attack made on part of a move — what a road leaves over — strikes with that
  // part of its strength: a third or two thirds. The original's combat routine scales
  // the attack by RemainingMoves / 3 whenever fewer than three thirds are left (and
  // CheckPlayerTurn asks "Attack at 1/3 strength?" first — the attack action's label in
  // Civ1Game.js). Counted in whole thirds (attackThirds), as the original does.
  const thirds = attackThirds(attacker);
  if (thirds < THIRDS) att = att * thirds / THIRDS;

  // A fortress doubles a land defender's strength (the original's combat routine, CIV.EXE
  // segment 29f3, OpenCivOne F0_29f3_000e) — INSTEAD of the fortify bonus, not on top
  // of it: that routine picks one of three multipliers, fortress x2, else fortified x1.5,
  // else none. A city square doesn't count as one (see inFortress).
  if (inFortress(state, defender)) def *= 2;
  // Fortify bonus: +50% defense while dug in (attrs.fortified — see Civ1Game.js's
  // 'fortify' action; cleared the moment the unit gets a fresh order). A unit that
  // was ordered to dig in this turn is only attrs.fortifying and gets nothing yet:
  // the bonus arrives when the order finishes, on its owner's next turn.
  else if (defender.attrs?.fortified) def *= 1.5;

  return { att, def };
}

/**
 * Whether `unit` is holding a fortress: a land unit on a square with one, outside a city
 * (a city has its own rules — and no square is both in this game). A fortress is what
 * its holders get instead of digging in, and the one open square whose stack does not
 * all die with its defender (Civ1Game's resolveAttack).
 */
export function inFortress(state, unit) {
  const pos = unit.position;
  if (!state.board.tiles[`${pos.x},${pos.y}`]?.fortress) return false;
  if (UNITS[unit.type]?.domain !== 'land') return false;
  return !state.cities.some(c => c.position.x === pos.x && c.position.y === pos.y);
}

/**
 * Who meets the attack. Civ1 stacks units on a square, and an attack is aimed at the
 * SQUARE, not at a unit inside it: the stack's strongest defender fights, so hiding a
 * settler behind a phalanx works and sniping the settler out from under it does not.
 * Strength is the full modified defence (terrain, city walls, fortify, veteran — see
 * getCombatStrengths), because that is what the attacker actually has to beat; ties go
 * to the healthier unit, then to the lower id so the pick is deterministic.
 *
 * @param {object[]} defenders every alive unit standing on the attacked square
 */
export function pickDefender(attacker, defenders, state) {
  let best = null, bestDef = -Infinity;
  for (const d of defenders) {
    const { def } = getCombatStrengths(attacker, d, state);
    if (def > bestDef
        || (def === bestDef && (d.hp > best.hp || (d.hp === best.hp && String(d.id) < String(best.id))))) {
      best = d; bestDef = def;
    }
  }
  return best;
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
