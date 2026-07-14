import { TERRAIN } from './terrain.js';
import { UNITS } from './units.js';

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

// Bilinear interpolation
function lerp(a, b, t) { return a + (b - a) * t; }

// Wrap an x coordinate into [0, width) — the world is a cylinder that wraps
// horizontally (east/west), so the left and right edges are the same seam.
export function wrapX(x, width) { return ((x % width) + width) % width; }

// Sample one octave of value noise into a width*height field. Columns wrap
// horizontally: `cellsX` lattice cells span the whole world and the corner
// grid is periodic in x, so noise is seamless across the seam.
function octaveField(width, height, rng, octaves) {
  const field = new Float32Array(width * height);
  for (const [scale, weight] of octaves) {
    const cellsX = Math.max(2, Math.round(width / scale));
    const ch = Math.ceil(height / scale) + 2;
    const grid = Array.from({ length: ch * cellsX }, () => rng());

    for (let y = 0; y < height; y++) {
      const gy = y / scale;
      const iy = Math.floor(gy);
      const fy = gy - iy;
      for (let x = 0; x < width; x++) {
        const gx = (x / width) * cellsX;
        const ix = Math.floor(gx);
        const fx = gx - ix;
        const ix0 = ix % cellsX, ix1 = (ix + 1) % cellsX;
        const i = y * width + x;

        const v = lerp(
          lerp(grid[iy * cellsX + ix0], grid[iy * cellsX + ix1], fx),
          lerp(grid[(iy + 1) * cellsX + ix0], grid[(iy + 1) * cellsX + ix1], fx),
          fy,
        );
        field[i] += v * weight;
      }
    }
  }
  return field;
}

// Fine detail octaves (3, 7, 13) plus a dominant coarse "continent" octave
// (26) — without it, elevation is too locally-averaged to separate into
// distinct landmasses and produces one giant blob instead.
const ELEV_OCTAVES = [[3, 0.15], [7, 0.20], [13, 0.25], [26, 0.40]];
// Moisture uses the opposite weighting — dominated by the fine octaves —
// so vegetation/tundra bands stay locally textured. Reusing ELEV_OCTAVES
// here made moisture itself continent-scale, producing dead-uniform
// horizontal terrain strips at a given latitude across the whole map width.
const MOIST_OCTAVES = [[3, 0.35], [7, 0.30], [13, 0.20], [26, 0.15]];
const ISLAND_SCALE = 4;
const ISLAND_THRESHOLD = 0.94;
const LAND_FRACTION = 0.38;

/**
 * Generate a procedural map using multi-scale value noise.
 * Returns tiles: { "x,y": { terrain, hasRoad, hasRiver, fortress, pollution, special } }
 */
export function generateMap(width, height, rng) {
  const elev = octaveField(width, height, rng, ELEV_OCTAVES);
  const moist = octaveField(width, height, rng, MOIST_OCTAVES);
  // Sparse high-frequency field used only to scatter small islands across
  // open ocean, like the archipelagos in the original game.
  const island = octaveField(width, height, rng, [[ISLAND_SCALE, 1]]);

  // Real polar ice caps: a band of rows at each pole (scaled with map
  // height) rather than a single forced-ocean edge row.
  const poleBand = Math.max(1, Math.min(5, Math.round(height * 0.07)));

  // Quantile threshold: pick the elevation cutoff so exactly LAND_FRACTION of
  // non-polar tiles are land, regardless of this noise realization. A fixed
  // absolute cutoff let land ratio swing wildly seed-to-seed (from ~8% to
  // ~80% land observed while tuning) — this keeps oceans consistently large
  // while still letting the noise shape the coastlines and continent count.
  const nonPolar = [];
  for (let y = poleBand; y < height - poleBand; y++) {
    for (let x = 0; x < width; x++) nonPolar.push(elev[y * width + x]);
  }
  nonPolar.sort((a, b) => a - b);
  const oceanCut = nonPolar[Math.floor(nonPolar.length * (1 - LAND_FRACTION))];

  const isLand = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const poleDist = Math.min(y, height - 1 - y);
    if (poleDist < poleBand) continue;
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (elev[i] >= oceanCut || island[i] > ISLAND_THRESHOLD) isLand[i] = 1;
    }
  }

  // Elevation/moisture rarely span the full [0,1] range — the multi-octave
  // sum concentrates near the mean — so the fixed absolute cutoffs the
  // original code used for mountains/hills/desert/jungle/swamp (e.g.
  // e > 0.84 for mountains) landed past the tail of the real distribution
  // and those terrains almost never appeared. Converting them to quantiles
  // of this map's own mid/low-latitude land tiles keeps the same intended
  // proportions (16% mountains+hills, etc.) but guarantees they show up.
  const quantile = (sorted, q) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : Infinity;
  const tElev = [], tMoist = [];
  for (let y = 0; y < height; y++) {
    const poleDist = Math.min(y, height - 1 - y);
    if (poleDist < poleBand) continue;
    if (poleDist / ((height - 1) / 2) < 0.38) continue;
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!isLand[i]) continue;
      tElev.push(elev[i]);
      tMoist.push(moist[i]);
    }
  }
  tElev.sort((a, b) => a - b);
  tMoist.sort((a, b) => a - b);
  const mountainCut = quantile(tElev, 0.84);
  const hillsCut = quantile(tElev, 0.70);
  const desertCut = quantile(tMoist, 0.18);
  const plainsCut = quantile(tMoist, 0.38);
  const grasslandCut = quantile(tMoist, 0.58);
  const forestCut = quantile(tMoist, 0.76);

  const tiles = {};
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let e = elev[i];
      const m = moist[i];
      const poleDist = Math.min(y, height - 1 - y);

      let terrain;
      if (poleDist < poleBand) {
        terrain = 'arctic';
      } else if (!isLand[i]) {
        terrain = 'ocean';
      } else {
        if (e < oceanCut) e = oceanCut + 0.15; // island tile: nudge above sea level
        const lat = poleDist / ((height - 1) / 2);
        if (lat < 0.18) {
          terrain = e < oceanCut + 0.15 ? 'arctic' : 'tundra';
        } else if (lat < 0.38) {
          terrain = m < 0.4 ? 'tundra' : m < 0.65 ? 'plains' : 'forest';
        } else if (e > mountainCut) {
          terrain = 'mountains';
        } else if (e > hillsCut) {
          terrain = 'hills';
        } else if (m < desertCut) {
          terrain = 'desert';
        } else if (m < plainsCut) {
          terrain = 'plains';
        } else if (m < grasslandCut) {
          terrain = 'grassland';
        } else if (m < forestCut) {
          terrain = 'forest';
        } else if (lat < 0.55) {
          terrain = 'jungle';
        } else {
          terrain = 'swamp';
        }
      }

      tiles[`${x},${y}`] = { terrain, hasRoad: false, hasRiver: false, fortress: false, pollution: false };
    }
  }

  carveRivers(tiles, width, height, elev, rng);
  return tiles;
}

// Carve a handful of rivers by starting from high ground and following the
// steepest-descent path of orthogonal neighbours down to the sea. Only paths
// that actually reach ocean are kept, so no rivers strand inland.
function carveRivers(tiles, width, height, elev, rng) {
  const idx = (x, y) => y * width + x;
  // x wraps horizontally; only y is bounded (poles).
  const inBounds = (x, y) => y >= 0 && y < height;
  const isOcean = (x, y) => tiles[`${wrapX(x, width)},${y}`]?.terrain === 'ocean';
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

  const sources = [];
  for (let y = 2; y < height - 2; y++) {
    for (let x = 0; x < width; x++) {
      const t = tiles[`${x},${y}`];
      if (!t || t.terrain === 'ocean' || t.terrain === 'arctic') continue;
      if (elev[idx(x, y)] > 0.62) sources.push({ x, y });
    }
  }
  if (!sources.length) return;

  const target = Math.max(2, Math.round((width * height) / 280));
  // Cap how far a single river can wander before giving up. Elevation is now
  // continent-scale-dominated (see ELEV_OCTAVES), so local gradients on a
  // plateau are nearly flat; uncapped, steepest-descent degenerated into a
  // long mechanical zigzag across the whole plateau instead of a short,
  // natural-looking river.
  const maxRiverLen = Math.max(6, Math.round(Math.min(width, height) / 2));
  let carved = 0;
  for (let attempt = 0; attempt < target * 8 && carved < target; attempt++) {
    const src = sources[Math.floor(rng() * sources.length)];
    let { x, y } = src;
    const path = [];
    const seen = new Set();
    let reachedSea = false;

    for (let step = 0; step < maxRiverLen; step++) {
      const k = `${x},${y}`;
      if (seen.has(k)) break;
      seen.add(k);
      path.push({ x, y });

      let best = null;
      for (const [dx, dy] of DIRS) {
        const nx = wrapX(x + dx, width), ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        if (isOcean(nx, ny)) { reachedSea = true; break; }
        if (seen.has(`${nx},${ny}`)) continue;
        const e = elev[idx(nx, ny)];
        if (!best || e < best.e) best = { x: nx, y: ny, e };
      }
      if (reachedSea || !best) break;
      x = best.x; y = best.y;
    }

    if (reachedSea && path.length >= 3) {
      for (const p of path) tiles[`${p.x},${p.y}`].hasRiver = true;
      carved++;
    }
  }
}

/**
 * Find a suitable starting position for a player in the given x-range.
 * Prefers grassland/plains away from edges.
 */
export function findStartPos(tiles, width, height, xRange, rng) {
  const preferred = [], fallback = [];
  for (let y = 2; y < height - 2; y++) {
    for (let x = xRange[0]; x < xRange[1]; x++) {
      const t = tiles[`${x},${y}`];
      if (!t || t.terrain === 'ocean' || t.terrain === 'arctic' || t.terrain === 'mountains') continue;
      if (['grassland', 'plains'].includes(t.terrain)) preferred.push({ x, y });
      else fallback.push({ x, y });
    }
  }
  const pool = preferred.length ? preferred : fallback;
  if (!pool.length) return { x: Math.floor((xRange[0] + xRange[1]) / 2), y: Math.floor(height / 2) };
  return pool[Math.floor(rng() * pool.length)];
}

/**
 * Find an adjacent free (non-ocean, unoccupied) position.
 */
export function findAdjacentFree(pos, board, units) {
  const occupied = new Set(units.filter(u => u.alive).map(u => `${u.position.x},${u.position.y}`));
  for (const [dx, dy] of [[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]) {
    const nx = wrapX(pos.x + dx, board.width), ny = pos.y + dy;
    if (ny < 0 || ny >= board.height) continue;
    const k = `${nx},${ny}`;
    const t = board.tiles[k];
    if (!t || t.terrain === 'ocean') continue;
    if (occupied.has(k)) continue;
    return { x: nx, y: ny };
  }
  return null;
}

/**
 * Compute all tiles reachable by a unit given its remaining movesLeft.
 * Uses Dijkstra (max-remaining-moves priority).
 * Air units ignore terrain cost; sea units require ocean tiles; land units require non-ocean.
 */
export function getReachableTiles(unit, board, allUnits, playerId) {
  const stats = UNITS[unit.type];
  const { domain } = stats;
  const key = p => `${p.x},${p.y}`;

  // Build enemy/friendly sets
  const enemyPos = new Set(allUnits.filter(u => u.alive && u.ownerId !== playerId).map(u => key(u.position)));
  const friendlyPos = new Set(allUnits.filter(u => u.alive && u.ownerId === playerId && u.id !== unit.id).map(u => key(u.position)));

  const best = new Map([[key(unit.position), unit.movesLeft]]);
  const queue = [{ pos: unit.position, ml: unit.movesLeft }];
  const reachable = [];

  while (queue.length) {
    // Simple max-first sort (good enough for small maps)
    queue.sort((a, b) => b.ml - a.ml);
    const { pos, ml } = queue.shift();

    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]) {
      const ny = pos.y + dy;
      if (ny < 0 || ny >= board.height) continue;
      const next = { x: wrapX(pos.x + dx, board.width), y: ny };
      const k = key(next);

      const tile = board.tiles[k];
      if (!tile) continue;

      const td = TERRAIN[tile.terrain];
      if (!td) continue;

      // Domain passability check
      if (domain === 'land' && !td.passable.land) continue;
      if (domain === 'sea'  && !td.passable.sea)  continue;

      // Can't move through enemy land units; can attack them
      if (domain === 'land' && enemyPos.has(k)) continue;

      // Can't stack with own units
      if (friendlyPos.has(k)) continue;

      // Movement cost: road = 1/3, railroad = 0, air = always 1
      let cost;
      if (domain === 'air') {
        cost = 1;
      } else if (tile.hasRailroad) {
        cost = 0;
      } else if (tile.hasRoad) {
        cost = 1 / 3;
      } else {
        cost = td.moveCost;
      }

      // Civ2 rule: can always enter if ml > 0 (even if cost > ml), just set remaining to 0
      if (ml <= 0) continue;
      const remaining = Math.max(0, ml - cost);

      if ((best.get(k) ?? -1) >= remaining) continue;
      best.set(k, remaining);
      reachable.push(next);
      if (remaining > 0) queue.push({ pos: next, ml: remaining });
    }
  }

  return reachable;
}

// ── ASCII Rendering ───────────────────────────────────────────────────────────

export function renderMap(state) {
  const { board, units, cities } = state;
  const { width, height } = board;

  // Build lookup maps
  const cityMap = {};
  for (const c of cities) cityMap[`${c.position.x},${c.position.y}`] = c;

  const unitMap = {};
  for (const u of units) {
    if (!u.alive) continue;
    const k = `${u.position.x},${u.position.y}`;
    // Prefer showing player-1 units on top for display
    if (!unitMap[k] || u.ownerId === state.players[0].id) unitMap[k] = u;
  }

  const p1Id = state.players[0].id;

  const header = '    ' + Array.from({ length: width }, (_, i) => String(i).padStart(2)).join('');
  const rows = [header];

  for (let y = height - 1; y >= 0; y--) {
    let row = String(y).padStart(2) + ' |';
    for (let x = 0; x < width; x++) {
      const k = `${x},${y}`;
      const tile = board.tiles[k];
      const city = cityMap[k];
      const unit = unitMap[k];

      if (city) {
        const mark = city.ownerId === p1Id ? '1' : '2';
        row += ` ${mark}`;
      } else if (unit) {
        const sym = unit.type[0];
        row += ` ${unit.ownerId === p1Id ? sym.toUpperCase() : sym.toLowerCase()}`;
      } else {
        const sym = tile ? (TERRAIN[tile.terrain]?.symbol ?? '?') : ' ';
        row += ` ${sym}`;
      }
    }
    rows.push(row);
  }

  return rows.join('\n');
}
