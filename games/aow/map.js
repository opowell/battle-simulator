import { TERRAIN } from './terrain.js';

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

/**
 * Generate a procedural battlefield using multi-scale value noise.
 * Border tiles are mountains; camp safe zones are guaranteed plains.
 * Returns tiles: { "x,y": { terrain, hasCamp } }
 */
export function generateMap(width, height, rng, campPositions) {
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

  const tiles = {};
  const CAMP_SAFE = 3; // Chebyshev radius around camps forced to plains

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const e = elev[i], m = moist[i];

      const isBorder  = (y === 0 || y === height - 1 || x === 0 || x === width - 1);
      const nearCamp  = campPositions.some(c => Math.max(Math.abs(x - c.x), Math.abs(y - c.y)) <= CAMP_SAFE);
      const isCamp    = campPositions.some(c => c.x === x && c.y === y);

      let terrain;
      if (isBorder) {
        terrain = 'mountains';
      } else if (nearCamp) {
        terrain = 'plains';
      } else if (e > 0.82) {
        terrain = 'mountains';
      } else if (e > 0.66) {
        terrain = 'hills';
      } else if (m > 0.62) {
        terrain = 'forest';
      } else {
        terrain = 'plains';
      }

      tiles[`${x},${y}`] = { terrain, hasCamp: isCamp };
    }
  }

  return tiles;
}

/**
 * Dijkstra-based reachability. Returns all tiles a unit can reach this turn.
 * Units can always enter any passable tile (even if cost > remaining moves),
 * they just end up with 0 moves left — preventing fractional-move deadlock.
 */
export function getReachableTiles(unit, board, allUnits, playerId) {
  const key = p => `${p.x},${p.y}`;
  const enemyPos   = new Set(allUnits.filter(u => u.alive && u.ownerId !== playerId).map(u => key(u.position)));
  const friendlyPos = new Set(allUnits.filter(u => u.alive && u.ownerId === playerId && u.id !== unit.id).map(u => key(u.position)));

  const best  = new Map([[key(unit.position), unit.movesLeft]]);
  const queue = [{ pos: unit.position, ml: unit.movesLeft }];
  const reachable = [];

  const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];

  while (queue.length) {
    queue.sort((a, b) => b.ml - a.ml);
    const { pos, ml } = queue.shift();

    for (const [dx, dy] of dirs) {
      const next = { x: pos.x + dx, y: pos.y + dy };
      const k = key(next);
      if (next.x < 0 || next.x >= board.width || next.y < 0 || next.y >= board.height) continue;
      const tile = board.tiles[k];
      if (!tile) continue;
      const td = TERRAIN[tile.terrain];
      if (!td?.passable) continue;
      if (enemyPos.has(k)) continue;   // can't move through enemies; attack them instead
      if (friendlyPos.has(k)) continue; // no stacking
      if (ml <= 0) continue;
      const remaining = Math.max(0, ml - td.moveCost);
      if ((best.get(k) ?? -1) >= remaining) continue;
      best.set(k, remaining);
      reachable.push(next);
      if (remaining > 0) queue.push({ pos: next, ml: remaining });
    }
  }

  return reachable;
}

export function renderMap(state) {
  const { board, units } = state;
  const { width, height } = board;
  const [p1, p2] = state.players;
  const { p1Camp, p2Camp } = state.gameSpecific;

  const unitMap = {};
  for (const u of units) {
    if (!u.alive) continue;
    const k = `${u.position.x},${u.position.y}`;
    if (!unitMap[k] || u.ownerId === p1.id) unitMap[k] = u;
  }

  const SYMS = { warrior: 'W', archer: 'A', cavalry: 'H' };
  const header = '    ' + Array.from({ length: width }, (_, i) => String(i).padStart(2)).join('');
  const rows = [header];

  for (let y = height - 1; y >= 0; y--) {
    let row = String(y).padStart(2) + ' |';
    for (let x = 0; x < width; x++) {
      const k    = `${x},${y}`;
      const tile = board.tiles[k];
      const unit = unitMap[k];

      if (unit) {
        const sym = SYMS[unit.type] ?? '?';
        row += ` ${unit.ownerId === p1.id ? sym : sym.toLowerCase()}`;
      } else if (tile?.hasCamp) {
        const mark = (p1Camp.x === x && p1Camp.y === y) ? '1' : '2';
        row += ` ${mark}`;
      } else {
        row += ` ${TERRAIN[tile?.terrain]?.symbol ?? '?'}`;
      }
    }
    rows.push(row);
  }

  return rows.join('\n');
}
