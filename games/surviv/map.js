// Tile types: 'wall' | 'floor' | 'redSpawn' | 'blueSpawn'
// y increases upward (y=0 = bottom row, y=H-1 = top row)
// All utility functions accept `tiles` as first argument.
//
// Shape-authored, exactly like games/cs/map.js: terrain is a list of rects/ovals with a
// `kind` that decides both the mechanics tile it rasterizes to and its client render
// style. See that file's header comment for the general approach; the one new wrinkle
// here is `bush` (see BUSH kinds below) — walkable and NOT a LOS blocker via the normal
// wall mechanism, but tracked separately so belief.js can grant concealment to a unit
// standing inside one (see BUSH_SPOT_RANGE in weapons.js).

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

const SURVIV_SHAPE_STYLES = {
  forest:    { tile: 'wall',      render: { fill: '#2c5f3a', stroke: '#1f4429' },  name: 'Forest',    description: 'Dense trees — impassable, blocks line of sight.' },
  water:     { tile: 'wall',      render: { fill: '#2f7fae', opacity: 0.88 },                    name: 'Water',     description: 'Impassable, blocks line of sight.' },
  sand:      { tile: null,        render: { fill: '#d9c48a', opacity: 0.55 },                    name: 'Sand',      description: 'Open ground, walkable.' },
  building:  { tile: 'wall',      render: { fill: '#7a6a55', stroke: '#544838' },                 name: 'Building',  description: 'Impassable, blocks line of sight.' },
  crate:     { tile: 'wall',      render: { fill: '#8a6a3f', stroke: '#5f4726' },    name: 'Crates',    description: 'Impassable hard cover, blocks line of sight.' },
  barrel:    { tile: 'wall',      render: { fill: '#a44a3a', stroke: '#6f2f24' },    name: 'Barrel',    description: 'Impassable hard cover, blocks line of sight.' },
  // Walkable AND does not block LOS via the normal wall mechanism (see csLosBlockers-
  // style helpers in belief.js) — concealment is a separate per-unit check
  // (survivBushShapes + BUSH_SPOT_RANGE), not a sight blocker for the whole tile.
  bush:      { tile: null,        render: { fill: '#3c7a44', opacity: 0.65 },        name: 'Bush',      description: 'Walkable — conceals anyone inside from enemies beyond spotting range.' },
  redSpawn:  { tile: null,        render: { fill: '#d4453a', opacity: 0.14 }, label: 'RED',        name: 'Red Spawn', description: 'Red team starting area.' },
  blueSpawn: { tile: null,        render: { fill: '#3a7fd4', opacity: 0.14 }, label: 'BLUE',        name: 'Blue Spawn', description: 'Blue team starting area.' },
};

// Floor colour under the shape layer — grass, since the terrain is conveyed by shapes.
export const SURVIV_SHAPE_FLOOR = '#5a9450';

function buildFromShapes(def) {
  const { width: W, height: H, terrain, redSpawns, blueSpawns, loot } = def;
  const t = buildBase(W, H);
  const shapes = [];
  const terrainShapes = [];
  const bushShapes = [];

  for (const s of terrain) {
    const style = SURVIV_SHAPE_STYLES[s.kind] ?? SURVIV_SHAPE_STYLES.building;
    if (style.tile) forEachCell(s, W, H, (x, y) => { t[k(x, y)] = style.tile; });
    const tShape = { shape: s.shape ?? 'rect', x: s.x, y: s.y, w: s.w, h: s.h, tile: style.tile, kind: s.kind };
    terrainShapes.push(tShape);
    if (s.kind === 'bush') bushShapes.push(tShape);
    shapes.push({
      shape: s.shape ?? 'rect', x: s.x, y: s.y, w: s.w, h: s.h,
      ...style.render,
      label: s.label ?? style.label ?? null,
      name: style.name, description: style.description,
    });
  }

  return { width: W, height: H, tiles: t, redSpawns, blueSpawns, loot, shapes, terrainShapes, bushShapes };
}

// Continuous (non-rasterized) walkability — mirrors games/cs/map.js's version exactly.
export function isWalkableContinuous(map, x, y) {
  if (x <= 0 || y <= 0 || x >= map.width - 1 || y >= map.height - 1) return false;
  for (let i = map.terrainShapes.length - 1; i >= 0; i--) {
    const s = map.terrainShapes[i];
    if (pointInShape(s, x, y)) return s.tile !== 'wall';
  }
  return true;
}

// True when (x, y) sits inside any bush shape — grants concealment (see belief.js).
export function isInBush(map, x, y) {
  return (map.bushShapes ?? []).some(s => pointInShape(s, x, y));
}

// ── Sandbar Island — one high-fidelity, fully mirrored 10v10 map ────────────────────
// Red holds the west spawn, Blue the east; every shape below is mirrored left-right
// about the map centre (mirror(x, w) = WIDTH - x - w for a shape, WIDTH - x for a
// point) so the map is exactly symmetric. Layout: forest belts funnel each team out of
// spawn along a north and south lane, both lanes cross a sand-ringed pond, and both
// converge on a central town (buildings + a crate cluster) holding the best loot.
const WIDTH = 30, HEIGHT = 18;

const SANDBAR_ISLAND = {
  width: WIDTH, height: HEIGHT,
  terrain: [
    // ── spawns ──
    { shape: 'rect', x: 1,  y: 6,  w: 4, h: 6, kind: 'redSpawn' },
    { shape: 'rect', x: 25, y: 6,  w: 4, h: 6, kind: 'blueSpawn' },

    // ── forest belts (spawn cover, both lanes) ──
    { shape: 'oval', x: 6,  y: 2,  w: 6, h: 5, kind: 'forest' },
    { shape: 'oval', x: 6,  y: 11, w: 6, h: 5, kind: 'forest' },
    { shape: 'oval', x: 18, y: 2,  w: 6, h: 5, kind: 'forest' },
    { shape: 'oval', x: 18, y: 11, w: 6, h: 5, kind: 'forest' },

    // ── ponds (north/south hazards, each self-mirrored) ──
    { shape: 'oval', x: 11, y: 0,  w: 8, h: 3, kind: 'water' },
    { shape: 'oval', x: 11, y: 15, w: 8, h: 3, kind: 'water' },
    { shape: 'rect', x: 10, y: 3,  w: 10, h: 1, kind: 'sand' },
    { shape: 'rect', x: 10, y: 14, w: 10, h: 1, kind: 'sand' },

    // ── central town ──
    { shape: 'rect', x: 11, y: 6,  w: 3, h: 1, kind: 'building' },
    { shape: 'rect', x: 16, y: 6,  w: 3, h: 1, kind: 'building' },
    { shape: 'rect', x: 11, y: 11, w: 3, h: 1, kind: 'building' },
    { shape: 'rect', x: 16, y: 11, w: 3, h: 1, kind: 'building' },
    { shape: 'oval', x: 13, y: 8,  w: 4, h: 2, kind: 'crate', label: 'Town' },
    { shape: 'rect', x: 10, y: 8,  w: 1, h: 1, kind: 'crate' },
    { shape: 'rect', x: 19, y: 8,  w: 1, h: 1, kind: 'crate' },

    // ── barrels (mid-lane cover) ──
    { shape: 'oval', x: 8,  y: 4,  w: 1, h: 1, kind: 'barrel' },
    { shape: 'oval', x: 21, y: 4,  w: 1, h: 1, kind: 'barrel' },
    { shape: 'oval', x: 8,  y: 13, w: 1, h: 1, kind: 'barrel' },
    { shape: 'oval', x: 21, y: 13, w: 1, h: 1, kind: 'barrel' },

    // ── bushes (concealment, town approaches + mid-lane) ──
    { shape: 'oval', x: 9,    y: 6,   w: 1.5, h: 1.5, kind: 'bush' },
    { shape: 'oval', x: 19.5, y: 6,   w: 1.5, h: 1.5, kind: 'bush' },
    { shape: 'oval', x: 9,    y: 11,  w: 1.5, h: 1.5, kind: 'bush' },
    { shape: 'oval', x: 19.5, y: 11,  w: 1.5, h: 1.5, kind: 'bush' },
    { shape: 'oval', x: 6,    y: 8.5, w: 1.5, h: 1.5, kind: 'bush' },
    { shape: 'oval', x: 22.5, y: 8.5, w: 1.5, h: 1.5, kind: 'bush' },
  ],
  redSpawns: [
    { x: 2, y: 7 }, { x: 3, y: 7 }, { x: 4, y: 7 }, { x: 2, y: 8 }, { x: 3, y: 8 },
    { x: 4, y: 8 }, { x: 2, y: 9 }, { x: 3, y: 9 }, { x: 4, y: 9 }, { x: 2, y: 10 },
  ],
  blueSpawns: [
    { x: 28, y: 7 }, { x: 27, y: 7 }, { x: 26, y: 7 }, { x: 28, y: 8 }, { x: 27, y: 8 },
    { x: 26, y: 8 }, { x: 28, y: 9 }, { x: 27, y: 9 }, { x: 26, y: 9 }, { x: 28, y: 10 },
  ],
  // Loot progression: common sidearms right outside each spawn, mid-tier guns in the
  // forest lanes, and the best rifles/snipers/armor in the contested central town — the
  // risk/reward gradient that drives surviv.io's push-to-the-middle dynamic. `tier`
  // is a lookup key into LOOT_TABLE (see SurvivGame.js), not an item id itself, so the
  // concrete item can be varied per spawn point while the map stays deterministic.
  loot: [
    { x: 5,  y: 8,  tier: 1 }, { x: 25, y: 8,  tier: 1 },
    { x: 5,  y: 9,  tier: 1 }, { x: 25, y: 9,  tier: 1 },
    { x: 9,  y: 4,  tier: 2 }, { x: 21, y: 4,  tier: 2 },
    { x: 9,  y: 13, tier: 2 }, { x: 21, y: 13, tier: 2 },
    { x: 7,  y: 6,  tier: 'grenade' }, { x: 23, y: 6,  tier: 'grenade' },
    { x: 7,  y: 11, tier: 'vest' },    { x: 23, y: 11, tier: 'vest' },
    { x: 13, y: 6,  tier: 'helmet' },  { x: 17, y: 6,  tier: 'helmet' },
    { x: 12, y: 7,  tier: 3 }, { x: 18, y: 7,  tier: 3 },
    { x: 12, y: 10, tier: 3 }, { x: 18, y: 10, tier: 3 },
    { x: 14, y: 9,  tier: 4 }, { x: 16, y: 9,  tier: 4 },
  ],
};

export const MAPS = {
  sandbar_island: buildFromShapes(SANDBAR_ISLAND),
};

// ── Utility functions (all take tiles as first argument) ──────────────────────

export function isWalkable(tiles, x, y) {
  const t = tiles[k(Math.floor(x), Math.floor(y))];
  return t !== undefined && t !== 'wall';
}

export function euclidean(a, b) {
  return Math.sqrt((num(a.x) - num(b.x)) ** 2 + (num(a.y) - num(b.y)) ** 2);
}

// BFS reachable positions (4-directional, excludes occupied tiles) — the AI's discrete
// candidate set, same approach as games/cs/map.js's getReachable.
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

const TILE_CHARS = { wall: '#', floor: '.', redSpawn: 'r', blueSpawn: 'b' };

export function renderMap(state) {
  const { units, gameSpecific: { map, loot = [] } } = state;
  const { tiles, width, height } = map;
  const posMap = {};
  for (const u of units) if (u.alive) posMap[k(tileNum(u.position.x), tileNum(u.position.y))] = u;
  const lootSet = new Set(loot.filter(l => !l.taken).map(l => k(tileNum(l.x), tileNum(l.y))));

  const rows = [];
  for (let y = height - 1; y >= 0; y--) {
    let row = '';
    for (let x = 0; x < width; x++) {
      const kk = k(x, y);
      const u = posMap[kk];
      if (u) row += u.ownerId === 'red' ? 'R' : 'B';
      else if (lootSet.has(kk)) row += '$';
      else row += TILE_CHARS[tiles[kk]] ?? '?';
    }
    rows.push(`${String(y).padStart(2)} ${row}`);
  }
  rows.push('   ' + Array.from({ length: width }, (_, i) => i % 10).join(''));
  return rows.join('\n');
}
