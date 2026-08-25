import { test } from 'node:test';
import assert from 'node:assert/strict';
// boardMoves.js is a classic browser global (no ESM export, so vue3-sfc-loader can
// load it); importing it for its side effect publishes the API on globalThis.MOVES.
await import('./boardMoves.js');
const { movedTokens } = globalThis.MOVES;

// A square-grid board: cells laid out row by row, each `{ x, y, unitId?, fixture? }`.
const grid = (cells, extra = {}) => ({ cells, ...extra });
const cell = (x, y, unitId = null, fixture = undefined) => ({ x, y, unitId, fixture });

test('a unit that changed square hops from where it was to where it is', () => {
  const before = grid([cell(1, 1, 'u1'), cell(2, 1)]);
  const after  = grid([cell(1, 1),       cell(2, 1, 'u1')]);
  assert.deepEqual(movedTokens(before, after).get('u1'),
    { from: { x: 1, y: 1 }, to: { x: 2, y: 1 } });
});

test('a unit that stayed put is not a move', () => {
  const board = grid([cell(1, 1, 'u1')]);
  assert.equal(movedTokens(board, board).size, 0);
});

test('a unit that only just appeared has nowhere to hop from', () => {
  const before = grid([cell(1, 1), cell(2, 1)]);
  const after  = grid([cell(1, 1), cell(2, 1, 'u1')]);
  assert.equal(movedTokens(before, after).size, 0);
});

// The bug this file exists for: a civ1 city square draws the CITY and carries its
// GARRISON's unitId (see Civ1Game.toGrid), so animating "u1 moved to the city square"
// slides the city sprite, its size badge and its name plaque over to meet the unit —
// and for a hop queued behind others in a bundled AI turn, the city sits a square off
// its own tile for the whole bundle. Cities do not move.
test('a unit stepping into a fixture square moves no token', () => {
  const before = grid([cell(1, 1, 'u1'), cell(2, 1, null, true)]);
  const after  = grid([cell(1, 1),       cell(2, 1, 'u1', true)]);
  assert.equal(movedTokens(before, after).size, 0);
});

test('a unit stepping OUT of a fixture square still hops — the fixture stays behind', () => {
  const before = grid([cell(1, 1, 'u1', true), cell(2, 1)]);
  const after  = grid([cell(1, 1, null, true), cell(2, 1, 'u1')]);
  assert.deepEqual(movedTokens(before, after).get('u1'),
    { from: { x: 1, y: 1 }, to: { x: 2, y: 1 } });
});

// Continuous-location games (cs/doom/combatmission) carry positions in a parallel
// `grid.units` channel of real points rather than in the cells.
test('continuous boards read the parallel units channel', () => {
  const before = { locationType: 'continuous', cells: [], units: [{ id: 'u1', x: '1.5', y: '2.0' }] };
  const after  = { locationType: 'continuous', cells: [], units: [{ id: 'u1', x: '4.25', y: '2.0' }] };
  assert.deepEqual(movedTokens(before, after).get('u1'),
    { from: { x: 1.5, y: 2 }, to: { x: 4.25, y: 2 } });
  assert.equal(movedTokens(before, before).size, 0);
});
