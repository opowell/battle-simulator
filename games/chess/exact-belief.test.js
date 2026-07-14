// ---------------------------------------------------------------------------
// Exact belief (position set P) tests. The fundamental invariant: at every one
// of the AI's turns in a real game, the TRUE position is a member of P.
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChessGame } from './ChessGame.js';
import { ExactBelief } from './exactBelief.js';

const SESSIONS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'sessions');

// Placement-level signature (ignores ids), matching exactBelief's semantics.
function placementSig(board) {
  let s = '';
  for (const f of 'abcdefgh') {
    for (let r = 1; r <= 8; r++) {
      const p = board[f + r];
      if (!p) { s += '.'; continue; }
      const c = p.type === 'knight' ? 'n' : p.type[0];
      s += p.ownerId === 'white' ? c.toUpperCase() : c;
    }
  }
  return s;
}

function replayWithTracker(file, aiColor, maxPlies = Infinity) {
  const sess = JSON.parse(readFileSync(join(SESSIONS, file), 'utf8'));
  let state = ChessGame.createInitialState(sess.params.players, sess.params.config);
  const tracker = new ExactBelief(aiColor);
  const sizes = [];
  for (let i = 0; i < Math.min(sess.log.length, maxPlies); i++) {
    const pa = sess.log[i].playerActions[0];
    if (pa.playerId === aiColor) {
      const view = ChessGame.getVisibleState(state, aiColor);
      tracker.beginTurn(view, view.turnNumber ?? null);
      assert.equal(tracker.exact, true, `tracker gave up at ply ${i}`);
      const trueSig = placementSig(state.board);
      const inP = tracker.positions.some(pos => placementSig(pos.board) === trueSig);
      assert.ok(inP, `true position not in P at ply ${i} (|P|=${tracker.positions.length})`);
      sizes.push(tracker.positions.length);
      tracker.commitOurMove(pa.action);
    }
    state = ChessGame.applyActions(state, [pa]);
  }
  return { tracker, sizes };
}

test('exact belief: P always contains the true position (febb71bf replay)', () => {
  const { sizes } = replayWithTracker('2026-07-13T12-59-56-febb71bf.json', 'black');
  assert.ok(sizes.length >= 8, 'should have tracked several turns');
  assert.ok(sizes[0] >= 1, 'first turn has at least the true position');
});

test('exact belief: P always contains the true position (befd4820 replay)', () => {
  const { sizes } = replayWithTracker('2026-07-12T23-27-55-befd4820.json', 'black');
  assert.ok(sizes.length >= 8, 'should have tracked several turns');
});

test('exact belief: white first turn knows the exact position', () => {
  const state = ChessGame.createInitialState(
    [{ id: 'white', name: 'W' }, { id: 'black', name: 'B' }],
    { fogOfWar: true, fog: true });
  const view = ChessGame.getVisibleState(state, 'white');
  const tracker = new ExactBelief('white');
  tracker.beginTurn(view, 1);
  assert.equal(tracker.exact, true);
  assert.equal(tracker.positions.length, 1, 'nothing has moved: P = {initial}');
});

test('exact belief: re-acquisition from the heuristic belief (few hidden pieces)', () => {
  // Fog endgame: we are white with Kd1; black has a king we can't see and one
  // pawn we CAN see. The heuristic belief knows the black king's possible
  // squares; with one hidden piece the cross-product is tiny, so a lost exact
  // tracker must re-acquire a superset P that contains the true position.
  const players = [{ id: 'white', name: 'W' }, { id: 'black', name: 'B' }];
  const state = ChessGame.createInitialState(players, { fogOfWar: true, fog: true });
  // Carve the board down to a K+P vs K endgame.
  const keep = new Set(['wK', 'bK', 'bPa']);
  const board = {};
  for (const sq of Object.keys(state.board)) {
    const p = state.board[sq];
    if (p && keep.has(p.id)) board[sq] = p;
  }
  const endState = { ...state, board, units: Object.values(board).filter(Boolean), turnNumber: 30 };
  const view = ChessGame.getVisibleState(endState, 'white');

  const tracker = new ExactBelief('white');
  tracker.beginTurn(view, 30); // mid-game attach → gives up
  assert.equal(tracker.exact, false);

  // Heuristic belief stub: one hidden piece (the black king on e8) with a
  // small, honest possible-set; the black a-pawn is visible? (it is not — no
  // white piece sees a7 — so include it as a second hidden piece).
  const belief = {
    forcedEnemy: new Set(),
    pieces: new Map([
      ['bK', { id: 'bK', type: 'king', alive: true, truncated: false, possible: new Set(['e8', 'd8', 'f8', 'e7']) }],
      ['bPa', { id: 'bPa', type: 'pawn', alive: true, truncated: false, possible: new Set(['a7', 'a6', 'a5']) }],
    ]),
  };
  tracker.tryReacquire(view, belief, 30);
  assert.equal(tracker.exact, true, 're-acquisition should succeed with 2 hidden pieces');
  assert.equal(tracker.approx, true, 're-acquired P is marked approximate');
  const trueSig = placementSig(endState.board);
  assert.ok(tracker.positions.some(p => placementSig(p.board) === trueSig),
    'true position must be in the re-acquired P');
});

test('exact belief: re-acquisition refuses truncated possible-sets', () => {
  const players = [{ id: 'white', name: 'W' }, { id: 'black', name: 'B' }];
  const state = ChessGame.createInitialState(players, { fogOfWar: true, fog: true });
  const view = ChessGame.getVisibleState({ ...state, turnNumber: 9 }, 'white');
  const tracker = new ExactBelief('white');
  tracker.beginTurn(view, 9);
  assert.equal(tracker.exact, false);
  const belief = {
    forcedEnemy: new Set(),
    pieces: new Map([
      ['bK', { id: 'bK', type: 'king', alive: true, truncated: true, possible: new Set(['e8']) }],
    ]),
  };
  tracker.tryReacquire(view, belief, 9);
  assert.equal(tracker.exact, false, 'must not re-acquire from a truncated set');
});

test('exact belief: attaching mid-game gives up gracefully', () => {
  const state = ChessGame.createInitialState(
    [{ id: 'white', name: 'W' }, { id: 'black', name: 'B' }],
    { fogOfWar: true, fog: true });
  const mid = { ...state, turnNumber: 7 };
  const view = ChessGame.getVisibleState(mid, 'white');
  const tracker = new ExactBelief('white');
  tracker.beginTurn(view, 7);
  assert.equal(tracker.exact, false);
  assert.equal(tracker.samplePositions(4), null);
});
