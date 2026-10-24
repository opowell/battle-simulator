// Customised starting units in civ1: the fog, the unit factory and the map seed
// (src/engine/startingSetup.js; that every game survives an edited roster is its
// contract.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rosterFromState, applyRoster, rosterError } from '#core/engine/startingSetup.js';
import { Civ1Game } from './index.js';

const seats = (ids) => ids.map(id => ({ id, name: id }));

test('civ1: moving a starting unit moves the hole it opens in the fog', () => {
  const players = seats(['p1', 'p2']);
  const config = { fogOfWar: true, width: 40, height: 24, seed: 7 };
  const base = Civ1Game.createInitialState(players, config);
  const roster = rosterFromState(base);
  // Both of p1's units march ten squares east, so nothing of theirs is left near
  // the squares the civ would otherwise have opened the game looking at.
  const mine = roster.filter(u => u.ownerId === 'p1');
  const moved = roster.map(u => (u.ownerId === 'p1'
    ? { ...u, position: { x: (u.position.x + 10) % 40, y: u.position.y } }
    : u));
  const state = applyRoster(Civ1Game, base, moved, config);

  const seen = (st, x, y) => st.gameSpecific.explored.p1[y * st.board.width + x] === '1';
  for (const u of mine) {
    assert.ok(seen(state, (u.position.x + 10) % 40, u.position.y), 'the new square is explored');
    assert.ok(!seen(state, u.position.x, u.position.y),
      'the square it no longer starts on is not');
  }
});

test('civ1: a roster may ask for a unit type the civ does not open with', () => {
  const players = seats(['p1', 'p2']);
  const config = { width: 40, height: 24, seed: 7 };
  const base = Civ1Game.createInitialState(players, config);
  const roster = rosterFromState(base);
  const extra = { ownerId: 'p1', type: 'legion', position: roster[0].position };
  assert.equal(rosterError(Civ1Game, base, [...roster, extra], players), '');
  const state = applyRoster(Civ1Game, base, [...roster, extra], config);
  const legion = state.units.find(u => u.type === 'legion');
  assert.equal(legion.ownerId, 'p1');
  assert.ok(legion.hp > 0 && legion.moveThirds > 0);   // built by the game's own factory
});

test('civ1: a blank map seed is pinned before a roster is laid out on the world', () => {
  const pinned = Civ1Game.resolveSetupConfig({ width: 40 });
  assert.ok(Number.isInteger(pinned.seed) && pinned.seed > 0);
  assert.equal(Civ1Game.resolveSetupConfig({ seed: 99 }).seed, 99);
});
