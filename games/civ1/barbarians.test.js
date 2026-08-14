import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Civ1Game, BARBARIAN_ID, BARBARIAN_LEVELS, DEFAULT_BARBARIAN_LEVEL } from './index.js';

function players() {
  return [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];
}

// One full game turn: end the turn for whoever is actually active until the clock
// ticks over, which is what triggers the barbarian phase. Driving off activePlayers
// rather than the seat list matters here — these worlds give p2 nothing, so the
// rotation skips it as eliminated and a single end-turn is a whole game turn.
function playTurn(state, rng) {
  const start = state.turnNumber;
  for (let guard = 0; state.turnNumber === start && guard < 10; guard++) {
    state = Civ1Game.applyActions(
      state, [{ playerId: state.activePlayers[0], action: { type: 'end-turn', unitId: '__player__' } }], rng);
  }
  return state;
}

const barbarians = state => state.units.filter(u => u.alive && u.ownerId === BARBARIAN_ID);
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// resolveCombat takes a round when rng() < attack/(attack+defense), so a constant 0
// is "the attacker wins every round" and a constant ~1 is "the attacker loses every
// round". QUIET sits between the two and never reaches a fight in these worlds.
const ATTACKER_WINS = () => 0;
const ATTACKER_LOSES = () => 0.999;
const QUIET = () => 0.5;

// The raid tests want the barbarian phase running (so hand-placed raiders take their
// turn) but no uprising joining in and muddying the board. Starting here, the next
// several turns are all quiet ones under 'roving-bands' (first uprising turn 16).
const QUIET_TURN = 2;

const CITY = { x: 10, y: 10 };

function city(over = {}) {
  return {
    id: 'c1', name: 'Roma', ownerId: 'p1', position: { ...CITY },
    size: 4, shields: 0, food: 0, production: 'militia', buildings: [], ...over,
  };
}

function unit(id, ownerId, type, x, y, over = {}) {
  return {
    id, ownerId, type, position: { x, y }, alive: true,
    hp: 10, maxHp: 10, movesLeft: 1, attrs: {}, queue: [], ...over,
  };
}

// An all-grassland world with hand-placed pieces: nothing here but what a test puts
// here, so a raider's behaviour is the only thing moving. Cities start on 0 shields,
// so over the handful of turns these tests run none of them finishes a defender and
// quietly changes the situation under the test.
function world(level, opts = {}) {
  const state = Civ1Game.createInitialState(players(), {
    width: 20, height: 20, seed: 7, barbarians: level, fogOfWar: false,
  });
  const tiles = {};
  for (const [k, t] of Object.entries(state.board.tiles)) {
    tiles[k] = { ...t, terrain: opts.terrainAt?.(k) ?? 'grassland' };
  }
  return {
    ...state,
    turnNumber: opts.turnNumber ?? 1,
    board: { ...state.board, tiles },
    units: opts.units ?? [],
    cities: opts.cities ?? [city()],
  };
}

// ---------------------------------------------------------------------------
// The game option
// ---------------------------------------------------------------------------

test('civ1 barbarians: the setup menu offers the original\'s four activity levels', () => {
  const opt = Civ1Game.gameOptions.find(o => o.id === 'barbarians');
  assert.ok(opt, 'there is a barbarians option');
  assert.equal(opt.type, 'select');
  assert.deepEqual(opt.options.map(o => o.value),
    ['villages-only', 'roving-bands', 'restless-tribes', 'raging-hordes']);
});

test('civ1 barbarians: the level is stored on the state, and an unknown one falls back', () => {
  const on  = Civ1Game.createInitialState(players(), { barbarians: 'raging-hordes' });
  const bad = Civ1Game.createInitialState(players(), { barbarians: 'nonsense' });
  assert.equal(on.gameSpecific.barbarians, 'raging-hordes');
  assert.equal(bad.gameSpecific.barbarians, DEFAULT_BARBARIAN_LEVEL);
});

// The agent measurements replay civ1 with nothing but the two seats; barbarians must
// not wander into them unasked.
test('civ1 barbarians: off by default, and "villages only" never raises a band', () => {
  assert.equal(Civ1Game.createInitialState(players()).gameSpecific.barbarians, 'villages-only');

  let state = world('villages-only');
  for (let i = 0; i < 40; i++) state = playTurn(state, QUIET);
  assert.equal(barbarians(state).length, 0);
});

test('civ1 barbarians: raging hordes raid sooner, oftener and in greater numbers', () => {
  const roving = BARBARIAN_LEVELS['roving-bands'];
  const raging = BARBARIAN_LEVELS['raging-hordes'];
  assert.ok(raging.firstTurn < roving.firstTurn);
  assert.ok(raging.interval < roving.interval);
  assert.ok(raging.band > roving.band);
});

// ---------------------------------------------------------------------------
// Uprisings
// ---------------------------------------------------------------------------

test('civ1 barbarians: a band rises up on schedule, close to a city and not on top of it', () => {
  const spec = BARBARIAN_LEVELS['roving-bands'];

  let quiet = world('roving-bands', { turnNumber: spec.firstTurn - 2 });
  quiet = playTurn(quiet, QUIET);
  assert.equal(quiet.turnNumber, spec.firstTurn - 1);
  assert.equal(barbarians(quiet).length, 0, 'nothing before the first uprising turn');

  const risen = playTurn(quiet, QUIET);
  assert.equal(risen.turnNumber, spec.firstTurn);
  assert.equal(barbarians(risen).length, spec.band, 'a full band appears');
  for (const u of barbarians(risen)) {
    // They spawn 2..4 squares out and have already taken their first step inward.
    const d = cheb(u.position, CITY);
    assert.ok(d >= 1 && d <= 4, `raider is ${d} squares from the city it came for`);
  }
});

test('civ1 barbarians: nothing rises up in a world with no city to raid', () => {
  let state = world('raging-hordes', { cities: [] });
  for (let i = 0; i < 30; i++) state = playTurn(state, QUIET);
  assert.equal(barbarians(state).length, 0);
});

// Nothing in the rules ever removes a raider that finds nobody to fight, so without
// the cap a band marooned across water would keep being reinforced forever.
test('civ1 barbarians: uprisings stop at the level\'s cap, so stranded raiders never pile up', () => {
  const spec = BARBARIAN_LEVELS['raging-hordes'];
  // A city on its own island: raiders spawn on the mainland ring 2..4 and can never
  // cross the water to spend themselves on it.
  const moat = new Set();
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (dx || dy) moat.add(`${CITY.x + dx},${CITY.y + dy}`);
  }
  let state = world('raging-hordes', { terrainAt: k => (moat.has(k) ? 'ocean' : 'grassland') });

  for (let i = 0; i < 120; i++) state = playTurn(state, QUIET);

  const alive = barbarians(state).length;
  assert.ok(alive >= spec.maxUnits - spec.band, `${alive} raiders — the cap should have been reached`);
  assert.ok(alive <= spec.maxUnits + spec.band, `${alive} raiders — the cap should have held`);
});

// ---------------------------------------------------------------------------
// The raid
// ---------------------------------------------------------------------------

test('civ1 barbarians: a raider marches on the nearest city', () => {
  let state = world('roving-bands', { turnNumber: QUIET_TURN,
    units: [unit('b1', BARBARIAN_ID, 'legion', 16, 10)],
  });
  const start = cheb(state.units[0].position, CITY);

  for (let i = 0; i < 3; i++) state = playTurn(state, QUIET);

  const after = cheb(state.units.find(u => u.id === 'b1').position, CITY);
  assert.equal(start, 6);
  assert.equal(after, 3, 'one square closer per turn — a legion has one move');
});

test('civ1 barbarians: an undefended city is simply walked into', () => {
  let state = world('roving-bands', { turnNumber: QUIET_TURN,
    units: [unit('b1', BARBARIAN_ID, 'legion', 11, 10)],
  });
  state = playTurn(state, QUIET);

  assert.equal(state.cities[0].ownerId, BARBARIAN_ID, 'the city changed hands');
  assert.deepEqual(state.units.find(u => u.id === 'b1').position, CITY, 'and a raider is standing in it');
});

test('civ1 barbarians: a defended city is fought for, not walked into', () => {
  let state = world('roving-bands', { turnNumber: QUIET_TURN,
    units: [
      unit('b1', BARBARIAN_ID, 'legion', 11, 10),
      unit('d1', 'p1', 'militia', CITY.x, CITY.y, { attrs: { fortified: true } }),
    ],
  });
  state = playTurn(state, ATTACKER_WINS);

  assert.equal(state.units.find(u => u.id === 'd1').alive, false, 'the garrison was fought and killed');
  assert.equal(state.cities[0].ownerId, BARBARIAN_ID, 'and the city fell with it');
});

test('civ1 barbarians: a raid that loses its fight leaves the city alone', () => {
  let state = world('roving-bands', { turnNumber: QUIET_TURN,
    units: [
      unit('b1', BARBARIAN_ID, 'legion', 11, 10),
      unit('d1', 'p1', 'militia', CITY.x, CITY.y, { attrs: { fortified: true } }),
    ],
  });
  state = playTurn(state, ATTACKER_LOSES);

  assert.equal(state.units.find(u => u.id === 'b1').alive, false, 'the raider died on the walls');
  assert.equal(state.units.find(u => u.id === 'd1').alive, true);
  assert.equal(state.cities[0].ownerId, 'p1');
});

// Barbarians raid whoever is nearest — they have no allies and take no sides.
test('civ1 barbarians: they are hostile to every civ, not just to one', () => {
  let state = world('roving-bands', { turnNumber: QUIET_TURN,
    units: [unit('b1', BARBARIAN_ID, 'legion', 4, 4)],
    cities: [city(), city({ id: 'c2', name: 'Thebes', ownerId: 'p2', position: { x: 3, y: 3 } })],
  });
  state = playTurn(state, ATTACKER_WINS);

  assert.equal(state.cities.find(c => c.id === 'c2').ownerId, BARBARIAN_ID, 'p2\'s nearer city is the one taken');
  assert.equal(state.cities.find(c => c.id === 'c1').ownerId, 'p1');
});

// ---------------------------------------------------------------------------
// Barbarians are not a civilization
// ---------------------------------------------------------------------------

test('civ1 barbarians: they hold no seat, so the turn never stops on them', () => {
  let state = world('raging-hordes');

  // Long enough for several uprisings, and for the city to raise a garrison that
  // spends most of them — so raiders come and go rather than simply accumulating.
  let sawRaiders = false;
  for (let i = 0; i < 40; i++) {
    state = playTurn(state, QUIET);
    sawRaiders ||= barbarians(state).length > 0;
    assert.ok(!state.players.some(p => p.id === BARBARIAN_ID), 'never joins the player list');
    assert.ok(!state.activePlayers.includes(BARBARIAN_ID), 'never becomes the active player');
    assert.equal(state.gameSpecific.civ[BARBARIAN_ID], undefined, 'no treasury, research or government');
  }
  assert.ok(sawRaiders, 'and there really were raiders about along the way');
});

// Barbarians overrunning the world is not barbarians winning it: the game ends when
// one CIVILIZATION is left standing, and raiders are never counted among them.
test('civ1 barbarians: holding cities and units does not keep the game alive, or win it', () => {
  const base = world('roving-bands', {
    units: [unit('b1', BARBARIAN_ID, 'legion', 3, 3)],
    cities: [city(), city({ id: 'c2', name: 'Thebes', ownerId: 'p2', position: { x: 3, y: 4 } })],
  });

  assert.equal(Civ1Game.getResult(base), null, 'two civs alive, raiders about: the game goes on');

  // The barbarians take everything p2 had. p2 is finished, so p1 wins outright —
  // the barbarians' own city and legion count for nothing.
  const overrun = {
    ...base,
    cities: base.cities.map(c => c.id === 'c2' ? { ...c, ownerId: BARBARIAN_ID } : c),
  };
  const result = Civ1Game.getResult(overrun);
  assert.equal(result.outcome, 'win');
  assert.equal(result.winnerId, 'p1');
});

// ---------------------------------------------------------------------------
// Bumping into the dark
// ---------------------------------------------------------------------------
// Raiders appear unannounced next to cities, so a player under fog plans marches
// aimed at squares they cannot see are occupied. The engine used to throw those out
// as illegal — its own agent's move rejected — instead of letting the march run into
// what was hiding there.

test('civ1 barbarians: a march onto a square hiding a raider is legal, and bumps', () => {
  const state = world('roving-bands', {
    turnNumber: QUIET_TURN,
    units: [
      unit('m1', 'p1', 'legion', 5, 5),
      unit('b1', BARBARIAN_ID, 'legion', 6, 5),
    ],
  });
  const march = { type: 'move', unitId: 'm1', from: { x: 5, y: 5 }, to: { x: 6, y: 5 } };

  // getLegalActions never offers it — you attack what you can see instead.
  assert.equal(Civ1Game.getLegalActions(state, 'p1').some(a =>
    a.type === 'move' && a.unitId === 'm1' && a.to.x === 6 && a.to.y === 5), false);
  // …but it is accepted, because a fogged player could honestly have ordered it.
  assert.equal(Civ1Game.isActionLegal(state, 'p1', march), true);

  const after = Civ1Game.applyActions(state, [{ playerId: 'p1', action: march }]);
  const mover = after.units.find(u => u.id === 'm1');
  assert.deepEqual(mover.position, { x: 5, y: 5 }, 'the march ran into the raider and stopped');
  assert.equal(mover.movesLeft, 0, 'and the turn was spent');
  assert.equal(after.units.find(u => u.id === 'b1').position.x, 6, 'the raider is untouched');
});

test('civ1 barbarians: a march whose route a hidden raider blocks bumps too', () => {
  // Sea either side of row 5, so (8,5) is reachable from (5,5) only straight along it.
  const lane = (k) => {
    const [x, y] = k.split(',').map(Number);
    return (y === 5 || x < 4 || x > 9) ? 'grassland' : 'ocean';
  };
  const state = world('roving-bands', {
    turnNumber: QUIET_TURN, terrainAt: lane,
    units: [
      unit('m1', 'p1', 'armor', 5, 5, { movesLeft: 3 }),
      unit('b1', BARBARIAN_ID, 'legion', 6, 5),
    ],
  });
  const march = { type: 'move', unitId: 'm1', from: { x: 5, y: 5 }, to: { x: 8, y: 5 } };

  assert.equal(Civ1Game.isActionLegal(state, 'p1', march), true, 'reachable in the world p1 was planning in');

  const after = Civ1Game.applyActions(state, [{ playerId: 'p1', action: march }]);
  assert.deepEqual(after.units.find(u => u.id === 'm1').position, { x: 5, y: 5 });
});

// The ordinary path must be untouched: a move the engine enumerated is reachable by
// construction, so it still just happens.
test('civ1 barbarians: an ordinary move is unaffected by the bump rule', () => {
  const state = world('roving-bands', {
    turnNumber: QUIET_TURN, units: [unit('m1', 'p1', 'legion', 5, 5)],
  });
  const move = Civ1Game.getLegalActions(state, 'p1').find(a => a.type === 'move' && a.unitId === 'm1');
  const after = Civ1Game.applyActions(state, [{ playerId: 'p1', action: move }]);
  assert.deepEqual(after.units.find(u => u.id === 'm1').position, move.to);
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

test('civ1 barbarians: raiders get their own owner index and team, not player 1\'s', () => {
  const state = world('roving-bands', { units: [unit('b1', BARBARIAN_ID, 'legion', 3, 3)] });
  const grid = Civ1Game.toGrid(state);
  const cell = grid.cells.find(c => c.x === 3 && c.y === 3);

  assert.equal(cell.owner, state.players.length + 1, 'owner index sits past the seats');
  assert.deepEqual(grid.extraTeams.map(t => t.id), [BARBARIAN_ID]);
  assert.ok(grid.extraTeams[0].raw, 'the team brings a colour of its own');
});

test('civ1 barbarians: no extra team is advertised when the option is off', () => {
  assert.deepEqual(Civ1Game.toGrid(world('villages-only')).extraTeams, []);
});

test('civ1 barbarians: the ASCII map marks them apart from the second civ', () => {
  const state = world('roving-bands', {
    units: [unit('b1', BARBARIAN_ID, 'legion', 3, 3)],
    cities: [city({ ownerId: BARBARIAN_ID })],
  });
  const text = Civ1Game.renderState(state);
  assert.ok(text.includes(' *'), 'raiders render as *, not as a lowercase p2 unit');
  assert.ok(text.includes(' %'), 'a city they hold renders as %, not as a p2 city');
});
