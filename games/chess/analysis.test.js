import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChessGame } from './index.js';
import { ChessAgent } from './ChessAgent.js';
import { analyzeObscuro, obscuroStrategy } from './ObscuroAgent.js';
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
  // Perfect info takes the same "just ask Stockfish" shortcut real Obscuro play
  // does (see ObscuroAgent.js's PERFECT-INFORMATION SHORTCUT note) — a real,
  // calibrated cp score per move, not the CFR tree's flat 100%/0% support.
  const { state, legal } = freeQueenState();
  const r = await analyzeObscuro(state, legal, { rng: () => 0 });
  assert.equal(r.engine, 'obscuro');
  assert.equal(r.mode, 'stockfish');
  assert.ok(r.candidates.length > 0);
  assert.equal(r.candidates[0].move.to, 'a8', 'best-ranked move should capture the queen');
  assert.ok(r.candidates[0].cp > 500, 'capturing a free queen should score as a large material swing');
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
});

// ---------------------------------------------------------------------------
// Whole-population enumeration (the batched, eventually-exhaustive belief walk).
// beliefPopulation reports the finite exact set's size; enumerateWorlds walks it
// once without replacement. At the game's first turn the belief is exact and the
// initial position is common knowledge, so |P| = 1 — the smallest possible walk.
// ---------------------------------------------------------------------------

test('beliefPopulation + enumerateWorlds: cover the whole exact set exactly once', async () => {
  const players = [{ id: 'white' }, { id: 'black' }];
  const state = ChessGame.createInitialState(players, { fogOfWar: true, difficulty: 30 });
  const view = ChessGame.getVisibleState(state, 'white');

  const pop = ChessGame.beliefPopulation(view, 'white');
  assert.equal(pop.exact, true, 'exact belief is active at the first turn');
  assert.ok(pop.total >= 1, 'a finite population size is reported');

  const all = ChessGame.enumerateWorlds(view, 'white', [...Array(pop.total).keys()]);
  assert.equal(all.length, pop.total, 'enumerating every index yields the whole population');
  const keyOf = (w) => Object.entries(w.board)
    .filter(([, p]) => p).map(([sq, p]) => `${sq}:${p.ownerId[0]}${p.type[0]}`).sort().join(',');
  assert.equal(new Set(all.map(keyOf)).size, pop.total, 'enumerated worlds are distinct (no replacement)');
  for (const w of all) assert.equal(w.activePlayers[0], 'white', 'worlds carry the analyzed side to move');

  assert.equal(ChessGame.enumerateWorlds(view, 'white', [pop.total + 5]).length, 0, 'out-of-range indices are skipped');
});

test('analyzeObscuroProgressive: a finite exact population exhausts and stops on its own', async () => {
  const players = [{ id: 'white' }, { id: 'black' }];
  const state = ChessGame.createInitialState(players, { fogOfWar: true, difficulty: 30 });
  const view = ChessGame.getVisibleState(state, 'white');
  const legal = ChessGame.getLegalActions(state, 'white');

  const frames = [];
  // isCancelled never fires, so ONLY exhaustion can end the walk — a regression
  // here (e.g. resample-with-replacement) would loop until maxTotalMs instead.
  const r = await analyzeObscuro(view, legal, {
    color: 'white', rng: () => 0.5, isCancelled: () => false,
    maxRounds: 4, expandPerRound: 2, cfrPerRound: 1, batchSize: 8,
    onProgress: (info) => frames.push(info),
  });
  assert.ok(r, 'returns a final result');
  assert.equal(r.exhaustive, true, 'the whole population was covered');
  assert.equal(r.total, r.evaluated, 'evaluated exactly the population total');
  assert.ok(frames.length >= 1 && frames.some(f => f.exhaustive), 'emits an exhaustive progress frame');
  const sum = r.candidates.reduce((a, c) => a + c.prob, 0);
  assert.ok(Math.abs(sum - 1) < 1e-6, `probabilities still sum to 1, got ${sum}`);
});

// Prompt cancellation (the memory-leak guard): when the analysis position
// changes, an in-flight solve must bail mid-flight, not run out its rounds — or
// stale walks pile up. isCancelled cuts the CFR round loop short, so a solve
// asked for 50 rounds stops within one round of the flag flipping.
test('obscuroStrategy: isCancelled cuts the CFR round loop short', async () => {
  const players = [{ id: 'white' }, { id: 'black' }];
  const st = ChessGame.createInitialState(players, { fogOfWar: true, difficulty: 30 });
  const view = ChessGame.getVisibleState(st, 'white');
  const legal = ChessGame.getLegalActions(st, 'white');

  let rounds = 0, cancel = false;
  const r = await obscuroStrategy(view, legal, {
    color: 'white', rng: () => 0.5, maxRounds: 50, expandPerRound: 2, cfrPerRound: 1,
    isCancelled: () => cancel,
    onProgress: (info) => { if (info.kind === 'round') { rounds++; if (rounds >= 3) cancel = true; } },
  });
  assert.ok(r.action, 'still returns a usable move from the rounds it did run');
  assert.ok(rounds < 50, `round loop stopped early once cancelled: ran ${rounds}/50`);
  stockfishQuit();
});
