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
    if (!u.alive) return false;
    const d = Math.abs(u.position.x - from.x) + Math.abs(u.position.y - from.y);
    if (d === 0 || d > range) return false;
    if (targetType === 'enemy') return u.ownerId !== ownerId;
    if (targetType === 'ally')  return u.ownerId === ownerId;
    return false;
  });
}

export function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
