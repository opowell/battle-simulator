import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sc2Game, UNITS } from './index.js';
import { GameEngine } from '../../engine/index.js';
import { RandomAgent } from '../../agents/index.js';

function players(race1 = 'terran', race2 = 'zerg') {
  return [
    { id: 'p1', name: 'P1', agent: RandomAgent, race: race1 },
    { id: 'p2', name: 'P2', agent: RandomAgent, race: race2 },
  ];
}

function endTurn(state, playerId) {
  return Sc2Game.applyActions(state, [{ playerId, action: { type: 'end-turn', unitId: '__player__' } }]);
}

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

test('sc2: both players have a main building', () => {
  const state = Sc2Game.createInitialState(players());
  assert.ok(state.buildings.some(b => b.ownerId === 'p1' && b.alive));
  assert.ok(state.buildings.some(b => b.ownerId === 'p2' && b.alive));
});

test('sc2: both players have workers', () => {
  const state = Sc2Game.createInitialState(players());
  assert.ok(state.units.some(u => u.ownerId === 'p1' && UNITS[u.type]?.special.includes('worker')));
  assert.ok(state.units.some(u => u.ownerId === 'p2' && UNITS[u.type]?.special.includes('worker')));
});

test('sc2: both players start with 50 minerals', () => {
  const state = Sc2Game.createInitialState(players());
  assert.equal(state.gameSpecific.resources['p1'].minerals, 50);
  assert.equal(state.gameSpecific.resources['p2'].minerals, 50);
});

test('sc2: p1 active first, turn 1', () => {
  const state = Sc2Game.createInitialState(players());
  assert.deepEqual(state.activePlayers, ['p1']);
  assert.equal(state.turnNumber, 1);
});

test('sc2: supports all three race combinations', () => {
  for (const [r1, r2] of [['terran','zerg'], ['zerg','protoss'], ['protoss','terran']]) {
    const state = Sc2Game.createInitialState(players(r1, r2));
    assert.ok(state.buildings.some(b => b.ownerId === 'p1' && b.alive));
    assert.ok(state.buildings.some(b => b.ownerId === 'p2' && b.alive));
  }
});

// ---------------------------------------------------------------------------
// getLegalActions
// ---------------------------------------------------------------------------

test('sc2: getLegalActions always includes end-turn', () => {
  const state = Sc2Game.createInitialState(players());
  assert.ok(Sc2Game.getLegalActions(state, 'p1').some(a => a.type === 'end-turn'));
});

test('sc2: workers can gather minerals when adjacent', () => {
  const state = Sc2Game.createInitialState(players());
  const actions = Sc2Game.getLegalActions(state, 'p1');
  assert.ok(actions.some(a => a.type === 'gather-minerals' || a.type === 'move'));
});

test('sc2: gather-minerals sets worker gathering state', () => {
  const state  = Sc2Game.createInitialState(players());
  const gather = Sc2Game.getLegalActions(state, 'p1').find(a => a.type === 'gather-minerals');
  if (!gather) return;
  const next = Sc2Game.applyActions(state, [{ playerId: 'p1', action: gather }]);
  const worker = next.units.find(u => u.id === gather.unitId);
  assert.equal(worker.attrs.gathering, 'minerals');
  assert.equal(worker.movesLeft, 0);
});

// ---------------------------------------------------------------------------
// applyActions
// ---------------------------------------------------------------------------

test('sc2: end-turn advances to p2', () => {
  const state = Sc2Game.createInitialState(players());
  const next  = endTurn(state, 'p1');
  assert.deepEqual(next.activePlayers, ['p2']);
});

test('sc2: end-turn by p2 increments turn and returns to p1', () => {
  const state = Sc2Game.createInitialState(players());
  const s2    = endTurn(endTurn(state, 'p1'), 'p2');
  assert.equal(s2.turnNumber, 2);
  assert.deepEqual(s2.activePlayers, ['p1']);
});

test('sc2: end-turn collects mineral income for gathering workers', () => {
  const state = Sc2Game.createInitialState(players());
  // Assign a worker to minerals
  const gather = Sc2Game.getLegalActions(state, 'p1').find(a => a.type === 'gather-minerals');
  if (!gather) return;
  const s1 = Sc2Game.applyActions(state, [{ playerId: 'p1', action: gather }]);
  const s2 = endTurn(s1, 'p1'); // end-turn for p1 → collects income
  const before = state.gameSpecific.resources['p1'].minerals;
  const after  = s2.gameSpecific.resources['p1'].minerals;
  assert.ok(after > before, 'minerals should increase after end-turn with a gathering worker');
});

test('sc2: move updates unit position', () => {
  const state = Sc2Game.createInitialState(players());
  const move  = Sc2Game.getLegalActions(state, 'p1').find(a => a.type === 'move');
  if (!move) return;
  const next = Sc2Game.applyActions(state, [{ playerId: 'p1', action: move }]);
  const moved = next.units.find(u => u.id === move.unitId);
  assert.deepEqual(moved.position, move.to);
});

// ---------------------------------------------------------------------------
// getResult
// ---------------------------------------------------------------------------

test('sc2: getResult null initially', () => {
  assert.equal(Sc2Game.getResult(Sc2Game.createInitialState(players())), null);
});

test('sc2: getResult win when p2 has no main building and no units', () => {
  const state = Sc2Game.createInitialState(players());
  const noP2 = {
    ...state,
    buildings: state.buildings.filter(b => b.ownerId !== 'p2'),
    units:     state.units.filter(u => u.ownerId !== 'p2'),
  };
  const result = Sc2Game.getResult(noP2);
  assert.equal(result.outcome, 'win');
  assert.equal(result.winnerId, 'p1');
});

// ---------------------------------------------------------------------------
// Self-play
// ---------------------------------------------------------------------------

test('sc2: self-play completes with a valid result', async () => {
  const engine = new GameEngine(Sc2Game, players(), { maxTurns: 80 });
  const { result } = await engine.run();
  assert.ok(['win', 'draw'].includes(result.outcome));
});
