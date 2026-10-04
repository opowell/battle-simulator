// Hand-built boards (fixedMaps.js): the ASCII layers a map is authored in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFixedMap } from './fixedMaps.js';

test('fixed maps: the tileImprovements layer lays roads, irrigation and mines', () => {
  const board = parseFixedMap({
    rows:             ['GPHM.'],
    tileImprovements: ['=+mi='],
  });
  const t = x => board.tiles[`${x},0`];
  assert.equal(t(0).hasRoad, true);
  assert.equal(t(0).irrigated, undefined);
  assert.equal(t(1).hasRoad, true, "'+' is a road…");
  assert.equal(t(1).irrigated, true, '…on irrigated land');
  assert.equal(t(2).mined, true);
  assert.equal(t(2).hasRoad, false);
});

test('fixed maps: work the terrain cannot take is dropped, as a settler could not build it', () => {
  const board = parseFixedMap({
    rows:             ['MG.G'],
    tileImprovements: ['im= '],
  });
  const t = x => board.tiles[`${x},0`];
  assert.equal(t(0).irrigated, undefined, 'no irrigating a mountain');
  assert.equal(t(1).mined, undefined, 'no mine on grassland');
  assert.equal(t(2).hasRoad, false, 'no road at sea');
  assert.deepEqual(t(3), { terrain: 'grassland', hasRoad: false, hasRiver: false, fortress: false });
});

test('fixed maps: a map without the layer is bare ground', () => {
  const board = parseFixedMap({ rows: ['GH'] });
  for (const t of Object.values(board.tiles)) {
    assert.equal(t.hasRoad, false);
    assert.equal(t.irrigated, undefined);
    assert.equal(t.mined, undefined);
  }
});
