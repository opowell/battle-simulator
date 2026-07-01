import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChessGame } from './index.js';
import { ObscuroAgent, obscuroStrategy, fogStockfishLevel2Strategy } from './ObscuroAgent.js';
import { solveMatrixGame } from './cfr.js';
import { getAllLegalMoves } from './moves.js';
import { getBelief } from './belief.js';
import { available as stockfishAvailable, quit as stockfishQuit } from './stockfish.js';
import { GameEngine } from '../../engine/index.js';
import { RandomAgent } from '../../agents/index.js';

const unit = (id, ownerId, type, position) => ({ id, ownerId, type, position, alive: true });
const noCastle = { white: { kingSide: false, queenSide: false }, black: { kingSide: false, queenSide: false } };
const support = dist => dist.filter(p => p > 0.01).length;

// ---------------------------------------------------------------------------
// CFR+ matrix solver
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
// Perfect information: the unified procedure collapses to minimax
// ---------------------------------------------------------------------------

test('perfect info: collapses to minimax — captures a free queen, pure strategy', () => {
  const board = {
    e1: unit('wK', 'white', 'king', 'e1'),
    a1: unit('wR', 'white', 'rook', 'a1'),
    a8: unit('bQ', 'black', 'queen', 'a8'),
    h8: unit('bK', 'black', 'king', 'h8'),
  };
  const gameSpecific = { enPassantTarget: null, castlingRights: noCastle, halfMoveClock: 0, inCheck: false, fogOfWar: false, difficulty: 'medium' };
  const state = { players: [{ id: 'white' }, { id: 'black' }], activePlayers: ['white'], board, gameSpecific };
  const legal = getAllLegalMoves(board, 'white', gameSpecific);

  const r = obscuroStrategy(state, legal);
  assert.equal(r.mode, 'minimax');
  assert.equal(r.action.to, 'a8', 'should capture the queen on a8');
  assert.ok(r.action.isCapture);
  assert.equal(support(r.dist), 1, 'perfect information must yield a pure strategy');
});

// ---------------------------------------------------------------------------
// Imperfect information: a valid mixed strategy
// ---------------------------------------------------------------------------

test('fog: produces a valid probability distribution over legal moves', () => {
  const players = [{ id: 'white', name: 'W', agent: ObscuroAgent }, { id: 'black', name: 'B', agent: ObscuroAgent }];
  const state = ChessGame.createInitialState(players, { fogOfWar: true, difficulty: 'medium' });
  const view = ChessGame.getVisibleState(state, 'white');
  const legal = ChessGame.getLegalActions(state, 'white');

  const r = obscuroStrategy(view, legal);
  assert.equal(r.mode, 'cfr');
  const sum = r.dist.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-6, `distribution should sum to 1, got ${sum}`);
  for (const p of r.dist) assert.ok(p >= -1e-9 && p <= 1 + 1e-9, `probability out of range: ${p}`);

  const legalKeys = new Set(legal.map(a => a.from + a.to + (a.payload?.promote ?? '')));
  assert.ok(legalKeys.has(r.action.from + r.action.to + (r.action.payload?.promote ?? '')), 'chosen action must be legal');
});

test('unification: same opening is pure with full information but mixed under fog', () => {
  // Full information → a single minimax move.
  const p1 = [{ id: 'white' }, { id: 'black' }];
  const open = ChessGame.createInitialState(p1, { fogOfWar: false, difficulty: 'medium' });
  const clear = obscuroStrategy(open, ChessGame.getLegalActions(open, 'white'));
  assert.equal(clear.mode, 'minimax');
  assert.equal(support(clear.dist), 1, 'full information should not randomise');

  // Fog of war → an equilibrium that randomises (the paper's key behaviour).
  const p2 = [{ id: 'white' }, { id: 'black' }];
  const fog = ChessGame.createInitialState(p2, { fogOfWar: true, difficulty: 'medium' });
  const view = ChessGame.getVisibleState(fog, 'white');
  const mixed = obscuroStrategy(view, ChessGame.getLegalActions(fog, 'white'));
  assert.equal(mixed.mode, 'cfr');
  assert.ok(support(mixed.dist) >= 2, `fog should yield a mixed strategy, support=${support(mixed.dist)}`);
});

// ---------------------------------------------------------------------------
// Self-play smoke tests (full chooseAction + belief loop)
// ---------------------------------------------------------------------------

test('obscuro self-play (perfect info) completes with a valid result', async () => {
  const players = [
    { id: 'white', name: 'White', agent: ObscuroAgent },
    { id: 'black', name: 'Black', agent: RandomAgent },
  ];
  const engine = new GameEngine(ChessGame, players, { maxTurns: 30, difficulty: 'easy' });
  const { result } = await engine.run();
  assert.ok(result === null || ['win', 'draw'].includes(result.outcome));
});

test('obscuro self-play (fog of war) completes with a valid result', async () => {
  const players = [
    { id: 'white', name: 'White', agent: ObscuroAgent },
    { id: 'black', name: 'Black', agent: ObscuroAgent },
  ];
  // Fewer turns: under fog this now runs the (heavier) Stockfish-scored subgame
  // each move when the engine is available.
  const engine = new GameEngine(ChessGame, players, { maxTurns: 12, fogOfWar: true, difficulty: 'easy' });
  const { result } = await engine.run();
  assert.ok(result === null || ['win', 'draw'].includes(result.outcome));
});

// ---------------------------------------------------------------------------
// Level-2 belief: the opponent is modelled as a level-1 reasoner and we solve a
// CFR matrix over their realistic replies, so our strategy can mix (rather than
// collapsing to a pure best response, which would leak our hidden state).
// Requires the vendored Stockfish engine; skipped if it is unavailable.
// ---------------------------------------------------------------------------

test('fog level-2: returns a valid distribution over legal moves (CFR matrix)', async (t) => {
  if (!(await stockfishAvailable())) { t.skip('Stockfish engine unavailable'); return; }

  const players = [{ id: 'white' }, { id: 'black' }];
  const state = ChessGame.createInitialState(players, { fogOfWar: true, difficulty: 'hard' });
  const view = ChessGame.getVisibleState(state, 'white');
  const legal = ChessGame.getLegalActions(state, 'white');

  const belief = getBelief(view, 'white');
  belief.beginTurn(view.board);
  const particles = belief.sample(view.board, 2);

  // A small subgame so the (heavy) level-2 solve stays fast in tests.
  const fcfg = {
    particles: 2, rows: 4, cols: 4, innerRows: 2, innerCols: 2,
    leafDepth: 1, iters: 100, sfDepth: 1, purifyMax: 3, subgameDepth: 1, beliefDepth: 2,
  };
  const r = await fogStockfishLevel2Strategy(view.board, view.gameSpecific, 'white', particles, fcfg, legal);

  assert.equal(r.mode, 'cfr-sf-l2');
  assert.ok(r.cols > 0, 'opponent replies should populate the matrix columns');
  const sum = r.dist.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-6, `distribution should sum to 1, got ${sum}`);
  for (const p of r.dist) assert.ok(p >= -1e-9 && p <= 1 + 1e-9, `probability out of range: ${p}`);

  const legalKeys = new Set(legal.map(a => a.from + a.to + (a.payload?.promote ?? '')));
  assert.ok(legalKeys.has(r.action.from + r.action.to + (r.action.payload?.promote ?? '')), 'chosen action must be legal');

  stockfishQuit();
});
