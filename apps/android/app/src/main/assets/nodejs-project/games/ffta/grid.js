import { getTile } from './map.js';

export function getReachable(board, from, moveRange, units) {
  const blocked = new Set(
    units.filter(u => u.alive).map(u => `${u.position.x},${u.position.y}`)
  );
  blocked.delete(`${from.x},${from.y}`);

  // Dijkstra-style BFS: going uphill costs +1 extra per height level
  const dist = new Map([[`${from.x},${from.y}`, 0]]);
  const queue = [{ x: from.x, y: from.y, cost: 0 }];

  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const { x, y, cost } = queue.shift();
    if (cost > (dist.get(`${x},${y}`) ?? Infinity)) continue;

    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nx = x + dx, ny = y + dy;
      const key = `${nx},${ny}`;
      const tile = getTile(board, nx, ny);
      if (!tile.passable || blocked.has(key)) continue;

      const heightCost = Math.max(0, tile.height - getTile(board, x, y).height);
      const newCost = cost + 1 + heightCost;
      if (newCost > moveRange) continue;
      if ((dist.get(key) ?? Infinity) <= newCost) continue;

      dist.set(key, newCost);
      queue.push({ x: nx, y: ny, cost: newCost });
    }
  }

  return [...dist.keys()]
    .filter(k => k !== `${from.x},${from.y}`)
    .map(k => { const [x, y] = k.split(',').map(Number); return { x, y }; });
}

export function getInRange(from, range, units, targetType, ownerId) {
  return units.filter(u => {
    const d = Math.abs(u.position.x - from.x) + Math.abs(u.position.y - from.y);
    if (d === 0 || d > range) return false;
    if (targetType === 'enemy')     return u.alive  && u.ownerId !== ownerId;
    if (targetType === 'ally')      return u.alive  && u.ownerId === ownerId;
    if (targetType === 'dead-ally') return !u.alive && u.ownerId === ownerId;
    return false;
  });
}

export function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

// Returns all tiles hit by an AoE ability.
// diamond: all tiles within Manhattan distance `radius` of `center`
// line: all tiles from casterPos in direction of `center`, up to `radius` steps
export function getAoeTiles(pattern, center, casterPos, radius = 1) {
  if (pattern === 'diamond') {
    const tiles = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.abs(dx) + Math.abs(dy) <= radius) {
          tiles.push({ x: center.x + dx, y: center.y + dy });
        }
      }
    }
    return tiles;
  }
  if (pattern === 'line' && casterPos) {
    const dx = center.x - casterPos.x;
    const dy = center.y - casterPos.y;
    if (dx === 0 && dy === 0) return [];
    const stepX = Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : 0;
    const stepY = Math.abs(dx) >= Math.abs(dy) ? 0 : Math.sign(dy);
    const tiles = [];
    for (let i = 1; i <= radius; i++) {
      tiles.push({ x: casterPos.x + stepX * i, y: casterPos.y + stepY * i });
    }
    return tiles;
  }
  return [center];
}
