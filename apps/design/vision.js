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

// ── line-of-sight occlusion ─────────────────────────────────────────────────────
// A game whose terrain blocks sight (walls, dense woods) publishes the set of opaque
// tiles the engine's LOS already blocks on (games/*/map.js hasLOS) as field.los.blocked
// — an array (or Set) of "x,y" integer tile keys. When present, vision stops at those
// tiles both in the discrete tile test (pointVisibleToUnit) and the smooth continuous
// veil (unitVisionRegion raycasts against the same grid). Absent ⇒ no occlusion, the
// original radius/cone behaviour.
function blockedSet(field) {
  const b = field?.los?.blocked;
  if (!b) return null;
  return b instanceof Set ? b : new Set(b);
}

// Grid line-of-sight between two world points: false if a blocked tile lies strictly
// between the endpoints. Mirrors the engine's Bresenham LOS (e.g. games/doom/map.js
// hasLOS) so the rendered fog matches the server's — snap to the tile each point sits in.
function hasLineOfSight(blocked, x0, y0, x1, y1) {
  x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.floor(x1); y1 = Math.floor(y1);
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, cx = x0, cy = y0;
  while (cx !== x1 || cy !== y1) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; cx += sx; }
    if (e2 <  dx) { err += dx; cy += sy; }
    if (cx === x1 && cy === y1) break;
    if (blocked.has(`${cx},${cy}`)) return false;
  }
  return true;
}

// ── exact visibility polygon geometry ───────────────────────────────────────────
// The occluded vision region is computed exactly (no ray fan): rays are cast only to
// the corners of the wall silhouette and to where walls cross the sight-range circle,
// each hit is the exact ray↔segment intersection, and the open far boundary is drawn
// as true circular arcs. So the polygon's vertices are precise geometric points, not
// samples.

// Wall silhouette as world-space segments [ax,ay,bx,by]: a blocked tile contributes an
// edge only where it borders an open tile (the visible wall face), and contiguous
// collinear faces are merged into one segment so only real corners survive. Restricted
// to a box of half-size `reach` around (ox,oy) since nothing further can be seen.
function wallSegments(blocked, ox, oy, reach) {
  const isB = (x, y) => blocked.has(`${x},${y}`);
  const vEdges = new Map(); // x → set of y  (unit face (x,y)–(x,y+1))
  const hEdges = new Map(); // y → set of x  (unit face (x,y)–(x+1,y))
  const add = (m, key, val) => { let s = m.get(key); if (!s) { s = new Set(); m.set(key, s); } s.add(val); };
  const minX = Math.floor(ox - reach) - 1, maxX = Math.ceil(ox + reach) + 1;
  const minY = Math.floor(oy - reach) - 1, maxY = Math.ceil(oy + reach) + 1;
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      if (!isB(x, y)) continue;
      if (!isB(x - 1, y)) add(vEdges, x,     y); // left face
      if (!isB(x + 1, y)) add(vEdges, x + 1, y); // right face
      if (!isB(x, y - 1)) add(hEdges, y,     x); // top face
      if (!isB(x, y + 1)) add(hEdges, y + 1, x); // bottom face
    }
  const segs = [];
  const mergeRuns = (m, build) => {
    for (const [key, vals] of m) {
      const arr = [...vals].sort((a, b) => a - b);
      for (let i = 0; i < arr.length; ) {
        let j = i; while (j + 1 < arr.length && arr[j + 1] === arr[j] + 1) j++;
        segs.push(build(key, arr[i], arr[j] + 1));
        i = j + 1;
      }
    }
  };
  mergeRuns(vEdges, (x, y0, y1) => [x, y0, x, y1]);
  mergeRuns(hEdges, (y, x0, x1) => [x0, y, x1, y]);
  return segs;
}

// Ray (origin O, unit dir d) ↔ segment AB: the ray parameter t (= world distance, d is
// a unit vector) of the intersection, or Infinity if they don't cross ahead of O.
function raySegT(ox, oy, dx, dy, seg) {
  const [ax, ay, bx, by] = seg;
  const sx = bx - ax, sy = by - ay;
  const denom = dx * sy - dy * sx;
  if (Math.abs(denom) < 1e-12) return Infinity; // parallel
  const t = ((ax - ox) * sy - (ay - oy) * sx) / denom;
  const u = ((ax - ox) * dy - (ay - oy) * dx) / denom;
  if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) return t;
  return Infinity;
}

// Angles (screen-space radians) at which segment AB crosses the range circle of radius R
// about O — the exact points where a wall boundary hands off to the open range arc.
function segCircleAngles(seg, ox, oy, R) {
  const [ax, ay, bx, by] = seg;
  const dx = bx - ax, dy = by - ay;
  const fx = ax - ox, fy = ay - oy;
  const A = dx * dx + dy * dy;
  if (A === 0) return [];
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - R * R;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return [];
  const sq = Math.sqrt(disc);
  const out = [];
  for (const u of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)])
    if (u >= 0 && u <= 1) out.push(Math.atan2(ay + u * dy - oy, ax + u * dx - ox));
  return out;
}

// The surface a ray at angle `a` first meets: the nearest wall segment, or null when the
// sight-range circle (radius R) is reached first (an open arc boundary).
function closestSeg(ox, oy, a, segs, R) {
  const dx = Math.cos(a), dy = Math.sin(a);
  let best = R, seg = null;
  for (const s of segs) {
    const t = raySegT(ox, oy, dx, dy, s);
    if (t < best) { best = t; seg = s; }
  }
  return seg;
}

// Exact boundary point where ray `a` meets a known surface: the ray∩segment intersection,
// or the point on the range circle when `seg` is null.
function boundaryPoint(ox, oy, a, seg, R) {
  const dx = Math.cos(a), dy = Math.sin(a);
  if (!seg) return { x: ox + dx * R, y: oy + dy * R };
  const t = raySegT(ox, oy, dx, dy, seg);
  const d = t === Infinity ? R : Math.min(t, R);
  return { x: ox + dx * d, y: oy + dy * d };
}

// Is world point (px,py) visible to `unit`? Radius test, then (for a cone) an
// angular test against the unit's heading, then (if the map occludes) a line-of-sight
// test against opaque tiles.
function pointVisibleToUnit(field, unit, px, py) {
  const range = resolveRange(field, unit);
  const dx = px - unit.x, dy = py - unit.y;
  const dist = Math.hypot(dx, dy);
  if (dist > range) return false;
  const fov = resolveFov(field, unit);
  const heading = unitHeading(field, unit);
  if (dist === 0) return true; // own square is always visible
  if (fov < 360 && heading != null) {
    const target = Math.atan2(dy, dx);
    if (angleDelta(target, heading) > (fov * Math.PI / 180) / 2) return false;
  }
  const blocked = blockedSet(field);
  if (blocked && !hasLineOfSight(blocked, unit.x, unit.y, px, py)) return false;
  return true;
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

// Exact visibility polygon for an occluded map (angular sweep, no epsilon nudging): the
// event angles are the wall corners and wall↔range-circle crossings. Between two
// consecutive events the nearest surface cannot change — wall segments meet only at their
// endpoints, which are themselves events — so each angular gap's boundary is a single
// element (one wall segment, or the open range circle) and the gap's two ends are the
// EXACT ray∩element intersections. Where the governing element changes across an event,
// the two exact points at that shared angle differ and form the silhouette shadow edge —
// so shadows are precise, not offset by a nudge. Returns the boundary as an ordered vertex
// list; `apex` (the unit) closes a cone wedge with two straight sides. Returns null when
// no wall is near enough to occlude, so the caller falls back to the plain circle/sector.
function occludedRegion(blocked, ox, oy, range, full, heading, fovRad) {
  const segs = wallSegments(blocked, ox, oy, range);
  if (!segs.length) return null;

  const aStart = full ? 0 : heading - fovRad / 2;
  const span   = full ? TAU : fovRad;
  const TOL = 1e-9;
  const norm = (a) => { let d = (a - aStart) % TAU; if (d < 0) d += TAU; return d; };

  const evSet = [];
  const addEv = (a) => {
    const n = norm(a);
    if (full || n <= span + 1e-7) evSet.push(full ? n : Math.min(Math.max(n, 0), span));
  };
  for (const s of segs) {
    addEv(Math.atan2(s[1] - oy, s[0] - ox));
    addEv(Math.atan2(s[3] - oy, s[2] - ox));
    for (const a of segCircleAngles(s, ox, oy, range)) addEv(a);
  }
  if (!full) { addEv(aStart); addEv(aStart + span); }
  evSet.sort((a, b) => a - b);
  const ev = [];
  for (const n of evSet) if (!ev.length || n - ev[ev.length - 1] > TOL) ev.push(n);
  if (ev.length < 2) return null;
  if (full) ev.push(ev[0] + TAU); // wrap the cycle closed

  const points = [];
  for (let i = 0; i < ev.length - 1; i++) {
    const n0 = ev[i], n1 = ev[i + 1], width = n1 - n0;
    if (width <= TOL) continue;
    const gov = closestSeg(ox, oy, aStart + (n0 + n1) / 2, segs, range);
    const isArc = gov ? 0 : 1;
    const ps = boundaryPoint(ox, oy, aStart + n0, gov, range);
    const pe = boundaryPoint(ox, oy, aStart + n1, gov, range);
    // Edge into ps is the straight shadow/cone edge; edge into pe follows the governing
    // element — a circular range arc when open, else the straight wall face.
    points.push({ x: ps.x, y: ps.y, arc: 0, large: 0 });
    points.push({ x: pe.x, y: pe.y, arc: isArc, large: isArc && width > Math.PI ? 1 : 0 });
  }
  if (points.length < 2) return null;
  return { kind: 'polyarc', apex: full ? null : { x: ox, y: oy }, r: range, points };
}

// ── exact SHAPE-based occlusion (rects + axis-aligned ovals) ─────────────────────
// The tile version above rasterizes walls to a grid; this one occludes against the map's
// TRUE authored geometry (field.los.openShapes = the floor is the union of these shapes,
// walls are the complement — doom; or field.los.blockShapes = these shapes block sight —
// cs). So a room whose real entrance is a narrow oval cusp occludes correctly instead of
// the rasterized opening looking wide. Same exact angular sweep as the wall version, but
// each ray's boundary is found by analytic ray∩shape intersection, and oval-bounded edges
// are tessellated into exact on-curve points (SVG can't draw an arbitrary run cheaply).

// Ray (origin, unit dir) ∩ axis-aligned rect / oval → inside-interval {tin,tout} or null.
function rayRectIv(ox, oy, dx, dy, s) {
  let tmin = -Infinity, tmax = Infinity;
  if (Math.abs(dx) < 1e-12) { if (ox < s.x || ox > s.x + s.w) return null; }
  else { let t1 = (s.x - ox) / dx, t2 = (s.x + s.w - ox) / dx; if (t1 > t2) [t1, t2] = [t2, t1]; tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); }
  if (Math.abs(dy) < 1e-12) { if (oy < s.y || oy > s.y + s.h) return null; }
  else { let t1 = (s.y - oy) / dy, t2 = (s.y + s.h - oy) / dy; if (t1 > t2) [t1, t2] = [t2, t1]; tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); }
  if (tmin > tmax) return null;
  return { tin: tmin, tout: tmax };
}
function rayOvalIv(ox, oy, dx, dy, s) {
  const a = s.w / 2, b = s.h / 2, cx = s.x + a, cy = s.y + b;
  const nx = (ox - cx) / a, ny = (oy - cy) / b, ndx = dx / a, ndy = dy / b;
  const A = ndx * ndx + ndy * ndy, B = 2 * (nx * ndx + ny * ndy), C = nx * nx + ny * ny - 1;
  if (A === 0) return null;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t1 = (-B - sq) / (2 * A), t2 = (-B + sq) / (2 * A);
  if (t1 > t2) [t1, t2] = [t2, t1];
  return { tin: t1, tout: t2 };
}
function rayShapeIv(ox, oy, dx, dy, s) {
  return s.shape === 'oval' ? rayOvalIv(ox, oy, dx, dy, s) : rayRectIv(ox, oy, dx, dy, s);
}

// Distance the ray stays "clear" and the boundary element it stops on. open mode: clear
// while inside the floor union, so the exit is the end of the covered run from t=0. block
// mode: clear until the first shape is entered. gov identifies the governing shape (for
// its boundary curve) or the range circle.
function shapeExit(ox, oy, ang, shapes, R, mode) {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const ivs = [];
  for (const s of shapes) {
    const iv = rayShapeIv(ox, oy, dx, dy, s);
    if (iv && iv.tout > 1e-9) { iv.shape = s; ivs.push(iv); }
  }
  if (mode === 'block') {
    let best = R, gov = { kind: 'range' };
    for (const iv of ivs) if (iv.tin > 1e-9 && iv.tin < best) { best = iv.tin; gov = { kind: 'shape', shape: iv.shape, entry: true }; }
    return { dist: best, gov };
  }
  // open (union): the ray must start inside the floor.
  let covered0 = false;
  for (const iv of ivs) if (iv.tin <= 1e-9) { covered0 = true; break; }
  if (!covered0) return null;
  let cur = 0, govShape = null;
  for (;;) {
    let bestEnd = cur, bg = govShape;
    for (const iv of ivs) if (iv.tin <= cur + 1e-9 && iv.tout > bestEnd) { bestEnd = iv.tout; bg = iv.shape; }
    if (bestEnd > cur + 1e-12) { cur = bestEnd; govShape = bg; if (cur >= R) break; } else break;
  }
  if (cur >= R) return { dist: R, gov: { kind: 'range' } };
  return { dist: cur, gov: { kind: 'shape', shape: govShape, entry: false } };
}

// Exact boundary point along `ang` on a known governing element.
function shapeBoundaryPoint(ox, oy, ang, gov, R) {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  if (gov.kind === 'range') return { x: ox + dx * R, y: oy + dy * R };
  const iv = rayShapeIv(ox, oy, dx, dy, gov.shape);
  let t = iv ? (gov.entry ? iv.tin : iv.tout) : R;
  t = Math.min(Math.max(t, 0), R);
  return { x: ox + dx * t, y: oy + dy * t };
}

// The tangent directions from O to an axis-aligned oval (silhouette angles) — the angular
// extent where the oval is crossed by rays. Empty when O is inside the oval.
function ovalTangentAngles(ox, oy, s) {
  const a = s.w / 2, b = s.h / 2, cx = s.x + a, cy = s.y + b;
  const ux = (ox - cx) / a, uy = (oy - cy) / b;
  const U = ux * ux + uy * uy;
  if (U <= 1 + 1e-9) return []; // inside
  const k = Math.sqrt(1 - 1 / U), inv = 1 / U, sU = Math.sqrt(U);
  const out = [];
  for (const sgn of [1, -1]) {
    const px = ux * inv + sgn * k * (-uy) / sU;
    const py = uy * inv + sgn * k * (ux) / sU;
    out.push(Math.atan2((cy + b * py) - oy, (cx + a * px) - ox));
  }
  return out;
}

// Angles where a segment crosses an oval boundary (entrance pinch points where a corridor
// meets a room), by solving the oval quadratic along the segment.
function segOvalAngles(ox, oy, x0, y0, x1, y1, s) {
  const a = s.w / 2, b = s.h / 2, cx = s.x + a, cy = s.y + b;
  const ex = x1 - x0, ey = y1 - y0;
  const nx = (x0 - cx) / a, ny = (y0 - cy) / b, ndx = ex / a, ndy = ey / b;
  const A = ndx * ndx + ndy * ndy, B = 2 * (nx * ndx + ny * ndy), C = nx * nx + ny * ny - 1;
  if (A === 0) return [];
  const disc = B * B - 4 * A * C;
  if (disc < 0) return [];
  const sq = Math.sqrt(disc);
  const out = [];
  for (const u of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)])
    if (u >= -1e-9 && u <= 1 + 1e-9) out.push(Math.atan2((y0 + u * ey) - oy, (x0 + u * ex) - ox));
  return out;
}

// Angles where the sight-range circle crosses an oval boundary (found numerically — a
// circle∩ellipse is quartic; scan the oval param and bisect sign changes of dist−R).
function rangeOvalAngles(ox, oy, s, R) {
  const a = s.w / 2, b = s.h / 2, cx = s.x + a, cy = s.y + b;
  const f = (ph) => Math.hypot(cx + a * Math.cos(ph) - ox, cy + b * Math.sin(ph) - oy) - R;
  const out = [];
  const N = 180;
  let prev = f(0), prevPh = 0;
  for (let i = 1; i <= N; i++) {
    const ph = (i / N) * TAU, cur = f(ph);
    if ((prev <= 0 && cur > 0) || (prev > 0 && cur <= 0)) {
      let lo = prevPh, hi = ph, flo = prev;
      for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2, fm = f(mid); if ((flo <= 0) === (fm <= 0)) { lo = mid; flo = fm; } else hi = mid; }
      const ph2 = (lo + hi) / 2;
      out.push(Math.atan2(cy + b * Math.sin(ph2) - oy, cx + a * Math.cos(ph2) - ox));
    }
    prev = cur; prevPh = ph;
  }
  return out;
}

function rectEdges(s) {
  return [
    [s.x, s.y, s.x + s.w, s.y], [s.x + s.w, s.y, s.x + s.w, s.y + s.h],
    [s.x + s.w, s.y + s.h, s.x, s.y + s.h], [s.x, s.y + s.h, s.x, s.y],
  ];
}

function shapeOccludedRegion(los, ox, oy, range, full, heading, fovRad) {
  const mode = los.openShapes ? 'open' : 'block';
  const shapes = los.openShapes || los.blockShapes;
  if (!shapes || !shapes.length) return null;
  if (mode === 'open' && !shapeExit(ox, oy, 0, shapes, range, mode)) return null; // viewer not on floor

  const aStart = full ? 0 : heading - fovRad / 2;
  const span = full ? TAU : fovRad;
  const TOL = 1e-9;
  const norm = (a) => { let d = (a - aStart) % TAU; if (d < 0) d += TAU; return d; };
  const evSet = [];
  const add = (a) => { const n = norm(a); if (full || (n >= -1e-7 && n <= span + 1e-7)) evSet.push(Math.min(Math.max(n, 0), span)); };

  // Seed events: exact geometric breakpoints (rect corners, oval silhouettes, corridor↔room
  // boundary crossings, range crossings) plus a coarse safety seed so no single gap starts
  // huge; the sweep below still subdivides adaptively wherever the governing element changes.
  for (const s of shapes) {
    if (s.shape === 'oval') {
      for (const a of ovalTangentAngles(ox, oy, s)) add(a);
      for (const a of rangeOvalAngles(ox, oy, s, range)) add(a);
    } else {
      for (const [cx, cy] of [[s.x, s.y], [s.x + s.w, s.y], [s.x, s.y + s.h], [s.x + s.w, s.y + s.h]]) add(Math.atan2(cy - oy, cx - ox));
    }
    for (const e of rectEdges(s.shape === 'oval' ? { x: s.x, y: s.y, w: s.w, h: s.h } : s)) {
      for (const a of segCircleAngles(e, ox, oy, range)) add(a); // range ∩ this shape's bbox edges
    }
    // crossings between this shape and every oval (corridor↔room entrances)
    for (const o of shapes) {
      if (o === s || o.shape !== 'oval') continue;
      const edges = s.shape === 'oval' ? rectEdges(s) : rectEdges(s);
      for (const e of edges) for (const a of segOvalAngles(ox, oy, e[0], e[1], e[2], e[3], o)) add(a);
    }
  }
  const STEP = Math.PI / 12;
  for (let n = 0; n <= span + TOL; n += STEP) add(aStart + n);
  if (!full) { add(aStart); add(aStart + span); }

  evSet.sort((a, b) => a - b);
  const ev = [];
  for (const n of evSet) if (!ev.length || n - ev[ev.length - 1] > 1e-7) ev.push(n);
  if (ev.length < 2) return null;
  if (full) ev.push(ev[0] + TAU);

  const govKey = (g) => !g ? 'X' : g.kind === 'range' ? 'R' : 'S' + shapes.indexOf(g.shape);
  const points = [];
  const emitGap = (n0, n1, depth) => {
    const nm = (n0 + n1) / 2;
    const rm = shapeExit(ox, oy, aStart + nm, shapes, range, mode);
    if (!rm) return;
    const gov = rm.gov;
    // Adaptive: if the governing element isn't consistent across the gap, split to locate
    // the transition precisely (guards against any breakpoint the seeds missed).
    if (depth < 24 && (n1 - n0) > 1e-4) {
      const r0 = shapeExit(ox, oy, aStart + n0, shapes, range, mode);
      const r1 = shapeExit(ox, oy, aStart + n1, shapes, range, mode);
      if ((r0 && govKey(r0.gov) !== govKey(gov)) || (r1 && govKey(r1.gov) !== govKey(gov))) {
        emitGap(n0, nm, depth + 1); emitGap(nm, n1, depth + 1); return;
      }
    }
    const ps = shapeBoundaryPoint(ox, oy, aStart + n0, gov, range);
    points.push({ x: ps.x, y: ps.y, arc: 0, large: 0 });
    if (gov.kind === 'range') {
      const pe = shapeBoundaryPoint(ox, oy, aStart + n1, gov, range);
      points.push({ x: pe.x, y: pe.y, arc: 1, large: (n1 - n0) > Math.PI ? 1 : 0 });
    } else if (gov.shape.shape === 'oval') {
      // Tessellate the oval-bounded edge into exact on-curve points.
      const steps = Math.max(1, Math.ceil((n1 - n0) / 0.05));
      for (let k = 1; k <= steps; k++) {
        const p = shapeBoundaryPoint(ox, oy, aStart + n0 + (n1 - n0) * k / steps, gov, range);
        points.push({ x: p.x, y: p.y, arc: 0, large: 0 });
      }
    } else {
      const pe = shapeBoundaryPoint(ox, oy, aStart + n1, gov, range);
      points.push({ x: pe.x, y: pe.y, arc: 0, large: 0 });
    }
  };
  for (let i = 0; i < ev.length - 1; i++) if (ev[i + 1] - ev[i] > TOL) emitGap(ev[i], ev[i + 1], 0);
  if (points.length < 2) return null;
  return { kind: 'polyarc', apex: full ? null : { x: ox, y: oy }, r: range, points };
}

// Continuous maps: a renderable descriptor of one unit's vision region — a full
// 'circle' (omnidirectional) or a 'sector' (facing cone) on open maps, or an exact
// wall-occluded 'polyarc' when the map supplies line-of-sight blockers. Coordinates
// are in world units; the layer maps them to pixels via its fitter.
function unitVisionRegion(field, unit) {
  const range = resolveRange(field, unit);
  const fov = resolveFov(field, unit);
  const heading = unitHeading(field, unit);
  const full = fov >= 360 || heading == null;
  const fovRad = fov * Math.PI / 180;
  const los = field?.los;
  if (los && (los.openShapes || los.blockShapes)) {
    const region = shapeOccludedRegion(los, unit.x, unit.y, range, full, heading, fovRad);
    if (region) return region;
  }
  const blocked = blockedSet(field);
  if (blocked) {
    const region = occludedRegion(blocked, unit.x, unit.y, range, full, heading, fovRad);
    if (region) return region;
  }
  if (full) return { kind: 'circle', cx: unit.x, cy: unit.y, r: range };
  return { kind: 'sector', cx: unit.x, cy: unit.y, r: range, ang: heading, fov: fovRad };
}

function visionRegions(field, sources) {
  return sources.map(u => unitVisionRegion(field, u));
}

// Continuous straight-line-slide movement can only reach points on an unobstructed
// straight line within the move budget — geometrically the same wall-occluded region as
// omnidirectional vision. So the move-reach indicator reuses the exact-polygon machinery:
// a full-circle occluded region (radius = move budget) when the map has wall blockers,
// else a plain circle. Keeps the reachable overlay from over-promising through walls.
function reachRegion(field, x, y, radius) {
  const los = field?.los;
  if (los && (los.openShapes || los.blockShapes)) {
    const region = shapeOccludedRegion(los, x, y, radius, true, null, TAU);
    if (region) return region;
  }
  const blocked = blockedSet(field);
  if (blocked) {
    const region = occludedRegion(blocked, x, y, radius, true, null, TAU);
    if (region) return region;
  }
  return { kind: 'circle', cx: x, cy: y, r: radius };
}

// SVG path 'd' (in pixel space, via a `fit` with x()/y()/len()) for a 'sector' or
// 'polyarc' region — the shared renderer for the fog veil and the move-reach overlay.
// (A 'circle' region is better drawn as an <circle> element, so it's handled by callers.)
function regionPath(region, fit) {
  if (region.kind === 'sector')
    return sectorPath(fit.x(region.cx), fit.y(region.cy), fit.len(region.r), region.ang, region.fov);
  const pr = fit.len(region.r);
  const P = region.points.map(p => ({ X: fit.x(p.x), Y: fit.y(p.y), arc: p.arc, large: p.large }));
  let d = region.apex
    ? `M ${fit.x(region.apex.x)} ${fit.y(region.apex.y)} L ${P[0].X} ${P[0].Y}`
    : `M ${P[0].X} ${P[0].Y}`;
  for (let i = 1; i < P.length; i++)
    d += P[i].arc ? ` A ${pr} ${pr} 0 ${P[i].large} 1 ${P[i].X} ${P[i].Y}` : ` L ${P[i].X} ${P[i].Y}`;
  return d + ' Z';
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

// "Choose a direction" target resolution for aimed actions with discrete candidates
// (see Battlefield.vue's startAim / handleSqClick and SchematicLayer.vue's aiming
// overlay preview): among `candidates` (each with .x/.y, e.g. legal 'shoot' actions'
// target units), returns whichever's bearing from (ox,oy) is closest to the bearing
// of the clicked/hovered (px,py) — "aim toward" rather than "click exactly on".
// Shared by the click handler and the hover preview so they always agree on the same
// target; null if candidates is empty.
function nearestBearing(ox, oy, px, py, candidates) {
  const ang = Math.atan2(py - oy, px - ox);
  let best = null, bestDiff = Infinity;
  for (const c of candidates) {
    const diff = angleDelta(ang, Math.atan2(c.y - oy, c.x - ox));
    if (diff < bestDiff) { bestDiff = diff; best = c; }
  }
  return best;
}

// Public API. Attached to the global so both the browser (window.VISION, via the classic
// <script>) and node (globalThis.VISION, via dynamic import in the test) see the same object.
const VISION = {
  facingOn, resolveFov, resolveRange, unitHeading,
  pointVisibleToUnit, visionSources, visibleTileSet,
  unitVisionRegion, visionRegions, sectorPath, reachRegion, regionPath,
  nearestBearing,
  _internal: { angleDelta, TAU, blockedSet, hasLineOfSight, wallSegments, raySegT, segCircleAngles, closestSeg, boundaryPoint, occludedRegion,
    rayShapeIv, shapeExit, shapeOccludedRegion, ovalTangentAngles },
};
(typeof window !== 'undefined' ? window : globalThis).VISION = VISION;
