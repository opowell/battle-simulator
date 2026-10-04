import { test } from 'node:test';
import assert from 'node:assert/strict';
// exactNumber.js is a classic browser global, like boardMoves.js; importing it for its
// side effect publishes the API on globalThis.EXACT.
await import('./exactNumber.js');
const { fmt, asFraction } = globalThis.EXACT;

test('whole numbers print as they are', () => {
  assert.equal(fmt(0), '0');
  assert.equal(fmt(2), '2');
  assert.equal(fmt(-3), '-3');
});

test('thirds print as thirds, with the whole part split off', () => {
  assert.equal(fmt(2 / 3), '2/3');
  assert.equal(fmt(1 / 3), '1/3');
  assert.equal(fmt(4 / 3), '1 1/3');
  assert.equal(fmt(5 / 3), '1 2/3');
  assert.equal(fmt(-1 / 3), '-1/3');
  assert.equal(fmt(1.5), '1 1/2');
});

test('a fraction comes back in lowest terms', () => {
  assert.deepEqual(asFraction(6 / 9), { n: 2, d: 3 });
});

test('a number that is no small fraction is printed in full, not cut short', () => {
  assert.equal(fmt(Math.PI), String(Math.PI));
  // Float dust is not a third: this is what three road steps used to leave behind.
  const dust = 1 - 1 / 3 - 1 / 3 - 1 / 3;
  assert.equal(fmt(dust), String(dust));
});

test('nothing to show shows nothing; text passes through', () => {
  assert.equal(fmt(null), '');
  assert.equal(fmt(undefined), '');
  assert.equal(fmt('—'), '—');
});
