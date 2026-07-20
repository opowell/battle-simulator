// Non-grid terrain primitives shared by shape-based scenarios (Counter-Strike,
// Combat Mission). Instead of a tile grid, a map's terrain is authored as an array
// of shapes — for now rectangles and ovals — positioned freely in board-cell
// coordinates. Each shape is:
//
//   { shape: 'rect' | 'oval', x, y, w, h, kind, ... }
//
// where (x, y) is the top-left of the shape's bounding box and (w, h) its size.
// For an oval the bounding box defines an ellipse centred at (x+w/2, y+h/2).
//
// Games rasterize these shapes onto their existing tile grid so movement, LOS and
// the rest of the mechanics keep working unchanged, and pass render-ready copies to
// the client, which draws them as layered SVGs (see SchematicLayer.vue).

// ── Exactness contract ───────────────────────────────────────────────────────────
// Every routine below computes EXACT geometry (float64) — never a sampled, hull-bounded
// or otherwise approximate answer. When an input makes that impossible the code THROWS
// rather than silently degrading: a wrong-but-plausible LOS/movement result is far worse
// than a loud failure, because it silently desyncs what the engine resolves from what the
// player is shown. Callers must therefore only ever hand these functions shapes they can
// be resolved exactly against: 'rect' (or no `shape`, meaning rect), 'oval', or a CONVEX
// 'poly'.

const SHAPE_KINDS = new Set(['rect', 'oval', 'poly']);

function shapeKind(s, where) {
  const kind = s.shape ?? 'rect';
  if (!SHAPE_KINDS.has(kind))
    throw new Error(`terrainShapes.${where}: unsupported shape '${kind}'. Exact geometry is defined only for ${[...SHAPE_KINDS].join('/')} — a shape that cannot be resolved exactly must not reach an LOS/movement test.`);
  return kind;
}

// Throws unless `points` is a strictly convex, non-degenerate simple polygon. Convexity is
// the precondition for rayPolyIv's Cyrus–Beck half-plane clip being EXACT: on a concave
// polygon that clip yields the convex hull's outer bounds, which would over-block sight.
// Rather than accept that approximation we refuse it — split concave terrain into convex
// pieces at authoring time.
export function assertConvexPoly(points, label = 'poly') {
  if (!Array.isArray(points) || points.length < 3)
    throw new Error(`${label}: a polygon needs at least 3 points, got ${points?.length ?? 0} — cannot be resolved exactly.`);
  const n = points.length;
  let sign = 0, area2 = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n], c = points[(i + 2) % n];
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y))
      throw new Error(`${label}: non-finite vertex at index ${i} — cannot be resolved exactly.`);
    const ex = b.x - a.x, ey = b.y - a.y;
    if (Math.abs(ex) < 1e-12 && Math.abs(ey) < 1e-12)
      throw new Error(`${label}: zero-length edge at vertex ${i} — cannot be resolved exactly.`);
    const cross = ex * (c.y - b.y) - ey * (c.x - b.x);
    if (Math.abs(cross) > 1e-9) {
      const s = Math.sign(cross);
      if (sign === 0) sign = s;
      else if (s !== sign)
        throw new Error(`${label}: polygon is CONCAVE at vertex ${(i + 1) % n}. Exact ray/poly LOS (Cyrus–Beck) requires a convex polygon — split this shape into convex pieces.`);
    }
    area2 += a.x * b.y - b.x * a.y;
  }
  if (Math.abs(area2) < 1e-9)
    throw new Error(`${label}: degenerate zero-area polygon — cannot be resolved exactly.`);
  return points;
}

// Convexity is validated once per distinct points array, then remembered — the check is
// O(n) and the ray routines run in hot LOS loops. Keyed on the array (shared by reference
// from the authored shape through csLosBlockers etc.), not the wrapper object.
const convexChecked = new WeakSet();
function ensureConvex(points) {
  if (convexChecked.has(points)) return;
  assertConvexPoly(points);
  convexChecked.add(points);
}

// Axis-aligned bounding box { x, y, w, h } of any primitive. Rect/oval already carry it;
// a poly's is derived from its points so shared code (rasterization, extent queries) can
// treat every shape uniformly without special-casing the vertex list.
export function shapeBBox(s) {
  if (shapeKind(s, 'shapeBBox') === 'poly') {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of s.points) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  return { x: s.x, y: s.y, w: s.w, h: s.h };
}

// True when the point (px, py) lies inside the shape.
export function pointInShape(s, px, py) {
  const kind = shapeKind(s, 'pointInShape');
  if (kind === 'oval') {
    const rx = s.w / 2, ry = s.h / 2;
    if (rx <= 0 || ry <= 0) return false;
    const nx = (px - (s.x + rx)) / rx;
    const ny = (py - (s.y + ry)) / ry;
    return nx * nx + ny * ny <= 1;
  }
  if (kind === 'poly') {
    // Standard ray-casting point-in-polygon test over s.points ({x,y}[]).
    let inside = false;
    for (let i = 0, j = s.points.length - 1; i < s.points.length; j = i++) {
      const { x: xi, y: yi } = s.points[i], { x: xj, y: yj } = s.points[j];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  // rectangle (default)
  return px >= s.x && px <= s.x + s.w && py >= s.y && py <= s.y + s.h;
}

// ── exact continuous line-of-sight against shape geometry ────────────────────────
// The engine's LOS/reveal used to snap to a rasterized tile grid (see each game's old
// Bresenham hasLOS); these test a straight segment against the TRUE authored shapes, so
// server-side visibility matches the design UI's exact veil (apps/design/vision.js) and a
// room whose real entrance is a narrow cusp stays hidden. Ray param t is world distance.
function rayRectIv(ox, oy, dx, dy, s) {
  let tmin = -Infinity, tmax = Infinity;
  if (Math.abs(dx) < 1e-12) { if (ox < s.x || ox > s.x + s.w) return null; }
  else { let t1 = (s.x - ox) / dx, t2 = (s.x + s.w - ox) / dx; if (t1 > t2) [t1, t2] = [t2, t1]; tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); }
  if (Math.abs(dy) < 1e-12) { if (oy < s.y || oy > s.y + s.h) return null; }
  else { let t1 = (s.y - oy) / dy, t2 = (s.y + s.h - oy) / dy; if (t1 > t2) [t1, t2] = [t2, t1]; tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); }
  return tmin > tmax ? null : { tin: tmin, tout: tmax };
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
// Cyrus–Beck ray/CONVEX-polygon clip: the run of ray parameter t for which the point
// O + t·D lies inside the polygon. Each edge defines a half-plane (interior on the inner
// side of its OUTWARD normal); a point is inside iff dot(N, X − A) ≤ 0 for every edge.
// Intersecting all those half-constraints with the ray gives one [tin, tout] interval.
// The outward normal is picked per edge by flipping whichever of the two candidates
// points away from the centroid — correct for any convex winding (and our y-down coords).
// EXACT for convex polygons only, so convexity is asserted (throws) rather than assumed:
// on a concave polygon this clip would silently return the convex hull's bounds.
function rayPolyIv(ox, oy, dx, dy, s) {
  const P = s.points;
  ensureConvex(P);
  let cx = 0, cy = 0;
  for (const p of P) { cx += p.x; cy += p.y; }
  cx /= P.length; cy /= P.length;
  let tin = -Infinity, tout = Infinity;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const ax = P[j].x, ay = P[j].y, ex = P[i].x - ax, ey = P[i].y - ay;
    let nx = ey, ny = -ex;                                  // a normal to the edge
    const mx = ax + ex / 2, my = ay + ey / 2;               // edge midpoint
    if (nx * (cx - mx) + ny * (cy - my) > 0) { nx = -nx; ny = -ny; } // make it point outward
    const denom = nx * dx + ny * dy;
    const num   = nx * (ox - ax) + ny * (oy - ay);          // dot(N, O − A)
    if (Math.abs(denom) < 1e-12) { if (num > 1e-12) return null; continue; }
    const t = -num / denom;
    if (denom < 0) tin = Math.max(tin, t); else tout = Math.min(tout, t);
    if (tin > tout) return null;
  }
  return tin > tout ? null : { tin, tout };
}
function rayShapeIv(ox, oy, dx, dy, s) {
  const kind = shapeKind(s, 'rayShapeIv');
  if (kind === 'oval') return rayOvalIv(ox, oy, dx, dy, s);
  if (kind === 'poly') return rayPolyIv(ox, oy, dx, dy, s);
  return rayRectIv(ox, oy, dx, dy, s);
}

// LOS where the floor is the UNION of `shapes` (walls are the complement, e.g. doom):
// clear iff the whole segment stays inside the union — i.e. the covered run from the
// origin reaches the far endpoint.
export function segmentInUnion(x0, y0, x1, y1, shapes) {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
  if (len < 1e-12) return true;
  const ux = dx / len, uy = dy / len;
  const ivs = [];
  for (const s of shapes) { const iv = rayShapeIv(x0, y0, ux, uy, s); if (iv && iv.tout > 1e-9) ivs.push(iv); }
  if (!ivs.some(iv => iv.tin <= 1e-9)) return false; // origin not on floor
  let cur = 0;
  for (;;) {
    let best = cur;
    for (const iv of ivs) if (iv.tin <= cur + 1e-9 && iv.tout > best) best = iv.tout;
    if (best > cur + 1e-12) { cur = best; if (cur >= len - 1e-9) return true; } else break;
  }
  return cur >= len - 1e-9;
}

// EXACT layered segment test, for terrain where shapes STACK and the later one wins — the
// material at a point is whatever the TOPMOST shape containing it says, so a 'floor' shape
// authored after a wall carves a real hole in it (cs_siege's courtyard and gates). A plain
// union test (segmentClearOf) can't express that, and sampling the line can miss a thin
// obstacle; this is exact instead.
//
// It works because the topmost shape along the ray can only change where the ray crosses
// some shape's boundary. Splitting at every exact entry/exit t therefore yields sub-intervals
// of CONSTANT material, so testing one interior point of each decides that whole run exactly.
// `shapes` are ordered bottom→top and must all carry material (filter out inert overlays
// first); `isSolid(shape)` says whether that material blocks.
export function segmentHitsSolid(x0, y0, x1, y1, shapes, isSolid) {
  const topmostSolidAt = (px, py) => {
    for (let i = shapes.length - 1; i >= 0; i--)
      if (pointInShape(shapes[i], px, py)) return isSolid(shapes[i]);
    return false; // bare ground
  };
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
  if (len < 1e-12) return topmostSolidAt(x0, y0);
  const ux = dx / len, uy = dy / len;
  const cuts = [0, len];
  for (const s of shapes) {
    const iv = rayShapeIv(x0, y0, ux, uy, s);
    if (!iv || iv.tout <= 0 || iv.tin >= len) continue;
    if (iv.tin > 0) cuts.push(iv.tin);
    if (iv.tout < len) cuts.push(iv.tout);
  }
  cuts.sort((a, b) => a - b);
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i], b = cuts[i + 1];
    if (b - a < 1e-9) continue;                       // zero-width sliver: nothing between
    const t = (a + b) / 2;                            // representative of a constant run
    if (topmostSolidAt(x0 + ux * t, y0 + uy * t)) return true;
  }
  return false;
}

// LOS where `shapes` are opaque blockers on open ground (e.g. cs walls/pits): clear iff
// the segment enters none of them between the endpoints.
export function segmentClearOf(x0, y0, x1, y1, shapes) {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
  if (len < 1e-12) return true;
  const ux = dx / len, uy = dy / len;
  for (const s of shapes) {
    const iv = rayShapeIv(x0, y0, ux, uy, s);
    if (iv && iv.tin < len - 1e-6 && iv.tout > 1e-6) return false;
  }
  return true;
}

// Closest point ON the shape (boundary, or the point itself if already inside) to
// (px, py) — for range checks against a shape rather than a single point (e.g. can
// this unit reach/attack a multi-tile crate from here?). Oval case projects onto the
// ellipse along the normalized direction from centre; rect case clamps to the box.
export function nearestPointOnShape(s, px, py) {
  const kind = shapeKind(s, 'nearestPointOnShape');
  if (kind === 'oval') {
    const rx = s.w / 2, ry = s.h / 2, cx = s.x + rx, cy = s.y + ry;
    const nx = (px - cx) / rx, ny = (py - cy) / ry;
    const d = Math.hypot(nx, ny);
    if (d <= 1) return { x: px, y: py };
    return { x: cx + (nx / d) * rx, y: cy + (ny / d) * ry };
  }
  if (kind === 'poly') {
    // Exact: inside ⇒ the point itself, else the closest projection onto any edge segment.
    // (Falling through to the bbox here would silently answer for the wrong shape.)
    if (pointInShape(s, px, py)) return { x: px, y: py };
    const P = s.points;
    let best = null, bestD = Infinity;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const ax = P[j].x, ay = P[j].y, ex = P[i].x - ax, ey = P[i].y - ay;
      const len2 = ex * ex + ey * ey;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / len2));
      const qx = ax + t * ex, qy = ay + t * ey;
      const d = (px - qx) ** 2 + (py - qy) ** 2;
      if (d < bestD) { bestD = d; best = { x: qx, y: qy }; }
    }
    return best;
  }
  return { x: Math.max(s.x, Math.min(px, s.x + s.w)), y: Math.max(s.y, Math.min(py, s.y + s.h)) };
}

// Invoke cb(x, y) for every integer cell in [0,W)×[0,H) whose centre lies inside
// the shape — the rasterization used to stamp a shape onto a tile grid.
export function forEachCell(s, W, H, cb) {
  const bb = shapeBBox(s);
  const x0 = Math.max(0, Math.floor(bb.x));
  const y0 = Math.max(0, Math.floor(bb.y));
  const x1 = Math.min(W - 1, Math.ceil(bb.x + bb.w));
  const y1 = Math.min(H - 1, Math.ceil(bb.y + bb.h));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      if (pointInShape(s, x + 0.5, y + 0.5)) cb(x, y);
}

// Convert a tile grid into render-ready rectangle shapes so a hand-laid grid map can
// still be drawn as layered SVGs instead of blocky per-cell tiles. `getType(x,y)` returns
// a tile's type; `typeStyles` maps the types worth drawing → SVG style ({ fill, stroke?,
// opacity?, round?, label? }). Types absent from `typeStyles` (e.g. plain floor) are left
// as background. Contiguous same-type cells are greedily merged into maximal rectangles.
// Like tilesToShapes, but groups each type's contiguous (4-neighbour) cells into one
// polygon per connected region instead of decomposing it into several maximal
// rectangles. Two adjacent same-type cells always end up on one shape this way, so they
// never draw a stroke down the seam between them — tilesToShapes can split an L-shaped
// or ring-shaped region into multiple rects that each get their own border. Regions with
// a hole (a ring) trace an extra inner loop; callers that never author rings can ignore
// that case.
export function tilesToPolygons(getType, W, H, typeStyles) {
  const shapes = [];
  const visited = new Set();
  const key = (x, y) => `${x},${y}`;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const type = getType(x, y);
      if (!type || !typeStyles[type] || visited.has(key(x, y))) continue;
      const cells = [];
      const queue = [[x, y]];
      visited.add(key(x, y));
      while (queue.length) {
        const [cx, cy] = queue.shift();
        cells.push([cx, cy]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy, nk = key(nx, ny);
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || visited.has(nk)) continue;
          if (getType(nx, ny) === type) { visited.add(nk); queue.push([nx, ny]); }
        }
      }
      const style = typeStyles[type];
      for (const loop of traceCellBoundary(cells))
        shapes.push({ shape: 'poly', points: loop.map(([px, py]) => ({ x: px, y: py })), ...style, label: style.label ?? null });
    }
  }
  return shapes;
}

// Trace the boundary of a set of unit cells into one or more closed orthogonal loops.
// Each cell contributes its 4 unit edges; an edge shared by two cells in the set is
// interior and cancels out, leaving only the boundary edges. Edges are oriented so the
// cell interior is always on their right (top: left→right, right: top→bottom, bottom:
// right→left, left: bottom→top), which chains them head-to-tail into closed loops and
// makes an outer loop wind opposite to any inner (hole) loop.
function traceCellBoundary(cells) {
  const set = new Set(cells.map(([x, y]) => `${x},${y}`));
  const has = (x, y) => set.has(`${x},${y}`);
  const edges = [];
  for (const [x, y] of cells) {
    if (!has(x, y - 1)) edges.push([[x, y], [x + 1, y]]);         // top
    if (!has(x + 1, y)) edges.push([[x + 1, y], [x + 1, y + 1]]); // right
    if (!has(x, y + 1)) edges.push([[x + 1, y + 1], [x, y + 1]]); // bottom
    if (!has(x - 1, y)) edges.push([[x, y + 1], [x, y]]);         // left
  }
  const byStart = new Map();
  edges.forEach((e, i) => {
    const sk = e[0].join(',');
    if (!byStart.has(sk)) byStart.set(sk, []);
    byStart.get(sk).push(i);
  });
  const used = new Array(edges.length).fill(false);
  const loops = [];
  for (let i = 0; i < edges.length; i++) {
    if (used[i]) continue;
    const loop = [];
    let idx = i;
    do {
      used[idx] = true;
      loop.push(edges[idx][0]);
      const candidates = byStart.get(edges[idx][1].join(',')) || [];
      const next = candidates.find(c => !used[c]);
      idx = next ?? -1;
    } while (idx !== -1 && idx !== i);
    loops.push(loop);
  }
  return loops;
}

export function tilesToShapes(getType, W, H, typeStyles) {
  const shapes = [];
  for (const [type, style] of Object.entries(typeStyles)) {
    const used = new Set();
    const key = (x, y) => `${x},${y}`;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (getType(x, y) !== type || used.has(key(x, y))) continue;
        // Grow width along the row, then height while every column still matches.
        let w = 1;
        while (x + w < W && getType(x + w, y) === type && !used.has(key(x + w, y))) w++;
        let h = 1;
        grow: while (y + h < H) {
          for (let i = 0; i < w; i++)
            if (getType(x + i, y + h) !== type || used.has(key(x + i, y + h))) break grow;
          h++;
        }
        for (let yy = y; yy < y + h; yy++)
          for (let xx = x; xx < x + w; xx++) used.add(key(xx, yy));
        shapes.push({ shape: 'rect', x, y, w, h, ...style, label: style.label ?? null });
      }
    }
  }
  return shapes;
}
