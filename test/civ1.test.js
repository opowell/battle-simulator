import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Civ1Game } from '../games/civ1/index.js';
import { GameEngine } from '../engine/index.js';
import { RandomAgent } from '../agents/index.js';

function players() {
  return [
    { id: 'p1', name: 'P1', agent: RandomAgent },
    { id: 'p2', name: 'P2', agent: RandomAgent },
  ];
}

function endTurn(state, playerId) {
  return Civ1Game.applyActions(state, [{ playerId, action: { type: 'end-turn', unitId: '__player__' } }]);
}

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

test('civ1: starts on turn 1 with p1 active', () => {
  const state = Civ1Game.createInitialState(players());
  assert.equal(state.turnNumber, 1);
  assert.deepEqual(state.activePlayers, ['p1']);
});

test('civ1: both players start with units', () => {
  const state = Civ1Game.createInitialState(players());
  assert.ok(state.units.some(u => u.ownerId === 'p1' && u.alive));
  assert.ok(state.units.some(u => u.ownerId === 'p2' && u.alive));
});

test('civ1: board has tiles', () => {
  const state = Civ1Game.createInitialState(players());
  assert.ok(Object.keys(state.board.tiles).length > 0);
});

// ---------------------------------------------------------------------------
// getLegalActions
// ---------------------------------------------------------------------------

test('civ1: getLegalActions always includes end-turn', () => {
  const state = Civ1Game.createInitialState(players());
  const actions = Civ1Game.getLegalActions(state, 'p1');
  assert.ok(actions.some(a => a.type === 'end-turn'));
});

test('civ1: getLegalActions includes move or skip-unit for units with moves', () => {
  const state = Civ1Game.createInitialState(players());
  const actions = Civ1Game.getLegalActions(state, 'p1');
  assert.ok(actions.some(a => a.type === 'move' || a.type === 'skip-unit'));
});

// ---------------------------------------------------------------------------
// applyActions
// ---------------------------------------------------------------------------

test('civ1: end-turn by p1 advances to p2', () => {
  const state = Civ1Game.createInitialState(players());
  const next = endTurn(state, 'p1');
  assert.deepEqual(next.activePlayers, ['p2']);
});

test('civ1: end-turn by p2 increments turn number and returns to p1', () => {
  const state = Civ1Game.createInitialState(players());
  const s1 = endTurn(state, 'p1');
  const s2 = endTurn(s1, 'p2');
  assert.equal(s2.turnNumber, 2);
  assert.deepEqual(s2.activePlayers, ['p1']);
});

test('civ1: move action updates unit position', () => {
  const state = Civ1Game.createInitialState(players());
  const move = Civ1Game.getLegalActions(state, 'p1').find(a => a.type === 'move');
  if (!move) return; // no moves available on this map seed — skip
  const next = Civ1Game.applyActions(state, [{ playerId: 'p1', action: move }]);
  const moved = next.units.find(u => u.id === move.unitId);
  assert.deepEqual(moved.position, move.to);
});

test('civ1: skip-unit drains all moves for that unit', () => {
  const state = Civ1Game.createInitialState(players());
  const skip = Civ1Game.getLegalActions(state, 'p1').find(a => a.type === 'skip-unit');
  if (!skip) return;
  const next = Civ1Game.applyActions(state, [{ playerId: 'p1', action: skip }]);
  const unit = next.units.find(u => u.id === skip.unitId);
  assert.equal(unit.movesLeft, 0);
});

// ---------------------------------------------------------------------------
// getResult
// ---------------------------------------------------------------------------

test('civ1: getResult null initially', () => {
  const state = Civ1Game.createInitialState(players());
  assert.equal(Civ1Game.getResult(state), null);
});

test('civ1: getResult win when p2 has no cities or units', () => {
  const state = Civ1Game.createInitialState(players());
  const noP2 = {
    ...state,
    units: state.units.filter(u => u.ownerId !== 'p2'),
    cities: (state.cities ?? []).filter(c => c.ownerId !== 'p2'),
  };
  const result = Civ1Game.getResult(noP2);
  assert.ok(result !== null);
  assert.equal(result.outcome, 'win');
  assert.equal(result.winnerId, 'p1');
});

// ---------------------------------------------------------------------------
// Self-play
// ---------------------------------------------------------------------------

test('civ1: self-play completes with a valid result', async () => {
  const engine = new GameEngine(Civ1Game, players(), { maxTurns: 60 });
  const { result } = await engine.run();
  assert.ok(['win', 'draw'].includes(result.outcome));
});
