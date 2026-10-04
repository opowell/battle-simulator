// A fixed battle's objective (fixedMaps.js), as one seat's agent sees it.
//
// The agents were written for the open game, where a city is one asset among many
// and an army is worth marching off to find the enemy. In a siege the city is the
// whole game: the defender that sallies out with its garrison loses, and the
// attacker that waits for good odds runs out of turns. This is the one place both
// agents (ai.js, Civ1ObscuroAgent.js) learn which side of that they are on.
//
// Works on an observation: the city's square comes from the opening roster, which
// is common knowledge, so the attacker knows where to march before it can see it.

import { UNITS } from './units.js';
import { inFortress, attackThirds } from './combat.js';

/**
 * @returns {null | { role: 'attacker'|'defender', kind, cityId, cityIds, cityPos, targets,
 *   escortId, turnsLeft }}
 *   kind is the objective's type (fixedMaps.js). cityPos is the square the attacker is
 *   making for — the objective city still to take nearest its army, the square to
 *   seize, or the escort's destination — and targets every square that counts (all the
 *   cities still to take). cityId is the city at cityPos, or null when it is a square.
 *   turnsLeft counts this turn: 1 means this is the attacker's last chance.
 *   Null outside a fixed battle, and in a rout — a battle in the open is the open
 *   game's own fight, with nothing to march on but the enemy.
 */
export function siegeRole(state, playerId) {
  const obj = state.gameSpecific?.objective;
  if (!obj || obj.type === 'rout') return null;
  const role = obj.attackerId === playerId ? 'attacker' : obj.defenderId === playerId ? 'defender' : null;
  if (!role) return null;
  const turnsLeft = Math.max(0, obj.turns - state.turnNumber + 1);

  if (obj.type === 'seize' || obj.type === 'escort') {
    const pos = { x: obj.at.x, y: obj.at.y };
    return { role, kind: obj.type, cityId: null, cityIds: [], cityPos: pos, targets: [pos],
      escortId: obj.escortId ?? null, turnsLeft };
  }
  if (obj.type !== 'take-city') return null;

  // Still to take: an objective city standing and not the attacker's. A revealed
  // battlefield's cities are on everyone's map (getVisibleState), seen or not; one
  // razed is gone, and off the list.
  const ids = obj.cityIds ?? [obj.cityId];
  const cities = ids.map(id => state.cities.find(c => c.id === id))
    .filter(c => c && c.ownerId !== obj.attackerId);
  if (!cities.length) return null;
  // The attacker's next city: the one nearest its army, by the army's centre.
  let city = cities[0];
  if (role === 'attacker' && cities.length > 1) {
    const mine = state.units.filter(u => u.alive && u.ownerId === playerId);
    if (mine.length) {
      const cx = mine.reduce((s, u) => s + u.position.x, 0) / mine.length;
      const cy = mine.reduce((s, u) => s + u.position.y, 0) / mine.length;
      const d = c => Math.max(Math.abs(c.position.x - cx), Math.abs(c.position.y - cy));
      city = cities.reduce((b, c) => d(c) < d(b) ? c : b);
    }
  }
  return {
    role, kind: 'take-city',
    cityId: city.id,
    cityIds: cities.map(c => c.id),
    cityPos: city.position,
    targets: cities.map(c => c.position),
    escortId: null,
    turnsLeft,
  };
}

// Assaulting the city: the worst odds a blow at its garrison is worth taking while
// there are turns in hand — on the last two, any blow is — and what a landed blow is
// worth in shields on top of the trade itself. The stake is set to outrank any
// ordinary exchange, so the army spends itself on the walls rather than on the
// pickets around them, and a blow's rank goes by its chance of landing (catapults
// first, as they should).
const SIEGE_MIN_WIN_PROB = 0.3;
const SIEGE_STAKE = 200;

export function siegeAttackFloor(siege) {
  return siege.turnsLeft <= 2 ? 0 : SIEGE_MIN_WIN_PROB;
}

// A blow at the city on part of a move — a road step taken first — lands at that part
// of its strength (combat.js). The garrison is not going anywhere, so with turns in hand
// the blow waits for next turn's full move, as a player asked "Attack at 2/3 strength?"
// would; on the last two turns any blow is worth it (siegeAttackFloor).
export function waitsForFullStrength(siege, attacker) {
  return siege.turnsLeft > 2 && attackThirds(attacker) < 3;
}

export function siegeAttackWant(want, P) {
  return Math.max(want, 0) + P * SIEGE_STAKE;
}

export const isMounted = type => (UNITS[type]?.special ?? []).includes('mounted');

// Whether `pos` is one of the squares the battle is about (siegeRole's targets).
export const atSiegeCity = (siege, pos) =>
  siege != null && siege.targets.some(t => pos.x === t.x && pos.y === t.y);

/**
 * Whether `unit` is one of a fort's holders: a foot soldier standing in a fortress
 * (combat.js inFortress). A besieged side's holders stay put and dig in — the time
 * the attackers spend on a fort is the fort's whole point. Horsemen are passing
 * through: they belong to the city, and ride out from it.
 */
export const holdsFort = (state, unit) => !isMounted(unit.type) && inFortress(state, unit);

/**
 * What the besieged city should build: the stoutest land defender on offer,
 * cheapest first among equals — settlers and granaries are for a city with a
 * future. Null when what it is already building is as stout.
 */
export function chooseSiegeProduction(city, prodActions) {
  const def = item => UNITS[item]?.domain === 'land' && !(UNITS[item].special ?? []).includes('found-city')
    ? (UNITS[item].defense ?? 0) : -1;
  let best = null;
  for (const a of prodActions) {
    if (def(a.item) <= 0) continue;
    if (!best || def(a.item) > def(best.item)
        || (def(a.item) === def(best.item) && UNITS[a.item].cost < UNITS[best.item].cost)) best = a;
  }
  if (!best || def(city.production) >= def(best.item)) return null;
  return best;
}
