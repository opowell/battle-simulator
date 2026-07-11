// Tile types: 'wall' | 'floor' | 'bombsiteA' | 'bombsiteB' | 'ctSpawn' | 'tSpawn'
// y increases upward (y=0 = bottom row, y=H-1 = top row)
// All utility functions accept `tiles` as first argument.

import { forEachCell, pointInShape } from '../terrainShapes.js';
import { num, tileNum } from '../coord.js';

function k(x, y) { return `${x},${y}`; }

function buildBase(w, h) {
  const t = {};
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) t[k(x, y)] = 'floor';
  for (let x = 0; x < w; x++) { t[k(x, 0)] = 'wall'; t[k(x, h - 1)] = 'wall'; }
  for (let y = 0; y < h; y++) { t[k(0, y)] = 'wall'; t[k(w - 1, y)] = 'wall'; }
  return t;
}

// ── Shape-based (non-grid) maps ─────────────────────────────────────────────────
//
// These maps author terrain as an array of shapes (rectangles + ovals) rather than a
// hand-drawn tile grid. Each shape carries a `kind` that decides both how it rasterizes
// onto the mechanics grid (below) and how the client draws it as a layered SVG. Ovals
// give organic obstacles (pits, ponds, fountains) that a tile grid can only approximate.
//
// kind → { tile: what to stamp (null = leave floor), render: SVG style }

const CS_SHAPE_STYLES = {
  wall:      { tile: 'wall',      render: { fill: '#23262b', stroke: '#3a3f47' },                            name: 'Wall',       description: 'Impassable, blocks line of sight.' },
  building:  { tile: 'wall',      render: { fill: '#33373d', stroke: '#4a4f57' },                            name: 'Building',   description: 'Impassable, blocks line of sight.' },
  crate:     { tile: 'wall',      render: { fill: '#6f5533', stroke: '#8a6a3f' },                             name: 'Crates',     description: 'Impassable hard cover, blocks line of sight.' },
  pit:       { tile: 'wall',      render: { fill: '#7a3b1f', opacity: 0.9 },                                 name: 'Furnace pit',description: 'Impassable, blocks line of sight.' },
  water:     { tile: 'wall',      render: { fill: '#2f6d8f', opacity: 0.85 },                                name: 'Water',      description: 'Impassable, blocks line of sight.' },
  plaza:     { tile: null,        render: { fill: '#b8b09a', opacity: 0.55 },                                name: 'Plaza',      description: 'Open pavement.' },
  floor:     { tile: 'floor',     render: { fill: '#c8c0a8' },                                               name: 'Floor',      description: 'Open ground.' },
  bombsiteA: { tile: 'bombsiteA', render: { fill: '#d4a03a', opacity: 0.26, stroke: '#e0b24a' }, label: 'A', name: 'Bombsite A', description: 'Bomb can be planted or defused here.' },
  bombsiteB: { tile: 'bombsiteB', render: { fill: '#d4a03a', opacity: 0.26, stroke: '#e0b24a' }, label: 'B', name: 'Bombsite B', description: 'Bomb can be planted or defused here.' },
  ctSpawn:   { tile: null,        render: { fill: '#4a8fd4', opacity: 0.16 }, label: 'CT',                   name: 'CT Spawn',   description: 'Counter-Terrorist starting area.' },
  tSpawn:    { tile: null,        render: { fill: '#d4713a', opacity: 0.16 }, label: 'T',                    name: 'T Spawn',    description: 'Terrorist starting area.' },
  // ── Elevation workaround ──────────────────────────────────────────────────
  // Positions are flat (x, y) — there is no z-axis, so real height differences (boxes you
  // stand on, catwalks over tunnels, ramps) can't be modeled geometrically. `lowWall`
  // approximates the gameplay effect of low/waist-height cover instead of the geometry:
  // its tile is NOT 'wall', so csLosBlockers (belief.js) — which only opacifies
  // tile === 'wall' — never blocks sight or shots through it, while isWalkable/
  // isWalkableContinuous below explicitly still treat it as solid. Net effect: you can
  // see and shoot across/over it exactly like real elevated cover, but can't walk
  // through it. The complementary trick for actual elevated PATHS (e.g. a catwalk
  // overlooking a tunnel) is topological, not geometric: author them as a separate
  // parallel lane rather than literally stacking on the same (x, y) as the room below,
  // and paint the connecting slope with the purely cosmetic `ramp`/`catwalk` kinds
  // (tile: null — walkable, non-blocking) so the layout still reads as elevated terrain.
  lowWall:   { tile: 'lowWall',   render: { fill: '#8a7a54', stroke: '#a5926a', opacity: 0.85 },              name: 'Low wall / ledge', description: 'Waist-high cover — blocks movement, but (unlike a wall) can be seen and shot across, standing in for a real elevation difference.' },
  ramp:      { tile: null,        render: { fill: '#b7ac86', opacity: 0.4 },                                  name: 'Ramp',       description: 'Slope up to higher ground. Cosmetic — walkable and does not block sight.' },
  catwalk:   { tile: null,        render: { fill: '#c9bf9a', opacity: 0.5, stroke: '#a5926a' },               name: 'Catwalk',    description: 'Elevated walkway. Cosmetic — walkable and does not block sight.' },
  // Small blocking prop — a crate/barrel variant sized for scattering many at once without
  // eating a whole tile of corridor width.
  debris:    { tile: 'wall',      render: { fill: '#6f5533', stroke: '#8a6a3f', opacity: 0.9 },               name: 'Debris',     description: 'Small impassable cover — a crate, barrel or pallet.' },
  // ── Ground-detail decals ──────────────────────────────────────────────────
  // Purely cosmetic (tile: null — walkable, non-blocking, never opacifies LOS): scattered
  // across the floor by scatterGroundDetail() below to give the map painterly texture
  // (cracked pavement, gravel, scorch marks, sand drifts, stains, loose planking) instead
  // of a flat backdrop, without touching mechanics.
  crack:     { tile: null,        render: { fill: '#5a5240', opacity: 0.22 },                                 name: 'Crack',      description: 'Cracked pavement. Cosmetic.' },
  gravel:    { tile: null,        render: { fill: '#9c9280', opacity: 0.28 },                                 name: 'Gravel',     description: 'Loose gravel. Cosmetic.' },
  scorch:    { tile: null,        render: { fill: '#1a1712', opacity: 0.22 },                                 name: 'Scorch mark',description: 'Old scorch mark. Cosmetic.' },
  sand:      { tile: null,        render: { fill: '#d8c896', opacity: 0.3 },                                  name: 'Sand drift', description: 'Wind-blown sand. Cosmetic.' },
  stain:     { tile: null,        render: { fill: '#7a6a48', opacity: 0.2 },                                  name: 'Stain',      description: 'Ground stain. Cosmetic.' },
  plank:     { tile: null,        render: { fill: '#8a6a3f', opacity: 0.45 },                                 name: 'Loose plank',description: 'Loose planking. Cosmetic.' },
};

// Deterministic scatter of small cosmetic ground-detail shapes (see the decal kinds
// above). Always placed FIRST in a map's terrain array — isWalkableContinuous scans
// terrainShapes in reverse and returns on the first hit, so a later (real) wall/crate at
// the same spot must always be able to win the tie; putting decals first guarantees that.
function mulberry32(seed) {
  return function rng() {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GROUND_DETAIL_KINDS = ['crack', 'gravel', 'scorch', 'sand', 'stain', 'plank'];

function scatterGroundDetail(seed, count, width, height) {
  const rng = mulberry32(seed);
  const round2 = n => Math.round(n * 100) / 100;
  const out = [];
  for (let i = 0; i < count; i++) {
    const kind = GROUND_DETAIL_KINDS[Math.floor(rng() * GROUND_DETAIL_KINDS.length)];
    const w = 0.3 + rng() * 0.5, h = 0.3 + rng() * 0.5;
    const x = round2(1 + rng() * (width - 2 - w));
    const y = round2(1 + rng() * (height - 2 - h));
    out.push({ shape: rng() < 0.5 ? 'oval' : 'rect', x, y, w: round2(w), h: round2(h), kind });
  }
  return out;
}

// Floor colour used for the (uniform) tile layer under a shape map — the terrain is
// conveyed entirely by the shapes, so the raster grid stays a plain backdrop.
export const CS_SHAPE_FLOOR = '#c8c0a8';

// The map border is always solid (buildBase stamps 'wall' around the edge), but that was
// never given a render shape — only whatever a map's own terrain drew showed up, so the
// edge looked like open background. Draw it explicitly so every shape-based map reads as
// a walled arena. Render-only (buildBase/the boundary check in isWalkableContinuous
// already make it solid), so these aren't added to terrainShapes/tiles.
function perimeterWallShapes(W, H) {
  const render = CS_SHAPE_STYLES.wall.render;
  const info   = { name: CS_SHAPE_STYLES.wall.name, description: CS_SHAPE_STYLES.wall.description, label: null };
  return [
    { shape: 'rect', x: 0,     y: 0,     w: W, h: 1, ...render, ...info },
    { shape: 'rect', x: 0,     y: H - 1, w: W, h: 1, ...render, ...info },
    { shape: 'rect', x: 0,     y: 0,     w: 1, h: H, ...render, ...info },
    { shape: 'rect', x: W - 1, y: 0,     w: 1, h: H, ...render, ...info },
  ];
}

function buildFromShapes(def) {
  const { width: W, height: H, terrain, tSpawns, ctSpawns } = def;
  const t = buildBase(W, H);
  const shapes = [...perimeterWallShapes(W, H)];
  // Continuous-movement lookup: the authored shapes themselves (float x/y/w/h), each
  // tagged with the mechanics tile they rasterize to — used by isWalkableContinuous
  // below instead of the rasterized `tiles` dict, so free-form movement isn't limited
  // to the tile grid's precision.
  const terrainShapes = [];

  for (const s of terrain) {
    const style = CS_SHAPE_STYLES[s.kind] ?? CS_SHAPE_STYLES.wall;
    if (style.tile) forEachCell(s, W, H, (x, y) => { t[k(x, y)] = style.tile; });
    terrainShapes.push({ shape: s.shape ?? 'rect', x: s.x, y: s.y, w: s.w, h: s.h, tile: style.tile });
    shapes.push({
      shape: s.shape ?? 'rect', x: s.x, y: s.y, w: s.w, h: s.h,
      ...style.render,
      // On-map text is reserved for gameplay-relevant zones (spawn/bombsite labels come
      // from the kind's own style, e.g. CS_SHAPE_STYLES.bombsiteA.label = 'A'). A per-shape
      // `s.label` (map-authoring callout names like "Xbox"/"Blue") is intentionally NOT
      // drawn on the map — it only replaces the generic kind name in the terrain-details
      // panel when that shape is selected (see Battlefield.vue's selectedTerrain).
      label: style.label ?? null,
      name: s.label ?? style.name, description: style.description,
    });
  }

  return { width: W, height: H, tiles: t, tSpawns, ctSpawns, shapes, terrainShapes };
}

// Continuous (non-rasterized) walkability — walls/crates/pits/water are tested
// directly against their authored shape geometry (later shapes win ties, matching
// the rasterization order above) rather than the tile grid.
export function isWalkableContinuous(map, x, y) {
  if (x <= 0 || y <= 0 || x >= map.width - 1 || y >= map.height - 1) return false;
  for (let i = map.terrainShapes.length - 1; i >= 0; i--) {
    const s = map.terrainShapes[i];
    if (pointInShape(s, x, y)) return s.tile !== 'wall' && s.tile !== 'lowWall';
  }
  return true;
}

// de_forge — a foundry split by a central oval furnace pit; two sites on opposite corners.
const DE_FORGE = {
  width: 22, height: 14,
  terrain: [
    { shape: 'rect', x:  1, y:  5, w: 3, h: 4, kind: 'ctSpawn' },
    { shape: 'rect', x: 18, y:  5, w: 3, h: 4, kind: 'tSpawn'  },
    { shape: 'oval', x:  9, y:  5, w: 4, h: 4, kind: 'pit'     },
    { shape: 'rect', x:  7, y:  2, w: 2, h: 2, kind: 'crate'   },
    { shape: 'rect', x: 13, y: 10, w: 2, h: 2, kind: 'crate'   },
    { shape: 'rect', x:  7, y: 10, w: 2, h: 2, kind: 'crate'   },
    { shape: 'rect', x: 13, y:  2, w: 2, h: 2, kind: 'crate'   },
    { shape: 'rect', x:  4, y: 10, w: 4, h: 2, kind: 'bombsiteA' },
    { shape: 'rect', x: 14, y:  2, w: 4, h: 2, kind: 'bombsiteB' },
  ],
  ctSpawns: [{ x: 1, y: 6 }, { x: 2, y: 6 }, { x: 3, y: 6 }, { x: 2, y: 7 }, { x: 2, y: 8 }],
  tSpawns:  [{ x: 20, y: 6 }, { x: 19, y: 6 }, { x: 18, y: 6 }, { x: 19, y: 7 }, { x: 19, y: 8 }],
};

// de_pond — waterfront with two impassable oval ponds routing play around buildings.
const DE_POND = {
  width: 22, height: 14,
  terrain: [
    { shape: 'rect', x:  1, y: 10, w: 3, h: 3, kind: 'ctSpawn' },
    { shape: 'rect', x: 18, y:  1, w: 3, h: 3, kind: 'tSpawn'  },
    { shape: 'oval', x:  5, y:  3, w: 5, h: 3, kind: 'water'   },
    { shape: 'oval', x: 13, y:  8, w: 5, h: 3, kind: 'water'   },
    { shape: 'rect', x:  9, y:  2, w: 3, h: 2, kind: 'building' },
    { shape: 'rect', x: 10, y: 10, w: 3, h: 2, kind: 'building' },
    { shape: 'rect', x:  7, y:  7, w: 1, h: 1, kind: 'crate'   },
    { shape: 'rect', x: 14, y:  4, w: 1, h: 1, kind: 'crate'   },
    { shape: 'rect', x:  2, y:  2, w: 3, h: 2, kind: 'bombsiteA' },
    { shape: 'rect', x: 17, y: 10, w: 3, h: 2, kind: 'bombsiteB' },
  ],
  ctSpawns: [{ x: 1, y: 11 }, { x: 2, y: 11 }, { x: 3, y: 11 }, { x: 2, y: 12 }, { x: 1, y: 12 }],
  tSpawns:  [{ x: 20, y: 2 }, { x: 19, y: 2 }, { x: 18, y: 2 }, { x: 19, y: 3 }, { x: 20, y: 3 }],
};

// de_plaza — an open oval plaza with a central fountain and market stalls; both sites
// sit on the pavement. Shows layered ovals: a walkable plaza under an impassable fountain.
const DE_PLAZA = {
  width: 22, height: 14,
  terrain: [
    { shape: 'rect', x:  1, y:  5, w: 3, h: 4, kind: 'ctSpawn' },
    { shape: 'rect', x: 18, y:  5, w: 3, h: 4, kind: 'tSpawn'  },
    { shape: 'oval', x:  6, y:  3, w: 10, h: 8, kind: 'plaza'  },
    { shape: 'oval', x: 10, y:  6, w: 2,  h: 2, kind: 'water'  },
    { shape: 'rect', x:  9, y:  1, w: 4, h: 1, kind: 'building' },
    { shape: 'rect', x:  9, y: 12, w: 4, h: 1, kind: 'building' },
    { shape: 'rect', x:  7, y:  4, w: 1, h: 1, kind: 'crate'   },
    { shape: 'rect', x: 14, y:  4, w: 1, h: 1, kind: 'crate'   },
    { shape: 'rect', x:  7, y:  9, w: 1, h: 1, kind: 'crate'   },
    { shape: 'rect', x: 14, y:  9, w: 1, h: 1, kind: 'crate'   },
    { shape: 'rect', x:  7, y: 10, w: 3, h: 2, kind: 'bombsiteA' },
    { shape: 'rect', x: 12, y:  2, w: 3, h: 2, kind: 'bombsiteB' },
  ],
  ctSpawns: [{ x: 1, y: 6 }, { x: 2, y: 6 }, { x: 3, y: 6 }, { x: 2, y: 7 }, { x: 2, y: 8 }],
  tSpawns:  [{ x: 20, y: 6 }, { x: 19, y: 6 }, { x: 18, y: 6 }, { x: 19, y: 7 }, { x: 19, y: 8 }],
};

// ── Classic maps, re-authored as shapes ──────────────────────────────────────────
// The originals were hand-laid tile grids; here they're rebuilt from rectangles and
// ovals so they render as clean layered SVGs (rounded crates, oval barrel stacks and
// courtyards) instead of one-cell blocks, while keeping their site/spawn layout.

// dust2 — two sites on the left, mid barrels, T-side cover; CT centre-left, T centre-right.
const DUST2 = {
  width: 22, height: 14,
  terrain: [
    { shape: 'rect', x:  1, y:  6, w: 3, h: 3, kind: 'ctSpawn'   },
    { shape: 'rect', x: 18, y:  6, w: 3, h: 3, kind: 'tSpawn'    },
    { shape: 'rect', x:  2, y:  9, w: 4, h: 3, kind: 'bombsiteA' },
    { shape: 'rect', x:  2, y:  2, w: 4, h: 3, kind: 'bombsiteB' },
    { shape: 'rect', x:  8, y: 11, w: 5, h: 1, kind: 'building'  }, // long-A wall
    { shape: 'rect', x:  8, y:  2, w: 5, h: 1, kind: 'building'  }, // long-B wall
    { shape: 'oval', x:  9, y:  5, w: 4, h: 4, kind: 'crate'     }, // mid barrels
    { shape: 'oval', x: 14, y:  8, w: 3, h: 3, kind: 'crate'     }, // upper T cover
    { shape: 'oval', x: 14, y:  3, w: 3, h: 3, kind: 'crate'     }, // lower T cover
  ],
  ctSpawns: [{ x: 1, y: 7 }, { x: 2, y: 7 }, { x: 3, y: 7 }, { x: 2, y: 8 }, { x: 2, y: 6 }],
  tSpawns:  [{ x: 20, y: 7 }, { x: 19, y: 7 }, { x: 18, y: 7 }, { x: 19, y: 8 }, { x: 19, y: 6 }],
};

// de_dust — symmetric: two mid corridor walls funnel play past an oval barrel stack.
const DE_DUST = {
  width: 22, height: 14,
  terrain: [
    { shape: 'rect', x:  1, y:  5, w: 3, h: 4, kind: 'ctSpawn'   },
    { shape: 'rect', x: 18, y:  5, w: 3, h: 4, kind: 'tSpawn'    },
    { shape: 'rect', x:  2, y:  9, w: 4, h: 3, kind: 'bombsiteA' },
    { shape: 'rect', x:  2, y:  2, w: 4, h: 3, kind: 'bombsiteB' },
    { shape: 'rect', x:  8, y:  4, w: 1, h: 6, kind: 'building'  }, // west corridor wall
    { shape: 'rect', x: 14, y:  4, w: 1, h: 6, kind: 'building'  }, // east corridor wall
    { shape: 'oval', x: 10, y:  5, w: 3, h: 4, kind: 'crate'     }, // mid stack
    { shape: 'rect', x:  6, y: 10, w: 3, h: 1, kind: 'building'  }, // upper arch
    { shape: 'rect', x:  6, y:  3, w: 3, h: 1, kind: 'building'  }, // lower arch
  ],
  ctSpawns: [{ x: 2, y: 6 }, { x: 1, y: 6 }, { x: 2, y: 7 }, { x: 3, y: 6 }, { x: 2, y: 5 }],
  tSpawns:  [{ x: 19, y: 6 }, { x: 20, y: 6 }, { x: 19, y: 7 }, { x: 18, y: 6 }, { x: 19, y: 5 }],
};

// cs_siege — a walled compound (solid block with an oval courtyard carved out) holds both
// sites and the CTs; a single east gate lets the storming Ts in. Cover ovals sit outside.
const CS_SIEGE = {
  width: 22, height: 14,
  terrain: [
    { shape: 'rect', x:  2, y:  2, w: 8, h: 10, kind: 'building'  }, // compound block
    { shape: 'oval', x:  3, y:  3, w: 6, h:  8, kind: 'floor'     }, // carved courtyard
    { shape: 'rect', x:  9, y:  6, w: 2, h:  2, kind: 'floor'     }, // east gate
    { shape: 'rect', x:  4, y:  8, w: 3, h:  2, kind: 'bombsiteA' },
    { shape: 'rect', x:  4, y:  4, w: 3, h:  2, kind: 'bombsiteB' },
    { shape: 'rect', x:  4, y:  6, w: 2, h:  2, kind: 'ctSpawn'   },
    { shape: 'rect', x: 17, y:  6, w: 3, h:  3, kind: 'tSpawn'    },
    { shape: 'oval', x: 12, y:  3, w: 3, h:  3, kind: 'crate'     },
    { shape: 'oval', x: 12, y:  9, w: 3, h:  3, kind: 'crate'     },
  ],
  ctSpawns: [{ x: 4, y: 6 }, { x: 5, y: 6 }, { x: 4, y: 7 }, { x: 5, y: 7 }, { x: 4, y: 5 }],
  tSpawns:  [{ x: 18, y: 7 }, { x: 19, y: 7 }, { x: 17, y: 7 }, { x: 18, y: 8 }, { x: 18, y: 6 }],
};

// cs_italy — village: CTs top-left, Ts bottom-right, two market buildings dividing the
// middle with an oval stall stack; A market (upper-right), B cellar (lower-left).
const CS_ITALY = {
  width: 22, height: 14,
  terrain: [
    { shape: 'rect', x:  1, y: 10, w: 3, h: 3, kind: 'ctSpawn'   },
    { shape: 'rect', x: 18, y:  1, w: 3, h: 3, kind: 'tSpawn'    },
    { shape: 'rect', x: 15, y: 10, w: 4, h: 3, kind: 'bombsiteA' }, // market
    { shape: 'rect', x:  2, y:  2, w: 4, h: 3, kind: 'bombsiteB' }, // wine cellar
    { shape: 'rect', x:  6, y:  8, w: 6, h: 3, kind: 'building'  }, // upper building
    { shape: 'rect', x: 11, y:  3, w: 6, h: 3, kind: 'building'  }, // lower building
    { shape: 'oval', x:  8, y:  5, w: 3, h: 3, kind: 'crate'     }, // stall stack
    { shape: 'rect', x:  5, y:  5, w: 1, h: 3, kind: 'building'  }, // left alley wall
    { shape: 'rect', x: 16, y:  6, w: 1, h: 3, kind: 'building'  }, // right alley wall
  ],
  ctSpawns: [{ x: 2, y: 11 }, { x: 1, y: 11 }, { x: 3, y: 11 }, { x: 2, y: 12 }, { x: 2, y: 10 }],
  tSpawns:  [{ x: 19, y: 2 }, { x: 20, y: 2 }, { x: 18, y: 2 }, { x: 19, y: 3 }, { x: 19, y: 1 }],
};

// de_dust2 — the flagship map, rebuilt at higher fidelity with named callouts. CTs hold
// the centre-left spawn with routes down to A (via Catwalk/Short) and B (via Mid/Window);
// Ts hold the top-right spawn with routes down Long into A and down through B Tunnel.
//
// Real Dust II leans heavily on ELEVATION — Long's ramp up into A, Catwalk overlooking B
// Tunnel from above, waist-high boxes (Xbox, Car, the corner box at A) you crouch/shoot
// over. This engine has no z-axis (unit.position is a flat continuous x/y — see
// project_continuous_coords in memory), so true stacked geometry isn't possible. Two
// workarounds stand in for it (see the `lowWall`/`ramp`/`catwalk` kinds above):
//   1. Elevated PATHS (Catwalk) are authored as their own lane running parallel to the
//      room they overlook rather than literally on top of it — topological separation
//      instead of a z-coordinate.
//   2. Waist-high COVER (Xbox, Car, the A corner box, the B window sill) uses `lowWall`:
//      it blocks movement like a wall, but is deliberately excluded from csLosBlockers'
//      opacity test (belief.js only opacifies tile === 'wall'), so — like real elevated
//      cover — you can still see and shoot across or over it.
const DE_DUST2 = {
  width: 22, height: 14,
  terrain: [
    // ── ground-detail layer (cosmetic, always first — see scatterGroundDetail) ──
    ...scatterGroundDetail(0xd2, 80, 22, 14),

    // ── spawns & sites ──
    { shape: 'rect', x:  1, y:  9, w: 4, h: 3, kind: 'ctSpawn'   },
    { shape: 'rect', x: 17, y:  9, w: 3, h: 3, kind: 'tSpawn'    },
    { shape: 'rect', x:  1, y:  1, w: 5, h: 4, kind: 'bombsiteB' },
    { shape: 'rect', x: 15, y:  1, w: 5, h: 4, kind: 'bombsiteA' },

    // ── structural walls: Mid corridor (west leg) and Long/Catwalk divider ──
    { shape: 'rect', x:  5, y:  3, w: 1, h: 6, kind: 'building'  }, // mid west wall (leaves y1-2 open: B Window)
    { shape: 'rect', x:  9, y:  1, w: 1, h: 7, kind: 'building'  }, // mid east wall
    { shape: 'rect', x: 13, y:  5, w: 1, h: 4, kind: 'building'  }, // catwalk/long divider (leaves y1-4 open: Short)

    // ── Long A: right-side corridor from T spawn down into A, with barrel cover ──
    // (labels below feed the terrain-details panel on select only — see the note in
    // buildFromShapes; they're not drawn on the map itself.)
    { shape: 'oval', x: 15, y:  4, w: 3, h: 3, kind: 'crate',   label: 'Blue'   }, // mid-long barrels
    { shape: 'rect', x: 14, y:  1, w: 1, h: 3, kind: 'ramp',    label: 'Ramp'   }, // slope up into A
    { shape: 'rect', x: 15, y:  8, w: 4, h: 1, kind: 'ramp',    label: 'Long Doors' },
    { shape: 'rect', x: 19, y:  1, w: 1, h: 2, kind: 'lowWall', label: 'Goose'  }, // corner box, shoot-over
    { shape: 'rect', x: 16, y:  1, w: 1, h: 1, kind: 'lowWall', label: 'Pit'    }, // second A corner box
    { shape: 'rect', x: 15, y:  9, w: 3, h: 1, kind: 'ramp',    label: 'T Ramp' }, // T spawn's slope down to Long

    // ── Catwalk / Short A: elevated lane (own path, not stacked) into A's flank ──
    { shape: 'rect', x: 10, y:  5, w: 3, h: 4, kind: 'catwalk', label: 'Catwalk' },
    { shape: 'rect', x: 13, y:  2, w: 1, h: 1, kind: 'lowWall', label: 'Short'  }, // catwalk railing into A, shoot-over
    { shape: 'rect', x:  2, y:  8, w: 6, h: 1, kind: 'ramp',    label: 'CT Ramp' },
    { shape: 'rect', x: 11, y:  2, w: 1, h: 1, kind: 'ramp',    label: 'Ninja'  }, // quiet corner between Short and Catwalk
    { shape: 'rect', x:  1, y: 12, w: 2, h: 1, kind: 'catwalk', label: 'Heaven' }, // CT spawn's elevated ledge

    // ── Mid: centre corridor with Xbox cover, opens into B Window ──
    { shape: 'rect', x:  6, y:  3, w: 2, h: 2, kind: 'crate',   label: 'Xbox'   },
    { shape: 'rect', x:  6, y:  7, w: 3, h: 1, kind: 'ramp',    label: 'Mid Doors' },
    { shape: 'rect', x:  6, y:  2, w: 1, h: 1, kind: 'lowWall', label: 'Window' }, // window sill, shoot-through
    { shape: 'rect', x:  9, y:  8, w: 1, h: 1, kind: 'ramp',    label: 'Suicide' }, // exposed mid/catwalk crossing

    // ── B Tunnel: left-side route from T spawn's plaza down into B ──
    { shape: 'rect', x:  2, y:  5, w: 3, h: 4, kind: 'ramp',    label: 'B Tunnel' },
    { shape: 'rect', x:  2, y:  5, w: 1, h: 1, kind: 'ramp',    label: 'Dark'   }, // unlit tunnel corner
    { shape: 'rect', x:  1, y:  1, w: 2, h: 1, kind: 'crate',   label: 'Car'    },
    { shape: 'rect', x:  3, y:  3, w: 1, h: 1, kind: 'lowWall', label: 'Elevator' }, // B site platform edge
    { shape: 'rect', x:  2, y:  4, w: 1, h: 1, kind: 'ramp',    label: 'Deep'   }, // back corner of B site

    // ── scattered debris: small extra cover, one per zone, none blocking the only path ──
    { shape: 'rect', x:  4, y: 11, w: 1, h: 1, kind: 'debris' }, // CT spawn
    { shape: 'rect', x: 19, y: 11, w: 1, h: 1, kind: 'debris' }, // T spawn
    { shape: 'rect', x: 17, y:  3, w: 1, h: 1, kind: 'debris' }, // A site
    { shape: 'rect', x:  4, y:  3, w: 1, h: 1, kind: 'debris' }, // B site
    { shape: 'rect', x:  7, y:  6, w: 1, h: 1, kind: 'debris' }, // Mid, east bypass still open
    { shape: 'rect', x: 11, y:  7, w: 1, h: 1, kind: 'debris' }, // Catwalk
    { shape: 'rect', x:  3, y:  6, w: 1, h: 1, kind: 'debris' }, // B Tunnel
    { shape: 'rect', x: 18, y:  6, w: 1, h: 1, kind: 'debris' }, // Long
  ],
  ctSpawns: [{ x: 1, y: 10 }, { x: 2, y: 10 }, { x: 3, y: 10 }, { x: 2, y: 9 }, { x: 2, y: 11 }],
  tSpawns:  [{ x: 19, y: 10 }, { x: 18, y: 10 }, { x: 17, y: 10 }, { x: 18, y: 9 }, { x: 18, y: 11 }],
};

// ── Map registry ──────────────────────────────────────────────────────────────

export const MAPS = {
  de_dust2: buildFromShapes(DE_DUST2),
  dust2:    buildFromShapes(DUST2),
  de_dust:  buildFromShapes(DE_DUST),
  cs_siege: buildFromShapes(CS_SIEGE),
  cs_italy: buildFromShapes(CS_ITALY),
  de_forge: buildFromShapes(DE_FORGE),
  de_pond:  buildFromShapes(DE_POND),
  de_plaza: buildFromShapes(DE_PLAZA),
};

// ── Utility functions (all take tiles as first argument) ──────────────────────

// Positions can be continuous (free-form movement); the discrete tile map is only
// keyed by integers, so snap to the tile a point sits in.
export function isBombsite(tiles, x, y) {
  const t = tiles[k(Math.floor(x), Math.floor(y))];
  return t === 'bombsiteA' || t === 'bombsiteB';
}

// Positions can be continuous (free-form movement); the discrete tile map is only
// keyed by integers, so snap to the tile a point sits in.
export function isWalkable(tiles, x, y) {
  const t = tiles[k(Math.floor(x), Math.floor(y))];
  return t !== undefined && t !== 'wall' && t !== 'lowWall';
}

// Bresenham LOS — returns false if any intermediate tile is a wall or in extraBlocked.
// Needs integer endpoints to terminate — unit positions can now be continuous
// (free-form movement), so snap to the tile each endpoint sits in.
export function hasLOS(tiles, x0, y0, x1, y1, extraBlocked = null) {
  x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.floor(x1); y1 = Math.floor(y1);
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let cx = x0, cy = y0;
  while (cx !== x1 || cy !== y1) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; cx += sx; }
    if (e2 < dx)  { err += dx; cy += sy; }
    if (cx === x1 && cy === y1) break;
    if (tiles[k(cx, cy)] === 'wall') return false;
    if (extraBlocked?.has(k(cx, cy))) return false;
  }
  return true;
}

export function euclidean(a, b) {
  return Math.sqrt((num(a.x) - num(b.x)) ** 2 + (num(a.y) - num(b.y)) ** 2);
}

// BFS reachable positions (4-directional, excludes occupied tiles). Still builds the
// AI's discrete candidate set even once positions are continuous (free-form
// movement), so it operates on the integer tile the unit's real position sits in.
export function getReachable(tiles, pos, range, units) {
  const startX = Math.floor(pos.x), startY = Math.floor(pos.y);
  const startKey = k(startX, startY);
  const occupied = new Set(
    units.filter(u => u.alive)
         .map(u => k(Math.floor(u.position.x), Math.floor(u.position.y)))
         .filter(uk => uk !== startKey)
  );
  const visited = new Set([startKey]);
  const queue   = [{ x: startX, y: startY, rem: range }];
  const result  = [];
  while (queue.length) {
    const { x, y, rem } = queue.shift();
    if (rem <= 0) continue;
    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nx = x + dx, ny = y + dy, nk = k(nx, ny);
      if (!visited.has(nk) && isWalkable(tiles, nx, ny) && !occupied.has(nk)) {
        visited.add(nk);
        result.push({ x: nx, y: ny });
        queue.push({ x: nx, y: ny, rem: rem - 1 });
      }
    }
  }
  return result;
}

const TILE_CHARS = { wall: '#', floor: '.', bombsiteA: 'A', bombsiteB: 'B', ctSpawn: 'c', tSpawn: 't', lowWall: '=' };

export function renderMap(state) {
  const { units, gameSpecific: { bomb, smokeZones = [], fireZones = [], map } } = state;
  const { tiles, width, height } = map;
  const posMap = {};
  for (const u of units) if (u.alive) posMap[k(tileNum(u.position.x), tileNum(u.position.y))] = u;

  const smokeSet = new Set();
  for (const sz of smokeZones) {
    const cx = tileNum(sz.x), cy = tileNum(sz.y);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        smokeSet.add(k(cx + dx, cy + dy));
  }

  const fireSet = new Set();
  for (const fz of fireZones) {
    const cx = tileNum(fz.x), cy = tileNum(fz.y);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        fireSet.add(k(cx + dx, cy + dy));
  }

  const rows = [];
  for (let y = height - 1; y >= 0; y--) {
    let row = '';
    for (let x = 0; x < width; x++) {
      const kk = k(x, y);
      const u = posMap[kk];
      if (u) {
        row += u.ownerId === 'T' ? 'T' : 'C';
      } else if (bomb?.planted && tileNum(bomb.plantedAt.x) === x && tileNum(bomb.plantedAt.y) === y) {
        row += '!';
      } else if (fireSet.has(kk)) {
        row += '*';
      } else if (smokeSet.has(kk)) {
        row += '@';
      } else {
        row += TILE_CHARS[tiles[kk]] ?? '?';
      }
    }
    rows.push(`${String(y).padStart(2)} ${row}`);
  }
  rows.push('   ' + Array.from({ length: width }, (_, i) => i % 10).join(''));
  return rows.join('\n');
}
