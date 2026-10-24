import { test } from 'node:test';
import assert from 'node:assert/strict';
// boardMoves.js is a classic browser global (no ESM export, so vue3-sfc-loader can
// load it); importing it for its side effect publishes the API on globalThis.MOVES.
await import('./boardMoves.js');
const { movedTokens, enteredFixtures, fixtureAt, newBattles } = globalThis.MOVES;

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

// civ1's logArrivals: a piece that walked out of the fog says where it stepped in from,
// so it is seen to walk in rather than appear beside you.
test('a unit that walked into sight hops from where the board says it came from', () => {
  const before = grid([cell(1, 1), cell(2, 1)], { arrivals: [{ id: 4, unitId: 'old', from: { x: 0, y: 0 } }] });
  const after  = grid([cell(1, 1), cell(2, 1, 'u1')], { arrivals: [
    { id: 4, unitId: 'old', from: { x: 0, y: 0 } },
    { id: 5, unitId: 'u1', from: { x: 5, y: 1 } },
    { id: 6, unitId: 'u1', from: { x: 4, y: 1 } },
  ] });
  // The latest arrival wins: it is the step that brought the unit into view last.
  assert.deepEqual(movedTokens(before, after).get('u1'), { from: { x: 4, y: 1 }, to: { x: 2, y: 1 } });
  // One the last board already had is old news.
  const again = grid([cell(1, 1), cell(2, 1, 'old')], { arrivals: before.arrivals });
  assert.equal(movedTokens(before, again).size, 0);
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

// ── enteredFixtures / fixtureAt ────────────────────────────────────────────────
// The walk movedTokens leaves out: a unit stepping into a city (taking it, say) is
// still played, by a stand-in drawn as the old board drew the unit.
test('a unit stepping into a fixture square is an entry, carrying how it was drawn', () => {
  const legion = { ...cell(1, 1, 'u1'), imagePath: 'units/legion', owner: 1 };
  const before = grid([legion,     { ...cell(2, 1, null, true), owner: 2 }]);
  const after  = grid([cell(1, 1), { ...cell(2, 1, 'u1', true), owner: 1 }]);
  const e = enteredFixtures(before, after).get('u1');
  assert.deepEqual([e.from, e.to], [{ x: 1, y: 1 }, { x: 2, y: 1 }]);
  assert.equal(e.token, legion);
});

test('a garrison moving from one fixture into another has no stand-in to walk', () => {
  const before = grid([cell(1, 1, 'u1', true), cell(2, 1, null, true)]);
  const after  = grid([cell(1, 1, null, true), cell(2, 1, 'u1', true)]);
  assert.equal(enteredFixtures(before, after).size, 0);
});

test('an ordinary move and a piece staying in its fixture are not entries', () => {
  const before = grid([cell(1, 1, 'u1'), cell(2, 1), cell(3, 1, 'u2', true)]);
  const after  = grid([cell(1, 1), cell(2, 1, 'u1'), cell(3, 1, 'u2', true)]);
  assert.equal(enteredFixtures(before, after).size, 0);
});

test('a piece entering a fixture from under a stack is found through the stack', () => {
  const before = grid([{ ...cell(1, 1, 'u2'), stack: [{ unitId: 'u1', imagePath: 'units/settlers' }] }, cell(2, 1, null, true)]);
  const after  = grid([cell(1, 1, 'u2'), cell(2, 1, 'u1', true)]);
  assert.equal(enteredFixtures(before, after).get('u1')?.token.imagePath, 'units/settlers');
});

test('fixtureAt finds the square\'s fixture, on the cell or riding in its stack', () => {
  const city = { unitId: 'u_2_1', fixture: true, owner: 2 };
  const board = grid([cell(1, 1, 'u1'), { ...cell(2, 1, 'u3'), stack: [city] }, { ...cell(3, 1, 'u4', true), owner: 1 }]);
  assert.equal(fixtureAt(board, 1, 1), null);
  assert.equal(fixtureAt(board, 2, 1), city);
  assert.equal(fixtureAt(board, 3, 1).owner, 1);
  assert.equal(fixtureAt(board, 9, 9), null);
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

// ── newBattles ─────────────────────────────────────────────────────────────────
// A game's running record of recent fights (toGrid `battles`), numbered upward.
const fight = (id) => ({ id, from: { x: 0, y: 0 }, at: { x: 1, y: 0 }, won: true });
const ids = (list) => list.map(b => b.id);

test('newBattles: the fights numbered past the last board, oldest first', () => {
  const before = grid([], { battles: [fight(1), fight(2)] });
  const after  = grid([], { battles: [fight(4), fight(2), fight(3)] });
  assert.deepEqual(ids(newBattles(before, after)), [3, 4]);
});

test('newBattles: a board that had no record yet makes everything new', () => {
  assert.deepEqual(ids(newBattles(grid([]), grid([], { battles: [fight(1)] }))), [1]);
  assert.deepEqual(newBattles(grid([]), grid([])), []);
});

// Under fog a viewer is only handed the fights they witnessed, judged on the board in
// front of them — so an old fight can turn up in the record when a unit walks into
// sight of where it happened. That is not a fight happening now.
test('newBattles: an old fight that has only now come into view is not replayed', () => {
  const before = grid([], { battles: [fight(5)] });
  const after  = grid([], { battles: [fight(3), fight(5), fight(6)] });
  assert.deepEqual(ids(newBattles(before, after)), [6]);
});

// A take-back rewinds the record along with everything else; the board after it
// must still animate the next real fight rather than wait for the old numbering.
test('newBattles: after a rewind, numbering is judged against the rewound board', () => {
  const rewound = grid([], { battles: [fight(1)] });
  const replayed = grid([], { battles: [fight(1), fight(2)] });
  assert.deepEqual(ids(newBattles(rewound, replayed)), [2]);
});
