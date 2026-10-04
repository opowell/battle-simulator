/**
 * Every registered game, run through the customised-starting-units layer
 * (engine/startingSetup.js).
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
import { rosterFromState, applyRoster, rosterError } from '../engine/startingSetup.js';

import { ChessGame }         from './chess/index.js';
import { TacticalGame }      from './tactical/index.js';
import { CardBattleGame }    from './cardbattle/index.js';
import { Civ1Game }          from './civ1/index.js';
import { Civ2Game }          from './civ2/index.js';
import { RiskGame }          from './risk/index.js';
import { AxisAlliesGame }    from './axisallies/index.js';
import { CombatMissionGame } from './combatmission/index.js';
import { XComGame }          from './xcom/index.js';
import { AowGame }           from './aow/index.js';
import { CsGame }            from './cs/index.js';
import { CsMiniGame }        from './csmini/index.js';
import { FFTAGame }          from './ffta/index.js';
import { Sc1Game }           from './sc1/index.js';
import { Sc2Game }           from './sc2/index.js';
import { DoomGame }          from './doom/index.js';
import { MudAndBloodGame }   from './mudandblood/index.js';
import { KDiceGame }         from './kdice/index.js';
import { WarodDotsGame }     from './warofdots/WarodDotsGame.js';
import { SurvivGame }        from './surviv/index.js';
import { Memoir44Game }      from './memoir44/index.js';

// Seat ids as api-server.js's registry deals them.
const GAMES = [
  ['chess', ChessGame, ['white', 'black']],
  ['tactical', TacticalGame, ['p1', 'p2']],
  ['cardbattle', CardBattleGame, ['p1', 'p2']],
  ['civ1', Civ1Game, ['p1', 'p2']],
  ['civ2', Civ2Game, ['p1', 'p2']],
  ['risk', RiskGame, ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']],
  ['axisallies', AxisAlliesGame, ['allies', 'axis']],
  ['combatmission', CombatMissionGame, ['p1', 'p2']],
  ['xcom', XComGame, ['xcom', 'aliens']],
  ['aow', AowGame, ['p1', 'p2']],
  ['cs', CsGame, ['ct', 't']],
  ['csmini', CsMiniGame, ['ct', 't']],
  ['ffta', FFTAGame, ['p1', 'p2']],
  ['sc1', Sc1Game, ['p1', 'p2']],
  ['sc2', Sc2Game, ['p1', 'p2']],
  ['doom', DoomGame, ['marine', 'demons']],
  ['mudandblood', MudAndBloodGame, ['allies', 'axis']],
  ['kdice', KDiceGame, ['p1', 'p2', 'p3', 'p4']],
  ['warofdots', WarodDotsGame, ['player', 'ai']],
  ['surviv', SurvivGame, ['blue', 'red']],
  ['memoir44', Memoir44Game, ['allies', 'axis']],
];

const seats = (ids) => ids.map(id => ({ id, name: id }));

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

for (const [name, game, ids] of GAMES) {
  test(`${name}: its opening roster can be edited`, () => {
    const players = seats(ids);
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
