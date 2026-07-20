import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Civ1Game } from './index.js';
import { UNITS } from './units.js';

const players = () => [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];
const newGame = (config = {}) =>
  Civ1Game.createInitialState(players(), { width: 30, height: 20, seed: 7, fogOfWar: true, ...config });

const search = (state, pid) => Civ1Game.getSearchActions(state, pid);
const apply = (state, pid, action) => Civ1Game.applyActions(state, [{ playerId: pid, action }]);
const keys = acts => new Set(acts.map(a => Civ1Game.actionKey(a)));

// ── The contract the search relies on ────────────────────────────────────────

test('search actions are a subset of the legal actions', () => {
  const state = newGame();
  const legal = keys(Civ1Game.getLegalActions(state, 'p1'));
  for (const a of search(state, 'p1')) {
    assert.ok(legal.has(Civ1Game.actionKey(a)), `${a.type} is not legal`);
  }
});

test('search actions are non-empty wherever legal actions are', () => {
  let state = newGame();
  for (let i = 0; i < 60 && Civ1Game.getLegalActions(state, 'p1').length; i++) {
    const acts = search(state, 'p1');
    assert.ok(acts.length > 0, 'pruned the action set to nothing');
    state = apply(state, 'p1', acts[0]);
  }
});

// An infoset's action set is fixed when the set is created and re-derived per world
// to filter it (agents/obscuro/search.js). A set that varied run to run, or that
// read through the fog, would desync the tree — see searchActions.js header.
test('search actions are deterministic', () => {
  const state = newGame();
  assert.deepEqual(
    [...keys(search(state, 'p1'))].sort(),
    [...keys(search(state, 'p1'))].sort(),
  );
});

test('search actions depend only on what the player can see', () => {
  const state = newGame();
  // Same set whether derived from the true state or from that player's own fogged
  // view of it: nothing in the pruner may read through the fog.
  const fogged = Civ1Game.getVisibleState(state, 'p1');
  assert.deepEqual(
    [...keys(search(state, 'p1'))].sort(),
    [...keys(search(fogged, 'p1'))].sort(),
  );
});

test('the action set stays narrow enough to search', () => {
  let state = newGame();
  let widest = 0;
  for (let i = 0; i < 120 && Civ1Game.getLegalActions(state, 'p1').length; i++) {
    const acts = search(state, 'p1');
    widest = Math.max(widest, acts.length);
    state = apply(state, 'p1', acts[0]);
  }
  // The raw legal set runs to dozens of actions from turn one and hundreds later.
  assert.ok(widest <= 8, `branching factor ${widest} is too wide to search`);
});

// ── Turn structure ───────────────────────────────────────────────────────────

test('end-turn is offered only when nothing else is left to decide', () => {
  let state = newGame();
  for (let i = 0; i < 40; i++) {
    const acts = search(state, 'p1');
    const end = acts.find(a => a.type === 'end-turn');
    if (end) {
      assert.equal(acts.length, 1, 'end-turn was offered alongside real orders');
      // Nothing that can still act is being left behind.
      const idle = state.units.filter(u => u.alive && u.ownerId === 'p1' && u.movesLeft > 0);
      assert.equal(idle.length, 0, `end-turn offered with ${idle.length} unit(s) still able to move`);
      return;
    }
    state = apply(state, 'p1', acts[0]);
  }
  assert.fail('never reached end-turn');
});

test('a turn always terminates in a bounded number of decisions', () => {
  let state = newGame();
  let steps = 0;
  while (steps < 200) {
    const acts = search(state, 'p1');
    steps++;
    if (acts[0].type === 'end-turn') return;
    state = apply(state, 'p1', acts[0]);
  }
  assert.fail(`turn did not terminate in ${steps} decisions`);
});

// ── The two failure modes that cost the agent whole games ────────────────────

test('production is left alone once the city is already building the best option', () => {
  let state = newGame();
  // Advance to a founded city.
  for (let i = 0; i < 40 && !state.cities.length; i++) {
    const acts = search(state, 'p1');
    const found = acts.find(a => a.type === 'found-city');
    state = apply(state, 'p1', found ?? acts[0]);
  }
  assert.ok(state.cities.length, 'expected a city to have been founded');

  // Whatever the pruner picks, offering it again on the next turn must not produce
  // a *different* pick — that oscillation (settlers → barracks → settlers …) meant
  // the capital finished nothing at all for a hundred turns.
  const city = state.cities.find(c => c.ownerId === 'p1');
  const prodActs = search(state, 'p1').filter(a => a.type === 'set-production');
  if (prodActs.length) {
    const chosen = prodActs[0];
    const after = { ...state, cities: state.cities.map(c => c.id === city.id ? { ...c, production: chosen.item } : c) };
    const again = search(after, 'p1').filter(a => a.type === 'set-production');
    assert.equal(again.length, 0, `re-offered a production change to ${again.map(a => a.item)} right after choosing ${chosen.item}`);
  }
});

test('units the empire cannot support are not offered as production', () => {
  let state = newGame();
  for (let i = 0; i < 40 && !state.cities.length; i++) {
    const acts = search(state, 'p1');
    const found = acts.find(a => a.type === 'found-city');
    state = apply(state, 'p1', found ?? acts[0]);
  }
  const city = state.cities.find(c => c.ownerId === 'p1');
  // A size-1 city already supporting a stack: every further unit costs a shield a
  // turn out of a gross yield of about five, so none should be on offer.
  const stack = Array.from({ length: 6 }, (_, i) => ({
    id: `x${i}`, ownerId: 'p1', type: 'militia', alive: true, hp: 10, maxHp: 10,
    movesLeft: 0, position: { ...city.position }, attrs: {}, queue: [],
  }));
  const loaded = {
    ...state,
    units: [...state.units.filter(u => u.ownerId !== 'p1'), ...stack],
    cities: state.cities.map(c => c.id === city.id ? { ...c, size: 1, production: 'militia', productionSetTurn: -1 } : c),
  };
  for (const a of search(loaded, 'p1')) {
    if (a.type !== 'set-production') continue;
    // Settlers are the deliberate exception: they cost food, but they become the
    // cities that raise the support cap in the first place.
    if (a.item === 'settlers') continue;
    assert.ok(!UNITS[a.item], `offered another ${a.item} while over the support cap`);
  }
});
