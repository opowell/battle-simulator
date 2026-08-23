import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Civ1Game } from './index.js';
import { CIVS, CIV_IDS, SPARE_CITIES, getCiv, nextCityName, pickCivs } from './civs.js';

const players = (n = 2) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));

// ── The roster ───────────────────────────────────────────────────────────────

test('civs: the original fourteen, sixteen cities each', () => {
  assert.equal(CIVS.length, 14);
  assert.equal(new Set(CIV_IDS).size, 14);
  for (const c of CIVS) {
    assert.equal(c.cities.length, 16, `${c.id} has ${c.cities.length} cities`);
    assert.equal(new Set(c.cities).size, 16, `${c.id} repeats a city name`);
    assert.ok(c.name && c.adjective && c.leader && c.color, `${c.id} is missing a field`);
  }
  assert.equal(SPARE_CITIES.length, 32);
  assert.equal(new Set(SPARE_CITIES).size, 32);
});

// Seven colours, fourteen civs: every colour is a pair, and the pair is the civ seven
// places later — the rule pickCivs relies on to keep a game's seats distinct.
test('civs: colours come in pairs, seven places apart', () => {
  const colors = CIVS.map(c => c.color);
  assert.equal(new Set(colors).size, 7);
  for (let i = 0; i < 7; i++) assert.equal(colors[i], colors[i + 7]);
  assert.ok(!colors.includes('red'), 'red belongs to the barbarians, never a civ');
});

// ── City naming ──────────────────────────────────────────────────────────────

test('civs: a civ founds cities down its own list, in order', () => {
  const used = new Set();
  const rome = getCiv('romans');
  for (const expected of rome.cities) {
    const name = nextCityName('romans', used);
    assert.equal(name, expected);
    used.add(name);
  }
});

test('civs: past its own sixteen a civ takes the shared spares', () => {
  const used = new Set(getCiv('zulus').cities);
  assert.equal(nextCityName('zulus', used), SPARE_CITIES[0]);
});

test('civs: own list and spares exhausted, it takes any free name', () => {
  const used = new Set([...getCiv('romans').cities, ...SPARE_CITIES]);
  // The first name of the first civ that still has one — the Romans are used up, so
  // the Babylonian list is next in the original's global order.
  assert.equal(nextCityName('romans', used), 'Babylon');
});

test('civs: a name already on the map is never handed out twice', () => {
  // Antioch is Roman AND Greek in the original's lists; Hamburg is German AND spare.
  assert.ok(getCiv('greeks').cities.includes('Antioch'));
  const used = new Set(['Athens', 'Sparta', 'Corinth', 'Delphi', 'Eretria', 'Pharsalos',
    'Argos', 'Mycenae', 'Herakleia', 'Antioch']);
  assert.equal(nextCityName('greeks', used), 'Ephesos');
});

test('civs: an unknown or missing civ still names its cities', () => {
  assert.equal(getCiv(undefined).id, 'romans');
  assert.equal(nextCityName('atlanteans', new Set()), 'Rome');
});

// ── Assignment ───────────────────────────────────────────────────────────────

test('civs: seats get distinct civs, no two sharing a colour', () => {
  const rng = () => 0.5;
  for (const n of [2, 3, 4, 7]) {
    const ids = pickCivs(n, rng);
    assert.equal(ids.length, n);
    assert.equal(new Set(ids).size, n);
    assert.equal(new Set(ids.map(id => getCiv(id).color)).size, n, `${n} seats reused a colour`);
  }
});

test('civs: more seats than colours keeps every seat a civ of its own', () => {
  const ids = pickCivs(14, () => 0.5);
  assert.equal(new Set(ids).size, 14);
});

test('civs: the menu pick takes the first seat', () => {
  assert.equal(pickCivs(2, () => 0.5, 'mongols')[0], 'mongols');
  // ...and the rival never ends up the Mongols' colour twin.
  assert.notEqual(getCiv(pickCivs(2, () => 0.5, 'mongols')[1]).color, getCiv('mongols').color);
});

test('civs: no rng means the original roster order', () => {
  assert.deepEqual(pickCivs(4), ['romans', 'babylonians', 'germans', 'egyptians']);
});

// ── In the game ──────────────────────────────────────────────────────────────

test('civ1: a new game assigns every seat a civ', () => {
  const state = Civ1Game.createInitialState(players(4), { seed: 12345, width: 40, height: 24 });
  const tribes = state.gameSpecific.tribes;
  assert.deepEqual(Object.keys(tribes), ['p1', 'p2', 'p3', 'p4']);
  assert.equal(new Set(Object.values(tribes)).size, 4);
  for (const id of Object.values(tribes)) assert.ok(CIV_IDS.includes(id));
});

test('civ1: the chosen civ is the first seat’s', () => {
  const state = Civ1Game.createInitialState(players(2), { seed: 7, civ: 'aztecs' });
  assert.equal(state.gameSpecific.tribes.p1, 'aztecs');
});

test('civ1: the same seed picks the same civs', () => {
  const a = Civ1Game.createInitialState(players(3), { seed: 999 });
  const b = Civ1Game.createInitialState(players(3), { seed: 999 });
  assert.deepEqual(a.gameSpecific.tribes, b.gameSpecific.tribes);
});

test('civ1: founded cities take their own civ’s names', () => {
  let state = Civ1Game.createInitialState(players(2), { seed: 4242, civ: 'english', fogOfWar: false });
  // The rival is whatever the draw gave it — ask the state, not the roster order.
  const p2Civ = getCiv(state.gameSpecific.tribes.p2);

  const found = (pid) => {
    const settler = state.units.find(u => u.alive && u.ownerId === pid && u.type === 'settlers');
    return Civ1Game.applyActions(state, [{ playerId: pid, action: { type: 'found-city', unitId: settler.id } }]);
  };
  state = found('p1');
  assert.equal(state.cities.at(-1).name, 'London');
  state = found('p2');
  assert.equal(state.cities.at(-1).name, p2Civ.cities[0]);
});

test('civ1: a seat’s civ survives the fog', () => {
  const state = Civ1Game.createInitialState(players(2), { seed: 31, fogOfWar: true });
  const seen = Civ1Game.getVisibleState(state, 'p1');
  // Who a rival IS is not secret in Civ1 — only their ledger is (see getVisibleState).
  assert.deepEqual(seen.gameSpecific.tribes, state.gameSpecific.tribes);
});
