import { MAP_W, MAP_H } from './dungeon.js';

export { MAP_W, MAP_H };

const k = (x, y) => `${x},${y}`;

export function isWalkable(tiles, x, y) {
  return tiles[k(x, y)] === '.';
}

export function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

// BFS reachable floor tiles within `range` steps (excluding occupied tiles)
export function getReachable(tiles, pos, range, units) {
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
      if (!visited.has(nk) && isWalkable(tiles, nx, ny) && !occupied.has(nk)) {
        visited.add(nk);
        result.push({ x: nx, y: ny });
        queue.push({ x: nx, y: ny, rem: rem - 1 });
      }
    }
  }
  return result;
}

// BFS first step from `from` toward `to`; ignores the unit at `from` in occupied check
export function stepToward(tiles, from, to, units) {
  const occupied = new Set(
    units.filter(u => u.alive && !(u.position.x === from.x && u.position.y === from.y))
         .map(u => k(u.position.x, u.position.y))
  );
  const visited = new Set([k(from.x, from.y)]);
  const queue   = [{ x: from.x, y: from.y, first: null }];
  while (queue.length) {
    const { x, y, first } = queue.shift();
    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nx = x + dx, ny = y + dy, nk = k(nx, ny);
      if (nx === to.x && ny === to.y) return first ?? { x: nx, y: ny };
      if (!visited.has(nk) && isWalkable(tiles, nx, ny) && !occupied.has(nk)) {
        visited.add(nk);
        queue.push({ x: nx, y: ny, first: first ?? { x: nx, y: ny } });
      }
    }
  }
  return null;
}

// Bresenham LOS through walkable tiles
export function hasLOS(tiles, x0, y0, x1, y1) {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1,  sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, cx = x0, cy = y0;
  while (cx !== x1 || cy !== y1) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; cx += sx; }
    if (e2 <  dx) { err += dx; cy += sy; }
    if (cx === x1 && cy === y1) break;
    if (tiles[k(cx, cy)] !== '.') return false;
  }
  return true;
}

function itemChar(type) {
  if (type.startsWith('food'))   return '%';
  if (type.startsWith('potion')) return '!';
  if (type.startsWith('scroll')) return '?';
  if (type.startsWith('weapon')) return ')';
  if (type.startsWith('armor'))  return ']';
  if (type === 'gold')           return '*';
  return '?';
}

export function renderMap(state) {
  const { board: { tiles }, units, gameSpecific: gs } = state;

  const posMap  = {};
  for (const u of units) if (u.alive) posMap[k(u.position.x, u.position.y)] = u;

  const itemMap = {};
  for (const it of gs.items) if (!it.pickedUp) itemMap[k(it.x, it.y)] = it;

  const sdK = gs.stairsDown ? k(gs.stairsDown.x, gs.stairsDown.y) : null;
  const amK = gs.amuletPos && !gs.hasAmulet ? k(gs.amuletPos.x, gs.amuletPos.y) : null;

  const rows = [];
  for (let y = 0; y < MAP_H; y++) {
    let row = '';
    for (let x = 0; x < MAP_W; x++) {
      const kk = k(x, y);
      if (posMap[kk])       row += posMap[kk].attrs.symbol;
      else if (kk === amK)  row += '"';
      else if (kk === sdK)  row += '>';
      else if (itemMap[kk]) row += itemChar(itemMap[kk].type);
      else                  row += tiles[kk] === '.' ? '.' : '#';
    }
    rows.push(row);
  }
  return rows.join('\n');
}
