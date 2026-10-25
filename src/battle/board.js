// ---------------------------------------------------------------------------
// board.js — the ground a battle is fought on, in every topology the core has,
// behind one interface the rules ask their questions through.
//
// A board is data (`state.board`) and its terrain types come from the ruleset
// (a table of { cost, passable, cover, blocksSight, concealment, elevation, … }).
// The topologies:
//
//   square    cells (x, y) on a rectangle; 8 neighbours (Chebyshev distance) or
//             4 (Manhattan); `wrap` joins the left and right edges into a
//             cylinder (civ's world). Continuous space plays on it as a plane
//             whose terrain is the cell under each point.
//   hex       pointy-top hexes in odd-r offset coordinates (x = column, y = row;
//             odd rows sit half a hex to the right); 6 neighbours, hex distance.
//   regions   irregular territories with an adjacency list (risk, kdice): each
//             region is a blob of layout cells, and a unit in it stands on the
//             region's ANCHOR cell, so a position is still an {x, y}. Distance is
//             hops between regions; sight is never blocked.
//   shapes    a plane of convex shapes (rects and convex polygons, each a terrain,
//             later ones on top) over a ground terrain, plus walls (segments that
//             block movement, and sight too unless they are windows). Continuous
//             space is native; discrete space plays on the plane's unit cells,
//             each the terrain at its centre, a step blocked by a wall across it.
//
// Every board may carry `elevation` (per cell, or per region). A sight line
// runs straight from one end's height to the other's; ground blocks it where it
// rises above the line, a sight-blocking terrain standing one level higher than
// its ground. So high ground sees over a wall below it. Climbing costs extra.
//
// Movement classes: a unit's `domain` (land, sea, air, or a game's own) prices
// terrain — a terrain's `cost` and `passable` are a number/boolean for all, or
// an object by domain ({ land: 2, air: 1 }) whose missing entries fall back to
// `land`'s.
// ---------------------------------------------------------------------------

import { segmentCells } from './geometry.js';

export const EPS = 1e-9;
export const TOPOLOGIES = ['square', 'hex', 'regions', 'shapes'];

/** The cost of entering `t` for a unit of `domain` (Infinity where it can't). */
export function costFor(t, domain = 'land') {
  if (!t || !passableFor(t, domain)) return Infinity;
  const c = t.cost;
  if (c != null && typeof c === 'object') return c[domain] ?? c.land ?? 1;
  return c ?? 1;
}

/** Whether a unit of `domain` may enter terrain `t`. */
export function passableFor(t, domain = 'land') {
  if (!t) return false;
  const p = t.passable;
  if (p != null && typeof p === 'object') return !!(p[domain] ?? p.land ?? true);
  return p !== false;
}

// ── Hex arithmetic (odd-r offset ⇄ cube) ────────────────────────────────────

const toCube = (x, y) => { const q = x - (y - (y & 1)) / 2; return { q, r: y, s: -q - y }; };
const fromCube = ({ q, r }) => ({ x: q + (r - (r & 1)) / 2, y: r });
export const hexDistance = (a, b) => {
  const A = toCube(a.x, a.y), B = toCube(b.x, b.y);
  return (Math.abs(A.q - B.q) + Math.abs(A.r - B.r) + Math.abs(A.s - B.s)) / 2;
};
const HEX_EVEN = [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]];
const HEX_ODD = [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]];
const SQRT3_2 = Math.sqrt(3) / 2;

function cubeRound(q, r, s) {
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs; else rs = -rq - rr;
  return { q: rq, r: rr, s: rs };
}

/** The hexes on the straight line from a to b, both ends included. */
export function hexLine(a, b) {
  const n = hexDistance(a, b);
  const A = toCube(a.x, a.y), B = toCube(b.x, b.y);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    // Nudged off the exact edge between two hexes, so a line along one picks a side.
    out.push(fromCube(cubeRound(A.q + (B.q - A.q) * t + 1e-6, A.r + (B.r - A.r) * t + 1e-6, A.s + (B.s - A.s) * t - 2e-6)));
  }
  return out;
}

// Does ground of elevation `e` (a level higher where its terrain blocks sight)
// rise above a sight line passing over it at height `h`?
const overTop = (t, e, h) => e + (t.blocksSight ? 1 : 0) > h + 1e-9;

// ── Shapes ───────────────────────────────────────────────────────────────────

function polyOf(s) {
  if (s.points) return s.points;
  return [{ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y }, { x: s.x + s.w, y: s.y + s.h }, { x: s.x, y: s.y + s.h }];
}

function inPoly(P, px, py) {
  // Convex: inside (or on the edge) iff on one side of every edge.
  let sign = 0;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const c = (P[i].x - P[j].x) * (py - P[j].y) - (P[i].y - P[j].y) * (px - P[j].x);
    if (Math.abs(c) < EPS) continue;
    const sg = c > 0 ? 1 : -1;
    if (sign && sg !== sign) return false;
    sign = sg;
  }
  return true;
}

// The parameters t ∈ (0, 1) at which the segment crosses the convex polygon's edges.
function polyCuts(P, x0, y0, x1, y1) {
  const out = [];
  const dx = x1 - x0, dy = y1 - y0;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const ex = P[i].x - P[j].x, ey = P[i].y - P[j].y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((P[j].x - x0) * ey - (P[j].y - y0) * ex) / den;
    const u = ((P[j].x - x0) * dy - (P[j].y - y0) * dx) / den;
    if (t > EPS && t < 1 - EPS && u >= -EPS && u <= 1 + EPS) out.push(t);
  }
  return out;
}

// Do segments ab and cd meet — touching counts, so nothing slips through the
// point where two walls join?
function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  if (((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))) return true;
  const on = (p, q, r) => Math.min(p.x, q.x) - EPS <= r.x && r.x <= Math.max(p.x, q.x) + EPS && Math.min(p.y, q.y) - EPS <= r.y && r.y <= Math.max(p.y, q.y) + EPS;
  return (Math.abs(d1) <= EPS && on(c, d, a)) || (Math.abs(d2) <= EPS && on(c, d, b))
    || (Math.abs(d3) <= EPS && on(a, b, c)) || (Math.abs(d4) <= EPS && on(a, b, d));
}

// ── The board ────────────────────────────────────────────────────────────────

const cache = new WeakMap();

/**
 * The board interface for `board` (state.board) under terrain table `terrain`.
 * Built once per board object and table.
 */
/** The cells strictly between `a` and `b` on the Bresenham line from a to b. */
export function bresenham(a, b) {
  const out = [];
  const dx = Math.abs(b.x - a.x), dy = -Math.abs(b.y - a.y);
  const sx = Math.sign(b.x - a.x), sy = Math.sign(b.y - a.y);
  let err = dx + dy, x = a.x, y = a.y;
  while (x !== b.x || y !== b.y) {
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
    if (x !== b.x || y !== b.y) out.push({ x, y });
  }
  return out;
}

export function boardOf(board, terrain) {
  let byTable = cache.get(board);
  if (!byTable) { byTable = new WeakMap(); cache.set(board, byTable); }
  let B = byTable.get(terrain);
  if (!B) { B = build(board, terrain); byTable.set(terrain, B); }
  return B;
}

function build(board, terrain) {
  const topology = board.topology ?? 'square';
  const W = board.width, H = board.height;
  const type = (id) => terrain[id] ?? terrain.open ?? Object.values(terrain)[0];
  // Elevation counts only where a board has some: its own map, a region's, or a
  // terrain type that raises the ground.
  const elev = board.elevation || Object.values(terrain).some(t => t.elevation)
    || Object.values(board.regions ?? {}).some(r => r.elevation) ? (board.elevation ?? {}) : null;
  const B = { topology, width: W, height: H, wrap: !!board.wrap, board, elevated: !!elev };

  if (topology === 'square' || topology === 'hex') {
    const wrapX = (x) => (B.wrap ? ((x % W) + W) % W : x);
    B.inBounds = (x, y) => y >= 0 && y < H && (B.wrap || (x >= 0 && x < W));
    B.terrainAt = (cx, cy) => (B.inBounds(cx, cy) ? type(board.terrain?.[`${wrapX(cx)},${cy}`] ?? 'open') : null);
    B.elevAt = (p) => {
      const cx = wrapX(Math.floor(p.x)), cy = Math.floor(p.y);
      return (elev?.[`${cx},${cy}`] ?? 0) + (B.terrainAt(cx, cy)?.elevation ?? 0);
    };
    B.norm = (p) => ({ x: wrapX(p.x), y: p.y });
  }

  if (topology === 'square') {
    const eight = (board.neighbours ?? 8) !== 4;
    const DIRS = eight ? [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] : [[1, 0], [0, 1], [-1, 0], [0, -1]];
    B.continuous = true;
    B.facings = eight ? 8 : 4;
    B.adjacent = (p) => DIRS.map(([dx, dy]) => B.norm({ x: p.x + dx, y: p.y + dy })).filter(q => B.inBounds(q.x, q.y));
    const dxOf = (a, b) => { const d = Math.abs(a.x - b.x); return B.wrap ? Math.min(d, W - d) : d; };
    B.dist = eight
      ? (a, b) => Math.max(dxOf(a, b), Math.abs(a.y - b.y))
      : (a, b) => dxOf(a, b) + Math.abs(a.y - b.y);
    B.centre = (p) => ({ x: p.x + 0.5, y: p.y + 0.5 });
    // The image of `b` nearest `a` on a cylinder.
    B.near = (a, b) => {
      if (!B.wrap) return b;
      const d = b.x - a.x;
      return Math.abs(d) <= W / 2 ? b : { x: b.x - Math.sign(d) * W, y: b.y };
    };
    B.terrainUnder = (x, y) => B.terrainAt(Math.floor(x), Math.floor(y));
    B.pieces = (x0, y0, x1, y1) => segmentCells(x0, y0, x1, y1).map(c => ({ len: c.len, t: B.terrainAt(c.cx, c.cy), cx: c.cx, cy: c.cy }));
    B.stepBlocked = () => false;
    // Sight between two plane points: blocked by a sight-blocking cell strictly
    // between them that is not below both ends, or any cell above both ends.
    B.sight = (a, b) => {
      const bb = B.near(a, b);
      const ca = `${Math.floor(a.x)},${Math.floor(a.y)}`, cb = `${Math.floor(bb.x)},${Math.floor(bb.y)}`;
      const ea = elev ? B.elevAt(a) : 0, eb = elev ? B.elevAt(b) : 0;
      for (const { cx, cy } of segmentCells(a.x, a.y, bb.x, bb.y)) {
        const k = `${cx},${cy}`;
        if (k === ca || k === cb) continue;
        const t = B.terrainAt(cx, cy);
        if (!t) return false;
        if (!elev) { if (t.blocksSight) return false; continue; }
        const c = { x: cx + 0.5, y: cy + 0.5 };
        const f = Math.hypot(c.x - a.x, c.y - a.y) / (Math.hypot(bb.x - a.x, bb.y - a.y) || 1);
        if (overTop(t, B.elevAt({ x: cx, y: cy }), ea + (eb - ea) * f)) return false;
      }
      return true;
    };
    // `sightLine: 'bresenham'`: sight runs along the Bresenham line between the two
    // cells instead, blocked by a sight-blocking cell on it other than its ends —
    // the classic grid rule, for a game whose own sight is that.
    if (board.sightLine === 'bresenham') {
      B.sight = (a, b) => {
        const from = { x: Math.floor(a.x), y: Math.floor(a.y) }, to = { x: Math.floor(b.x), y: Math.floor(b.y) };
        for (const c of bresenham(from, to)) {
          const t = B.terrainAt(c.x, c.y);
          if (!t || t.blocksSight) return false;
        }
        return true;
      };
    }
    // `visionMetric`: how far a unit sees, measured otherwise than the board's
    // moves are (a 4-neighbour board that sees in Chebyshev squares, say).
    if (board.visionMetric) {
      const metric = { chebyshev: (a, b) => Math.max(dxOf(a, b), Math.abs(a.y - b.y)), manhattan: (a, b) => dxOf(a, b) + Math.abs(a.y - b.y) }[board.visionMetric];
      if (metric) B.visionDist = metric;
    }
    B.cells = () => { const out = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out.push({ x, y }); return out; };
  }

  if (topology === 'hex') {
    B.continuous = false;
    B.facings = 6;
    B.adjacent = (p) => ((p.y & 1) ? HEX_ODD : HEX_EVEN).map(([dx, dy]) => B.norm({ x: p.x + dx, y: p.y + dy })).filter(q => B.inBounds(q.x, q.y));
    B.dist = (a, b) => hexDistance(a, b);
    B.centre = (p) => ({ x: p.x + 0.5 * (p.y & 1) + 0.5, y: p.y * SQRT3_2 + 0.5 });
    B.stepBlocked = () => false;
    B.sight = (a, b) => {
      const ea = elev ? B.elevAt(a) : 0, eb = elev ? B.elevAt(b) : 0;
      const line = hexLine(a, b);
      for (let i = 1; i < line.length - 1; i++) {
        const t = B.terrainAt(line[i].x, line[i].y);
        if (!t) return false;
        if (!elev) { if (t.blocksSight) return false; continue; }
        if (overTop(t, B.elevAt(line[i]), ea + ((eb - ea) * i) / (line.length - 1))) return false;
      }
      return true;
    };
    B.cells = () => { const out = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out.push({ x, y }); return out; };
  }

  if (topology === 'regions') buildRegions(B, board, type);
  if (topology === 'shapes') buildShapes(B, board, type, elev);

  B.key = (p) => `${p.x},${p.y}`;
  return B;
}

function buildRegions(B, board, type) {
  // (elevation per region: B.elevAt below)
  const layout = board.layout ?? 'hex';
  const regions = board.regions ?? {};
  const regionOf = new Map();
  const centreOfCell = layout === 'hex'
    ? (c) => ({ x: c.x + 0.5 * (c.y & 1) + 0.5, y: c.y * SQRT3_2 + 0.5 })
    : (c) => ({ x: c.x + 0.5, y: c.y + 0.5 });
  const anchors = {};
  for (const [id, r] of Object.entries(regions)) {
    const cells = (r.cells ?? []).map(([x, y]) => ({ x, y }));
    for (const c of cells) regionOf.set(`${c.x},${c.y}`, id);
    let anchor = r.anchor ? { x: r.anchor[0], y: r.anchor[1] } : null;
    if (!anchor && cells.length) {
      // The cell nearest the blob's middle.
      const ps = cells.map(centreOfCell);
      const mx = ps.reduce((s, p) => s + p.x, 0) / ps.length, my = ps.reduce((s, p) => s + p.y, 0) / ps.length;
      let best = Infinity;
      cells.forEach((c, i) => { const d = (ps[i].x - mx) ** 2 + (ps[i].y - my) ** 2; if (d < best - EPS) { best = d; anchor = c; } });
    }
    anchors[id] = anchor;
  }
  const anchorKey = new Map(Object.entries(anchors).map(([id, a]) => [`${a.x},${a.y}`, id]));
  let adjacency = board.adjacency;
  if (!adjacency) {
    // Regions touch where their cells do.
    const nb = layout === 'hex'
      ? (c) => ((c.y & 1) ? HEX_ODD : HEX_EVEN).map(([dx, dy]) => `${c.x + dx},${c.y + dy}`)
      : (c) => [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([dx, dy]) => `${c.x + dx},${c.y + dy}`);
    const sets = Object.fromEntries(Object.keys(regions).map(id => [id, new Set()]));
    for (const [id, r] of Object.entries(regions)) {
      for (const [x, y] of r.cells ?? []) for (const k of nb({ x, y })) {
        const o = regionOf.get(k);
        if (o && o !== id) sets[id].add(o);
      }
    }
    adjacency = Object.fromEntries(Object.entries(sets).map(([id, s]) => [id, [...s].sort()]));
  }
  // Hops between every pair of regions.
  const hops = {};
  for (const id of Object.keys(regions)) {
    const d = { [id]: 0 };
    const q = [id];
    while (q.length) { const c = q.shift(); for (const n of adjacency[c] ?? []) if (d[n] == null) { d[n] = d[c] + 1; q.push(n); } }
    hops[id] = d;
  }
  B.continuous = false;
  B.facings = 0;
  B.regionAt = (p) => anchorKey.get(`${p.x},${p.y}`) ?? regionOf.get(`${p.x},${p.y}`) ?? null;
  B.anchorOf = (id) => anchors[id];
  B.regions = regions;
  B.regionAdjacency = adjacency;
  B.cellRegion = (x, y) => regionOf.get(`${x},${y}`) ?? null;
  B.cellCentre = centreOfCell;
  B.inBounds = (x, y) => anchorKey.has(`${x},${y}`);
  B.terrainAt = (x, y) => { const id = B.regionAt({ x, y }); return id ? type(regions[id].terrain ?? 'open') : null; };
  B.elevAt = (p) => { const id = B.regionAt(p); return id ? (regions[id].elevation ?? 0) + (type(regions[id].terrain ?? 'open')?.elevation ?? 0) : 0; };
  B.adjacent = (p) => (adjacency[B.regionAt(p)] ?? []).map(id => anchors[id]);
  B.dist = (a, b) => hops[B.regionAt(a)]?.[B.regionAt(b)] ?? Infinity;
  B.centre = (p) => centreOfCell(p);
  B.norm = (p) => p;
  B.stepBlocked = () => false;
  B.sight = () => true;
  B.cells = () => Object.values(anchors);
}

function buildShapes(B, board, type, elev) {
  const W = board.width, H = board.height;
  const shapes = (board.shapes ?? []).map(s => ({ ...s, P: polyOf(s) }));
  const walls = (board.walls ?? []).map(w => ({ a: { x: w.x0, y: w.y0 }, b: { x: w.x1, y: w.y1 }, window: !!w.window }));
  const ground = board.ground ?? 'open';
  B.continuous = true;
  B.facings = 8;
  B.inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  B.terrainUnder = (x, y) => {
    if (!(x >= 0 && y >= 0 && x <= W && y <= H)) return null;
    for (let i = shapes.length - 1; i >= 0; i--) if (inPoly(shapes[i].P, x, y)) return type(shapes[i].terrain);
    return type(ground);
  };
  B.terrainAt = (cx, cy) => (B.inBounds(cx, cy) ? B.terrainUnder(cx + 0.5, cy + 0.5) : null);
  B.elevAt = (p) => {
    const cx = Math.floor(p.x), cy = Math.floor(p.y);
    return (elev?.[`${cx},${cy}`] ?? 0) + (B.terrainUnder(Number.isInteger(p.x) ? cx + 0.5 : p.x, Number.isInteger(p.y) ? cy + 0.5 : p.y)?.elevation ?? 0);
  };
  B.norm = (p) => p;
  const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  B.adjacent = (p) => DIRS.map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy })).filter(q => B.inBounds(q.x, q.y));
  B.dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  B.centre = (p) => ({ x: p.x + 0.5, y: p.y + 0.5 });
  B.near = (_a, b) => b;
  B.wallBetween = (a, b, forSight = false) => walls.some(w => (!forSight || !w.window) && segmentsCross(a, b, w.a, w.b));
  B.stepBlocked = (from, to) => B.wallBetween(B.centre(from), B.centre(to));
  // The segment cut where it crosses any shape's edge: pieces of constant terrain.
  B.pieces = (x0, y0, x1, y1) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ts = [0, 1];
    for (const s of shapes) ts.push(...polyCuts(s.P, x0, y0, x1, y1));
    ts.sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < ts.length - 1; i++) {
      const a = ts[i], b = ts[i + 1];
      if (b - a < EPS) continue;
      const m = (a + b) / 2;
      out.push({ len: (b - a) * len, t: B.terrainUnder(x0 + (x1 - x0) * m, y0 + (y1 - y0) * m), t0: a, t1: b });
    }
    if (!out.length) out.push({ len: 0, t: B.terrainUnder(x0, y0), t0: 0, t1: 1 });
    return out;
  };
  B.sight = (a, b) => {
    if (B.wallBetween(a, b, true)) return false;
    const ea = elev ? B.elevAt(a) : 0, eb = elev ? B.elevAt(b) : 0;
    for (const p of B.pieces(a.x, a.y, b.x, b.y)) {
      // The ends' own ground never blocks: a unit sees out of whatever it stands in.
      if (p.t0 <= EPS || p.t1 >= 1 - EPS) continue;
      if (!p.t) return false;
      if (overTop(p.t, p.t.elevation ?? 0, ea + (eb - ea) * (p.t0 + p.t1) / 2)) return false;
    }
    return true;
  };
  B.cells = () => { const out = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out.push({ x, y }); return out; };
  B.shapes = shapes;
  B.walls = walls;
}
