import { forEachCell, pointInShape } from '../terrainShapes.js';
import { tileNum } from '../coord.js';

export const TERRAIN = {
  FLOOR:  '.',
  WALL:   '#',  // building / border — impassable, blocks LOS
  HEDGE:  'w',  // wall/hedge — passable, cover, transparent
  TREE:   'T',  // trees — passable, blocks LOS, light cover
  ROAD:   'r',  // road — passable
  WATER:  '~',  // pond / stream — impassable, but does NOT block LOS
};

export const MAP_WIDTH  = 20;
export const MAP_HEIGHT = 16;

export function createMap() {
  const tiles = Array.from({ length: MAP_HEIGHT }, (_, y) =>
    Array.from({ length: MAP_WIDTH }, (_, x) =>
      (x === 0 || x === MAP_WIDTH - 1 || y === 0 || y === MAP_HEIGHT - 1)
        ? TERRAIN.WALL : TERRAIN.FLOOR
    )
  );

  const set = (x, y, t) => {
    if (x > 0 && x < MAP_WIDTH - 1 && y > 0 && y < MAP_HEIGHT - 1) tiles[y][x] = t;
  };

  // Village building (Allied side): x=3..6, y=3..5
  for (let y = 3; y <= 5; y++) for (let x = 3; x <= 6; x++) set(x, y, TERRAIN.WALL);

  // Farmhouse (Axis side): x=13..16, y=10..12
  for (let y = 10; y <= 12; y++) for (let x = 13; x <= 16; x++) set(x, y, TERRAIN.WALL);

  // Treeline (Allied side, central)
  for (const [x, y] of [[8,2],[9,2],[10,2],[11,2],[9,3],[10,3]]) set(x, y, TERRAIN.TREE);

  // Treeline (Axis side, central)
  for (const [x, y] of [[8,12],[9,12],[10,12],[11,12],[9,13],[10,13]]) set(x, y, TERRAIN.TREE);

  // Hedgerows (scattered, none on road row y=7)
  for (const [x, y] of [[2,5],[2,6],[17,5],[17,6],[7,9],[7,10],[2,9],[2,10]])
    set(x, y, TERRAIN.HEDGE);

  // Road (horizontal, y=7)
  for (let x = 1; x <= 18; x++) set(x, 7, TERRAIN.ROAD);

  return { width: MAP_WIDTH, height: MAP_HEIGHT, tiles };
}

// ── Shape-based (non-grid) maps ─────────────────────────────────────────────────
//
// Terrain authored as an array of shapes (rectangles + ovals) instead of a hand-laid
// tile grid. Each shape's `kind` decides how it rasterizes onto the tile grid (for
// movement/LOS) and how the client draws it as a layered SVG. See games/terrainShapes.js.

const CM_SHAPE_STYLES = {
  building: { tile: TERRAIN.WALL,  render: { fill: '#5a5045', stroke: '#6b5f50' }, name: 'Building', description: 'Impassable, blocks line of sight.' },
  wall:     { tile: TERRAIN.WALL,  render: { fill: '#5a5045', stroke: '#6b5f50' }, name: 'Building', description: 'Impassable, blocks line of sight.' },
  woods:    { tile: TERRAIN.TREE,  render: { fill: '#2f5c2f', stroke: '#3f6f3f' }, name: 'Woods',    description: 'Passable but slow; blocks LOS, +20% cover.' },
  trees:    { tile: TERRAIN.TREE,  render: { fill: '#2f5c2f', stroke: '#3f6f3f' }, name: 'Woods',    description: 'Passable but slow; blocks LOS, +20% cover.' },
  hedge:    { tile: TERRAIN.HEDGE, render: { fill: '#4d6b3a', stroke: '#5f7d48' }, name: 'Hedgerow', description: 'Passable but slow; +30% cover, does not block LOS.' },
  road:     { tile: TERRAIN.ROAD,  render: { fill: '#9c8f6b' },                    name: 'Road',     description: 'Passable, no cover.' },
  water:    { tile: TERRAIN.WATER, render: { fill: '#35617a', opacity: 0.9 },       name: 'Water',    description: 'Impassable, but does not block line of sight.' },
  pond:     { tile: TERRAIN.WATER, render: { fill: '#35617a', opacity: 0.9 },       name: 'Water',    description: 'Impassable, but does not block line of sight.' },
  field:    { tile: TERRAIN.FLOOR, render: { fill: '#c2b34e', opacity: 0.4 },       name: 'Field',    description: 'Open ground.' },
};

// Base ground colour under a shape map (open ground), matching TERRAIN.FLOOR.
export const CM_SHAPE_GROUND = '#7d8f5c';

export function createMapFromShapes(def) {
  const { width: W, height: H, terrain } = def;
  const tiles = Array.from({ length: H }, (_, y) =>
    Array.from({ length: W }, (_, x) =>
      (x === 0 || x === W - 1 || y === 0 || y === H - 1) ? TERRAIN.WALL : TERRAIN.FLOOR
    )
  );

  const shapes = [];
  // Continuous-movement lookup: the authored shapes (float x/y/w/h) tagged with the
  // terrain they rasterize to — used by getTileContinuous below so free-form movement
  // cost/wall checks aren't limited to the tile grid's precision.
  const terrainShapes = [];
  for (const s of terrain) {
    const style = CM_SHAPE_STYLES[s.kind] ?? CM_SHAPE_STYLES.building;
    forEachCell(s, W, H, (x, y) => {
      if (x > 0 && x < W - 1 && y > 0 && y < H - 1) tiles[y][x] = style.tile;
    });
    terrainShapes.push({ shape: s.shape ?? 'rect', x: s.x, y: s.y, w: s.w, h: s.h, tile: style.tile });
    shapes.push({
      shape: s.shape ?? 'rect', x: s.x, y: s.y, w: s.w, h: s.h,
      ...style.render, name: style.name, description: style.description,
    });
  }

  return { width: W, height: H, tiles, shapes, terrainShapes };
}

// Continuous (non-rasterized) terrain lookup, tested directly against the authored
// shape geometry (later shapes win ties, matching the rasterization order above).
// Falls back to the rasterized tile grid for hand-laid boards (createMap) that have
// no continuous shape source — there, the tile grid *is* the ground truth.
export function getTileContinuous(board, x, y) {
  if (x <= 0 || y <= 0 || x >= board.width - 1 || y >= board.height - 1) return TERRAIN.WALL;
  if (board.terrainShapes) {
    for (let i = board.terrainShapes.length - 1; i >= 0; i--) {
      const s = board.terrainShapes[i];
      if (pointInShape(s, x, y)) return s.tile;
    }
    return TERRAIN.FLOOR;
  }
  return getTile(board, Math.floor(x), Math.floor(y));
}

export function isPassableContinuous(board, x, y) {
  const t = getTileContinuous(board, x, y);
  return t !== TERRAIN.WALL && t !== TERRAIN.WATER;
}

export function getMoveCostContinuous(board, x, y) {
  const t = getTileContinuous(board, x, y);
  return (t === TERRAIN.TREE || t === TERRAIN.HEDGE) ? 2 : 1;
}

// Snap to the containing tile: positions can be continuous (free-form movement), and
// callers (cover, passability, LOS) key the integer tile grid — a raw float/BigNumber
// coordinate would index `undefined`.
export function getTile(board, x, y) {
  x = tileNum(x); y = tileNum(y);
  if (x < 0 || x >= board.width || y < 0 || y >= board.height) return TERRAIN.WALL;
  return board.tiles[y][x];
}

export function isPassable(board, x, y) {
  const t = getTile(board, x, y);
  return t !== TERRAIN.WALL && t !== TERRAIN.WATER;
}

export function blocksLOS(tile) {
  return tile === TERRAIN.WALL || tile === TERRAIN.TREE;
}

// Returns defense bonus % subtracted from attacker's hit chance
export function getCoverBonus(board, x, y) {
  const t = getTile(board, x, y);
  if (t === TERRAIN.HEDGE) return 30;
  if (t === TERRAIN.TREE)  return 20;
  return 0;
}

// Movement points needed to enter a tile. Difficult terrain (woods, hedgerows) costs
// more than open ground/road, so units cross it more slowly (see grid.js getReachable).
export function getMoveCost(board, x, y) {
  const t = getTile(board, x, y);
  if (t === TERRAIN.TREE || t === TERRAIN.HEDGE) return 2;
  return 1; // open ground, road
}

export function renderMap(board, units) {
  const posMap = {};
  for (const u of units) {
    if (u.alive) posMap[`${tileNum(u.position.x)},${tileNum(u.position.y)}`] = u;
  }
  const rows = [];
  for (let y = 0; y < board.height; y++) {
    let row = `${String(y).padStart(2)} `;
    for (let x = 0; x < board.width; x++) {
      const u = posMap[`${x},${y}`];
      row += u ? u.attrs.symbol : board.tiles[y][x];
    }
    rows.push(row);
  }
  rows.push('    ' + Array.from({ length: board.width }, (_, i) => i % 10).join(''));
  return rows.join('\n');
}
