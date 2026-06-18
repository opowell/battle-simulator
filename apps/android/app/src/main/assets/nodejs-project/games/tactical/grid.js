/**
 * Chebyshev distance (diagonals count as 1 — good for grid wargames).
 * @param {{x:number,y:number}} a
 * @param {{x:number,y:number}} b
 */
export function chebyshev(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * BFS reachable squares within `range` steps on the grid.
 * Respects board bounds, impassable terrain, and occupied squares (cannot pass through units).
 *
 * @param {{x:number,y:number}} origin
 * @param {number} range
 * @param {{width:number, height:number, terrain:object}} board
 * @param {Set<string>} occupied  Set of "x,y" strings that block movement.
 * @returns {{x:number,y:number}[]}  Reachable squares (excluding origin).
 */
export function reachableSquares(origin, range, board, occupied) {
  const key = (p) => `${p.x},${p.y}`;
  const visited = new Set([key(origin)]);
  const frontier = [{ pos: origin, steps: 0 }];
  const result = [];

  while (frontier.length) {
    const { pos, steps } = frontier.shift();
    if (steps >= range) continue;

    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]) {
      const next = { x: pos.x + dx, y: pos.y + dy };
      const k = key(next);
      if (visited.has(k)) continue;
      if (next.x < 0 || next.x >= board.width || next.y < 0 || next.y >= board.height) continue;
      if (board.terrain?.[k] === 'water') continue; // impassable
      visited.add(k);
      if (!occupied.has(k)) {
        result.push(next);
        frontier.push({ pos: next, steps: steps + 1 });
      }
    }
  }
  return result;
}
