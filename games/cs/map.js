// 20 × 12 grid. col 0 = left, row 0 = bottom.
// Tile types: 'wall' | 'floor' | 'bombsiteA' | 'bombsiteB' | 'ctSpawn' | 'tSpawn'
//
// Layout (y increases upward):
//   CT spawn: left-center (x 1-2, y 4-7)   — between the two sites
//   T  spawn: right-center (x 17-18, y 4-7) — must cross map to plant
//   Site A:   upper-left  (x 2-4, y 8-10)  — CT defends naturally
//   Site B:   lower-left  (x 2-4, y 1-3)   — CT defends naturally

export const MAP_WIDTH  = 20;
export const MAP_HEIGHT = 12;

function k(x, y) { return `${x},${y}`; }

function buildMap() {
  const tiles = {};

  for (let y = 0; y < MAP_HEIGHT; y++)
    for (let x = 0; x < MAP_WIDTH; x++)
      tiles[k(x, y)] = 'floor';

  // Border walls
  for (let x = 0; x < MAP_WIDTH; x++) { tiles[k(x, 0)] = 'wall'; tiles[k(x, MAP_HEIGHT - 1)] = 'wall'; }
  for (let y = 0; y < MAP_HEIGHT; y++) { tiles[k(0, y)] = 'wall'; tiles[k(MAP_WIDTH - 1, y)] = 'wall'; }

  // CT spawn
  for (let y = 4; y <= 7; y++) for (let x = 1; x <= 2; x++) tiles[k(x, y)] = 'ctSpawn';

  // T spawn
  for (let y = 4; y <= 7; y++) for (let x = 17; x <= 18; x++) tiles[k(x, y)] = 'tSpawn';

  // Bombsite A — upper-left (T must cross map to reach)
  for (let y = 8; y <= 10; y++) for (let x = 2; x <= 4; x++) tiles[k(x, y)] = 'bombsiteA';

  // Bombsite B — lower-left (mirror of A; T must cross map)
  for (let y = 1; y <= 3; y++) for (let x = 2; x <= 4; x++) tiles[k(x, y)] = 'bombsiteB';

  // ── Wall cover ────────────────────────────────────────────────────────────────
  // Upper-left cluster: forces T to take a corner route to A
  [[5,8],[5,9],[6,8],[6,9]].forEach(([x,y]) => { tiles[k(x,y)] = 'wall'; });

  // Lower-left cluster: mirrors upper, forces corner route to B
  [[5,2],[5,3],[6,2],[6,3]].forEach(([x,y]) => { tiles[k(x,y)] = 'wall'; });

  // Mid-center box (good for taking cover in mid)
  for (let x = 8; x <= 11; x++) { tiles[k(x,5)] = 'wall'; tiles[k(x,6)] = 'wall'; }

  // Upper-right wall (breaks sightline from T spawn to A)
  for (let x = 13; x <= 15; x++) tiles[k(x,9)] = 'wall';

  // Lower-right wall (mirrors upper-right, breaks sightline to B)
  for (let x = 13; x <= 15; x++) tiles[k(x,2)] = 'wall';

  return tiles;
}

export const MAP_TILES = buildMap();

export function isBombsite(x, y) {
  const t = MAP_TILES[k(x, y)];
  return t === 'bombsiteA' || t === 'bombsiteB';
}

export function isWalkable(x, y) {
  const t = MAP_TILES[k(x, y)];
  return t !== undefined && t !== 'wall';
}

// Bresenham LOS — returns false if any intermediate tile is a wall
export function hasLOS(x0, y0, x1, y1) {
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let cx = x0, cy = y0;
  while (cx !== x1 || cy !== y1) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; cx += sx; }
    if (e2 < dx)  { err += dx; cy += sy; }
    if (cx === x1 && cy === y1) break;
    if (MAP_TILES[k(cx, cy)] === 'wall') return false;
  }
  return true;
}

export function euclidean(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// BFS reachable positions (4-directional, excludes occupied tiles)
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

const TILE_CHARS = { wall: '#', floor: '.', bombsiteA: 'A', bombsiteB: 'B', ctSpawn: 'c', tSpawn: 't' };

export function renderMap(state) {
  const { units, gameSpecific: { bomb } } = state;
  const posMap = {};
  for (const u of units) if (u.alive) posMap[k(u.position.x, u.position.y)] = u;

  const rows = [];
  for (let y = MAP_HEIGHT - 1; y >= 0; y--) {
    let row = '';
    for (let x = 0; x < MAP_WIDTH; x++) {
      const kk = k(x, y);
      const u = posMap[kk];
      if (u) {
        row += u.ownerId === 'T' ? 'T' : 'C';
      } else if (bomb?.planted && bomb.plantedAt.x === x && bomb.plantedAt.y === y) {
        row += '!';
      } else {
        row += TILE_CHARS[MAP_TILES[kk]] ?? '?';
      }
    }
    rows.push(`${String(y).padStart(2)} ${row}`);
  }
  rows.push('   ' + Array.from({ length: MAP_WIDTH }, (_, i) => i % 10).join(''));
  return rows.join('\n');
}
