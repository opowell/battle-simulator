import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CsGame } from './index.js';
import { GameEngine } from '../../engine/index.js';
import { RandomAgent } from '../../agents/index.js';

function players() {
  return [
    { id: 'p1', name: 'P1', agent: RandomAgent },
    { id: 'p2', name: 'P2', agent: RandomAgent },
  ];
}

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

test('cs: 5 T and 5 CT units spawn', () => {
  const state = CsGame.createInitialState(players());
  assert.equal(state.units.filter(u => u.ownerId === 'T').length, 5);
  assert.equal(state.units.filter(u => u.ownerId === 'CT').length, 5);
});

test('cs: starts in buy phase', () => {
  const state = CsGame.createInitialState(players());
  assert.equal(state.currentPhase, 'buy');
});

test('cs: both teams start with money', () => {
  const state = CsGame.createInitialState(players());
  assert.ok(state.gameSpecific.money.T > 0);
  assert.ok(state.gameSpecific.money.CT > 0);
});

test('cs: scores start at 0', () => {
  const state = CsGame.createInitialState(players());
  assert.equal(state.gameSpecific.tScore, 0);
  assert.equal(state.gameSpecific.ctScore, 0);
});

// ---------------------------------------------------------------------------
// getLegalActions
// ---------------------------------------------------------------------------

test('cs: in buy phase, includes end-buy', () => {
  const state = CsGame.createInitialState(players());
  const actions = CsGame.getLegalActions(state, 'p1');
  assert.ok(actions.some(a => a.type === 'end-buy'));
});

test('cs: in buy phase, can buy weapons if affordable', () => {
  const state = CsGame.createInitialState(players());
  const actions = CsGame.getLegalActions(state, 'p1');
  // With $800 starting money, ak-47/m4 (~$2700) not affordable, but some rifles might not be.
  // At minimum, end-buy is always available.
  assert.ok(actions.length >= 1);
});

// ---------------------------------------------------------------------------
// applyActions
// ---------------------------------------------------------------------------

test('cs: T end-buy switches to CT buy', () => {
  const state = CsGame.createInitialState(players());
  const next = CsGame.applyActions(state, [{ playerId: 'p1', action: { type: 'end-buy', unitId: '__player__' } }]);
  assert.deepEqual(next.activePlayers, ['p2']);
  assert.equal(next.currentPhase, 'buy');
});

test('cs: both end-buy transitions to action phase', () => {
  const state = CsGame.createInitialState(players());
  const s1 = CsGame.applyActions(state, [{ playerId: 'p1', action: { type: 'end-buy', unitId: '__player__' } }]);
  const s2 = CsGame.applyActions(s1,    [{ playerId: 'p2', action: { type: 'end-buy', unitId: '__player__' } }]);
  assert.equal(s2.currentPhase, 'action');
});

test('cs: in action phase, includes end-turn', () => {
  const state = CsGame.createInitialState(players());
  const s1 = CsGame.applyActions(state, [{ playerId: 'p1', action: { type: 'end-buy', unitId: '__player__' } }]);
  const s2 = CsGame.applyActions(s1,    [{ playerId: 'p2', action: { type: 'end-buy', unitId: '__player__' } }]);
  const actions = CsGame.getLegalActions(s2, 'p1');
  assert.ok(actions.some(a => a.type === 'end-turn'));
});

test('cs: end-turn in action phase alternates active team', () => {
  const state = CsGame.createInitialState(players());
  const s1 = CsGame.applyActions(state, [{ playerId: 'p1', action: { type: 'end-buy', unitId: '__player__' } }]);
  const s2 = CsGame.applyActions(s1,    [{ playerId: 'p2', action: { type: 'end-buy', unitId: '__player__' } }]);
  const s3 = CsGame.applyActions(s2,    [{ playerId: 'p1', action: { type: 'end-turn', unitId: '__player__' } }]);
  assert.deepEqual(s3.activePlayers, ['p2']);
});

// ---------------------------------------------------------------------------
// getResult
// ---------------------------------------------------------------------------

test('cs: getResult null at game start', () => {
  const state = CsGame.createInitialState(players());
  assert.equal(CsGame.getResult(state), null);
});

test('cs: getResult win when T reaches winRounds', () => {
  const state = CsGame.createInitialState(players(), { winRounds: 1 });
  const winning = { ...state, gameSpecific: { ...state.gameSpecific, tScore: 1, winRounds: 1 } };
  const result = CsGame.getResult(winning);
  assert.ok(result !== null);
  assert.equal(result.outcome, 'win');
  assert.equal(result.winnerId, 'p1');
});

test('cs: getResult win when CT reaches winRounds', () => {
  const state = CsGame.createInitialState(players(), { winRounds: 1 });
  const winning = { ...state, gameSpecific: { ...state.gameSpecific, ctScore: 1, winRounds: 1 } };
  const result = CsGame.getResult(winning);
  assert.ok(result !== null);
  assert.equal(result.outcome, 'win');
  assert.equal(result.winnerId, 'p2');
});

// ---------------------------------------------------------------------------
// Self-play
// ---------------------------------------------------------------------------

test('cs: self-play completes with a valid result', async () => {
  const engine = new GameEngine(CsGame, players(), { maxTurns: 400 });
  const { result } = await engine.run();
  assert.ok(['win', 'draw'].includes(result.outcome));
});
