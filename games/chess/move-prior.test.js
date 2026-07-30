// ---------------------------------------------------------------------------
// The move prior as a MODEL, separate from the belief plumbing that consumes it
// (exact-belief.test.js). Two properties matter: it is a proper conditional
// distribution over each position's own move list, and its ordering matches what
// a chess player would actually do.
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMovePrior, UNIFORM_PRIOR, scoreMove } from './movePrior.js';
import { fromBoardObject } from './exactBelief.js';

const unit = (id, ownerId, type, position) => ({ id, ownerId, type, position, alive: true });
const idx = (sq) => (sq.charCodeAt(1) - 49) * 8 + (sq.charCodeAt(0) - 97);
const mv = (from, to, extra = {}) =>
  ({ f: idx(from), t: idx(to), promo: 0, dbl: false, ep: -1, castle: 0, ...extra });

// Black rook on d8, a white queen on d4 for it to take, and a white pawn on h2
// well out of the way. Black to move.
function fixture() {
  return fromBoardObject({
    d8: unit('bR', 'black', 'rook', 'd8'),
    e8: unit('bK', 'black', 'king', 'e8'),
    d4: unit('wQ', 'white', 'queen', 'd4'),
    e1: unit('wK', 'white', 'king', 'e1'),
  }, null, null);
}

test('movePrior: normalized over each position\'s own move list', () => {
  const pos = fixture();
  const moves = [mv('d8', 'd7'), mv('d8', 'd6'), mv('d8', 'd4'), mv('d8', 'c8')];
  const out = new Float64Array(8);
  for (const prior of [UNIFORM_PRIOR, makeMovePrior({ temperature: 300 }), makeMovePrior({ temperature: 40 })]) {
    prior(pos, moves, -1, out);
    let sum = 0;
    for (let i = 0; i < moves.length; i++) {
      assert.ok(out[i] >= 0 && out[i] <= 1, `π in [0,1], got ${out[i]}`);
      sum += out[i];
    }
    assert.ok(Math.abs(sum - 1) < 1e-12, `Σπ = 1, got ${sum}`);
    // Only the first `moves.length` slots are written — the scratch buffer the
    // belief passes in is longer than the move list and reused across parents.
    assert.equal(out[moves.length + 1], 0, 'nothing written past the move list');
  }
});

test('movePrior: taking the free queen is the most likely move', () => {
  const pos = fixture();
  const moves = [mv('d8', 'd7'), mv('d8', 'd6'), mv('d8', 'd4'), mv('d8', 'c8')];
  const out = new Float64Array(8);
  makeMovePrior({ temperature: 300 })(pos, moves, -1, out);
  const best = [...out.subarray(0, moves.length)];
  assert.equal(best.indexOf(Math.max(...best)), 2, 'Rxd4 is the mode of the distribution');
  // And it is not a rounding-level preference.
  assert.ok(best[2] > best[0] * 5, `capture should dominate a quiet move: ${best[2]} vs ${best[0]}`);
});

test('movePrior: temperature controls sharpness, and uniform is the τ→∞ limit', () => {
  const pos = fixture();
  const moves = [mv('d8', 'd7'), mv('d8', 'd4')];
  const out = new Float64Array(4);
  const capAt = (t) => { makeMovePrior({ temperature: t })(pos, moves, -1, out); return out[1]; };
  const sharp = capAt(50), mid = capAt(300), vague = capAt(5000);
  assert.ok(sharp > mid && mid > vague, `sharper τ concentrates: ${sharp} > ${mid} > ${vague}`);
  assert.ok(vague > 0.5 && vague < 0.6, `τ→∞ approaches uniform (0.5), got ${vague}`);
  assert.equal(makeMovePrior({ temperature: Infinity }), UNIFORM_PRIOR, 'τ=∞ IS the uniform prior');
  assert.throws(() => makeMovePrior({ temperature: 0 }), /temperature/);
});

test('movePrior: promotion, en passant and castling all price correctly', () => {
  // Black pawn on b2 promoting, and a white pawn on a2 it can take en route.
  const pos = fromBoardObject({
    b2: unit('bP', 'black', 'pawn', 'b2'),
    a2: unit('wP', 'white', 'pawn', 'a2'),
    e8: unit('bK', 'black', 'king', 'e8'),
    e1: unit('wK', 'white', 'king', 'e1'),
  }, null, null);
  const quiet = scoreMove(pos, mv('b2', 'b1'), -1);
  const toQueen = scoreMove(pos, mv('b2', 'b1', { promo: 5 }), -1);
  const toKnight = scoreMove(pos, mv('b2', 'b1', { promo: 2 }), -1);
  assert.ok(toQueen > toKnight, 'a queen is worth more than a knight');
  assert.ok(toQueen > quiet + 700, 'promotion is worth roughly a queen minus a pawn');

  // En passant reads the victim from m.ep, not from the (empty) destination.
  const epPos = fromBoardObject({
    b4: unit('bP', 'black', 'pawn', 'b4'),
    a4: unit('wP', 'white', 'pawn', 'a4'),
    e8: unit('bK', 'black', 'king', 'e8'),
    e1: unit('wK', 'white', 'king', 'e1'),
  }, null, 'a3');
  const ep = scoreMove(epPos, mv('b4', 'a3', { ep: idx('a4') }), -1);
  const push = scoreMove(epPos, mv('b4', 'b3'), -1);
  assert.ok(ep > push + 50, `en passant is scored as a pawn capture: ${ep} vs ${push}`);

  // Castling has no victim and no `from` piece delta worth pricing beyond the
  // king's own; it must at least come out finite and respect the bonus knob.
  const cPos = fromBoardObject({
    e8: unit('bK', 'black', 'king', 'e8'),
    h8: unit('bR', 'black', 'rook', 'h8'),
    e1: unit('wK', 'white', 'king', 'e1'),
  }, { white: {}, black: { kingSide: true, queenSide: false } }, null);
  const castle = mv('e8', 'g8', { castle: 1 });
  assert.ok(Number.isFinite(scoreMove(cPos, castle, -1)));
  assert.equal(
    scoreMove(cPos, castle, -1, { castleBonus: 60 }) - scoreMove(cPos, castle, -1),
    60, 'castleBonus is additive');
});

test('movePrior: the PST is oriented per colour', () => {
  // A knight to the centre is good for both sides; the SAME square must score as
  // an advance for whoever is moving toward it. b1-c3 for white and b8-c6 for
  // black are mirror images and must score identically.
  const w = fromBoardObject({
    b1: unit('wN', 'white', 'knight', 'b1'),
    e1: unit('wK', 'white', 'king', 'e1'),
    e8: unit('bK', 'black', 'king', 'e8'),
  }, null, null);
  const b = fromBoardObject({
    b8: unit('bN', 'black', 'knight', 'b8'),
    e1: unit('wK', 'white', 'king', 'e1'),
    e8: unit('bK', 'black', 'king', 'e8'),
  }, null, null);
  const wDev = scoreMove(w, mv('b1', 'c3'), 1);
  const bDev = scoreMove(b, mv('b8', 'c6'), -1);
  assert.equal(wDev, bDev, 'mirrored development scores the same for both colours');
  assert.ok(wDev > 0, 'and developing a knight off the back rank is an improvement');
});

test('movePrior: the king is priced below a queen, on purpose', () => {
  // Capturing our king is always PRUNED by exactBelief, so its π mass is removed
  // as evidence ("you could have taken my king and didn't"). Under fog the
  // opponent often could not see the king, so that evidence must stay bounded —
  // at PIECE_VALUE.king (20000) it would annihilate any world offering one.
  const pos = fromBoardObject({
    d8: unit('bR', 'black', 'rook', 'd8'),
    d4: unit('wQ', 'white', 'queen', 'd4'),
    d1: unit('wK', 'white', 'king', 'd1'),
    e8: unit('bK', 'black', 'king', 'e8'),
  }, null, null);
  const takeQueen = scoreMove(pos, mv('d8', 'd4'), -1);
  const takeKing = scoreMove(pos, mv('d8', 'd1'), -1);
  assert.ok(takeKing > takeQueen, 'the king is still the most valuable capture');
  assert.ok(takeKing < takeQueen * 3, `but not by orders of magnitude: ${takeKing} vs ${takeQueen}`);
});
