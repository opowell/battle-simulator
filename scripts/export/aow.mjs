// The Ancient Art of War's terrain and its two campaign maps in the core's board
// format (scripts/export-pack.mjs). The game generates its battlefield from a
// seed; each scenario is that generator at the game's own seed, rasterised to the
// tile grid its rules read, so the maps here are the ones the scenarios open on.
// A terrain's marching cost and defence bonus are the game's own; its forage and
// a squad's continuous position have no meaning in the core.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export default async function exportBoards(dir) {
  const { TERRAIN } = await import(pathToFileURL(path.join(dir, 'terrain.js')).href);
  const { AowGame } = await import(pathToFileURL(path.join(dir, 'AowGame.js')).href);
  const terrain = {};
  for (const [id, t] of Object.entries(TERRAIN)) {
    terrain[id] = {
      name: t.name, color: t.color, description: t.description,
      cost: t.passable ? { land: t.moveCost, air: 1 } : { land: Infinity, air: 1 },
      passable: t.passable ? { land: true, sea: false, air: true } : { land: false, sea: false, air: true },
      cover: Math.max(0, Math.round(t.defBonus * 100)),
      blocksSight: false,
    };
  }
  const legend = Object.fromEntries(Object.entries(TERRAIN).map(([id, t]) => [t.symbol, id]));
  const players = [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }];
  const cell = (p) => [Math.floor(p.x), Math.floor(p.y)];
  const maps = {};
  for (const sc of AowGame.scenarios) {
    const { board, units } = AowGame.createInitialState(players, sc.config);
    const rows = Array.from({ length: board.height }, (_, y) => Array.from({ length: board.width }, (_, x) => TERRAIN[board.tiles[`${x},${y}`].terrain].symbol).join(''));
    maps[sc.id] = {
      name: sc.name,
      description: sc.description,
      board: { topology: 'square', width: board.width, height: board.height, rows, legend },
      // A squad is a mix of men; here it opens as its dominant kind.
      units: units.map(s => ({ type: s.type, seat: players.findIndex(p => p.id === s.ownerId), at: cell(s.position) })),
      features: board.features.map(f => ({
        kind: f.type, at: cell(f),
        ...(f.owner ? { seat: players.findIndex(p => p.id === f.owner) } : {}),
      })),
    };
  }
  return {
    terrain: { ...terrain, open: { ...terrain.plains } },
    maps,
    omitted: [
      'squads of mixed men: a map\'s squad opens as ten men of its dominant kind',
      'continuous positions: a squad stands on the square it was in',
      'supply, forage, morale and routing: the core has no upkeep',
      'forts, villages and flags are features only: no reinforcements, supply or capture-the-flag victory',
      'shallows\' defence penalty (-40%): the core\'s cover is never negative',
      'the battlefield generator: only the two scenarios\' worlds, at the game\'s own seed',
    ],
  };
}
