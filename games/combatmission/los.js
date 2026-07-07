import { getTile, blocksLOS } from './map.js';

// Bresenham line — returns false if any intermediate tile blocks LOS.
// The shooter's tile and the target's tile are not checked (units can shoot
// from within trees, and we want to be able to target units in any passable tile).
// Needs integer endpoints to terminate — unit positions can now be continuous
// (free-form movement), so snap to the tile each endpoint sits in.
export function hasLOS(board, from, to) {
  from = { x: Math.floor(from.x), y: Math.floor(from.y) };
  to   = { x: Math.floor(to.x),   y: Math.floor(to.y) };
  const dx =  Math.abs(to.x - from.x);
  const dy = -Math.abs(to.y - from.y);
  const sx = from.x < to.x ? 1 : (from.x > to.x ? -1 : 0);
  const sy = from.y < to.y ? 1 : (from.y > to.y ? -1 : 0);
  let err = dx + dy;
  let x = from.x, y = from.y;

  for (;;) {
    if (x === to.x && y === to.y) return true;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
    if (x !== to.x || y !== to.y) {
      if (blocksLOS(getTile(board, x, y))) return false;
    }
  }
}
