// X-Com's terrain and its one map in the core's board format
// (scripts/export-pack.mjs). Squares; walls stop movement and sight, and the two
// heights of cover are X-Com's own +20 and +40 defence, read as cover. The units
// it opens with are the ones the game deals itself.
//
// X-Com is a battle spec (spec.json) since phase 5, so its board is read from
// there; a copy from before that kept it in map.js.
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

async function boardOf(dir) {
  const specFile = path.join(dir, 'spec.json');
  if (existsSync(specFile)) {
    const spec = JSON.parse(readFileSync(specFile, 'utf8'));
    const t = spec.terrain;
    return {
      colour: { floor: t.open.color, wall: t.wall.color, 'cover-low': t['cover-low'].color, 'cover-high': t['cover-high'].color },
      width: spec.board.width, height: spec.board.height, rows: spec.board.rows,
    };
  }
  const { createMap } = await import(pathToFileURL(path.join(dir, 'map.js')).href);
  const { XComGame } = await import(pathToFileURL(path.join(dir, 'XComGame.js')).href);
  const board = createMap();
  return { colour: XComGame.colors, width: board.width, height: board.height, rows: board.tiles.map(r => r.join('')) };
}

export default async function exportBoards(dir) {
  const { XComGame } = await import(pathToFileURL(path.join(dir, 'XComGame.js')).href);
  const { colour, width, height, rows } = await boardOf(dir);
  const terrain = {
    floor: { name: 'Floor', color: colour.floor, description: 'Open floor. No effect.', cost: 1, passable: true, cover: 0, blocksSight: false },
    wall: { name: 'Wall', color: colour.wall, description: 'Impassable; blocks sight and shots.', cost: { land: Infinity, air: Infinity }, passable: false, cover: 0, blocksSight: true },
    'cover-low': { name: 'Low cover', color: colour['cover-low'], description: '+20% defence to a unit behind it.', cost: 1, passable: true, cover: 20, blocksSight: false },
    'cover-high': { name: 'High cover', color: colour['cover-high'], description: '+40% defence to a unit behind it.', cost: 1, passable: true, cover: 40, blocksSight: false },
  };
  const legend = { '.': 'floor', '#': 'wall', c: 'cover-low', C: 'cover-high' };
  const players = [{ id: 'xcom', name: 'XCOM' }, { id: 'aliens', name: 'Aliens' }];
  const { units } = XComGame.createInitialState(players, {});
  const sc = XComGame.scenarios[0];
  return {
    terrain: { ...terrain, open: { ...terrain.floor } },
    maps: {
      [sc.id]: {
        name: sc.name,
        description: sc.description,
        board: { topology: 'square', width, height, rows, legend },
        units: units.map(u => ({ type: u.type, seat: players.findIndex(p => p.id === u.ownerId), at: [u.position.x, u.position.y] })),
      },
    },
    omitted: [
      'action points and hit chances: X-Com\'s spec has them, a library map plays by the sandbox\'s strikes',
      'cover is X-Com\'s defence against a shot from any side; the core reads it the same way',
    ],
  };
}
