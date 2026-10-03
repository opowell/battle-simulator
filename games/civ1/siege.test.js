// The 'siege' fixed battle (fixedMaps.js): a city standing from turn 1, an objective
// that decides the game, and agents that know which side of it they are on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Civ1Game } from './index.js';
import { makeCiv1Agent } from './ai.js';
import { siegeRole } from './objective.js';
import { civ1SearchActions } from './searchActions.js';
import { getFixedMap } from './fixedMaps.js';
import { GameEngine } from '../../engine/index.js';
import { RandomAgent } from '../../agents/index.js';

const players = () => [
  { id: 'p1', name: 'Attacker', agent: RandomAgent },
  { id: 'p2', name: 'Defender', agent: RandomAgent },
];
const siege = () => Civ1Game.createInitialState(players(), { scenario: 'siege' });
const endTurn = (state, playerId) =>
  Civ1Game.applyActions(state, [{ playerId, action: { type: 'end-turn', unitId: '__player__' } }]);
const cityOf = s => s.cities.find(c => c.id === s.gameSpecific.objective.cityId);

test('siege: twenty units a side, and the defender opens holding the city', () => {
  const s = siege();
  const count = id => s.units.filter(u => u.ownerId === id).length;
  assert.equal(count('p1'), 20);
  assert.equal(count('p2'), 20);
  assert.equal(s.cities.length, 1);
  const city = cityOf(s);
  assert.equal(city.ownerId, 'p2');
  assert.deepEqual(city.position, { x: 17, y: 7 });
  assert.ok(city.name, 'named from the owner\'s list');
  // Marked as a city holder from the start, so the defender is alive and in the game.
  assert.equal(s.gameSpecific.civ.p2.hadCity, true);
  assert.equal(Civ1Game.getResult(s), null);
});

test('siege: unit flags from the map — the garrison starts dug in, the siege train veteran', () => {
  const s = siege();
  const inCity = s.units.filter(u => u.position.x === 17 && u.position.y === 7);
  assert.ok(inCity.length >= 8);
  assert.ok(inCity.every(u => u.attrs.fortified));
  assert.ok(s.units.some(u => u.ownerId === 'p1' && u.type === 'catapult' && u.attrs.veteran));
});

test('siege: the whole battlefield is known ground to both sides, units still fogged', () => {
  const s = siege();
  const W = s.board.width, H = s.board.height;
  for (const pid of ['p1', 'p2']) assert.equal(s.gameSpecific.explored[pid], '1'.repeat(W * H));
  const view = Civ1Game.getVisibleState(s, 'p1');
  assert.ok(!view.units.some(u => u.ownerId === 'p2'), 'the defenders are out of sight at the start');
  assert.ok(!Object.values(view.board.tiles).some(t => t.terrain === 'unknown'));
});

test('siege: the sea behind the city is wide enough that the wrapped way round is never shorter', () => {
  const map = getFixedMap('siege');
  const W = map.rows[0].length;
  const landX = [];
  map.rows.forEach(r => [...r].forEach((ch, x) => { if (ch !== '.') landX.push(x); }));
  const span = Math.max(...landX) - Math.min(...landX);
  assert.ok(W - span > span, `land spans ${span} columns of a ${W}-wide map`);
  assert.ok(map.rows.every(r => r.length === W) && map.rivers.every(r => r.length === W));
});

test('siege: taking the city wins for the attacker', () => {
  const s = siege();
  const taken = { ...s, cities: s.cities.map(c => ({ ...c, ownerId: 'p1' })) };
  assert.deepEqual(Civ1Game.getResult(taken), { outcome: 'win', winnerId: 'p1', reason: 'city-taken' });
});

test('siege: holding the city past the last turn wins for the defender', () => {
  let s = siege();
  const turns = s.gameSpecific.objective.turns;
  while (s.turnNumber <= turns) {
    assert.equal(Civ1Game.getResult(s), null, `still open on turn ${s.turnNumber}`);
    s = endTurn(endTurn(s, 'p1'), 'p2');
  }
  assert.deepEqual(Civ1Game.getResult(s), { outcome: 'win', winnerId: 'p2', reason: 'city-held' });
});

test('siege: an attacking army wiped out loses before the clock runs out', () => {
  const s = siege();
  const routed = { ...s, units: s.units.map(u => u.ownerId === 'p1' ? { ...u, alive: false } : u) };
  assert.equal(Civ1Game.getResult(routed)?.winnerId, 'p2');
});

test('siege: the header counts down the turns left', () => {
  const s = siege();
  const label = Civ1Game.toGrid(s).turnLabel;
  assert.match(label, /20 turns left/);
  assert.match(Civ1Game.toGrid({ ...s, turnNumber: 20 }).turnLabel, /last turn/);
  // ...and tells the client the whole battlefield is known ground.
  assert.equal(Civ1Game.toGrid(s).ui.terrainKnown, true);
  assert.equal(Civ1Game.toGrid(Civ1Game.createInitialState(players(), { seed: 3 })).ui.terrainKnown, undefined);
});

test('siege: the scenario menu entry carries the map\'s seats', () => {
  const sc = Civ1Game.scenarios.find(x => x.id === 'siege');
  assert.equal(sc.config.players.length, 2);
  assert.equal(sc.config.players[1].agent, 'civ1-heuristic');
});

test('siegeRole: each seat learns its side, and the attacker knows where the city is before it can see it', () => {
  const s = siege();
  const att = siegeRole(Civ1Game.getVisibleState(s, 'p1'), 'p1');
  assert.equal(att.role, 'attacker');
  assert.deepEqual(att.cityPos, { x: 17, y: 7 });
  assert.equal(att.turnsLeft, 20);
  assert.equal(siegeRole(s, 'p2').role, 'defender');
  // The open game has no objective.
  assert.equal(siegeRole(Civ1Game.createInitialState(players(), { seed: 3 }), 'p1'), null);
});

test('siege: the search offers a foot soldier inside the besieged city nothing but holding it', () => {
  let s = endTurn(siege(), 'p1');   // the defender's turn
  // March an attacker up to the walls, so an attack out of the city is on the table.
  s = { ...s, units: s.units.map(u => u.id === 'u5' ? { ...u, position: { x: 16, y: 7 } } : u) };
  // Decide the city's production first, as the search would.
  for (let i = 0; i < 20; i++) {
    const acts = civ1SearchActions(Civ1Game, s, 'p2');
    const unitAct = acts.find(a => a.unitId && a.unitId !== '__player__');
    if (unitAct) {
      const unit = s.units.find(u => u.id === unitAct.unitId);
      if (unit.position.x === 17 && unit.position.y === 7 && unit.type === 'phalanx') {
        assert.ok(acts.every(a => a.type === 'fortify' || a.type === 'skip-unit'), JSON.stringify(acts));
        return;
      }
    }
    s = Civ1Game.applyActions(s, [{ playerId: 'p2', action: acts[0] }]);
  }
  assert.fail('never reached a garrison phalanx');
});

test('siege: the heuristic defender keeps its foot soldiers home and builds defenders', async () => {
  const engine = new GameEngine(Civ1Game, [
    { id: 'p1', name: 'A', agent: makeCiv1Agent() },
    { id: 'p2', name: 'D', agent: makeCiv1Agent() },
  ], { seed: 1, scenario: 'siege' });
  engine._init();
  while (!engine.result && engine.state.turnNumber < 4) await engine.step();
  const s = engine.state;
  const garrison = s.units.filter(u => u.alive && u.ownerId === 'p2' && u.position.x === 17 && u.position.y === 7);
  assert.ok(garrison.length >= 8, `garrison of ${garrison.length}`);
  assert.notEqual(cityOf(s).production, 'settlers');
});

test('siege: plays out to a decision inside the turn limit', async () => {
  const engine = new GameEngine(Civ1Game, [
    { id: 'p1', name: 'A', agent: makeCiv1Agent() },
    { id: 'p2', name: 'D', agent: makeCiv1Agent() },
  ], { seed: 2, scenario: 'siege' });
  engine._init();
  while (!engine.result) { const { done } = await engine.step(); if (done) break; }
  assert.ok(['city-taken', 'city-held', 'civilization-destroyed'].includes(engine.result.reason), engine.result.reason);
  assert.ok(engine.state.turnNumber <= 21);
});
