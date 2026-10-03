// The battle record — what the board needs to play a fight the way the original does
// (the attacker lunges, the loser explodes; see ui.battleAnimation). The rules never
// read it, so these tests are about the record itself: that every fight leaves one,
// that it says who struck whom from where and who won, that a viewer under fog is told
// about exactly the fights they witnessed, and that toGrid hands it over as tokens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Civ1Game, BARBARIAN_ID } from './index.js';

const players = (n = 2) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));

function unit(id, ownerId, type, x, y, over = {}) {
  return {
    id, ownerId, type, position: { x, y }, alive: true,
    hp: 10, maxHp: 10, movesLeft: 1, attrs: {}, queue: [], ...over,
  };
}

// Flat grassland with nothing on it but the pieces under test.
function world({ units = [], cities = [], fogOfWar = false, barbarians = 'villages-only', seats = 2, turnNumber } = {}) {
  const state = Civ1Game.createInitialState(players(seats), { width: 30, height: 20, seed: 7, barbarians, fogOfWar });
  const tiles = {};
  for (const [k, t] of Object.entries(state.board.tiles)) tiles[k] = { ...t, terrain: 'grassland', hasRoad: false };
  return {
    ...state, board: { ...state.board, tiles }, units, cities, activePlayers: ['p1'],
    ...(turnNumber != null ? { turnNumber } : {}),
  };
}

// resolveCombat takes a round when rng() < attack/(attack+defense): a stream of zeroes
// is the attacker winning every round, a stream of ~1s is the attacker losing them all.
const attackerWins = () => 0;
const attackerLoses = () => 0.999;

const attack = (state, attackerId, targetId, rng, playerId = 'p1') =>
  Civ1Game.applyActions(state, [{ playerId, action: { type: 'attack', unitId: attackerId, targetId } }], rng);

test('civ1 battles: a won attack is recorded — from, at, the two fighters, and the win', () => {
  const state = attack(world({ units: [
    unit('a', 'p1', 'legion', 5, 5),
    unit('d', 'p2', 'militia', 6, 6),
  ] }), 'a', 'd', attackerWins);

  assert.deepEqual(state.gameSpecific.battles, [{
    n: 1, from: { x: 5, y: 5 }, at: { x: 6, y: 6 }, won: true,
    attacker: { id: 'a', type: 'legion', ownerId: 'p1' },
    defender: { id: 'd', type: 'militia', ownerId: 'p2' },
  }]);
  // The record keeps where the attacker struck FROM, though it has since advanced.
  assert.deepEqual(state.units.find(u => u.id === 'a').position, { x: 6, y: 6 });
});

test('civ1 battles: a lost attack is recorded as lost', () => {
  const state = attack(world({ units: [
    unit('a', 'p1', 'militia', 5, 5),
    unit('d', 'p2', 'phalanx', 6, 5),
  ] }), 'a', 'd', attackerLoses);

  const [b] = state.gameSpecific.battles;
  assert.equal(b.won, false);
  assert.equal(state.units.find(u => u.id === 'a').alive, false, 'the attacker is the one that died');
});

test('civ1 battles: the record names the defender the square answered with, not the one named', () => {
  // Stacks meet an attack with their best defender (pickDefender) — that is who fought.
  const state = attack(world({ units: [
    unit('a', 'p1', 'legion', 5, 5),
    unit('s', 'p2', 'settlers', 6, 5),
    unit('ph', 'p2', 'phalanx', 6, 5),
  ] }), 'a', 's', attackerWins);

  assert.equal(state.gameSpecific.battles[0].defender.id, 'ph');
});

test('civ1 battles: fights are numbered in order, and only the last 32 are kept', () => {
  const old = Array.from({ length: 32 }, (_, i) => ({
    n: i + 1, from: { x: 0, y: 0 }, at: { x: 1, y: 0 }, won: true,
    attacker: { id: 'x', type: 'militia', ownerId: 'p1' }, defender: { id: 'y', type: 'militia', ownerId: 'p2' },
  }));
  let state = world({ units: [unit('a', 'p1', 'legion', 5, 5), unit('d', 'p2', 'militia', 6, 5)] });
  state = { ...state, gameSpecific: { ...state.gameSpecific, battles: old } };
  state = attack(state, 'a', 'd', attackerWins);

  const { battles } = state.gameSpecific;
  assert.equal(battles.length, 32);
  assert.equal(battles[0].n, 2, 'the oldest dropped off the front');
  assert.equal(battles.at(-1).n, 33);
  assert.equal(battles.at(-1).attacker.id, 'a');
});

test('civ1 battles: an action with no fight leaves the record as it was', () => {
  let state = attack(world({ units: [
    unit('a', 'p1', 'legion', 5, 5),
    unit('d', 'p2', 'militia', 6, 5),
    unit('w', 'p1', 'militia', 10, 10),
  ] }), 'a', 'd', attackerWins);
  const before = state.gameSpecific.battles;
  state = Civ1Game.applyActions(state, [{ playerId: 'p1', action: { type: 'move', unitId: 'w', to: { x: 11, y: 10 } } }]);
  assert.equal(state.gameSpecific.battles, before);
});

test('civ1 battles: a barbarian raid inside an end-turn is recorded too', () => {
  // A quiet turn under roving bands: the raid runs, no uprising joins it.
  let state = world({
    barbarians: 'roving-bands', turnNumber: 2,
    cities: [{ id: 'c1', name: 'Roma', ownerId: 'p1', position: { x: 10, y: 10 }, size: 4, shields: 0, food: 0, production: 'militia', buildings: [] }],
    units: [
      unit('b1', BARBARIAN_ID, 'legion', 11, 10),
      unit('d1', 'p1', 'militia', 10, 10, { attrs: { fortified: true } }),
    ],
  });
  for (let guard = 0; state.turnNumber === 2 && guard < 10; guard++) {
    state = Civ1Game.applyActions(state,
      [{ playerId: state.activePlayers[0], action: { type: 'end-turn', unitId: '__player__' } }], attackerWins);
  }

  const raid = state.gameSpecific.battles?.find(b => b.attacker.id === 'b1');
  assert.ok(raid, 'the raid left a record');
  assert.deepEqual(raid.from, { x: 11, y: 10 });
  assert.deepEqual(raid.at, { x: 10, y: 10 });
  assert.equal(raid.attacker.ownerId, BARBARIAN_ID);
  assert.equal(raid.won, true);
});

test('civ1 battles: under fog a player is told about the fights they witnessed, and no others', () => {
  // p2 attacks p1's lone scout and kills it — p1 fought in that one, so it is theirs
  // to see even though the unit that saw it is dead. p3 fights p2 far away, out of
  // p1's sight: none of p1's business.
  let state = world({ fogOfWar: true, seats: 3, units: [
    unit('scout', 'p1', 'militia', 5, 5),
    unit('home', 'p1', 'militia', 1, 1),
    unit('raider', 'p2', 'legion', 6, 5),
    unit('far2', 'p2', 'militia', 25, 15),
    unit('far3', 'p3', 'legion', 26, 15),
  ] });
  state = attack(state, 'raider', 'scout', attackerWins, 'p2');
  state = attack(state, 'far3', 'far2', attackerWins, 'p3');
  assert.equal(state.gameSpecific.battles.length, 2);

  const seenBy = pid => Civ1Game.getVisibleState(state, pid).gameSpecific.battles.map(b => b.attacker.id);
  assert.deepEqual(seenBy('p1'), ['raider'], 'p1 saw the fight that killed its scout, not the far one');
  assert.deepEqual(seenBy('p2'), ['raider', 'far3'], 'p2 fought in both');
  assert.deepEqual(seenBy('p3'), ['far3']);
});

test('civ1 battles: a fight in plain sight is seen by a bystander', () => {
  let state = world({ fogOfWar: true, seats: 3, units: [
    unit('watcher', 'p1', 'militia', 7, 5),
    unit('a', 'p2', 'legion', 8, 5),
    unit('d', 'p3', 'militia', 9, 5),
  ] });
  state = attack(state, 'a', 'd', attackerWins, 'p2');
  assert.deepEqual(Civ1Game.getVisibleState(state, 'p1').gameSpecific.battles.map(b => b.attacker.id), ['a']);
});

test('civ1 battles: toGrid hands each fight over as two board tokens', () => {
  const state = attack(world({ units: [
    unit('a', 'p1', 'legion', 5, 5),
    unit('d', 'p2', 'militia', 6, 6),
  ] }), 'a', 'd', attackerWins);

  const { battles } = Civ1Game.toGrid(state);
  assert.deepEqual(battles, [{
    id: 1, from: { x: 5, y: 5 }, at: { x: 6, y: 6 }, won: true,
    attacker: { unitId: 'a', glyph: 'L', unitName: 'legion', imagePath: '/images/civ1/units/legion', owner: 1 },
    defender: { unitId: 'd', glyph: 'M', unitName: 'militia', imagePath: '/images/civ1/units/militia', owner: 2 },
  }]);
});

test('civ1 battles: the animation is declared with the original\'s eight explosion frames', () => {
  const spec = Civ1Game.ui.battleAnimation;
  assert.equal(spec.lunge, 10 / 16, 'the attacker covers 10 of the square\'s 16 pixels');
  assert.equal(spec.frames.length, 8);
  assert.ok(spec.frames.every((f, i) => f === `/images/civ1/units/combat_${i + 1}`));
});
