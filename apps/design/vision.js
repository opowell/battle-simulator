// vision.js — field-of-vision / fog-of-war geometry for the design battlefield.
//
// Loaded as a classic global <script> in index.html (like data.js/api.js) — this repo's
// no-bundler UI runs .vue files through vue3-sfc-loader, which CANNOT parse `import`/
// `export` inside a plain .js, so helper code is shared via a real global instead. Every
// function is pure (no DOM / no live state), and the whole API is published on `VISION`
// (see the tail of this file) so it works two ways from one file:
//   • browser  — the classic <script> assigns window.VISION; SFCs call VISION.foo(...)
//   • node     — `await import('./vision.js')` runs the tail, exposing globalThis.VISION
//                for the unit tests (see vision.test.js). No build step, no duplication.
//
// Vision is computed at two levels (see the task spec):
//   • unit level   — each unit sees a region: a full disc (no facing) or a
//                    facing-limited sector (a "cone").
//   • player level — the union of that player's units' regions.
// Fog is the complement of the shown vision. Which vision is shown is chosen by
// the caller: a selected unit's own vision, or the whole player's union.
//
// Config resolution, most specific wins:
//   FoV degrees:  unit.fov  →  field.ui.fovDegrees  →  (facing on ? 90 : 360)
//   range:        unit.visionRange  →  field.ui.visionRange  →  board-size default
// "facing on" is field.ui.showFacing !== false (the existing repo convention —
// chess/civ1/xcom/sc1/kdice turn it off, so those units see a full 360° disc).

const TAU = Math.PI * 2;

// Smallest absolute angle between two headings (radians), in [0, PI].
function angleDelta(a, b) {
  let d = Math.abs(a - b) % TAU;
  if (d > Math.PI) d = TAU - d;
  return d;
}

function facingOn(field) {
  return field?.ui?.showFacing !== false;
}

// FoV half-cone in degrees for a unit. Facing off ⇒ 360 (full disc). Facing on ⇒
// 90 by default, overridable at the game level (field.ui.fovDegrees) and per unit
// (unit.fov). A per-unit/game override still applies while facing is on.
function resolveFov(field, unit) {
  if (unit && unit.fov != null) return unit.fov;
  if (field?.ui?.fovDegrees != null) return field.ui.fovDegrees;
  return facingOn(field) ? 90 : 360;
}

// Sight radius in world units. Defaults to a fraction of the larger board side so
// it scales with map size; overridable at the game (field.ui.visionRange) and unit
// (unit.visionRange) level.
function resolveRange(field, unit) {
  if (unit && unit.visionRange != null) return unit.visionRange;
  if (field?.ui?.visionRange != null) return field.ui.visionRange;
  const w = field?.world?.w ?? 10, h = field?.world?.h ?? 10;
  return Math.max(w, h) * 0.3;
}

// Heading a unit's cone points along, or null when the unit sees omnidirectionally
// (facing globally off, or the unit has no known heading). `ang` is screen-space
// radians (atan2 in fit coordinates, +y downward) — the same convention the facing
// arrow uses in SchematicLayer.
function unitHeading(field, unit) {
  if (!facingOn(field)) return null;
  return unit?.ang ?? null;
}

// Is world point (px,py) visible to `unit`? Radius test, then (for a cone) an
// angular test against the unit's heading.
function pointVisibleToUnit(field, unit, px, py) {
  const range = resolveRange(field, unit);
  const dx = px - unit.x, dy = py - unit.y;
  const dist = Math.hypot(dx, dy);
  if (dist > range) return false;
  const fov = resolveFov(field, unit);
  if (fov >= 360) return true;
  if (dist === 0) return true; // own square is always visible
  const heading = unitHeading(field, unit);
  if (heading == null) return true; // no facing ⇒ omnidirectional
  const target = Math.atan2(dy, dx);
  return angleDelta(target, heading) <= (fov * Math.PI / 180) / 2;
}

// The units whose vision is shown: a single selected unit if one is given and it
// belongs to the viewer, otherwise every live unit belonging to the viewer.
// `viewerId` null means "the friendly side" (units flagged u.friendly).
function visionSources(units, viewerId, selectedId) {
  const mine = (u) => (viewerId == null ? u.friendly : u.team === viewerId) && !u.dead;
  if (selectedId != null) {
    const sel = units.find(u => u.id === selectedId && mine(u));
    if (sel) return [sel];
  }
  return units.filter(mine);
}

// Discrete grids: the set of "x,y" tile keys any source unit can see. Fog is every
// other in-bounds tile.
function visibleTileSet(field, sources) {
  const W = field.world.w, H = field.world.h;
  const vis = new Set();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cx = x + 0.5, cy = y + 0.5;
      if (sources.some(u => pointVisibleToUnit(field, u, cx, cy))) vis.add(`${x},${y}`);
    }
  }
  return vis;
}

// Continuous maps: a renderable descriptor of one unit's vision region — a full
// 'circle' (omnidirectional) or a 'sector' (facing cone). Coordinates are in world
// units; the layer maps them to pixels via its fitter.
function unitVisionRegion(field, unit) {
  const range = resolveRange(field, unit);
  const fov = resolveFov(field, unit);
  const heading = unitHeading(field, unit);
  if (fov >= 360 || heading == null) {
    return { kind: 'circle', cx: unit.x, cy: unit.y, r: range };
  }
  return { kind: 'sector', cx: unit.x, cy: unit.y, r: range, ang: heading, fov: fov * Math.PI / 180 };
}

function visionRegions(field, sources) {
  return sources.map(u => unitVisionRegion(field, u));
}

// SVG arc path for a sector (pie wedge) centred at (cx,cy), radius r, pointing
// along `ang` with total angular width `fov` (radians). Screen-space coords, so
// sweep-flag 1 traces from ang-fov/2 to ang+fov/2 the short way.
function sectorPath(cx, cy, r, ang, fov) {
  const a0 = ang - fov / 2, a1 = ang + fov / 2;
  const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
  const largeArc = fov > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${largeArc} 1 ${x1} ${y1} Z`;
}

// Public API. Attached to the global so both the browser (window.VISION, via the classic
// <script>) and node (globalThis.VISION, via dynamic import in the test) see the same object.
const VISION = {
  facingOn, resolveFov, resolveRange, unitHeading,
  pointVisibleToUnit, visionSources, visibleTileSet,
  unitVisionRegion, visionRegions, sectorPath,
  _internal: { angleDelta, TAU },
};
(typeof window !== 'undefined' ? window : globalThis).VISION = VISION;
