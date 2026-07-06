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
