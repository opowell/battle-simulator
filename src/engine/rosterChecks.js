/**
 * The check every game's own contract.test.js runs against the customised-
 * starting-units layer (startingSetup.js).
 *
 * The layer is generic, so the thing worth testing is not the layer — it's that
 * each game actually SURVIVES having its opening roster edited: a unit dropped
 * from the roster is gone everywhere the game shows its position (not just from
 * `state.units`), an added one is really there, and the game still generates legal
 * actions afterwards. A game that keeps its pieces somewhere else as well fails
 * here until it implements `applyStartingUnits` — which is exactly how chess's
 * `board` was found.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rosterFromState, applyRoster, rosterError } from './startingSetup.js';

const seated = (ids) => ids.map(id => ({ id, name: id }));

/** Everywhere `state` still says a unit is on the board. */
function shownUnitIds(game, state) {
  const ids = new Set((state.units ?? []).filter(u => u.alive !== false).map(u => u.id));
  const grid = game.toGrid?.(state);
  for (const c of grid?.cells ?? []) if (c.unitId) ids.add(c.unitId);
  for (const u of grid?.units ?? []) if (u.id) ids.add(u.id);
  for (const p of state.players ?? []) {
    for (const a of game.getLegalActions(state, p.id) ?? []) if (a.unitId) ids.add(a.unitId);
  }
  return ids;
}

/** @param {string} name  @param {object} game  @param {string[]} [seats] the game's own seat ids */
export function rosterChecks(name, game, seats = ['p1', 'p2']) {
  test(`${name}: its opening roster can be edited`, () => {
    const players = seated(seats);
    const base = game.createInitialState(players, {});
    const roster = rosterFromState(base);
    if (!roster.length) return;   // nothing per-unit to customise (risk, aow, kdice)

    // Rebuilding with the game's own roster changes nothing.
    assert.equal(rosterError(game, base, roster, players), '');
    assert.deepEqual(rosterFromState(applyRoster(game, base, roster)), roster);

    // A dropped unit is gone from the position, not just from the units array —
    // including from any second copy of it the game keeps (chess's board).
    const owned = new Map();
    for (const u of roster) owned.set(u.ownerId, (owned.get(u.ownerId) ?? 0) + 1);
    const dropped = [...roster].reverse().find(u => owned.get(u.ownerId) > 1);
    if (dropped) {
      const fewer = applyRoster(game, base, roster.filter(u => u.id !== dropped.id));
      assert.ok(!shownUnitIds(game, fewer).has(dropped.id),
        `${name}: ${dropped.id} is still on the board after being dropped from the roster`);
      assert.equal(fewer.units.filter(u => u.alive !== false).length, roster.length - 1);
    }

    // An added unit really is one more unit, and the game plays on.
    const extra = { ownerId: roster[0].ownerId, type: roster[0].type, position: roster[0].position };
    const more = applyRoster(game, base, [...roster, extra]);
    assert.equal(more.units.filter(u => u.alive !== false).length, roster.length + 1);
    assert.equal(new Set(more.units.map(u => u.id)).size, more.units.length, `${name}: duplicate unit ids`);
    for (const p of players) assert.ok(Array.isArray(game.getLegalActions(more, p.id)));
  });
}
