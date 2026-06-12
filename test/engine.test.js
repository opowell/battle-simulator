import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine, freeze } from '../engine/index.js';

// ---------------------------------------------------------------------------
// Minimal mock game: players alternate passing; game ends after 3 full rounds.
// ---------------------------------------------------------------------------

const MockGame = {
  name: 'mock',

  createInitialState(players) {
    return {
      gameName: 'mock',
      turnNumber: 1,
      activePlayers: [players[0].id],
      currentPhase: 'action',
      players,
      board: {},
      units: [],
      lastActions: null,
      gameSpecific: { passCount: 0 },
    };
  },

  getLegalActions(_state, _playerId) {
    return [{ type: 'pass', unitId: '__player__' }];
  },

  applyActions(state, playerActions) {
    const { playerId } = playerActions[0];
    const playerIds = state.players.map(p => p.id);
    const idx = playerIds.indexOf(playerId);
    const nextIdx = (idx + 1) % playerIds.length;
    const nextId = playerIds[nextIdx];
    const newTurn = nextIdx === 0 ? state.turnNumber + 1 : state.turnNumber;
    return {
      ...state,
      activePlayers: [nextId],
      turnNumber: newTurn,
      lastActions: playerActions,
      gameSpecific: { passCount: state.gameSpecific.passCount + 1 },
    };
  },

  getResult(state) {
    if (state.turnNumber > 3) return { outcome: 'draw', winnerId: null, reason: 'test-over' };
    return null;
  },

  renderState(state) { return `turn ${state.turnNumber}`; },
};

const PassAgent = { id: 'pass', chooseAction: (_s, actions) => actions[0] };

function makePlayers(ids) {
  return ids.map(id => ({ id, name: id, agent: PassAgent }));
}

// ---------------------------------------------------------------------------

test('initial state is frozen', () => {
  const engine = new GameEngine(MockGame, makePlayers(['a', 'b']));
  engine._init();
  assert.ok(Object.isFrozen(engine.state));
});

test('state after step is frozen', async () => {
  const engine = new GameEngine(MockGame, makePlayers(['a', 'b']));
  engine._init();
  await engine.step();
  assert.ok(Object.isFrozen(engine.state));
});

test('activePlayers rotates between two players', async () => {
  const engine = new GameEngine(MockGame, makePlayers(['a', 'b']));
  engine._init();
  assert.deepEqual(engine.state.activePlayers, ['a']);
  await engine.step();
  assert.deepEqual(engine.state.activePlayers, ['b']);
  await engine.step();
  assert.deepEqual(engine.state.activePlayers, ['a']);
});

test('turnNumber increments after full round', async () => {
  const engine = new GameEngine(MockGame, makePlayers(['a', 'b']));
  engine._init();
  assert.equal(engine.state.turnNumber, 1);
  await engine.step(); // a acts
  assert.equal(engine.state.turnNumber, 1);
  await engine.step(); // b acts → round complete
  assert.equal(engine.state.turnNumber, 2);
});

test('run() terminates and returns result', async () => {
  const engine = new GameEngine(MockGame, makePlayers(['a', 'b']));
  const { result } = await engine.run();
  assert.equal(result.outcome, 'draw');
  assert.equal(result.reason, 'test-over');
});

test('log records each step', async () => {
  const engine = new GameEngine(MockGame, makePlayers(['a', 'b']));
  const { log } = await engine.run();
  assert.ok(log.length >= 6); // 3 turns × 2 players
  assert.ok(log[0].playerActions[0].action.type === 'pass');
});

test('illegal action injection throws', async () => {
  const BadAgent = {
    id: 'bad',
    chooseAction: () => ({ type: 'illegal', unitId: '__player__' }),
  };
  const players = [
    { id: 'a', name: 'a', agent: BadAgent },
    { id: 'b', name: 'b', agent: PassAgent },
  ];
  const engine = new GameEngine(MockGame, players);
  engine._init();
  await assert.rejects(() => engine.step(), /Illegal action/);
});

test('maxTurns config terminates game with draw', async () => {
  const engine = new GameEngine(MockGame, makePlayers(['a', 'b']), { maxTurns: 1 });
  const { result } = await engine.run();
  assert.equal(result.outcome, 'draw');
  assert.equal(result.reason, 'max-turns');
});

test('multiple activePlayers all act in one step', async () => {
  const SimGame = {
    name: 'sim',
    createInitialState(players) {
      return {
        gameName: 'sim', turnNumber: 1,
        activePlayers: players.map(p => p.id),  // both active
        currentPhase: 'action', players, board: {}, units: [], lastActions: null,
        gameSpecific: { actions: [] },
      };
    },
    getLegalActions: (_s, _pid) => [{ type: 'pass', unitId: '__player__' }],
    applyActions(state, playerActions) {
      return {
        ...state,
        turnNumber: state.turnNumber + 1,
        lastActions: playerActions,
        gameSpecific: { actions: [...state.gameSpecific.actions, ...playerActions.map(pa => pa.playerId)] },
      };
    },
    getResult: (s) => s.turnNumber > 2 ? { outcome: 'draw', winnerId: null, reason: 'done' } : null,
    renderState: () => '',
  };

  const engine = new GameEngine(SimGame, makePlayers(['a', 'b']));
  engine._init();
  await engine.step();
  // Both players should have acted in one step
  assert.deepEqual(engine.state.gameSpecific.actions, ['a', 'b']);
  assert.equal(engine.log[0].playerActions.length, 2);
});
