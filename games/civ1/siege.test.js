// The 'siege' fixed battle (fixedMaps.js): a city standing from turn 1, an objective
// that decides the game, and agents that know which side of it they are on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Civ1Game } from './index.js';
import { makeCiv1Agent } from './ai.js';
import { siegeRole } from './objective.js';
import { civ1SearchActions } from './searchActions.js';
import { getFixedMap } from './fixedMaps.js';
import { UNITS } from './units.js';
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

test('siege: the attackers outnumber the defenders, 28 to 20, and the defender opens holding the city', () => {
  const s = siege();
  const count = id => s.units.filter(u => u.ownerId === id).length;
  assert.equal(count('p1'), 28);
  assert.equal(count('p2'), 20);
  assert.equal(s.cities.length, 1);
  const city = cityOf(s);
  assert.equal(city.ownerId, 'p2');
  assert.deepEqual(city.position, { x: 18, y: 8 });
  assert.ok(city.name, 'named from the owner\'s list');
  // Marked as a city holder from the start, so the defender is alive and in the game.
  assert.equal(s.gameSpecific.civ.p2.hadCity, true);
  assert.equal(Civ1Game.getResult(s), null);
});

test('siege: the city has a life before the war, but neither walls nor barracks', () => {
  const city = cityOf(siege());
  for (const b of ['palace', 'granary', 'temple', 'marketplace', 'library']) assert.ok(city.buildings.includes(b), b);
  // Either one decides the battle (fixedMaps.js): walls make the city untakeable,
  // barracks send every defender it trains out a veteran.
  assert.ok(!city.buildings.includes('city-walls'));
  assert.ok(!city.buildings.includes('barracks'));
});

test('siege: roads and fields around the city, and no road beside the walls on the attackers\' side', () => {
  const s = siege();
  const tile = (x, y) => s.board.tiles[`${x},${y}`];
  const all = Object.values(s.board.tiles);
  assert.ok(all.filter(t => t.hasRoad).length >= 10, 'a road network');
  assert.ok(all.filter(t => t.irrigated).length >= 10, 'irrigated bottom land');
  const { x, y } = cityOf(s).position;
  assert.equal(tile(x, y).hasRoad, true, 'the city square');
  // A road beside the walls lets a horseman step out for a third of a move, strike at
  // full strength and step back in (fixedMaps.js) — the roads come in from behind.
  for (let dy = -1; dy <= 1; dy++) assert.equal(tile(x - 1, y + dy).hasRoad, false, `${x - 1},${y + dy}`);
  assert.equal(tile(x, y - 1).hasRoad, false);
  assert.equal(tile(x, y + 1).hasRoad, false);
});

test('siege: unit flags from the map — the garrison starts dug in, the siege train veteran', () => {
  const s = siege();
  const inCity = s.units.filter(u => u.position.x === 18 && u.position.y === 8);
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

test('siege: the city is on the attacker\'s map from turn 1, but not who is holding it', () => {
  const s = siege();
  const view = Civ1Game.getVisibleState(s, 'p1');
  assert.deepEqual(view.cities.map(c => c.id), [cityOf(s).id], 'the city is known before it is in sight');
  assert.equal(view.cities[0].unseen, true);
  assert.ok(!view.units.some(u => u.ownerId === 'p2'), 'its garrison is still fogged');
  const grid = Civ1Game.toGrid(view);
  assert.equal(grid.cities.length, 1);
  assert.equal(grid.cities[0].garrison, null, 'an unseen garrison is unknown, not "undefended"');
  // The defender's own view of its city is the whole truth.
  const at = cityOf(s).position;
  const held = s.units.filter(u => u.position.x === at.x && u.position.y === at.y).length;
  const own = Civ1Game.toGrid(Civ1Game.getVisibleState(s, 'p2')).cities[0];
  assert.equal(own.garrison.length, held);
  // Walk an attacker up beside the walls: now the garrison is in sight.
  const near = { ...s, units: s.units.map(u => u.id === 'u0' ? { ...u, position: { x: at.x - 1, y: at.y } } : u) };
  const seen = Civ1Game.getVisibleState(near, 'p1');
  assert.equal(seen.cities[0].unseen, undefined);
  assert.equal(Civ1Game.toGrid(seen).cities[0].garrison.length, held);
  // An open game's cities are found, not known.
  const open = Civ1Game.createInitialState(players(), { seed: 3 });
  assert.equal(open.gameSpecific.knownCities, undefined);
});

test('siege: the board opens far enough back to show the field, not just the army', () => {
  assert.equal(Civ1Game.toGrid(siege()).ui.openingSpan, 20);
  assert.equal(Civ1Game.toGrid(Civ1Game.createInitialState(players(), { seed: 3 })).ui.openingSpan, undefined);
});

test('siege: every unit is one the 1991 game had (UNITS is that roster — units.test.js)', () => {
  for (const u of getFixedMap('siege').units) assert.ok(UNITS[u.type], u.type);
});

test('siege: the battlefield does not wrap — its east and west edges are edges', async () => {
  const s = siege();
  assert.equal(s.board.wrap, false);
  assert.equal(Civ1Game.toGrid(s).wrap, false);
  const { wrapWidth } = await import('./map.js');
  assert.equal(wrapWidth(s.board), Infinity);
  // A unit on the west shore cannot step "west" onto the far east column.
  const { getReachableTiles } = await import('./map.js');
  const scout = { ...s.units.find(u => u.ownerId === 'p1' && u.type === 'knights'), position: { x: 1, y: 7 }, movesLeft: 2 };
  const reach = getReachableTiles(scout, s.board, [scout], 'p1', s.cities);
  assert.ok(reach.every(t => t.x >= 0 && t.x < s.board.width), JSON.stringify(reach));
  // Sight stops at the edge too: nothing off the map is ever marked explored.
  assert.equal(s.gameSpecific.explored.p1.length, s.board.width * s.board.height);
  // The open game still wraps.
  const open = Civ1Game.createInitialState(players(), { seed: 3 });
  assert.equal(open.board.wrap, undefined);
  assert.equal(Civ1Game.toGrid(open).wrap, true);
});

test('siege: an agent\'s distances do not go round the back of the world', async () => {
  const { chebyshevWrapped } = await import('./Civ1Game.js');
  const { wrapWidth } = await import('./map.js');
  const s = siege();
  // Attackers' camp to the city: 10 columns, the direct way — the wrapped way was shorter.
  assert.equal(chebyshevWrapped({ x: 7, y: 7 }, { x: 17, y: 7 }, wrapWidth(s.board)), 10);
  assert.equal(chebyshevWrapped({ x: 1, y: 7 }, { x: 20, y: 7 }, wrapWidth(s.board)), 19);
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
  assert.deepEqual(att.cityPos, { x: 18, y: 8 });
  assert.equal(att.turnsLeft, 20);
  assert.equal(siegeRole(s, 'p2').role, 'defender');
  // The open game has no objective.
  assert.equal(siegeRole(Civ1Game.createInitialState(players(), { seed: 3 }), 'p1'), null);
});

test('siege: the search offers a foot soldier inside the besieged city nothing but holding it', () => {
  let s = endTurn(siege(), 'p1');   // the defender's turn
  // March an attacker up to the walls, so an attack out of the city is on the table.
  s = { ...s, units: s.units.map(u => u.id === 'u5' ? { ...u, position: { x: 17, y: 8 } } : u) };
  // Decide the city's production first, as the search would.
  for (let i = 0; i < 20; i++) {
    const acts = civ1SearchActions(Civ1Game, s, 'p2');
    const unitAct = acts.find(a => a.unitId && a.unitId !== '__player__');
    if (unitAct) {
      const unit = s.units.find(u => u.id === unitAct.unitId);
      if (unit.position.x === 18 && unit.position.y === 8 && unit.type === 'phalanx') {
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
  const garrison = s.units.filter(u => u.alive && u.ownerId === 'p2' && u.position.x === 18 && u.position.y === 8);
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

// ── Forts, sorties and the march (ai.js) ────────────────────────────────────

test('siege: the heuristic defender holds its forts — nobody in one is called home', async () => {
  const engine = new GameEngine(Civ1Game, [
    { id: 'p1', name: 'A', agent: makeCiv1Agent() },
    { id: 'p2', name: 'D', agent: makeCiv1Agent() },
  ], { seed: 3, scenario: 'siege', fogOfWar: true });
  engine._init();
  const fort = u => engine.state.board.tiles[`${u.position.x},${u.position.y}`].fortress;
  const holders = engine.state.units.filter(u => u.ownerId === 'p2' && fort(u)).map(u => [u.id, { ...u.position }]);
  assert.equal(holders.length, 8);
  while (!engine.result && engine.state.turnNumber < 6) await engine.step();
  for (const [id, pos] of holders) {
    const u = engine.state.units.find(x => x.id === id);
    if (u.alive) assert.deepEqual(u.position, pos, `${u.type} ${id} stayed in its fort`);
  }
});

test('siege: a horseman in the city rides out at a siege train caught in the open', () => {
  let s = endTurn(siege(), 'p1');   // the defender's turn
  const knight = s.units.find(u => u.ownerId === 'p2' && u.type === 'knights');
  const catapult = s.units.find(u => u.ownerId === 'p1' && u.type === 'catapult');
  const phalanx = s.units.find(u => u.ownerId === 'p1' && u.type === 'phalanx');
  s = {
    ...s,
    units: [
      ...s.units.map(u => u.id === knight.id ? { ...u, position: { x: 18, y: 8 }, movesLeft: 2 } : u),
      // Two squares out on open ground: a catapult with a phalanx to guard it — a stack
      // that dies together if its guard loses.
      { ...catapult, id: 'cat', position: { x: 16, y: 8 }, attrs: {} },
      { ...phalanx, id: 'guard', position: { x: 16, y: 8 }, attrs: {} },
    ],
  };
  const agent = makeCiv1Agent();
  for (let i = 0; i < 200; i++) {
    const act = agent.chooseAction(s, Civ1Game.getLegalActions(s, 'p2'));
    if (act.unitId === knight.id) {
      assert.equal(act.type, 'move', JSON.stringify(act));
      assert.equal(Math.max(Math.abs(act.to.x - 18), Math.abs(act.to.y - 8)), 1, 'one step out of the walls');
      assert.equal(Math.max(Math.abs(act.to.x - 16), Math.abs(act.to.y - 8)), 1, 'to strike at the train');
      return;
    }
    assert.notEqual(act.type, 'end-turn', 'the turn ended without the knight riding out');
    s = Civ1Game.applyActions(s, [{ playerId: 'p2', action: act }]);
  }
  assert.fail('the knight was never given an order');
});

test('killDesire: a blow on open ground is worth the whole stack, in a fort or city only its defender', async () => {
  const { stakeOf } = await import('./ai.js');
  const s = siege();
  // The fort at the river crossing holds a phalanx and a legion: only the loser dies.
  const fortDefender = s.units.find(u => u.position.x === 13 && u.position.y === 7);
  assert.equal(stakeOf(fortDefender, s), UNITS[fortDefender.type].cost);
  // Move the pair onto open ground and the blow takes both.
  const open = { ...s, units: s.units.map(u => (u.position.x === 13 && u.position.y === 7) ? { ...u, position: { x: 14, y: 7 } } : u) };
  const both = open.units.filter(u => u.position.x === 14 && u.position.y === 7);
  assert.equal(both.length, 2);
  assert.equal(stakeOf(both[0], open), both.reduce((t, u) => t + UNITS[u.type].cost, 0));
});

test('marchDistances: a march finds the way round a zone of control', async () => {
  const { marchDistances, makeZoneOfControl } = await import('./map.js');
  const s = siege();
  const legion = s.units.find(u => u.ownerId === 'p1' && u.type === 'legion');
  const field = marchDistances({ x: 18, y: 8 }, legion, s.board, s.units, 'p1', s.cities);
  // The river crossing between the two forts is shut: a unit beside both cannot step
  // to another square beside both. The way on is round the outside of them.
  const zoc = makeZoneOfControl(s.board, s.units, s.cities, 'p1');
  assert.equal(zoc(legion, { x: 12, y: 8 }, { x: 13, y: 8 }), true, 'the crossing is shut');
  assert.ok(field.get('12,8') < Infinity, 'but the city can still be reached from it');
  // The long way round: dearer than the same march with the forts gone. (Measured
  // against that rather than the six squares of the straight line, because the march
  // is in movement points and the city's road along the north bank cheapens both.)
  const fortless = s.units.filter(u => !(u.ownerId === 'p2' && s.board.tiles[`${u.position.x},${u.position.y}`].fortress));
  const straight = marchDistances({ x: 18, y: 8 }, legion, s.board, fortless, 'p1', s.cities);
  assert.ok(field.get('12,8') > straight.get('12,8'),
    `the long way round: ${field.get('12,8')} with the forts, ${straight.get('12,8')} without`);
  // The square between the forts is a dead end: every step out of it is beside them.
  assert.equal(field.has('13,8'), false);
});
