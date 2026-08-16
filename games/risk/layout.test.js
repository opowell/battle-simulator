import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADJACENCY, TERRITORY_IDS } from './RiskMap.js';
import { LAYOUT, SEA_ROUTES, touchingPairs } from './RiskLayout.js';
import { RiskGame } from './index.js';

const key = (a, b) => [a, b].sort().join('|');

const realPairs = new Set();
for (const [id, neighbors] of Object.entries(ADJACENCY)) for (const n of neighbors) realPairs.add(key(id, n));

test('risk layout: every territory is on the map exactly once', () => {
  const { hexIdsByTerritory } = LAYOUT;
  assert.deepEqual(Object.keys(hexIdsByTerritory).sort(), [...TERRITORY_IDS].sort());
  for (const id of TERRITORY_IDS) assert.ok(hexIdsByTerritory[id].length >= 1, `${id} has no hexes`);
});

test('risk layout: every territory is one connected blob', () => {
  const { hexIdsByTerritory, hexAdjacency } = LAYOUT;
  for (const [id, hexes] of Object.entries(hexIdsByTerritory)) {
    const own = new Set(hexes);
    const seen = new Set([hexes[0]]);
    const queue = [hexes[0]];
    while (queue.length) {
      for (const n of hexAdjacency[queue.pop()]) {
        if (own.has(n) && !seen.has(n)) { seen.add(n); queue.push(n); }
      }
    }
    assert.equal(seen.size, own.size, `${id} is drawn as ${own.size} hexes in more than one piece`);
  }
});

test('risk layout: territories only share a border if they are really adjacent', () => {
  const bogus = [...touchingPairs()].filter(p => !realPairs.has(p));
  assert.deepEqual(bogus, [], 'these blobs touch on the map but cannot attack each other');
});

test('risk layout: the adjacent pairs that do not touch are exactly the sea routes', () => {
  const touching = touchingPairs();
  const notTouching = [...realPairs].filter(p => !touching.has(p)).sort();
  assert.deepEqual(notTouching, SEA_ROUTES.map(([a, b]) => key(a, b)).sort());
});

test('risk layout: the capital hex of a territory belongs to it', () => {
  const { hexIdsByTerritory, capitalHexByTerritory } = LAYOUT;
  for (const [id, hexes] of Object.entries(hexIdsByTerritory)) {
    assert.ok(hexes.includes(capitalHexByTerritory[id]), `${id}'s capital hex is outside it`);
  }
});

test('risk toGrid: one army-count token per territory, tiles carry their territory', () => {
  const players = [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];
  const state = RiskGame.createInitialState(players);
  const grid = RiskGame.toGrid(state);

  assert.equal(grid.grid, 'hexagon');
  assert.ok(grid.width > 0 && grid.height > 0);
  for (const cell of grid.cells) assert.ok(cell.territoryId, 'every tile belongs to a territory');

  const tokens = grid.cells.filter(c => c.unitId);
  assert.equal(tokens.length, TERRITORY_IDS.length);
  for (const t of tokens) {
    assert.equal(t.glyph, String(state.board.territories[t.unitId].armies));
  }
});

test('risk toGrid: sea routes are drawn between the two capitals they connect', () => {
  const players = [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];
  const grid = RiskGame.toGrid(RiskGame.createInitialState(players));
  // One line per route, except the one that goes around the back of the map
  // (alaska–kamchatka), which is drawn as a stub off each side.
  assert.equal(grid.links.length, SEA_ROUTES.length + 1);
  const wrapped = grid.links.filter(l => l.a === 'alaska' && l.b === 'kamchatka');
  assert.equal(wrapped.length, 2);
  assert.ok(wrapped.some(l => l.p2[0] === 0) && wrapped.some(l => l.p2[0] === grid.width),
    'the two stubs should run off opposite edges');
  for (const link of grid.links) {
    assert.ok(realPairs.has(key(link.a, link.b)), `${link.a}-${link.b} is not an adjacency`);
    assert.equal(link.p1.length, 2);
    assert.equal(link.p2.length, 2);
  }
});

test('risk toGrid: hidden territories render neutral, with no army count', () => {
  const players = [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];
  const state = RiskGame.createInitialState(players);
  // Fog leaves a territory owner-less (see getVisibleState); the renderer must not
  // print "null" armies on it or paint it in a seat colour.
  const hidden = TERRITORY_IDS[0];
  state.board.territories[hidden] = { ...state.board.territories[hidden], owner: null, armies: null };

  const grid = RiskGame.toGrid(state);
  for (const cell of grid.cells.filter(c => c.territoryId === hidden)) {
    assert.equal(cell.owner, 0);
    assert.equal(cell.glyph, '');
  }
});
