import { test } from 'node:test';
import assert from 'node:assert/strict';
// groupOrders.js is a classic browser global (no ESM export, so vue3-sfc-loader can
// load it); importing it for its side effect publishes the API on globalThis.GROUP.
await import('./groupOrders.js');
const { boxPick, formationTargets } = globalThis.GROUP;

const unit = (id, x, y, extra = {}) => ({ id, x, y, team: 'p1', moveRange: 3, ...extra });
const building = (id, x, y, extra = {}) => ({ id, x, y, team: 'p1', ...extra });

test('a box picks up the units whose centre is inside it, whichever way it was dragged', () => {
  const tokens = [unit('a', 1, 1), unit('b', 2, 2), unit('c', 5, 5)];
  assert.deepEqual(boxPick(tokens, { x0: 0, y0: 0, x1: 3, y1: 3 }, 'p1'), ['a', 'b']);
  assert.deepEqual(boxPick(tokens, { x0: 3, y0: 3, x1: 0, y1: 0 }, 'p1'), ['a', 'b']);
});

test('a box leaves out the other side and the dead', () => {
  const tokens = [unit('a', 1, 1), unit('e', 1.5, 1.5, { team: 'p2' }), unit('d', 2, 2, { dead: true })];
  assert.deepEqual(boxPick(tokens, { x0: 0, y0: 0, x1: 3, y1: 3 }, 'p1'), ['a']);
});

test('units in the box win over the buildings they stand around', () => {
  const tokens = [building('cc', 2, 2), unit('scv', 3, 2)];
  assert.deepEqual(boxPick(tokens, { x0: 0, y0: 0, x1: 4, y1: 4 }, 'p1'), ['scv']);
});

test('a box holding only buildings takes the buildings', () => {
  const tokens = [building('cc', 2, 2), unit('scv', 9, 9)];
  assert.deepEqual(boxPick(tokens, { x0: 0, y0: 0, x1: 4, y1: 4 }, 'p1'), ['cc']);
});

test('a unit with no move left is still picked up (selection is not an order)', () => {
  const tokens = [unit('a', 1, 1, { moveRange: 0 })];
  assert.deepEqual(boxPick(tokens, { x0: 0, y0: 0, x1: 3, y1: 3 }, 'p1'), ['a']);
});

test('a group keeps its shape around the clicked point', () => {
  const tokens = [unit('a', 1, 1), unit('b', 3, 1)];   // centre (2, 1)
  const orders = formationTargets(tokens, { x: 3, y: 2 });
  assert.deepEqual(orders, [
    { unitId: 'a', to: { x: 2, y: 2 } },
    { unitId: 'b', to: { x: 4, y: 2 } },
  ]);
});

test('a group spread wider than maxSpread is drawn in to it', () => {
  const tokens = [unit('a', 0, 0, { moveRange: 100 }), unit('b', 20, 0, { moveRange: 100 })];   // spread 10
  const orders = formationTargets(tokens, { x: 10, y: 10 }, { maxSpread: 2 });
  assert.deepEqual(orders.map(o => o.to), [{ x: 8, y: 10 }, { x: 12, y: 10 }]);
});

test('a target past a unit\'s reach is pulled back along the line toward it', () => {
  const tokens = [unit('a', 0, 0, { moveRange: 2 })];
  const [{ to }] = formationTargets(tokens, { x: 10, y: 0 });
  assert.ok(Math.abs(to.x - 2 * 0.999) < 1e-9 && to.y === 0, JSON.stringify(to));
  assert.ok(Math.hypot(to.x, to.y) < 2, 'stays strictly inside the reach');
});

test('a unit that cannot move gets no order', () => {
  const tokens = [unit('a', 0, 0, { moveRange: 0 }), building('cc', 1, 1), unit('b', 2, 0)];
  assert.deepEqual(formationTargets(tokens, { x: 2, y: 1 }).map(o => o.unitId), ['b']);
});

test('a flank\'s offset never pushes its target off the board', () => {
  const tokens = [unit('a', 1, 1), unit('b', 3, 1)];
  const orders = formationTargets(tokens, { x: 0.5, y: 1 }, { bounds: { w: 10, h: 10 } });
  assert.ok(orders.every(o => o.to.x > 0 && o.to.x < 10), JSON.stringify(orders));
});
