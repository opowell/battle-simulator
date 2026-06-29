import { test } from 'node:test';
import assert from 'node:assert/strict';
import { XComGame } from './index.js';
import { GameEngine } from '../../engine/index.js';
import { RandomAgent } from '../../agents/index.js';

function players() {
  return [
    { id: 'xcom',   name: 'XCOM',   agent: RandomAgent },
    { id: 'aliens', name: 'Aliens', agent: RandomAgent },
  ];
}

function endTurn(state, playerId) {
  return XComGame.applyActions(state, [{ playerId, action: { type: 'end-turn', unitId: '__player__' } }]);
}

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

test('xcom: has XCOM and alien units', () => {
  const state = XComGame.createInitialState(players());
  assert.ok(state.units.some(u => u.ownerId === 'xcom'   && u.alive));
  assert.ok(state.units.some(u => u.ownerId === 'aliens' && u.alive));
});

test('xcom: XCOM goes first', () => {
  const state = XComGame.createInitialState(players());
  assert.deepEqual(state.activePlayers, ['xcom']);
  assert.equal(state.currentPhase, 'xcom-turn');
});

test('xcom: XCOM units start with AP', () => {
  const state = XComGame.createInitialState(players());
  const xcomUnits = state.units.filter(u => u.ownerId === 'xcom');
  assert.ok(xcomUnits.every(u => u.perTurn.ap > 0));
});

// ---------------------------------------------------------------------------
// getLegalActions
// ---------------------------------------------------------------------------

test('xcom: getLegalActions always includes end-turn', () => {
  const state = XComGame.createInitialState(players());
  const actions = XComGame.getLegalActions(state, 'xcom');
  assert.ok(actions.some(a => a.type === 'end-turn'));
});

test('xcom: getLegalActions includes move for units with AP', () => {
  const state = XComGame.createInitialState(players());
  const actions = XComGame.getLegalActions(state, 'xcom');
  assert.ok(actions.some(a => a.type === 'move'));
});

// ---------------------------------------------------------------------------
// applyActions
// ---------------------------------------------------------------------------

test('xcom: end-turn switches to aliens', () => {
  const state = XComGame.createInitialState(players());
  const next = endTurn(state, 'xcom');
  assert.deepEqual(next.activePlayers, ['aliens']);
  assert.equal(next.currentPhase, 'aliens-turn');
});

test('xcom: end-turn by aliens restores XCOM AP and increments turn', () => {
  const state = XComGame.createInitialState(players());
  const s1 = endTurn(state, 'xcom');
  const s2 = endTurn(s1, 'aliens');
  assert.equal(s2.turnNumber, 2);
  assert.deepEqual(s2.activePlayers, ['xcom']);
  const xcomUnits = s2.units.filter(u => u.ownerId === 'xcom');
  assert.ok(xcomUnits.every(u => u.perTurn.ap > 0));
});

test('xcom: move updates unit position and spends 1 AP', () => {
  const state = XComGame.createInitialState(players());
  const unit  = state.units.find(u => u.ownerId === 'xcom' && u.perTurn.ap > 0);
  const move  = XComGame.getLegalActions(state, 'xcom').find(a => a.type === 'move' && a.unitId === unit.id);
  if (!move) return;
  const next = XComGame.applyActions(state, [{ playerId: 'xcom', action: move }]);
  const moved = next.units.find(u => u.id === unit.id);
  assert.deepEqual(moved.position, move.to);
  assert.equal(moved.perTurn.ap, unit.perTurn.ap - 1);
});

test('xcom: shoot spends all AP', () => {
  const state = XComGame.createInitialState(players());
  const shoot = XComGame.getLegalActions(state, 'xcom').find(a => a.type === 'shoot');
  if (!shoot) return;
  const next = XComGame.applyActions(state, [{ playerId: 'xcom', action: shoot }]);
  const shooter = next.units.find(u => u.id === shoot.unitId);
  assert.equal(shooter.perTurn.ap, 0);
});

// ---------------------------------------------------------------------------
// getResult
// ---------------------------------------------------------------------------

test('xcom: getResult null while both sides alive', () => {
  const state = XComGame.createInitialState(players());
  assert.equal(XComGame.getResult(state), null);
});

test('xcom: getResult win for XCOM when all aliens dead', () => {
  const state = XComGame.createInitialState(players());
  const noAliens = { ...state, units: state.units.map(u => u.ownerId === 'aliens' ? { ...u, alive: false, hp: 0 } : u) };
  const result = XComGame.getResult(noAliens);
  assert.equal(result.outcome, 'win');
  assert.equal(result.winnerId, 'xcom');
});

test('xcom: getResult win for aliens when XCOM squad eliminated', () => {
  const state = XComGame.createInitialState(players());
  const noXcom = { ...state, units: state.units.map(u => u.ownerId === 'xcom' ? { ...u, alive: false, hp: 0 } : u) };
  const result = XComGame.getResult(noXcom);
  assert.equal(result.outcome, 'win');
  assert.equal(result.winnerId, 'aliens');
});

// ---------------------------------------------------------------------------
// Self-play
// ---------------------------------------------------------------------------

test('xcom: self-play completes with a valid result', async () => {
  const engine = new GameEngine(XComGame, players(), { maxTurns: 100 });
  const { result } = await engine.run();
  assert.ok(['win', 'draw'].includes(result.outcome));
});
