// Doom's E1M1 in the core's board format (scripts/export-pack.mjs). The level is
// carved out of solid rock: rock is the ground, and the floor shapes lie on top of
// it. Under them, in the order that keeps the game's own rules (map.js: walkable is
// inside a floor shape; sight is clear inside floor or nukage), sit the props that
// line the walls — crates, terminals, columns, barrels, solid like the rock they
// stand in — and then the nukage pools, impassable but see-through. The armour
// platform on the moat is a floor shape, so it lies on the slime and is walked on.
// The pickups are kept as map features.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { boardShape } from './shapes.js';

const solid = { cost: 1, passable: false, blocksSight: true };

const TERRAIN = {
  rock: { name: 'Rock', color: '#3b3632', description: 'Solid rock: impassable, blocks sight.', ...solid },
  floor: { name: 'Floor', color: '#a2916b', description: 'Techbase floor.', cost: 1, cover: 0 },
  metal: { name: 'Metal floor', color: '#6f7b8a', description: 'Raised steel platform.', cost: 1, cover: 0 },
  walkway: { name: 'Walkway', color: '#8f8560', description: 'Grated walkway.', cost: 1, cover: 0 },
  nukage: { name: 'Nukage', color: '#7cae3a', description: 'Toxic slime: impassable, but see-through.', cost: 1, passable: false },
  crate: { name: 'Crate', color: '#7a5a30', description: 'Supply crate: impassable, blocks sight.', ...solid },
  computer: { name: 'Computer bank', color: '#26424c', description: 'Wall terminals: impassable, block sight.', ...solid },
  column: { name: 'Support column', color: '#31363d', description: 'Structural column: impassable, blocks sight.', ...solid },
  barrel: { name: 'Fuel barrel', color: '#8a4a24', description: 'Explosive barrel: impassable, blocks sight.', ...solid },
};

export default async function exportBoards(dir) {
  const { MAP_WIDTH, MAP_HEIGHT, FLOOR_SHAPES, NUKAGE, DECOR_SHAPES } = await import(pathToFileURL(path.join(dir, 'map.js')).href);
  const { DoomGame } = await import(pathToFileURL(path.join(dir, 'DoomGame.js')).href);
  // The props by the name the game gives them (nukage comes from its pools instead).
  const prop = Object.fromEntries(Object.entries(TERRAIN).map(([id, t]) => [t.name, id]));
  const shapes = [
    ...DECOR_SHAPES.filter(s => prop[s.name] && prop[s.name] !== 'nukage').map(s => ({ ...boardShape(s), terrain: prop[s.name] })),
    ...NUKAGE.map(s => ({ ...boardShape(s), terrain: 'nukage' })),
    ...FLOOR_SHAPES.map(s => ({ ...boardShape(s), terrain: s.kind })),
  ];
  const players = [{ id: 'marine', name: 'Marine' }, { id: 'demons', name: 'Demons' }];
  const state = DoomGame.createInitialState(players, {});
  const sc = DoomGame.scenarios[0];
  return {
    terrain: TERRAIN,
    maps: {
      [sc.id]: {
        name: sc.name,
        description: sc.description,
        board: { topology: 'shapes', width: MAP_WIDTH, height: MAP_HEIGHT, ground: 'rock', shapes },
        units: state.units.map(u => ({ type: u.type, seat: players.findIndex(p => p.id === state.gameSpecific.teamPlayerMap[u.ownerId]), at: [Math.floor(Number(u.position.x)), Math.floor(Number(u.position.y))] })),
        features: state.gameSpecific.items.map(it => ({ kind: 'pickup', name: it.type, at: [it.x, it.y] })),
      },
    },
    omitted: [
      'pickups (weapons, ammo, armour, health): kept as map features, but the core has no items',
      'weapons and ammunition: a unit fights with the one weapon its pack reads it as',
      'the armour platform\'s oval, drawn as a 16-sided polygon',
    ],
  };
}
