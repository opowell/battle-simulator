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
