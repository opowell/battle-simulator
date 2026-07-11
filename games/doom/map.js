import { forEachCell, pointInShape, segmentInUnion, tilesToShapes } from '../terrainShapes.js';
import { num, tileNum } from '../coord.js';

export const MAP_WIDTH  = 36;
export const MAP_HEIGHT = 24;

function k(x, y) { return `${x},${y}`; }

// ── E1M1: Hangar ────────────────────────────────────────────────────────────────
// A faithful, top-down reimagining of Doom's iconic first level, authored as an array
// of shapes (rects + ovals — see games/terrainShapes.js) carved out of solid rock,
// exactly like CsGame/SurvivGame. Two lists drive everything:
//
//   FLOOR — the walkable regions. Their UNION is the floor; walls are the complement.
//           This union is what the engine's LOS (segmentInUnion) and the design-UI fog
//           veil (openShapes) both test against, so server and client visibility stay
//           in lockstep. `kind` is a pure render tint (floor / metal / walkway); every
//           FLOOR shape is walkable and see-through regardless.
//
//   DECOR — solid props laid on the rock backdrop: nukage (toxic slime) pools, storage
//           crates, computer banks, support columns, fuel barrels. They are authored to
//           sit in cells NO floor shape covers, so they are automatically part of the
//           wall complement — impassable AND sight-blocking on both the server and the
//           client, with zero special-casing (a decor cell simply isn't in the floor
//           union, so segmentInUnion / isWalkable already treat it as wall). map.test.js
//           asserts this non-overlap invariant, plus that FLOOR+DECOR clears 100 objects.
//
// Layout (y increases downward):
//   ┌ NW: marine start (techbase) ─ top corridor ─ N hall ─ NE first-encounter room ┐
//   │ west descent          central shaft            east descent                    │
//   │        └──── central COURTYARD: green-armour platform in a nukage moat ────┘   │
//   │                    zig-zag nukage CHANNEL ↓                                     │
//   └──────────── south ARENA (Cacodemon + Baron) ───── secret plasma room ──────────┘

// kind → render style (fill/stroke/opacity/round) + hover name/description.
const STYLES = {
  // FLOOR tints (all walkable + see-through)
  floor:    { fill: '#a2916b',                                     name: 'Floor',        description: 'Techbase floor.' },
  metal:    { fill: '#6f7b8a',                                     name: 'Metal floor',  description: 'Raised steel platform.' },
  walkway:  { fill: '#8f8560',                                     name: 'Walkway',      description: 'Grated walkway.' },
  // DECOR (solid — impassable and blocks line of sight)
  nukage:   { fill: '#7cae3a', stroke: '#9fce55', opacity: 0.92,   name: 'Nukage',       description: 'Toxic slime — impassable, blocks line of sight.' },
  crate:    { fill: '#7a5a30', stroke: '#9a7440',     name: 'Crate',        description: 'Supply crate — hard cover, blocks line of sight.' },
  computer: { fill: '#26424c', stroke: '#3f8091',                  name: 'Computer bank',description: 'Wall terminals — impassable, blocks line of sight.' },
  column:   { fill: '#31363d', stroke: '#565c66',                  name: 'Support column',description: 'Structural column — impassable, blocks line of sight.' },
  barrel:   { fill: '#8a4a24', stroke: '#b56a34',     name: 'Fuel barrel',  description: 'Explosive barrel — hard cover, blocks line of sight.' },
};

// ── FLOOR: the walkable union ─────────────────────────────────────────────────────
const FLOOR = [
  // NW — marine start (techbase)
  { shape: 'rect', x:  3, y:  2, w: 7, h: 6, kind: 'floor'   }, // start room
  { shape: 'rect', x:  2, y:  4, w: 1, h: 3, kind: 'floor'   }, // start west niche (medkit)
  { shape: 'rect', x:  4, y:  8, w: 2, h: 1, kind: 'floor'   }, // start → west descent
  // top corridor + north hall
  { shape: 'rect', x: 10, y:  3, w: 8, h: 2, kind: 'walkway' }, // north corridor
  { shape: 'rect', x: 18, y:  2, w: 5, h: 5, kind: 'floor'   }, // north hall
  { shape: 'rect', x: 23, y:  3, w: 1, h: 2, kind: 'walkway' }, // hall → NE link
  // NE first-encounter room (L-shaped)
  { shape: 'rect', x: 24, y:  2, w: 9, h: 5, kind: 'floor'   }, // NE room, main
  { shape: 'rect', x: 24, y:  7, w: 6, h: 2, kind: 'floor'   }, // NE room, south wing
  // central vertical spine: north hall → courtyard
  { shape: 'rect', x: 19, y:  6, w: 3, h: 4, kind: 'walkway' }, // central shaft
  // west descent: start → courtyard W-ledge
  { shape: 'rect', x:  6, y:  8, w: 2, h: 8, kind: 'walkway' }, // west corridor
  { shape: 'rect', x:  8, y: 12, w: 3, h: 1, kind: 'walkway' }, // west → courtyard link
  { shape: 'rect', x:  2, y: 13, w: 4, h: 2, kind: 'floor'   }, // west store room (chaingun)
  // east descent: NE → courtyard E-ledge
  { shape: 'rect', x: 28, y:  9, w: 2, h: 4, kind: 'walkway' }, // east corridor
  { shape: 'rect', x: 26, y: 12, w: 2, h: 1, kind: 'walkway' }, // east → courtyard link
  // courtyard ledge ring (walkway around the moat)
  { shape: 'rect', x: 11, y:  9, w: 15, h: 1, kind: 'walkway' }, // N-ledge
  { shape: 'rect', x: 11, y: 16, w: 15, h: 1, kind: 'walkway' }, // S-ledge
  { shape: 'rect', x: 11, y: 10, w:  1, h: 6, kind: 'walkway' }, // W-ledge
  { shape: 'rect', x: 25, y: 10, w:  1, h: 6, kind: 'walkway' }, // E-ledge
  // courtyard centre — green-armour platform in the moat, reached by one causeway
  { shape: 'oval', x: 16, y: 11, w: 5, h: 4, kind: 'metal'   }, // armour platform
  { shape: 'rect', x: 18, y: 15, w: 1, h: 1, kind: 'metal'   }, // causeway to S-ledge
  // zig-zag nukage channel: courtyard → arena
  { shape: 'rect', x: 16, y: 17, w: 4, h: 2, kind: 'walkway' }, // channel head
  { shape: 'rect', x: 12, y: 18, w: 4, h: 2, kind: 'walkway' }, // channel west leg
  { shape: 'rect', x: 20, y: 18, w: 4, h: 2, kind: 'walkway' }, // channel east leg
  // south arena (bosses)
  { shape: 'rect', x:  8, y: 19, w: 20, h: 4, kind: 'floor'  }, // arena, main
  { shape: 'rect', x:  5, y: 20, w:  3, h: 2, kind: 'floor'  }, // arena SW alcove
  { shape: 'rect', x: 28, y: 19, w:  4, h: 3, kind: 'floor'  }, // arena SE alcove
  // secret plasma room (east)
  { shape: 'rect', x: 30, y: 11, w: 3, h: 1, kind: 'walkway' }, // secret corridor
  { shape: 'rect', x: 33, y: 10, w: 2, h: 5, kind: 'metal'   }, // secret room
];

// Rasterize the FLOOR union onto the mechanics tile grid — walls are every other cell.
function buildFloorTiles() {
  const tiles = {};
  for (let y = 0; y < MAP_HEIGHT; y++)
    for (let x = 0; x < MAP_WIDTH; x++)
      tiles[k(x, y)] = 'wall';
  for (const room of FLOOR)
    forEachCell(room, MAP_WIDTH, MAP_HEIGHT, (x, y) => { tiles[k(x, y)] = 'floor'; });
  return tiles;
}

export const MAP_TILES = buildFloorTiles();
const isFloorCell = (x, y) => MAP_TILES[k(x, y)] === 'floor';

// ── DECOR: solid props laid on the rock, generated so they can never touch the floor ──
//
// Rather than hand-place ~100 props and risk one sliding onto a walkable tile, decor is
// derived from the FLOOR layout: every prop lands on an un-floored cell, so DECOR is
// always part of the wall complement (impassable + sight-blocking) with no overlap to
// police. Two inputs drive it — explicit nukage pools, and a per-region rule that lines
// the rooms' walls. Contiguous same-kind cells are then merged into panel rects.

// Toxic-slime pools: the courtyard moat ringing the armour platform, plus pools lining
// the zig-zag channel. Rects are drawn loosely — only their un-floored cells take slime,
// so the platform/causeway/ledges punched through them simply stay floor.
const NUKAGE = [
  { shape: 'rect', x: 12, y: 10, w: 13, h: 6 }, // courtyard moat (platform + causeway carve out)
  { shape: 'oval', x: 10, y: 16, w: 3, h: 3 },  // channel pool, west
  { shape: 'oval', x: 23, y: 16, w: 3, h: 3 },  // channel pool, east
  { shape: 'rect', x: 16, y: 19, w: 4, h: 1 },  // channel pool, centre
];

// Hand-placed accent props at chosen wall cells (silently ignored if a cell is floor).
const BARRELS = [[11, 16], [25, 16], [16, 20], [23, 20], [9, 18], [27, 18], [14, 17], [21, 17], [8, 22], [30, 20]];
const COLUMNS = [[10, 8], [26, 9], [7, 19], [28, 22], [2, 9], [33, 6], [16, 8], [21, 8], [10, 16], [26, 16]];

// region(x, y) → decor kind for an un-floored wall cell that borders the floor.
function wallDecorKind(x, y) {
  if (y >= 18) return 'crate';       // arena & channel mouth — crate cover
  return 'computer';                 // techbase rooms & corridors — wall terminals
}

function buildDecorKinds() {
  const kinds = new Map(); // "x,y" → kind
  const put = (x, y, kind) => {
    if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) return;
    if (!isFloorCell(x, y) && !kinds.has(k(x, y))) kinds.set(k(x, y), kind);
  };
  // Nukage first — it wins any cell it shares with the wall-lining pass below.
  for (const s of NUKAGE) forEachCell(s, MAP_WIDTH, MAP_HEIGHT, (x, y) => put(x, y, 'nukage'));
  // Wall lining: any un-floored cell orthogonally adjacent to a floor cell.
  const bordersFloor = (x, y) =>
    isFloorCell(x - 1, y) || isFloorCell(x + 1, y) || isFloorCell(x, y - 1) || isFloorCell(x, y + 1);
  for (let y = 0; y < MAP_HEIGHT; y++)
    for (let x = 0; x < MAP_WIDTH; x++)
      if (!isFloorCell(x, y) && !kinds.has(k(x, y)) && bordersFloor(x, y))
        kinds.set(k(x, y), wallDecorKind(x, y));
  // Accents override whatever the region rule assigned.
  for (const [x, y] of BARRELS) if (!isFloorCell(x, y)) kinds.set(k(x, y), 'barrel');
  for (const [x, y] of COLUMNS) if (!isFloorCell(x, y)) kinds.set(k(x, y), 'column');
  return kinds;
}

const DECOR_KINDS = buildDecorKinds();
const decorType = (x, y) => DECOR_KINDS.get(k(x, y)) ?? null;

// Merge contiguous same-kind decor cells into panel rects (games/terrainShapes.js).
// nukage/barrel/column carry `round` in their style so they still read as pools/drums.
export const DECOR_SHAPES = tilesToShapes(decorType, MAP_WIDTH, MAP_HEIGHT, {
  nukage: STYLES.nukage, crate: STYLES.crate, computer: STYLES.computer,
  barrel: STYLES.barrel, column: STYLES.column,
});

// Bake render styles onto the floor shapes once, at module load.
export const FLOOR_SHAPES = FLOOR.map(s => ({ ...s, ...STYLES[s.kind] }));
// Geometry-only floor list for the LOS/veil samplers (they only need shape+box).
export const LOS_OPEN_SHAPES = FLOOR.map(({ shape, x, y, w, h }) => ({ shape, x, y, w, h }));
// Everything the design UI draws, floor first then props on top.
export const RENDER_SHAPES = [...FLOOR_SHAPES, ...DECOR_SHAPES];

// Continuous (non-rasterized) walkability, tested directly against the authored floor
// geometry — used for free-form (click-anywhere) movement, so precision is bounded only
// by float64, not by the MAP_TILES rasterization used for the AI's discrete moves. A
// point is walkable iff it lies inside some FLOOR shape (DECOR props are never floor).
export function isWalkableContinuous(x, y) {
  if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) return false;
  return FLOOR.some(r => pointInShape(r, x, y));
}

// Positions can be continuous (free-form movement); the discrete tile map is only keyed
// by integers, so snap to the tile a point sits in.
export function isWalkable(x, y) {
  return MAP_TILES[k(tileNum(x), tileNum(y))] === 'floor';
}

// Exact continuous LOS: clear iff the straight sight line stays inside the floor (the
// union of the authored FLOOR shapes). Props (crates/columns/nukage) block sight for free
// because they occupy cells outside that union — the sight line exits the floor there and
// segmentInUnion fails. Matches the design UI's exact vision veil (openShapes = FLOOR).
export function hasLOS(x0, y0, x1, y1) {
  return segmentInUnion(num(x0), num(y0), num(x1), num(y1), FLOOR);
}

// BFS movement — returns reachable floor tiles within range steps. This still builds the
// AI's discrete candidate set even once positions are continuous (free-form movement), so
// it operates on the integer tile the unit's real position sits in.
export function getReachable(pos, range, units) {
  const startX = tileNum(pos.x), startY = tileNum(pos.y);
  const startKey = k(startX, startY);
  const occupied = new Set(
    units.filter(u => u.alive)
         .map(u => k(tileNum(u.position.x), tileNum(u.position.y)))
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
      if (!visited.has(nk) && isWalkable(nx, ny) && !occupied.has(nk)) {
        visited.add(nk);
        result.push({ x: nx, y: ny });
        queue.push({ x: nx, y: ny, rem: rem - 1 });
      }
    }
  }
  return result;
}

export function manhattan(a, b) {
  return Math.abs(num(a.x) - num(b.x)) + Math.abs(num(a.y) - num(b.y));
}

function itemChar(type) {
  if (type === 'medkit' || type === 'health-bonus') return '+';
  if (type.includes('armor')) return 'a';
  if (type.includes('shotgun')) return 's';
  if (type.includes('chaingun')) return 'c';
  if (type.includes('rocket')) return 'r';
  if (type.includes('plasma')) return 'p';
  return '$'; // ammo box
}

export function renderMap(state) {
  const { units, gameSpecific: { items } } = state;
  const posMap  = {};
  const itemMap = {};
  for (const u of units) if (u.alive) posMap[k(tileNum(u.position.x), tileNum(u.position.y))] = u;
  for (const it of items) if (!it.pickedUp) itemMap[k(it.x, it.y)] = it;

  const rows = [];
  for (let y = 0; y < MAP_HEIGHT; y++) {
    let row = `${String(y).padStart(2)} `;
    for (let x = 0; x < MAP_WIDTH; x++) {
      const kk = k(x, y);
      if (posMap[kk])  row += posMap[kk].attrs.symbol;
      else if (itemMap[kk]) row += itemChar(itemMap[kk].type);
      else             row += MAP_TILES[kk] === 'floor' ? '.' : '#';
    }
    rows.push(row);
  }
  rows.push('    ' + Array.from({ length: MAP_WIDTH }, (_, i) => i % 10).join(''));
  return rows.join('\n');
}
