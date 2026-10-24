// cs's maps in the core's board format (scripts/export-pack.mjs): planes of
// shapes, each the material the game gives it — walls that stop movement and
// sight, low walls and windows that stop movement only, floor and bombsites. The
// game's drawn-only shapes (bevels, slabs, shadows) carry no rules and are left
// out; its ovals become 16-sided polygons, the core keeping to convex shapes.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MATERIAL = { wall: 'wall', lowWall: 'low-wall', floor: 'floor', bombsiteA: 'bombsite', bombsiteB: 'bombsite' };

function polygon(s) {
  if ((s.shape ?? 'rect') !== 'oval') {
    return s.shape === 'poly' ? { points: s.points.map(p => ({ x: p.x, y: p.y })) } : { x: s.x, y: s.y, w: s.w, h: s.h };
  }
  const rx = s.w / 2, ry = s.h / 2, cx = s.x + rx, cy = s.y + ry;
  return { points: Array.from({ length: 16 }, (_, i) => ({ x: cx + rx * Math.cos((i * Math.PI) / 8), y: cy + ry * Math.sin((i * Math.PI) / 8) })) };
}

export default async function exportBoards(dir) {
  const { MAPS } = await import(pathToFileURL(path.join(dir, 'map.js')).href);
  const maps = {};
  const loadout = ['rifle', 'smg', 'pistol', 'shotgun', 'sniper'];
  for (const [id, m] of Object.entries(MAPS)) {
    const W = m.width, H = m.height;
    const shapes = [
      // The map's edge is solid.
      { x: 0, y: 0, w: W, h: 1, terrain: 'wall' }, { x: 0, y: H - 1, w: W, h: 1, terrain: 'wall' },
      { x: 0, y: 0, w: 1, h: H, terrain: 'wall' }, { x: W - 1, y: 0, w: 1, h: H, terrain: 'wall' },
      ...m.terrainShapes.filter(s => MATERIAL[s.tile]).map(s => ({ ...polygon(s), terrain: MATERIAL[s.tile] })),
    ];
    const spawn = (list, seat) => list.slice(0, loadout.length).map((p, i) => ({ type: loadout[i], seat, at: [Math.floor(p.x), Math.floor(p.y)] }));
    const sites = m.terrainShapes.filter(s => s.tile === 'bombsiteA' || s.tile === 'bombsiteB');
    maps[id] = {
      name: id,
      description: `cs's ${id}, ${W}×${H}: counter-terrorists against terrorists`,
      board: { topology: 'shapes', width: W, height: H, ground: 'floor', shapes },
      units: [...spawn(m.ctSpawns, 0), ...spawn(m.tSpawns, 1)],
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
      'the bomb, rounds, money and buying: the core has no objectives of cs\'s kind (bombsites are kept as map features)',
      'ovals, drawn as 16-sided polygons',
      'decorative shapes (wall tops, floor slabs) that carry no rules',
    ],
  };
}
