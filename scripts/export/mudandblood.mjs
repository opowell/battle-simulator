// Mud and Blood 2's terrain and its one no-man's-land map in the core's board
// format (scripts/export-pack.mjs). Squares, four neighbours (the game moves and
// measures range in Manhattan steps). Cover is the game's own percentage; wire
// costs two to enter; the Allied base is impassable. A terrain's name, colour and
// description are what the game's own board shows (its toGrid). The map opens with
// the Allied squad and the first wave; the Axis wins by reaching the trench.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export default async function exportBoards(dir) {
  const { TERRAIN, getCoverDefense, moveCost, isPassable } = await import(pathToFileURL(path.join(dir, 'map.js')).href);
  const { MudAndBloodGame } = await import(pathToFileURL(path.join(dir, 'MudAndBloodGame.js')).href);
  const players = [{ id: 'allies', name: 'Allies' }, { id: 'axis', name: 'Axis' }];
  const state = MudAndBloodGame.createInitialState(players, {});
  const { board } = state;
  const shown = new Map(MudAndBloodGame.toGrid(state).cells.map(c => [board.tiles[c.y][c.x], c]));
  const ids = { OPEN: 'open', WIRE: 'wire', CRATER: 'crater', SANDBAG: 'sandbags', TRENCH: 'trench', BASE: 'base' };
  const terrain = {};
  const legend = {};
  for (const [name, ch] of Object.entries(TERRAIN)) {
    const at = shown.get(ch);
    const probe = { width: 1, height: 1, tiles: [[ch]] };
    const passable = isPassable(probe, 0, 0);
    terrain[ids[name]] = {
      name: at.terrain.name, color: at.color, description: at.terrain.description,
      cost: passable ? { land: moveCost(probe, 0, 0), air: 1 } : { land: Infinity, air: Infinity },
      passable: passable ? { land: true, sea: false, air: true } : false,
      cover: getCoverDefense(probe, 0, 0),
      blocksSight: false,
    };
    legend[ch] = ids[name];
  }
  const trench = board.tiles.flatMap((row, y) => row.flatMap((ch, x) => (ch === TERRAIN.TRENCH ? [[x, y]] : [])));
  return {
    terrain,
    maps: {
      'no-mans-land': {
        name: "No Man's Land",
        description: 'Hold the Allied trench against the German assault',
        board: { topology: 'square', width: board.width, height: board.height, rows: board.tiles.map(r => r.join('')), legend, neighbours: 4 },
        units: state.units.map(u => ({ type: u.type, seat: players.findIndex(p => p.id === u.ownerId), at: [u.position.x, u.position.y] })),
        victory: [{ type: 'eliminate' }, { type: 'reach', cells: trench, side: 1 }],
      },
    },
    omitted: [
      'the Axis waves after the first: the map opens with wave 1 only',
      'action points, hit chances and healing: the core\'s strikes are deterministic and spend a turn window',
      'the Allied win after all six waves: here the Allies win by wiping out who came',
    ],
  };
}
