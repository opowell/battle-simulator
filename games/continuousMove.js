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

// Replace one family of discrete point-target actions (a move's `to`, a grenade throw's
// `target` — any action whose destination is a continuous board point) with a lattice of
// exact continuous candidates, for game-tree search. So the AI plays by the same free-form
// rules as a human clicking the board — positioning / aiming at exact points, not just tile
// centres — while the discrete getLegalActions stays the engine/human-facing enumerator.
// Non-matching actions pass through untouched, and if the lattice finds nothing legal for a
// group (e.g. a boxed-in unit) its discrete candidates are kept so no option is lost.
//
// `family` describes the action family:
//   type    — action.type to replace ('move', 'throw', …)
//   point   — the field holding the destination point ('to', 'target', …)
//   origin(action) -> { x, y, range } | null   Number-space centre + reach for the lattice
//   isLegal(action, x, y) -> boolean            geometric legality of that point
// Actions are grouped by their identity minus the point field, so each distinct thrower /
// grenade / mover gets its own lattice. Deterministic (no rng): the search fixes an
// infoset's action set once and re-derives it per world to filter (agents/obscuro/gtcfr.js).
export function latticeActions(baseActions, family, res = {}) {
  const matched = baseActions.filter(a => a.type === family.type);
  if (!matched.length) return baseActions;
  const { rings = 2, spokes = 8 } = res;
  const out = baseActions.filter(a => a.type !== family.type);
  const groups = new Map(); // identity (all fields but the point) -> { rep, discrete[] }
  for (const a of matched) {
    const { [family.point]: _pt, ...id } = a;
    const key = JSON.stringify(id);
    let g = groups.get(key);
    if (!g) { g = { rep: a, discrete: [] }; groups.set(key, g); }
    g.discrete.push(a);
  }
  for (const { rep, discrete } of groups.values()) {
    const o = family.origin(rep);
    const pts = o
      ? movePointLattice(o.x, o.y, o.range, (x, y) => family.isLegal(rep, x, y), rings, spokes)
      : [];
    if (pts.length) for (const p of pts) out.push({ ...rep, [family.point]: p });
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
