// ---------------------------------------------------------------------------
// Arena's board: a rectangle of terrain cells, and the two questions every rule
// asks of it — what does it cost to get from here to there, and can a unit here
// see (and shoot) a unit there?
//
// Both are answered EXACTLY for a straight segment between any two points: the
// segment is walked cell by cell (Amanatides–Woo grid traversal) and the length
// it spends inside each cell is measured, not sampled. A continuous-space move
// through 0.3 of a forest cell costs 0.3 × the forest's price, and a shot that
// clips the corner of a rock is blocked only if it really passes through it.
// Discrete space asks the same functions about cell centres.
// ---------------------------------------------------------------------------

/**
 * Terrain types. `cost` is movement points per unit of distance (per step in
 * discrete space); `cover` is the percentage added to a defender's defense while
 * it stands there; impassable ground stops movement, sight-blocking ground stops
 * vision and missiles alike.
 */
export const TERRAIN = {
  open:   { name: 'Open',   cost: 1, cover: 0,  passable: true,  blocksSight: false, color: '#c2b77e', description: 'Open ground. No effect.' },
  forest: { name: 'Forest', cost: 2, cover: 50, passable: true,  blocksSight: false, color: '#4d7f3f', description: 'Costs double to cross; +50% defense to a unit inside.' },
  hill:   { name: 'Hill',   cost: 2, cover: 25, passable: true,  blocksSight: false, color: '#a08a5a', description: 'Costs double to climb; +25% defense to a unit on it.' },
  water:  { name: 'Water',  cost: Infinity, cover: 0, passable: false, blocksSight: false, color: '#4a86c8', description: 'Impassable; can be seen and shot across.' },
  rock:   { name: 'Rock',   cost: Infinity, cover: 0, passable: false, blocksSight: true,  color: '#6d6a66', description: 'Impassable; blocks sight and missiles.' },
};

const EPS = 1e-9;

export const inBounds = (board, cx, cy) => cx >= 0 && cy >= 0 && cx < board.width && cy < board.height;

/** Terrain entry of integer cell (cx, cy); null off the board. */
export function terrainAt(board, cx, cy) {
  if (!inBounds(board, cx, cy)) return null;
  return TERRAIN[board.terrain?.[`${cx},${cy}`] ?? 'open'] ?? TERRAIN.open;
}

/** Terrain under a continuous point (the cell containing it). */
export const terrainUnder = (board, x, y) => terrainAt(board, Math.floor(x), Math.floor(y));

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

/**
 * Movement points to travel the straight segment, terrain-weighted:
 * Σ (length in cell × cell cost). Infinity if it leaves the board or crosses
 * impassable ground.
 */
export function segmentCost(board, x0, y0, x1, y1) {
  let cost = 0;
  for (const { cx, cy, len } of segmentCells(x0, y0, x1, y1)) {
    const t = terrainAt(board, cx, cy);
    if (!t || !t.passable) return Infinity;
    cost += len * t.cost;
  }
  return cost;
}

/**
 * Can something at point a see point b? Blocked by sight-blocking terrain
 * strictly between them — the cells holding the two endpoints never block, so a
 * unit can see out of (and be seen in) any cell it can stand in.
 */
export function lineOfSight(board, ax, ay, bx, by) {
  const ca = `${Math.floor(ax)},${Math.floor(ay)}`, cb = `${Math.floor(bx)},${Math.floor(by)}`;
  for (const { cx, cy } of segmentCells(ax, ay, bx, by)) {
    const k = `${cx},${cy}`;
    if (k === ca || k === cb) continue;
    const t = terrainAt(board, cx, cy);
    if (!t || t.blocksSight) return false;
  }
  return true;
}
