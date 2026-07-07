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
  crate:     { tile: 'wall',      render: { fill: '#6f5533', stroke: '#8a6a3f', round: true },               name: 'Crates',     description: 'Impassable hard cover, blocks line of sight.' },
  pit:       { tile: 'wall',      render: { fill: '#7a3b1f', opacity: 0.9 },                                 name: 'Furnace pit',description: 'Impassable, blocks line of sight.' },
  water:     { tile: 'wall',      render: { fill: '#2f6d8f', opacity: 0.85 },                                name: 'Water',      description: 'Impassable, blocks line of sight.' },
  plaza:     { tile: null,        render: { fill: '#b8b09a', opacity: 0.55 },                                name: 'Plaza',      description: 'Open pavement.' },
  floor:     { tile: 'floor',     render: { fill: '#c8c0a8' },                                               name: 'Floor',      description: 'Open ground.' },
  bombsiteA: { tile: 'bombsiteA', render: { fill: '#d4a03a', opacity: 0.26, stroke: '#e0b24a' }, label: 'A', name: 'Bombsite A', description: 'Bomb can be planted or defused here.' },
  bombsiteB: { tile: 'bombsiteB', render: { fill: '#d4a03a', opacity: 0.26, stroke: '#e0b24a' }, label: 'B', name: 'Bombsite B', description: 'Bomb can be planted or defused here.' },
  ctSpawn:   { tile: null,        render: { fill: '#4a8fd4', opacity: 0.16 }, label: 'CT',                   name: 'CT Spawn',   description: 'Counter-Terrorist starting area.' },
  tSpawn:    { tile: null,        render: { fill: '#d4713a', opacity: 0.16 }, label: 'T',                    name: 'T Spawn',    description: 'Terrorist starting area.' },
};

// Floor colour used for the (uniform) tile layer under a shape map — the terrain is
// conveyed entirely by the shapes, so the raster grid stays a plain backdrop.
export const CS_SHAPE_FLOOR = '#c8c0a8';

function buildFromShapes(def) {
  const { width: W, height: H, terrain, tSpawns, ctSpawns } = def;
  const t = buildBase(W, H);
  const shapes = [];
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
      label: s.label ?? style.label ?? null,
      name: style.name, description: style.description,
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
    if (pointInShape(s, x, y)) return s.tile !== 'wall';
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

// ── Map registry ──────────────────────────────────────────────────────────────

export const MAPS = {
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
  return t !== undefined && t !== 'wall';
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
    if (rem === 0) continue;
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

// All walkable tiles within Euclidean range (for grenade throws — no LOS required)
export function getThrowTargets(tiles, width, height, pos, range) {
  const r2 = range * range;
  const result = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (isWalkable(tiles, x, y) && (x - num(pos.x)) ** 2 + (y - num(pos.y)) ** 2 <= r2)
        result.push({ x, y });
  return result;
}

const TILE_CHARS = { wall: '#', floor: '.', bombsiteA: 'A', bombsiteB: 'B', ctSpawn: 'c', tSpawn: 't' };

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
