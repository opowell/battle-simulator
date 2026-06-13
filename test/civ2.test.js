import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Civ2Game } from '../games/civ2/index.js';
import { GameEngine } from '../engine/index.js';
import { RandomAgent } from '../agents/index.js';

function players() {
  return [
    { id: 'p1', name: 'P1', agent: RandomAgent },
    { id: 'p2', name: 'P2', agent: RandomAgent },
  ];
}

function endTurn(state, playerId) {
  return Civ2Game.applyActions(state, [{ playerId, action: { type: 'end-turn', unitId: '__player__' } }]);
}

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

test('civ2: starts on turn 1 with p1 active', () => {
  const state = Civ2Game.createInitialState(players());
  assert.equal(state.turnNumber, 1);
  assert.deepEqual(state.activePlayers, ['p1']);
});

test('civ2: both players start with units', () => {
  const state = Civ2Game.createInitialState(players());
  assert.ok(state.units.some(u => u.ownerId === 'p1' && u.alive));
  assert.ok(state.units.some(u => u.ownerId === 'p2' && u.alive));
});

test('civ2: board has tiles', () => {
  const state = Civ2Game.createInitialState(players());
  assert.ok(Object.keys(state.board.tiles).length > 0);
});

test('civ2: starts with no cities', () => {
  const state = Civ2Game.createInitialState(players());
  assert.equal(state.cities.length, 0);
});

// ---------------------------------------------------------------------------
// getLegalActions
// ---------------------------------------------------------------------------

test('civ2: getLegalActions always includes end-turn', () => {
  const state = Civ2Game.createInitialState(players());
  const actions = Civ2Game.getLegalActions(state, 'p1');
  assert.ok(actions.some(a => a.type === 'end-turn'));
});

test('civ2: getLegalActions includes move or skip-unit when units have moves left', () => {
  const state = Civ2Game.createInitialState(players());
  const actions = Civ2Game.getLegalActions(state, 'p1');
  assert.ok(actions.some(a => a.type === 'move' || a.type === 'skip-unit'));
});

test('civ2: settlers can found-city on land', () => {
  const state = Civ2Game.createInitialState(players());
  const actions = Civ2Game.getLegalActions(state, 'p1');
  assert.ok(actions.some(a => a.type === 'found-city'));
});

// ---------------------------------------------------------------------------
// applyActions
// ---------------------------------------------------------------------------

test('civ2: end-turn by p1 advances to p2', () => {
  const state = Civ2Game.createInitialState(players());
  const next = endTurn(state, 'p1');
  assert.deepEqual(next.activePlayers, ['p2']);
});

test('civ2: end-turn by p2 increments turn and returns to p1', () => {
  const state = Civ2Game.createInitialState(players());
  const s1 = endTurn(state, 'p1');
  const s2 = endTurn(s1, 'p2');
  assert.equal(s2.turnNumber, 2);
  assert.deepEqual(s2.activePlayers, ['p1']);
});

test('civ2: move updates unit position', () => {
  const state = Civ2Game.createInitialState(players());
  const move = Civ2Game.getLegalActions(state, 'p1').find(a => a.type === 'move');
  if (!move) return;
  const next = Civ2Game.applyActions(state, [{ playerId: 'p1', action: move }]);
  const moved = next.units.find(u => u.id === move.unitId);
  assert.deepEqual(moved.position, move.to);
});

test('civ2: found-city creates a city and removes settlers', () => {
  const state = Civ2Game.createInitialState(players());
  const found = Civ2Game.getLegalActions(state, 'p1').find(a => a.type === 'found-city');
  if (!found) return;
  const next = Civ2Game.applyActions(state, [{ playerId: 'p1', action: found }]);
  assert.equal(next.cities.length, 1);
  assert.ok(!next.units.some(u => u.id === found.unitId));
});

// ---------------------------------------------------------------------------
// getResult
// ---------------------------------------------------------------------------

test('civ2: getResult null initially', () => {
  const state = Civ2Game.createInitialState(players());
  assert.equal(Civ2Game.getResult(state), null);
});

test('civ2: getResult win when p2 has no cities or units', () => {
  const state = Civ2Game.createInitialState(players());
  const noP2 = {
    ...state,
    units: state.units.filter(u => u.ownerId !== 'p2'),
    cities: state.cities.filter(c => c.ownerId !== 'p2'),
  };
  const result = Civ2Game.getResult(noP2);
  assert.ok(result !== null);
  assert.equal(result.outcome, 'win');
  assert.equal(result.winnerId, 'p1');
});

// ---------------------------------------------------------------------------
// Self-play
// ---------------------------------------------------------------------------

test('civ2: self-play completes with a valid result', async () => {
  const engine = new GameEngine(Civ2Game, players(), { maxTurns: 60 });
  const { result } = await engine.run();
  assert.ok(['win', 'draw'].includes(result.outcome));
});
