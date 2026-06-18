export const MAP_WIDTH  = 20;
export const MAP_HEIGHT = 14;

function k(x, y) { return `${x},${y}`; }

function buildMap() {
  const tiles = {};
  for (let y = 0; y < MAP_HEIGHT; y++)
    for (let x = 0; x < MAP_WIDTH; x++)
      tiles[k(x, y)] = 'wall';

  // Room A — marine start (top-left)
  for (let y = 1; y <= 4; y++) for (let x = 1; x <= 5; x++) tiles[k(x, y)] = 'floor';

  // Corridor A→B (horizontal at y=2, cols 6-8)
  for (let x = 6; x <= 8; x++) tiles[k(x, 2)] = 'floor';

  // Room B — upper right
  for (let y = 1; y <= 5; y++) for (let x = 9; x <= 18; x++) tiles[k(x, y)] = 'floor';

  // Corridor A→C (single tile at x=3, y=5)
  tiles[k(3, 5)] = 'floor';

  // Room C — mid horizontal corridor
  for (let y = 6; y <= 7; y++) for (let x = 1; x <= 18; x++) tiles[k(x, y)] = 'floor';

  // Room D — bottom left
  for (let y = 8; y <= 12; y++) for (let x = 1; x <= 7; x++) tiles[k(x, y)] = 'floor';

  // Corridor D↔E (single tile at x=8, y=10)
  tiles[k(8, 10)] = 'floor';

  // Room E — bottom right (boss area)
  for (let y = 8; y <= 12; y++) for (let x = 9; x <= 18; x++) tiles[k(x, y)] = 'floor';

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
