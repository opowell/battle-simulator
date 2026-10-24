import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerSources, sourceFromPack, convertStats, foreignSpec, foreignCatalog, dressGrid, tableUnits, whole, rescaleRoll, factorOf,
} from './foreignUnits.js';
import { buildInitialState, rosterFromState, applyRoster, rosterError, setupUnitTypes, setupPreview, cellMapper } from './startingSetup.js';

// ---------------------------------------------------------------------------
// Two mock games: a HOST (a core ruleset) whose rules read every stat from a type
// table, and a SOURCE that counts in numbers ten times as big — the way a game's
// pack in the library lends its units. The library's real packs, fielded in Arena,
// are src/library.test.js.
// ---------------------------------------------------------------------------

const players = [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }];

const HOST_UNITS = {
  spear:  { hp: 10, attack: 2, defense: 2, range: 1, move: 1, domain: 'land' },
  bow:    { hp: 8,  attack: 3, defense: 1, range: 3, move: 1, domain: 'land' },
  giant:  { hp: 40, attack: 8, defense: 4, range: 1, move: 1, domain: 'land' },
  boat:   { hp: 20, attack: 3, defense: 3, range: 1, move: 3, domain: 'sea' },
  farmer: { hp: 10, attack: 0, defense: 1, range: 1, move: 1, domain: 'land' },
};

const unit = (id, ownerId, type, x, y) => ({ id, ownerId, type, position: { x, y }, alive: true, hp: HOST_UNITS[type].hp, maxHp: HOST_UNITS[type].hp });

const Host = {
  name: 'Host',
  createInitialState(ps) {
    return {
      players: ps, activePlayers: [ps[0].id], turnNumber: 1, gameSpecific: {},
      units: [unit('a', 'p1', 'spear', 0, 0), unit('b', 'p1', 'bow', 1, 0), unit('c', 'p2', 'spear', 0, 3)],
    };
  },
  createSetupUnit(_s, { id, ownerId, type, position }) {
    return HOST_UNITS[type] ? { ...unit(id, ownerId, type, position.x, position.y) } : null;
  },
  getLegalActions: () => [], applyActions: (s) => s, getResult: () => null, renderState: () => '',
  toGrid: (state) => ({
    width: 4, height: 4,
    cells: Array.from({ length: 16 }, (_, i) => {
      const x = i % 4, y = Math.floor(i / 4);
      const u = state.units.find(v => v.alive !== false && v.position.x === x && v.position.y === y);
      return { x, y, unitId: u?.id ?? null, glyph: u ? u.type[0] : '', imagePath: u ? `/host/${u.type}` : null };
    }),
  }),
  foreignUnits: tableUnits({
    host: true,
    table: HOST_UNITS,
    scale: { hp: 10, attack: 2, defense: 2, range: 2, move: 1 },
    read: (e) => ({ hp: e.hp, attack: e.attack, defense: e.defense, range: e.range, move: e.move, domain: e.domain }),
    write: (e, s) => ({ ...e, hp: whole(s.hp), attack: whole(s.attack), defense: whole(s.defense), range: whole(s.range), move: whole(s.move) }),
    chassis: (_t, e) => e.attack > 0,
    art: (type) => ({ imagePath: `/host/${type}`, glyph: type[0], name: type }),
  }),
};

const Source = {
  name: 'Source',
  createInitialState: () => ({ units: [] }),
  getLegalActions: () => [], applyActions: (s) => s, getResult: () => null, renderState: () => '',
  foreignUnits: {
    scale: { hp: 100, attack: 20, defense: 20, range: 20, move: 10 },
    profiles: () => ({
      trooper: { hp: 100, attack: 20, defense: 20, range: 20, move: 10, domain: 'land' },
      titan:   { hp: 400, attack: 80, defense: 40, range: 10, move: 10, domain: 'land' },
      cruiser: { hp: 200, attack: 30, defense: 30, range: 10, move: 30, domain: 'sea' },
      ghost:   { hp: 50, domain: 'land' },
    }),
    art: (type, seat) => ({ imagePath: `/source/${type}-${seat}`, glyph: type[0].toUpperCase(), name: `Source ${type}` }),
  },
};

registerSources({ source: Source });

const base = () => Host.createInitialState(players);
const ownRoster = () => rosterFromState(base());

// ---------------------------------------------------------------------------
// The conversion factor
// ---------------------------------------------------------------------------

test('a stat converts by the ratio of the two games\' conversion factors', () => {
  const out = convertStats({ hp: 250, attack: 30, move: 20 }, Source, Host);
  assert.deepEqual(out, { hp: 25, attack: 3, move: 2 });
});

test('a stat one side has no reading of is not converted at all', () => {
  const out = convertStats({ hp: 100, range: 20 }, Source, { foreignUnits: { scale: { hp: 10 } } });
  assert.deepEqual(out, { hp: 10 });
});

test('a game\'s general adjustment factor scales its strength against every other game, not its distances', () => {
  const strong = { foreignUnits: { ...Source.foreignUnits, factor: 2 } };
  // Twice as strong as its numbers say: its trooper is worth two of the host's spearmen...
  assert.deepEqual(convertStats({ hp: 100, attack: 20, defense: 20, range: 20, move: 10 }, strong, Host),
    { hp: 20, attack: 4, defense: 4, range: 2, move: 1 });
  // ...and a spearman lent to it comes in at half.
  const host = { foreignUnits: { ...Host.foreignUnits, factor: 2 } };
  assert.deepEqual(convertStats({ hp: 100, attack: 20, defense: 20, range: 20, move: 10 }, Source, host),
    { hp: 5, attack: 1, defense: 1, range: 2, move: 1 });
  // Two games with the same factor compare exactly as their scales say.
  const both = { foreignUnits: { ...Source.foreignUnits, factor: 3 } };
  assert.deepEqual(convertStats({ hp: 250, attack: 30, move: 20 }, both, { foreignUnits: { ...Host.foreignUnits, factor: 3 } }),
    { hp: 25, attack: 3, move: 2 });
  assert.equal(factorOf(Host), 1, 'a game that declares none has factor 1');
});

test('a stat a host can\'t set unit by unit rides in the one it folds into', () => {
  // No armour in this host: twice the chassis's defense comes in as twice the hp.
  const Armourless = {
    ...Host,
    foreignUnits: { ...Host.foreignUnits, fold: { defense: 'hp' } },
  };
  const Walls = { ...Source, foreignUnits: { ...Source.foreignUnits, profiles: () => ({ wall: { hp: 100, attack: 20, defense: 80, range: 20, move: 10, domain: 'land' } }) } };
  registerSources({ source: Source, walls: Walls });
  try {
    // A standard trooper's hp (10 here) behind four troopers' armour (8 here).
    const wall = foreignSpec(Armourless, base(), 'walls', 'wall');
    const kept = HOST_UNITS[wall.chassis].defense;
    assert.equal(wall.stats.defense, kept, 'it keeps the chassis\'s defense');
    assert.equal(wall.stats.hp, 10 * 8 / kept);
  } finally {
    registerSources({ source: Source });
  }
});

test('a damage roll is rescaled to a new average with its spread kept', () => {
  assert.deepEqual(rescaleRoll([3, 5], 8), [6, 10]);
  assert.deepEqual(rescaleRoll([3, 5], 0.4), [1, 1], 'a roll never drops below one point');
});

// ---------------------------------------------------------------------------
// Picking a chassis
// ---------------------------------------------------------------------------

test('a unit plays as the host type closest to it, stat for stat', () => {
  assert.equal(foreignSpec(Host, base(), 'source', 'trooper').chassis, 'spear', 'a standard unit is a standard unit');
  assert.equal(foreignSpec(Host, base(), 'source', 'titan').chassis, 'giant');
});

test('a unit keeps its domain where the host has a chassis of that domain', () => {
  assert.equal(foreignSpec(Host, base(), 'source', 'cruiser').chassis, 'boat');
});

test('a type the host keeps back is never a chassis', () => {
  // The farmer is the closest match on raw numbers to a 0-attack unit — and still
  // never picked, since its own specials would come along with it.
  assert.notEqual(foreignSpec(Host, base(), 'source', 'ghost').chassis, 'farmer');
});

test('a stat the source has no reading of is the chassis\'s own', () => {
  const spec = foreignSpec(Host, base(), 'source', 'ghost');
  assert.equal(spec.stats.hp, 5);
  assert.equal(spec.stats.attack, HOST_UNITS[spec.chassis].attack);
});

// ---------------------------------------------------------------------------
// Into a roster
// ---------------------------------------------------------------------------

test('a foreign unit is built under the host\'s rules with converted stats, drawn as itself', () => {
  const roster = [...ownRoster(), { ownerId: 'p2', type: 'titan', game: 'source', position: { x: 2, y: 3 } }];
  const state = buildInitialState(Host, players, { startingUnits: roster });
  const titan = state.units.at(-1);
  assert.equal(titan.type, 'source:titan', 'its type is the one registered in the host\'s table');
  assert.deepEqual(titan.origin, { game: 'source', type: 'titan', chassis: 'giant', seat: 1 });
  assert.equal(titan.hp, 40);
  assert.equal(titan.maxHp, 40);
  // Every rule that reads the table by type finds the converted entry...
  assert.equal(HOST_UNITS['source:titan'].attack, 8);
  assert.equal(HOST_UNITS['source:titan'].hp, 40);
  // ...and nothing that LISTS the table ever sees it.
  assert.ok(!Object.keys(HOST_UNITS).includes('source:titan'));
  assert.ok(!setupUnitTypes(Host, state).includes('source:titan'));
});

test('a foreign unit reads back out of the board as its own game\'s unit, and keeps its id through an edit', () => {
  const roster = [...ownRoster(), { ownerId: 'p1', type: 'trooper', game: 'source', position: { x: 2, y: 0 } }];
  const state = buildInitialState(Host, players, { startingUnits: roster });
  const back = rosterFromState(state);
  const trooper = back.find(e => e.game === 'source');
  assert.deepEqual({ type: trooper.type, game: trooper.game, ownerId: trooper.ownerId }, { type: 'trooper', game: 'source', ownerId: 'p1' });
  // Moving it keeps the very same unit.
  const moved = applyRoster(Host, state, back.map(e => (e.id === trooper.id ? { ...e, position: { x: 3, y: 1 } } : e)));
  const again = moved.units.find(u => u.id === trooper.id);
  assert.deepEqual(again.position, { x: 3, y: 1 });
  assert.equal(again.origin.type, 'trooper');
});

test('a roster naming a foreign unit the host cannot take is refused with a reason', () => {
  const at = { x: 2, y: 2 };
  assert.match(rosterError(Host, base(), [...ownRoster(), { ownerId: 'p1', type: 'trooper', game: 'nowhere', position: at }]), /no game "nowhere"/);
  assert.match(rosterError(Host, base(), [...ownRoster(), { ownerId: 'p1', type: 'dragon', game: 'source', position: at }]), /not a unit of Source/);
  const plain = { ...Host, foreignUnits: undefined };
  assert.match(rosterError(plain, base(), [...ownRoster(), { ownerId: 'p1', type: 'trooper', game: 'source', position: at }]), /does not take units/);
  // A game that only lends its units (any game but a core ruleset) takes none in.
  const lender = { ...Host, foreignUnits: { ...Host.foreignUnits, host: false } };
  assert.match(rosterError(lender, base(), [...ownRoster(), { ownerId: 'p1', type: 'trooper', game: 'source', position: at }]), /does not take units/);
  assert.deepEqual(foreignCatalog(lender, base()), []);
  assert.equal(rosterError(Host, base(), [...ownRoster(), { ownerId: 'p1', type: 'trooper', game: 'source', position: at }]), '');
});

test('the setup preview lists every other game\'s units, with what each would play as', () => {
  const preview = setupPreview(Host, players, {});
  const source = preview.foreign.find(g => g.game === 'source');
  const titan = source.units.find(u => u.type === 'titan');
  assert.equal(titan.name, 'Source titan');
  assert.deepEqual(titan.source, { hp: 400, attack: 80, defense: 40, range: 10, move: 10 });
  assert.equal(titan.plays.p1.chassis, 'giant');
  assert.equal(titan.plays.p1.stats.hp, 40);
  assert.ok(!preview.foreign.some(g => g.game === 'host'), 'a game\'s own units are not foreign to it');
});

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

test('the board draws a foreign unit as itself, found by id or by the square it stands on', () => {
  const roster = [...ownRoster(), { ownerId: 'p2', type: 'titan', game: 'source', position: { x: 2, y: 3 } }];
  const state = buildInitialState(Host, players, { startingUnits: roster });
  const grid = Host.toGrid(state);
  const dressed = dressGrid(Host, state, grid);
  const cell = dressed.cells.find(c => c.x === 2 && c.y === 3);
  assert.equal(cell.imagePath, '/source/titan-1', 'drawn as the second seat\'s titan');
  assert.equal(cell.unitName, 'Source titan');
  assert.equal(cell.glyph, 'T');
  assert.match(cell.tags.at(-1).title, /fights as a giant here, its stats converted/);
  assert.equal(dressed.cells.find(c => c.x === 0 && c.y === 0).imagePath, '/host/spear', 'the host\'s own units are untouched');

  // A renderer that names no unit on its cells is matched by position.
  const anonymous = { ...grid, cells: grid.cells.map(({ unitId, ...c }) => c) };
  const byPlace = dressGrid(Host, state, anonymous, cellMapper(Host, state, anonymous).toCell);
  assert.equal(byPlace.cells.find(c => c.x === 2 && c.y === 3).imagePath, '/source/titan-1');
});

test('a board with no foreign units on it is left exactly as the game drew it', () => {
  const state = base();
  const grid = Host.toGrid(state);
  assert.equal(dressGrid(Host, state, grid), grid);
});

// ---------------------------------------------------------------------------
// A pack from the library
// ---------------------------------------------------------------------------

test('a library pack lends its units, each drawn as its seat sees it', () => {
  const pack = {
    game: 'duel', title: 'Duel', scale: { hp: 1, attack: 1, defense: 1, range: 4, move: 1 },
    units: { rook: { hp: 2, attack: 2, defense: 2, range: 1, move: 3, domain: 'land', art: [{ imagePath: '/w', glyph: 'R', name: 'rook' }, { imagePath: '/b', glyph: 'R', name: 'rook' }] } },
  };
  const source = sourceFromPack(pack);
  assert.deepEqual(source.foreignUnits.profiles(), { rook: { hp: 2, attack: 2, defense: 2, range: 1, move: 3, domain: 'land' } });
  assert.deepEqual([0, 1, 2].map(seat => source.foreignUnits.art('rook', seat).imagePath), ['/w', '/b', '/w']);
  registerSources({ source: Source, duel: source });
  try {
    assert.ok(foreignCatalog(Host, base()).some(g => g.game === 'duel' && g.title === 'Duel'));
  } finally {
    registerSources({ source: Source });
  }
});
