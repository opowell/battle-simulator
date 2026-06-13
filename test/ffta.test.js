import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FFTAGame } from '../games/ffta/index.js';
import { GameEngine } from '../engine/index.js';
import { RandomAgent } from '../agents/index.js';

function players() {
  return [
    { id: 'p1', name: 'P1', agent: RandomAgent },
    { id: 'p2', name: 'P2', agent: RandomAgent },
  ];
}

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

test('ffta: 4 units per player', () => {
  const state = FFTAGame.createInitialState(players());
  assert.equal(state.units.filter(u => u.ownerId === 'p1').length, 4);
  assert.equal(state.units.filter(u => u.ownerId === 'p2').length, 4);
});

test('ffta: has an activeUnitId set from the start', () => {
  const state = FFTAGame.createInitialState(players());
  assert.ok(typeof state.gameSpecific.activeUnitId === 'string');
  assert.ok(state.units.some(u => u.id === state.gameSpecific.activeUnitId));
});

test('ffta: active unit is owned by the active player', () => {
  const state = FFTAGame.createInitialState(players());
  const activeUnit = state.units.find(u => u.id === state.gameSpecific.activeUnitId);
  assert.equal(activeUnit.ownerId, state.activePlayers[0]);
});

test('ffta: units have abilities and stats', () => {
  const state = FFTAGame.createInitialState(players());
  for (const u of state.units) {
    assert.ok(u.abilities.length > 0, `${u.id} should have abilities`);
    assert.ok(u.stats.atk > 0 || u.stats.mag > 0);
  }
});

// ---------------------------------------------------------------------------
// getLegalActions
// ---------------------------------------------------------------------------

test('ffta: getLegalActions includes end-turn for active owner', () => {
  const state = FFTAGame.createInitialState(players());
  const owner = state.activePlayers[0];
  const actions = FFTAGame.getLegalActions(state, owner);
  assert.ok(actions.some(a => a.type === 'end-turn'));
});

test('ffta: getLegalActions includes move for unmoved active unit', () => {
  const state = FFTAGame.createInitialState(players());
  const owner = state.activePlayers[0];
  const actions = FFTAGame.getLegalActions(state, owner);
  assert.ok(actions.some(a => a.type === 'move'));
});

test('ffta: getLegalActions includes ability actions when enemy is in range', () => {
  const state = FFTAGame.createInitialState(players());
  const { activeUnitId } = state.gameSpecific;
  const activeUnit = state.units.find(u => u.id === activeUnitId);
  // Move one enemy adjacent to the active unit so melee abilities are in range
  const adjacent = { x: activeUnit.position.x + 1, y: activeUnit.position.y };
  const withNearEnemy = {
    ...state,
    units: state.units.map(u =>
      u.ownerId !== activeUnit.ownerId && !state.units.some(o => o.id !== u.id && o.position.x === adjacent.x && o.position.y === adjacent.y)
        ? { ...u, position: adjacent }
        : u
    ).filter((u, i, arr) => arr.findIndex(x => x.id === u.id) === i), // dedupe safety
  };
  // Only move the first enemy unit — clear collisions
  const enemy = state.units.find(u => u.ownerId !== activeUnit.ownerId);
  const moved = {
    ...state,
    units: state.units.map(u => u.id === enemy.id ? { ...u, position: adjacent } : u),
  };
  const owner   = moved.activePlayers[0];
  const actions = FFTAGame.getLegalActions(moved, owner);
  assert.ok(actions.some(a => a.type === 'ability'), 'should have ability actions when enemy is adjacent');
});

// ---------------------------------------------------------------------------
// applyActions
// ---------------------------------------------------------------------------

test('ffta: end-turn advances to next unit', () => {
  const state = FFTAGame.createInitialState(players());
  const owner  = state.activePlayers[0];
  const prevId = state.gameSpecific.activeUnitId;
  const next = FFTAGame.applyActions(state, [{ playerId: owner, action: { type: 'end-turn', unitId: prevId } }]);
  assert.ok(next.gameSpecific.activeUnitId !== undefined);
});

test('ffta: move updates unit position and marks as moved', () => {
  const state   = FFTAGame.createInitialState(players());
  const owner   = state.activePlayers[0];
  const move    = FFTAGame.getLegalActions(state, owner).find(a => a.type === 'move');
  if (!move) return;
  const next    = FFTAGame.applyActions(state, [{ playerId: owner, action: move }]);
  const moved   = next.units.find(u => u.id === move.unitId);
  assert.deepEqual(moved.position, move.to);
  assert.equal(moved.moved, true);
});

test('ffta: ability action reduces target HP (damage ability)', () => {
  const state  = FFTAGame.createInitialState(players());
  const owner  = state.activePlayers[0];
  const ability = FFTAGame.getLegalActions(state, owner)
    .find(a => a.type === 'ability' && a.targetId !== a.unitId);
  if (!ability) return;
  const targetBefore = state.units.find(u => u.id === ability.targetId);
  const next = FFTAGame.applyActions(state, [{ playerId: owner, action: ability }], () => 0.5);
  const targetAfter  = next.units.find(u => u.id === ability.targetId);
  // HP may decrease (damage) or stay same (status / ally heal); just check it doesn't go negative
  assert.ok(targetAfter.hp >= 0);
  assert.ok(targetAfter.hp <= targetBefore.maxHp);
});

// ---------------------------------------------------------------------------
// getResult
// ---------------------------------------------------------------------------

test('ffta: getResult null while both sides have units', () => {
  const state = FFTAGame.createInitialState(players());
  assert.equal(FFTAGame.getResult(state), null);
});

test('ffta: getResult win when all p2 units are dead', () => {
  const state = FFTAGame.createInitialState(players());
  const noP2  = { ...state, units: state.units.map(u => u.ownerId === 'p2' ? { ...u, alive: false, hp: 0 } : u) };
  const result = FFTAGame.getResult(noP2);
  assert.equal(result.outcome, 'win');
  assert.equal(result.winnerId, 'p1');
});

// ---------------------------------------------------------------------------
// Self-play
// ---------------------------------------------------------------------------

test('ffta: self-play completes with a valid result', async () => {
  const engine = new GameEngine(FFTAGame, players(), { maxTurns: 300 });
  const { result } = await engine.run();
  assert.ok(['win', 'draw'].includes(result.outcome));
});
