import { isPassable, moveCost } from './map.js';

// BFS reachability with variable tile costs (wire costs 2 AP to enter).
export function getReachable(board, from, range, units) {
  const blocked = new Set(
    units.filter(u => u.alive).map(u => `${u.position.x},${u.position.y}`)
  );
  blocked.delete(`${from.x},${from.y}`);

  const visited = new Map([[`${from.x},${from.y}`, 0]]);
  const queue   = [{ x: from.x, y: from.y, cost: 0 }];
  const result  = [];

  while (queue.length) {
    const { x, y, cost } = queue.shift();
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
      if (visited.has(key) || !isPassable(board, nx, ny) || blocked.has(key)) continue;
      const newCost = cost + moveCost(board, nx, ny);
      if (newCost > range) continue;
      visited.set(key, newCost);
      queue.push({ x: nx, y: ny, cost: newCost });
      result.push({ x: nx, y: ny });
    }
  }
  return result;
}

export function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
