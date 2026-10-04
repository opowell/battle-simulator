// Movement is counted in whole thirds of a move — `unit.moveThirds` — as the original
// counts it (its RemainingMoves field holds thirds). A road step costs one third, and
// in floating point a third is not exact: three road steps off one move left 1.1e-16
// behind, a sliver that looked like a move left. Integers have no slivers, so every
// rule here is plain arithmetic; only the UI ever divides by THIRDS, to show 2/3.
import { UNITS } from './units.js';
import { TERRAIN } from './terrain.js';

export const THIRDS = 3;

/** A unit type's whole turn of movement, in thirds (its `moves` stat is in moves). */
export function fullThirds(type) {
  return (UNITS[type]?.moves ?? 1) * THIRDS;
}

/**
 * What one step from `from` onto `to` costs, in thirds: air units pay a flat move; a
 * railroad nothing and a road one third, but only when the square being left has one
 * too — as in the original, a road speeds you ALONG it, so stepping onto one from open
 * ground (or off it) pays the destination's terrain. Anything else is the destination
 * terrain's own cost. A city square counts as a road end (the original lays one under
 * every city) — callers mark it with `city`, see roadEnd. The one table both the rules
 * (the path actually taken) and the flood fills (where a unit may go, how far a goal
 * is) charge from.
 */
export function stepThirds(from, to, domain) {
  if (domain === 'air') return THIRDS;
  if (from?.hasRail && to?.hasRail) return 0;
  if (from?.hasRoad && to?.hasRoad) return 1;
  return ((to ? TERRAIN[to.terrain]?.moveCost : null) ?? 1) * THIRDS;
}

/** `tile` as one end of a step: a city square carries a road whatever the map says. */
export function roadEnd(tile, isCity) {
  return isCity && tile && !tile.hasRoad ? { ...tile, hasRoad: true } : tile;
}
