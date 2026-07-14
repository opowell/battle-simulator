// Coastline sprite lookup for the 8 hand-painted shore tiles at
// games/civ1/images/terrain/coast_*.png (sliced from the original coast_sprite.png
// sheet — 16 cols × 2 rows of 8×8 tiles, of which columns 0,1,4,5 in both rows were
// plain water and columns 2,3,6,7 each drew a strip of land along one or two edges).
// There's no clean rotational relationship between those 8 shapes (independent pixel
// art, confirmed by comparing rotations pixel-for-pixel), so every orientation besides
// the ones actually drawn is produced by mirroring one of these 8 via SVG transforms
// rather than by hunting for a 9th/10th sprite.
//
// Each entry's edges/corners were read off the sheet directly (avg land coverage per
// border row/col, thresholded at 50%) — e.g. coast_w is a clean strip of land along
// the west edge.
const SHAPES = [
  { file: 'coast_w',      edges: { N: false, S: false, E: false, W: true  }, corners: { NW: true,  NE: false, SW: true,  SE: false } },
  { file: 'coast_n',      edges: { N: true,  S: false, E: false, W: true  }, corners: { NW: true,  NE: true,  SW: false, SE: false } },
  { file: 'coast_nw',     edges: { N: true,  S: false, E: false, W: true  }, corners: { NW: true,  NE: false, SW: true,  SE: false } },
  { file: 'coast_n_wide', edges: { N: true,  S: false, E: true,  W: true  }, corners: { NW: true,  NE: true,  SW: false, SE: false } },
  { file: 'coast_s',      edges: { N: false, S: true,  E: false, W: false }, corners: { NW: false, NE: false, SW: true,  SE: true  } },
  { file: 'coast_e',      edges: { N: true,  S: false, E: true,  W: false }, corners: { NW: false, NE: true,  SW: false, SE: true  } },
  { file: 'coast_sw',     edges: { N: false, S: true,  E: false, W: true  }, corners: { NW: false, NE: false, SW: true,  SE: true  } },
  { file: 'coast_e_wide', edges: { N: true,  S: true,  E: true,  W: false }, corners: { NW: false, NE: true,  SW: false, SE: true  } },
];

const FEATURES = ['N', 'S', 'E', 'W', 'NW', 'NE', 'SW', 'SE'];

// Mirror a shape's feature set. Horizontal flip swaps E<->W and the two
// corner pairs that share an E/W side; vertical flip swaps N<->S likewise.
function flipShape({ edges, corners }, flipX, flipY) {
  let e = edges, c = corners;
  if (flipX) {
    e = { N: e.N, S: e.S, E: e.W, W: e.E };
    c = { NW: c.NE, NE: c.NW, SW: c.SE, SE: c.SW };
  }
  if (flipY) {
    e = { N: e.S, S: e.N, E: e.E, W: e.W };
    c = { NW: c.SW, NE: c.SE, SW: c.NW, SE: c.NE };
  }
  return { edges: e, corners: c };
}

// Edges outweigh corners: every shape in the sheet draws at least one full
// orthogonal edge, so a shape mismatched on an edge reads as a much bigger
// visual error (a false strip of land) than one mismatched on a corner nub.
// Overdrawing (shape shows land the tile doesn't actually have — e.g. a
// "wide" 3-edge shape picked for a 1-tile-wide channel with land only on two
// opposite edges) is penalized far harder than underdrawing (missing a small
// corner nub): a false spit of land poking into open water reads as a much
// bigger error than a corner that's slightly too round.
function score(target, shape) {
  let s = 0;
  for (const f of FEATURES) {
    const edge = f.length === 1;
    const have = edge ? shape.edges[f] : shape.corners[f];
    const want = target[f];
    if (have === want) s += edge ? 4 : 1;
    else if (have && !want) s -= edge ? 6 : 1; // false positive: overdrawn land
    else if (edge) s -= 1;                     // false negative: missing nub, cheap
  }
  return s;
}

// target: { N, S, E, W, NW, NE, SW, SE } booleans — is land present in that
// direction from the ocean tile being drawn. Returns null for open water (no
// land in any of the 8 directions — the flat deep-ocean colour already covers
// it) or { file, flipX, flipY } otherwise. A diagonal-only touch (corner but
// neither adjacent edge) still gets a shape — none of the 8 sheet shapes draw
// a corner without also drawing a full edge, but leaving it blank opens a
// one-tile gap in what should read as a continuous coastline, which looks far
// worse than a corner tile slightly over-drawing land into an edge that a
// neighbouring tile is already drawing anyway.
export function pickCoastSprite(target) {
  if (!FEATURES.some(f => target[f])) return null;
  let best = null;
  for (const shape of SHAPES) {
    for (const flipX of [false, true]) {
      for (const flipY of [false, true]) {
        const flipped = flipShape(shape, flipX, flipY);
        const s = score(target, flipped);
        if (!best || s > best.s) best = { s, file: shape.file, flipX, flipY };
      }
    }
  }
  return { file: best.file, flipX: best.flipX, flipY: best.flipY };
}
