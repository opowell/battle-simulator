import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerGames, convertStats, foreignSpec, foreignCatalog, dressGrid, tableUnits, whole, rescaleRoll,
} from './foreignUnits.js';
import { buildInitialState, rosterFromState, applyRoster, rosterError, setupUnitTypes, setupPreview, cellMapper } from './startingSetup.js';
import { ChessGame } from '../games/chess/index.js';
import { Civ1Game } from '../games/civ1/index.js';
import { Sc1Game } from '../games/sc1/index.js';
import { DoomGame } from '../games/doom/index.js';
import { UNITS as CIV1_UNITS } from '../games/civ1/units.js';

// ---------------------------------------------------------------------------
// Two mock games: a HOST whose rules read every stat from a type table, and a
// SOURCE that counts in numbers ten times as big.
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

registerGames({ host: Host, source: Source, chess: ChessGame, civ1: Civ1Game, sc1: Sc1Game, doom: DoomGame });

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
// The real games
// ---------------------------------------------------------------------------

test('civ1 takes an SC1 marine in as a civ1 unit of its own size', () => {
  const ps = [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }];
  const preview = setupPreview(Civ1Game, ps, {});
  const roster = [...preview.roster.map(({ id, ownerId, type, position }) => ({ id, ownerId, type, position })),
    { ownerId: 'p1', type: 'marine', game: 'sc1', position: preview.roster[0].position }];
  const state = buildInitialState(Civ1Game, ps, { ...preview.config, startingUnits: roster });
  const marine = state.units.find(u => u.origin?.game === 'sc1');
  // A marine is SC1's standard infantryman, so it comes out as civ1's: 10 hp, 2/2.
  assert.equal(marine.hp, 10);
  assert.equal(CIV1_UNITS[marine.type].attack, 2);
  assert.equal(CIV1_UNITS[marine.type].defense, 2);
  assert.ok(!Object.keys(CIV1_UNITS).includes(marine.type), 'never offered as something a city can build');
  // It can be ordered about like any civ1 unit.
  const legal = Civ1Game.getLegalActions(state, 'p1').filter(a => a.unitId === marine.id);
  assert.ok(legal.some(a => a.type === 'move'), 'the marine should have moves');
});

test('chess takes a foreign unit in AS a piece: it moves as one, is drawn as itself, and keeps that through a move', () => {
  const ps = [{ id: 'white', name: 'W' }, { id: 'black', name: 'B' }];
  const preview = setupPreview(ChessGame, ps, {});
  // A battlecruiser on e4, for white.
  const roster = [...preview.roster.map(({ id, ownerId, type, position }) => ({ id, ownerId, type, position })),
    { ownerId: 'white', type: 'battlecruiser', game: 'sc1', position: 'e4' }];
  const state = buildInitialState(ChessGame, ps, { startingUnits: roster });
  const bc = state.units.find(u => u.origin);
  assert.equal(bc.type, 'queen', 'the strongest thing SC1 has is a queen here');
  assert.equal(state.board.e4.id, bc.id, 'it stands on the board the move generator reads');
  const moves = ChessGame.getLegalActions(state, 'white').filter(a => a.from === 'e4');
  assert.ok(moves.length > 10, `a queen on e4 should have moves, got ${moves.length}`);
  const after = ChessGame.applyActions(state, [{ playerId: 'white', action: moves.find(m => m.to === 'e5') ?? moves[0] }]);
  const moved = after.units.find(u => u.id === bc.id);
  assert.equal(moved.origin.type, 'battlecruiser', 'it is still a battlecruiser after it moves');
  const cell = dressGrid(ChessGame, after, ChessGame.toGrid(after)).cells.find(c => c.unitId === bc.id);
  assert.equal(cell.imagePath, '/images/sc1/units/battlecruiser');
});

test('what a setup screen shows is what the unit really plays with', () => {
  // civ1 counts in whole numbers: the catalog shows the rounded stats the unit gets.
  const civ1 = Civ1Game.createInitialState(players, {});
  const ling = foreignCatalog(Civ1Game, civ1).find(g => g.game === 'sc1').units.find(u => u.type === 'zergling');
  for (const v of Object.values(ling.plays.p1.stats)) assert.equal(v, Math.round(v), 'civ1 stats are whole numbers');
  // Chess has nowhere to write stats at all: a unit there IS its piece, numbers and all.
  const ps = [{ id: 'white', name: 'W' }, { id: 'black', name: 'B' }];
  const chess = ChessGame.createInitialState(ps, {});
  const bc = foreignCatalog(ChessGame, chess).find(g => g.game === 'sc1').units.find(u => u.type === 'battlecruiser');
  assert.deepEqual(bc.plays.white.stats, bc.plays.white.own);
});

test('a chassis only one side can play carries only that side\'s units (Doom)', () => {
  const ps = [{ id: 'marine', name: 'M' }, { id: 'demons', name: 'D' }];
  const base = DoomGame.createInitialState(ps, {});
  assert.equal(foreignSpec(DoomGame, base, 'sc1', 'zergling', 'marine').chassis, 'doomguy');
  assert.notEqual(foreignSpec(DoomGame, base, 'sc1', 'zergling', 'demon').chassis, 'doomguy');
});

test('every game\'s units can be put into every other game, and the catalog says so', () => {
  const hosts = { chess: ChessGame, civ1: Civ1Game, sc1: Sc1Game };
  for (const [name, game] of Object.entries(hosts)) {
    const ps = name === 'chess' ? [{ id: 'white', name: 'W' }, { id: 'black', name: 'B' }] : players;
    const base = game.createInitialState(ps, {});
    const offered = foreignCatalog(game, base).map(g => g.game).sort();
    const expected = ['chess', 'civ1', 'doom', 'host', 'sc1', 'source'].filter(g => g !== name);
    assert.deepEqual(offered, expected, `${name} should be offered every other game's units`);
  }
});
