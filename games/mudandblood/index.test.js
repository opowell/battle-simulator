import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MudAndBloodGame } from './index.js';
import { GameEngine } from '../../engine/index.js';
import { RandomAgent } from '../../agents/index.js';

function players() {
  return [
    { id: 'allies', name: 'Allies', agent: RandomAgent },
    { id: 'axis',   name: 'Axis',   agent: RandomAgent },
  ];
}

function endTurn(state, playerId) {
  return MudAndBloodGame.applyActions(state, [{ playerId, action: { type: 'end-turn', unitId: '__player__' } }]);
}

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

test('mnb: has allied and axis units at game start', () => {
  const state = MudAndBloodGame.createInitialState(players());
  assert.ok(state.units.some(u => u.ownerId === 'allies' && u.alive));
  assert.ok(state.units.some(u => u.ownerId === 'axis'   && u.alive));
});

test('mnb: allies go first', () => {
  const state = MudAndBloodGame.createInitialState(players());
  assert.deepEqual(state.activePlayers, ['allies']);
  assert.equal(state.currentPhase, 'allies-turn');
});

test('mnb: wave 1 starts with 3 axis units', () => {
  const state = MudAndBloodGame.createInitialState(players());
  const axisUnits = state.units.filter(u => u.ownerId === 'axis');
  assert.equal(axisUnits.length, 3);
});

test('mnb: allied units start in trench or sandbags (y >= 7)', () => {
  const state = MudAndBloodGame.createInitialState(players());
  const allies = state.units.filter(u => u.ownerId === 'allies');
  assert.ok(allies.every(u => u.position.y >= 7));
});

test('mnb: axis units spawn at y=0', () => {
  const state = MudAndBloodGame.createInitialState(players());
  const axisUnits = state.units.filter(u => u.ownerId === 'axis');
  assert.ok(axisUnits.every(u => u.position.y === 0));
});

// ---------------------------------------------------------------------------
// getLegalActions
// ---------------------------------------------------------------------------

test('mnb: getLegalActions always includes end-turn', () => {
  const state = MudAndBloodGame.createInitialState(players());
  const actions = MudAndBloodGame.getLegalActions(state, 'allies');
  assert.ok(actions.some(a => a.type === 'end-turn'));
});

test('mnb: getLegalActions includes move actions for units with AP', () => {
  const state = MudAndBloodGame.createInitialState(players());
  const actions = MudAndBloodGame.getLegalActions(state, 'allies');
  assert.ok(actions.some(a => a.type === 'move'));
});

// ---------------------------------------------------------------------------
// applyActions — move
// ---------------------------------------------------------------------------

test('mnb: move updates position and spends 1 AP', () => {
  const state = MudAndBloodGame.createInitialState(players());
  const unit  = state.units.find(u => u.ownerId === 'allies' && u.perTurn.ap > 0);
  const move  = MudAndBloodGame.getLegalActions(state, 'allies').find(a => a.type === 'move' && a.unitId === unit.id);
  if (!move) return;
  const next   = MudAndBloodGame.applyActions(state, [{ playerId: 'allies', action: move }]);
  const moved  = next.units.find(u => u.id === unit.id);
  assert.deepEqual(moved.position, move.to);
  assert.equal(moved.perTurn.ap, unit.perTurn.ap - 1);
});

// ---------------------------------------------------------------------------
// applyActions — shoot
// ---------------------------------------------------------------------------

test('mnb: shoot spends all AP', () => {
  const state = MudAndBloodGame.createInitialState(players());
  // Axis shoot at allies (axis turn)
  const s1 = endTurn(state, 'allies');
  const shoot = MudAndBloodGame.getLegalActions(s1, 'axis').find(a => a.type === 'shoot');
  if (!shoot) return;
  const next    = MudAndBloodGame.applyActions(s1, [{ playerId: 'axis', action: shoot }]);
  const shooter = next.units.find(u => u.id === shoot.unitId);
  assert.equal(shooter.perTurn.ap, 0);
});

test('mnb: target gains suppression when shot at', () => {
  // Force a deterministic hit by patching rng
  const state  = MudAndBloodGame.createInitialState(players());
  const s1     = endTurn(state, 'allies');
  const shoot  = MudAndBloodGame.getLegalActions(s1, 'axis').find(a => a.type === 'shoot');
  if (!shoot) return;
  const alwaysHit = () => 0.01; // roll = 1 → always hit
  const next   = MudAndBloodGame.applyActions(s1, [{ playerId: 'axis', action: shoot }], alwaysHit);
  const target = next.units.find(u => u.id === shoot.targetId);
  assert.equal(target.suppression, 1);
});

// ---------------------------------------------------------------------------
// applyActions — end-turn
// ---------------------------------------------------------------------------

test('mnb: end-turn switches phase', () => {
  const state = MudAndBloodGame.createInitialState(players());
  const next  = endTurn(state, 'allies');
  assert.deepEqual(next.activePlayers, ['axis']);
  assert.equal(next.currentPhase, 'axis-turn');
});

test('mnb: completing both turns increments turnNumber', () => {
  const state = MudAndBloodGame.createInitialState(players());
  const s1 = endTurn(state, 'allies');
  const s2 = endTurn(s1,    'axis');
  assert.equal(s2.turnNumber, 2);
  assert.deepEqual(s2.activePlayers, ['allies']);
});

test('mnb: AP resets for next player on end-turn', () => {
  const state = MudAndBloodGame.createInitialState(players());
  const s1 = endTurn(state, 'allies');
  const axisUnits = s1.units.filter(u => u.ownerId === 'axis');
  assert.ok(axisUnits.every(u => u.perTurn.ap > 0));
});

// ---------------------------------------------------------------------------
// Wave spawning
// ---------------------------------------------------------------------------

test('mnb: wave 2 spawns after 4 complete rounds', () => {
  let state = MudAndBloodGame.createInitialState(players());
  assert.equal(state.wave, 1);
  // Advance 4 complete rounds (allies + axis end-turn × 4)
  for (let i = 0; i < 4; i++) {
    state = endTurn(state, 'allies');
    state = endTurn(state, 'axis');
  }
  assert.equal(state.wave, 2);
  assert.ok(state.units.some(u => u.id.startsWith('axis-w2')));
});

// ---------------------------------------------------------------------------
// getResult
// ---------------------------------------------------------------------------

test('mnb: getResult null while game is ongoing', () => {
  const state = MudAndBloodGame.createInitialState(players());
  assert.equal(MudAndBloodGame.getResult(state), null);
});

test('mnb: Axis wins when a unit reaches y=8', () => {
  const state    = MudAndBloodGame.createInitialState(players());
  const axisUnit = state.units.find(u => u.ownerId === 'axis');
  const breached = {
    ...state,
    units: state.units.map(u =>
      u.id === axisUnit.id ? { ...u, position: { x: 5, y: 8 } } : u
    ),
  };
  const result = MudAndBloodGame.getResult(breached);
  assert.equal(result.outcome, 'win');
  assert.equal(result.winnerId, 'axis');
  assert.equal(result.reason, 'trench-breached');
});

test('mnb: Allies win when all 6 waves defeated', () => {
  const state   = MudAndBloodGame.createInitialState(players());
  const noAxis  = { ...state, wave: 6, units: state.units.map(u =>
    u.ownerId === 'axis' ? { ...u, alive: false, hp: 0 } : u
  )};
  const result  = MudAndBloodGame.getResult(noAxis);
  assert.equal(result.outcome, 'win');
  assert.equal(result.winnerId, 'allies');
});

// ---------------------------------------------------------------------------
// Self-play
// ---------------------------------------------------------------------------

test('mnb: self-play completes with a valid result', async () => {
  const engine = new GameEngine(MudAndBloodGame, players(), { maxTurns: 150 });
  const { result } = await engine.run();
  assert.ok(['win', 'draw'].includes(result.outcome));
});
