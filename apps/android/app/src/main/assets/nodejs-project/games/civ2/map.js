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

/**
 * Generate a procedural map using multi-scale value noise.
 * Returns tiles: { "x,y": { terrain, hasRoad, hasRiver, fortress, pollution, special } }
 */
export function generateMap(width, height, rng) {
  // Build elevation and moisture grids via multi-scale noise
  const elev = new Float32Array(width * height);
  const moist = new Float32Array(width * height);

  for (const [scale, weight] of [[3, 0.5], [7, 0.3], [13, 0.2]]) {
    const cw = Math.ceil(width  / scale) + 2;
    const ch = Math.ceil(height / scale) + 2;
    const ec = Array.from({ length: ch * cw }, () => rng());
    const mc = Array.from({ length: ch * cw }, () => rng());

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const gx = x / scale, gy = y / scale;
        const ix = Math.floor(gx), iy = Math.floor(gy);
        const fx = gx - ix, fy = gy - iy;
        const i = y * width + x;

        const e = lerp(
          lerp(ec[iy * cw + ix], ec[iy * cw + ix + 1], fx),
          lerp(ec[(iy + 1) * cw + ix], ec[(iy + 1) * cw + ix + 1], fx),
          fy,
        );
        const m = lerp(
          lerp(mc[iy * cw + ix], mc[iy * cw + ix + 1], fx),
          lerp(mc[(iy + 1) * cw + ix], mc[(iy + 1) * cw + ix + 1], fx),
          fy,
        );
        elev[i] += e * weight;
        moist[i] += m * weight;
      }
    }
  }

  const tiles = {};
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const e = elev[i];
      const m = moist[i];
      const edge = Math.min(x, y, width - 1 - x, height - 1 - y);
      // Latitude: 0 at poles, 1 at equator
      const lat = Math.min(y, height - 1 - y) / ((height - 1) / 2);

      let terrain;
      if (edge <= 0 || e < 0.32) {
        terrain = 'ocean';
      } else if (lat < 0.18) {
        terrain = e < 0.48 ? 'arctic' : 'tundra';
      } else if (lat < 0.38) {
        terrain = m < 0.4 ? 'tundra' : m < 0.65 ? 'plains' : 'forest';
      } else if (e > 0.84) {
        terrain = 'mountains';
      } else if (e > 0.70) {
        terrain = 'hills';
      } else if (m < 0.18) {
        terrain = 'desert';
      } else if (m < 0.38) {
        terrain = 'plains';
      } else if (m < 0.58) {
        terrain = 'grassland';
      } else if (m < 0.76) {
        terrain = 'forest';
      } else if (lat < 0.55) {
        terrain = 'jungle';
      } else {
        terrain = 'swamp';
      }

      tiles[`${x},${y}`] = { terrain, hasRoad: false, hasRiver: false, fortress: false, pollution: false };
    }
  }
  return tiles;
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
    const nx = pos.x + dx, ny = pos.y + dy;
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
      const next = { x: pos.x + dx, y: pos.y + dy };
      const k = key(next);
      if (next.x < 0 || next.x >= board.width || next.y < 0 || next.y >= board.height) continue;

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
