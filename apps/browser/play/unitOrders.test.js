import { test } from 'node:test';
import assert from 'node:assert/strict';
// unitOrders.js is a classic browser global (no ESM export, so vue3-sfc-loader can
// load it); importing it for its side effect publishes the API on globalThis.ORDERS.
await import('./unitOrders.js');
const { orderOwner, ordersFor, othersHaveOrders, onOwnScreen } = globalThis.ORDERS;

const actions = [
  { type: 'move', unitId: 'u1', to: 'a1' },
  { type: 'attack', unitId: 'u1', targetId: 'e1' },
  { type: 'gather-minerals', unitId: 'u2' },
  { type: 'set-production', buildingId: 'b0', unitType: 'scv' },
  { type: 'play-card', cardId: 'c3' },
  { type: 'end-turn', unitId: '__player__' },
];
const types = (list) => list.map(a => a.type);

test('an order belongs to its unit; the player\'s own actions to nobody', () => {
  assert.equal(orderOwner(actions[0]), 'u1');
  assert.equal(orderOwner(actions[3]), 'b0');
  assert.equal(orderOwner(actions[4]), null);
  assert.equal(orderOwner(actions[5]), null);
});

test('the unit in hand gets its own orders and the player\'s, no one else\'s', () => {
  assert.deepEqual(types(ordersFor(actions, 'u1')), ['move', 'attack', 'play-card', 'end-turn']);
  assert.deepEqual(types(ordersFor(actions, 'b0')), ['set-production', 'play-card', 'end-turn']);
});

test('with no unit in hand only the player\'s actions are listed', () => {
  assert.deepEqual(types(ordersFor(actions, null)), ['play-card', 'end-turn']);
});

test('an order for a unit the board has no token for stays listed', () => {
  // The board names the tokens of a game whose squares carry no ids itself, so no
  // pick-up could ever reach these orders.
  const tokens = new Set(['u1', 'b0']);
  assert.equal(orderOwner(actions[2], tokens), null);
  assert.deepEqual(types(ordersFor(actions, null, tokens)), ['gather-minerals', 'play-card', 'end-turn']);
  assert.deepEqual(types(ordersFor(actions, 'u1', tokens)), ['move', 'attack', 'gather-minerals', 'play-card', 'end-turn']);
  assert.equal(othersHaveOrders(actions, 'u1', tokens), true);
  assert.equal(othersHaveOrders(actions.slice(2), null, new Set()), false);
});

test('it can tell when other units are still waiting on orders', () => {
  assert.equal(othersHaveOrders(actions, null), true);
  assert.equal(othersHaveOrders(actions.slice(0, 2), 'u1'), false);
  assert.equal(othersHaveOrders(actions.slice(4), null), false);
});

test('a building\'s production is its order; a city\'s is the city screen\'s', () => {
  // SC1/SC2: the command center on the board trains SCVs — listed when it is picked up.
  assert.equal(onOwnScreen({ type: 'set-production', buildingId: 'b0', unitType: 'scv' }), false);
  assert.deepEqual(types(ordersFor(actions, 'b0').filter(a => !onOwnScreen(a))), ['set-production', 'play-card', 'end-turn']);
  // civ1: a city's production, and the empire's rates, are set on screens of their own.
  assert.equal(onOwnScreen({ type: 'set-production', cityId: 'c1', item: 'militia', unitId: '__player__' }), true);
  assert.equal(onOwnScreen({ type: 'set-tax', rate: 50, unitId: '__player__' }), true);
  assert.equal(onOwnScreen({ type: 'set-research', tech: 'bronze-working' }), true);
  assert.equal(onOwnScreen({ type: 'end-turn', unitId: '__player__' }), false);
});
