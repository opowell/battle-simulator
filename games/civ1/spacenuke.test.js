import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Civ1Game } from './index.js';
import { buildableForCity, newCivState } from './economy.js';

function baseState({ p1Buildings = ['palace'], p1Techs = [], p1Spaceship, units = [], cities = [] } = {}) {
  const width = 20, height = 12;
  const tiles = {};
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) tiles[`${x},${y}`] = { terrain: 'grassland' };
  const civP1 = { ...newCivState(), techs: p1Techs };
  if (p1Spaceship) civP1.spaceship = { ...civP1.spaceship, ...p1Spaceship };
  return {
    gameName: 'Civ1', turnNumber: 5, activePlayers: ['p1'],
    players: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }],
    board: { width, height, tiles }, units,
    cities: [
      { id: 'c1', name: 'Rome', ownerId: 'p1', position: { x: 5, y: 5 }, size: 4, food: 0, shields: 0, production: 'militia', buildings: p1Buildings },
      ...cities,
    ],
    lastActions: null,
    gameSpecific: { nextId: 100, fogOfWar: false, civ: { p1: civP1, p2: newCivState() } },
  };
}

const unit = (id, ownerId, type, x, y, extra = {}) =>
  ({ id, ownerId, type, position: { x, y }, alive: true, hp: 10, maxHp: 10, movesLeft: 1, attrs: {}, queue: [], ...extra });

const apply = (s, pid, action) => Civ1Game.applyActions(s, [{ playerId: pid, action }]);

// ── Nuclear ──────────────────────────────────────────────────────────────────

test('nuclear: buildable only with Rocketry known AND the Manhattan Project built', () => {
  const noMan = baseState({ p1Techs: ['rocketry'] });
  assert.ok(!buildableForCity(noMan, noMan.cities[0]).includes('nuclear'));
  const withMan = baseState({ p1Buildings: ['palace', 'manhattan'], p1Techs: ['rocketry'] });
  assert.ok(buildableForCity(withMan, withMan.cities[0]).includes('nuclear'));
});

test('nuclear: a strike destroys the whole blast, halves the city, and is consumed', () => {
  const missile = unit('n', 'p1', 'nuclear', 9, 5);
  const victim  = unit('v', 'p2', 'phalanx', 10, 5);   // on target city
  const nearby  = unit('w', 'p2', 'militia', 10, 6);    // adjacent, caught in blast
  const safe    = unit('s', 'p2', 'militia', 13, 5);    // out of blast
  const enemyCity = { id: 'e1', name: 'London', ownerId: 'p2', position: { x: 10, y: 5 }, size: 6, food: 0, shields: 0, production: 'militia', buildings: [] };
  let s = baseState({ units: [missile, victim, nearby, safe], cities: [enemyCity] });
  s = apply(s, 'p1', { type: 'attack', unitId: 'n', targetId: 'v' });
  const byId = id => s.units.find(u => u.id === id);
  assert.equal(byId('n').alive, false, 'missile consumed');
  assert.equal(byId('v').alive, false, 'target destroyed');
  assert.equal(byId('w').alive, false, 'blast-adjacent destroyed');
  assert.equal(byId('s').alive, true, 'unit outside blast survives');
  assert.equal(s.cities.find(c => c.id === 'e1').size, 3, 'city halved 6 -> 3');
});

test('nuclear: SDI Defense intercepts the strike (no damage, missile wasted)', () => {
  const missile = unit('n', 'p1', 'nuclear', 9, 5);
  const victim  = unit('v', 'p2', 'phalanx', 10, 5);
  const enemyCity = { id: 'e1', name: 'London', ownerId: 'p2', position: { x: 10, y: 5 }, size: 6, food: 0, shields: 0, production: 'militia', buildings: ['sdi-defense'] };
  let s = baseState({ units: [missile, victim], cities: [enemyCity] });
  s = apply(s, 'p1', { type: 'attack', unitId: 'n', targetId: 'v' });
  assert.equal(s.units.find(u => u.id === 'n').alive, false, 'missile consumed');
  assert.equal(s.units.find(u => u.id === 'v').alive, true, 'target survives interception');
  assert.equal(s.cities.find(c => c.id === 'e1').size, 6, 'city undamaged');
});

// ── Spaceship ────────────────────────────────────────────────────────────────

test('spaceship: parts buildable only with Apollo built and the part advance known', () => {
  const noApollo = baseState({ p1Techs: ['space-flight'] });
  assert.ok(!buildableForCity(noApollo, noApollo.cities[0]).includes('ss-structural'));
  const withApollo = baseState({ p1Buildings: ['palace', 'apollo'], p1Techs: ['space-flight'] });
  assert.ok(buildableForCity(withApollo, withApollo.cities[0]).includes('ss-structural'));
});

test('spaceship: completing a part adds it to the civ ship', () => {
  let s = baseState({ p1Buildings: ['palace', 'apollo'], p1Techs: ['space-flight'] });
  s.cities[0].production = 'ss-structural';
  s.cities[0].shields = 80; // == cost
  s = apply(s, 'p1', { type: 'end-turn', unitId: '__player__' });
  assert.equal(s.gameSpecific.civ.p1.spaceship.structural, 1);
});

test('spaceship: launch is offered when parts meet the minimum, and sets an arrival turn', () => {
  let s = baseState({ p1Spaceship: { structural: 4, component: 3, module: 2 } });
  assert.ok(Civ1Game.getLegalActions(s, 'p1').some(a => a.type === 'launch-spaceship'));
  s = apply(s, 'p1', { type: 'launch-spaceship', unitId: '__player__' });
  assert.equal(s.gameSpecific.civ.p1.spaceship.launched, true);
  assert.ok(s.gameSpecific.civ.p1.spaceship.arrivesTurn > s.turnNumber);
});

test('spaceship: it is NOT launchable below the minimum parts', () => {
  const s = baseState({ p1Spaceship: { structural: 2, component: 1, module: 0 } });
  assert.ok(!Civ1Game.getLegalActions(s, 'p1').some(a => a.type === 'launch-spaceship'));
});

test('spaceship: arriving at Alpha Centauri wins the game (with a capital)', () => {
  const s = baseState({ p1Spaceship: { structural: 4, component: 3, module: 2, launched: true, arrivesTurn: 5 } });
  const res = Civ1Game.getResult(s);
  assert.ok(res && res.outcome === 'win' && res.winnerId === 'p1' && res.reason === 'space-race');
});

test('spaceship: losing the capital destroys the ship (no space win)', () => {
  // p1 launched and arrived, but its only city has no Palace (capital captured). p2 is
  // still alive, so no elimination win either — the game simply continues.
  const p2City = { id: 'e1', name: 'London', ownerId: 'p2', position: { x: 15, y: 5 }, size: 3, food: 0, shields: 0, production: 'militia', buildings: ['palace'] };
  const s = baseState({ p1Buildings: [], p1Spaceship: { structural: 4, component: 3, module: 2, launched: true, arrivesTurn: 5 }, cities: [p2City] });
  const res = Civ1Game.getResult(s);
  assert.equal(res, null);
});
