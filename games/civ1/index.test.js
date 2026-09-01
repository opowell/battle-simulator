import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Civ1Game } from './index.js';
import { getCombatStrengths } from './combat.js';
import { GameEngine } from '../../engine/index.js';
import { RandomAgent } from '../../agents/index.js';

function players() {
  return [
    { id: 'p1', name: 'P1', agent: RandomAgent },
    { id: 'p2', name: 'P2', agent: RandomAgent },
  ];
}

function endTurn(state, playerId) {
  return Civ1Game.applyActions(state, [{ playerId, action: { type: 'end-turn', unitId: '__player__' } }]);
}

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

test('civ1: starts on turn 1 with p1 active', () => {
  const state = Civ1Game.createInitialState(players());
  assert.equal(state.turnNumber, 1);
  assert.deepEqual(state.activePlayers, ['p1']);
});

test('civ1: both players start with units', () => {
  const state = Civ1Game.createInitialState(players());
  assert.ok(state.units.some(u => u.ownerId === 'p1' && u.alive));
  assert.ok(state.units.some(u => u.ownerId === 'p2' && u.alive));
});

test('civ1: board has tiles', () => {
  const state = Civ1Game.createInitialState(players());
  assert.ok(Object.keys(state.board.tiles).length > 0);
});

// ---------------------------------------------------------------------------
// getLegalActions
// ---------------------------------------------------------------------------

test('civ1: getLegalActions always includes end-turn', () => {
  const state = Civ1Game.createInitialState(players());
  const actions = Civ1Game.getLegalActions(state, 'p1');
  assert.ok(actions.some(a => a.type === 'end-turn'));
});

test('civ1: getLegalActions includes move or skip-unit for units with moves', () => {
  const state = Civ1Game.createInitialState(players());
  const actions = Civ1Game.getLegalActions(state, 'p1');
  assert.ok(actions.some(a => a.type === 'move' || a.type === 'skip-unit'));
});

// ---------------------------------------------------------------------------
// applyActions
// ---------------------------------------------------------------------------

test('civ1: end-turn by p1 advances to p2', () => {
  const state = Civ1Game.createInitialState(players());
  const next = endTurn(state, 'p1');
  assert.deepEqual(next.activePlayers, ['p2']);
});

test('civ1: end-turn by p2 increments turn number and returns to p1', () => {
  const state = Civ1Game.createInitialState(players());
  const s1 = endTurn(state, 'p1');
  const s2 = endTurn(s1, 'p2');
  assert.equal(s2.turnNumber, 2);
  assert.deepEqual(s2.activePlayers, ['p1']);
});

test('civ1: move action updates unit position', () => {
  const state = Civ1Game.createInitialState(players());
  const move = Civ1Game.getLegalActions(state, 'p1').find(a => a.type === 'move');
  if (!move) return; // no moves available on this map seed — skip
  const next = Civ1Game.applyActions(state, [{ playerId: 'p1', action: move }]);
  const moved = next.units.find(u => u.id === move.unitId);
  assert.deepEqual(moved.position, move.to);
});

test('civ1: skip-unit drains all moves for that unit', () => {
  const state = Civ1Game.createInitialState(players());
  const skip = Civ1Game.getLegalActions(state, 'p1').find(a => a.type === 'skip-unit');
  if (!skip) return;
  const next = Civ1Game.applyActions(state, [{ playerId: 'p1', action: skip }]);
  const unit = next.units.find(u => u.id === skip.unitId);
  assert.equal(unit.movesLeft, 0);
});

// ---------------------------------------------------------------------------
// getResult
// ---------------------------------------------------------------------------

test('civ1: getResult null initially', () => {
  const state = Civ1Game.createInitialState(players());
  assert.equal(Civ1Game.getResult(state), null);
});

test('civ1: getResult win when p2 has no cities or units', () => {
  const state = Civ1Game.createInitialState(players());
  const noP2 = {
    ...state,
    units: state.units.filter(u => u.ownerId !== 'p2'),
    cities: (state.cities ?? []).filter(c => c.ownerId !== 'p2'),
  };
  const result = Civ1Game.getResult(noP2);
  assert.ok(result !== null);
  assert.equal(result.outcome, 'win');
  assert.equal(result.winnerId, 'p1');
});

// ---------------------------------------------------------------------------
// toGrid — how a square is drawn
// ---------------------------------------------------------------------------

// A city with a unit standing in it is drawn as the CITY, the way the original game
// draws it: before this, the garrison's sprite covered the city entirely, so every city
// with a defender in it (i.e. nearly every city) was invisible on the map. (The one
// exception — the unit the turn is waiting on, which stands on top of its city — is in
// stack.test.js; the garrison here has already moved, so the city keeps its square.)
test('civ1: a garrisoned city square is drawn as the city, not as its garrison', () => {
  const state = Civ1Game.createInitialState(players());
  const unit = { ...state.units.find(u => u.ownerId === 'p1'), movesLeft: 0 };
  const withCity = {
    ...state,
    units: state.units.map(u => (u.id === unit.id ? unit : u)),
    cities: [...(state.cities ?? []), {
      id: 'city-test', name: 'Testopolis', ownerId: 'p1',
      position: { ...unit.position }, size: 7, shields: 0, food: 0,
      production: 'militia', buildings: [],
    }],
  };
  const cell = Civ1Game.toGrid(withCity).cells
    .find(c => c.x === unit.position.x && c.y === unit.position.y);

  assert.match(cell.imagePath, /map\/city$/, 'the square draws the city sprite');
  assert.equal(cell.badge, 7, 'the badge is the city size');
  assert.equal(cell.badgeLabel, 'Testopolis', 'the plaque is labelled with the city');
  // …while the square still commands the garrison, and the panels still describe it.
  assert.equal(cell.unitId, unit.id);
  assert.equal(cell.unitName, unit.type);
  assert.match(cell.portraitPath, /units\//, 'the roster/side panel keep the unit sprite');
  // The square carries the garrison's id while drawing the city, so it has to say so:
  // without this the move animation walks the city over to whichever unit just stepped
  // into it (see apps/design/boardMoves.js).
  assert.equal(cell.fixture, true, 'the square is a fixture — the art is the city\'s, not the unit\'s');
});

// The city screen (apps/design/battlefield/CityInspectorOverlay.vue) draws pictures —
// of the garrison, and of every item the city could build — but apps/design has no
// access to UNITS/IMPROVEMENTS/WONDERS, so all of that has to ride the grid payload.
test('civ1: a city carries what its city screen draws — population, garrison, build options', () => {
  const state = Civ1Game.createInitialState(players());
  const unit = state.units.find(u => u.ownerId === 'p1');
  const withCity = {
    ...state,
    cities: [...(state.cities ?? []), {
      id: 'city-test', name: 'Testopolis', ownerId: 'p1',
      position: { ...unit.position }, size: 3, shields: 0, food: 0,
      production: 'militia', buildings: [],
    }],
  };
  const city = Civ1Game.toGrid(withCity).cities.find(c => c.id === 'city-test');

  assert.equal(city.population, 60000, 'size 3 is 60,000 people, as the original titles it');
  assert.deepEqual(city.garrison.map(g => g.type), [unit.type], 'the units-in-city box');
  assert.match(city.garrison[0].image, /units\//, 'each garrison unit brings its sprite');

  // …and clicking one there is the only way to select it at all: the city wins the
  // square's token (see the test above), so a click on the map opens this screen instead
  // of picking the unit up. The box does the picking by id, and says which of them the
  // turn is still owed.
  const g = city.garrison[0];
  assert.equal(g.id, unit.id, 'the pick is by unit id');
  assert.equal(g.needsOrders, true, 'a fresh unit in a city is still waiting on you');

  // The box is also the only place a garrison's standing order can be seen — the city
  // wins the square, so a defender never wears its mark on the map.
  const sentried = Civ1Game.applyActions(withCity,
    [{ playerId: 'p1', action: { type: 'sentry', unitId: unit.id } }]);
  const onWatch = Civ1Game.toGrid(sentried).cities.find(c => c.id === 'city-test');
  assert.equal(onWatch.garrison[0].statusMark?.glyph, 'S');
  assert.equal(onWatch.garrison[0].needsOrders, false);

  // apps/design is game-agnostic by rule, so every picture the screen draws has to be
  // named in the payload — icons included, not built from paths on the client.
  assert.match(city.icons.food, /city\/food$/);
  assert.match(city.icons.shields, /city\/production$/);
  assert.match(city.sprite, /map\/city$/, 'the city plaque\'s own art');
  assert.equal(city.citizens.length, city.size, 'one face per citizen');
  const workedTile = city.radius.find(t => t.worked && !t.center);
  if (workedTile) assert.equal(workedTile.icons.length,
    workedTile.yield.food + workedTile.yield.shields + workedTile.yield.trade,
    'a worked square is marked with one icon per point it yields');

  const militia = city.buildOptions.militia;
  assert.ok(militia, 'what it is building is always among the options it can draw');
  assert.equal(militia.kind, 'unit');
  assert.equal(militia.cost, 10);
  assert.match(militia.image, /units\/militia$/, 'units are drawn with their own art');
  // Improvements have no art of their own, so they fall back to the shield icon the
  // production box is already made of — a missing image would draw a broken tile.
  const palace = city.buildOptions.palace;
  if (palace) assert.match(palace.image, /city\/production$/);
});

// The Military advisor is how you find one particular unit in an empire of dozens —
// a stacked or garrisoned one especially, since the board only ever draws the top of a
// stack. That means the per-owner roster has to carry the units one by one, with the id
// a click sends back (MilitaryOverlay.vue) and enough about each to tell them apart;
// apps/design has no access to UNITS, so every stat rides the payload.
test('civ1: the military roster lists each unit, with the id, place and stats a row needs', () => {
  const state = Civ1Game.createInitialState(players());
  const unit = state.units.find(u => u.ownerId === 'p1');
  const withCity = {
    ...state,
    cities: [...(state.cities ?? []), {
      id: 'city-test', name: 'Testopolis', ownerId: 'p1',
      position: { ...unit.position }, size: 3, shields: 0, food: 0,
      production: 'militia', buildings: [],
    }],
  };
  const mine = Civ1Game.toGrid(withCity).military.p1;

  assert.equal(mine.units.length, mine.total, 'one row per unit that was counted');
  const row = mine.units.find(u => u.id === unit.id);
  assert.ok(row, 'the row is found by the unit id a click sends back');
  assert.equal(row.type, unit.type);
  assert.deepEqual([row.x, row.y], [unit.position.x, unit.position.y]);
  assert.equal(row.maxMp, 1, 'stats come from UNITS, which only the server has');
  assert.equal(row.city, 'Testopolis', 'a garrison is placed by its city, not its terrain');
  assert.equal(row.needsOrders, true);
  // A unit on open ground is placed by what it is standing on instead.
  const afield = mine.units.find(u => u.id !== unit.id);
  assert.equal(afield.city, null);
  assert.ok(afield.terrain, '…and always has somewhere to be');

  // Whoever still owes the turn an order comes first: the list doubles as "who have I
  // not moved yet?", which is the reason to open it mid-turn.
  const done = Civ1Game.applyActions(withCity,
    [{ playerId: 'p1', action: { type: 'fortify', unitId: unit.id } }]);
  const after = Civ1Game.toGrid(done).military.p1.units;
  assert.equal(after.find(u => u.id === unit.id).needsOrders, false);
  assert.deepEqual(after.map(u => u.needsOrders), [...after.map(u => u.needsOrders)].sort((a, b) => b - a),
    'units still wanting orders sort to the top');
  assert.deepEqual(after.find(u => u.id === unit.id).status, ['fortifying'],
    'standing orders are on the row — the map cannot show a garrison\'s');
});

// ---------------------------------------------------------------------------
// Standing orders, as the map shows them
// ---------------------------------------------------------------------------

// The original draws its three standing-order states differently: an "F" over a unit
// still digging in, a frame round one that is dug in, an "S" over a sentry. toGrid
// reports which of those a square wears (statusMark) — see HtmlUnit.vue.
test('civ1: fortifying wears an F, and is a frame by the time the turn comes back round', () => {
  const state = Civ1Game.createInitialState(players());
  const unit = state.units.find(u => u.ownerId === 'p1');
  const cellOf = s => Civ1Game.toGrid(s).cells.find(c => c.unitId === unit.id);

  const digging = Civ1Game.applyActions(state,
    [{ playerId: 'p1', action: { type: 'fortify', unitId: unit.id } }]);
  assert.equal(cellOf(digging).statusMark?.glyph, 'F', 'still digging in: a letter');
  assert.ok(!cellOf(digging).statusMark?.frame);
  assert.deepEqual(cellOf(digging).statusEffects, ['fortifying']);
  assert.ok(!digging.units.find(u => u.id === unit.id).attrs.fortified,
    'digging in is not yet dug in — no bonus this turn (see combat.js)');

  // A round later the order has finished: the letter goes, the frame arrives, and only
  // now is the unit fortified.
  const dugIn = endTurn(endTurn(digging, 'p1'), 'p2');
  const after = dugIn.units.find(u => u.id === unit.id).attrs;
  assert.equal(after.fortified, true);
  assert.ok(!after.fortifying, 'the two halves of the order are exclusive');
  assert.equal(cellOf(dugIn).statusMark?.frame, true, 'dug in: a frame, no letter');
  assert.ok(!cellOf(dugIn).statusMark?.glyph);
  assert.deepEqual(cellOf(dugIn).statusEffects, ['fortified']);
});

// The point of the two-stage order, as in the original: digging in costs a turn, so the
// +50% is not something an attacked unit can conjure the moment it is threatened.
test('civ1: the fortify bonus lands only once the unit is dug in', () => {
  const state = Civ1Game.createInitialState(players());
  const unit = state.units.find(u => u.ownerId === 'p1' && u.type === 'militia');
  const enemy = state.units.find(u => u.ownerId === 'p2' && u.type === 'militia');
  const defOf = s => getCombatStrengths(enemy, s.units.find(u => u.id === unit.id), s).def;

  const bare = defOf(state);
  const digging = Civ1Game.applyActions(state,
    [{ playerId: 'p1', action: { type: 'fortify', unitId: unit.id } }]);
  assert.equal(defOf(digging), bare, 'still digging in: defence unchanged');

  const dugIn = endTurn(endTurn(digging, 'p1'), 'p2');
  assert.equal(defOf(dugIn), bare * 1.5, 'dug in: +50%');
});

test('civ1: a sentry wears an S, and a fresh order takes the mark off', () => {
  const state = Civ1Game.createInitialState(players());
  const unit = state.units.find(u => u.ownerId === 'p1');
  const cellOf = s => Civ1Game.toGrid(s).cells.find(c => c.unitId === unit.id);

  const watching = Civ1Game.applyActions(state,
    [{ playerId: 'p1', action: { type: 'sentry', unitId: unit.id } }]);
  assert.equal(cellOf(watching).statusMark?.glyph, 'S');
  assert.deepEqual(cellOf(watching).statusEffects, ['sentry']);

  // Moving is a fresh order, so it drops the standing one — mark and all.
  const refreshed = endTurn(endTurn(watching, 'p1'), 'p2');
  // Onto empty ground: friendly units stack (see stack.test.js), and a step onto the
  // square our other unit is standing on would put this one under it — where the
  // square's token, and so this square's marks, belong to the unit on top.
  const ours = new Set(refreshed.units.filter(u => u.ownerId === 'p1' && u.id !== unit.id)
    .map(u => `${u.position.x},${u.position.y}`));
  const move = Civ1Game.getLegalActions(refreshed, 'p1')
    .find(a => a.type === 'move' && a.unitId === unit.id && !ours.has(`${a.to.x},${a.to.y}`));
  const moved = Civ1Game.applyActions(refreshed, [{ playerId: 'p1', action: move }]);
  assert.equal(cellOf(moved).statusMark, undefined, 'a moving unit has no standing order');
  assert.deepEqual(cellOf(moved).statusEffects, []);
});

// ---------------------------------------------------------------------------
// Self-play
// ---------------------------------------------------------------------------

test('civ1: self-play completes with a valid result', async () => {
  const engine = new GameEngine(Civ1Game, players(), { maxTurns: 60 });
  const { result } = await engine.run();
  assert.ok(['win', 'draw'].includes(result.outcome));
});
