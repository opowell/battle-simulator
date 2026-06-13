import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CombatMissionGame } from '../games/combatmission/index.js';
import { GameEngine } from '../engine/index.js';
import { RandomAgent } from '../agents/index.js';

function players() {
  return [
    { id: 'allied', name: 'Allied', agent: RandomAgent },
    { id: 'axis',   name: 'Axis',   agent: RandomAgent },
  ];
}

function endTurn(state, playerId) {
  return CombatMissionGame.applyActions(state, [{ playerId, action: { type: 'end-turn', unitId: '__player__' } }]);
}

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

test('combatmission: both sides have units', () => {
  const state = CombatMissionGame.createInitialState(players());
  assert.ok(state.units.some(u => u.ownerId === 'allied' && u.alive));
  assert.ok(state.units.some(u => u.ownerId === 'axis'   && u.alive));
});

test('combatmission: units start with AP', () => {
  const state = CombatMissionGame.createInitialState(players());
  const allied = state.units.filter(u => u.ownerId === 'allied');
  assert.ok(allied.every(u => u.perTurn.ap > 0));
});

test('combatmission: allied player goes first', () => {
  const state = CombatMissionGame.createInitialState(players());
  assert.deepEqual(state.activePlayers, ['allied']);
});

// ---------------------------------------------------------------------------
// getLegalActions
// ---------------------------------------------------------------------------

test('combatmission: getLegalActions includes end-turn and move', () => {
  const state = CombatMissionGame.createInitialState(players());
  const actions = CombatMissionGame.getLegalActions(state, 'allied');
  assert.ok(actions.some(a => a.type === 'end-turn'));
  assert.ok(actions.some(a => a.type === 'move'));
});

test('combatmission: getLegalActions includes skip-unit', () => {
  const state = CombatMissionGame.createInitialState(players());
  const actions = CombatMissionGame.getLegalActions(state, 'allied');
  assert.ok(actions.some(a => a.type === 'skip-unit'));
});

// ---------------------------------------------------------------------------
// applyActions
// ---------------------------------------------------------------------------

test('combatmission: end-turn by allied switches to axis', () => {
  const state = CombatMissionGame.createInitialState(players());
  const next  = endTurn(state, 'allied');
  assert.deepEqual(next.activePlayers, ['axis']);
});

test('combatmission: end-turn by axis returns to allied and increments turn', () => {
  const state = CombatMissionGame.createInitialState(players());
  const s2    = endTurn(endTurn(state, 'allied'), 'axis');
  assert.equal(s2.turnNumber, 2);
  assert.deepEqual(s2.activePlayers, ['allied']);
});

test('combatmission: end-turn restores AP for the next player', () => {
  const state = CombatMissionGame.createInitialState(players());
  // Spend all AP for allied
  const noAP = { ...state, units: state.units.map(u => u.ownerId === 'allied' ? { ...u, perTurn: { ap: 0 } } : u) };
  const next = endTurn(noAP, 'allied');
  // Axis units should have full AP now
  const axisUnits = next.units.filter(u => u.ownerId === 'axis');
  assert.ok(axisUnits.every(u => u.perTurn.ap > 0));
});

test('combatmission: move updates unit position', () => {
  const state = CombatMissionGame.createInitialState(players());
  const move  = CombatMissionGame.getLegalActions(state, 'allied').find(a => a.type === 'move');
  if (!move) return;
  const next  = CombatMissionGame.applyActions(state, [{ playerId: 'allied', action: move }]);
  const moved = next.units.find(u => u.id === move.unitId);
  assert.deepEqual(moved.position, move.to);
});

test('combatmission: skip-unit zeroes AP for that unit', () => {
  const state = CombatMissionGame.createInitialState(players());
  const skip  = CombatMissionGame.getLegalActions(state, 'allied').find(a => a.type === 'skip-unit');
  const next  = CombatMissionGame.applyActions(state, [{ playerId: 'allied', action: skip }]);
  assert.equal(next.units.find(u => u.id === skip.unitId).perTurn.ap, 0);
});

// ---------------------------------------------------------------------------
// getResult
// ---------------------------------------------------------------------------

test('combatmission: getResult null while both sides have units', () => {
  assert.equal(CombatMissionGame.getResult(CombatMissionGame.createInitialState(players())), null);
});

test('combatmission: getResult win when axis has no alive units', () => {
  const state = CombatMissionGame.createInitialState(players());
  const noAxis = { ...state, units: state.units.map(u => u.ownerId === 'axis' ? { ...u, alive: false, hp: 0 } : u) };
  const result = CombatMissionGame.getResult(noAxis);
  assert.equal(result.outcome, 'win');
  assert.equal(result.winnerId, 'allied');
});

// ---------------------------------------------------------------------------
// Self-play
// ---------------------------------------------------------------------------

test('combatmission: self-play completes with a valid result', async () => {
  const engine = new GameEngine(CombatMissionGame, players(), { maxTurns: 150 });
  const { result } = await engine.run();
  assert.ok(['win', 'draw'].includes(result.outcome));
});
