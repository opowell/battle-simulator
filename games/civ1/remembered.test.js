// Ground out of sight is shown as it was last seen (Civ1Game's rememberUnseenChanges):
// the map is a picture of what you have seen, not a live feed of what rivals build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Civ1Game } from './index.js';

const players = () => [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];

function unit(id, ownerId, type, x, y, over = {}) {
  return {
    id, ownerId, type, position: { x, y }, alive: true,
    hp: 10, maxHp: 10, moveThirds: 3, attrs: {}, queue: [], ...over,
  };
}

// Flat grassland, fog on, both seats having explored the whole map (so what each one
// sees of a square comes down to whether it is in sight right now, or remembered).
function world(units, { exploredBy = { p1: true, p2: true } } = {}) {
  const state = Civ1Game.createInitialState(players(), {
    width: 20, height: 20, seed: 7, barbarians: 'villages-only', fogOfWar: true,
  });
  const tiles = {};
  for (const [k, t] of Object.entries(state.board.tiles)) tiles[k] = { ...t, terrain: 'grassland', hasRoad: false };
  const all = '1'.repeat(20 * 20), none = '0'.repeat(20 * 20);
  return {
    ...state, board: { ...state.board, tiles }, units, cities: [], activePlayers: ['p1'],
    gameSpecific: { ...state.gameSpecific,
      explored: { p1: exploredBy.p1 ? all : none, p2: exploredBy.p2 ? all : none } },
  };
}

const act = (state, playerId, action) =>
  Civ1Game.applyActions({ ...state, activePlayers: [playerId] }, [{ playerId, action }]);
const seenBy = (state, playerId, x, y) => Civ1Game.getVisibleState(state, playerId).board.tiles[`${x},${y}`];

test('remembered ground: a road laid out of your sight is not on your map', () => {
  let state = world([unit('s', 'p1', 'settlers', 5, 5), unit('w', 'p2', 'militia', 15, 15)]);
  state = act(state, 'p1', { type: 'build-road', unitId: 's' });
  assert.equal(state.board.tiles['5,5'].hasRoad, true);
  assert.equal(seenBy(state, 'p1', 5, 5).hasRoad, true, 'the builder sees it');
  assert.equal(seenBy(state, 'p2', 5, 5).hasRoad, false, 'the rival still has the bare square it last saw');
  assert.equal(seenBy(state, 'p2', 5, 5).terrain, 'grassland', 'remembered, not unknown');
});

test('remembered ground: walking up to the square shows what is there now', () => {
  let state = world([unit('s', 'p1', 'settlers', 5, 5), unit('w', 'p2', 'militia', 7, 5)]);
  state = act(state, 'p1', { type: 'build-road', unitId: 's' });
  assert.equal(seenBy(state, 'p2', 5, 5).hasRoad, false);
  state = act(state, 'p2', { type: 'move', unitId: 'w', from: { x: 7, y: 5 }, to: { x: 6, y: 5 } });
  assert.equal(seenBy(state, 'p2', 5, 5).hasRoad, true);
  assert.deepEqual(state.gameSpecific.remembered.p2, {}, 'nothing left to remember');
});

test('remembered ground: a road laid in plain sight shows at once', () => {
  let state = world([unit('s', 'p1', 'settlers', 5, 5), unit('w', 'p2', 'militia', 6, 5)]);
  state = act(state, 'p1', { type: 'build-road', unitId: 's' });
  assert.equal(seenBy(state, 'p2', 5, 5).hasRoad, true);
  assert.equal(state.gameSpecific.remembered?.p2?.['5,5'], undefined);
});

test('remembered ground: it is the LAST sight that is kept, not the latest change', () => {
  let state = world([unit('s', 'p1', 'settlers', 5, 5), unit('w', 'p2', 'militia', 15, 15)]);
  state = act(state, 'p1', { type: 'build-road', unitId: 's' });
  state = { ...state, units: state.units.map(u => u.id === 's' ? { ...u, moveThirds: 3 } : u) };
  state = act(state, 'p1', { type: 'irrigate', unitId: 's' });
  const p2 = seenBy(state, 'p2', 5, 5);
  assert.equal(p2.hasRoad, false);
  assert.ok(!p2.irrigated);
});

test('remembered ground: ground never explored stays unknown, with nothing remembered', () => {
  let state = world([unit('s', 'p1', 'settlers', 5, 5), unit('w', 'p2', 'militia', 15, 15)],
    { exploredBy: { p1: true, p2: false } });
  state = act(state, 'p1', { type: 'build-road', unitId: 's' });
  assert.equal(seenBy(state, 'p2', 5, 5).terrain, 'unknown');
  assert.equal(state.gameSpecific.remembered?.p2?.['5,5'], undefined);
});

test("remembered ground: a rival's memory is not in your observation", () => {
  let state = world([unit('s', 'p1', 'settlers', 5, 5), unit('w', 'p2', 'militia', 15, 15)]);
  state = act(state, 'p1', { type: 'build-road', unitId: 's' });
  const obs = Civ1Game.getVisibleState(state, 'p1');
  assert.equal(obs.gameSpecific.remembered?.p2, undefined);
});

test('remembered ground: the Siege opens with every improvement on it known to both sides', () => {
  const state = Civ1Game.createInitialState(players(), { scenario: 'siege', fogOfWar: true });
  const real = Object.entries(state.board.tiles);
  const improved = real.filter(([, t]) => t.hasRoad || t.irrigated || t.mined || t.fortress);
  assert.ok(improved.length > 10, 'the battlefield has roads, fields and forts');
  for (const pid of ['p1', 'p2']) {
    const known = Civ1Game.getVisibleState(state, pid).board.tiles;
    for (const [k, t] of improved) assert.deepEqual(known[k], t, `${pid} knows ${k}`);
  }
});
