// Stacking — civ1 puts no limit on how many of your own units share a square, which is
// how a settler travels with an escort. The rule has three halves that have to agree:
// movement lets friends pile up (map.js), an attack is aimed at the SQUARE and meets
// its best defender (combat.js pickDefender), and losing an open square kills everyone
// standing on it (resolveAttack's stack death). The worlds here are hand-built and flat
// with nothing on them but the pieces under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Civ1Game } from './index.js';
import { getReachableTiles } from './map.js';

const players = () => [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];

function unit(id, ownerId, type, x, y, over = {}) {
  return {
    id, ownerId, type, position: { x, y }, alive: true,
    hp: 10, maxHp: 10, movesLeft: 1, attrs: {}, queue: [], ...over,
  };
}

function city(id, ownerId, x, y, over = {}) {
  return {
    id, name: 'Roma', ownerId, position: { x, y },
    size: 1, shields: 0, food: 0, production: 'militia', buildings: [], ...over,
  };
}

// Flat grassland, move cost 1 everywhere, no roads and nothing standing on it.
function world(opts = {}) {
  const state = Civ1Game.createInitialState(players(), {
    width: 20, height: 20, seed: 7, barbarians: 'villages-only', fogOfWar: false,
  });
  const tiles = {};
  for (const [k, t] of Object.entries(state.board.tiles)) {
    tiles[k] = { ...t, terrain: 'grassland', hasRoad: false, hasRail: false };
  }
  return {
    ...state,
    board: { ...state.board, tiles },
    units: opts.units ?? [],
    cities: opts.cities ?? [],
    activePlayers: ['p1'],
  };
}

const canReach = (state, mover, to) =>
  getReachableTiles(mover, state.board, state.units, mover.ownerId, state.cities)
    .some(t => t.x === to.x && t.y === to.y);

// A rigged rng: combat rounds read it in order, and a stream of zeroes means the
// attacker wins every round (see resolveCombat's `rng() < prob`).
const attackerWins = () => 0;
const attackerLoses = () => 1;

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

test('civ1 stacking: a unit may step onto a square its own side is holding', () => {
  const militia  = unit('m', 'p1', 'militia', 9, 10);
  const settlers = unit('s', 'p1', 'settlers', 10, 10);
  const state = world({ units: [militia, settlers] });

  assert.equal(canReach(state, militia, { x: 10, y: 10 }), true, 'onto our own settler');

  const step = Civ1Game.getLegalActions(state, 'p1')
    .find(a => a.type === 'move' && a.unitId === 'm' && a.to.x === 10 && a.to.y === 10);
  assert.ok(step, 'and the move is offered');

  const after = Civ1Game.applyActions(state, [{ playerId: 'p1', action: step }]);
  const positions = after.units.filter(u => u.alive).map(u => `${u.position.x},${u.position.y}`);
  assert.deepEqual(positions, ['10,10', '10,10'], 'both are on the one square');
});

test('civ1 stacking: an enemy still blocks the square — you attack it instead', () => {
  const militia = unit('m', 'p1', 'militia', 9, 10);
  const enemy   = unit('e', 'p2', 'phalanx', 10, 10);
  const state = world({ units: [militia, enemy] });

  assert.equal(canReach(state, militia, { x: 10, y: 10 }), false);
  const acts = Civ1Game.getLegalActions(state, 'p1');
  assert.ok(acts.some(a => a.type === 'attack' && a.targetId === 'e'));
});

test('civ1 stacking: a piled-up square is still walkable ground for the rest of the army', () => {
  // Three units on one square used to be three squares of wall to everyone else.
  const state = world({ units: [
    unit('a', 'p1', 'militia', 10, 10),
    unit('b', 'p1', 'militia', 10, 10),
    unit('c', 'p1', 'settlers', 10, 10),
    unit('m', 'p1', 'cavalry', 9, 10, { movesLeft: 2 }),
  ] });
  const mover = state.units.find(u => u.id === 'm');
  assert.equal(canReach(state, mover, { x: 11, y: 10 }), true, 'straight through the pile');
});

// ---------------------------------------------------------------------------
// Who meets the attack
// ---------------------------------------------------------------------------

test('civ1 stacking: an attack is offered once per square, aimed at its best defender', () => {
  const state = world({ units: [
    unit('atk', 'p1', 'legion', 9, 10),
    unit('soft', 'p2', 'settlers', 10, 10),
    unit('hard', 'p2', 'phalanx', 10, 10),
  ] });

  const attacks = Civ1Game.getLegalActions(state, 'p1').filter(a => a.type === 'attack');
  assert.equal(attacks.length, 1, 'one square, one attack — not one per unit standing there');
  assert.equal(attacks[0].targetId, 'hard', 'the phalanx defends, not the settlers behind it');
});

test('civ1 stacking: naming the weak unit in a stack still fights the strong one', () => {
  // A stale action list, an agent planning under fog, or a client posting the id it
  // fancies: the square answers with whoever is really holding it.
  const state = world({ units: [
    unit('atk', 'p1', 'legion', 9, 10),
    unit('soft', 'p2', 'settlers', 10, 10),
    unit('hard', 'p2', 'phalanx', 10, 10),
  ] });

  const after = Civ1Game.applyActions(state,
    [{ playerId: 'p1', action: { type: 'attack', unitId: 'atk', targetId: 'soft' } }],
    attackerLoses);
  const byId = Object.fromEntries(after.units.map(u => [u.id, u]));
  assert.equal(byId.atk.alive, false, 'the legion died on the phalanx');
  assert.equal(byId.hard.alive, true);
  assert.equal(byId.soft.hp, 10, 'the settlers never took a scratch');
});

test('civ1 stacking: a fortified defender outranks a nominally tougher one', () => {
  const state = world({ units: [
    unit('atk', 'p1', 'legion', 9, 10),
    unit('dug-in', 'p2', 'militia', 10, 10, { attrs: { fortified: true } }),
    unit('idle', 'p2', 'militia', 10, 10),
  ] });
  const attacks = Civ1Game.getLegalActions(state, 'p1').filter(a => a.type === 'attack');
  assert.equal(attacks[0].targetId, 'dug-in');
});

// ---------------------------------------------------------------------------
// Stack death
// ---------------------------------------------------------------------------

test('civ1 stacking: losing an open square kills everything standing on it', () => {
  const state = world({ units: [
    unit('atk', 'p1', 'legion', 9, 10),
    unit('hard', 'p2', 'phalanx', 10, 10),
    unit('soft', 'p2', 'settlers', 10, 10),
  ] });

  const after = Civ1Game.applyActions(state,
    [{ playerId: 'p1', action: { type: 'attack', unitId: 'atk', targetId: 'hard' } }],
    attackerWins);
  const byId = Object.fromEntries(after.units.map(u => [u.id, u]));
  assert.equal(byId.hard.alive, false);
  assert.equal(byId.soft.alive, false, 'the settlers die with their escort');
  assert.deepEqual(byId.atk.position, { x: 9, y: 10 }, 'and the winner stays where it struck from');
});

test('civ1 stacking: a city is the exception — the garrison dies one unit at a time', () => {
  const state = world({
    units: [
      unit('atk', 'p1', 'legion', 9, 10),
      unit('g1', 'p2', 'phalanx', 10, 10),
      unit('g2', 'p2', 'militia', 10, 10),
    ],
    cities: [city('c1', 'p2', 10, 10)],
  });

  const after = Civ1Game.applyActions(state,
    [{ playerId: 'p1', action: { type: 'attack', unitId: 'atk', targetId: 'g1' } }],
    attackerWins);
  const byId = Object.fromEntries(after.units.map(u => [u.id, u]));
  assert.equal(byId.g1.alive, false, 'the defender died');
  assert.equal(byId.g2.alive, true, 'the rest of the garrison did not');
  assert.deepEqual(byId.atk.position, { x: 9, y: 10 }, 'the attacker stays out');
  assert.equal(after.cities[0].ownerId, 'p2', 'and the city has not fallen');
});

// As in the original: killing the last defender leaves the city standing empty, and it
// is taken by walking into it — not by the fight, whose winner stays where it was.
test('civ1 stacking: the last defender\'s death empties the city, which falls to whoever walks in', () => {
  const state = world({
    units: [
      unit('atk', 'p1', 'legion', 9, 10),
      unit('walker', 'p1', 'militia', 9, 9),
      unit('g1', 'p2', 'militia', 10, 10),
    ],
    cities: [city('c1', 'p2', 10, 10)],
  });

  const fought = Civ1Game.applyActions(state,
    [{ playerId: 'p1', action: { type: 'attack', unitId: 'atk', targetId: 'g1' } }],
    attackerWins);
  assert.equal(fought.units.find(u => u.id === 'g1').alive, false);
  assert.deepEqual(fought.units.find(u => u.id === 'atk').position, { x: 9, y: 10 }, 'the winner stays out');
  assert.equal(fought.cities[0].ownerId, 'p2', 'the empty city is still theirs');

  const walkIn = Civ1Game.getLegalActions(fought, 'p1')
    .find(a => a.type === 'move' && a.unitId === 'walker' && a.to.x === 10 && a.to.y === 10);
  assert.ok(walkIn, 'stepping into the empty city is a legal move');
  const taken = Civ1Game.applyActions(fought, [{ playerId: 'p1', action: walkIn }]);
  assert.equal(taken.cities[0].ownerId, 'p1', 'and it falls to the unit that walks in');
});

// ---------------------------------------------------------------------------
// What the client is told
// ---------------------------------------------------------------------------

test('civ1 stacking: the square hands over the unit that still wants orders', () => {
  const state = world({ units: [
    unit('done', 'p1', 'phalanx', 10, 10, { movesLeft: 0 }),
    unit('waiting', 'p1', 'settlers', 10, 10, { movesLeft: 1 }),
  ] });

  const cell = Civ1Game.toGrid(state).cells.find(c => c.x === 10 && c.y === 10);
  assert.equal(cell.unitId, 'waiting', 'the piece the turn is owed is the one in hand');
  assert.equal(cell.needsOrders, true);
  assert.deepEqual(cell.stack.map(s => s.unitId), ['done'], 'the rest ride along as their own tokens');
  assert.ok(cell.statusEffects.includes('stack of 2'), 'and the square says how many are on it');
});

test('civ1 stacking: once everyone is done the square shows its defender', () => {
  const state = world({ units: [
    unit('soft', 'p1', 'settlers', 10, 10, { movesLeft: 0 }),
    unit('hard', 'p1', 'phalanx', 10, 10, { movesLeft: 0 }),
  ] });
  const cell = Civ1Game.toGrid(state).cells.find(c => c.x === 10 && c.y === 10);
  assert.equal(cell.unitId, 'hard');
});

test('civ1 stacking: a city square keeps its garrison box instead of a stack', () => {
  // The city wins the square's art there (see toGrid) and its units are picked out of
  // the city screen — the rest of the garrison gets no token of its own.
  const state = world({
    units: [
      unit('g1', 'p1', 'phalanx', 10, 10, { attrs: { fortified: true } }),
      unit('g2', 'p1', 'militia', 10, 10, { attrs: { fortified: true } }),
    ],
    cities: [city('c1', 'p1', 10, 10)],
  });
  const grid = Civ1Game.toGrid(state);
  const cell = grid.cells.find(c => c.x === 10 && c.y === 10);
  assert.equal(cell.stack, undefined);
  assert.equal(cell.imagePath.endsWith('/map/city'), true, 'the square is drawn as the city');
  assert.deepEqual(grid.cities[0].garrison.map(u => u.id).sort(), ['g1', 'g2']);
});

// ---------------------------------------------------------------------------
// A unit waiting for orders inside its city
// ---------------------------------------------------------------------------

test('civ1 stacking: the garrison the turn is waiting on stands ON its city', () => {
  // A militia that has just been built used to be invisible: the city won the square,
  // so the piece the turn was handing over had no art at all (and the blink that says
  // "this one is waiting" blinked the CITY away instead). Now it is drawn standing on
  // the city, with the city riding underneath it in `stack`.
  const state = world({
    units: [unit('new', 'p1', 'militia', 10, 10)],
    cities: [city('c1', 'p1', 10, 10)],
  });
  const cell = Civ1Game.toGrid(state).cells.find(c => c.x === 10 && c.y === 10);

  assert.equal(cell.unitId, 'new');
  assert.equal(cell.needsOrders, true);
  assert.equal(cell.imagePath.endsWith('/units/militia'), true, 'the square draws the militia');
  assert.equal(cell.fixture, undefined, 'and it is a piece that can move, not the city');
  assert.equal(cell.badge, null, "the city's size plaque goes with the city");

  assert.equal(cell.stack.length, 1, 'the city is the token underneath');
  assert.equal(cell.stack[0].unitId, 'u_10_10', 'with the id an empty city square gets');
  assert.equal(cell.stack[0].imagePath.endsWith('/map/city'), true);
  assert.equal(cell.stack[0].badge, 1);
  assert.equal(cell.stack[0].fixture, true, 'nothing can walk it off the square');
});

test('civ1 stacking: a garrison that has had its orders goes back under the city', () => {
  for (const done of [{ movesLeft: 0 }, { attrs: { fortified: true } }, { attrs: { sentry: true } }]) {
    const state = world({
      units: [unit('g', 'p1', 'militia', 10, 10, done)],
      cities: [city('c1', 'p1', 10, 10)],
    });
    const cell = Civ1Game.toGrid(state).cells.find(c => c.x === 10 && c.y === 10);
    assert.equal(cell.imagePath.endsWith('/map/city'), true, JSON.stringify(done));
    assert.equal(cell.stack, undefined);
    assert.equal(cell.unitId, 'g', 'the square still selects the garrison');
  }
});

test('civ1 stacking: an enemy city does not show you who is holding it', () => {
  // Only the player on the clock has a unit "waiting for orders" — everyone else's
  // pieces have full moves all through your turn, and would otherwise stand on top of
  // every enemy city on the map.
  const state = world({
    units: [unit('g', 'p2', 'militia', 10, 10)],
    cities: [city('c1', 'p2', 10, 10)],
  });
  const cell = Civ1Game.toGrid(state).cells.find(c => c.x === 10 && c.y === 10);
  assert.equal(cell.imagePath.endsWith('/map/city'), true);
  assert.equal(cell.stack, undefined);
});
