// ── Shared StarCraft map: "Aiur Crossing" ────────────────────────────────────────
//
// A hand-authored, tournament-style 2-player map shared by SC1 and SC2, built the
// same way as games/doom/map.js: the terrain is authored as GROUPED FEATURE SHAPES
// (rects + ovals — see games/terrainShapes.js) rather than a blocky per-cell grid,
// then rasterized onto the tile grid so movement / build / LOS keep working unchanged.
//
// Two things drive everything:
//
//   MACRO terrain — the low-ground backdrop; FOUR mineral-ring bases per player (a corner
//     main, a natural, a left-flank third, and a 4th grabbed in the opposite empty
//     corner) where the minerals form a horseshoe so the command centre drops into the
//     middle; the contested central plateau ringed by cliffs with four ramp chokes and
//     two gold expansions; irregular impassable rock outcrops that carve the open field
//     into lanes and half-shield each expansion; and a ragged rock border. Authored once
//     for Player 1's half and mirrored under 180° rotation ((x,y) → (W-1-x, H-1-y)) so
//     the map is perfectly balanced.
//
// Rendering (see the composition helpers below → toGrid → SchematicLayer.vue) builds
// every visible element out of SEVERAL grouped shapes so the map reads as real terrain
// rather than flat blocks: a mineral field is a ring of crystal-shard clusters, a geyser
// is a layered vent (rocky rim → crater → gas pool → bubbles), a cliff is chunky faceted
// rock with a lit top edge and a shadow cast onto the low ground, a plateau is a raised
// surface with a drop shadow and a lit rim, a ramp has stepped rungs. ~1700 grouped
// shapes in all. The mechanics tile grid is the exact rasterization of the macro shapes,
// independent of this render composition.
//
// Layout (y up; P1 bottom-left main, P2 top-right main; rock outcrops omitted):
//
//   ┌─ P2 4th (TL) ─────────────────── P2 main (TR) ─┐
//   │                        P2 nat  ·   P2 third     │
//   │            ┌───── central plateau ─────┐        │
//   │            │  gold ·  Xel'Naga  · gold │        │
//   │            └──── (cliff ring, 4 ramps) ┘        │
//   │   P1 third  ·  P1 nat                           │
//   └─ P1 main (BL) ─────────────────── P1 4th (BR) ─┘

import { forEachCell, tilesToPolygons, tilesToShapes } from '../terrainShapes.js';

export const MAP_WIDTH  = 48;
export const MAP_HEIGHT = 40;

const W = MAP_WIDTH, H = MAP_HEIGHT;
const k = (x, y) => `${x},${y}`;

// Fast seeded PRNG (shared with the games' map.js).
export function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// kind → render style. Terrain-carrying kinds also map to a tile terrain in KIND_TERRAIN
// below. Every visible terrain element is COMPOSED from several small shapes (a mineral
// field is a cluster of crystal shards, a geyser is a layered vent, a cliff is chunky
// faceted rock with a lit top edge and a cast shadow) — see the composition helpers
// further down — so the map reads as real terrain rather than flat blocks.
const INFO = {
  highground:   { name: 'High ground',    description: 'Elevated plateau — buildable, +25% defense, sight advantage.' },
  cliff:        { name: 'Cliff',          description: 'Unpathable rock — blocks ground movement and line of sight.' },
  ramp:         { name: 'Ramp',           description: 'The only way up onto high ground — slow to cross (a natural choke).' },
  minerals:     { name: 'Mineral field',  description: 'Harvestable minerals — impassable to ground, gathered by workers.' },
  richMinerals: { name: 'Rich minerals',  description: 'Contested gold expansion — a richer, faster mineral yield.' },
  vespene:      { name: 'Vespene geyser', description: 'Build a gas structure on top to harvest vespene.' },
  rock:         { name: 'Debris',         description: 'Rubble — blocks ground movement.' },
};

const KIND_TERRAIN = {
  highground: 'elevated', cliff: 'obstacle', ramp: 'ramp',
  minerals: 'minerals', richMinerals: 'minerals', vespene: 'vespene', rock: 'obstacle',
};

// ── authoring helpers ────────────────────────────────────────────────────────────
const rect = (x, y, w, h, kind) => ({ shape: 'rect', x, y, w, h, kind });

// 180°-rotational mirror of a feature onto the enemy half.
function mirror(f) {
  if (f.shape === 'rect') return { ...f, x: W - f.x - f.w, y: H - f.y - f.h };
  if (f.shape === 'oval') return { ...f, x: W - f.x - f.w, y: H - f.y - f.h };
  return f;
}

// A resource patch occupying a single cell (cx,cy), rendered as a rounded crystal/geyser
// oval and stamped onto that tile.
const resourceOval = (cx, cy, kind) => ({ shape: 'oval', x: cx + 0.06, y: cy + 0.08, w: 0.88, h: 0.84, kind, cell: [cx, cy] });

// ── mineral-ring base template ─────────────────────────────────────────────────────
// A base is a horseshoe of mineral patches with two geysers, opening on the ENTRANCE
// side, so the command centre drops into the middle and workers mine the ring around it
// (exactly like a real StarCraft expansion). Authored for entrance = +x and rotated for
// the other three facings.
const BASE_MIN = [
  [-2, -2], [-2, -1], [-2, 0], [-2, 1], [-2, 2],   // back wall
  [-1, 2], [0, 2], [1, 2],                         // top arm
  [-1, -2], [0, -2], [1, -2],                      // bottom arm
];
const BASE_GAS = [[2, 2], [2, -2]];
function rotOff([dx, dy], dir) {
  if (dir === 'W') return [-dx, -dy];
  if (dir === 'N') return [-dy, dx];
  if (dir === 'S') return [dy, -dx];
  return [dx, dy]; // E
}
function baseCells(cx, cy, dir) {
  return {
    min: BASE_MIN.map(o => { const [dx, dy] = rotOff(o, dir); return [cx + dx, cy + dy]; }),
    gas: BASE_GAS.map(o => { const [dx, dy] = rotOff(o, dir); return [cx + dx, cy + dy]; }),
  };
}

// P1's four bases (mirrored to P2): a corner main, a natural out front, a third up the
// left flank, and a 4th grabbed in the empty bottom-right corner. `dir` is the open side.
const P1_BASES = [
  { c: [5, 5],   dir: 'E', main: true }, // main — bottom-left corner
  { c: [15, 6],  dir: 'E' },             // natural
  { c: [7, 19],  dir: 'N' },             // third — left flank
  { c: [41, 7],  dir: 'W' },             // fourth — bottom-right corner
];
// Two contested gold expansions on the central high ground (P1-side; mirrored gives the
// P2-side one). Authored as explicit cells since they sit on the plateau, not as a ring.
const P1_GOLD_MIN = [[19, 21], [20, 21], [21, 21], [19, 22], [20, 22], [21, 22]];
const P1_GOLD_GAS = [[18, 20]];

// ── impassable rock formations — break up the open field, gate chokes, and half-shield
// each expansion so it isn't sitting in the open. `cliff` kind ⇒ chunky rock render.
const P1_FORMATIONS = [
  // Outer choke wall in front of the main's exit (gap left open at y4-6).
  rect(11, 1, 1, 3, 'cliff'), rect(11, 7, 1, 4, 'cliff'),
  // Rock outcrops carving the bottom-left flat into lanes.
  { shape: 'oval', x: 20, y: 9, w: 6, h: 4, kind: 'cliff' },
  { shape: 'oval', x: 9, y: 11, w: 5, h: 5, kind: 'cliff' },
  { shape: 'oval', x: 28, y: 5, w: 5, h: 4, kind: 'cliff' },
  { shape: 'oval', x: 12, y: 25, w: 6, h: 5, kind: 'cliff' },
  // Half-shields flanking each expansion's exposed entrance.
  { shape: 'oval', x: 18, y: 2, w: 3, h: 3, kind: 'cliff' }, { shape: 'oval', x: 19, y: 9, w: 3, h: 3, kind: 'cliff' }, // natural
  { shape: 'oval', x: 2, y: 23, w: 3, h: 3, kind: 'cliff' }, { shape: 'oval', x: 11, y: 23, w: 3, h: 3, kind: 'cliff' }, // third
  { shape: 'oval', x: 35, y: 3, w: 3, h: 3, kind: 'cliff' }, { shape: 'oval', x: 35, y: 10, w: 3, h: 3, kind: 'cliff' }, // fourth
  // Border in-bulges so the map edge reads as a ragged rock wall, not a straight line.
  { shape: 'oval', x: -2, y: 14, w: 5, h: 9, kind: 'cliff' },
  { shape: 'oval', x: 16, y: -2, w: 10, h: 4, kind: 'cliff' },
  // A little rubble at a mid-map pinch.
  rect(24, 12, 1, 1, 'rock'), rect(9, 30, 1, 1, 'rock'),
];

// ── central contested plateau: high ground ringed by cliffs, 4 ramp chokes ─────────
const CENTER = (() => {
  const feats = [];
  feats.push(rect(18, 15, 12, 10, 'highground'));       // the plateau itself
  // cliff belt one tile outside the plateau, with a gap at each of the 4 ramps
  feats.push(rect(17, 14, 1, 5, 'cliff'),  rect(17, 21, 1, 5, 'cliff'));   // west col (gap y19-20)
  feats.push(rect(30, 14, 1, 5, 'cliff'),  rect(30, 21, 1, 5, 'cliff'));   // east col
  feats.push(rect(17, 14, 6, 1, 'cliff'),  rect(25, 14, 6, 1, 'cliff'));   // bottom row (gap x23-24)
  feats.push(rect(17, 25, 6, 1, 'cliff'),  rect(25, 25, 6, 1, 'cliff'));   // top row
  feats.push(rect(16, 19, 2, 2, 'ramp'), rect(30, 19, 2, 2, 'ramp'));      // W / E ramps
  feats.push(rect(23, 13, 2, 2, 'ramp'), rect(23, 25, 2, 2, 'ramp'));      // S / N ramps
  return feats;
})();

// Map border (self-symmetric).
const BORDER = [
  rect(0, 0, W, 1, 'cliff'), rect(0, H - 1, W, 1, 'cliff'),
  rect(0, 0, 1, H, 'cliff'), rect(W - 1, 0, 1, H, 'cliff'),
];

// ── assemble macro shapes + resource patches ──────────────────────────────────────
function buildMacro() {
  const half = [...P1_FORMATIONS];
  const macro = [...half, ...half.map(mirror), ...CENTER, ...BORDER];

  // Base resource rings for all four P1 bases (+ their P2 mirrors), plus the golds.
  const resCells = [];
  for (const b of P1_BASES) {
    const { min, gas } = baseCells(b.c[0], b.c[1], b.dir);
    for (const c of min) resCells.push([c, 'minerals']);
    for (const c of gas) resCells.push([c, 'vespene']);
  }
  for (const c of P1_GOLD_MIN) resCells.push([c, 'richMinerals']);
  for (const c of P1_GOLD_GAS) resCells.push([c, 'vespene']);

  // Mirror every resource cell to P2's half.
  const allRes = [];
  for (const [[cx, cy], kind] of resCells) {
    allRes.push(resourceOval(cx, cy, kind));
    allRes.push(resourceOval(W - 1 - cx, H - 1 - cy, kind));
  }

  // Base centres for the engine (main-building placement + worker spawns).
  const main1 = { x: P1_BASES[0].c[0], y: P1_BASES[0].c[1] };
  const bases = { main1, main2: { x: W - 1 - main1.x, y: H - 1 - main1.y } };
  return { macro, resources: allRes, bases };
}

// ── rasterize macro shapes onto the tile grid + record render membership sets ──────
function stamp(macro, resources, mineralAmount, richAmount, vespeneAmount) {
  const tiles = {};
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) tiles[k(x, y)] = { terrain: 'open' };

  const elevated = new Set(), cliff = new Set(), ramp = new Set();

  // Order matters — later stamps win. Elevated first, then cliffs/rock, then ramps carve
  // the choke gaps back open, then resources sit on top of whatever's beneath.
  const order = ['highground', 'cliff', 'rock', 'ramp'];
  for (const kind of order) {
    for (const f of macro) {
      if (f.kind !== kind) continue;
      forEachCell(f, W, H, (x, y) => {
        tiles[k(x, y)] = { terrain: KIND_TERRAIN[kind] };
        if (kind === 'highground') { elevated.add(k(x, y)); cliff.delete(k(x, y)); }
        else if (kind === 'cliff') { cliff.add(k(x, y)); }
        else if (kind === 'ramp')  { ramp.add(k(x, y)); cliff.delete(k(x, y)); elevated.delete(k(x, y)); }
      });
    }
  }
  for (const r of resources) {
    const [cx, cy] = r.cell;
    const amount = r.kind === 'vespene' ? vespeneAmount : r.kind === 'richMinerals' ? richAmount : mineralAmount;
    tiles[k(cx, cy)] = { terrain: KIND_TERRAIN[r.kind], amount };
  }
  return { tiles, elevated, cliff, ramp };
}

// ── composition helpers: build each terrain element out of several grouped shapes ──
// Deterministic 0..1 hash so texture is stable and mirror-symmetric.
function hash2(x, y) {
  let h = Math.imul((x | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((y | 0) ^ 0x27d4eb2f, 0xc2b2ae35);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
const poly = (points, style) => ({ shape: 'poly', points, label: null, ...style });
const line = (x1, y1, x2, y2, stroke, sw) => ({ shape: 'line', x1, y1, x2, y2, stroke, strokeWidth: sw });

// A cliff cell → a chunk of faceted rock: a jittered, tinted quad with a dark seam, a
// lit cap along any top edge exposed to open ground, and a shadow cast down onto the
// low ground below. Grouped over a region, the cells read as one chunky rock wall.
const ROCKS = ['#2c2416', '#352b1a', '#3e3221', '#463925', '#302819', '#241d10'];
function cliffCell(x, y, cliffSet, elevSet) {
  const out = [];
  const openBelow = !cliffSet.has(k(x, y - 1)) && !elevSet.has(k(x, y - 1)); // low-ground side (screen-bottom)
  const openAbove = !cliffSet.has(k(x, y + 1)) && !elevSet.has(k(x, y + 1)); // screen-top edge, catches light
  // Cast shadow onto the open ground in front of the cliff face.
  if (openBelow) out.push(poly([{ x: x + 0.02, y }, { x: x + 0.98, y }, { x: x + 0.88, y: y - 0.5 }, { x: x + 0.12, y: y - 0.5 }],
    { fill: '#0e0a04', opacity: 0.32 }));
  // Rock chunk — expanded a touch so neighbours overlap (no seams/gaps), corners jittered.
  const e = 0.06, j = (a, b) => (hash2(a, b) - 0.5) * 0.24;
  const tone = ROCKS[Math.floor(hash2(x * 3, y * 5) * ROCKS.length)];
  out.push(poly([
    { x: x - e + j(x, y),         y: y - e + j(x + 11, y) },
    { x: x + 1 + e + j(x + 2, y), y: y - e + j(x, y + 13) },
    { x: x + 1 + e + j(x + 3, y), y: y + 1 + e + j(x, y + 2) },
    { x: x - e + j(x + 5, y),     y: y + 1 + e + j(x, y + 3) },
  ], { fill: tone, stroke: '#17110a', strokeWidth: 0.75 }));
  // Lit top edge.
  if (openAbove) out.push(poly([{ x: x + 0.08, y: y + 1 }, { x: x + 0.92, y: y + 1 }, { x: x + 0.74, y: y + 0.72 }, { x: x + 0.26, y: y + 0.72 }],
    { fill: '#6f5a38', opacity: 0.75 }));
  return out;
}

// A high-ground region polygon → cast shadow beneath + raised top surface + lit rim.
function plateau(region) {
  const pts = region.points;
  const shadow = pts.map(p => ({ x: p.x + 0.35, y: p.y - 0.35 }));
  return [
    poly(shadow, { fill: '#1c2212', opacity: 0.4 }),
    poly(pts, { fill: '#77854e', stroke: '#4f5a31', strokeWidth: 1, ...INFO.highground }),
    poly(pts, { fill: 'none', stroke: '#9fb072', strokeWidth: 1.6, opacity: 0.8 }), // lit rim
  ];
}

// A ramp rect → tan surface with darker step rungs across the direction of travel.
function rampFeature(r) {
  const out = [{ shape: 'rect', x: r.x, y: r.y, w: r.w, h: r.h, fill: '#a4934e', stroke: '#6f6234', strokeWidth: 1, label: null, ...INFO.ramp }];
  const vertical = r.h >= r.w;
  const span = vertical ? r.h : r.w, n = Math.max(2, Math.round(span));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (vertical) out.push(line(r.x + 0.05, r.y + t * r.h, r.x + r.w - 0.05, r.y + t * r.h, '#7b6d3a', 1.3));
    else          out.push(line(r.x + t * r.w, r.y + 0.05, r.x + t * r.w, r.y + r.h - 0.05, '#7b6d3a', 1.3));
  }
  return out;
}

// A mineral cell → a cluster of angular crystal shards on a ground shadow. Each shard is
// a two-tone kite (body + lit facet) so the patch reads as glittering crystals.
const MIN_PAL  = { body: ['#2f8fc4', '#3aa6db', '#57c3ef'], hi: '#c8f0ff', stroke: '#1b5c85', shadow: '#12354e' };
const GOLD_PAL = { body: ['#d29a26', '#f2c53d', '#ffdf7a'], hi: '#fff4c8', stroke: '#95681a', shadow: '#5a3d0d' };
function mineralCell(cx, cy, rich, first) {
  const pal = rich ? GOLD_PAL : MIN_PAL;
  const out = [{ shape: 'oval', x: cx + 0.1, y: cy + 0.06, w: 0.8, h: 0.4, fill: pal.shadow, opacity: 0.42, label: null,
    ...(first ? { name: rich ? INFO.richMinerals.name : INFO.minerals.name, description: rich ? INFO.richMinerals.description : INFO.minerals.description } : {}) }];
  const shards = [[-0.24, 0.14, 0.46], [0.02, 0.2, 0.6], [0.24, 0.12, 0.44]];
  shards.forEach(([dx, base, h], i) => {
    const bx = cx + 0.5 + dx, by = cy + base, wsh = 0.22;
    out.push(poly([{ x: bx, y: by }, { x: bx + wsh / 2, y: by + h * 0.42 }, { x: bx, y: by + h }, { x: bx - wsh / 2, y: by + h * 0.42 }],
      { fill: pal.body[i % 3], stroke: pal.stroke, strokeWidth: 0.6 }));
    out.push(poly([{ x: bx, y: by }, { x: bx, y: by + h }, { x: bx - wsh / 2, y: by + h * 0.42 }], { fill: pal.hi, opacity: 0.45 }));
  });
  return out;
}

// A vespene cell → a layered geyser: rocky rim, dark crater, bright gas pool and bubbles.
function geyserCell(cx, cy, first) {
  const c = (dx, dy, w, h, fill, opacity) => ({ shape: 'oval', x: cx + dx, y: cy + dy, w, h, fill, opacity, label: null });
  return [
    { ...c(0.03, 0.06, 0.94, 0.86, '#3a3320', 1), stroke: '#54492c', strokeWidth: 0.8,
      ...(first ? { name: INFO.vespene.name, description: INFO.vespene.description } : {}) },
    c(0.15, 0.16, 0.7, 0.62, '#173d28', 1),
    c(0.24, 0.26, 0.52, 0.44, '#279c56', 1),
    c(0.34, 0.36, 0.32, 0.26, '#68efaa', 0.92),
    c(0.28, 0.62, 0.12, 0.1, '#8ff7c2', 0.85),
    c(0.58, 0.5, 0.1, 0.09, '#8ff7c2', 0.8),
    c(0.46, 0.24, 0.08, 0.07, '#b6ffe0', 0.8),
  ];
}

// A debris/rock obstacle → a small pile of a few tinted boulders.
function debrisFeature(f, first) {
  const out = [];
  forEachCell(f, W, H, (x, y) => {
    for (let i = 0; i < 3; i++) {
      const r = hash2(x * 7 + i, y * 5 + i);
      out.push({ shape: 'oval', x: x + 0.12 + (i % 2) * 0.34, y: y + 0.12 + Math.floor(i / 2) * 0.36 + r * 0.1,
        w: 0.34 + r * 0.12, h: 0.3 + r * 0.1, fill: ROCKS[Math.floor(r * ROCKS.length)], stroke: '#17110a', strokeWidth: 0.6, label: null,
        ...(first && i === 0 ? { name: INFO.rock.name, description: INFO.rock.description } : {}) });
    }
  });
  return out;
}

// ── public builder ────────────────────────────────────────────────────────────────
// amounts: { mineral, rich, vespene } — SC1 and SC2 pass their own economy values.
export function buildStarcraftMap({ mineral = 1500, rich = 2500, vespene = 2500 } = {}) {
  const { macro, resources, bases } = buildMacro();
  const { tiles, elevated, cliff, ramp } = stamp(macro, resources, mineral, rich, vespene);

  const highType = (x, y) => (elevated.has(k(x, y)) ? 'highground' : null);
  const rampType = (x, y) => (ramp.has(k(x, y)) ? 'ramp' : null);

  // Draw order (bottom → top): backdrop, plateau bodies, chunky cliffs, ramps, then the
  // crystal / geyser / debris features on top. Every element is a group of shapes.
  const plateaus = tilesToPolygons(highType, W, H, { highground: { fill: '#77854e' } }).flatMap(plateau);
  const cliffs = [...cliff].flatMap(key => { const [x, y] = key.split(',').map(Number); return cliffCell(x, y, cliff, elevated); });
  const ramps = tilesToShapes(rampType, W, H, { ramp: { fill: '#a4934e' } }).flatMap(rampFeature);

  const mineralPatches = resources.filter(r => r.kind === 'minerals' || r.kind === 'richMinerals');
  const geysers = resources.filter(r => r.kind === 'vespene');
  const seenMin = new Set(), seenGas = new Set();
  const minerals = mineralPatches.flatMap(r => {
    const bucket = `${Math.round(r.cell[0] / 6)},${Math.round(r.cell[1] / 6)},${r.kind}`; // first patch of each field carries the label
    const first = !seenMin.has(bucket); seenMin.add(bucket);
    return mineralCell(r.cell[0], r.cell[1], r.kind === 'richMinerals', first);
  });
  const gas = geysers.flatMap(r => {
    const bucket = `${Math.round(r.cell[0] / 6)},${Math.round(r.cell[1] / 6)}`;
    const first = !seenGas.has(bucket); seenGas.add(bucket);
    return geyserCell(r.cell[0], r.cell[1], first);
  });
  const debris = macro.filter(f => f.kind === 'rock').flatMap((f, i) => debrisFeature(f, i < 2));

  const shapes = [
    { shape: 'rect', x: 0, y: 0, w: W, h: H, fill: '#586a41', label: null },
    ...plateaus,
    ...cliffs,
    ...ramps,
    ...debris,
    ...minerals,
    ...gas,
  ];

  return { width: W, height: H, tiles, shapes, bases };
}
