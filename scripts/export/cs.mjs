// cs's maps in the core's board format (scripts/export-pack.mjs): planes of
// shapes, each the material the game gives it — walls that stop movement and
// sight, low walls and windows that stop movement only, floor and bombsites. The
// game's drawn-only shapes (bevels, slabs, shadows) and its spawn zones carry no
// rules and are left out; its ovals become 16-sided polygons, the core keeping to
// convex shapes. Each map opens with the players the game deals itself.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { boardShape } from './shapes.js';

const MATERIAL = { wall: 'wall', lowWall: 'low-wall', floor: 'floor', bombsiteA: 'bombsite', bombsiteB: 'bombsite' };

export default async function exportBoards(dir) {
  const { MAPS } = await import(pathToFileURL(path.join(dir, 'map.js')).href);
  const { CsGame } = await import(pathToFileURL(path.join(dir, 'CsGame.js')).href);
  const players = [{ id: 'ct', name: 'Counter-Terrorists' }, { id: 't', name: 'Terrorists' }];
  const maps = {};
  for (const sc of CsGame.scenarios) {
    const id = sc.config.mapId;
    const m = MAPS[id];
    const W = m.width, H = m.height;
    const shapes = [
      // The map's edge is solid.
      { x: 0, y: 0, w: W, h: 1, terrain: 'wall' }, { x: 0, y: H - 1, w: W, h: 1, terrain: 'wall' },
      { x: 0, y: 0, w: 1, h: H, terrain: 'wall' }, { x: W - 1, y: 0, w: 1, h: H, terrain: 'wall' },
      ...m.terrainShapes.filter(s => MATERIAL[s.tile]).map(s => ({ ...boardShape(s), terrain: MATERIAL[s.tile] })),
    ];
    const state = CsGame.createInitialState(players, sc.config);
    const seat = state.gameSpecific.teamPlayerMap;
    const sites = m.terrainShapes.filter(s => s.tile === 'bombsiteA' || s.tile === 'bombsiteB');
    maps[id] = {
      name: sc.name,
      description: `${sc.description}. ${W}×${H}: counter-terrorists against terrorists`,
      board: { topology: 'shapes', width: W, height: H, ground: 'floor', shapes },
      units: state.units.map(u => ({ type: u.type, seat: players.findIndex(p => p.id === seat[u.ownerId]), at: [Math.floor(Number(u.position.x)), Math.floor(Number(u.position.y))] })),
      features: sites.map(s => ({ kind: 'bombsite', name: s.tile === 'bombsiteA' ? 'A' : 'B', at: [Math.floor(s.x + s.w / 2), Math.floor(s.y + s.h / 2)] })),
    };
  }
  return {
    terrain: {
      floor: { name: 'Floor', color: '#c8c0a8', description: 'Open ground.', cost: 1, cover: 0 },
      bombsite: { name: 'Bombsite', color: '#d9b25f', description: 'Where the bomb is planted, in cs.', cost: 1, cover: 0 },
      wall: { name: 'Wall', color: '#2a2d33', description: 'Impassable; blocks sight.', cost: 1, passable: false, blocksSight: true },
      'low-wall': { name: 'Low wall', color: '#8a7a54', description: 'Waist-high cover or a window: blocks movement, not sight.', cost: 1, passable: false, cover: 0 },
    },
    maps,
    omitted: [
      'the bomb, rounds, money and buying: the core has no objectives of cs\'s kind (bombsites are kept as map features); a map opens with the pistols cs starts a match with',
      'smoke, flashbangs and grenades',
      'ovals, drawn as 16-sided polygons',
      'decorative shapes (wall tops, floor slabs) and spawn zones, which carry no rules',
    ],
  };
}
