// ── Pre-defined ("fixed") Civ1 maps ──────────────────────────────────────────
//
// Unlike the standard scenario (procedurally generated — see generateMap in
// map.js), these are literal hand-built boards for exercising specific
// rendering/gameplay cases in isolation (e.g. coastline sprites around a small
// island) without fighting the random generator for one.
//
// Each map is authored as ASCII art so the shape is readable at a glance. One
// character per tile; `rows` is a list of equal-length strings, top row first.
// The map's width is the row length and its height is the number of rows.
//
// Starting units are `{ side: 1|2, type, x, y }`; side 1 → players[0],
// side 2 → players[1]. Coordinates are 0-indexed from the top-left.

// Character → engine terrain. `.` is water; the engine has no separate "coast"
// or "lake" terrain, so open sea and inland lakes are all 'ocean' (shallow-water
// shading is a pure rendering effect in toGrid, derived from land-adjacency).
export const TERRAIN_LEGEND = {
  '.': 'ocean',
  'G': 'grassland',
  'P': 'plains',
  'F': 'forest',
  'H': 'hills',
  'M': 'mountains',
  'D': 'desert',
};

export const FIXED_MAPS = [
  {
    id: 'island-test',
    name: 'Tiny Island',
    description: 'Fixed 5×5 map: a 3×3 grassland island ringed by ocean — for testing coastline rendering',
    rows: [
      '.....',
      '.GGG.',
      '.GGG.',
      '.GGG.',
      '.....',
    ],
    // Opposite corners of the island so all four starting units land on distinct
    // tiles — the default random near-the-settler placement has no room here.
    units: [
      { side: 1, type: 'settlers', x: 1, y: 1 },
      { side: 1, type: 'militia',  x: 1, y: 2 },
      { side: 2, type: 'settlers', x: 3, y: 3 },
      { side: 2, type: 'militia',  x: 3, y: 2 },
    ],
  },
  {
    id: 'octagon-lake',
    name: 'Octagon Lake',
    description: 'Fixed 13×13 map: a grassland octagon island with a 5×5 diamond lake in its centre, ringed by a 2-tile ocean strip',
    rows: [
      '.............',
      '.............',
      '....GGGGG....',
      '...GGGGGGG...',
      '..GGGG.GGGG..',
      '..GGG...GGG..',
      '..GG.....GG..',
      '..GGG...GGG..',
      '..GGGG.GGGG..',
      '...GGGGGGG...',
      '....GGGGG....',
      '.............',
      '.............',
    ],
    // Opposite sides of the ring of land around the lake.
    units: [
      { side: 1, type: 'settlers', x: 4, y: 4 },
      { side: 1, type: 'militia',  x: 5, y: 4 },
      { side: 2, type: 'settlers', x: 8, y: 8 },
      { side: 2, type: 'militia',  x: 7, y: 8 },
    ],
  },
];

// Parse a map's `rows` ASCII art into a Civ1 board { width, height, tiles }.
export function parseFixedMap(map) {
  const rows = map.rows;
  const height = rows.length;
  const width = rows[0].length;
  const tiles = {};
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = rows[y][x];
      const terrain = TERRAIN_LEGEND[ch] ?? 'ocean';
      tiles[`${x},${y}`] = { terrain, hasRoad: false, hasRiver: false, fortress: false };
    }
  }
  return { width, height, tiles };
}

export function getFixedMap(id) {
  return FIXED_MAPS.find(m => m.id === id) ?? null;
}
