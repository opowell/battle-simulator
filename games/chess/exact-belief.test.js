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
