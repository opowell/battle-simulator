import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChessGame } from './index.js';
import { ChessAgent } from './ChessAgent.js';
import { analyzeObscuro } from './ObscuroAgent.js';
import { getBelief } from './belief.js';
import { getAllLegalMoves } from './moves.js';
import { quit as stockfishQuit } from './stockfish.js';

const unit = (id, ownerId, type, position) => ({ id, ownerId, type, position, alive: true });
const noCastle = { white: { kingSide: false, queenSide: false }, black: { kingSide: false, queenSide: false } };

// A free queen sitting on a8 for white's rook to take — the same fixture
// obscuro.test.js uses, so both engines are checked against an unambiguous
// "obviously correct" answer.
function freeQueenState() {
  const board = {
    e1: unit('wK', 'white', 'king', 'e1'),
    a1: unit('wR', 'white', 'rook', 'a1'),
    a8: unit('bQ', 'black', 'queen', 'a8'),
    h8: unit('bK', 'black', 'king', 'h8'),
  };
  const gameSpecific = { enPassantTarget: null, castlingRights: noCastle, halfMoveClock: 0, inCheck: false, fogOfWar: false, difficulty: 'medium' };
  const state = { players: [{ id: 'white' }, { id: 'black' }], activePlayers: ['white'], board, units: Object.values(board), turnNumber: 1, gameSpecific };
  return { state, legal: getAllLegalMoves(board, 'white', gameSpecific) };
}

test('ChessAgent.analyze: perfect info ranks the free-queen capture first', async () => {
  const { state, legal } = freeQueenState();
  const r = await ChessAgent.analyze(state, legal);
  assert.equal(r.engine, 'chess-ai');
  assert.ok(r.candidates.length > 0);
  assert.equal(r.candidates[0].move.to, 'a8', 'best-ranked move should capture the queen');
  assert.ok(r.candidates[0].move.isCapture);
});

test('analyzeObscuro: perfect info ranks the free-queen capture first', async () => {
  const { state, legal } = freeQueenState();
  const r = await analyzeObscuro(state, legal, { rng: () => 0 });
  assert.equal(r.engine, 'obscuro');
  assert.equal(r.mode, 'minimax');
  assert.ok(r.candidates.length > 0);
  assert.equal(r.candidates[0].move.to, 'a8', 'best-ranked move should capture the queen');
});

// ---------------------------------------------------------------------------
// `opts.color` override: lets the analysis API always answer "what's good for
// MY side" even when it isn't literally that side's turn in the true state —
// the fog case api-server.js's handleAnalyze relies on (see its comment) so a
// viewer can preview their own position instead of being flatly blocked
// whenever the opponent is mid-turn.
// ---------------------------------------------------------------------------

test('ChessAgent.analyze: opts.color analyzes white even when activePlayers says black', async () => {
  const { state, legal } = freeQueenState();
  const notWhitesTurn = { ...state, activePlayers: ['black'] };
  const r = await ChessAgent.analyze(notWhitesTurn, legal, { color: 'white' });
  assert.ok(r.candidates.length > 0);
  assert.equal(r.candidates[0].move.to, 'a8', 'should still find the free-queen capture for white');
});

test('analyzeObscuro: opts.color analyzes white even when activePlayers says black', async () => {
  const { state, legal } = freeQueenState();
  const notWhitesTurn = { ...state, activePlayers: ['black'] };
  const r = await analyzeObscuro(notWhitesTurn, legal, { rng: () => 0, color: 'white' });
  assert.ok(r.candidates.length > 0);
  assert.equal(r.candidates[0].move.to, 'a8', 'should still find the free-queen capture for white');
});

test('analyzeObscuro: fog produces a probability distribution summing to ~1', async () => {
  const players = [{ id: 'white', name: 'W' }, { id: 'black', name: 'B' }];
  const state = ChessGame.createInitialState(players, { fogOfWar: true, difficulty: 30 });
  const view = ChessGame.getVisibleState(state, 'white');
  const legal = ChessGame.getLegalActions(state, 'white');

  const r = await analyzeObscuro(view, legal, { particles: 4 });
  assert.equal(r.mode, 'cfr');
  const sum = r.candidates.reduce((a, c) => a + c.prob, 0);
  assert.ok(Math.abs(sum - 1) < 1e-6, `probabilities should sum to 1, got ${sum}`);
  for (const c of r.candidates) assert.ok(c.prob >= -1e-9 && c.prob <= 1 + 1e-9, `probability out of range: ${c.prob}`);
});

// ---------------------------------------------------------------------------
// Regression guard: analyze() is read-only. It must never advance the shared
// per-color Belief beyond the one `beginTurn` a real decision for that same
// turn would also do (turnKey idempotency, belief.js:215), and must never
// call `commitOurMove` (belief.js:234, the "I actually played this" step —
// its only effect is setting `ownSnapshot`, which stays null otherwise).
// ---------------------------------------------------------------------------

test('ChessAgent.analyze() does not advance or commit the belief', async () => {
  const players = [{ id: 'white' }, { id: 'black' }];
  const state = ChessGame.createInitialState(players, { fogOfWar: true, difficulty: 30 });
  const view = ChessGame.getVisibleState(state, 'white');
  const legal = ChessGame.getLegalActions(state, 'white');

  await ChessAgent.analyze(view, legal);
  const belief = getBelief(view, 'white');
  const pliesAfterOne = belief.oppPlies;
  assert.equal(belief.ownSnapshot, null, 'analyze() must never commit a move to the belief');

  // Re-entering analyze() for the SAME turn must be a no-op on the belief
  // (idempotent via turnKey), exactly like a real agent re-sampling mid-decision.
  await ChessAgent.analyze(view, legal);
  await ChessAgent.analyze(view, legal);
  assert.equal(belief.oppPlies, pliesAfterOne, 'repeated analyze() calls for the same turn must not re-advance the belief');
  assert.equal(belief.ownSnapshot, null, 'analyze() must still never commit a move to the belief');
});

test('analyzeObscuro() does not commit a move to the belief', async () => {
  const players = [{ id: 'white' }, { id: 'black' }];
  const state = ChessGame.createInitialState(players, { fogOfWar: true, difficulty: 30 });
  const view = ChessGame.getVisibleState(state, 'white');
  const legal = ChessGame.getLegalActions(state, 'white');

  await analyzeObscuro(view, legal, { particles: 4 });
  const belief = getBelief(view, 'white');
  assert.equal(belief.ownSnapshot, null, 'analyzeObscuro() must never commit a move to the belief');
  stockfishQuit();
});
