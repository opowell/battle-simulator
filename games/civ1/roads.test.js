// Roads speed a unit ALONG them: the third-of-a-move step is only had when the square
// being left has a road too (a city square counts as one), as in the original. And a
// move that lands several squares away pays for the way it walked, step by step — so
// the discount cannot be had by landing on a road from open ground in one jump.
// Hand-built flat grassland, with roads only where each test lays them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Civ1Game } from './index.js';
import { getReachableTiles, thirdsLeftAt } from './map.js';

const players = () => [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];

function unit(id, type, x, y, moveThirds) {
  return { id, ownerId: 'p1', type, position: { x, y }, alive: true, hp: 10, maxHp: 10, moveThirds, attrs: {}, queue: [] };
}

// `roads` / `rails`: "x,y" keys. Everything else is bare grassland (one move a step).
function world(units, { roads = [], rails = [], cities = [] } = {}) {
  const state = Civ1Game.createInitialState(players(), {
    width: 20, height: 20, seed: 7, barbarians: 'villages-only', fogOfWar: false,
  });
  const tiles = {};
  for (const [k, t] of Object.entries(state.board.tiles)) {
    tiles[k] = { ...t, terrain: 'grassland', hasRiver: false, fortress: false,
      hasRoad: roads.includes(k) || rails.includes(k), hasRail: rails.includes(k) };
  }
  return { ...state, board: { ...state.board, tiles }, units, cities, activePlayers: ['p1'] };
}

const left = (s, u, x, y) => thirdsLeftAt(u, { x, y }, s.board, s.units, 'p1', s.cities);
const reach = (s, u) => new Set(getReachableTiles(u, s.board, s.units, 'p1', s.cities).map(t => `${t.x},${t.y}`));

test('civ1 roads: stepping onto a road from open ground pays the terrain', () => {
  const m = unit('m', 'militia', 5, 5, 3);
  const s = world([m], { roads: ['6,5', '7,5', '8,5'] });
  assert.equal(left(s, m, 6, 5), 0, 'a whole move onto the road, not a third');
  assert.equal(reach(s, m).has('7,5'), false, 'and nothing left to go on along it');
});

test('civ1 roads: a road step costs a third only with a road at both ends', () => {
  const m = unit('m', 'militia', 5, 5, 3);
  const s = world([m], { roads: ['5,5', '6,5', '7,5', '8,5'] });
  assert.equal(left(s, m, 6, 5), 2);
  assert.equal(left(s, m, 8, 5), 0, 'three road steps off one move');
  assert.equal(left(s, m, 6, 6), 0, 'stepping off the road onto open ground pays the terrain');
});

test('civ1 roads: a railroad is free only with rail at both ends', () => {
  const m = unit('m', 'militia', 5, 5, 3);
  const s = world([m], { rails: ['5,5', '6,5', '7,5'], roads: ['8,5'] });
  assert.equal(left(s, m, 7, 5), 3, 'rail to rail costs nothing');
  assert.equal(left(s, m, 8, 5), 2, 'rail to plain road is a road step');
  const off = unit('o', 'militia', 5, 6, 3);
  assert.equal(left(world([off], { rails: ['6,6'] }), off, 6, 6), 0, 'onto rail from open ground pays the terrain');
});

test('civ1 roads: a city square is a road end', () => {
  const m = unit('m', 'militia', 6, 5, 3);
  const city = { id: 'c', name: 'C', ownerId: 'p1', position: { x: 7, y: 5 }, size: 1, buildings: [] };
  const s = world([m], { roads: ['6,5', '8,5'], cities: [city] });
  assert.equal(left(s, m, 7, 5), 2, 'road into the city');
  assert.equal(left(s, m, 8, 5), 1, 'and out the other side');
  const bare = world([m], { roads: ['6,5', '8,5'] });
  assert.equal(left(bare, m, 7, 5), 0, 'the same square with no city is open ground');
});

test('civ1 roads: a move of several squares pays for the way it walked', () => {
  const k = unit('k', 'knights', 5, 5, 6);
  const s = world([k], { roads: ['7,5'] });
  const after = Civ1Game.applyActions(s, [{ playerId: 'p1', action: { type: 'move', unitId: 'k', from: k.position, to: { x: 7, y: 5 } } }]);
  const moved = after.units.find(u => u.id === 'k');
  assert.deepEqual(moved.position, { x: 7, y: 5 });
  assert.equal(moved.moveThirds, 0, 'two open-ground steps spend both moves, landing on a road or not');
});
