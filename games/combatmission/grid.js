import { isPassable, getMoveCost } from './map.js';

// Weighted reachability — all tiles reachable within `range` movement points, where
// entering difficult terrain (woods, hedgerows) costs more than open ground (see
// getMoveCost). Dijkstra over small integer costs; the map is small so an O(n²) queue
// is fine. A unit may always take at least one step onto an adjacent passable tile, so
// costly terrain slows movement without ever trapping a low-movement unit.
export function getReachable(board, from, range, units) {
  const key = (x, y) => `${x},${y}`;
  const blocked = new Set(units.filter(u => u.alive).map(u => key(u.position.x, u.position.y)));
  blocked.delete(key(from.x, from.y));

  const dist = new Map([[key(from.x, from.y), 0]]);
  const pq = [{ x: from.x, y: from.y, cost: 0 }];

  while (pq.length) {
    let mi = 0;
    for (let i = 1; i < pq.length; i++) if (pq[i].cost < pq[mi].cost) mi = i;
    const { x, y, cost } = pq.splice(mi, 1)[0];
    if (cost > (dist.get(key(x, y)) ?? Infinity)) continue;

    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx, ny = y + dy, kk = key(nx, ny);
      if (!isPassable(board, nx, ny) || blocked.has(kk)) continue;
      const nc = cost + getMoveCost(board, nx, ny);
      if (nc < (dist.get(kk) ?? Infinity)) {
        dist.set(kk, nc);
        if (nc < range) pq.push({ x: nx, y: ny, cost: nc });
      }
    }
  }

  const result = [];
  const seen = new Set([key(from.x, from.y)]);
  for (const [kk, d] of dist) {
    if (d === 0 || d > range) continue;
    const [x, y] = kk.split(',').map(Number);
    result.push({ x, y });
    seen.add(kk);
  }

  // Guarantee at least one step: an adjacent passable, unoccupied tile is always a legal
  // destination even if its terrain cost exceeds the unit's movement budget.
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const nx = from.x + dx, ny = from.y + dy, kk = key(nx, ny);
    if (!seen.has(kk) && isPassable(board, nx, ny) && !blocked.has(kk)) {
      result.push({ x: nx, y: ny });
      seen.add(kk);
    }
  }

  return result;
}
