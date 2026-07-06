import { forEachCell } from '../terrainShapes.js';

export const MAP_WIDTH  = 20;
export const MAP_HEIGHT = 14;

function k(x, y) { return `${x},${y}`; }

// Level authored as an array of shapes (rects + ovals, see games/terrainShapes.js)
// carved out of solid rock, rather than a hand-typed tile grid — lets the two arena
// rooms be round instead of every room being a uniform rectangle. Rasterized onto
// MAP_TILES below for movement/LOS, and reused as-is by DoomGame.toGrid for a smooth
// non-grid render (same footprints as the original rectangular rooms, so existing
// monster/item placements all still land on floor).
export const MAP_ROOMS = [
  { shape: 'rect', x: 1, y: 1,  w: 5,  h: 4 }, // Room A — marine start
  { shape: 'rect', x: 6, y: 2,  w: 3,  h: 1 }, // corridor A→B
  { shape: 'oval', x: 9, y: 1,  w: 10, h: 5 }, // Room B — upper right (first encounter)
  { shape: 'rect', x: 3, y: 5,  w: 1,  h: 1 }, // corridor A→C
  { shape: 'rect', x: 1, y: 6,  w: 18, h: 2 }, // Room C — mid corridor
  { shape: 'oval', x: 1, y: 8,  w: 7,  h: 5 }, // Room D — bottom left (melee brute)
  { shape: 'rect', x: 8, y: 10, w: 1,  h: 1 }, // corridor D↔E
  { shape: 'oval', x: 9, y: 8,  w: 10, h: 5 }, // Room E — boss arena
];

function buildMap() {
  const tiles = {};
  for (let y = 0; y < MAP_HEIGHT; y++)
    for (let x = 0; x < MAP_WIDTH; x++)
      tiles[k(x, y)] = 'wall';

  for (const room of MAP_ROOMS)
    forEachCell(room, MAP_WIDTH, MAP_HEIGHT, (x, y) => { tiles[k(x, y)] = 'floor'; });

  return tiles;
}

export const MAP_TILES = buildMap();

export function isWalkable(x, y) {
  return MAP_TILES[k(x, y)] === 'floor';
}

// Bresenham LOS — returns false if any intermediate tile is a wall
export function hasLOS(x0, y0, x1, y1) {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, cx = x0, cy = y0;
  while (cx !== x1 || cy !== y1) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; cx += sx; }
    if (e2 <  dx) { err += dx; cy += sy; }
    if (cx === x1 && cy === y1) break;
    if (MAP_TILES[k(cx, cy)] === 'wall') return false;
  }
  return true;
}

// BFS movement — returns reachable floor tiles within range steps
export function getReachable(pos, range, units) {
  const occupied = new Set(
    units.filter(u => u.alive && !(u.position.x === pos.x && u.position.y === pos.y))
         .map(u => k(u.position.x, u.position.y))
  );
  const visited = new Set([k(pos.x, pos.y)]);
  const queue   = [{ x: pos.x, y: pos.y, rem: range }];
  const result  = [];
  while (queue.length) {
    const { x, y, rem } = queue.shift();
    if (rem === 0) continue;
    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nx = x + dx, ny = y + dy, nk = k(nx, ny);
      if (!visited.has(nk) && isWalkable(nx, ny) && !occupied.has(nk)) {
        visited.add(nk);
        result.push({ x: nx, y: ny });
        queue.push({ x: nx, y: ny, rem: rem - 1 });
      }
    }
  }
  return result;
}

export function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function itemChar(type) {
  if (type === 'medkit' || type === 'health-bonus') return '+';
  if (type.includes('armor')) return 'a';
  if (type.includes('shotgun')) return 's';
  if (type.includes('chaingun')) return 'c';
  if (type.includes('rocket')) return 'r';
  if (type.includes('plasma')) return 'p';
  return '$'; // ammo box
}

export function renderMap(state) {
  const { units, gameSpecific: { items } } = state;
  const posMap  = {};
  const itemMap = {};
  for (const u of units) if (u.alive) posMap[k(u.position.x, u.position.y)] = u;
  for (const it of items) if (!it.pickedUp) itemMap[k(it.x, it.y)] = it;

  const rows = [];
  for (let y = 0; y < MAP_HEIGHT; y++) {
    let row = `${String(y).padStart(2)} `;
    for (let x = 0; x < MAP_WIDTH; x++) {
      const kk = k(x, y);
      if (posMap[kk])  row += posMap[kk].attrs.symbol;
      else if (itemMap[kk]) row += itemChar(itemMap[kk].type);
      else             row += MAP_TILES[kk] === 'floor' ? '.' : '#';
    }
    rows.push(row);
  }
  rows.push('    ' + Array.from({ length: MAP_WIDTH }, (_, i) => i % 10).join(''));
  return rows.join('\n');
}
