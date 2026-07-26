// Hex geometry for the Memoir '44 board — a 13-wide × 9-deep grid of pointy-top
// hexes in a brick (offset) layout. Positions are stored as integer offset
// coordinates { col, row }; axial coordinates are derived only for pixel layout
// and cube distance/line-of-sight math. Same q = col - floor(row/2) convention
// the shared hexagon map type uses (games/mapTypes/hexagon.js), so hexToPixel
// renders this grid as the expected staggered board.

export const BOARD_COLS = 13;
export const BOARD_ROWS = 9;

export function key(col, row) { return `${col},${row}`; }
export function parseKey(k) { const [c, r] = k.split(',').map(Number); return { col: c, row: r }; }

export function inBounds(col, row) {
  return col >= 0 && col < BOARD_COLS && row >= 0 && row < BOARD_ROWS;
}

// --- offset ⇄ axial ⇄ cube ------------------------------------------------

export function toAxial(col, row) {
  return { q: col - Math.floor(row / 2), r: row };
}
export function fromAxial(q, r) {
  return { col: q + Math.floor(r / 2), row: r };
}
function toCube(col, row) {
  const { q, r } = toAxial(col, row);
  return { x: q, y: -q - r, z: r };
}

export function distance(a, b) {
  const ca = toCube(a.col, a.row), cb = toCube(b.col, b.row);
  return (Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y) + Math.abs(ca.z - cb.z)) / 2;
}

const AXIAL_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

export function neighbors(col, row) {
  const { q, r } = toAxial(col, row);
  const out = [];
  for (const [dq, dr] of AXIAL_DIRS) {
    const { col: nc, row: nr } = fromAxial(q + dq, r + dr);
    if (inBounds(nc, nr)) out.push({ col: nc, row: nr });
  }
  return out;
}

// --- line of sight (cube linedraw between two hexes) ----------------------

function cubeRound(x, y, z) {
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { x: rx, y: ry, z: rz };
}

// Hexes strictly between a and b (endpoints excluded), in order. Used to test
// whether an obstruction sits on the sightline between attacker and target.
export function hexesBetween(a, b) {
  const n = distance(a, b);
  if (n <= 1) return [];
  const ca = toCube(a.col, a.row), cb = toCube(b.col, b.row);
  const out = [];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const c = cubeRound(
      ca.x + (cb.x - ca.x) * t,
      ca.y + (cb.y - ca.y) * t,
      ca.z + (cb.z - ca.z) * t,
    );
    const { col, row } = fromAxial(c.x, c.z);
    out.push({ col, row });
  }
  return out;
}

// --- sections & baselines --------------------------------------------------

// The battlefield's three sections (left flank / center / right flank), split by
// column: 4 + 5 + 4 across the 13 columns. Command "section cards" order units
// within one section.
export function sectionOf(col) {
  if (col <= 3) return 'left';
  if (col >= 9) return 'right';
  return 'center';
}

export const SECTIONS = ['left', 'center', 'right'];

// One hex "back toward baseline" for a retreat step, given the player's home
// edge row (0 or BOARD_ROWS-1). Returns the candidate neighbors that move toward
// that edge, sorted best-first so the caller can pick the first that is
// unoccupied / passable.
export function retreatNeighbors(pos, baselineRow) {
  const toward0 = baselineRow === 0;
  return neighbors(pos.col, pos.row)
    .filter(n => toward0 ? n.row < pos.row : n.row > pos.row)
    .sort((a, b) => toward0 ? a.row - b.row : b.row - a.row);
}
