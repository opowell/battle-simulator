// surviv's maps in the core's board format (scripts/export-pack.mjs): grass, with
// the game's shapes on it in the order it lays them (a later one on top, as in
// map.js's isWalkableContinuous). Forest, water, buildings, crates and barrels stop
// movement and sight; a bush is walked through and hides whoever stands in it from
// anyone farther than the game's spotting range; the spawns are grass. The map's
// edge is solid, and the loot lying about is kept as map features.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { boardShape } from './shapes.js';

export default async function exportBoards(dir) {
  const { MAPS, SURVIV_SHAPE_FLOOR } = await import(pathToFileURL(path.join(dir, 'map.js')).href);
  const { BUSH_SPOT_RANGE } = await import(pathToFileURL(path.join(dir, 'weapons.js')).href);
  const { SurvivGame } = await import(pathToFileURL(path.join(dir, 'SurvivGame.js')).href);
  const solid = (name, color, description) => ({ name, color, description, cost: 1, passable: false, blocksSight: true });
  const terrain = {
    grass: { name: 'Grass', color: SURVIV_SHAPE_FLOOR, description: 'Open ground.', cost: 1, cover: 0 },
    edge: { name: 'Edge', color: '#24402a', description: 'The edge of the map: impassable.', cost: 1, passable: false },
    forest: solid('Forest', '#2c5f3a', 'Dense trees: impassable, blocks sight.'),
    water: solid('Water', '#2f7fae', 'Impassable, blocks sight.'),
    building: solid('Building', '#7a6a55', 'Impassable, blocks sight.'),
    crate: solid('Crates', '#8a6a3f', 'Hard cover: impassable, blocks sight (breakable in surviv).'),
    barrel: solid('Barrel', '#a44a3a', 'Hard cover: impassable, blocks sight (breakable in surviv).'),
    bush: { name: 'Bush', color: '#3c7a44', description: 'Walkable; hides anyone in it from enemies beyond spotting range.', cost: 1, cover: 0, concealment: BUSH_SPOT_RANGE },
    'red-spawn': { name: 'Red spawn', color: '#a0705a', description: 'Red team\'s starting area.', cost: 1, cover: 0 },
    'blue-spawn': { name: 'Blue spawn', color: '#5a7fa0', description: 'Blue team\'s starting area.', cost: 1, cover: 0 },
  };
  const KIND = { redSpawn: 'red-spawn', blueSpawn: 'blue-spawn' };
  const players = [{ id: 'blue', name: 'Blue' }, { id: 'red', name: 'Red' }];
  const maps = {};
  for (const sc of SurvivGame.scenarios) {
    const m = MAPS[sc.config.mapId];
    const W = m.width, H = m.height;
    const state = SurvivGame.createInitialState(players, sc.config);
    const seat = state.gameSpecific.teamPlayerMap;
    maps[sc.id] = {
      name: sc.name,
      description: sc.description,
      board: {
        topology: 'shapes', width: W, height: H, ground: 'grass',
        shapes: [
          { x: 0, y: 0, w: W, h: 1, terrain: 'edge' }, { x: 0, y: H - 1, w: W, h: 1, terrain: 'edge' },
          { x: 0, y: 0, w: 1, h: H, terrain: 'edge' }, { x: W - 1, y: 0, w: 1, h: H, terrain: 'edge' },
          ...m.terrainShapes.map(s => ({ ...boardShape(s), terrain: KIND[s.kind] ?? s.kind })),
        ],
      },
      units: state.units.map(u => ({ type: u.type, seat: players.findIndex(p => p.id === seat[u.ownerId]), at: [Math.floor(Number(u.position.x)), Math.floor(Number(u.position.y))] })),
      features: state.gameSpecific.loot.map(l => ({ kind: 'loot', name: l.name, at: [Math.floor(l.x), Math.floor(l.y)] })),
    };
  }
  return {
    terrain,
    maps,
    omitted: [
      'loot (weapons, grenades, vests, helmets): kept as map features, but the core has no items; every player starts with fists, as in surviv',
      'crates and barrels break in surviv: here they stand for good',
      'ovals (trees, ponds, barrels, bushes), drawn as 16-sided polygons',
      'where a bush overlaps a forest\'s rim it is walked and seen through here; surviv lets the forest block sight there',
    ],
  };
}
