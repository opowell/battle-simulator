import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Civ1Game } from './index.js';
import { getCombatStrengths } from './combat.js';
import { newCivState } from './economy.js';

// Flat grassland world with one city per owner; callers add buildings/units/wonders.
function world({ p1Buildings = ['palace'], p1Techs = [], units = [], cities = [] } = {}) {
  const width = 20, height = 12;
  const tiles = {};
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) tiles[`${x},${y}`] = { terrain: 'grassland' };
  const allCities = [
    { id: 'c1', name: 'Rome', ownerId: 'p1', position: { x: 3, y: 5 }, size: 2, food: 0, shields: 0, production: 'militia', buildings: p1Buildings },
    ...cities,
  ];
  return {
    gameName: 'Civ1', turnNumber: 1, activePlayers: ['p1'],
    players: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }],
    board: { width, height, tiles }, units,
    cities: allCities, lastActions: null,
    gameSpecific: {
      nextId: 100, fogOfWar: true,
      civ: { p1: { ...newCivState(), techs: p1Techs }, p2: newCivState() },
    },
  };
}

function unit(id, ownerId, type, x, y, extra = {}) {
  return { id, ownerId, type, position: { x, y }, alive: true, hp: 10, maxHp: 10, movesLeft: 1, attrs: {}, queue: [], ...extra };
}

function endTurn(state, pid) {
  return Civ1Game.applyActions(state, [{ playerId: pid, action: { type: 'end-turn', unitId: '__player__' } }]);
}

// ── City Walls / Great Wall (combat) ─────────────────────────────────────────

test('City Walls triple a land attacker-faced defence', () => {
  const attacker = unit('a', 'p2', 'legion', 3, 4);   // land attacker adjacent
  const defender = unit('d', 'p1', 'phalanx', 3, 5);  // in Rome
  const plain = world({ p1Buildings: ['palace'], units: [attacker, defender] });
  const walled = world({ p1Buildings: ['palace', 'city-walls'], units: [attacker, defender] });
  const dPlain = getCombatStrengths(attacker, defender, plain).def;
  const dWall = getCombatStrengths(attacker, defender, walled).def;
  assert.ok(Math.abs(dWall - dPlain * 3) < 1e-9, `walls should triple defence (${dPlain} -> ${dWall})`);
});

test('Great Wall acts as City Walls in every city', () => {
  const attacker = unit('a', 'p2', 'legion', 3, 4);
  const defender = unit('d', 'p1', 'phalanx', 3, 5);
  const gw = world({ p1Buildings: ['palace', 'great-wall'], units: [attacker, defender] });
  const plain = world({ p1Buildings: ['palace'], units: [attacker, defender] });
  assert.ok(getCombatStrengths(attacker, defender, gw).def > getCombatStrengths(attacker, defender, plain).def);
});

// ── Barracks veterans ────────────────────────────────────────────────────────

test('a city with Barracks builds veteran units', () => {
  let s = world({ p1Buildings: ['palace', 'barracks'] });
  s.cities[0].production = 'militia';
  s.cities[0].shields = 10; // == militia cost, completes this turn
  s = endTurn(s, 'p1');
  const fresh = s.units.find(u => u.ownerId === 'p1' && u.homeCityId === 'c1');
  assert.ok(fresh, 'a unit was produced');
  assert.equal(fresh.attrs.veteran, true);
});

// ── Magellan's Expedition ────────────────────────────────────────────────────

test("Magellan's Expedition gives ships +2 movement", () => {
  const ship = unit('s', 'p1', 'trireme', 3, 6, { movesLeft: 0 });
  let s = world({ p1Buildings: ['palace', 'magellan'], units: [ship] });
  s = endTurn(s, 'p2'); // ends p2 -> refreshes p1's units next
  const refreshed = s.units.find(u => u.id === 's');
  assert.equal(refreshed.movesLeft, 3 + 2);
});

// ── Marco Polo / Apollo fog ──────────────────────────────────────────────────

test("Marco Polo's Embassy reveals every rival city through the fog", () => {
  const farCity = { id: 'e1', name: 'London', ownerId: 'p2', position: { x: 18, y: 1 }, size: 1, food: 0, shields: 0, production: 'militia', buildings: [] };
  const without = world({ cities: [farCity] });
  const withMP = world({ p1Buildings: ['palace', 'marco-polo'], cities: [farCity] });
  assert.ok(!Civ1Game.getVisibleState(without, 'p1').cities.some(c => c.id === 'e1'));
  assert.ok(Civ1Game.getVisibleState(withMP, 'p1').cities.some(c => c.id === 'e1'));
});

test('Apollo Program lifts the fog entirely', () => {
  const farUnit = unit('e', 'p2', 'militia', 18, 1);
  const s = world({ p1Buildings: ['palace', 'apollo'], units: [farUnit] });
  assert.ok(Civ1Game.getVisibleState(s, 'p1').units.some(u => u.id === 'e'));
});

// ── Leonardo's Workshop ──────────────────────────────────────────────────────

test("Leonardo's Workshop upgrades an obsolete unit when the successor is known", () => {
  const old = unit('m', 'p1', 'militia', 4, 5);
  let s = world({ p1Buildings: ['palace', 'leonardo'], p1Techs: ['bronze-working'], units: [old] });
  s = endTurn(s, 'p1');
  const up = s.units.find(u => u.id === 'm');
  assert.equal(up.type, 'phalanx'); // militia -> phalanx (Bronze Working)
});
