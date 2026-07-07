import { num } from './coord.js';

// Continuous straight-line movement helpers shared by shape-based (non-grid) games
// (doom, cs, combatmission). Their terrain is authored as shapes with real (float)
// coordinates (see terrainShapes.js) — walls/cost are looked up by testing the exact
// clicked point against that shape geometry directly, not by rounding to a tile, so
// precision is bounded only by float64, not by the 1-unit tile grid.

// True when the straight segment (x0,y0)-(x1,y1) never enters a blocked point per
// `isWallFn(x, y)`. Sampled densely enough that a thin obstacle can't be skipped over.
export function hasClearLine(x0, y0, x1, y1, isWallFn, samplesPerUnit = 12) {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(dist * samplesPerUnit));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (isWallFn(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
  }
  return true;
}

// Movement-point cost of the straight segment (x0,y0)-(x1,y1), integrating
// `costFn(x, y)` (movement points per unit distance) along the line — lets terrain
// that's slow to cross (woods, hedgerows) still slow a direct diagonal slide, not
// just orthogonal grid steps.
export function lineCost(x0, y0, x1, y1, costFn, samplesPerUnit = 12) {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  if (dist === 0) return 0;
  const steps = Math.max(1, Math.ceil(dist * samplesPerUnit));
  const stepLen = dist / steps;
  let cost = 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    cost += costFn(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t) * stepLen;
  }
  return cost;
}

// True when (x, y) isn't within `minSep` of any other living unit — movement is no
// longer grid-cell-quantized, so occupancy has to be a real-distance check instead of
// an exact-cell match. `x`, `y` are plain Numbers; unit positions are authoritative
// BigNumbers, so read them in Number-space (see games/coord.js).
export function isClearOfUnits(x, y, units, excludeId, minSep = 0.4) {
  for (const u of units) {
    if (!u.alive || u.id === excludeId) continue;
    if (Math.hypot(num(u.position.x) - x, num(u.position.y) - y) < minSep) return false;
  }
  return true;
}
