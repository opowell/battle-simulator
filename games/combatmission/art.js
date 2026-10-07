// Combat Mission's look: how the battlefield and its units are DRAWN. Nothing here
// decides a rule — map.js rasterizes the authored terrain for movement, cover and LOS,
// and this file only dresses each authored terrain object in recognisable art.
//
// Contract with the rules geometry:
//   - Every authored terrain object is emitted first as its own BASE shape, at exactly
//     its rule footprint, carrying `name`/`description` — that is the shape the board's
//     "Inspect terrain" hit-tests, so what you click is what the rules use.
//   - Everything after it (crop rows, bushes, tree crowns, roof planes, stones, ripples)
//     is DECORATION: no `name`, so it is click-transparent and never counted as terrain.
//     Decoration stays inside its object's footprint (a tree crown may overhang the edge
//     by a hair, like a real canopy) so the drawn feature matches what the rules see.
//   - Primitives are the renderer's generic ones (rect / oval / convex poly), so the
//     shared SchematicLayer draws them with no CM-specific code.
//
// Decoration is seeded from each object's own geometry, so a map always looks the same.

import { TERRAIN } from './map.js';

// Two decimals (a hundredth of a tile) is finer than any zoom shows, and keeps the
// dressed map — a couple of thousand primitives — small on the wire.
const R3 = v => Math.round(v * 100) / 100;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedOf(t) {
  let h = 2166136261;
  for (const v of [t.x, t.y, t.w, t.h]) h = Math.imul(h ^ Math.round(v * 97), 16777619);
  for (const c of t.kind ?? '') h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

// ── primitives (world units; stroke widths are screen px, as the renderer draws them) ──
const rect   = (x, y, w, h, fill, o = {}) => ({ shape: 'rect', x: R3(x), y: R3(y), w: R3(w), h: R3(h), fill, ...o });
const oval   = (cx, cy, rx, ry, fill, o = {}) => ({ shape: 'oval', x: R3(cx - rx), y: R3(cy - ry), w: R3(2 * rx), h: R3(2 * ry), fill, ...o });
const circle = (cx, cy, r, fill, o) => oval(cx, cy, r, r, fill, o);
const poly   = (pts, fill, o = {}) => ({ shape: 'poly', points: pts.map(([x, y]) => ({ x: R3(x), y: R3(y) })), fill, ...o });

// A strip's own frame: `along` runs down its long axis, `across` over its width, so
// hedges, walls, roads and rivers are written once for either orientation.
// `dir` ('ew' / 'ns') names the long axis where w/h can't (a square bridge).
function stripFrame(t, dir) {
  const horiz = dir ? dir === 'ew' : t.w >= t.h;
  const L = horiz ? t.w : t.h, Wd = horiz ? t.h : t.w;
  const at = (u, v) => horiz ? [t.x + u, t.y + v] : [t.x + v, t.y + u];
  const band = (u0, u1, v0, v1, fill, o) => {
    const [x0, y0] = at(u0, v0), [x1, y1] = at(u1, v1);
    return rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0), fill, o);
  };
  return { horiz, L, Wd, at, band };
}

// A tree or bush seen from above: a crown with a sunlit cap toward the top-left.
const CROWN_EDGE = 'rgba(18,32,14,0.55)';
function crown(out, cx, cy, r, fill, lit = true) {
  out.push(circle(cx, cy, r, fill, { stroke: CROWN_EDGE, strokeWidth: 1 }));
  if (lit) out.push(circle(cx - r * 0.24, cy - r * 0.26, r * 0.55, 'rgba(176,206,112,0.24)'));
}

// ── terrain kinds ───────────────────────────────────────────────────────────────

const FIELD_VARIANTS = [
  { fill: '#c4ad57', opacity: 0.75, row: 'rgba(120,92,30,0.32)', gap: 0.15, wid: 0.045 }, // ripe wheat
  { fill: '#98ae5c', opacity: 0.7,  row: 'rgba(62,94,34,0.32)',  gap: 0.2,  wid: 0.06  }, // green crop
  { fill: '#8f6e48', opacity: 0.75, row: 'rgba(66,44,22,0.4)',   gap: 0.13, wid: 0.045 }, // ploughed
  { fill: '#88a259', opacity: 0.55, row: null },                                         // pasture
  { fill: '#b7ad62', opacity: 0.6,  row: 'rgba(120,110,50,0.28)', gap: 0.24, wid: 0.08 }, // stubble / hay
];

function fieldArt(t, rnd, out, info) {
  const v = FIELD_VARIANTS[Math.floor(rnd() * FIELD_VARIANTS.length)];
  out.push(rect(t.x, t.y, t.w, t.h, v.fill, { opacity: v.opacity, ...info }));
  const m = 0.1;
  if (v.row) {
    const horiz = rnd() < 0.5;
    const span = horiz ? t.h : t.w;
    for (let o = m + v.gap / 2; o < span - m; o += v.gap) {
      out.push(horiz
        ? rect(t.x + m, t.y + o, t.w - 2 * m, v.wid, v.row)
        : rect(t.x + o, t.y + m, v.wid, t.h - 2 * m, v.row));
    }
  } else {
    // Pasture: clumps of rough grass.
    const n = Math.round(t.w * t.h * 2.5);
    for (let i = 0; i < n; i++) {
      const cx = t.x + m + rnd() * (t.w - 2 * m), cy = t.y + m + rnd() * (t.h - 2 * m);
      out.push(oval(cx, cy, 0.07 + rnd() * 0.05, 0.05 + rnd() * 0.03, 'rgba(60,92,38,0.45)'));
    }
  }
}

const BUSH_FILLS = ['#3d5a2b', '#476832', '#527438', '#3a5530'];

function hedgeArt(t, rnd, out, info) {
  const f = stripFrame(t);
  out.push(rect(t.x, t.y, t.w, t.h, '#6c814b', info));                 // grass verge
  const bank = f.Wd * 0.66;                                            // the earth bank
  out.push(f.band(0.03, f.L - 0.03, (f.Wd - bank) / 2, (f.Wd + bank) / 2, '#5e6b3c', { rx: 0.2 }));
  // Dense bushes along the bank, then the odd hedgerow tree standing out of it.
  let u = 0.2 + rnd() * 0.06;
  while (u < f.L - 0.16) {
    const r = 0.19 + rnd() * 0.09;
    const [cx, cy] = f.at(u, f.Wd / 2 + (rnd() - 0.5) * 0.18);
    crown(out, cx, cy, r, BUSH_FILLS[Math.floor(rnd() * BUSH_FILLS.length)], false);
    u += r * (1.05 + rnd() * 0.35);
  }
  const trees = Math.floor(f.L * 0.45 + rnd() * 0.9);
  for (let i = 0; i < trees; i++) {
    const r = 0.34 + rnd() * 0.1;
    const [cx, cy] = f.at(r * 0.8 + rnd() * Math.max(0, f.L - r * 1.6), f.Wd / 2 + (rnd() - 0.5) * 0.1);
    crown(out, cx, cy, r, rnd() < 0.5 ? '#355228' : '#3f5f2c');
  }
}

function stoneWallArt(t, rnd, out, info) {
  const f = stripFrame(t);
  out.push(rect(t.x, t.y, t.w, t.h, '#788a57', info));                 // trodden grass
  const th = 0.22, v0 = (f.Wd - th) / 2;
  out.push(f.band(0.02, f.L - 0.02, v0, v0 + th, '#77726a', { stroke: 'rgba(40,36,30,0.75)', strokeWidth: 1 }));
  // Dry-stone courses: irregular stones in two rows.
  for (const [a, b] of [[v0 + 0.02, v0 + th / 2 - 0.01], [v0 + th / 2 + 0.01, v0 + th - 0.02]]) {
    let u = 0.04 + rnd() * 0.08;
    while (u < f.L - 0.06) {
      const len = Math.min(0.13 + rnd() * 0.16, f.L - 0.04 - u);
      const shade = ['#aaa497', '#9d978b', '#b5afa2', '#928c80'][Math.floor(rnd() * 4)];
      out.push(f.band(u, u + len, a, b, shade));
      u += len + 0.025;
    }
  }
  // A few clumps of moss/ivy.
  for (let i = 0; i < f.L * 1.5; i++) {
    const [cx, cy] = f.at(0.1 + rnd() * (f.L - 0.2), v0 + rnd() * th);
    out.push(circle(cx, cy, 0.035 + rnd() * 0.03, 'rgba(70,98,46,0.7)'));
  }
}

function roadArt(t, rnd, out, info) {
  out.push(rect(t.x, t.y, t.w, t.h, '#a6936a', info));
  if (Math.abs(t.w - t.h) < 1e-9 && !t.dir) {
    // A junction square: worn, with a few stones — no direction to run ruts in.
    for (let i = 0; i < 4; i++)
      out.push(circle(t.x + 0.15 + rnd() * (t.w - 0.3), t.y + 0.15 + rnd() * (t.h - 0.3), 0.03, 'rgba(90,75,50,0.5)'));
    return;
  }
  const f = stripFrame(t, t.dir);
  out.push(f.band(0, f.L, 0, 0.08, 'rgba(92,110,58,0.55)'));           // grass edges
  out.push(f.band(0, f.L, f.Wd - 0.08, f.Wd, 'rgba(92,110,58,0.55)'));
  const mid = f.Wd / 2;
  for (const off of [-0.2, 0.2])                                       // cart ruts
    out.push(f.band(0, f.L, mid + off - 0.035, mid + off + 0.035, 'rgba(112,90,58,0.55)'));
  out.push(f.band(0, f.L, mid - 0.05, mid + 0.05, 'rgba(126,140,82,0.4)')); // grass crown
  for (let i = 0; i < f.L * 1.5; i++) {                                // puddles / potholes
    const [cx, cy] = f.at(0.1 + rnd() * (f.L - 0.2), mid + (rnd() < 0.5 ? -0.2 : 0.2));
    if (rnd() < 0.35) out.push(oval(cx, cy, 0.07, 0.045, 'rgba(96,104,92,0.55)'));
  }
}

function bridgeArt(t, rnd, out, info) {
  const f = stripFrame(t, t.dir ?? (t.h > t.w ? 'ns' : 'ew'));
  out.push(rect(t.x, t.y, t.w, t.h, '#8e8574', info));                 // stone deck
  for (let u = 0.12; u < f.L; u += 0.22)                               // paving joints
    out.push(f.band(u, u + 0.025, 0.15, f.Wd - 0.15, 'rgba(50,44,36,0.25)'));
  const mid = f.Wd / 2;
  for (const off of [-0.25, 0.25])
    out.push(f.band(0, f.L, mid + off - 0.04, mid + off + 0.04, 'rgba(90,80,64,0.45)'));
  for (const v of [[0, 0.14], [f.Wd - 0.14, f.Wd]])                    // parapets
    out.push(f.band(0, f.L, v[0], v[1], '#b9b09e', { stroke: 'rgba(40,36,30,0.8)', strokeWidth: 1 }));
}

const WOOD_FILLS = ['#2f5528', '#3a6630', '#2a4b25', '#44733a', '#355e2c'];

function woodsArt(t, rnd, out, info) {
  const isOval = t.shape === 'oval';
  out.push(isOval
    ? oval(t.x + t.w / 2, t.y + t.h / 2, t.w / 2, t.h / 2, '#2c4424', info)
    : rect(t.x, t.y, t.w, t.h, '#2c4424', info));
  const crowns = [];
  const step = 0.42;
  for (let y = t.y + step / 2; y < t.y + t.h; y += step) {
    for (let x = t.x + step / 2; x < t.x + t.w; x += step) {
      const cx = x + (rnd() - 0.5) * 0.2, cy = y + (rnd() - 0.5) * 0.2;
      const r = 0.22 + rnd() * 0.12;
      const inset = r * 0.6;
      if (isOval) {
        const nx = (cx - (t.x + t.w / 2)) / (t.w / 2 - inset), ny = (cy - (t.y + t.h / 2)) / (t.h / 2 - inset);
        if (nx * nx + ny * ny > 1) continue;
      }
      crowns.push([
        Math.min(t.x + t.w - inset, Math.max(t.x + inset, cx)),
        Math.min(t.y + t.h - inset, Math.max(t.y + inset, cy)), r,
      ]);
    }
  }
  crowns.sort((a, b) => a[1] - b[1]);
  for (const [cx, cy, r] of crowns) crown(out, cx, cy, r, WOOD_FILLS[Math.floor(rnd() * WOOD_FILLS.length)]);
}

function pondArt(t, rnd, out, info) {
  const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
  // The whole footprint is impassable: reed-bed and mud fill the corners round the water.
  out.push(t.shape === 'oval'
    ? oval(cx, cy, t.w / 2, t.h / 2, '#56653a', info)
    : rect(t.x, t.y, t.w, t.h, '#56653a', { rx: 0.12, ...info }));
  out.push(oval(cx, cy, t.w / 2 - 0.06, t.h / 2 - 0.06, '#6d7048'));
  out.push(oval(cx, cy, t.w / 2 - 0.16, t.h / 2 - 0.16, '#3f7392', { stroke: 'rgba(40,52,30,0.6)', strokeWidth: 1 }));
  out.push(oval(cx + 0.06, cy + 0.06, t.w / 2 - 0.45, t.h / 2 - 0.45, '#36657f'));
  for (let i = 0; i < 3; i++) {                                         // ripples
    const rx = 0.12 + rnd() * 0.12;
    out.push(oval(cx + (rnd() - 0.5) * t.w * 0.4, cy + (rnd() - 0.5) * t.h * 0.4, rx, rx * 0.35, 'none',
      { stroke: 'rgba(220,235,245,0.35)', strokeWidth: 1 }));
  }
  for (let i = 0; i < 3; i++)                                           // lily pads
    out.push(circle(cx + (rnd() - 0.5) * t.w * 0.5, cy + (rnd() - 0.5) * t.h * 0.5, 0.05, '#5d8a42'));
  if (t.shape !== 'oval') {
    for (const [kx, ky] of [[t.x, t.y], [t.x + t.w, t.y], [t.x, t.y + t.h], [t.x + t.w, t.y + t.h]]) {
      const dx = kx === t.x ? 1 : -1, dy = ky === t.y ? 1 : -1;
      for (let i = 0; i < 6; i++)                                       // reeds in the corners
        out.push(oval(kx + dx * (0.08 + rnd() * 0.22), ky + dy * (0.08 + rnd() * 0.22), 0.025, 0.07, '#7b8a42'));
    }
  }
}

function riverArt(t, rnd, out, info, board) {
  out.push(rect(t.x, t.y, t.w, t.h, '#3f7392', info));
  const isWater = (x, y) => {
    const row = board?.tiles?.[y];
    return row ? row[x] === TERRAIN.WATER : false;
  };
  const whole = [t.x, t.y, t.w, t.h].every(Number.isInteger);
  // Muddy banks on every edge that meets dry land.
  const bank = (x, y, w, h) => { out.push(rect(x, y, w, h, '#6a6845')); };
  if (whole) {
    for (let i = 0; i < t.w; i++) {
      if (!isWater(t.x + i, t.y - 1)) bank(t.x + i, t.y, 1, 0.12);
      if (!isWater(t.x + i, t.y + t.h)) bank(t.x + i, t.y + t.h - 0.12, 1, 0.12);
    }
    for (let j = 0; j < t.h; j++) {
      if (!isWater(t.x - 1, t.y + j)) bank(t.x, t.y + j, 0.12, 1);
      if (!isWater(t.x + t.w, t.y + j)) bank(t.x + t.w - 0.12, t.y + j, 0.12, 1);
    }
  }
  const f = stripFrame(t);
  for (let i = 0; i < f.L * 2.5; i++) {                                 // current streaks
    const u = rnd() * (f.L - 0.5), v = 0.2 + rnd() * (f.Wd - 0.4);
    out.push(f.band(u, u + 0.25 + rnd() * 0.4, v, v + 0.025, 'rgba(225,238,248,0.2)'));
  }
}

// Roofs, the only part of a building you see from above. Light falls from the top-left,
// so the planes facing north/west are lit and the others shaded.
const ROOFS = [
  { lit: '#b0603f', mid: '#97503a', dark: '#7c3f2d', ridge: '#5a2c20' }, // terracotta tile
  { lit: '#7c858e', mid: '#6a727b', dark: '#575e66', ridge: '#3d4248' }, // slate
  { lit: '#9a6e4f', mid: '#86603f', dark: '#6e4e34', ridge: '#4c3524' }, // old brown tile
];

function buildingArt(t, rnd, out, info) {
  const roof = ROOFS[Math.floor(rnd() * ROOFS.length)];
  const { x, y, w, h } = t;
  out.push(rect(x, y, w, h, roof.dark, { stroke: '#2e231d', strokeWidth: 1.2, ...info }));
  const e = 0.04;                                                       // eaves overhang
  const X0 = x + e, Y0 = y + e, X1 = x + w - e, Y1 = y + h - e;
  const cx = (X0 + X1) / 2, cy = (Y0 + Y1) / 2;
  const edge = { stroke: 'rgba(40,24,18,0.55)', strokeWidth: 1 };
  if (Math.abs(w - h) < 1e-9) {
    // Square: a pyramid (hipped) roof — four planes meeting at the peak.
    out.push(poly([[X0, Y0], [X1, Y0], [cx, cy]], roof.lit, edge));
    out.push(poly([[X1, Y0], [X1, Y1], [cx, cy]], roof.mid, edge));
    out.push(poly([[X1, Y1], [X0, Y1], [cx, cy]], roof.dark, edge));
    out.push(poly([[X0, Y1], [X0, Y0], [cx, cy]], roof.lit, { ...edge, opacity: 0.85 }));
  } else if (rnd() < 0.5) {
    // Hipped roof: two long planes to a ridge, two triangular ends.
    const horiz = w > h, half = (horiz ? Y1 - Y0 : X1 - X0) / 2;
    if (horiz) {
      out.push(poly([[X0, Y0], [X1, Y0], [X1 - half, cy], [X0 + half, cy]], roof.lit, edge));
      out.push(poly([[X0, Y1], [X0 + half, cy], [X1 - half, cy], [X1, Y1]], roof.dark, edge));
      out.push(poly([[X0, Y0], [X0 + half, cy], [X0, Y1]], roof.mid, edge));
      out.push(poly([[X1, Y0], [X1, Y1], [X1 - half, cy]], roof.mid, edge));
    } else {
      out.push(poly([[X0, Y0], [cx, Y0 + half], [cx, Y1 - half], [X0, Y1]], roof.lit, edge));
      out.push(poly([[X1, Y0], [X1, Y1], [cx, Y1 - half], [cx, Y0 + half]], roof.dark, edge));
      out.push(poly([[X0, Y0], [X1, Y0], [cx, Y0 + half]], roof.mid, edge));
      out.push(poly([[X0, Y1], [cx, Y1 - half], [X1, Y1]], roof.mid, edge));
    }
  } else {
    // Gable roof: two planes split along the long axis, tile courses, a ridge cap.
    const horiz = w > h;
    if (horiz) {
      out.push(rect(X0, Y0, X1 - X0, cy - Y0, roof.lit));
      out.push(rect(X0, cy, X1 - X0, Y1 - cy, roof.dark));
      for (let o = Y0 + 0.1; o < Y1 - 0.05; o += 0.11)
        if (Math.abs(o - cy) > 0.05) out.push(rect(X0, o, X1 - X0, 0.018, 'rgba(0,0,0,0.14)'));
      out.push(rect(X0, cy - 0.03, X1 - X0, 0.06, roof.ridge));
    } else {
      out.push(rect(X0, Y0, cx - X0, Y1 - Y0, roof.lit));
      out.push(rect(cx, Y0, X1 - cx, Y1 - Y0, roof.dark));
      for (let o = X0 + 0.1; o < X1 - 0.05; o += 0.11)
        if (Math.abs(o - cx) > 0.05) out.push(rect(o, Y0, 0.018, Y1 - Y0, 'rgba(0,0,0,0.14)'));
      out.push(rect(cx - 0.03, Y0, 0.06, Y1 - Y0, roof.ridge));
    }
  }
  // A chimney stack or two.
  const n = Math.max(w, h) >= 2 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const frac = n === 1 ? 0.3 + rnd() * 0.4 : (i === 0 ? 0.2 : 0.8);
    const px = w >= h ? X0 + (X1 - X0) * frac : cx + 0.05;
    const py = w >= h ? cy + 0.05 : Y0 + (Y1 - Y0) * frac;
    out.push(rect(px - 0.08, py - 0.08, 0.16, 0.16, '#857566', { stroke: '#2e231d', strokeWidth: 1 }));
    out.push(rect(px - 0.04, py - 0.04, 0.08, 0.08, '#2a2420'));
  }
}

const ART = {
  field: fieldArt,
  hedge: hedgeArt,
  stonewall: stoneWallArt,
  road: roadArt,
  bridge: bridgeArt,
  woods: woodsArt, trees: woodsArt,
  pond: pondArt,
  water: riverArt,
  building: buildingArt, wall: buildingArt,
};

// The map edge (the rules' impassable border ring) as a darker frame round the play area.
function borderArt(W, H) {
  const f = 'rgba(28,34,22,0.5)';
  return [rect(0, 0, W, 1, f), rect(0, H - 1, W, 1, f), rect(0, 1, 1, H - 2, f), rect(W - 1, 1, 1, H - 2, f)];
}

// terrain: [{ shape, x, y, w, h, kind, dir?, name, description }] in paint order (later
// wins, exactly as map.js rasterizes them). Returns the render-ready shapes list.
export function terrainArt(terrain, board) {
  const out = borderArt(board.width, board.height);
  for (const t of terrain) {
    const info = { name: t.name, description: t.description };
    const art = ART[t.kind] ?? buildingArt;
    art(t, mulberry32(seedOf(t)), out, info, board);
  }
  return out;
}

// ── units ────────────────────────────────────────────────────────────────────────
// Top-down silhouettes as the renderer's generic `spriteLayers` (SchematicLayer): each
// layer is a circle/rect in units of the token radius R, offset (dx, dy) and rotated
// (rot, degrees) already, so the client needs to know nothing about tanks. 'team' paints
// in the owner's colour (white while the unit is the one being ordered).
//
// R is the board's standard token radius (0.42 tile on this map) times `sizeFrac`, so
// sizeFrac is what makes a Tiger bigger than a Stuart and a tank bigger than a squad.

export const BASE_R = 0.42; // SchematicLayer's square-grid token radius, in tiles

function rot2(lx, ly, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return { dx: R3(lx * c - ly * s), dy: R3(lx * s + ly * c) };
}

const TANKS = {
  sherman:     { size: 1.35, L: 1.78, hullW: 0.72, track: 0.22, turret: 'round', tr: 0.36, tx: 0.08, gun: 1.0,  gunW: 0.1 },
  stuart:      { size: 1.15, L: 1.7,  hullW: 0.68, track: 0.2,  turret: 'box',   tl: 0.58, tw: 0.5, tx: 0.0,  gun: 0.72, gunW: 0.08 },
  'panzer-iv': { size: 1.38, L: 1.9,  hullW: 0.68, track: 0.2,  turret: 'box',   tl: 0.8,  tw: 0.6, tx: -0.04, gun: 1.3,  gunW: 0.09, brake: true, skirts: true },
  tiger:       { size: 1.58, L: 1.8,  hullW: 0.86, track: 0.24, turret: 'box',   tl: 0.84, tw: 0.74, tx: -0.06, gun: 1.42, gunW: 0.11, brake: true },
};

function tankLayers(spec, a) {
  const deg = R3(a * 180 / Math.PI);
  const at = (lx, ly) => rot2(lx, ly, a);
  const box = (lx, ly, w, h, fill, o = {}) => ({ shape: 'rect', wFrac: w, hFrac: h, ...at(lx, ly), rot: deg, fill, ...o });
  const { L, hullW, track } = spec;
  const half = hullW / 2 + track / 2;
  const layers = [];
  for (const s of [-1, 1]) {
    if (spec.skirts) layers.push(box(0, s * (half + track / 2 + 0.03), L * 0.82, 0.06, '#33352c'));
    layers.push(box(0, s * half, L, track, '#26261f', { rxFrac: 0.05, stroke: '#111', strokeWidth: 0.8 }));
    for (let i = -3; i <= 3; i++)                                      // road wheels / links
      layers.push(box(i * L / 8, s * half, 0.03, track * 0.8, 'rgba(110,110,96,0.55)'));
  }
  layers.push(box(0, 0, L * 0.94, hullW, 'team', { rxFrac: 0.06, stroke: '#141414', strokeWidth: 1 }));
  layers.push(box(-L * 0.32, 0, L * 0.26, hullW * 0.78, 'rgba(0,0,0,0.22)'));       // engine deck
  for (const g of [-0.12, 0.12]) layers.push(box(-L * 0.32, g * hullW * 2, L * 0.2, 0.04, 'rgba(0,0,0,0.35)'));
  layers.push(box(L * 0.4, 0, L * 0.1, hullW * 0.95, 'rgba(255,255,255,0.14)'));    // glacis
  if (spec.turret === 'round') {
    layers.push({ shape: 'circle', rFrac: spec.tr, ...at(spec.tx, 0), rot: 0, fill: 'team', stroke: '#141414', strokeWidth: 1.2 });
    layers.push({ shape: 'circle', rFrac: spec.tr * 0.55, ...at(spec.tx - 0.08, -0.08), rot: 0, fill: 'rgba(255,255,255,0.16)' });
  } else {
    layers.push(box(spec.tx, 0, spec.tl, spec.tw, 'team', { rxFrac: 0.1, stroke: '#141414', strokeWidth: 1.2 }));
    layers.push(box(spec.tx - spec.tl * 0.1, -spec.tw * 0.18, spec.tl * 0.6, spec.tw * 0.3, 'rgba(255,255,255,0.14)'));
  }
  const front = spec.tx + (spec.turret === 'round' ? spec.tr : spec.tl / 2);
  layers.push(box(front - 0.02, 0, 0.12, spec.gunW * 2.6, 'rgba(0,0,0,0.45)'));       // mantlet
  layers.push(box(front, 0, spec.gun, spec.gunW, '#262622', { anchorX: 0 }));          // gun
  if (spec.brake) layers.push(box(front + spec.gun - 0.1, 0, 0.12, spec.gunW * 1.9, '#262622', { anchorX: 0 }));
  layers.push({ shape: 'circle', rFrac: 0.1, ...at(spec.tx - 0.12, 0.1), rot: 0, fill: 'rgba(0,0,0,0.4)' }); // hatch
  return layers;
}

// Infantry: a ring marking the team's patch of ground, the men inside it, and the
// weapon that names the team (an MG, a tube, a mortar, a long rifle).
const INFANTRY = {
  'rifle-squad':   { size: 0.95, men: [[0.5, 0], [0.12, 0.44], [0.12, -0.44], [-0.36, 0.22], [-0.36, -0.22]] },
  'volks-squad':   { size: 0.95, men: [[0.5, 0.18], [0.5, -0.18], [0.08, 0.46], [0.08, -0.46], [-0.38, 0.2], [-0.38, -0.2]] },
  'mg-team':       { size: 0.85, men: [[0.12, 0], [-0.22, 0.44], [-0.42, -0.3]], weapon: 'mg' },
  'mg42-team':     { size: 0.85, men: [[0.12, 0], [-0.22, 0.44], [-0.42, -0.3]], weapon: 'mg' },
  'sniper':        { size: 0.75, men: [[0.08, 0.16], [-0.24, -0.36]], weapon: 'long' },
  'german-sniper': { size: 0.75, men: [[0.08, 0.16], [-0.24, -0.36]], weapon: 'long' },
  'bazooka-team':  { size: 0.8,  men: [[0.02, 0.2], [-0.32, -0.34]], weapon: 'tube' },
  'panzerschreck': { size: 0.8,  men: [[0.02, 0.2], [-0.32, -0.34]], weapon: 'tube', shield: true },
  'mortar-team':   { size: 0.85, men: [[-0.38, 0.38], [-0.38, -0.38], [0.42, 0.4]], weapon: 'mortar' },
  'mortar-ger':    { size: 0.85, men: [[-0.38, 0.38], [-0.38, -0.38], [0.42, 0.4]], weapon: 'mortar' },
};

function infantryLayers(spec, a) {
  const deg = R3(a * 180 / Math.PI);
  const at = (lx, ly) => rot2(lx, ly, a);
  const box = (lx, ly, w, h, fill, o = {}) => ({ shape: 'rect', wFrac: w, hFrac: h, ...at(lx, ly), rot: deg, fill, ...o });
  const dot = (lx, ly, r, fill, o = {}) => ({ shape: 'circle', rFrac: r, ...at(lx, ly), rot: 0, fill, ...o });
  const layers = [dot(0, 0, 1, 'rgba(16,20,12,0.22)', { stroke: 'team', strokeWidth: 1.3 })];
  const men = spec.men;
  const [gx, gy] = men[0];
  // Weapons go under the men who carry them.
  if (spec.weapon === 'mg') {
    layers.push(box(gx + 0.1, gy, 0.72, 0.1, '#1e1e1a', { anchorX: 0 }));
    layers.push(box(gx + 0.62, gy, 0.05, 0.3, '#1e1e1a'));                     // bipod
    layers.push(box(men[1][0] + 0.1, men[1][1] - 0.18, 0.2, 0.14, '#5b5232'));  // ammo box
  } else if (spec.weapon === 'long') {
    layers.push(box(gx + 0.05, gy, 0.86, 0.055, '#1e1e1a', { anchorX: 0 }));
    layers.push(box(gx + 0.22, gy, 0.2, 0.1, '#3b3b33'));                       // scope
  } else if (spec.weapon === 'tube') {
    layers.push(box(gx + 0.05, gy, 1.25, 0.18, '#4b5236', { anchorX: 0.4, stroke: '#141414', strokeWidth: 0.8 }));
    if (spec.shield) layers.push(box(gx + 0.36, gy, 0.07, 0.46, '#5d6343', { stroke: '#141414', strokeWidth: 0.8 }));
  } else if (spec.weapon === 'mortar') {
    layers.push(dot(0.05, 0, 0.26, '#3a3a34', { stroke: '#141414', strokeWidth: 0.8 }));
    layers.push(dot(0.05, 0, 0.11, '#121212', { stroke: '#8a8a80', strokeWidth: 1 }));
    layers.push(box(-0.66, 0, 0.18, 0.3, '#5b5232', { stroke: '#141414', strokeWidth: 0.6 }));
  }
  men.forEach(([lx, ly], i) => {
    if (!spec.weapon) layers.push(box(lx + 0.06, ly + 0.1, 0.38, 0.055, '#1e1e1a', { anchorX: 0 })); // rifle
    layers.push(dot(lx, ly, 0.23, 'team', { stroke: '#141414', strokeWidth: 1 }));
    layers.push(dot(lx - 0.05, ly - 0.05, 0.09, 'rgba(255,255,255,0.22)'));          // helmet
    if (spec.weapon === 'long' && i === 1) {                                           // spotter's glasses
      layers.push(dot(lx + 0.2, ly - 0.05, 0.05, '#1e1e1a'));
      layers.push(dot(lx + 0.2, ly + 0.05, 0.05, '#1e1e1a'));
    }
  });
  return layers;
}

// The board token for a unit of `type` heading `a` radians (0 = east, +y = south):
// { spriteLayers, sizeFrac, footprint } — footprint is the outline in world tiles, for
// renderers that draw units smaller than the full sprite (the minimap). Null for a type
// this game has no art for (a unit from another game keeps its own picture).
export function unitArt(type, a) {
  const tank = TANKS[type];
  if (tank) {
    const R = BASE_R * tank.size;
    return {
      spriteLayers: tankLayers(tank, a),
      sizeFrac: tank.size,
      footprint: { shape: 'rect', w: R3(tank.L * R), h: R3((tank.hullW + 2 * tank.track) * R), ang: R3(a) },
    };
  }
  const inf = INFANTRY[type];
  if (inf) {
    return {
      spriteLayers: infantryLayers(inf, a),
      sizeFrac: inf.size,
      footprint: { shape: 'circle', r: R3(BASE_R * inf.size) },
    };
  }
  return null;
}
