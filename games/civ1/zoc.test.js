// Zones of control — civ1's blockade rule (see makeZoneOfControl in map.js).
//
// The rule is small but every clause of it is a real Civ1 quirk, so each gets a
// test: only land units are bound, some units are exempt, cities and ocean lift it,
// and it takes ONE enemy covering both ends of the step rather than two different
// ones. The worlds here are hand-built and empty apart from the pieces under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Civ1Game, BARBARIAN_ID } from './index.js';
import { getReachableTiles, makeZoneOfControl } from './map.js';

const players = () => [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];

function unit(id, ownerId, type, x, y, over = {}) {
  return {
    id, ownerId, type, position: { x, y }, alive: true,
    hp: 10, maxHp: 10, movesLeft: 1, attrs: {}, queue: [], ...over,
  };
}

// A flat grassland world (move cost 1 everywhere, no roads) with nothing on it but
// what the test puts there. `terrainAt` paints exceptions — the ocean cases below.
function world(opts = {}) {
  const state = Civ1Game.createInitialState(players(), {
    width: 20, height: 20, seed: 7, barbarians: 'villages-only', fogOfWar: false,
  });
  const tiles = {};
  for (const [k, t] of Object.entries(state.board.tiles)) {
    tiles[k] = { ...t, terrain: opts.terrainAt?.(k) ?? 'grassland', hasRoad: false, hasRail: false };
  }
  return {
    ...state,
    turnNumber: opts.turnNumber ?? 1,
    board: { ...state.board, tiles },
    units: opts.units ?? [],
    cities: opts.cities ?? [],
  };
}

const canReach = (state, mover, to) =>
  getReachableTiles(mover, state.board, state.units, mover.ownerId, state.cities)
    .some(t => t.x === to.x && t.y === to.y);

// ---------------------------------------------------------------------------
// The core rule
// ---------------------------------------------------------------------------

test('civ1 zoc: a land unit cannot slide from one square an enemy covers to another', () => {
  // The enemy at (10,10) covers both (9,10) and (9,9): the mover is standing in its
  // zone and wants to slip sideways, still in it.
  const mover = unit('m', 'p1', 'militia', 9, 10);
  const state = world({ units: [mover, unit('e', 'p2', 'phalanx', 10, 10)] });

  assert.equal(canReach(state, mover, { x: 9, y: 9 }), false, 'sideways within the zone is blocked');
  assert.equal(canReach(state, mover, { x: 8, y: 10 }), true, 'stepping out of the zone is fine');
});

test('civ1 zoc: stepping *into* a zone from clear ground is always allowed', () => {
  const mover = unit('m', 'p1', 'militia', 8, 10);
  const state = world({ units: [mover, unit('e', 'p2', 'phalanx', 10, 10)] });
  assert.equal(canReach(state, mover, { x: 9, y: 10 }), true);
});

test('civ1 zoc: it takes one enemy covering both squares, not two different ones', () => {
  // Two enemies far apart. (9,2) is covered only by the northern one, (9,8) only by
  // the southern one — no single enemy covers both, so this quirk of the original
  // lets a unit walk from one zone straight into the other.
  const north = unit('e1', 'p2', 'phalanx', 10, 1);
  const south = unit('e2', 'p2', 'phalanx', 10, 9);
  const zoc = makeZoneOfControl(world().board, [north, south], [], 'p1');
  const mover = unit('m', 'p1', 'militia', 9, 2);

  assert.equal(zoc(mover, { x: 9, y: 2 }, { x: 9, y: 8 }), false, 'different zones: legal');
  assert.equal(zoc(mover, { x: 9, y: 2 }, { x: 9, y: 0 }), true, 'the north enemy covers both: blocked');
});

test('civ1 zoc: two enemies side by side seal the lane between them', () => {
  // Enemies at (10,9) and (10,11). Every north-south step through the x=9 column
  // beside them stays inside one of the two zones, so a unit coming up the column
  // is turned back at the line instead of walking through it.
  const mover = unit('m', 'p1', 'militia', 9, 8, { movesLeft: 3, type: 'armor' });
  const state = world({
    units: [mover, unit('e1', 'p2', 'phalanx', 10, 9), unit('e2', 'p2', 'phalanx', 10, 11)],
  });
  assert.equal(canReach(state, mover, { x: 9, y: 12 }), false, 'no way through on the near column');
  // Round the outside, though, and three moves is plenty.
  assert.equal(canReach(state, mover, { x: 7, y: 11 }), true);
});

test('civ1 zoc: the gap between two enemies is sealed, not a door', () => {
  // The tempting hole in the line: enemies at (10,9) and (10,11) with (10,10) empty
  // between them. Both cover the square the mover stands on and the gap itself, so
  // walking through is the one thing it cannot do — which is the whole point of the
  // rule, and the reason a picket line is worth forming at all.
  //
  // Armor has three moves, so the flood is checked at every step and not merely at
  // the destination: the same march with nobody about walks straight through.
  const mover = unit('m', 'p1', 'armor', 9, 10, { movesLeft: 3 });
  const line = [unit('e1', 'p2', 'phalanx', 10, 9), unit('e2', 'p2', 'phalanx', 10, 11)];
  const has = (units, x, y) => {
    const state = world({ units });
    return getReachableTiles(mover, state.board, state.units, 'p1', state.cities)
      .some(t => t.x === x && t.y === y);
  };

  assert.equal(has([mover, ...line], 10, 10), false, 'the gap is shut');
  assert.equal(has([mover, ...line], 11, 10), false, 'and so is everything through it');
  assert.equal(has([mover], 10, 10), true, 'with the line gone, both are an easy walk');
  assert.equal(has([mover], 11, 10), true);
});

// ---------------------------------------------------------------------------
// Who is bound, and who is exempt
// ---------------------------------------------------------------------------

test('civ1 zoc: sea and air units ignore it', () => {
  // On dry land, so the domain gate is the only thing that can be doing the work —
  // an ocean board would lift the rule for everyone and prove nothing.
  const zoc = makeZoneOfControl(world().board, [unit('e', 'p2', 'phalanx', 10, 10)], [], 'p1');
  const step = (u) => zoc(u, { x: 9, y: 10 }, { x: 9, y: 9 });

  assert.equal(step(unit('a', 'p1', 'militia', 9, 10)), true, 'land units are bound');
  assert.equal(step(unit('b', 'p1', 'trireme', 9, 10)), false, 'ships are not');
  assert.equal(step(unit('c', 'p1', 'fighter', 9, 10)), false, 'aircraft are not');
});

test("civ1 zoc: diplomats and caravans slip through ('ignore-zoc')", () => {
  const zoc = makeZoneOfControl(world().board, [unit('e', 'p2', 'phalanx', 10, 10)], [], 'p1');
  const step = (u) => zoc(u, { x: 9, y: 10 }, { x: 9, y: 9 });

  assert.equal(step(unit('a', 'p1', 'militia', 9, 10)), true);
  assert.equal(step(unit('b', 'p1', 'diplomat', 9, 10)), false, 'the diplomat walks past');
  assert.equal(step(unit('c', 'p1', 'caravan', 9, 10)), false, 'so does the caravan');
  assert.equal(step(unit('d', 'p1', 'settlers', 9, 10)), true, 'settlers are not exempt');
});

test('civ1 zoc: a city square at either end of the step lifts it, whoever owns it', () => {
  const enemy = unit('e', 'p2', 'phalanx', 10, 10);
  const mover = unit('m', 'p1', 'militia', 9, 10);
  const at = (x, y, ownerId) => [{
    id: `c-${x}-${y}`, name: 'Roma', ownerId, position: { x, y },
    size: 1, shields: 0, food: 0, production: 'militia', buildings: [],
  }];
  const blocked = (cities) =>
    makeZoneOfControl(world().board, [enemy, mover], cities, 'p1')(mover, { x: 9, y: 10 }, { x: 9, y: 9 });

  assert.equal(blocked([]), true, 'no city: blocked');
  assert.equal(blocked(at(9, 9, 'p1')), false, 'ducking into our own city');
  assert.equal(blocked(at(9, 10, 'p1')), false, 'stepping out of our own city');
  assert.equal(blocked(at(9, 9, 'p2')), false, "and into a rival's, which is how you take an empty one");
});

test('civ1 zoc: an ocean square at either end lifts it — a landing is never blockaded', () => {
  // The same step, (9,10) -> (9,9), with an enemy at (10,10) covering both ends. The
  // only difference between the two worlds is whether the mover starts on water.
  const enemy = unit('e', 'p2', 'phalanx', 10, 10);
  const marine = unit('m', 'p1', 'marines', 9, 10);
  const blockedOn = (board) =>
    makeZoneOfControl(board, [enemy], [], 'p1')(marine, { x: 9, y: 10 }, { x: 9, y: 9 });

  const wet = world({ terrainAt: (k) => (k === '9,10' ? 'ocean' : 'grassland') }).board;
  assert.equal(blockedOn(wet), false, 'coming ashore is never blockaded');
  assert.equal(blockedOn(world().board), true, 'the identical step overland is');
});

// ---------------------------------------------------------------------------
// Who projects it
// ---------------------------------------------------------------------------

test('civ1 zoc: barbarians project it against everyone, and are bound by it themselves', () => {
  const raider = unit('b', BARBARIAN_ID, 'legion', 10, 10);
  const defender = unit('d', 'p1', 'phalanx', 10, 10);
  const board = world().board;

  assert.equal(makeZoneOfControl(board, [raider], [], 'p1')(
    unit('m', 'p1', 'militia', 9, 10), { x: 9, y: 10 }, { x: 9, y: 9 }), true, 'raiders blockade');
  assert.equal(makeZoneOfControl(board, [defender], [], BARBARIAN_ID)(
    raider, { x: 9, y: 10 }, { x: 9, y: 9 }), true, 'and are blockaded');
});

test('civ1 zoc: our own units never blockade us', () => {
  const zoc = makeZoneOfControl(world().board, [unit('f', 'p1', 'phalanx', 10, 10)], [], 'p1');
  assert.equal(zoc(unit('m', 'p1', 'militia', 9, 10), { x: 9, y: 10 }, { x: 9, y: 9 }), false);
});

test('civ1 zoc: it wraps around the east/west seam like everything else on the cylinder', () => {
  // The world is a cylinder: an enemy at x=0 covers x=width-1, and a unit sliding
  // along the seam is inside one zone the whole way.
  const state = world();
  const W = state.board.width;
  const zoc = makeZoneOfControl(state.board, [unit('e', 'p2', 'phalanx', 0, 10)], [], 'p1');
  const mover = unit('m', 'p1', 'militia', W - 1, 10);
  assert.equal(zoc(mover, { x: W - 1, y: 10 }, { x: W - 1, y: 9 }), true);
});

// ---------------------------------------------------------------------------
// The rest of the engine
// ---------------------------------------------------------------------------

test('civ1 zoc: attacking through a blockade is never blocked', () => {
  // The lane between the two enemies is sealed for movement, but the mover may still
  // attack either of them — 'attack' is a separate action and never consults the rule.
  const mover = unit('m', 'p1', 'legion', 9, 10);
  const state = world({
    units: [mover, unit('e1', 'p2', 'phalanx', 10, 10), unit('e2', 'p2', 'phalanx', 10, 9)],
  });
  const actions = Civ1Game.getLegalActions(state, 'p1');
  const attacks = actions.filter(a => a.type === 'attack' && a.unitId === 'm');

  assert.deepEqual(attacks.map(a => a.targetId).sort(), ['e1', 'e2']);
  assert.equal(actions.some(a => a.type === 'move' && a.unitId === 'm'
    && a.to.x === 9 && a.to.y === 9), false, 'but the move alongside them is gone');
});

test('civ1 zoc: the enumerated legal moves are the ones the rule allows', () => {
  const mover = unit('m', 'p1', 'militia', 9, 10);
  const state = world({ units: [mover, unit('e', 'p2', 'phalanx', 10, 10)] });
  const moves = Civ1Game.getLegalActions(state, 'p1')
    .filter(a => a.type === 'move' && a.unitId === 'm')
    .map(a => `${a.to.x},${a.to.y}`).sort();

  // From (9,10) the eight neighbours are (10,9),(10,10),(10,11) — the enemy and the
  // two squares it also covers, all inside its zone — plus (9,9) and (9,11), likewise
  // covered, and the three western squares, which are clear.
  assert.deepEqual(moves, ['8,10', '8,11', '8,9']);
});

test('civ1 zoc: a queued waypoint is dropped if a blockade closes across it', () => {
  // The unit has a waypoint one square north and no moves left. Come its next turn
  // an enemy is standing beside it, covering both ends of that step — the waypoint
  // waits rather than running through the line.
  const mover = unit('m', 'p1', 'militia', 9, 10, { movesLeft: 0, queue: [{ x: 9, y: 9 }] });
  const state = world({ units: [mover, unit('e', 'p2', 'phalanx', 10, 10)] });

  const after = Civ1Game.applyActions(
    state, [{ playerId: 'p1', action: { type: 'end-turn', unitId: '__player__' } }], () => 0.5);
  const m = after.units.find(u => u.id === 'm');

  assert.deepEqual(m.position, { x: 9, y: 10 }, 'it stayed put');
  assert.deepEqual(m.queue, [{ x: 9, y: 9 }], 'and kept the waypoint for a later turn');
});

test('civ1 zoc: an empty board costs nothing — the fast path returns the same answer', () => {
  const state = world({ units: [unit('m', 'p1', 'militia', 9, 10)] });
  const mover = state.units[0];
  const reachable = getReachableTiles(mover, state.board, state.units, 'p1', state.cities);
  assert.equal(reachable.length, 8, 'all eight neighbours, nobody about to stop it');
});
