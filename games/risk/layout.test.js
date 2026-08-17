import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADJACENCY, TERRITORY_IDS } from './RiskMap.js';
import { LAYOUT, SEA_ROUTES, HEX_SIZE, routeKey, touchingPairs } from './RiskLayout.js';
import { hexToPixel, hexLayoutBounds } from '../mapTypes/hexagon.js';
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

test('risk layout: a sea route ends on each territory, at its closest hex to the other', () => {
  const { hexIdsByTerritory, hexCells, shoreHexesBySeaRoute } = LAYOUT;
  const pixel = (hex) => hexToPixel(hexCells[hex].q, hexCells[hex].r, HEX_SIZE);
  // The map wraps east to west, the way RiskLayout measures a crossing.
  const { width } = hexLayoutBounds(Object.keys(hexCells), hexCells, HEX_SIZE);
  const gap = (h1, h2) => {
    const [p1, p2] = [pixel(h1), pixel(h2)];
    const dx = Math.abs(p1.x - p2.x);
    return Math.hypot(Math.min(dx, width - dx), p1.y - p2.y);
  };

  for (const [a, b] of SEA_ROUTES) {
    const [ha, hb] = shoreHexesBySeaRoute[routeKey(a, b)];
    assert.ok(hexIdsByTerritory[a].includes(ha), `${a}'s end of the ${a}-${b} route is outside it`);
    assert.ok(hexIdsByTerritory[b].includes(hb), `${b}'s end of the ${a}-${b} route is outside it`);
    for (const x of hexIdsByTerritory[a]) {
      for (const y of hexIdsByTerritory[b]) {
        assert.ok(gap(x, y) >= gap(ha, hb) - 1e-9,
          `${a}-${b} crosses more water than it has to: ${x}-${y} is closer than ${ha}-${hb}`);
      }
    }
  }
});

test('risk toGrid: sea routes are drawn coast to coast, not capital to capital', () => {
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
    assert.ok(Math.hypot(link.p2[0] - link.p1[0], link.p2[1] - link.p1[1]) > 0,
      `${link.a}-${link.b} collapsed to a point`);
  }

  // A crossing spans water only: it can never be longer than the line between the
  // two capitals, and where the capital sits inland it is strictly shorter. Both
  // are measured in raw hex pixels — toGrid only translates them.
  const { capitalHexByTerritory, hexCells } = LAYOUT;
  const capitalGap = (a, b) => {
    const p1 = hexToPixel(hexCells[capitalHexByTerritory[a]].q, hexCells[capitalHexByTerritory[a]].r, HEX_SIZE);
    const p2 = hexToPixel(hexCells[capitalHexByTerritory[b]].q, hexCells[capitalHexByTerritory[b]].r, HEX_SIZE);
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
  };
  for (const link of grid.links) {
    if (link.a === 'alaska') continue;  // the wrapped one: two stubs, not one span
    const len = Math.hypot(link.p2[0] - link.p1[0], link.p2[1] - link.p1[1]);
    assert.ok(len <= capitalGap(link.a, link.b) + 1e-9,
      `${link.a}-${link.b} is drawn longer than the capital-to-capital line`);
  }
  const atlantic = grid.links.find(l => l.a === 'brazil' && l.b === 'north_africa');
  assert.ok(Math.hypot(atlantic.p2[0] - atlantic.p1[0], atlantic.p2[1] - atlantic.p1[1])
    < capitalGap('brazil', 'north_africa') - HEX_SIZE,
    'brazil-north_africa should leave the coast, well short of the two capitals');
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
