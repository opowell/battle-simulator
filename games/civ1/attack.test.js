// What a won attack costs and what it does to a city — the original's rules, as its
// caller of the combat routine applies them (OpenCivOne's CheckPlayerTurn, after
// F0_29f3_000e): the attacker spends one move, not its turn; a city whose defender is
// beaten loses a citizen, unless it has walls or the blow came from the sea; and a city
// with no citizen left is razed, taking every unit it supported with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Civ1Game, getCombatStrengths } from './index.js';

const players = () => [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];

function unit(id, ownerId, type, x, y, over = {}) {
  return {
    id, ownerId, type, position: { x, y }, alive: true,
    hp: 10, maxHp: 10, moveThirds: 3, attrs: {}, queue: [], ...over,
  };
}

function city(id, ownerId, x, y, over = {}) {
  return {
    id, name: id, ownerId, position: { x, y },
    size: 3, shields: 0, food: 0, production: 'militia', buildings: [], ...over,
  };
}

// Flat grassland with nothing on it but the pieces under test; `ocean` lists squares
// to turn to sea.
function world({ units = [], cities = [], ocean = [], difficulty } = {}) {
  const state = Civ1Game.createInitialState(players(), {
    width: 20, height: 20, seed: 7, barbarians: 'villages-only', fogOfWar: false, difficulty,
  });
  const sea = new Set(ocean.map(([x, y]) => `${x},${y}`));
  const tiles = {};
  for (const [k, t] of Object.entries(state.board.tiles)) {
    tiles[k] = { ...t, terrain: sea.has(k) ? 'ocean' : 'grassland', hasRoad: false };
  }
  return { ...state, board: { ...state.board, tiles }, units, cities, activePlayers: ['p1'] };
}

// resolveCombat takes a round when rng() < attack/(attack+defense): all zeroes is the
// attacker winning every round, all ~1s the attacker losing every one.
const attackerWins = () => 0;
const attackerLoses = () => 0.999;

const attack = (state, attackerId, targetId, rng = attackerWins) =>
  Civ1Game.applyActions(state, [{ playerId: 'p1', action: { type: 'attack', unitId: attackerId, targetId } }], rng);
const byId = (state, id) => state.units.find(u => u.id === id);

// ---------------------------------------------------------------------------
// One move, not the turn
// ---------------------------------------------------------------------------

test('civ1 attack: winning costs one move, and a unit with moves to spare fights on', () => {
  let state = world({ units: [
    unit('kn', 'p1', 'knights', 5, 5, { moveThirds: 6 }),
    unit('a', 'p2', 'militia', 6, 5),
    unit('b', 'p2', 'militia', 4, 5),
  ] });
  state = attack(state, 'kn', 'a');
  assert.equal(byId(state, 'a').alive, false);
  assert.equal(byId(state, 'kn').moveThirds, 3, 'two moves, one spent');

  const again = Civ1Game.getLegalActions(state, 'p1').find(a => a.type === 'attack' && a.unitId === 'kn');
  assert.ok(again, 'it may attack again this turn');
  state = Civ1Game.applyActions(state, [{ playerId: 'p1', action: again }], attackerWins);
  assert.equal(byId(state, 'b').alive, false);
  assert.equal(byId(state, 'kn').moveThirds, 0);
  assert.equal(Civ1Game.getLegalActions(state, 'p1').some(a => a.unitId === 'kn' && a.type === 'attack'), false);
});

test('civ1 attack: a one-move unit is spent by its attack', () => {
  const state = attack(world({ units: [
    unit('leg', 'p1', 'legion', 5, 5),
    unit('a', 'p2', 'militia', 6, 5),
  ] }), 'leg', 'a');
  assert.equal(byId(state, 'leg').moveThirds, 0);
});

test('civ1 attack: what a road left over is kept in whole thirds, and never goes negative', () => {
  const four = attack(world({ units: [
    unit('kn', 'p1', 'knights', 5, 5, { moveThirds: 4 }),
    unit('a', 'p2', 'militia', 6, 5),
  ] }), 'kn', 'a');
  assert.equal(byId(four, 'kn').moveThirds, 1, 'four thirds less three is exactly one third');

  const two = attack(world({ units: [
    unit('kn', 'p1', 'knights', 5, 5, { moveThirds: 2 }),
    unit('a', 'p2', 'militia', 6, 5),
  ] }), 'kn', 'a');
  assert.equal(byId(two, 'kn').moveThirds, 0);
});

test('civ1 attack: a lost attack is still the end of the attacker', () => {
  const state = attack(world({ units: [
    unit('kn', 'p1', 'knights', 5, 5, { moveThirds: 6 }),
    unit('ph', 'p2', 'phalanx', 6, 5),
  ] }), 'kn', 'ph', attackerLoses);
  assert.equal(byId(state, 'kn').alive, false);
  assert.equal(byId(state, 'kn').moveThirds, 0);
});

// ---------------------------------------------------------------------------
// Part of a move, part of the strength
// ---------------------------------------------------------------------------
// The original's combat routine (F0_29f3_000e) scales the attack by RemainingMoves / 3
// whenever fewer than three thirds are left, and CheckPlayerTurn asks the player
// "Attack at 1/3 strength?" before letting the blow go.

test('civ1 attack: on a third or two thirds of a move the blow lands at that strength', () => {
  const state = world({ units: [unit('a', 'p2', 'militia', 6, 5)] });
  const strength = moveThirds =>
    getCombatStrengths(unit('cat', 'p1', 'catapult', 5, 5, { moveThirds }), byId(state, 'a'), state).att;
  assert.equal(strength(3), 6, "a catapult's full attack");
  assert.equal(strength(2), 4);
  assert.equal(strength(1), 2);
  assert.equal(strength(6), 6, 'more than a move is no stronger than one');
  assert.equal(strength(0), 6, 'a unit with no moves left is weighed at what it hits with next turn');
});

test('civ1 attack: a weakened attack says so on the button, and a full one does not', () => {
  const at = moveThirds => Civ1Game.getLegalActions(world({ units: [
    unit('leg', 'p1', 'legion', 5, 5, { moveThirds }),
    unit('a', 'p2', 'militia', 6, 5),
  ] }), 'p1').find(a => a.type === 'attack');
  assert.equal(at(1).label, 'Attack a at 1/3 strength');
  assert.equal(at(2).label, 'Attack a at 2/3 strength');
  assert.equal(at(3).label, undefined);
  assert.equal(at(6).label, undefined);
});

test('civ1 attack: three road steps leave no move to attack with', () => {
  // Three thirds off one move left 1.1e-16 when moves were floats, and that sliver
  // looked like a move left. Counted in whole thirds, as the original counts them,
  // three off three is nothing at all.
  let state = world({ units: [
    unit('leg', 'p1', 'legion', 5, 5),
    unit('a', 'p2', 'militia', 9, 5),
  ] });
  state = { ...state, board: { ...state.board, tiles: Object.fromEntries(
    Object.entries(state.board.tiles).map(([k, t]) => [k, { ...t, hasRoad: true }])) } };
  for (let x = 6; x <= 8; x++) {
    state = Civ1Game.applyActions(state, [{ playerId: 'p1',
      action: { type: 'move', unitId: 'leg', from: byId(state, 'leg').position, to: { x, y: 5 } } }]);
  }
  assert.deepEqual(byId(state, 'leg').position, { x: 8, y: 5 });
  assert.equal(byId(state, 'leg').moveThirds, 0);
  assert.equal(Civ1Game.getLegalActions(state, 'p1').some(a => a.type === 'attack'), false);
});

// ---------------------------------------------------------------------------
// A beaten garrison costs its city a citizen
// ---------------------------------------------------------------------------

const siegeOf = (cityOver = {}, opts = {}) => world({
  units: [
    unit('leg', 'p1', 'legion', 9, 10),
    unit('g1', 'p2', 'militia', 10, 10),
    unit('g2', 'p2', 'militia', 10, 10),
  ],
  cities: [city('roma', 'p2', 10, 10, cityOver)],
  ...opts,
});

test('civ1 attack: every defender beaten in a city costs it a citizen', () => {
  const state = attack(siegeOf(), 'leg', 'g1');
  assert.equal(state.cities[0].size, 2);
  assert.equal(state.cities[0].ownerId, 'p2');
});

test('civ1 attack: a lost attack on a city costs it nothing', () => {
  const state = attack(siegeOf(), 'leg', 'g1', attackerLoses);
  assert.equal(state.cities[0].size, 3);
});

test('civ1 attack: City Walls keep the people in', () => {
  const state = attack(siegeOf({ buildings: ['city-walls'] }), 'leg', 'g1');
  assert.equal(byId(state, 'g1').alive, false, 'the fight was still won');
  assert.equal(state.cities[0].size, 3);
});

test('civ1 attack: the Great Wall defends a city but does not keep its people', () => {
  // The original checks the city's own walls flag; the Great Wall only lends every
  // city the walls' defence in combat (combat.js), so a city it covers still shrinks.
  const base = siegeOf();
  const state = attack({ ...base, cities: [...base.cities, city('wall', 'p2', 2, 2, { buildings: ['great-wall'] })] }, 'leg', 'g1');
  assert.equal(state.cities.find(c => c.id === 'roma').size, 2);
});

test('civ1 attack: a blow from a ship at sea costs the city nothing', () => {
  const state = attack(world({
    ocean: [[9, 10]],
    units: [
      unit('iron', 'p1', 'ironclad', 9, 10, { moveThirds: 12 }),
      unit('g1', 'p2', 'militia', 10, 10),
      unit('g2', 'p2', 'militia', 10, 10),
    ],
    cities: [city('roma', 'p2', 10, 10)],
  }), 'iron', 'g1');
  assert.equal(byId(state, 'g1').alive, false);
  assert.equal(state.cities[0].size, 3);
});

test('civ1 attack: on Chieftain no city loses people this way — for either side', () => {
  const state = attack(siegeOf({}, { difficulty: 'chieftain' }), 'leg', 'g1');
  assert.equal(state.gameSpecific.rules.difficulty, 'chieftain');
  assert.equal(state.cities[0].size, 3);
});

// ---------------------------------------------------------------------------
// …and one with none left is razed
// ---------------------------------------------------------------------------

test('civ1 attack: a city that loses its last citizen is razed, with every unit it supported', () => {
  const state = attack(world({
    units: [
      unit('leg', 'p1', 'legion', 9, 10),
      unit('g1', 'p2', 'militia', 10, 10, { homeCityId: 'hamlet' }),
      unit('g2', 'p2', 'phalanx', 10, 10, { homeCityId: 'capital' }),
      unit('far', 'p2', 'settlers', 15, 15, { homeCityId: 'hamlet' }),
      unit('safe', 'p2', 'militia', 3, 3, { homeCityId: 'capital' }),
    ],
    cities: [
      city('hamlet', 'p2', 10, 10, { size: 1 }),
      city('capital', 'p2', 3, 3),
    ],
  }), 'leg', 'g2');

  assert.equal(byId(state, 'g2').alive, false, 'the defender fell');
  assert.deepEqual(state.cities.map(c => c.id), ['capital'], 'and the hamlet is gone');
  assert.equal(byId(state, 'far').alive, false, 'its settlers, far away, went with it');
  assert.equal(byId(state, 'g1').alive, false, 'as did its own militia, standing in it');
  assert.equal(byId(state, 'safe').alive, true, 'units the capital supports are untouched');
  assert.deepEqual(byId(state, 'leg').position, { x: 9, y: 10 }, 'the winner still stays put');
});

test('civ1 attack: a garrison not supported by the razed city survives it, on open ground', () => {
  const state = attack(world({
    units: [
      unit('leg', 'p1', 'legion', 9, 10),
      unit('g1', 'p2', 'phalanx', 10, 10, { homeCityId: 'capital' }),
      unit('g2', 'p2', 'militia', 10, 10, { homeCityId: 'capital' }),
    ],
    cities: [city('hamlet', 'p2', 10, 10, { size: 1 }), city('capital', 'p2', 3, 3)],
  }), 'leg', 'g1');
  assert.equal(state.cities.some(c => c.id === 'hamlet'), false);
  assert.equal(byId(state, 'g2').alive, true);
  assert.deepEqual(byId(state, 'g2').position, { x: 10, y: 10 });
});
