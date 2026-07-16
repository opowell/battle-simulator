// Quarter-tile coastline rendering for civ1's ocean tiles.
//
// Real Civ1 draws each 16×16 ocean tile's shore from four independent 8×8 corner
// quadrants, each shaped by the three land neighbours touching that corner. We do
// the same: rather than stretch one 8×8 sprite across a whole 16×16 tile (half
// resolution — blocky), we place a native-8×8 piece in each quarter. That doubles
// the effective shore resolution and matches the fine dithered coast of the game.
//
// The pieces come from the hand-painted 8×8 shore sprites at
// games/civ1/images/terrain/coast_*.png; every orientation is a mirror (SVG flip)
// of one base sprite:
//   • coast_s      — a straight shore along one edge   (base: south edge)
//   • coast_w      — a straight shore along one edge   (base: west edge)
//   • coast_n      — a concave cove wrapping two edges (base: north+west)
//   • coast_corner — a small convex nub in one corner  (base: south-east, transparent bg)

// The four quadrants of a tile, each with the two cardinal neighbours flanking its
// outer corner (v = vertical N/S, h = horizontal W/E) and the diagonal (d). qx/qy
// are the quadrant's offset within the tile, in tile fractions (0 or 0.5).
const QUADRANTS = [
  { qx: 0,   qy: 0,   v: 'N', h: 'W', d: 'NW' },
  { qx: 0.5, qy: 0,   v: 'N', h: 'E', d: 'NE' },
  { qx: 0,   qy: 0.5, v: 'S', h: 'W', d: 'SW' },
  { qx: 0.5, qy: 0.5, v: 'S', h: 'E', d: 'SE' },
];

// Base sprites are oriented for their canonical corner; the flips below re-aim
// them at whichever quadrant is being drawn.
const edgeV = v => ({ file: 'coast_s', flipX: false, flipY: v === 'N' });   // base south edge
const edgeH = h => ({ file: 'coast_w', flipX: h === 'E', flipY: false });   // base west edge
const cove  = (v, h) => ({ file: 'coast_n', flipX: h === 'E', flipY: v === 'S' }); // base north+west
const nub   = (v, h) => ({ file: 'coast_corner', flipX: h === 'W', flipY: v === 'N' }); // base south-east

// target: { N, S, E, W, NW, NE, SW, SE } booleans — is land present in that
// direction from the ocean tile being drawn. Returns null (flat deep-ocean colour,
// no shore) for fully open water, else an ARRAY of { file, flipX, flipY, qx, qy }
// quadrant pieces to draw. Each quadrant is chosen from its three corner-neighbours:
// both cardinals land → concave cove; one cardinal → straight edge; only the
// diagonal → convex nub; nothing → open sea (quadrant skipped).
export function pickCoastSprites(target) {
  const pieces = [];
  for (const q of QUADRANTS) {
    const V = target[q.v], H = target[q.h], D = target[q.d];
    let p = null;
    if (V && H) p = cove(q.v, q.h);
    else if (V)  p = edgeV(q.v);
    else if (H)  p = edgeH(q.h);
    else if (D)  p = nub(q.v, q.h);
    if (p) pieces.push({ ...p, qx: q.qx, qy: q.qy });
  }
  return pieces.length ? pieces : null;
}
