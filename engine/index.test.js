import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine, freeze } from './index.js';

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

test('rewindTo takes moves back, log and position together', async () => {
  const engine = new GameEngine(MockGame, makePlayers(['a', 'b']));
  await engine.step();
  await engine.step();
  await engine.step();
  assert.equal(engine.log.length, 3);
  assert.equal(engine.state.gameSpecific.passCount, 3);
  assert.equal(engine.state.activePlayers[0], 'b');

  assert.equal(engine.rewindTo(1), 2, 'two turns dropped');
  assert.equal(engine.log.length, 1);
  // The position is the one those moves led to, not a patched-up guess: the
  // game's own counter agrees with the shortened log.
  assert.equal(engine.state.gameSpecific.passCount, 1);
  assert.equal(engine.state.activePlayers[0], 'b');

  // ...and play continues from there, into a different future.
  await engine.step();
  assert.equal(engine.log.length, 2);
  assert.equal(engine.state.gameSpecific.passCount, 2);
});

test('rewindTo un-ends a finished game, and refuses to invent history', async () => {
  const engine = new GameEngine(MockGame, makePlayers(['a', 'b']));
  await engine.run();
  assert.ok(engine.result, 'the mock game ends itself after 3 turns');

  const played = engine.log.length;
  engine.rewindTo(played - 1);
  assert.equal(engine.result, null, 'taking the last move back takes the ending back too');

  assert.equal(engine.rewindTo(played + 5), 0, 'nothing to drop past the end');
  assert.equal(engine.log.length, played - 1, 'and nothing invented either');

  const remaining = engine.log.length;
  assert.equal(engine.rewindTo(-3), remaining, 'a negative target means the start');
  assert.equal(engine.log.length, 0);
  assert.equal(engine.state.gameSpecific.passCount, 0);
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

test('no maxTurns means no turn limit: a long game runs to its own ending', async () => {
  // Ends itself well past the 500 turns that used to be the implicit default.
  const LongGame = {
    ...MockGame,
    getResult: (s) => s.turnNumber > 600
      ? { outcome: 'draw', winnerId: null, reason: 'test-over' } : null,
  };
  const engine = new GameEngine(LongGame, makePlayers(['a', 'b']));
  const { result } = await engine.run();
  assert.equal(result.reason, 'test-over');
  assert.ok(engine.state.turnNumber > 500, 'ran past the old default cap');
});

test('stepLimit still bounds a run with no turn limit', async () => {
  const EndlessGame = { ...MockGame, getResult: () => null };
  const engine = new GameEngine(EndlessGame, makePlayers(['a', 'b']), { stepLimit: 20 });
  const { result, log } = await engine.run();
  assert.equal(result.reason, 'step-limit');
  assert.equal(log.length, 20);
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

// ---------------------------------------------------------------------------
// Simultaneous ("we-go") mode: a tiny 1-D board game — units move ±1 along a
// 4-square line, one move per unit per turn, explicit end-turn like tactical.
// ---------------------------------------------------------------------------

const MiniGame = {
  name: 'mini',

  createInitialState(players, config = {}) {
    const [a, b] = players.map(p => p.id);
    const positions = config.positions ?? { ua: 0, ub: 3 };
    return {
      gameName: 'mini',
      turnNumber: 1,
      activePlayers: [a],
      currentPhase: 'action',
      players,
      board: {},
      units: [
        { id: 'ua', ownerId: a, type: 'pawn', position: { x: positions.ua, y: 0 }, alive: true, perTurn: { hasMoved: false } },
        { id: 'ub', ownerId: b, type: 'pawn', position: { x: positions.ub, y: 0 }, alive: true, perTurn: { hasMoved: false } },
      ],
      lastActions: null,
      gameSpecific: {},
    };
  },

  getLegalActions(state, playerId) {
    const actions = [];
    for (const u of state.units) {
      if (!u.alive || u.ownerId !== playerId || u.perTurn.hasMoved) continue;
      for (const toX of [u.position.x - 1, u.position.x + 1]) {
        if (toX < 0 || toX > 3) continue;
        if (state.units.some(o => o.alive && o.position.x === toX)) continue;
        actions.push({ type: 'move', unitId: u.id, from: { ...u.position }, to: { x: toX, y: 0 } });
      }
    }
    actions.push({ type: 'end-turn', unitId: '__player__' });
    return actions;
  },

  applyActions(state, playerActions) {
    const { playerId, action } = playerActions[0];
    const ids = state.players.map(p => p.id);
    if (action.type === 'end-turn') {
      const nextIdx = (ids.indexOf(playerId) + 1) % ids.length;
      return {
        ...state,
        units: state.units.map(u => u.ownerId === playerId ? { ...u, perTurn: { hasMoved: false } } : u),
        activePlayers: [ids[nextIdx]],
        turnNumber: nextIdx === 0 ? state.turnNumber + 1 : state.turnNumber,
        lastActions: playerActions,
      };
    }
    return {
      ...state,
      units: state.units.map(u => u.id === action.unitId ? { ...u, position: { ...action.to }, perTurn: { hasMoved: true } } : u),
      lastActions: playerActions,
    };
  },

  getResult: (s) => s.turnNumber > 2 ? { outcome: 'draw', winnerId: null, reason: 'done' } : null,
  renderState: () => '',
};

// Agent that picks each scripted action by predicate, falling back to end-turn.
function scriptAgent(script) {
  let i = 0;
  return {
    id: 'script',
    chooseAction: (_s, actions) => {
      const pick = script[i++];
      return (pick && actions.find(pick)) ?? actions.find(a => a.type === 'end-turn');
    },
  };
}

test('simultaneous mode resolves plans in exact time order and logs per order', async () => {
  const players = [
    { id: 'a', name: 'a', agent: scriptAgent([a => a.type === 'move' && a.to.x === 1]) },
    { id: 'b', name: 'b', agent: scriptAgent([a => a.type === 'move' && a.to.x === 2]) },
  ];
  const engine = new GameEngine(MiniGame, players, { simultaneousTurns: true });
  engine._init();
  await engine.step();

  assert.equal(engine.state.units.find(u => u.id === 'ua').position.x, 1);
  assert.equal(engine.state.units.find(u => u.id === 'ub').position.x, 2);
  assert.equal(engine.state.turnNumber, 2);
  // Both moves start at t=0 and complete at t=1 (before either end-turn at t=2),
  // so resolution interleaves by time, ties broken by seat order.
  assert.deepEqual(engine.log.map(e => `${e.playerActions[0].playerId}:${e.playerActions[0].action.type}`),
    ['a:move', 'b:move', 'a:end-turn', 'b:end-turn']);
  assert.ok(engine.log.every(e => e.simultaneous && e.turnNumber === 1));
  assert.ok(engine.log.every(e => e.t1 > e.t0 || e.t1 === e.t0));
});

test('simultaneous mode fizzles orders that are illegal at their completion time', async () => {
  // Both plan to move into square 2; both complete at t=1, a resolves first
  // (seat order), so b's move is stale by its own completion.
  const players = [
    { id: 'a', name: 'a', agent: scriptAgent([x => x.type === 'move' && x.to.x === 2]) },
    { id: 'b', name: 'b', agent: scriptAgent([x => x.type === 'move' && x.to.x === 2]) },
  ];
  const engine = new GameEngine(MiniGame, players, { simultaneousTurns: true, positions: { ua: 1, ub: 3 } });
  engine._init();
  await engine.step();

  assert.equal(engine.state.units.find(u => u.id === 'ua').position.x, 2);
  assert.equal(engine.state.units.find(u => u.id === 'ub').position.x, 3); // move fizzled
  assert.deepEqual(engine.log.map(e => `${e.playerActions[0].playerId}:${e.playerActions[0].action.type}`),
    ['a:move', 'a:end-turn', 'b:end-turn']);
});

test('simultaneous mode samples playback frames with interpolated positions', async () => {
  const players = [
    { id: 'a', name: 'a', agent: scriptAgent([a => a.type === 'move' && a.to.x === 1]) },
    { id: 'b', name: 'b', agent: scriptAgent([a => a.type === 'move' && a.to.x === 2]) },
  ];
  const engine = new GameEngine(MiniGame, players, { simultaneousTurns: true });
  engine._init();
  await engine.step();

  const pb = engine.playback;
  assert.ok(pb);
  // Round runs t=0..2 (move completes at 1, end-turn at 2), 61 frames.
  assert.equal(pb.duration, 2);
  assert.equal(pb.frames.length, 61);
  const uaAt = (frame) => frame.units.find(u => u.id === 'ua');
  assert.equal(uaAt(pb.frames[0]).x, 0);
  assert.equal(uaAt(pb.frames[60]).x, 1);
  // Mid-move sample: at t=0.5 the unit is halfway along its exact path.
  const mid = pb.frames.find(f => Math.abs(f.t - 0.5) < 1e-6);
  assert.ok(Math.abs(uaAt(mid).x - 0.5) < 1e-6);
});

test('playbackFrameAt returns the EXACT resolved state at an arbitrary sub-turn time', async () => {
  const players = [
    { id: 'a', name: 'a', agent: scriptAgent([a => a.type === 'move' && a.to.x === 1]) },
    { id: 'b', name: 'b', agent: scriptAgent([a => a.type === 'move' && a.to.x === 2]) },
  ];
  const engine = new GameEngine(MiniGame, players, { simultaneousTurns: true });
  engine._init();
  await engine.step();

  const uaX = (frame) => frame.units.find(u => u.id === 'ua').x;
  // Round runs t=0..2: ua's move completes at t=1 (fraction 0.5), then it sits still.
  // fraction 0.25 -> t=0.5, mid-move: halfway.
  assert.ok(Math.abs(uaX(engine.playbackFrameAt(0.25)) - 0.5) < 1e-9);
  // fraction 0.5 -> t=1: ARRIVED at x=1 — NOT 0.5, which a naive start→end lerp over
  // the whole turn would wrongly give. This is exactly why a paused off-sample scrub
  // must request the server's analytic state instead of lerping between endpoints.
  assert.equal(uaX(engine.playbackFrameAt(0.5)), 1);
  // On-sample fractions match the pre-sampled frame; out-of-range clamps to [0,1].
  assert.equal(uaX(engine.playbackFrameAt(30 / 60)), uaX(engine.playback.frames[30]));
  assert.equal(uaX(engine.playbackFrameAt(1.5)), uaX(engine.playback.frames[60]));
  assert.equal(uaX(engine.playbackFrameAt(-1)), uaX(engine.playback.frames[0]));
});

test('playbackFrameAt is null before any simultaneous round resolves', () => {
  const engine = new GameEngine(MiniGame, [
    { id: 'a', name: 'a', agent: scriptAgent([]) },
    { id: 'b', name: 'b', agent: scriptAgent([]) },
  ], { simultaneousTurns: true });
  engine._init();
  assert.equal(engine.playbackFrameAt(0.5), null);
});

test('simultaneous planning states hide the other player\'s queued orders', async () => {
  const seenByB = [];
  const players = [
    { id: 'a', name: 'a', agent: scriptAgent([x => x.type === 'move' && x.to.x === 1]) },
    { id: 'b', name: 'b', agent: {
      id: 'spy',
      chooseAction: (state, actions) => {
        seenByB.push(state.units.find(u => u.id === 'ua').position.x);
        return actions.find(x => x.type === 'end-turn');
      },
    } },
  ];
  const engine = new GameEngine(MiniGame, players, { simultaneousTurns: true });
  engine._init();
  await engine.step();

  // b planned against the turn-start state: a's queued move (0→1) never visible.
  assert.ok(seenByB.length > 0);
  assert.ok(seenByB.every(pos => pos === 0));
  // But b can read their own plan via planState only during planning; cleared after.
  assert.equal(engine.planState('a'), null);
});

test('simultaneous mode works for games whose actions auto-rotate the turn', async () => {
  // MockGame has no end-turn: one pass per player per round, rotated by the game.
  const engine = new GameEngine(MockGame, makePlayers(['a', 'b']), { simultaneousTurns: true });
  const { result, log } = await engine.run();
  assert.equal(result.reason, 'test-over');
  assert.equal(log.length, 6); // 3 rounds × 2 players, one entry per order
  assert.ok(log.every(e => e.simultaneous));
});
