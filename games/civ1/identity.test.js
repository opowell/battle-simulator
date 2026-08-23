import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Civ1Game } from './index.js';
import { canonicalObsSig } from '../../vendor/obscuro/src/infoset.js';

const players = () => [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];
const newGame = (config = {}) =>
  Civ1Game.createInitialState(players(), { width: 30, height: 20, seed: 7, fogOfWar: true, ...config });

const apply = (state, pid, action) => Civ1Game.applyActions(state, [{ playerId: pid, action }]);
// The two ways obscuro asks: `sig` is the raw hook (how true worlds are deduped),
// `obsSig` is the infoset key, where getVisibleState has already applied the fog.
const sig = (state, pid) => canonicalObsSig(Civ1Game.identityOf(state, pid));
const obsSig = (state, pid) => sig(Civ1Game.getVisibleState(state, pid), pid);

// Move a unit to an arbitrary square without going through the rules — these tests
// are about what the identity NAMES, not about which moves are legal.
const teleport = (state, unitId, x, y) => ({
  ...state,
  units: state.units.map(u => (u.id === unitId ? { ...u, position: { x, y } } : u)),
});

// ── The condition the search's own diagnostic checks ─────────────────────────
// "Your own move must change what you see": if it never does, every state at a ply
// keys into one infoset and the opponent's histories stop being distinguishable.
// This is the check that was failing in the server log, run here for both action
// sets — the pruned search set is the one the agent actually plays on.

for (const [label, actionsOf] of [
  ['legal actions', (s, p) => Civ1Game.getLegalActions(s, p)],
  ['search actions', (s, p) => Civ1Game.getSearchActions(s, p)],
]) {
  test(`civ1 identity responds to our own ${label}`, () => {
    const state = newGame();
    const base = sig(state, 'p1');
    const probed = actionsOf(state, 'p1').slice(0, 6);   // obscuro's identityProbeActions
    assert.ok(probed.length >= 2, 'need something to compare');
    assert.ok(
      probed.some(a => sig(apply(state, 'p1', a), 'p1') !== base),
      `no first-6 ${label} changed the identity`,
    );
  });
}

test('civ1 identity distinguishes the orders a move never shows on the map', () => {
  const state = newGame();
  const unit = state.units.find(u => u.ownerId === 'p1' && u.type === 'militia');
  // fortify and skip-unit both zero the unit's moves and leave it where it stands;
  // only the standing order tells them apart.
  const fortified = sig(apply(state, 'p1', { type: 'fortify', unitId: unit.id }), 'p1');
  const skipped   = sig(apply(state, 'p1', { type: 'skip-unit', unitId: unit.id }), 'p1');
  assert.notEqual(fortified, skipped);
  assert.notEqual(fortified, sig(state, 'p1'));
});

test('civ1 identity names the empire ledger, not just the board', () => {
  const state = newGame();
  const tech = Civ1Game.getLegalActions(state, 'p1').find(a => a.type === 'set-research');
  assert.ok(tech, 'expected a research choice on turn 1');
  assert.notEqual(sig(apply(state, 'p1', tech), 'p1'), sig(state, 'p1'), 'research target is invisible');

  const taxed = { ...state, gameSpecific: { ...state.gameSpecific,
    civ: { ...state.gameSpecific.civ, p1: { ...state.gameSpecific.civ.p1, gold: 99 } } } };
  assert.notEqual(sig(taxed, 'p1'), sig(state, 'p1'), 'treasury is invisible');
});

test('civ1 identity names terrain our settlers change', () => {
  const state = newGame();
  const settler = state.units.find(u => u.ownerId === 'p1' && u.type === 'settlers');
  const pos = `${settler.position.x},${settler.position.y}`;
  const before = Civ1Game.identityOf(state, 'p1')[`t:${pos}`];
  const roaded = {
    ...state,
    board: { ...state.board, tiles: { ...state.board.tiles,
      [pos]: { ...state.board.tiles[pos], hasRoad: true } } },
  };
  assert.ok(before !== undefined, 'the square under our own unit is named');
  assert.notEqual(Civ1Game.identityOf(roaded, 'p1')[`t:${pos}`], before);
});

// ── Fog ──────────────────────────────────────────────────────────────────────
//
// The hook does no filtering itself. Fogging is getVisibleState's job, so the
// infoset key must hide an unseen enemy while the raw hook — which obscuro uses to
// dedupe carried tree nodes against fresh belief samples — must still tell two
// worlds apart by where that enemy stands.

test('civ1 infoset key ignores enemies we cannot see, and names the ones we can', () => {
  const state = newGame();
  const mine = state.units.find(u => u.ownerId === 'p1');
  const theirs = state.units.find(u => u.ownerId === 'p2');

  const farA = teleport(state, theirs.id, (mine.position.x + 10) % state.board.width, mine.position.y);
  const farB = teleport(state, theirs.id, (mine.position.x + 12) % state.board.width, mine.position.y);
  assert.equal(obsSig(farA, 'p1'), obsSig(farB, 'p1'), 'two hidden placements are one information set');

  // Step that same enemy next to our unit and it must show up.
  const near = teleport(state, theirs.id, mine.position.x, mine.position.y + 1);
  assert.notEqual(obsSig(near, 'p1'), obsSig(farA, 'p1'));
  assert.ok(obsSig(near, 'p1').includes('p2'), 'the enemy we can see is named');
});

test('civ1 identity of a true world still separates belief worlds', () => {
  // If this ever collapses, every fresh sample dedupes away against one carried
  // world and the search runs on a one-particle belief.
  const state = newGame();
  const mine = state.units.find(u => u.ownerId === 'p1');
  const theirs = state.units.find(u => u.ownerId === 'p2');
  const farA = teleport(state, theirs.id, (mine.position.x + 10) % state.board.width, mine.position.y);
  const farB = teleport(state, theirs.id, (mine.position.x + 12) % state.board.width, mine.position.y);
  assert.notEqual(sig(farA, 'p1'), sig(farB, 'p1'));
});

test('civ1 identity names only our own ledger', () => {
  // A rival's ledger is redacted out of the observation, so naming it would stop a
  // sampled world from ever matching the real position it stands for.
  const state = newGame();
  const richer = { ...state, gameSpecific: { ...state.gameSpecific,
    civ: { ...state.gameSpecific.civ, p2: { ...state.gameSpecific.civ.p2, gold: 500 } } } };
  assert.equal(sig(richer, 'p1'), sig(state, 'p1'));
  assert.notEqual(sig(richer, 'p2'), sig(state, 'p2'));
});

test('civ1 infoset key with fog off names both sides', () => {
  const state = newGame({ fogOfWar: false });
  const theirs = state.units.find(u => u.ownerId === 'p2');
  const moved = teleport(state, theirs.id, (theirs.position.x + 3) % state.board.width, theirs.position.y);
  assert.notEqual(obsSig(moved, 'p1'), obsSig(state, 'p1'), 'with no fog every move is observable');
});

// ── The vision set getVisibleState is built on ───────────────────────────────

test('civ1 vision wraps east/west', () => {
  const state = newGame();
  const mine = state.units.find(u => u.ownerId === 'p1');
  const theirs = state.units.find(u => u.ownerId === 'p2');
  const W = state.board.width;
  const wrapped = teleport(teleport(state, mine.id, 0, 5), theirs.id, W - 1, 5);
  assert.equal(Civ1Game.getVisibleState(wrapped, 'p1').units.some(u => u.id === theirs.id), true);
  assert.ok(obsSig(wrapped, 'p1').includes(`u:${W - 1},5`), 'the wrapped neighbour is in the key');
});
