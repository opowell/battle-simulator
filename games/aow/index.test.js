import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AowGame } from './index.js';
import { GameEngine } from '../../engine/index.js';
import { RandomAgent } from '../../agents/index.js';

function players() {
  return [
    { id: 'p1', name: 'P1', agent: RandomAgent },
    { id: 'p2', name: 'P2', agent: RandomAgent },
  ];
}

function endTurn(state, playerId) {
  return AowGame.applyActions(state, [{ playerId, action: { type: 'end-turn', unitId: '__player__' } }]);
}

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

test('aow: both players have units', () => {
  const state = AowGame.createInitialState(players());
  assert.ok(state.units.some(u => u.ownerId === 'p1' && u.alive));
  assert.ok(state.units.some(u => u.ownerId === 'p2' && u.alive));
});

test('aow: starts on turn 1 with p1 active', () => {
  const state = AowGame.createInitialState(players());
  assert.equal(state.turnNumber, 1);
  assert.deepEqual(state.activePlayers, ['p1']);
});

test('aow: units start with moves left', () => {
  const state = AowGame.createInitialState(players());
  const p1Units = state.units.filter(u => u.ownerId === 'p1');
  assert.ok(p1Units.every(u => u.movesLeft > 0));
});

test('aow: board has tiles', () => {
  const state = AowGame.createInitialState(players());
  assert.ok(Object.keys(state.board.tiles).length > 0);
});

// ---------------------------------------------------------------------------
// getLegalActions
// ---------------------------------------------------------------------------

test('aow: getLegalActions includes end-turn', () => {
  const state = AowGame.createInitialState(players());
  assert.ok(AowGame.getLegalActions(state, 'p1').some(a => a.type === 'end-turn'));
});

test('aow: getLegalActions includes move for units with moves', () => {
  const state = AowGame.createInitialState(players());
  assert.ok(AowGame.getLegalActions(state, 'p1').some(a => a.type === 'move'));
});

test('aow: getLegalActions includes skip-unit', () => {
  const state = AowGame.createInitialState(players());
  assert.ok(AowGame.getLegalActions(state, 'p1').some(a => a.type === 'skip-unit'));
});

// ---------------------------------------------------------------------------
// applyActions
// ---------------------------------------------------------------------------

test('aow: end-turn by p1 advances to p2', () => {
  const state = AowGame.createInitialState(players());
  const next  = endTurn(state, 'p1');
  assert.deepEqual(next.activePlayers, ['p2']);
});

test('aow: end-turn by p2 returns to p1 and increments turn', () => {
  const state = AowGame.createInitialState(players());
  const s2    = endTurn(endTurn(state, 'p1'), 'p2');
  assert.equal(s2.turnNumber, 2);
  assert.deepEqual(s2.activePlayers, ['p1']);
});

test('aow: end-turn restores movesLeft for the next player', () => {
  const state = AowGame.createInitialState(players());
  // Exhaust p1 moves
  const exhausted = { ...state, units: state.units.map(u => u.ownerId === 'p1' ? { ...u, movesLeft: 0 } : u) };
  const next = endTurn(exhausted, 'p1');
  // p2 should have fresh moves
  const p2Units = next.units.filter(u => u.ownerId === 'p2');
  assert.ok(p2Units.every(u => u.movesLeft > 0));
});

test('aow: move updates unit position', () => {
  const state = AowGame.createInitialState(players());
  const move  = AowGame.getLegalActions(state, 'p1').find(a => a.type === 'move');
  if (!move) return;
  const next  = AowGame.applyActions(state, [{ playerId: 'p1', action: move }]);
  assert.deepEqual(next.units.find(u => u.id === move.unitId).position, move.to);
});

test('aow: attack can only target adjacent enemies', () => {
  const state   = AowGame.createInitialState(players());
  const attacks = AowGame.getLegalActions(state, 'p1').filter(a => a.type === 'attack');
  for (const atk of attacks) {
    const attacker = state.units.find(u => u.id === atk.unitId);
    const target   = state.units.find(u => u.id === atk.targetId);
    const dx = Math.abs(attacker.position.x - target.position.x);
    const dy = Math.abs(attacker.position.y - target.position.y);
    const dist = Math.max(dx, dy);
    assert.ok(dist >= 1, 'attacker must not be on same tile as target');
  }
});

// ---------------------------------------------------------------------------
// getResult
// ---------------------------------------------------------------------------

test('aow: getResult null while both sides have units', () => {
  assert.equal(AowGame.getResult(AowGame.createInitialState(players())), null);
});

test('aow: getResult win when p2 has no alive units', () => {
  const state = AowGame.createInitialState(players());
  const noP2  = { ...state, units: state.units.map(u => u.ownerId === 'p2' ? { ...u, alive: false, hp: 0 } : u) };
  const result = AowGame.getResult(noP2);
  assert.ok(result !== null);
  assert.equal(result.outcome, 'win');
  assert.equal(result.winnerId, 'p1');
});

// ---------------------------------------------------------------------------
// Self-play
// ---------------------------------------------------------------------------

test('aow: self-play completes with a valid result', async () => {
  const engine = new GameEngine(AowGame, players(), { maxTurns: 150 });
  const { result } = await engine.run();
  assert.ok(['win', 'draw'].includes(result.outcome));
});
