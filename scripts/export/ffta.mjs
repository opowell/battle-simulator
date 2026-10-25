// FFTA's terrain and its scenarios in the core's board format
// (scripts/export-pack.mjs). One 12×10 square board under every scenario, walked
// four ways; its heights are the core's elevation, and a step up costs a level
// more, as in the game. Each scenario is a map of its own, with the jobs it deals
// and the way each unit starts facing.
//
// FFTA is a battle spec (spec.json) since phase 5, so its board is read from
// there; a copy from before that kept it in map.js, and faced in radians.
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

async function rowsOf(dir) {
  const specFile = path.join(dir, 'spec.json');
  if (existsSync(specFile)) {
    const spec = JSON.parse(readFileSync(specFile, 'utf8'));
    return { width: spec.board.width, height: spec.board.height, rows: spec.board.rows, degrees: true };
  }
  const { createMap } = await import(pathToFileURL(path.join(dir, 'map.js')).href);
  const board = createMap();
  const rows = Array.from({ length: board.height }, (_, y) => Array.from({ length: board.width }, (_, x) => board.tiles[`${x},${y}`].ch).join(''));
  return { width: board.width, height: board.height, rows, degrees: false };
}

export default async function exportBoards(dir) {
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
  const { width, height, rows, degrees } = await rowsOf(dir);
  const players = [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }];
  const maps = {};
  for (const sc of FFTAGame.scenarios) {
    const { units } = FFTAGame.createInitialState(players, sc.config);
    maps[sc.id] = {
      name: sc.name,
      description: sc.description,
      board: { topology: 'square', width, height, rows, legend, neighbours: 4, stacking: 'one' },
      units: units.map(u => ({
        type: u.type, seat: players.findIndex(p => p.id === u.ownerId), at: [u.position.x, u.position.y],
        facing: degrees ? u.facing : Math.round(u.facing * 180 / Math.PI + 360) % 360,
      })),
    };
  }
  return {
    terrain: { ...terrain, open: { ...terrain.floor } },
    maps,
    omitted: [
      'FFTA\'s own rules — the charge order, MP, statuses, reactions and supports, damage by height and by the side struck — are its spec\'s; a library map plays by the sandbox\'s',
      'sight: a unit sees two squares in a cone in front of it, whatever stands between; here it sees by its type\'s vision',
    ],
  };
}
