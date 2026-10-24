// ---------------------------------------------------------------------------
// geometry.js — a straight segment walked across a square grid, exactly.
//
// The segment is walked cell by cell (Amanatides–Woo grid traversal) and the
// length it spends inside each cell is measured, not sampled. A continuous-space
// move through 0.3 of a forest cell costs 0.3 × the forest's price, and a shot
// that clips the corner of a rock is blocked only if it really passes through it.
// ---------------------------------------------------------------------------

const EPS = 1e-9;

/**
 * The cells a straight segment passes through, each with the length of segment
 * inside it: [{ cx, cy, len }]. Zero-length pieces (a segment that only touches
 * a corner) are left out.
 */
export function segmentCells(x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const total = Math.hypot(dx, dy);
  let cx = Math.floor(x0), cy = Math.floor(y0);
  if (total < EPS) return [{ cx, cy, len: 0 }];
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  // Parametric t (0..1) at which the segment next crosses a vertical / horizontal line.
  let tMaxX = stepX ? ((stepX > 0 ? cx + 1 : cx) - x0) / dx : Infinity;
  let tMaxY = stepY ? ((stepY > 0 ? cy + 1 : cy) - y0) / dy : Infinity;
  const tDeltaX = stepX ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepY ? Math.abs(1 / dy) : Infinity;
  const out = [];
  let t = 0;
  for (let guard = 0; guard < 10000; guard++) {
    const tNext = Math.min(tMaxX, tMaxY, 1);
    if (tNext - t > EPS) out.push({ cx, cy, len: (tNext - t) * total });
    if (tNext >= 1) break;
    t = tNext;
    // Through a corner exactly, both lines are crossed at once.
    const crossX = tMaxX <= tNext + EPS, crossY = tMaxY <= tNext + EPS;
    if (crossX) { cx += stepX; tMaxX += tDeltaX; }
    if (crossY) { cy += stepY; tMaxY += tDeltaY; }
  }
  return out;
}
