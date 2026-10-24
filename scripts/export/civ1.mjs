// civ1's terrain and maps in the core's board format (scripts/export-pack.mjs).
// Squares, with the world wrapping east to west. A terrain's movement cost and
// defence bonus come from civ1's own table; what else a square can hold (rivers,
// roads, irrigation, mines, fortresses, cities) has no meaning in the core.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const COLOURS = {
  ocean: '#2f5f9e', arctic: '#e8eef2', tundra: '#9aa58f', desert: '#d8c27a', plains: '#b9b25c', grassland: '#6fa64a',
  forest: '#2f6b34', hills: '#9a8150', mountains: '#7d746a', swamp: '#4f6b55', jungle: '#3f7a3a',
};

export default async function exportBoards(dir) {
  const { TERRAIN } = await import(pathToFileURL(path.join(dir, 'terrain.js')).href);
  const { FIXED_MAPS, TERRAIN_LEGEND } = await import(pathToFileURL(path.join(dir, 'fixedMaps.js')).href);
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
  const maps = {};
  for (const m of FIXED_MAPS) {
    maps[m.id] = {
      name: m.name,
      description: m.description,
      // civ1 stacks units, the best defender taking each blow and the stack dying with it.
      board: { topology: 'square', width: m.rows[0].length, height: m.rows.length, rows: m.rows, legend: TERRAIN_LEGEND, stacking: 'stack', stackDeath: true, ...(m.wrap === false ? {} : { wrap: true }) },
      units: (m.units ?? []).map(u => ({ type: u.type, seat: (u.side ?? 1) - 1, at: [u.x, u.y] })),
    };
  }
  return {
    terrain, maps,
    omitted: [
      'rivers, roads, railroads, irrigation, mines and fortresses: the core has no square improvements',
      'cities, huts and special resources: the core has no economy',
      'zones of control',
    ],
  };
}
