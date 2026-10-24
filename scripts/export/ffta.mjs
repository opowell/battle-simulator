// FFTA's terrain and its scenarios in the core's board format
// (scripts/export-pack.mjs). One 12×10 square board under every scenario, walked
// four ways; its heights are the core's elevation, and a step up costs a level
// more, as in the game. Each scenario is a map of its own, with the jobs it deals
// and the way each unit starts facing.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export default async function exportBoards(dir) {
  const { createMap } = await import(pathToFileURL(path.join(dir, 'map.js')).href);
  const { FFTAGame } = await import(pathToFileURL(path.join(dir, 'FFTAGame.js')).href);
  const colour = FFTAGame.colors;
  const terrain = {
    floor: { name: 'Floor', color: colour.floor, description: 'Height 0.', cost: 1, passable: true, cover: 0, blocksSight: false },
    elevated: { name: 'Elevated Ground', color: colour.elevated, description: 'Height 1: a level more to climb onto.', cost: 1, passable: true, cover: 0, blocksSight: false, elevation: 1 },
    'elevated-high': { name: 'High Ground', color: colour['elevated-high'], description: 'Height 2: a level more to climb onto from height 1.', cost: 1, passable: true, cover: 0, blocksSight: false, elevation: 2 },
    // FFTA has no line of sight: its rock only stops movement.
    wall: { name: 'Wall', color: colour.wall, description: 'Impassable.', cost: { land: Infinity, air: Infinity }, passable: false, cover: 0, blocksSight: false },
  };
  const legend = { '.': 'floor', 1: 'elevated', 2: 'elevated-high', '#': 'wall' };
  const board = createMap();
  const rows = Array.from({ length: board.height }, (_, y) => Array.from({ length: board.width }, (_, x) => board.tiles[`${x},${y}`].ch).join(''));
  const players = [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }];
  const maps = {};
  for (const sc of FFTAGame.scenarios) {
    const { units } = FFTAGame.createInitialState(players, sc.config);
    maps[sc.id] = {
      name: sc.name,
      description: sc.description,
      board: { topology: 'square', width: board.width, height: board.height, rows, legend, neighbours: 4, stacking: 'one' },
      units: units.map(u => ({
        type: u.type, seat: players.findIndex(p => p.id === u.ownerId), at: [u.position.x, u.position.y],
        facing: Math.round(u.facing * 180 / Math.PI + 360) % 360,
      })),
    };
  }
  return {
    terrain: { ...terrain, open: { ...terrain.floor } },
    maps,
    omitted: [
      'the clock (CT): each unit acts when its speed fills it, not a side at a time',
      'laws, MP, statuses, reactions and supports: the core\'s abilities carry none of these jobs\' own',
      'height: FFTA adds 20% damage a level the attacker stands above its target; the core gives the higher defender cover instead',
      'a blow from the side or the back hitting harder: the jobs carry no facing arcs here',
      'sight: a unit sees two squares in a cone in front of it, whatever stands between; here it sees by its type\'s vision',
    ],
  };
}
