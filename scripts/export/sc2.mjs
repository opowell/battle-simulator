// SC2's terrain and its map in the core's board format (scripts/export-pack.mjs).
// SC2 plays on SC1's Aiur Crossing with the same terrain table, so it is exported
// the same way (scripts/export/sc1.mjs): each scenario is that board with the
// races it deals, four workers and three fighters a side.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { starcraftBoards } from './sc1.mjs';

export default async function exportBoards(dir) {
  const { TERRAIN } = await import(pathToFileURL(path.join(dir, 'terrain.js')).href);
  const { Sc2Game } = await import(pathToFileURL(path.join(dir, 'Sc2Game.js')).href);
  const { UNITS } = await import(pathToFileURL(path.join(dir, 'units.js')).href);
  return starcraftBoards({ name: 'SC2', game: Sc2Game, TERRAIN, UNITS, dealt: 'four workers and three fighters a side' });
}
