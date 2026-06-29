import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AxisAlliesGame } from './index.js';
import { GameEngine } from '../../engine/index.js';
import { RandomAgent } from '../../agents/index.js';

function players() {
  return [
    { id: 'axis',   name: 'Axis',   agent: RandomAgent },
    { id: 'allies', name: 'Allies', agent: RandomAgent },
  ];
}

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

test('axisallies: both sides have units', () => {
  const state = AxisAlliesGame.createInitialState(players());
  assert.ok(state.units.some(u => u.ownerId === 'axis'   && u.alive));
  assert.ok(state.units.some(u => u.ownerId === 'allies' && u.alive));
});

test('axisallies: starts in purchase phase with axis active', () => {
  const state = AxisAlliesGame.createInitialState(players());
  assert.equal(state.currentPhase, 'purchase');
  assert.deepEqual(state.activePlayers, ['axis']);
});

test('axisallies: board has territories with ownership', () => {
  const state = AxisAlliesGame.createInitialState(players());
  const ownerships = Object.values(state.board.ownership);
  assert.ok(ownerships.some(o => o === 'axis'));
  assert.ok(ownerships.some(o => o === 'allies'));
});

test('axisallies: both sides have starting IPCs', () => {
  const state = AxisAlliesGame.createInitialState(players());
  assert.ok(state.gameSpecific.ipcs.axis   > 0);
  assert.ok(state.gameSpecific.ipcs.allies > 0);
});

// ---------------------------------------------------------------------------
// getLegalActions
// ---------------------------------------------------------------------------

test('axisallies: in purchase phase, includes buy or end-purchase', () => {
  const state = AxisAlliesGame.createInitialState(players());
  const actions = AxisAlliesGame.getLegalActions(state, 'axis');
  assert.ok(actions.length > 0);
  assert.ok(actions.some(a => a.type === 'buy' || a.type === 'end-purchase'));
});

// ---------------------------------------------------------------------------
// applyActions
// ---------------------------------------------------------------------------

test('axisallies: end-purchase advances to combat-move', () => {
  const state = AxisAlliesGame.createInitialState(players());
  const endPurch = AxisAlliesGame.getLegalActions(state, 'axis').find(a => a.type === 'end-purchase');
  if (!endPurch) return;
  const next = AxisAlliesGame.applyActions(state, [{ playerId: 'axis', action: endPurch }]);
  assert.equal(next.currentPhase, 'combat-move');
});

// ---------------------------------------------------------------------------
// getResult
// ---------------------------------------------------------------------------

test('axisallies: getResult null at game start', () => {
  const state = AxisAlliesGame.createInitialState(players());
  assert.equal(AxisAlliesGame.getResult(state), null);
});

test('axisallies: getResult win when one side has no units', () => {
  const state = AxisAlliesGame.createInitialState(players());
  const noAxis = { ...state, units: state.units.map(u => u.ownerId === 'axis' ? { ...u, alive: false } : u) };
  const result = AxisAlliesGame.getResult(noAxis);
  assert.ok(result !== null);
  assert.equal(result.outcome, 'win');
  assert.equal(result.winnerId, 'allies');
});

// ---------------------------------------------------------------------------
// Self-play
// ---------------------------------------------------------------------------

test('axisallies: self-play completes with a valid result', async () => {
  const engine = new GameEngine(AxisAlliesGame, players(), { maxTurns: 2000 });
  const { result } = await engine.run();
  assert.ok(['win', 'draw'].includes(result.outcome));
});
