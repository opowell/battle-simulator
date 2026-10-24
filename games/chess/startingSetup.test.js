// Customised starting units in chess: the board, not only the units, is rebuilt
// (src/engine/startingSetup.js; that every game survives an edited roster is its
// contract.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rosterFromState, applyRoster, rosterError } from '#core/engine/startingSetup.js';
import { ChessGame } from './index.js';

const seats = (ids) => ids.map(id => ({ id, name: id }));

test('chess: a customised position rebuilds the board and re-derives castling', () => {
  const players = seats(['white', 'black']);
  const base = ChessGame.createInitialState(players, {});
  const roster = rosterFromState(base);
  // Take both knights off, and move white's king's rook out of the corner.
  const edited = roster
    .filter(u => u.type !== 'knight')
    .map(u => (u.position === 'h1' ? { ...u, position: 'h4' } : u));
  const state = applyRoster(ChessGame, base, edited);

  assert.equal(Object.values(state.board).filter(p => p?.type === 'knight').length, 0);
  assert.equal(state.board.h1, undefined);
  assert.equal(state.board.h4.type, 'rook');
  // The units array and the board agree — the board is what chess actually plays on.
  assert.deepEqual(
    new Set(Object.values(state.board).map(p => p.id)),
    new Set(state.units.filter(u => u.alive !== false).map(u => u.id)));
  // No rook on h1 means no kingside castle; the queenside one is untouched.
  assert.deepEqual(state.gameSpecific.castlingRights.white, { kingSide: false, queenSide: true });
  assert.deepEqual(state.gameSpecific.castlingRights.black, { kingSide: true, queenSide: true });
  assert.ok(!ChessGame.getLegalActions(state, 'white').some(a => a.type === 'castle' && a.payload?.side === 'kingSide'));
});
