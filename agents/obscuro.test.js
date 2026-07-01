import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObscuroAgent } from './ObscuroAgent.js';
import { RandomAgent } from './RandomAgent.js';
import { ChessGame } from '../games/chess/index.js';
import { TacticalGame } from '../games/tactical/index.js';
import { GameEngine } from '../engine/index.js';

const unit = (id, ownerId, type, position) => ({ id, ownerId, type, position, alive: true });
const noCastle = { white: { kingSide: false, queenSide: false }, black: { kingSide: false, queenSide: false } };

function chessState(board, { fogOfWar = false, difficulty = 50 } = {}) {
  return {
    gameName: 'Chess',
    turnNumber: 1,
    activePlayers: ['white'],
    currentPhase: 'action',
    players: [{ id: 'white', name: 'W' }, { id: 'black', name: 'B' }],
    board,
    units: [],
    lastActions: null,
    gameSpecific: {
      enPassantTarget: null, castlingRights: noCastle, halfMoveClock: 0,
      inCheck: false, fogOfWar, debugAI: false, difficulty,
    },
  };
}

// ---------------------------------------------------------------------------
// Perfect information: the generic procedure collapses to a best response.
// ---------------------------------------------------------------------------

test('generic obscuro: perfect info — captures a free queen (best response)', async () => {
  const board = {
    e1: unit('wK', 'white', 'king', 'e1'),
    a1: unit('wR', 'white', 'rook', 'a1'),
    a8: unit('bQ', 'black', 'queen', 'a8'),
    h8: unit('bK', 'black', 'king', 'h8'),
  };
  const state = chessState(board);
  const legal = ChessGame.getLegalActions(state, 'white');
  const agent = new ObscuroAgent(ChessGame, { rng: () => 0 });
  const action = await agent.chooseAction(state, legal);
  assert.equal(action.to, 'a8', `expected Rxa8 grabbing the free queen, got ${action.from}${action.to}`);
});

test('generic obscuro: single legal action is returned immediately', async () => {
  const board = {
    a1: unit('wK', 'white', 'king', 'a1'),
    h8: unit('bK', 'black', 'king', 'h8'),
  };
  const state = chessState(board);
  const agent = new ObscuroAgent(ChessGame);
  const only = ChessGame.getLegalActions(state, 'white')[0];
  const action = await agent.chooseAction(state, [only]);
  assert.equal(action, only);
});

test('generic obscuro: difficulty 0 plays randomly', async () => {
  const board = {
    e1: unit('wK', 'white', 'king', 'e1'),
    a1: unit('wR', 'white', 'rook', 'a1'),
    a8: unit('bQ', 'black', 'queen', 'a8'),
    h8: unit('bK', 'black', 'king', 'h8'),
  };
  const state = chessState(board, { difficulty: 0 });
  const legal = ChessGame.getLegalActions(state, 'white');
  // rng pinned to 0 -> always the first legal action.
  const agent = new ObscuroAgent(ChessGame, { rng: () => 0 });
  const action = await agent.chooseAction(state, legal);
  assert.equal(action, legal[0]);
});

// ---------------------------------------------------------------------------
// Imperfect information: belief sampling drives a CFR subgame and still yields
// a legal move; a full fog game between two generic agents completes.
// ---------------------------------------------------------------------------

test('generic obscuro: fog chess move is legal', async () => {
  const state = ChessGame.createInitialState(
    [{ id: 'white', name: 'W' }, { id: 'black', name: 'B' }],
    { fogOfWar: true, difficulty: 30 },
  );
  const view = ChessGame.getVisibleState(state, 'white');
  const legal = ChessGame.getLegalActions(state, 'white');
  const agent = new ObscuroAgent(ChessGame, { particles: 4, rows: 5, cols: 5, iters: 80 });
  const action = await agent.chooseAction(view, legal);
  const keys = new Set(legal.map(a => ChessGame.actionKey(a)));
  assert.ok(keys.has(ChessGame.actionKey(action)), 'chosen move must be legal');
});

test('generic obscuro: a full fog chess game completes', async () => {
  const players = [
    { id: 'white', name: 'W', agent: new ObscuroAgent(ChessGame, { particles: 3, rows: 4, cols: 4, iters: 60 }) },
    { id: 'black', name: 'B', agent: new ObscuroAgent(ChessGame, { particles: 3, rows: 4, cols: 4, iters: 60 }) },
  ];
  const engine = new GameEngine(ChessGame, players, { maxTurns: 8, fogOfWar: true, difficulty: 30 });
  const { result } = await engine.run();
  assert.ok(result && typeof result.outcome === 'string', 'game should produce a result');
});

// ---------------------------------------------------------------------------
// Generality: the SAME agent drives a completely different game (Tactical),
// using only its evaluateState hook, and beats nothing-but-legality.
// ---------------------------------------------------------------------------

test('generic obscuro: runs on Tactical and returns a legal action', async () => {
  const players = [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];
  const state = TacticalGame.createInitialState(players, {});
  const legal = TacticalGame.getLegalActions(state, 'p1');
  const agent = new ObscuroAgent(TacticalGame, { rng: () => 0.5 });
  const action = await agent.chooseAction(state, legal);
  assert.ok(legal.includes(action), 'chosen Tactical action must be one of the legal actions');
});

test('generic obscuro: a Tactical game vs RandomAgent completes', async () => {
  const players = [
    { id: 'p1', name: 'P1', agent: new ObscuroAgent(TacticalGame, { rows: 5, cols: 5, iters: 60 }) },
    { id: 'p2', name: 'P2', agent: RandomAgent },
  ];
  const engine = new GameEngine(TacticalGame, players, { maxTurns: 20 });
  const { result } = await engine.run();
  assert.ok(result && typeof result.outcome === 'string', 'tactical game should produce a result');
});

// ---------------------------------------------------------------------------
// Degradation: a game with NO imperfect-information hooks at all still gets a
// working, legality-respecting agent.
// ---------------------------------------------------------------------------

test('generic obscuro: works on a game with no fog/eval hooks', async () => {
  // Minimal coin-grab game: two players, whoever holds more coins when the pile
  // empties wins. No evaluateState, no sampleWorlds.
  const StubGame = {
    name: 'Stub',
    createInitialState: (players) => ({
      gameName: 'Stub', turnNumber: 1, activePlayers: [players[0].id], currentPhase: 'action',
      players, units: [], board: {}, lastActions: null,
      gameSpecific: { pile: 4, coins: { [players[0].id]: 0, [players[1].id]: 0 } },
    }),
    getLegalActions: (state) => state.gameSpecific.pile > 0 ? [{ type: 'take' }, { type: 'pass' }] : [],
    applyActions: (state, [{ playerId, action }]) => {
      const gs = { ...state.gameSpecific, coins: { ...state.gameSpecific.coins } };
      if (action.type === 'take' && gs.pile > 0) { gs.pile -= 1; gs.coins[playerId] += 1; }
      const other = state.players.find(p => p.id !== playerId).id;
      return { ...state, gameSpecific: gs, activePlayers: [other], lastActions: [{ playerId, action }] };
    },
    getResult: (state) => {
      if (state.gameSpecific.pile > 0) return null;
      const [a, b] = state.players;
      const ca = state.gameSpecific.coins[a.id], cb = state.gameSpecific.coins[b.id];
      if (ca === cb) return { outcome: 'draw', winnerId: null, reason: 'tie' };
      return { outcome: 'win', winnerId: ca > cb ? a.id : b.id, reason: 'more-coins' };
    },
    renderState: () => '',
  };

  const state = StubGame.createInitialState([{ id: 'p1' }, { id: 'p2' }]);
  const agent = new ObscuroAgent(StubGame, { rng: () => 0 });
  const legal = StubGame.getLegalActions(state, 'p1');
  const action = await agent.chooseAction(state, legal);
  // With getResult-only leaves it cannot tell 'take' from 'pass' yet (neither
  // ends the game), but it must still return one of the legal actions.
  assert.ok(legal.includes(action), 'must return a legal action even with no hooks');
});
