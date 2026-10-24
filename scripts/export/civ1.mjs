// civ1's terrain and maps in the core's board format (scripts/export-pack.mjs).
// Squares, with the world wrapping east to west. A terrain's movement cost and
// defence bonus come from civ1's own table; what else a square can hold (rivers,
// roads, irrigation, mines, fortresses, cities) has no meaning in the core.
// Every hand-built map (fixedMaps.js) is exported, and beside them a few of the
// worlds the game generates from a seed (map.js, which stays with the game), at
// the game's default size, each with the settlers and militia a civ opens with.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const COLOURS = {
  ocean: '#2f5f9e', arctic: '#e8eef2', tundra: '#9aa58f', desert: '#d8c27a', plains: '#b9b25c', grassland: '#6fa64a',
  forest: '#2f6b34', hills: '#9a8150', mountains: '#7d746a', swamp: '#4f6b55', jungle: '#3f7a3a',
};

const SEEDS = [1, 2, 3];

export default async function exportBoards(dir) {
  const { TERRAIN } = await import(pathToFileURL(path.join(dir, 'terrain.js')).href);
  const { FIXED_MAPS, TERRAIN_LEGEND } = await import(pathToFileURL(path.join(dir, 'fixedMaps.js')).href);
  const { Civ1Game } = await import(pathToFileURL(path.join(dir, 'Civ1Game.js')).href);
  const terrain = {};
  for (const [id, t] of Object.entries(TERRAIN)) {
    if (id === 'unknown') continue;
    const name = id[0].toUpperCase() + id.slice(1);
    terrain[id] = {
      name, color: COLOURS[id] ?? '#888888',
      description: `${name}: costs ${t.moveCost} to enter${t.defBonus ? `, +${t.defBonus * 100}% defence` : ''}.`,
      cost: { land: t.moveCost, sea: 1, air: 1 },
      passable: { ...t.passable },
      cover: Math.round(t.defBonus * 100),
    };
  }
  // civ1 stacks units, the best defender taking each blow and the stack dying with it.
  const board = (width, height, rows, wrap) => ({ topology: 'square', width, height, rows, legend: TERRAIN_LEGEND, stacking: 'stack', stackDeath: true, ...(wrap === false ? {} : { wrap: true }) });
  const maps = {};
  for (const m of FIXED_MAPS) {
    maps[m.id] = {
      name: m.name,
      description: m.description,
      board: board(m.rows[0].length, m.rows.length, m.rows, m.wrap),
      units: (m.units ?? []).map(u => ({ type: u.type, seat: (u.side ?? 1) - 1, at: [u.x, u.y] })),
    };
  }
  // A generated world's squares written in the fixed maps' own legend.
  const symbol = Object.fromEntries(Object.entries(TERRAIN_LEGEND).map(([ch, id]) => [id, ch]));
  const players = [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }];
  for (const seed of SEEDS) {
    const state = Civ1Game.createInitialState(players, { seed });
    const { width, height, tiles } = state.board;
    const rows = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => symbol[tiles[`${x},${y}`].terrain]).join(''));
    maps[`seed-${seed}`] = {
      name: `World ${seed}`,
      description: `A generated civ1 world, ${width}×${height} (seed ${seed}), two civilisations' settlers and militia`,
      board: board(width, height, rows, state.board.wrap),
      units: state.units.map(u => ({ type: u.type, seat: players.findIndex(p => p.id === u.ownerId), at: [u.position.x, u.position.y] })),
    };
  }
  return {
    terrain, maps,
    omitted: [
      'the world generator: the seed-N maps are a few of its worlds, from fixed seeds',
      'rivers, roads, railroads, irrigation, mines and fortresses: the core has no square improvements',
      'cities, huts and special resources: the core has no economy',
      'zones of control',
    ],
  };
}
