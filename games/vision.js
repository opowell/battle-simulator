// vision.js — engine-side field-of-vision, shared by a game's getVisibleState (the
// observation function) and its belief.js (the fog sampler). Keeping both on ONE predicate
// is what stops the two from drifting apart — the belief must hide exactly the tiles the
// observation hides, or the Obscuro AI places phantom enemies on squares we can already see
// (see project-fog-obscuro's "known crash class"). Previously each game hand-duplicated a
// `VISION` constant + Chebyshev test in both files with a "// matches getVisibleState" hope.
//
// Same FoV semantics as the design UI's apps/design/vision.js, but server-side: it plugs in
// each game's own distance metric, line-of-sight test, and facing model.
//
//   • Facing off (viewer.facing == null, or fov ≥ 360) ⇒ a full disc — identical to the old
//     omnidirectional radius, so face-less games are behaviour-identical.
//   • Facing on ⇒ a cone of `fovDegrees` (a game opts in by setting cfg.fovDegrees; a unit
//     needs a heading in `unit.facing`, screen-space radians = atan2(dy,dx), +y down).
//
// Overridable at the game level (cfg.fovDegrees / cfg.range) and unit level (unit.fov /
// unit.visionRange). Coordinates are plain numbers — callers on continuous (BigNumber) games
// convert with coord.js `num()` before handing a viewer/point in.

const TAU = Math.PI * 2;

// Smallest absolute angle between two headings (radians), in [0, PI].
function angleDelta(a, b) {
  let d = Math.abs(a - b) % TAU;
  if (d > Math.PI) d = TAU - d;
  return d;
}

// Distance metrics a game can pick via cfg.metric (default: Chebyshev).
export const chebyshev = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
export const euclidean = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
export const manhattan = (ax, ay, bx, by) => Math.abs(ax - bx) + Math.abs(ay - by);

// FoV width in degrees for a viewer: unit override → game default → 360 (omnidirectional).
export function resolveFov(cfg, viewer) {
  if (viewer && viewer.fov != null) return viewer.fov;
  if (cfg && cfg.fovDegrees != null) return cfg.fovDegrees;
  return 360;
}

// Sight radius: unit override → game default (cfg.range).
export function resolveRange(cfg, viewer) {
  if (viewer && viewer.visionRange != null) return viewer.visionRange;
  return cfg.range;
}

// Can `viewer` (numeric x,y, optional facing/fov/visionRange) see the point (tx,ty)?
// cfg: { range, fovDegrees?, metric?(default Chebyshev), hasLOS?(ax,ay,bx,by)=>bool }.
export function seesPoint(viewer, tx, ty, cfg) {
  const metric = cfg.metric ?? chebyshev;
  if (metric(viewer.x, viewer.y, tx, ty) > resolveRange(cfg, viewer)) return false;
  if (cfg.hasLOS && !cfg.hasLOS(viewer.x, viewer.y, tx, ty)) return false;
  const fov = resolveFov(cfg, viewer);
  if (fov >= 360 || viewer.facing == null) return true;
  const dx = tx - viewer.x, dy = ty - viewer.y;
  if (dx === 0 && dy === 0) return true; // own square is always seen
  return angleDelta(Math.atan2(dy, dx), viewer.facing) <= (fov * Math.PI / 180) / 2;
}

// Player-level vision: can ANY of the viewers see the point (the union of unit vision).
export function anySeesPoint(viewers, tx, ty, cfg) {
  return viewers.some(v => seesPoint(v, tx, ty, cfg));
}

// Build the lightweight viewer objects seesPoint wants from real units. `numXY(position)`
// returns [x,y] as numbers (identity for grid games, coord.js num() for continuous ones).
export function viewersOf(units, teamId, cfg, numXY) {
  return units
    .filter(u => u.alive && u.ownerId === teamId)
    .map(u => { const [x, y] = numXY(u.position); return { x, y, facing: u.facing, fov: u.fov, visionRange: u.visionRange }; });
}

// getVisibleState helper: keep every own unit, plus each enemy any own unit can see.
export function filterVisibleUnits(units, teamId, cfg, numXY) {
  const viewers = viewersOf(units, teamId, cfg, numXY);
  return units.filter(u => {
    if (u.ownerId === teamId) return true;
    const [x, y] = numXY(u.position);
    return anySeesPoint(viewers, x, y, cfg);
  });
}

// Initial spawn heading: face the centroid of enemy (different-owner, live) units, so a unit
// starts oriented toward the action instead of blind on one flank. `numXY(position)` → [x,y].
// Returns the unit's existing facing (or 0) when there are no enemies to face.
export function facingTowardEnemies(unit, allUnits, numXY) {
  const [ux, uy] = numXY(unit.position);
  let sx = 0, sy = 0, n = 0;
  for (const e of allUnits) {
    if (e.ownerId === unit.ownerId || e.alive === false) continue;
    const [ex, ey] = numXY(e.position); sx += ex; sy += ey; n++;
  }
  if (!n) return unit.facing ?? 0;
  return Math.atan2(sy / n - uy, sx / n - ux);
}

// Set every unit's facing toward the enemy centroid (see facingTowardEnemies).
export function orientToEnemies(units, numXY) {
  return units.map(u => ({ ...u, facing: facingTowardEnemies(u, units, numXY) }));
}

export const _internal = { angleDelta };
