import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sc1Game, UNITS } from './index.js';
import { GameEngine } from '../../engine/index.js';
import { RandomAgent } from '../../agents/index.js';

function players(race1 = 'terran', race2 = 'zerg') {
  return [
    { id: 'p1', name: 'P1', agent: RandomAgent, race: race1 },
    { id: 'p2', name: 'P2', agent: RandomAgent, race: race2 },
  ];
}

function endTurn(state, playerId) {
  return Sc1Game.applyActions(state, [{ playerId, action: { type: 'end-turn', unitId: '__player__' } }]);
}

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

test('sc1: both players have a main building', () => {
  const state = Sc1Game.createInitialState(players());
  assert.ok(state.buildings.some(b => b.ownerId === 'p1' && b.alive));
  assert.ok(state.buildings.some(b => b.ownerId === 'p2' && b.alive));
});

test('sc1: both players have workers', () => {
  const state = Sc1Game.createInitialState(players());
  assert.ok(state.units.some(u => u.ownerId === 'p1' && UNITS[u.type]?.special.includes('worker')));
  assert.ok(state.units.some(u => u.ownerId === 'p2' && UNITS[u.type]?.special.includes('worker')));
});

test('sc1: both players start with 50 minerals', () => {
  const state = Sc1Game.createInitialState(players());
  assert.equal(state.gameSpecific.resources['p1'].minerals, 50);
  assert.equal(state.gameSpecific.resources['p2'].minerals, 50);
});

test('sc1: p1 active first', () => {
  const state = Sc1Game.createInitialState(players());
  assert.deepEqual(state.activePlayers, ['p1']);
});

// ---------------------------------------------------------------------------
// getLegalActions
// ---------------------------------------------------------------------------

test('sc1: getLegalActions always includes end-turn', () => {
  const state = Sc1Game.createInitialState(players());
  assert.ok(Sc1Game.getLegalActions(state, 'p1').some(a => a.type === 'end-turn'));
});

test('sc1: workers can gather minerals or move', () => {
  const state = Sc1Game.createInitialState(players());
  const actions = Sc1Game.getLegalActions(state, 'p1');
  assert.ok(actions.some(a => a.type === 'gather-minerals' || a.type === 'move'));
});

// ---------------------------------------------------------------------------
// applyActions
// ---------------------------------------------------------------------------

test('sc1: end-turn advances to p2', () => {
  const state = Sc1Game.createInitialState(players());
  const next  = endTurn(state, 'p1');
  assert.deepEqual(next.activePlayers, ['p2']);
});

test('sc1: end-turn by p2 returns to p1 and increments turn', () => {
  const state = Sc1Game.createInitialState(players());
  const s2    = endTurn(endTurn(state, 'p1'), 'p2');
  assert.equal(s2.turnNumber, 2);
  assert.deepEqual(s2.activePlayers, ['p1']);
});

test('sc1: gather-minerals assigns gathering attribute', () => {
  const state  = Sc1Game.createInitialState(players());
  const gather = Sc1Game.getLegalActions(state, 'p1').find(a => a.type === 'gather-minerals');
  if (!gather) return;
  const next = Sc1Game.applyActions(state, [{ playerId: 'p1', action: gather }]);
  assert.equal(next.units.find(u => u.id === gather.unitId).attrs.gathering, 'minerals');
});

// ---------------------------------------------------------------------------
// getResult
// ---------------------------------------------------------------------------

test('sc1: getResult null initially', () => {
  assert.equal(Sc1Game.getResult(Sc1Game.createInitialState(players())), null);
});

test('sc1: getResult win when p2 has no main building and no units', () => {
  const state = Sc1Game.createInitialState(players());
  const noP2 = {
    ...state,
    buildings: state.buildings.filter(b => b.ownerId !== 'p2'),
    units:     state.units.filter(u => u.ownerId !== 'p2'),
  };
  const result = Sc1Game.getResult(noP2);
  assert.equal(result.outcome, 'win');
  assert.equal(result.winnerId, 'p1');
});

// ---------------------------------------------------------------------------
// Self-play
// ---------------------------------------------------------------------------

test('sc1: self-play completes with a valid result', async () => {
  const engine = new GameEngine(Sc1Game, players(), { maxTurns: 80 });
  const { result } = await engine.run();
  assert.ok(['win', 'draw'].includes(result.outcome));
});
