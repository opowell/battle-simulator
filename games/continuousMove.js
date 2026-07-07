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

// Deterministic set of continuous destination points within `range` of (ox, oy) that
// pass isLegal(x, y) — a polar lattice of `rings` radii × `spokes` angles (no rng, so
// repeated calls agree). The Obscuro search fixes an infoset's action set once and
// re-derives it per belief world to filter (agents/obscuro/gtcfr.js expandNode), so the
// generator must be a pure function of the state; rings×spokes is the continuous action
// resolution, scaled by AI difficulty. Alternate rings are half-step rotated so points
// don't stack radially, and the exact origin is skipped (a zero-length move is a no-op).
export function movePointLattice(ox, oy, range, isLegal, rings = 2, spokes = 8) {
  const out = [];
  for (let ri = 1; ri <= rings; ri++) {
    const rad = range * (ri / rings);
    const off = (ri % 2) * (Math.PI / spokes); // stagger alternate rings
    for (let s = 0; s < spokes; s++) {
      const ang = off + s * (2 * Math.PI / spokes);
      const x = ox + rad * Math.cos(ang);
      const y = oy + rad * Math.sin(ang);
      if (isLegal(x, y)) out.push({ x, y });
    }
  }
  return out;
}

// Build a continuous-game action set for game-tree search: replace each mover's discrete
// tile moves with a continuous point lattice (straight-line-legal destinations), keeping
// every non-move action untouched. So the AI plays by the same free-form movement rules
// as a human clicking the board — it can position at exact points, not just tile centres
// — while the discrete getLegalActions stays the engine/human-facing enumerator. If the
// lattice finds nothing legal for a unit (boxed in), its discrete moves are kept so the
// unit is never made immobile. `moveRangeOf(unit)` and `isLegalMove(unitId, x, y)` carry
// the game's geometry; `res = { rings, spokes }` is the difficulty-scaled resolution.
export function continuousSearchActions(baseActions, units, moveRangeOf, isLegalMove, res = {}) {
  const moves = baseActions.filter(a => a.type === 'move');
  if (!moves.length) return baseActions;
  const { rings = 2, spokes = 8 } = res;
  const out = baseActions.filter(a => a.type !== 'move');
  const byUnit = new Map();
  for (const a of moves) {
    if (!byUnit.has(a.unitId)) byUnit.set(a.unitId, []);
    byUnit.get(a.unitId).push(a);
  }
  for (const [uid, discrete] of byUnit) {
    const u = units.find(x => x.id === uid);
    const pts = u
      ? movePointLattice(num(u.position.x), num(u.position.y), moveRangeOf(u),
          (x, y) => isLegalMove(uid, x, y), rings, spokes)
      : [];
    if (pts.length) for (const to of pts) out.push({ type: 'move', unitId: uid, to });
    else out.push(...discrete);
  }
  return out;
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
