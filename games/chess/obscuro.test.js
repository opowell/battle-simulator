import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChessGame } from './index.js';
import { ObscuroAgent, obscuroStrategy } from '../../vendor/obscuro-chess/src/index.js';
import { solveMatrixGame } from './cfr.js';
import { getAllLegalMoves } from '../../vendor/obscuro-chess/src/index.js';
import { quit as stockfishQuit } from './stockfish.js';
import { GameEngine } from '../../engine/index.js';
import { RandomAgent } from '../../agents/index.js';

const unit = (id, ownerId, type, position) => ({ id, ownerId, type, position, alive: true });
const noCastle = { white: { kingSide: false, queenSide: false }, black: { kingSide: false, queenSide: false } };
const support = dist => dist.filter(p => p > 0.01).length;

// ---------------------------------------------------------------------------
// CFR+ matrix solver (kept for back-compat; still re-exported from cfr.js)
// ---------------------------------------------------------------------------

test('cfr: rock-paper-scissors converges to the uniform equilibrium', () => {
  const { row, value } = solveMatrixGame([[0, -1, 1], [1, 0, -1], [-1, 1, 0]], 2000);
  for (const p of row) assert.ok(Math.abs(p - 1 / 3) < 0.05, `expected ~1/3, got ${p}`);
  assert.ok(Math.abs(value) < 0.05, `RPS value should be ~0, got ${value}`);
});

test('cfr: a dominant row is played purely', () => {
  const { row } = solveMatrixGame([[1, 1], [0, 0]], 1000);
  assert.ok(row[0] > 0.98, `dominant row should get ~all the mass, got ${row[0]}`);
});

// ---------------------------------------------------------------------------
// Perfect information: the generic extensive-form search collapses to minimax
// ---------------------------------------------------------------------------

test('perfect info: collapses to minimax — captures a free queen, pure strategy', async () => {
  const board = {
    e1: unit('wK', 'white', 'king', 'e1'),
    a1: unit('wR', 'white', 'rook', 'a1'),
    a8: unit('bQ', 'black', 'queen', 'a8'),
    h8: unit('bK', 'black', 'king', 'h8'),
  };
  const gameSpecific = { enPassantTarget: null, castlingRights: noCastle, halfMoveClock: 0, inCheck: false, fogOfWar: false, difficulty: 'medium' };
  const state = { players: [{ id: 'white' }, { id: 'black' }], activePlayers: ['white'], board, units: Object.values(board), turnNumber: 1, gameSpecific };
  const legal = getAllLegalMoves(board, 'white', gameSpecific);

  const r = await obscuroStrategy(state, legal, { rng: () => 0 });
  assert.equal(r.mode, 'minimax');
  assert.equal(r.action.to, 'a8', 'should capture the queen on a8');
  assert.ok(r.action.isCapture);
  assert.equal(support(r.dist), 1, 'perfect information must yield a pure strategy');
});

// ---------------------------------------------------------------------------
// Imperfect information: a valid mixed strategy over legal moves
// ---------------------------------------------------------------------------

test('fog: produces a valid probability distribution over legal moves', async () => {
  const players = [{ id: 'white', name: 'W' }, { id: 'black', name: 'B' }];
  const state = ChessGame.createInitialState(players, { fogOfWar: true, difficulty: 30 });
  const view = ChessGame.getVisibleState(state, 'white');
  const legal = ChessGame.getLegalActions(state, 'white');

  const r = await obscuroStrategy(view, legal, { particles: 4 });
  assert.equal(r.mode, 'cfr');
  const sum = r.dist.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-6, `distribution should sum to 1, got ${sum}`);
  for (const p of r.dist) assert.ok(p >= -1e-9 && p <= 1 + 1e-9, `probability out of range: ${p}`);

  const legalKeys = new Set(legal.map(a => ChessGame.actionKey(a)));
  assert.ok(legalKeys.has(ChessGame.actionKey(r.action)), 'chosen action must be legal');
});

test('unification: same opening is pure with full information but a valid strategy under fog', async () => {
  // Full information → a single minimax move.
  const p1 = [{ id: 'white' }, { id: 'black' }];
  const open = ChessGame.createInitialState(p1, { fogOfWar: false, difficulty: 'medium' });
  const clear = await obscuroStrategy(open, ChessGame.getLegalActions(open, 'white'));
  assert.equal(clear.mode, 'minimax');
  assert.equal(support(clear.dist), 1, 'full information should not randomise');

  // Fog of war → the equilibrium search over a belief cloud (may randomise).
  const p2 = [{ id: 'white' }, { id: 'black' }];
  const fog = ChessGame.createInitialState(p2, { fogOfWar: true, difficulty: 30 });
  const view = ChessGame.getVisibleState(fog, 'white');
  const mixed = await obscuroStrategy(view, ChessGame.getLegalActions(fog, 'white'), { particles: 4 });
  assert.equal(mixed.mode, 'cfr');
  assert.ok(support(mixed.dist) >= 1, 'fog should yield a valid strategy over the belief');
});

// ---------------------------------------------------------------------------
// Self-play smoke tests (full chooseAction + belief loop)
// ---------------------------------------------------------------------------

test('obscuro self-play (perfect info) completes with a valid result', async () => {
  const players = [
    { id: 'white', name: 'White', agent: ObscuroAgent },
    { id: 'black', name: 'Black', agent: RandomAgent },
  ];
  const engine = new GameEngine(ChessGame, players, { maxTurns: 20, difficulty: 'easy' });
  const { result } = await engine.run();
  assert.ok(result === null || ['win', 'draw'].includes(result.outcome));
});

test('obscuro self-play (fog of war) completes with a valid result', async () => {
  const players = [
    { id: 'white', name: 'White', agent: ObscuroAgent },
    { id: 'black', name: 'Black', agent: ObscuroAgent },
  ];
  // Under fog every move runs the generic extensive-form search (Stockfish-scored
  // leaves when the engine is available). Keep the horizon short for test speed.
  const engine = new GameEngine(ChessGame, players, { maxTurns: 10, fogOfWar: true, difficulty: 'easy' });
  const { result } = await engine.run();
  assert.ok(result === null || ['win', 'draw'].includes(result.outcome));
  stockfishQuit();
});
