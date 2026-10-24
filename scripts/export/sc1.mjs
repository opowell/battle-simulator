// SC1's terrain and its map in the core's board format (scripts/export-pack.mjs).
// Every scenario plays on the same hand-authored 48×40 map, "Aiur Crossing"
// (starcraftMap.js), so each scenario is that board with the races it deals:
// four workers and two fighters a side. Squares, walked eight ways, one unit a
// square as SC1's discrete play allows. Terrain is priced for ground units and
// air units (the core's land and air); the plateau is a level of elevation, which
// only ramps climb onto, so climbing costs nothing more than the ramp's own price.
// SC2 plays on the same map with the same terrain table (scripts/export/sc2.mjs).
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export default async function exportBoards(dir) {
  const { TERRAIN } = await import(pathToFileURL(path.join(dir, 'terrain.js')).href);
  const { Sc1Game } = await import(pathToFileURL(path.join(dir, 'Sc1Game.js')).href);
  const { UNITS } = await import(pathToFileURL(path.join(dir, 'units.js')).href);
  return starcraftBoards({
    name: 'SC1', game: Sc1Game, TERRAIN, UNITS, dealt: 'four workers and two fighters a side',
    omitted: [
      'continuous positions: SC1 can start units between squares; each is put on its own square, the nearest free one where two would share',
    ],
  });
}

/** Aiur Crossing and its terrain, under each of a StarCraft game's scenarios. */
export function starcraftBoards({ name, game, TERRAIN, UNITS, dealt, omitted = [] }) {
  const NAMES = { open: 'Open Ground', elevated: 'Elevated Ground', ramp: 'Ramp', minerals: 'Mineral Field', vespene: 'Vespene Geyser', obstacle: 'Obstacle' };
  const DESCRIPTIONS = {
    open: 'Open ground. No effect.',
    elevated: 'High ground: ranged attackers below it miss more often.',
    ramp: 'The way up onto high ground; costs double to cross.',
    minerals: 'A mineral field. Not walkable by ground units; air flies over.',
    vespene: 'A vespene geyser. Not walkable by ground units; air flies over.',
    obstacle: 'Rock and cliffs. Impassable to ground and air alike.',
  };
  const terrain = {};
  const legend = {};
  for (const [id, t] of Object.entries(TERRAIN)) {
    // A cost of 0 is StarCraft's "no price of its own", which it reads as 1.
    const cost = t.moveCost || 1;
    terrain[id] = {
      name: NAMES[id], color: game.colors[id], description: DESCRIPTIONS[id],
      cost: { land: t.passable.ground ? cost : Infinity, air: t.passable.air ? cost : Infinity },
      passable: { land: t.passable.ground, air: t.passable.air },
      cover: 0, blocksSight: false,
      ...(id === 'elevated' ? { elevation: 1 } : {}),
    };
    legend[t.symbol] = id;
  }

  const players = [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }];
  const maps = {};
  for (const sc of game.scenarios) {
    const { board, units, buildings } = game.createInitialState(players, sc.config);
    const rows = Array.from({ length: board.height }, (_, y) => Array.from({ length: board.width }, (_, x) => TERRAIN[board.tiles[`${x},${y}`].terrain].symbol).join(''));
    maps[sc.id] = {
      name: sc.name,
      description: `${sc.description}, on Aiur Crossing: ${dealt}, beside their main base`,
      board: { topology: 'square', width: board.width, height: board.height, rows, legend, stacking: 'one', climb: 0 },
      units: onSquares(name, units, board, TERRAIN, UNITS).map(u => ({ type: u.type, seat: players.findIndex(p => p.id === u.ownerId), at: u.at })),
      features: buildings.map(b => ({ kind: 'base', name: b.type, seat: players.findIndex(p => p.id === b.ownerId), at: [b.position.x, b.position.y] })),
    };
  }
  return {
    terrain, maps,
    omitted: [
      'buildings, workers\' mining and production: the core has no economy (each main base is kept as a map feature)',
      'mineral and gas amounts: a field or geyser is only ground that ground units cannot walk',
      'creep',
      'shields, armour and splash as their own rules: the pack reads shields as hp and armour as defence',
      `high ground: ${name} has ranged attackers below it miss 30% of shots; the core gives the higher defender cover instead, and its elevation blocks sight across the plateau where ${name}'s sight (three squares, Chebyshev) has no line of sight at all`,
      ...omitted,
    ],
  };
}

// StarCraft may start units at continuous points, several to a square. Each goes
// to the square it stands in, or, where that is taken or its ground isn't
// walkable, the nearest free square that is, in a fixed order so the export is
// stable.
function onSquares(name, units, board, TERRAIN, UNITS) {
  const taken = new Set();
  const free = (x, y, domain) => {
    const t = TERRAIN[board.tiles[`${x},${y}`]?.terrain];
    return t && (domain === 'air' ? t.passable.air : t.passable.ground) && !taken.has(`${x},${y}`);
  };
  return units.map(u => {
    const x0 = Math.floor(Number(u.position.x)), y0 = Math.floor(Number(u.position.y));
    const domain = UNITS[u.type].domain;
    for (let r = 0; r < Math.max(board.width, board.height); r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !free(x0 + dx, y0 + dy, domain)) continue;
          taken.add(`${x0 + dx},${y0 + dy}`);
          return { ...u, at: [x0 + dx, y0 + dy] };
        }
      }
    }
    throw new Error(`${name}: no free square for ${u.id}`);
  });
}
