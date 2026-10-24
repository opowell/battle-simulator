// The core's generic ObscuroAgent (src/agents/ObscuroAgent.js) playing chess:
// under perfect information it collapses to a best response, and under fog it
// still plays legal moves to the end of a game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObscuroAgent } from '#core/agents/ObscuroAgent.js';
import { GameEngine } from '#core/engine/index.js';
import { ChessGame } from './index.js';

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
