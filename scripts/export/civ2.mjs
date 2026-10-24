// Civ2's terrain and worlds in the core's board format (scripts/export-pack.mjs).
// Civ2 has no fixed map: every game generates a world from its seed (map.js,
// which stays with the game). These are a few of them, at the game's default
// size, each with the settlers and warriors the game opens with. Squares, the
// world wrapping east to west; one unit a square, as Civ2 here allows. A
// terrain's movement cost and defence bonus come from Civ2's own table.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SEEDS = [1, 2, 3];

export default async function exportBoards(dir) {
  const { TERRAIN } = await import(pathToFileURL(path.join(dir, 'terrain.js')).href);
  const { Civ2Game } = await import(pathToFileURL(path.join(dir, 'Civ2Game.js')).href);
  const terrain = {};
  const legend = {};
  for (const [id, t] of Object.entries(TERRAIN)) {
    const name = id[0].toUpperCase() + id.slice(1);
    terrain[id] = {
      name, color: Civ2Game.colors[id] ?? '#888888',
      description: `${name}: costs ${t.moveCost} to enter${t.defBonus ? `, +${t.defBonus * 100}% defence` : ''}.`,
      cost: { land: t.moveCost, sea: 1, air: 1 },
      passable: { ...t.passable },
      cover: Math.round(t.defBonus * 100),
    };
    legend[t.symbol] = id;
  }
  const players = [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }];
  const maps = {};
  for (const seed of SEEDS) {
    const { board, units } = Civ2Game.createInitialState(players, { seed });
    const rows = Array.from({ length: board.height }, (_, y) => Array.from({ length: board.width }, (_, x) => TERRAIN[board.tiles[`${x},${y}`].terrain].symbol).join(''));
    maps[`seed-${seed}`] = {
      name: `World ${seed}`,
      description: `A generated Civ2 world, ${board.width}×${board.height} (seed ${seed}), two civilisations' settlers and warriors`,
      board: { topology: 'square', width: board.width, height: board.height, rows, legend, stacking: 'one', wrap: true },
      units: units.map(u => ({ type: u.type, seat: players.findIndex(p => p.id === u.ownerId), at: [u.position.x, u.position.y] })),
    };
  }
  return {
    terrain, maps,
    omitted: [
      'the world generator: these are a few of its worlds, from fixed seeds',
      'rivers, roads, railroads, fortresses and special resources: the core has no square improvements',
      'cities and their production: the core has no economy',
      'hit points lost a round at a time and firepower: the core\'s strike is one blow',
    ],
  };
}
