import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Civ1Game } from './index.js';
import { computeCity } from './city.js';
import { buildOwnerCtx, newCivState } from './economy.js';

const seats = n => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
const newGame = (n, config = {}) =>
  Civ1Game.createInitialState(seats(n), { width: 40, height: 24, seed: 11, ...config });

// ── Every seat is actually seeded ────────────────────────────────────────────

test('multiplayer: every civ starts with a settler and a militia', () => {
  for (const n of [2, 3, 4]) {
    const state = newGame(n);
    for (const p of state.players) {
      const mine = state.units.filter(u => u.ownerId === p.id);
      assert.equal(mine.filter(u => u.type === 'settlers').length, 1, `${p.id} has no settler in a ${n}-player game`);
      assert.equal(mine.filter(u => u.type === 'militia').length, 1, `${p.id} has no militia in a ${n}-player game`);
    }
  }
});

// The whole game used to be over before the first move: createInitialState seeded
// only players[0] and players[1], so seats 3 and 4 owned nothing and getResult
// immediately reported them destroyed.
test('multiplayer: a fresh 4-player game is not already over', () => {
  assert.equal(Civ1Game.getResult(newGame(4)), null);
});

test('multiplayer: civs start apart from one another', () => {
  const state = newGame(4);
  const starts = state.players.map(p => state.units.find(u => u.ownerId === p.id).position);
  for (let i = 0; i < starts.length; i++) {
    for (let j = i + 1; j < starts.length; j++) {
      const dx = Math.abs(starts[i].x - starts[j].x);
      assert.ok(Math.min(dx, 40 - dx) > 2 || Math.abs(starts[i].y - starts[j].y) > 2,
        `civs ${i + 1} and ${j + 1} start on top of each other`);
    }
  }
});

// ── Elimination ends the game only when one civ is left ──────────────────────

const stripped = (state, pids) => ({
  ...state,
  units: state.units.filter(u => !pids.includes(u.ownerId)),
  cities: state.cities.filter(c => !pids.includes(c.ownerId)),
});

test('multiplayer: eliminating one of four civs does not end the game', () => {
  const state = newGame(4);
  assert.equal(Civ1Game.getResult(stripped(state, ['p2'])), null);
  assert.equal(Civ1Game.getResult(stripped(state, ['p2', 'p3'])), null);
});

test('multiplayer: the last civ standing wins', () => {
  const state = newGame(4);
  const r = Civ1Game.getResult(stripped(state, ['p2', 'p3', 'p4']));
  assert.equal(r?.outcome, 'win');
  assert.equal(r.winnerId, 'p1');
  assert.equal(r.reason, 'civilization-destroyed');
});

test('multiplayer: wiping everyone out is a draw, not a win for seat 1', () => {
  const state = newGame(4);
  const r = Civ1Game.getResult(stripped(state, ['p1', 'p2', 'p3', 'p4']));
  assert.equal(r?.outcome, 'draw');
});

test('multiplayer: the turn rotation skips an eliminated civ', () => {
  const state = { ...stripped(newGame(4), ['p2']), activePlayers: ['p1'] };
  const next = Civ1Game.applyActions(state, [{ playerId: 'p1', action: { type: 'end-turn', unitId: '__player__' } }]);
  assert.deepEqual(next.activePlayers, ['p3'], 'play passed to the eliminated civ instead of skipping it');
});

test('multiplayer: the turn counter still advances when seat 1 is gone', () => {
  const state = { ...stripped(newGame(4), ['p1']), activePlayers: ['p4'] };
  const next = Civ1Game.applyActions(state, [{ playerId: 'p4', action: { type: 'end-turn', unitId: '__player__' } }]);
  assert.deepEqual(next.activePlayers, ['p2']);
  assert.equal(next.turnNumber, state.turnNumber + 1, 'wrapping past a dead seat 1 stalled the clock');
});

// ── The city centre's free road and irrigation ───────────────────────────────

// Food upkeep is size * 2. Without the centre square's free irrigation a size-1 city
// on ordinary ground nets exactly zero surplus, never grows, and therefore never
// works more squares or raises its shield output — inert from turn 2 to turn 150.
function cityOn(terrain) {
  const width = 10, height = 10, tiles = {};
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) tiles[`${x},${y}`] = { terrain };
  const state = {
    gameName: 'Civ1', turnNumber: 1, activePlayers: ['p1'], players: seats(2),
    board: { width, height, tiles }, units: [],
    cities: [{ id: 'c1', name: 'Rome', ownerId: 'p1', position: { x: 5, y: 5 }, size: 1, food: 0, shields: 0, production: 'militia', buildings: ['palace'] }],
    lastActions: null,
    gameSpecific: { nextId: 0, fogOfWar: false, civ: { p1: newCivState(), p2: newCivState() } },
  };
  return computeCity(state.cities[0], buildOwnerCtx(state, 'p1'), state);
}

test('city centre: a size-1 city on plains can actually grow', () => {
  assert.ok(cityOn('plains').foodSurplus > 0, 'a plains capital nets no food and is inert forever');
});

test('city centre: a size-1 city on tundra can actually grow', () => {
  assert.ok(cityOn('tundra').foodSurplus > 0, 'a tundra capital nets no food and is inert forever');
});

test('city centre: the free road puts trade on a square that would have none', () => {
  assert.ok(cityOn('plains').trade > 0, 'the city centre is missing its free road');
});

test('city centre: land that irrigation cannot help is still not inert', () => {
  // Forest takes no irrigation, but the centre's minimum-1 rule still applies.
  assert.ok(cityOn('forest').shields >= 1);
});
