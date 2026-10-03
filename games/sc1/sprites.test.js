import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { Sc1Game, UNITS } from './index.js';
import { BUILDINGS } from './buildings.js';
import { RandomAgent } from '../../agents/index.js';

const players = [
  { id: 'p1', name: 'P1', agent: RandomAgent, race: 'protoss' },
  { id: 'p2', name: 'P2', agent: RandomAgent, race: 'zerg' },
];
const imageSrcs = grid => grid.units.flatMap(t => (t.spriteLayers ?? []).map(l => l.src).filter(Boolean));

for (const set of ['original', 'remastered']) {
  test(`sc1 sprites: every unit and building type has a picture in map-${set}/`, () => {
    const have = new Set(readdirSync(new URL(`./images/map-${set}/`, import.meta.url))
      .filter(f => f.endsWith('.png')).map(f => f.slice(0, -4)));
    const missing = [...Object.keys(UNITS), ...Object.keys(BUILDINGS)].filter(t => !have.has(t));
    assert.deepEqual(missing, []);
  });
}

test('sc1 sprites: the map draws the original art unless told otherwise', () => {
  const grid = Sc1Game.toGrid(Sc1Game.createInitialState(players));
  const srcs = imageSrcs(grid);
  assert.ok(srcs.length > 0, 'units and buildings draw from images');
  assert.ok(srcs.every(s => s.startsWith('/images/sc1/map-original/')), srcs.join(' '));
});

test('sc1 sprites: spriteSet remastered switches every unit and building', () => {
  const grid = Sc1Game.toGrid(Sc1Game.createInitialState(players, { spriteSet: 'remastered' }));
  const srcs = imageSrcs(grid);
  // Every token — the buildings too, not just the units.
  assert.equal(srcs.length, grid.units.length);
  assert.ok(srcs.every(s => s.startsWith('/images/sc1/map-remastered/')), srcs.join(' '));
});

test('sc1 sprites: an unknown spriteSet falls back to the original art', () => {
  const state = Sc1Game.createInitialState(players);
  state.gameSpecific.spriteSet = 'nonsense';
  assert.ok(imageSrcs(Sc1Game.toGrid(state)).every(s => s.startsWith('/images/sc1/map-original/')));
});
