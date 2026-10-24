// War of Dots's terrain and its three maps in the core's board format
// (scripts/export-pack.mjs). The game plays in pixels over a 40×26 grid of 28 px
// squares, and its rules read terrain off that grid, so that grid is the board:
// the two shape scenarios as their shapes rasterise onto it, and the standard
// map, which the game generates afresh every game, at one fixed seed. A square
// costs what the slower kind of infantry pays to cross it (the inverse of its
// speed there, rounded); mountains stop everyone. Units open beside their capital,
// on the square they stand in.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const STANDARD_SEED = 1;

const NAMES = {
  PLAINS: ['Plains', 'Open ground. No effect.'],
  CITY: ['City', 'Earns gold for its owner; captured by standing on it.'],
  CAPITAL: ['Capital', 'A side\'s capital: lose it and the war is lost.'],
};

export default async function exportBoards(dir) {
  const { WarodDotsGame, TERRAIN, TERRAIN_COLOR, WOD_SHAPE_STYLES, T, speedMod } = await import(pathToFileURL(path.join(dir, 'WarodDotsGame.js')).href);
  const style = Object.fromEntries(Object.values(WOD_SHAPE_STYLES).map(s => [s.terrain, s]));
  const terrain = {};
  const legend = {};
  const chars = { PLAINS: '.', FOREST: 'f', HILLS: 'h', WATER: '~', MOUNTAINS: '^', SAND: 's', CITY: 'c', CAPITAL: 'C', BRIDGE: '=' };
  for (const [key, code] of Object.entries(TERRAIN)) {
    const id = key.toLowerCase();
    const [name, description] = style[code] ? [style[code].name, style[code].description] : NAMES[key];
    const slowest = Math.min(speedMod(code, 'light'), speedMod(code, 'heavy'));
    terrain[id] = {
      name, color: TERRAIN_COLOR[code], description,
      cost: slowest > 0 ? { land: Math.round(1 / slowest), air: 1 } : { land: Infinity, air: 1 },
      passable: slowest > 0 ? { land: true, sea: false, air: true } : { land: false, sea: false, air: true },
      cover: 0,
      blocksSight: false,
    };
    legend[chars[key]] = id;
  }
  const charOf = Object.fromEntries(Object.entries(TERRAIN).map(([key, code]) => [code, chars[key]]));
  const players = [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }];
  const cell = (x, y) => [Math.floor(x / T), Math.floor(y / T)];
  const seed = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  const maps = {};
  for (const sc of WarodDotsGame.scenarios) {
    const { board, units } = WarodDotsGame.createInitialState(players, { ...sc.config, rng: seed(STANDARD_SEED) });
    maps[sc.id] = {
      name: sc.name,
      description: sc.config.scenario ? sc.description : `${sc.description} (the game's generator at seed ${STANDARD_SEED})`,
      board: { topology: 'square', width: board.cols, height: board.rows, rows: board.grid.map(r => r.map(c => charOf[c]).join('')), legend },
      units: units.map(u => ({ type: u.type, seat: players.findIndex(p => p.id === u.owner), at: cell(u.x, u.y) })),
      features: board.cities.map(c => ({
        kind: c.isCapital ? 'capital' : 'city', at: [c.col, c.row],
        ...(c.owner !== 'neutral' ? { seat: players.findIndex(p => p.id === c.owner) } : {}),
      })),
    };
  }
  return {
    terrain: { ...terrain, open: { ...terrain.plains } },
    maps,
    omitted: [
      'real time and pixel positions: a unit stands on the square it was in',
      'speeds per kind of infantry: a square costs what the slower kind pays',
      'water drowning a unit that stays in it, and forest and hills blunting a heavy unit\'s fire: the core has no such terrain effects',
      'gold, recruiting in cities, upkeep, morale and routing',
      'cities and capitals are features only: no capture, and the war is won by elimination',
      'the standard map\'s generator: one world, at a fixed seed',
    ],
  };
}
