import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Civ1Game } from './index.js';
import { mintId, takenIds } from './ids.js';

const players = () => [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];
const newGame = (config = {}) =>
  Civ1Game.createInitialState(players(), { width: 30, height: 20, seed: 7, fogOfWar: true, ...config });

test('mintId steps over names already in use', () => {
  const taken = new Set(['u3', 'u4', 'u6']);
  assert.deepEqual(mintId('u', 3, taken), { id: 'u5', next: 6 });
  assert.deepEqual(mintId('u', 7, taken), { id: 'u7', next: 8 });
  assert.deepEqual(mintId('city-', 0, new Set()), { id: 'city-0', next: 1 });
});

test('takenIds counts the fallen too', () => {
  const taken = takenIds([{ id: 'u1', alive: true }, { id: 'u2', alive: false }], [{ id: 'city-0' }]);
  // A dead unit keeps its name: the log and the belief tracker both still use it.
  assert.deepEqual([...taken].sort(), ['city-0', 'u1', 'u2']);
});

test('a city founded in a sampled world cannot steal a remembered enemy id', () => {
  // The belief sampler fills its worlds with remembered enemies under their REAL
  // ids, which sit above the counter the observation carries. Founding must not
  // hand the new city one of those names.
  const state = newGame();
  const settler = state.units.find(u => u.ownerId === 'p1' && u.type === 'settlers');
  const world = {
    ...state,
    gameSpecific: { ...state.gameSpecific, nextId: 0 },   // the observation's low floor
    cities: [{ id: 'city-0', ownerId: 'p2', name: 'Phantom', position: { x: 20, y: 10 },
               size: 2, shields: 0, food: 0, production: 'militia', buildings: [] }],
  };
  const after = Civ1Game.applyActions(world, [{ playerId: 'p1', action: { type: 'found-city', unitId: settler.id } }]);
  const ids = after.cities.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length, 'no two cities share a name');
  assert.ok(ids.includes('city-0'), 'the remembered one is still there');
});

test('the observation hands out an id counter of its own', () => {
  const state = newGame();
  const view = Civ1Game.getVisibleState(state, 'p1');
  // Every id in view must be below it, or the next mint would collide.
  for (const u of view.units) {
    const n = Number.parseInt(u.id.replace(/^\D+/, ''), 10);
    assert.ok(n < view.gameSpecific.nextId, `${u.id} is not below the counter`);
  }
});
