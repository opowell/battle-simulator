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
 * What one step onto `tile` costs, in thirds: air units pay a flat move, a railroad
 * nothing, a road one third, anything else the destination terrain's own cost. The one
 * table both the rules (the step actually taken) and the flood fills (where a unit may
 * go, how far a goal is) charge from.
 */
export function stepThirds(tile, domain) {
  if (domain === 'air') return THIRDS;
  if (tile?.hasRail) return 0;
  if (tile?.hasRoad) return 1;
  return ((tile ? TERRAIN[tile.terrain]?.moveCost : null) ?? 1) * THIRDS;
}
