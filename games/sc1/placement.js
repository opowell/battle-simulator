// Where a unit can be put down beside a structure without standing on it.
//
// A structure's rules occupy one square (its `position`), but it DRAWS much bigger: a
// command center's plate is 2.4 tokens across, about two squares, centred on the middle
// of its square (games/starcraftSprite.js's scBuildingSize / scBuildingHalfSide). A
// unit put down "on the next square" — which is how the opening and every finished
// unit used to be placed — therefore stood on the plate, drawn half inside the
// building. This module is the one place that knows that ground, and every way SC1
// puts a unit down goes through it: the opening (Sc1Game's createInitialState), a
// building's finished unit (processBuildingQueues), and a customised starting roster
// (Sc1Game's applyStartingUnits).
//
// Spots are found on square rings just outside the plate, each far enough out that the
// unit's own ring (scUnitRingR) clears it, nearest first to where the unit is headed:
// a worker toward the base's mineral field — between the base and its minerals, where
// StarCraft starts its workers — and anything else out of the base's open side.
//
// Positions are exact (games/coord.js): every spot is a whole number of twentieths
// of a square, built as a BigNumber, never float arithmetic.

import { TERRAIN } from './terrain.js';
import { UNITS, UNIT_PX } from './units.js';
import { BUILDINGS } from './buildings.js';
import { scBuildingHalfSide, scUnitRingR, TOKEN_R } from '../starcraftSprite.js';
import { C, num, tileNum } from '../coord.js';

const Q = 20;          // spots are on a 1/20-square lattice
const STEP = 6;        // between candidate spots along a ring: 0.3 squares
const SEP = 12;        // between two units' centres: 0.6 squares, so two worker rings don't touch
const GAP = 0.01;      // daylight between a unit's ring and the plate
const RINGS = 5;       // rings tried before giving up (a base walled in by its own army)
const MINERAL_REACH = 4;

/** The square a structure covers on the map: its centre and half its side, in squares. */
export function footprint(b) {
  return {
    cx: num(b.position.x) + 0.5,
    cy: num(b.position.y) + 0.5,
    half: scBuildingHalfSide(BUILDINGS[b.type] ?? {}),
  };
}

/** The radius of ground a unit covers (its team ring), in squares. */
export function ringR(unit) {
  const def = UNITS[unit.type];
  return def ? scUnitRingR(def, UNIT_PX[unit.type]) : TOKEN_R;
}

/** Whether a unit of radius `r` at (x, y) overlaps structure `b`'s plate. */
export function onFootprint(x, y, r, b) {
  const f = footprint(b);
  return Math.abs(x - f.cx) < f.half + r && Math.abs(y - f.cy) < f.half + r;
}

/** The living structure `unit` stands on, or null. */
export function footprintUnder(unit, buildings) {
  const x = num(unit.position.x), y = num(unit.position.y), r = ringR(unit);
  return buildings.find(b => b.alive && onFootprint(x, y, r, b)) ?? null;
}

// The middle of the mineral patches round a structure, or null if it has none nearby.
function mineralsNear(board, b) {
  let sx = 0, sy = 0, n = 0;
  for (let dy = -MINERAL_REACH; dy <= MINERAL_REACH; dy++) {
    for (let dx = -MINERAL_REACH; dx <= MINERAL_REACH; dx++) {
      const x = b.position.x + dx, y = b.position.y + dy;
      if (TERRAIN[board.tiles[`${x},${y}`]?.terrain]?.resource !== 'minerals') continue;
      sx += x + 0.5; sy += y + 0.5; n++;
    }
  }
  return n ? { x: sx / n, y: sy / n } : null;
}

/**
 * Where a unit put down beside `b` heads for: a worker for the minerals, anything else
 * out the other way — the base's open side. Null (the map's middle) for a structure
 * with no minerals round it.
 */
export function aimFor(board, b, unit) {
  const m = mineralsNear(board, b);
  if (!m) return null;
  if (UNITS[unit.type]?.special.includes('worker')) return m;
  const f = footprint(b);
  return { x: 2 * f.cx - m.x, y: 2 * f.cy - m.y };
}

/**
 * The best free spot for `unit` beside structure `b`, or null when there is none.
 * Free means: on ground the unit can stand on, off every structure's plate, and at
 * least SEP from every unit in `units`. `aim` orders the candidates (default
 * aimFor); the unit's own current position is never in the way of itself.
 */
export function spotBeside({ board, units, buildings }, b, unit, aim = aimFor(board, b, unit)) {
  const f = footprint(b);
  const r = ringR(unit);
  const domain = unit.domain ?? UNITS[unit.type]?.domain ?? 'ground';
  const to = aim ?? { x: board.width / 2, y: board.height / 2 };
  const cx = Math.round(f.cx * Q), cy = Math.round(f.cy * Q);
  const others = units.filter(u => u.alive !== false && u.id !== unit.id)
    .map(u => [num(u.position.x) * Q, num(u.position.y) * Q]);
  const first = Math.ceil((f.half + r + GAP) * Q);

  for (let ring = 0; ring < RINGS; ring++) {
    const d = first + ring * SEP;
    const n = Math.floor(d / STEP);
    const seen = new Set();
    const cands = [];
    for (let j = -n; j <= n; j++) {
      for (const [dx, dy] of [[d, j * STEP], [-d, j * STEP], [j * STEP, d], [j * STEP, -d]]) {
        const key = `${dx},${dy}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const x = (cx + dx) / Q, y = (cy + dy) / Q;
        cands.push({ x20: cx + dx, y20: cy + dy, dist: Math.hypot(x - to.x, y - to.y) });
      }
    }
    cands.sort((a, b2) => (a.dist - b2.dist) || (a.y20 - b2.y20) || (a.x20 - b2.x20));
    for (const { x20, y20 } of cands) {
      const x = x20 / Q, y = y20 / Q;
      if (x < 0 || y < 0 || x >= board.width || y >= board.height) continue;
      const td = TERRAIN[board.tiles[`${tileNum(x)},${tileNum(y)}`]?.terrain];
      if (!td?.passable[domain === 'air' ? 'air' : 'ground']) continue;
      if (buildings.some(o => o.alive && onFootprint(x, y, r, o))) continue;
      // (less a hair: a neighbour read back through num() can be a float ulp off its lattice point)
      if (others.some(([ox, oy]) => Math.hypot(ox - x20, oy - y20) < SEP - 1e-6)) continue;
      return { x: C(x20).div(Q), y: C(y20).div(Q) };
    }
  }
  return null;
}
