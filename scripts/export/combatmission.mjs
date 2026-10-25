// Combat Mission's maps in the core's board format (scripts/export-pack.mjs). The
// three hedgerow maps are planes of shapes over open ground, each shape the terrain
// its kind is (map.js's CM_SHAPE_STYLES), later ones on top as the game lays them;
// Ambush, the original hand-laid grid, is a square board. Each kind plays by the
// rule of the tile it rasterizes to: buildings stop movement and sight, water stops
// movement only, woods block sight and hedgerows and stone walls don't, both
// costing double and giving cover (the game's -20% and -30% to be hit). The map's
// edge is solid.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { boardShape } from './shapes.js';

export default async function exportBoards(dir) {
  const { TERRAIN: T, CM_SHAPE_STYLES, CM_SHAPE_GROUND, createMap } = await import(pathToFileURL(path.join(dir, 'map.js')).href);
  const { SHAPE_SCENARIOS } = await import(pathToFileURL(path.join(dir, 'scenarios.js')).href);
  const { CombatMissionGame } = await import(pathToFileURL(path.join(dir, 'CombatMissionGame.js')).href);
  // The rule of each tile (map.js: isPassable, blocksLOS, getCoverBonus, getMoveCost).
  const RULE = {
    [T.FLOOR]: { cost: 1, cover: 0 },
    [T.WALL]: { cost: 1, passable: false, blocksSight: true },
    [T.HEDGE]: { cost: 2, cover: 30 },
    [T.TREE]: { cost: 2, cover: 20, blocksSight: true },
    [T.ROAD]: { cost: 1, cover: 0 },
    [T.WATER]: { cost: 1, passable: false },
  };
  const terrain = {
    open: { name: 'Open ground', color: CM_SHAPE_GROUND, description: 'Open ground.', ...RULE[T.FLOOR] },
    border: { name: 'Map edge', color: '#3a3a30', description: 'The edge of the map: impassable, blocks sight.', ...RULE[T.WALL] },
  };
  const kindOf = (kind) => {
    const id = CM_SHAPE_STYLES[kind] ? kind : 'building';
    const style = CM_SHAPE_STYLES[id];
    terrain[id] ??= { name: style.name, color: style.render.fill, description: style.description, ...RULE[style.tile] };
    return id;
  };
  const players = [{ id: 'allied', name: 'Allies' }, { id: 'axis', name: 'Axis' }];
  const unitsOf = (config) => CombatMissionGame.createInitialState(players, config).units
    .map(u => ({ type: u.type, seat: players.findIndex(p => p.id === u.ownerId), at: [Math.floor(Number(u.position.x)), Math.floor(Number(u.position.y))] }));

  const maps = {};
  for (const sc of CombatMissionGame.scenarios) {
    const id = sc.config.scenario ?? 'bocage';
    if (id === 'ambush') continue;
    const m = SHAPE_SCENARIOS[id];
    const W = m.width, H = m.height;
    maps[sc.id] = {
      name: sc.name,
      description: sc.description,
      board: {
        topology: 'shapes', width: W, height: H, ground: 'open',
        shapes: [
          { x: 0, y: 0, w: W, h: 1, terrain: 'border' }, { x: 0, y: H - 1, w: W, h: 1, terrain: 'border' },
          { x: 0, y: 0, w: 1, h: H, terrain: 'border' }, { x: W - 1, y: 0, w: 1, h: H, terrain: 'border' },
          ...m.terrain.map(s => ({ ...boardShape(s), terrain: kindOf(s.kind) })),
        ],
      },
      units: unitsOf(sc.config),
    };
  }

  // Ambush: the hand-laid grid, its edge told apart from its buildings.
  const ambush = CombatMissionGame.scenarios.find(sc => sc.config.scenario === 'ambush');
  const board = createMap();
  const legend = { '.': 'open', B: 'border', '#': kindOf('building'), w: kindOf('hedge'), T: kindOf('woods'), r: kindOf('road'), '~': kindOf('water') };
  const edge = (x, y) => x === 0 || y === 0 || x === board.width - 1 || y === board.height - 1;
  maps[ambush.id] = {
    name: ambush.name,
    description: ambush.description,
    board: { topology: 'square', width: board.width, height: board.height, rows: board.tiles.map((r, y) => r.map((t, x) => (edge(x, y) ? 'B' : t)).join('')), legend },
    units: unitsOf(ambush.config),
  };

  return {
    terrain,
    maps,
    omitted: [
      'suppression, area fire, hit chances and armour facing: the core\'s strikes are deterministic',
      'line of sight is a Bresenham line over the squares in Combat Mission; here it is the exact segment between square centres, and the two disagree on 4–12% of pairs of squares',
      'the art (fields, roofs, tree crowns) the game draws over its shapes: a map here is its terrain\'s flat colours',
    ],
  };
}
