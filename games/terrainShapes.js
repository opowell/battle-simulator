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

// True when the point (px, py) lies inside the shape.
export function pointInShape(s, px, py) {
  if (s.shape === 'oval') {
    const rx = s.w / 2, ry = s.h / 2;
    if (rx <= 0 || ry <= 0) return false;
    const nx = (px - (s.x + rx)) / rx;
    const ny = (py - (s.y + ry)) / ry;
    return nx * nx + ny * ny <= 1;
  }
  if (s.shape === 'poly') {
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
function rayShapeIv(ox, oy, dx, dy, s) {
  return s.shape === 'oval' ? rayOvalIv(ox, oy, dx, dy, s) : rayRectIv(ox, oy, dx, dy, s);
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
  if (s.shape === 'oval') {
    const rx = s.w / 2, ry = s.h / 2, cx = s.x + rx, cy = s.y + ry;
    const nx = (px - cx) / rx, ny = (py - cy) / ry;
    const d = Math.hypot(nx, ny);
    if (d <= 1) return { x: px, y: py };
    return { x: cx + (nx / d) * rx, y: cy + (ny / d) * ry };
  }
  return { x: Math.max(s.x, Math.min(px, s.x + s.w)), y: Math.max(s.y, Math.min(py, s.y + s.h)) };
}

// Invoke cb(x, y) for every integer cell in [0,W)×[0,H) whose centre lies inside
// the shape — the rasterization used to stamp a shape onto a tile grid.
export function forEachCell(s, W, H, cb) {
  const x0 = Math.max(0, Math.floor(s.x));
  const y0 = Math.max(0, Math.floor(s.y));
  const x1 = Math.min(W - 1, Math.ceil(s.x + s.w));
  const y1 = Math.min(H - 1, Math.ceil(s.y + s.h));
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
