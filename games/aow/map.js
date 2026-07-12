import { TERRAIN } from './terrain.js';
import { forEachCell } from '../terrainShapes.js';
import { terrainDecor } from './decor.js';

// Fast seeded PRNG (mulberry32)
export function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerp(a, b, t) { return a + (b - a) * t; }

function shapeStyle(kind) {
  const t = TERRAIN[kind];
  return { fill: t.color, name: t.name, description: t.description };
}

// ── Continuous terrain lookup ───────────────────────────────────────────────
// Positions on the AoW map are continuous floats; terrain/forage are looked up by the
// tile the point falls in. Out-of-bounds reads as impassable mountain.
export function terrainAt(board, x, y) {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (tx < 0 || tx >= board.width || ty < 0 || ty >= board.height) return 'mountains';
  return board.tiles[`${tx},${ty}`]?.terrain ?? 'plains';
}

export function isPassablePoint(board, x, y) {
  return TERRAIN[terrainAt(board, x, y)].passable;
}

export function forageAt(board, x, y) {
  return TERRAIN[terrainAt(board, x, y)].forage;
}

// How far a squad of base speed `speed` gets marching straight from (x0,y0) toward
// (x1,y1): terrain slows it (plains 1.0, forest 0.55, …) and mountains stop it. Returns
// the reachable endpoint (may be short of the target) and the terrain-integrated distance.
export function marchAlong(board, x0, y0, x1, y1, budget, samplesPerUnit = 8) {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  if (dist === 0) return { x: x0, y: y0 };
  const ux = (x1 - x0) / dist, uy = (y1 - y0) / dist;
  const step = 1 / samplesPerUnit;
  let travelled = 0, spent = 0;
  let cx = x0, cy = y0;
  while (travelled < dist && spent < budget) {
    const nx = cx + ux * step, ny = cy + uy * step;
    if (!isPassablePoint(board, nx, ny)) break; // ridge blocks the march
    const speed = TERRAIN[terrainAt(board, nx, ny)].speed;
    spent += step / Math.max(0.05, speed); // slow terrain costs more budget per unit
    if (spent > budget) break;
    cx = nx; cy = ny; travelled += step;
  }
  return { x: cx, y: cy };
}

/**
 * Generate a procedural battlefield. Terrain (plains/forest/hills/water/mountains) is
 * authored as smooth shapes over value noise (see the original design note below), then
 * rasterized to a tile grid for movement/combat. On top of terrain we place the campaign
 * FEATURES that make AoW AoW: a home fort + flag for each side, a contested central fort,
 * and neutral villages. Camp safe zones (radius 3) are forced to plains so armies can form up.
 * Returns { tiles, shapes, features }.
 */
export function generateMap(width, height, rng, homes, seed = 1) {
  const elev  = new Float32Array(width * height);
  const moist = new Float32Array(width * height);

  for (const [scale, weight] of [[4, 0.5], [8, 0.3], [14, 0.2]]) {
    const cw = Math.ceil(width  / scale) + 2;
    const ch = Math.ceil(height / scale) + 2;
    const ec = Array.from({ length: ch * cw }, () => rng());
    const mc = Array.from({ length: ch * cw }, () => rng());

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const gx = x / scale, gy = y / scale;
        const ix = Math.floor(gx), iy = Math.floor(gy);
        const fx = gx - ix, fy = gy - iy;
        const i  = y * width + x;
        elev[i]  += lerp(
          lerp(ec[iy * cw + ix], ec[iy * cw + ix + 1], fx),
          lerp(ec[(iy + 1) * cw + ix], ec[(iy + 1) * cw + ix + 1], fx), fy,
        ) * weight;
        moist[i] += lerp(
          lerp(mc[iy * cw + ix], mc[iy * cw + ix + 1], fx),
          lerp(mc[(iy + 1) * cw + ix], mc[(iy + 1) * cw + ix + 1], fx), fy,
        ) * weight;
      }
    }
  }

  const CAMP_SAFE = 3; // Chebyshev radius around homes forced to plains
  const isBorder  = (x, y) => x === 0 || x === width - 1 || y === 0 || y === height - 1;
  const nearHome  = (x, y) => homes.some(c => Math.max(Math.abs(x - c.x), Math.abs(y - c.y)) <= CAMP_SAFE);

  // A meandering river down the middle third — shallow water, fordable but perilous.
  const riverX = Math.floor(width / 2);
  const riverPhase = rng() * Math.PI * 2;
  const riverAmp = Math.max(1, Math.floor(width * 0.06));
  const isRiver = (x, y) => {
    const cx = riverX + Math.round(Math.sin(y / 2.2 + riverPhase) * riverAmp);
    return Math.abs(x - cx) <= 0 && y > 1 && y < height - 2;
  };

  function classify(x, y) {
    if (nearHome(x, y)) return 'plains';
    if (isRiver(x, y))  return 'water';
    const i = y * width + x, e = elev[i], m = moist[i];
    // Thresholds tuned so the interior isn't an empty plain: roughly a third is
    // forest/hills cover with a few rocky outcrops, while camp-to-camp connectivity
    // holds (water is fordable; the mountain ridge threshold stays high).
    if (e > 0.80) return 'mountains';
    if (e > 0.58) return 'hills';
    if (m > 0.54) return 'forest';
    return 'plains';
  }

  // Flood-fill connected same-type interior regions and approximate each as an oval
  // — smooth organic patches instead of jagged per-cell edges.
  const shapes  = [];
  const visited = new Uint8Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (visited[idx]) continue;
      visited[idx] = 1;
      const type = classify(x, y);
      if (type === 'plains') continue;

      let minX = x, maxX = x, minY = y, maxY = y;
      const queue = [[x, y]];
      while (queue.length) {
        const [cx, cy] = queue.pop();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 1 || nx >= width - 1 || ny < 1 || ny >= height - 1) continue;
          const nIdx = ny * width + nx;
          if (visited[nIdx]) continue;
          if (classify(nx, ny) !== type) continue;
          visited[nIdx] = 1;
          minX = Math.min(minX, nx); maxX = Math.max(maxX, nx);
          minY = Math.min(minY, ny); maxY = Math.max(maxY, ny);
          queue.push([nx, ny]);
        }
      }

      const pad = type === 'water' ? 0.15 : 0.4; // rivers stay slim
      shapes.push({
        shape: 'oval', kind: type,
        x: minX - pad, y: minY - pad,
        w: (maxX - minX) + 1 + pad * 2,
        h: (maxY - minY) + 1 + pad * 2,
        ...shapeStyle(type),
      });
    }
  }

  // Border ring — always mountains, drawn as four strips.
  shapes.push({ shape: 'rect', kind: 'mountains', x: 0, y: 0, w: width, h: 1, ...shapeStyle('mountains') });
  shapes.push({ shape: 'rect', kind: 'mountains', x: 0, y: height - 1, w: width, h: 1, ...shapeStyle('mountains') });
  shapes.push({ shape: 'rect', kind: 'mountains', x: 0, y: 0, w: 1, h: height, ...shapeStyle('mountains') });
  shapes.push({ shape: 'rect', kind: 'mountains', x: width - 1, y: 0, w: 1, h: height, ...shapeStyle('mountains') });

  // Rasterize shapes onto the tile grid the mechanics use.
  const tiles = {};
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      tiles[`${x},${y}`] = { terrain: 'plains' };
  for (const s of shapes)
    forEachCell(s, width, height, (x, y) => { tiles[`${x},${y}`].terrain = s.kind; });
  // Re-assert camp safe zones (border stays mountains regardless).
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (nearHome(x, y) && !isBorder(x, y)) tiles[`${x},${y}`].terrain = 'plains';

  // ── Features ───────────────────────────────────────────────────────────────
  const taken = new Set();
  const key = (x, y) => `${x},${y}`;
  function nearestPassable(tx, ty, avoidRadius = 0) {
    for (let r = 0; r < Math.max(width, height); r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = tx + dx, y = ty + dy;
          if (x <= 0 || x >= width - 1 || y <= 0 || y >= height - 1) continue;
          if (!TERRAIN[tiles[key(x, y)].terrain].passable) continue;
          if (taken.has(key(x, y))) continue;
          let ok = true;
          for (const t of taken) {
            const [ex, ey] = t.split(',').map(Number);
            if (Math.max(Math.abs(ex - x), Math.abs(ey - y)) < avoidRadius) { ok = false; break; }
          }
          if (ok) { taken.add(key(x, y)); return { x: x + 0.5, y: y + 0.5 }; }
        }
      }
    }
    taken.add(key(tx, ty));
    return { x: tx + 0.5, y: ty + 0.5 };
  }

  const [h1, h2] = homes;
  const cy = Math.floor((height - 1) / 2);
  const features = [];
  // Home forts (reinforcement bases) with each side's flag on them — take the enemy's to win.
  const fort1 = nearestPassable(h1.x, h1.y);
  const fort2 = nearestPassable(h2.x, h2.y);
  features.push({ id: 'fort_p1', type: 'fort', owner: 'p1', origOwner: 'p1', x: fort1.x, y: fort1.y });
  features.push({ id: 'fort_p2', type: 'fort', owner: 'p2', origOwner: 'p2', x: fort2.x, y: fort2.y });
  features.push({ id: 'flag_p1', type: 'flag', owner: 'p1', origOwner: 'p1', x: fort1.x, y: fort1.y });
  features.push({ id: 'flag_p2', type: 'flag', owner: 'p2', origOwner: 'p2', x: fort2.x, y: fort2.y });
  // A contested central fort — reinforcements to whoever holds it.
  const midFort = nearestPassable(Math.floor(width / 2), cy, 2);
  features.push({ id: 'fort_mid', type: 'fort', owner: null, origOwner: null, x: midFort.x, y: midFort.y });
  // Neutral villages — occupy them for supply and to cut the enemy's food.
  const nVillages = Math.max(2, Math.round(width / 8));
  for (let i = 0; i < nVillages; i++) {
    const vx = Math.floor(width * (i + 1) / (nVillages + 1)) + Math.round((rng() - 0.5) * 4);
    const vy = Math.floor(height * (0.25 + 0.5 * rng()));
    const v = nearestPassable(vx, vy, 2);
    features.push({ id: `village_${i}`, type: 'village', owner: null, origOwner: null, x: v.x, y: v.y });
  }

  // Dense per-tile texture (trees, peaks, hill contours, waves) drawn over the base patches
  // — this is what gives the map its detail instead of flat colour blobs. Computed once.
  const decor = terrainDecor(width, height, (x, y) => tiles[`${x},${y}`]?.terrain ?? 'plains', seed);

  return { tiles, shapes, decor, features, homes: { p1: fort1, p2: fort2 } };
}

export function renderMap(state) {
  const { board, squads } = state;
  const { width, height } = board;
  const [p1] = state.players;

  const glyphAt = {};
  for (const f of board.features) {
    const gx = Math.floor(f.x), gy = Math.floor(f.y);
    if (f.type === 'fort') glyphAt[`${gx},${gy}`] = f.owner ? (f.owner === p1.id ? '=' : '#') : 'o';
    else if (f.type === 'village' && !glyphAt[`${gx},${gy}`]) glyphAt[`${gx},${gy}`] = 'v';
  }
  const squadAt = {};
  for (const s of squads) {
    if (!s.alive) continue;
    const gx = Math.floor(s.position.x), gy = Math.floor(s.position.y);
    squadAt[`${gx},${gy}`] = s;
  }

  const header = '    ' + Array.from({ length: width }, (_, i) => String(i % 10)).join(' ');
  const rows = [header];
  for (let y = 0; y < height; y++) {
    let row = String(y).padStart(2) + ' |';
    for (let x = 0; x < width; x++) {
      const k = `${x},${y}`;
      const sq = squadAt[k];
      if (sq) {
        const dom = sq.ownerId === p1.id ? 'U' : 'e';
        row += ` ${dom}`;
      } else if (glyphAt[k]) {
        row += ` ${glyphAt[k]}`;
      } else {
        row += ` ${TERRAIN[board.tiles[k]?.terrain]?.symbol ?? '?'}`;
      }
    }
    rows.push(row);
  }
  return rows.join('\n');
}
