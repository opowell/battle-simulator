// Primitive-shape art for The Ancient Art of War: castles, hut-cluster villages, banners,
// and dense terrain texture (trees, mountain peaks, hill contours, river waves). Everything
// is built from the renderer's `oval` / `rect` / `poly` / `line` primitives (world coords),
// echoing the chunky CGA look of the 1984 original instead of flat colour blobs.
//
// Icon builders take a centre point and return an array of shapes. Terrain texture is
// generated once per map (deterministic per-tile RNG) and cached on the board.

// Deterministic per-tile RNG so the same map always textures identically (mulberry32,
// inlined to keep this module free of a map.js import cycle).
function tileRng(tx, ty, seed) {
  let s = ((tx * 73856093) ^ (ty * 19349663) ^ (seed * 83492791)) >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tri = (ax, ay, bx, by, cx, cy, fill, extra = {}) =>
  ({ shape: 'poly', points: [{ x: ax, y: ay }, { x: bx, y: by }, { x: cx, y: cy }], fill, ...extra });

// ── Feature icons ─────────────────────────────────────────────────────────────

// A castle keep with two towers, battlements, a gate and an owner-coloured banner.
export function castleShapes(cx, cy, owner, size = 1.15) {
  const s = size, dark = '#2b2622', stone = '#9a9187', stoneLo = '#6f675e';
  const top = cy - 0.42 * s, wallY = cy - 0.14 * s, botY = cy + 0.42 * s;
  const out = [];
  // Towers (left/right), taller than the wall.
  for (const tx of [cx - 0.42 * s, cx + 0.24 * s]) {
    out.push({ shape: 'rect', x: tx, y: top, w: 0.18 * s, h: botY - top, fill: stone, stroke: dark, strokeWidth: 1 });
    // battlements
    for (let i = 0; i < 2; i++)
      out.push({ shape: 'rect', x: tx + i * 0.11 * s, y: top - 0.07 * s, w: 0.07 * s, h: 0.09 * s, fill: stone, stroke: dark, strokeWidth: 0.8 });
  }
  // Central wall block.
  out.push({ shape: 'rect', x: cx - 0.30 * s, y: wallY, w: 0.60 * s, h: botY - wallY, fill: stone, stroke: dark, strokeWidth: 1 });
  // Shadow side of the wall.
  out.push({ shape: 'rect', x: cx + 0.06 * s, y: wallY, w: 0.24 * s, h: botY - wallY, fill: stoneLo, opacity: 0.55 });
  // Wall battlements.
  for (let i = 0; i < 4; i++)
    out.push({ shape: 'rect', x: cx - 0.30 * s + i * 0.16 * s, y: wallY - 0.07 * s, w: 0.09 * s, h: 0.09 * s, fill: stone, stroke: dark, strokeWidth: 0.8 });
  // Gate (arched-ish dark opening).
  out.push({ shape: 'rect', x: cx - 0.09 * s, y: botY - 0.24 * s, w: 0.18 * s, h: 0.24 * s, fill: dark });
  out.push({ shape: 'oval', x: cx - 0.09 * s, y: botY - 0.30 * s, w: 0.18 * s, h: 0.14 * s, fill: dark });
  // Banner on the left tower — owner colour on a pole.
  const poleX = cx - 0.33 * s;
  out.push({ shape: 'line', x1: poleX, y1: top - 0.07 * s, x2: poleX, y2: top - 0.34 * s, stroke: dark, strokeWidth: 1 });
  out.push(tri(poleX, top - 0.34 * s, poleX + 0.20 * s, top - 0.29 * s, poleX, top - 0.20 * s, owner));
  return out;
}

// A village: a cluster of white domed huts with little doorways and a couple of peaked roofs.
export function villageShapes(cx, cy, size = 1.0) {
  const s = size, wall = '#efe7d2', roof = '#8a5a34', dark = '#3a2f24', shade = '#cbbfa2';
  const huts = [
    { x: cx - 0.24 * s, y: cy + 0.04 * s, r: 0.20 * s, dome: true },
    { x: cx + 0.20 * s, y: cy + 0.02 * s, r: 0.18 * s, dome: false },
    { x: cx - 0.02 * s, y: cy + 0.22 * s, r: 0.19 * s, dome: true },
    { x: cx + 0.06 * s, y: cy - 0.20 * s, r: 0.16 * s, dome: false },
  ];
  const out = [];
  for (const h of huts) {
    if (h.dome) {
      out.push({ shape: 'oval', x: h.x - h.r, y: h.y - h.r, w: 2 * h.r, h: 2 * h.r, fill: wall, stroke: dark, strokeWidth: 0.8 });
      out.push({ shape: 'oval', x: h.x - h.r * 0.5, y: h.y - h.r * 0.3, w: h.r, h: h.r * 0.9, fill: shade, opacity: 0.5 });
    } else {
      out.push({ shape: 'rect', x: h.x - h.r, y: h.y - 0.2 * h.r, w: 2 * h.r, h: 1.3 * h.r, fill: wall, stroke: dark, strokeWidth: 0.8 });
      out.push(tri(h.x - h.r * 1.15, h.y - 0.2 * h.r, h.x + h.r * 1.15, h.y - 0.2 * h.r, h.x, h.y - h.r * 1.1, roof, { stroke: dark, strokeWidth: 0.8 }));
      out.push({ shape: 'rect', x: h.x - 0.22 * h.r, y: h.y + 0.5 * h.r, w: 0.44 * h.r, h: 0.6 * h.r, fill: dark });
    }
  }
  return out;
}

// A planted flag: a pole with a triangular pennant in the owner's colour.
export function flagShapes(cx, cy, owner, size = 0.95) {
  const s = size, dark = '#2b2622';
  const topY = cy - 0.5 * s, botY = cy + 0.42 * s;
  return [
    { shape: 'line', x1: cx, y1: botY, x2: cx, y2: topY, stroke: dark, strokeWidth: 1.4 },
    { shape: 'oval', x: cx - 0.05 * s, y: botY - 0.05 * s, w: 0.1 * s, h: 0.1 * s, fill: dark },
    tri(cx, topY, cx + 0.34 * s, topY + 0.11 * s, cx, topY + 0.24 * s, owner, { stroke: dark, strokeWidth: 0.8 }),
  ];
}

// ── Terrain texture ─────────────────────────────────────────────────────────────

function treeShapes(cx, baseY, s, rng) {
  const trunk = '#5a3f26';
  const canopy = rng() < 0.5 ? '#1f5a28' : '#276e30';
  const hi = '#3f8a42';
  return [
    { shape: 'rect', x: cx - 0.03 * s, y: baseY - 0.16 * s, w: 0.06 * s, h: 0.18 * s, fill: trunk },
    tri(cx - 0.22 * s, baseY - 0.02 * s, cx + 0.22 * s, baseY - 0.02 * s, cx, baseY - 0.42 * s, canopy),
    tri(cx - 0.18 * s, baseY - 0.16 * s, cx + 0.18 * s, baseY - 0.16 * s, cx, baseY - 0.52 * s, canopy),
    tri(cx - 0.09 * s, baseY - 0.22 * s, cx + 0.02 * s, baseY - 0.22 * s, cx - 0.04 * s, baseY - 0.44 * s, hi, { opacity: 0.6 }),
  ];
}

function peakShapes(cx, baseY, w, h, rng) {
  const rock = rng() < 0.5 ? '#7d7266' : '#8b8072', shadow = '#554d43', snow = '#f2efe8';
  const apexX = cx + (rng() - 0.5) * 0.2 * w, apexY = baseY - h;
  const lx = cx - w / 2, rx = cx + w / 2;
  return [
    tri(lx, baseY, rx, baseY, apexX, apexY, rock),                                   // face
    tri(apexX, apexY, rx, baseY, cx + 0.10 * w, baseY, shadow),                       // shadow side
    tri(apexX, apexY, apexX - 0.16 * w, apexY + 0.24 * h, apexX + 0.16 * w, apexY + 0.24 * h, snow), // snow cap
  ];
}

function hillShapes(cx, cy, w, h, rng) {
  const grass = rng() < 0.5 ? '#a89152' : '#b49a58', shade = '#7d6a3c';
  return [
    { shape: 'oval', x: cx - w / 2, y: cy - h / 2, w, h, fill: grass },
    { shape: 'oval', x: cx - w * 0.18, y: cy - h * 0.1, w: w * 0.5, h: h * 0.55, fill: shade, opacity: 0.35 },
  ];
}

function waveShapes(cx, cy, w) {
  const hi = '#5b86a6';
  return [{ shape: 'line', x1: cx - w / 2, y1: cy, x2: cx + w / 2, y2: cy, stroke: hi, strokeWidth: 1 }];
}

function grassShapes(cx, cy, rng) {
  const g = '#7f7838';
  const out = [];
  for (let i = 0; i < 3; i++) {
    const ox = cx + (rng() - 0.5) * 0.5;
    out.push({ shape: 'line', x1: ox, y1: cy + 0.08, x2: ox + (rng() - 0.5) * 0.12, y2: cy - 0.12, stroke: g, strokeWidth: 0.8 });
  }
  return out;
}

/**
 * Dense per-tile terrain texture (trees, peaks, hill contours, waves, grass tufts). Returns
 * a flat array of primitive shapes to draw over the base terrain patches. Deterministic per
 * (tile, seed). Border/near-home tiles are handled by the caller-supplied `terrainOf`.
 */
export function terrainDecor(width, height, terrainOf, seed) {
  const out = [];
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const t = terrainOf(tx, ty);
      const rng = tileRng(tx, ty, seed);
      const cx = tx + 0.5, cy = ty + 0.5, baseY = ty + 0.9;
      if (t === 'forest') {
        const n = 2 + (rng() < 0.6 ? 1 : 0);
        for (let i = 0; i < n; i++)
          out.push(...treeShapes(tx + 0.25 + rng() * 0.5, ty + 0.3 + rng() * 0.6, 0.9 + rng() * 0.3, rng));
      } else if (t === 'mountains') {
        const n = 1 + (rng() < 0.5 ? 1 : 0);
        for (let i = 0; i < n; i++)
          out.push(...peakShapes(tx + 0.3 + rng() * 0.4, baseY, 0.7 + rng() * 0.5, 0.7 + rng() * 0.5, rng));
      } else if (t === 'hills') {
        out.push(...hillShapes(cx, cy + 0.1, 0.8 + rng() * 0.3, 0.5 + rng() * 0.2, rng));
        if (rng() < 0.4) out.push(...treeShapes(tx + 0.2 + rng() * 0.6, ty + 0.7, 0.7, rng));
      } else if (t === 'water') {
        const n = 1 + (rng() < 0.5 ? 1 : 0);
        for (let i = 0; i < n; i++) out.push(...waveShapes(cx + (rng() - 0.5) * 0.4, ty + 0.3 + rng() * 0.5, 0.5 + rng() * 0.3));
      } else if (rng() < 0.22) {
        out.push(...grassShapes(cx, cy, rng));
      }
    }
  }
  return out;
}
