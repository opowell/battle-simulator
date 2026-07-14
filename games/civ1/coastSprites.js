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
// The eight stock shore shapes, each drawing land along one or more full
// cardinal edges (their diagonal `corners` are incidental to the art — where
// the shore curves up at an edge's ends). Every non-cardinal orientation is
// produced by mirroring one of these via SVG flips rather than a separate file.
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

// The two cardinal neighbours flanking each diagonal corner. A convex-corner
// nub (coast_corner) is only drawn for a diagonal whose land isn't already
// covered by an edge shape — i.e. neither flanking cardinal is itself land.
const CORNER_ADJ = { NW: ['N', 'W'], NE: ['N', 'E'], SW: ['S', 'W'], SE: ['S', 'E'] };

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

const EDGES = ['N', 'S', 'E', 'W'];

// target: { N, S, E, W, NW, NE, SW, SE } booleans — is land present in that
// direction from the ocean tile being drawn. Returns null (flat deep-ocean
// colour) for fully open water, else an ARRAY of { file, flipX, flipY } pieces
// to stack, painted in order.
//
// A single 16×16 sprite can't represent every 8-neighbour combination (e.g. the
// vertex tiles of a diamond lake touch land at two separate diagonals at once —
// see the octagon-lake scenario), so the coastline is composited:
//   • one best-fit edge/cove shape for whichever cardinal edges have land, plus
//   • an independent convex-corner nub for each diagonal that has land but whose
//     two flanking cardinals are both water (so no edge shape covers it).
// This keeps the shore continuous for any configuration instead of a single
// best-guess tile that leaves gaps at multi-corner spots.
export function pickCoastSprites(target) {
  const pieces = [];

  if (EDGES.some(f => target[f])) {
    let best = null;
    for (const shape of SHAPES) {
      for (const flipX of [false, true]) {
        for (const flipY of [false, true]) {
          const s = score(target, flipShape(shape, flipX, flipY));
          if (!best || s > best.s) best = { s, file: shape.file, flipX, flipY };
        }
      }
    }
    pieces.push({ file: best.file, flipX: best.flipX, flipY: best.flipY });
  }

  // coast_corner's base art nubs the SE corner; flip to reach the target corner.
  for (const [d, [a, b]] of Object.entries(CORNER_ADJ)) {
    if (target[d] && !target[a] && !target[b]) {
      pieces.push({ file: 'coast_corner', flipX: d === 'SW' || d === 'NW', flipY: d === 'NE' || d === 'NW' });
    }
  }

  return pieces.length ? pieces : null;
}
