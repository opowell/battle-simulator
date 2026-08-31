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

// ── Losing the last city ends the civilization ───────────────────────────────
//
// The original's rule, and the one the engine now enforces: your empire is your
// cities. An army still in the field does not keep a cityless civ alive — but the
// opening does not count, since on turn 1 nobody has founded anything yet.

// Give `pids` a city each and mark them as having held one, the way markCityHolders
// does the moment a city is founded or taken.
const withCities = (state, pids) => ({
  ...state,
  cities: pids.map((pid, i) => ({
    id: `c-${pid}`, name: `City ${i}`, ownerId: pid,
    position: { x: 2 + i * 5, y: 2 }, size: 1, shields: 0, food: 0,
    production: 'militia', buildings: ['palace'],
  })),
  gameSpecific: {
    ...state.gameSpecific,
    civ: Object.fromEntries(Object.entries(state.gameSpecific.civ)
      .map(([pid, c]) => [pid, pids.includes(pid) ? { ...c, hadCity: true } : c])),
  },
});

test('elimination: a civ that has never founded a city is not destroyed', () => {
  const state = newGame(2);
  assert.equal(state.cities.length, 0, 'the opening really does start city-less');
  assert.equal(Civ1Game.getResult(state), null);
});

test('elimination: losing your last city destroys the civ even with units in the field', () => {
  const state = withCities(newGame(2), ['p1', 'p2']);
  // p2 is sacked. Its settler and militia are untouched and still on the map.
  const sacked = { ...state, cities: state.cities.filter(c => c.ownerId !== 'p2') };
  assert.ok(sacked.units.some(u => u.alive && u.ownerId === 'p2'), 'p2 still has an army');
  const r = Civ1Game.getResult(sacked);
  assert.equal(r?.outcome, 'win');
  assert.equal(r.winnerId, 'p1');
  assert.equal(r.reason, 'civilization-destroyed');
});

test('elimination: the units of a destroyed civ are taken off the board', () => {
  const state = { ...withCities(newGame(3), ['p1', 'p2', 'p3']), activePlayers: ['p1'] };
  const sacked = { ...state, cities: state.cities.filter(c => c.ownerId !== 'p2') };
  const next = Civ1Game.applyActions(sacked, [{ playerId: 'p1', action: { type: 'end-turn', unitId: '__player__' } }]);
  assert.equal(next.units.filter(u => u.alive && u.ownerId === 'p2').length, 0,
    "a destroyed civ's army stayed on the map");
  assert.ok(next.units.some(u => u.alive && u.ownerId === 'p3'), 'the living civs were left alone');
});

test('elimination: the rotation skips a civ that has lost its last city', () => {
  const state = { ...withCities(newGame(3), ['p1', 'p2', 'p3']), activePlayers: ['p1'] };
  const sacked = { ...state, cities: state.cities.filter(c => c.ownerId !== 'p2') };
  const next = Civ1Game.applyActions(sacked, [{ playerId: 'p1', action: { type: 'end-turn', unitId: '__player__' } }]);
  assert.deepEqual(next.activePlayers, ['p3']);
});

test('elimination: three civs holding cities, one sacked — the game goes on', () => {
  const state = withCities(newGame(3), ['p1', 'p2', 'p3']);
  assert.equal(Civ1Game.getResult({ ...state, cities: state.cities.filter(c => c.ownerId !== 'p2') }), null);
});

test('elimination: founding a city is what arms the rule', () => {
  const state = newGame(2);
  const found = Civ1Game.getLegalActions(state, 'p1').find(a => a.type === 'found-city');
  assert.ok(found, 'p1 cannot found a city on its start square');
  const next = Civ1Game.applyActions(state, [{ playerId: 'p1', action: found }]);
  assert.equal(next.gameSpecific.civ.p1.hadCity, true);
  assert.equal(next.gameSpecific.civ.p2.hadCity, false, 'p2 has founded nothing');
  // Razing that one city now ends p1, even though its militia is still standing.
  const razed = { ...next, cities: [] };
  assert.equal(Civ1Game.getResult(razed)?.winnerId, 'p2');
});

// An observation hides a rival's cities, so isCivAlive must not read "no cities" off
// one and pronounce a rival destroyed while its army stands in plain view. What stops
// it is getVisibleState blanking the rival's ledger, hadCity included — in a view a
// rival is only ever counted out the old way, by having nothing visible left at all.
test('elimination: a rival whose cities are merely out of sight is not counted out', () => {
  const state = withCities(newGame(2, { fogOfWar: true }), ['p1', 'p2']);
  // Walk a p2 militia up next to a p1 unit so it is inside p1's vision, while p2's
  // city stays far away in the dark.
  const eye = state.units.find(u => u.ownerId === 'p1');
  const scout = state.units.find(u => u.ownerId === 'p2' && u.type === 'militia');
  const seen = {
    ...state,
    units: state.units.map(u => u.id === scout.id
      ? { ...u, position: { x: eye.position.x + 1, y: eye.position.y } } : u),
  };
  const view = Civ1Game.getVisibleState(seen, 'p1');
  assert.equal(view.cities.filter(c => c.ownerId === 'p2').length, 0, "p2's city is hidden");
  assert.ok(view.units.some(u => u.alive && u.ownerId === 'p2'), "p2's scout is in plain sight");
  assert.equal(Civ1Game.getResult(view), null, 'the fog handed p1 a win it had not won');
});
