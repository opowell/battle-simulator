// No legal action may leave the state exactly as it found it.
//
// A turn here ends only when a player chooses 'end-turn', so an action that is
// always legal and changes nothing is a way to act forever: a search agent that
// ranks it first picks it again every time it is asked, and the turn stops only
// when the engine's step budget runs out. 'skip-unit' was exactly that — it
// zeroes a unit's moves and attacks, but was offered to units already on zero,
// which is why an Obscuro fog game (games/sc2/fog.test.js) never finished.
//
// This is the same guard games/sc1/noop-actions.test.js keeps over the identical
// defect there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sc2Game } from './index.js';
import { RandomAgent } from '../../agents/index.js';

function players() {
  return [
    { id: 'p1', name: 'P1', agent: RandomAgent, race: 'terran' },
    { id: 'p2', name: 'P2', agent: RandomAgent, race: 'zerg' },
  ];
}

// State identity as the search sees it: the moving parts, without the bookkeeping
// ('lastActions') that every action touches whether or not anything really happened.
const shape = (s) => JSON.stringify({
  units: s.units, buildings: s.buildings, gameSpecific: s.gameSpecific,
  turnNumber: s.turnNumber, activePlayers: s.activePlayers,
});

test('sc2: skip-unit is not offered to a unit that has nothing left to skip', () => {
  const state = Sc2Game.createInitialState(players());
  const mine  = state.units.filter(u => u.alive && u.ownerId === 'p1');
  assert.ok(mine.length > 0, 'p1 has units');

  // Spend one unit outright, exactly as skip-unit itself would.
  const spent = mine[0];
  const after = {
    ...state,
    units: state.units.map(u => u.id === spent.id ? { ...u, movesLeft: 0, attacksLeft: 0 } : u),
  };

  assert.deepEqual(
    Sc2Game.getLegalActions(after, 'p1').filter(a => a.type === 'skip-unit' && a.unitId === spent.id),
    [], 'a spent unit is not offered another skip');

  // The unspent ones still are — the gate must not have swallowed the action entirely.
  assert.ok(
    Sc2Game.getLegalActions(after, 'p1').some(a => a.type === 'skip-unit'),
    'units with moves left can still be skipped');
});

test('sc2: skipping a unit twice in a row is impossible', () => {
  const state  = Sc2Game.createInitialState(players());
  const target = state.units.find(u => u.alive && u.ownerId === 'p1');
  const once   = Sc2Game.applyActions(
    state, [{ playerId: 'p1', action: { type: 'skip-unit', unitId: target.id } }]);

  assert.equal(
    Sc2Game.getLegalActions(once, 'p1').some(a => a.type === 'skip-unit' && a.unitId === target.id),
    false, 'the same unit cannot be skipped again');
});

test('sc2: no legal action leaves the state unchanged', () => {
  // Swept from part-way through a turn, not from the opening position: at the
  // opening every unit still has moves, so a no-op that only appears once a unit
  // is spent would slip straight through. Skip half the units first to get there.
  let state  = Sc2Game.createInitialState(players());
  const mine = state.units.filter(u => u.alive && u.ownerId === 'p1');
  for (const u of mine.slice(0, Math.ceil(mine.length / 2))) {
    state = Sc2Game.applyActions(
      state, [{ playerId: 'p1', action: { type: 'skip-unit', unitId: u.id } }], () => 0.5);
  }
  assert.ok(state.units.some(u => u.ownerId === 'p1' && u.alive && u.movesLeft === 0),
    'the sweep really is running against spent units');

  const legal = Sc2Game.getLegalActions(state, 'p1');
  assert.ok(legal.length > 0, 'p1 has actions');

  const before = shape(state);
  const noops  = [];
  for (const action of legal) {
    // 'end-turn' is the intended way out of the turn and is allowed to be the one
    // action whose whole job is bookkeeping.
    if (action.type === 'end-turn') continue;
    // A fixed rng keeps a combat roll from being mistaken for a real difference.
    if (shape(Sc2Game.applyActions(state, [{ playerId: 'p1', action }], () => 0.5)) === before) {
      noops.push(action);
    }
  }
  assert.deepEqual(noops, [], 'every action must move the game somewhere');
});

test('sc2: a turn ends after a bounded number of actions', () => {
  // The concrete symptom: with no no-op available, a player who keeps acting runs
  // out of things to do rather than going round forever.
  let state   = Sc2Game.createInitialState(players());
  const start = state.turnNumber;
  let acted   = 0;

  while (state.turnNumber === start && state.activePlayers.includes('p1') && acted < 500) {
    const legal  = Sc2Game.getLegalActions(state, 'p1');
    // Always take a non-end-turn action if one exists — the worst case for a loop.
    const action = legal.find(a => a.type !== 'end-turn') ?? legal[0];
    state = Sc2Game.applyActions(state, [{ playerId: 'p1', action }], () => 0.5);
    acted++;
  }

  assert.ok(acted < 500, `p1 ran out of orders (took ${acted})`);
});
