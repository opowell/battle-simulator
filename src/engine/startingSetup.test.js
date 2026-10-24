import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInitialState, rosterFromState, applyRoster, rosterError, setupUnitTypes,
  cellMapper, setupPreview,
} from './startingSetup.js';
import { GameEngine } from './index.js';

// ---------------------------------------------------------------------------
// A mock game with just enough of the contract to exercise the generic layer.
// ---------------------------------------------------------------------------

const players = [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }];

function mockUnit(id, ownerId, type, x, y) {
  return { id, ownerId, type, position: { x, y }, alive: true, hp: 10, attrs: { rank: 1 } };
}

const MockGame = {
  name: 'mock',
  createInitialState(ps) {
    const units = [
      mockUnit('a1', 'p1', 'warrior', 0, 0),
      mockUnit('a2', 'p1', 'archer', 1, 0),
      mockUnit('b1', 'p2', 'warrior', 0, 3),
    ];
    return {
      gameName: 'mock', turnNumber: 1, activePlayers: [ps[0].id], currentPhase: 'action',
      players: ps, board: { width: 4, height: 4 }, units, lastActions: null,
      gameSpecific: {
        startRoster: units.map(u => ({ id: u.id, ownerId: u.ownerId, type: u.type, position: { ...u.position } })),
      },
    };
  },
  getLegalActions: () => [{ type: 'end-turn', unitId: '__player__' }],
  applyActions: (state) => ({ ...state, turnNumber: state.turnNumber + 1 }),
  getResult: () => null,
  renderState: () => '',
  toGrid: (state) => ({
    width: 4, height: 4,
    cells: Array.from({ length: 16 }, (_, i) => {
      const x = i % 4, y = Math.floor(i / 4);
      const u = state.units.find(v => v.alive !== false && v.position.x === x && v.position.y === y);
      return { x, y, color: '#111', unitId: u?.id ?? null, glyph: u ? u.type[0] : '' };
    }),
  }),
};

const base = () => MockGame.createInitialState(players);

test('an untouched config leaves the game to build its own opening', () => {
  const state = buildInitialState(MockGame, players, {});
  assert.deepEqual(rosterFromState(state), rosterFromState(base()));
});

test('a roster of the game\'s own units rebuilds the same position', () => {
  const state = buildInitialState(MockGame, players, { startingUnits: rosterFromState(base()) });
  assert.deepEqual(state.units, base().units);
});

test('a kept unit keeps its id and everything hung off it, moved to the new square', () => {
  const roster = rosterFromState(base());
  roster[0] = { ...roster[0], position: { x: 2, y: 2 } };
  const state = applyRoster(MockGame, base(), roster);
  assert.equal(state.units[0].id, 'a1');
  assert.deepEqual(state.units[0].position, { x: 2, y: 2 });
  assert.deepEqual(state.units[0].attrs, { rank: 1 });   // not rebuilt from scratch
});

test('an added unit is a fresh clone of a same-type template', () => {
  const roster = [...rosterFromState(base()), { ownerId: 'p2', type: 'archer', position: { x: 3, y: 3 } }];
  const state = applyRoster(MockGame, base(), roster);
  const added = state.units[3];
  assert.equal(added.ownerId, 'p2');
  assert.equal(added.type, 'archer');
  assert.equal(added.hp, 10);                     // the template's stats
  assert.ok(!state.units.slice(0, 3).some(u => u.id === added.id));
});

test('a dropped unit is gone from the units array and from startRoster', () => {
  const roster = rosterFromState(base()).filter(u => u.id !== 'a2');
  const state = applyRoster(MockGame, base(), roster);
  assert.equal(state.units.length, 2);
  assert.ok(!JSON.stringify(state).includes('"a2"'));
});

test('startRoster is rebuilt in the shape the game wrote it', () => {
  const roster = [...rosterFromState(base()), { ownerId: 'p1', type: 'warrior', position: { x: 3, y: 0 } }];
  const state = applyRoster(MockGame, base(), roster);
  assert.equal(state.gameSpecific.startRoster.length, 4);
  assert.deepEqual(Object.keys(state.gameSpecific.startRoster[3]), ['id', 'ownerId', 'type', 'position']);
  assert.deepEqual(state.gameSpecific.startRoster[3].position, { x: 3, y: 0 });
});

test('a { units, … } startRoster keeps its other keys', () => {
  const withCities = {
    ...base(),
    gameSpecific: { startRoster: { units: base().units.map(u => ({ id: u.id, type: u.type })), cities: [] } },
  };
  const state = applyRoster(MockGame, withCities, rosterFromState(withCities).filter(u => u.id !== 'a2'));
  assert.equal(state.gameSpecific.startRoster.units.length, 2);
  assert.deepEqual(state.gameSpecific.startRoster.cities, []);
});

test('a game that derives more from its units is asked to rebuild it', () => {
  const game = { ...MockGame, applyStartingUnits: (state) => ({ ...state, gameSpecific: { ...state.gameSpecific, rebuilt: state.units.length } }) };
  const state = applyRoster(game, base(), rosterFromState(base()).filter(u => u.id !== 'a2'));
  assert.equal(state.gameSpecific.rebuilt, 2);
});

test('a game may mint unit types it does not open with', () => {
  const game = {
    ...MockGame,
    setupUnitTypes: () => ['warrior', 'archer', 'dragon'],
    createSetupUnit: (_s, { id, ownerId, type, position }) => ({ id, ownerId, type, position, alive: true, hp: 99 }),
  };
  assert.ok(setupUnitTypes(game, base()).includes('dragon'));
  const state = applyRoster(game, base(), [...rosterFromState(base()), { ownerId: 'p1', type: 'dragon', position: { x: 3, y: 3 } }]);
  assert.equal(state.units[3].hp, 99);
});

test('a roster is refused with a reason rather than half-applied', () => {
  const b = base();
  assert.match(rosterError(MockGame, b, []), /at least one unit/);
  assert.match(rosterError(MockGame, b, [{ ownerId: 'p9', type: 'warrior' }]), /owns nothing/);
  assert.match(rosterError(MockGame, b, [{ ownerId: 'p1', type: 'dragon' }]), /not a starting unit type/);
  // Wiping a side out entirely: refused, since games assume the sides they dealt in.
  assert.match(rosterError(MockGame, b, rosterFromState(b).filter(u => u.ownerId === 'p1')), /p2 must start with at least one unit/);
  assert.equal(rosterError(MockGame, b, rosterFromState(b)), '');
  assert.throws(() => applyRoster(MockGame, b, [{ ownerId: 'p1', type: 'dragon' }]), /not a starting unit type/);
});

test('the engine opens on the customised roster, and so does a replay of it', () => {
  const roster = [...rosterFromState(base()), { ownerId: 'p2', type: 'warrior', position: { x: 3, y: 3 } }];
  const engine = new GameEngine(MockGame, players.map(p => ({ ...p, agent: { id: p.id, chooseAction: () => ({ type: 'end-turn', unitId: '__player__' }) } })), { startingUnits: roster });
  engine.step();
  assert.equal(engine.state.units.length, 4);
  // Same config, same opening — what api-server's replays rely on.
  assert.deepEqual(buildInitialState(MockGame, players, { startingUnits: roster }).units,
                   applyRoster(MockGame, base(), roster).units);
});

// ---------------------------------------------------------------------------
// Positions ⇄ cells
// ---------------------------------------------------------------------------

test('{x,y} positions map straight onto cells', () => {
  const map = cellMapper(MockGame, base(), MockGame.toGrid(base()));
  assert.ok(map.placeable);
  assert.deepEqual(map.toCell({ x: 2, y: 3 }), [2, 3]);
  assert.deepEqual(map.fromCell(1, 2), { x: 1, y: 2 });
});

test('a game that writes coordinates as strings gets strings back', () => {
  const state = { units: [{ id: 'u', ownerId: 'p1', type: 'x', position: { x: '61', y: '31' }, alive: true }] };
  const map = cellMapper({}, state, { width: 70, height: 40 });
  assert.deepEqual(map.toCell({ x: '61', y: '31' }), [61, 31]);
  assert.deepEqual(map.fromCell(3, 4), { x: '3', y: '4' });
});

test('{col,row} positions work the same way', () => {
  const state = { units: [{ id: 'u', ownerId: 'p1', type: 'x', position: { col: 2, row: 0 }, alive: true }] };
  const map = cellMapper({}, state, { width: 9, height: 9 });
  assert.deepEqual(map.toCell({ col: 5, row: 1 }), [5, 1]);
  assert.deepEqual(map.fromCell(5, 1), { col: 5, row: 1 });
});

test('a gridToSquare game is inverted by enumerating its board', () => {
  const game = { gridToSquare: (col, row) => 'abcdefgh'[col] + (8 - row) };
  const state = { units: [{ id: 'u', ownerId: 'white', type: 'rook', position: 'a1', alive: true }] };
  const map = cellMapper(game, state, { width: 8, height: 8 });
  assert.deepEqual(map.toCell('a1'), [0, 7]);
  assert.equal(map.fromCell(4, 0), 'e8');
});

test('positions that are not board squares are simply not placeable', () => {
  const state = { units: [{ id: 'c1', ownerId: 'p1', type: 'card', position: null, alive: true }] };
  const map = cellMapper({}, state, null);
  assert.equal(map.placeable, false);
  assert.equal(map.toCell(null), null);
});

test('the setup preview carries the board, the roster and what may be added', () => {
  const preview = setupPreview(MockGame, players, {});
  assert.equal(preview.placeable, true);
  assert.equal(preview.board.width, 4);
  assert.equal(preview.board.cells.length, 16);
  // Every cell says which position it IS, so a unit can be placed on an empty one.
  assert.deepEqual(preview.board.cells[6].pos, { x: 2, y: 1 });
  assert.deepEqual(preview.roster.map(u => u.id), ['a1', 'a2', 'b1']);
  assert.deepEqual(preview.roster[0].cell, [0, 0]);
  assert.equal(preview.roster[0].glyph, 'w');
  assert.deepEqual(preview.unitTypes.sort(), ['archer', 'warrior']);
});

test('the preview pins whatever the game would otherwise roll fresh', () => {
  const game = { ...MockGame, resolveSetupConfig: (c) => ({ ...c, seed: 4242 }) };
  assert.equal(setupPreview(game, players, { width: 4 }).config.seed, 4242);
});
