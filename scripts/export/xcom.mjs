// X-Com's terrain and its one map in the core's board format
// (scripts/export-pack.mjs). Squares; walls stop movement and sight, and the two
// heights of cover are X-Com's own +20 and +40 defence, read as cover. The units
// it opens with are the ones the game deals itself.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export default async function exportBoards(dir) {
  const { TERRAIN, createMap } = await import(pathToFileURL(path.join(dir, 'map.js')).href);
  const { XComGame } = await import(pathToFileURL(path.join(dir, 'XComGame.js')).href);
  const colour = XComGame.colors;
  const terrain = {
    floor: { name: 'Floor', color: colour.floor, description: 'Open floor. No effect.', cost: 1, passable: true, cover: 0, blocksSight: false },
    wall: { name: 'Wall', color: colour.wall, description: 'Impassable; blocks sight and shots.', cost: { land: Infinity, air: Infinity }, passable: false, cover: 0, blocksSight: true },
    'cover-low': { name: 'Low cover', color: colour['cover-low'], description: '+20% defence to a unit behind it.', cost: 1, passable: true, cover: 20, blocksSight: false },
    'cover-high': { name: 'High cover', color: colour['cover-high'], description: '+40% defence to a unit behind it.', cost: 1, passable: true, cover: 40, blocksSight: false },
  };
  const legend = { [TERRAIN.FLOOR]: 'floor', [TERRAIN.WALL]: 'wall', [TERRAIN.LOW_COVER]: 'cover-low', [TERRAIN.HIGH_COVER]: 'cover-high' };
  const board = createMap();
  const players = [{ id: 'xcom', name: 'XCOM' }, { id: 'aliens', name: 'Aliens' }];
  const { units } = XComGame.createInitialState(players, {});
  const sc = XComGame.scenarios[0];
  return {
    terrain: { ...terrain, open: { ...terrain.floor } },
    maps: {
      [sc.id]: {
        name: sc.name,
        description: sc.description,
        board: { topology: 'square', width: board.width, height: board.height, rows: board.tiles.map(r => r.join('')), legend },
        units: units.map(u => ({ type: u.type, seat: players.findIndex(p => p.id === u.ownerId), at: [u.position.x, u.position.y] })),
      },
    },
    omitted: [
      'action points, hit chances and reaction fire: the core\'s strikes are deterministic and spend a turn window',
      'cover is X-Com\'s defence against a shot from any side; the core reads it the same way',
    ],
  };
}
