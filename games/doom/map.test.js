import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DoomGame } from './index.js';
import { MAP_WIDTH as W, MAP_HEIGHT as H, MAP_TILES, FLOOR_SHAPES, DECOR_SHAPES, RENDER_SHAPES } from './map.js';
import { forEachCell } from '../terrainShapes.js';
import { num } from '../coord.js';

const k = (x, y) => `${x},${y}`;
const floorCells = new Set();
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (MAP_TILES[k(x, y)] === 'floor') floorCells.add(k(x, y));

test('doom map: E1M1 has >100 terrain objects (the high-quality bar)', () => {
  // FLOOR_SHAPES + DECOR_SHAPES (the authored/cell-classified geometry) is the real
  // richness bar. RENDER_SHAPES is intentionally smaller: it groups contiguous same-kind
  // decor into one polygon per region (tilesToPolygons) instead of drawing each maximal
  // rect separately, so touching props read as one panel with no seam between them.
  assert.ok(FLOOR_SHAPES.length + DECOR_SHAPES.length > 100,
    `expected >100 authored objects, got ${FLOOR_SHAPES.length + DECOR_SHAPES.length}`);
  assert.ok(FLOOR_SHAPES.length >= 20, 'a detailed multi-room floorplan');
  assert.ok(DECOR_SHAPES.length >= 40, 'plenty of props');
  assert.ok(RENDER_SHAPES.length > 0, 'renders something');
});

test('doom map: every DECOR prop sits on a wall cell (never overlaps the floor union)', () => {
  // This is what keeps props impassable AND sight-blocking with zero LOS special-casing:
  // a prop cell that isn't floor is part of the wall complement for both the engine's
  // segmentInUnion and the design-UI veil (openShapes = FLOOR).
  for (const s of DECOR_SHAPES)
    forEachCell(s, W, H, (x, y) =>
      assert.ok(!floorCells.has(k(x, y)), `decor overlaps floor at ${x},${y}`));
});

test('doom map: every unit & item spawns on a reachable floor tile', () => {
  const state = DoomGame.createInitialState(
    [{ id: 'p1', name: 'Marine' }, { id: 'p2', name: 'Demons' }], {});
  const cellOf = p => k(Math.floor(num(p.x)), Math.floor(num(p.y)));

  // Flood-fill reachable floor from the marine's spawn.
  const marine = state.units.find(u => u.ownerId === 'marine');
  const start = cellOf(marine.position);
  const seen = new Set([start]);
  const q = [start.split(',').map(Number)];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nk = k(x + dx, y + dy);
      if (!seen.has(nk) && floorCells.has(nk)) { seen.add(nk); q.push([x + dx, y + dy]); }
    }
  }

  for (const u of state.units) {
    const c = cellOf(u.position);
    assert.ok(floorCells.has(c), `unit ${u.id} spawned off floor at ${c}`);
    assert.ok(seen.has(c), `unit ${u.id} spawned on an unreachable island at ${c}`);
  }
  for (const it of state.gameSpecific.items) {
    const c = k(it.x, it.y);
    assert.ok(floorCells.has(c), `item ${it.id} (${it.type}) off floor at ${c}`);
    assert.ok(seen.has(c), `item ${it.id} (${it.type}) on an unreachable island at ${c}`);
  }
});
