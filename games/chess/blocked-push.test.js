// A pawn push onto a dark square. The square ahead of a pawn is lit exactly
// when it is empty (getVisibleSquares), so a dark one always holds a piece the
// pawn cannot see, and the push could only ever fail. It is not offered: the
// same rule as vendor/obscuro-chess's FogChess.getLegalActions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChessGame } from './index.js';

const key = a => a.from + a.to + (a.payload?.promote ? '=' + a.payload.promote[0] : '');

// 1. Nf3 d5 2. d4 Nf6: black's d5 pawn stands, unseen, in front of white's d4 pawn.
function blockedPosition() {
  const players = [{ id: 'white', name: 'White' }, { id: 'black', name: 'Black' }];
  let state = ChessGame.createInitialState(players, { fog: true, fogOfWar: true });
  for (const k of ['g1f3', 'd7d5', 'd2d4', 'g8f6']) {
    const mover = state.activePlayers[0];
    const action = ChessGame.getLegalActions(state, mover).find(a => key(a) === k);
    state = ChessGame.applyActions(state, [{ playerId: mover, action }]);
  }
  return state;
}

test('a push onto a dark square is not offered; the other pawn moves are', () => {
  const obs = ChessGame.getVisibleState(blockedPosition(), 'white');
  assert.ok(!obs.visibleSquares.includes('d5'));
  assert.equal(obs.board.d5, undefined); // the blocker is hidden, so the push looks free
  const legal = ChessGame.getLegalActions(obs, 'white').map(key);
  assert.ok(!legal.includes('d4d5'));
  for (const k of ['c2c4', 'e2e4', 'e2e3', 'h2h4']) assert.ok(legal.includes(k), k);
});

test('the observation offers the same moves as the true board', () => {
  const state = blockedPosition();
  const obs = ChessGame.getVisibleState(state, 'white');
  assert.deepEqual(
    ChessGame.getLegalActions(obs, 'white').map(key).sort(),
    ChessGame.getLegalActions(state, 'white').map(key).sort());
});

test('a new position does not inherit the view it was reached from', () => {
  const obs = ChessGame.getVisibleState(blockedPosition(), 'white');
  const next = ChessGame.applyActions(obs, [{ playerId: 'white', action: ChessGame.getLegalActions(obs, 'white')[0] }]);
  assert.equal(next.visibleSquares, undefined);
  assert.equal(next.viewerId, undefined);
  assert.equal(next.fogMarkers, undefined);
});
