import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DoomGame } from './index.js';
import { GameEngine } from '../../engine/index.js';
import { RandomAgent } from '../../agents/index.js';

function players() {
  return [
    { id: 'p1', name: 'Marine', agent: RandomAgent },
    { id: 'p2', name: 'Demon',  agent: RandomAgent },
  ];
}

function endTurn(state, playerId) {
  return DoomGame.applyActions(state, [{ playerId, action: { type: 'end-turn', unitId: '__player__' } }]);
}

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

test('doom: has marine and demon units', () => {
  const state = DoomGame.createInitialState(players());
  assert.ok(state.units.some(u => u.ownerId === 'marine' && u.alive));
  assert.ok(state.units.some(u => u.ownerId === 'demon'  && u.alive));
});

test('doom: starts with marine-turn phase, p1 active', () => {
  const state = DoomGame.createInitialState(players());
  assert.equal(state.currentPhase, 'marine-turn');
  assert.deepEqual(state.activePlayers, ['p1']);
});

test('doom: items are placed on the map', () => {
  const state = DoomGame.createInitialState(players());
  assert.ok(state.gameSpecific.items.length > 0);
  assert.ok(state.gameSpecific.items.every(i => !i.pickedUp));
});

// ---------------------------------------------------------------------------
// getLegalActions
// ---------------------------------------------------------------------------

test('doom: marine always has end-turn and move available', () => {
  const state = DoomGame.createInitialState(players());
  const actions = DoomGame.getLegalActions(state, 'p1');
  assert.ok(actions.some(a => a.type === 'end-turn'));
  assert.ok(actions.some(a => a.type === 'move'));
});

// ---------------------------------------------------------------------------
// applyActions
// ---------------------------------------------------------------------------

test('doom: end-turn by marine switches to demon', () => {
  const state = DoomGame.createInitialState(players());
  const next = endTurn(state, 'p1');
  assert.deepEqual(next.activePlayers, ['p2']);
  assert.equal(next.currentPhase, 'demon-turn');
});

test('doom: end-turn by demon returns to marine and increments turn', () => {
  const state = DoomGame.createInitialState(players());
  const s1 = endTurn(state, 'p1');
  const s2 = endTurn(s1, 'p2');
  assert.deepEqual(s2.activePlayers, ['p1']);
  assert.equal(s2.turnNumber, 2);
});

test('doom: move updates unit position and spends 1 AP', () => {
  const state = DoomGame.createInitialState(players());
  const marine = state.units.find(u => u.ownerId === 'marine' && u.perTurn.ap > 0);
  const move   = DoomGame.getLegalActions(state, 'p1').find(a => a.type === 'move' && a.unitId === marine.id);
  if (!move) return;
  const next = DoomGame.applyActions(state, [{ playerId: 'p1', action: move }]);
  const moved = next.units.find(u => u.id === marine.id);
  assert.deepEqual(moved.position, move.to);
  assert.equal(moved.perTurn.ap, marine.perTurn.ap - 1);
});

// ---------------------------------------------------------------------------
// getResult
// ---------------------------------------------------------------------------

test('doom: getResult null while both sides alive', () => {
  const state = DoomGame.createInitialState(players());
  assert.equal(DoomGame.getResult(state), null);
});

test('doom: getResult demon wins when marine is dead', () => {
  const state = DoomGame.createInitialState(players());
  const noMarine = { ...state, units: state.units.map(u => u.ownerId === 'marine' ? { ...u, alive: false, hp: 0 } : u) };
  const result = DoomGame.getResult(noMarine);
  assert.equal(result.outcome, 'win');
  assert.equal(result.winnerId, 'p2');
});

test('doom: getResult marine wins when all demons dead', () => {
  const state = DoomGame.createInitialState(players());
  const noDemon = { ...state, units: state.units.map(u => u.ownerId === 'demon' ? { ...u, alive: false, hp: 0 } : u) };
  const result = DoomGame.getResult(noDemon);
  assert.equal(result.outcome, 'win');
  assert.equal(result.winnerId, 'p1');
});

// ---------------------------------------------------------------------------
// Self-play
// ---------------------------------------------------------------------------

test('doom: self-play completes with a valid result', async () => {
  const engine = new GameEngine(DoomGame, players(), { maxTurns: 120 });
  const { result } = await engine.run();
  assert.ok(['win', 'draw'].includes(result.outcome));
});
