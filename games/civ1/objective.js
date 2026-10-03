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

/**
 * @returns {null | { role: 'attacker'|'defender', cityId, cityPos, turnsLeft }}
 *   turnsLeft counts this turn: 1 means this is the attacker's last chance.
 */
export function siegeRole(state, playerId) {
  const obj = state.gameSpecific?.objective;
  if (obj?.type !== 'take-city') return null;
  const role = obj.attackerId === playerId ? 'attacker' : obj.defenderId === playerId ? 'defender' : null;
  if (!role) return null;
  const city = state.cities.find(c => c.id === obj.cityId)
    ?? state.gameSpecific.startRoster?.cities?.find(c => c.id === obj.cityId);
  if (!city) return null;
  return {
    role,
    cityId: obj.cityId,
    cityPos: city.position,
    turnsLeft: Math.max(0, obj.turns - state.turnNumber + 1),
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

export function siegeAttackWant(want, P) {
  return Math.max(want, 0) + P * SIEGE_STAKE;
}

export const isMounted = type => (UNITS[type]?.special ?? []).includes('mounted');

export const atSiegeCity = (siege, pos) =>
  siege != null && pos.x === siege.cityPos.x && pos.y === siege.cityPos.y;

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
