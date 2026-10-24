// Axis & Allies' 1942 map in the core's board format (scripts/export-pack.mjs):
// its 20 land territories and 6 sea zones as regions, each the box (land) or oval
// (sea) the game draws it as, rasterised onto square layout cells, beside the
// game's own adjacency list. Sea zones take only ships and planes, land only
// armies and planes. The pieces are counts (`stacking: 'count'`): each side's
// pieces of one type in one territory are one group, as on the real board.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Layout cells per unit of the game's 16×8 map.
const CELLS = 5;

export default async function exportBoards(dir) {
  const { AxisAlliesGame, TERRITORY_LAYOUT, MAP_WIDTH, MAP_HEIGHT } = await import(pathToFileURL(path.join(dir, 'AxisAlliesGame.js')).href);
  const { TERRITORIES, ADJACENCY, CAPITALS } = await import(pathToFileURL(path.join(dir, 'territories.js')).href);
  const name = (id) => id.replace(/^sz-/, '').split('-').map(w => (w === 'usa' || w === 'uk' ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ');
  const regions = {};
  for (const [id, box] of Object.entries(TERRITORY_LAYOUT)) {
    const t = TERRITORIES[id];
    const cells = [];
    for (let y = 0; y < MAP_HEIGHT * CELLS; y++) {
      for (let x = 0; x < MAP_WIDTH * CELLS; x++) {
        // A cell is the territory's when its centre is in the box, or in the oval
        // inscribed in it for a sea zone.
        const px = (x + 0.5) / CELLS, py = (y + 0.5) / CELLS;
        const ux = (px - box.x) / box.w, uy = (py - box.y) / box.h;
        const inside = t.isLand ? ux >= 0 && ux < 1 && uy >= 0 && uy < 1 : (ux - 0.5) ** 2 + (uy - 0.5) ** 2 < 0.25;
        if (inside) cells.push([x, y]);
      }
    }
    regions[id] = { name: t.isLand ? name(id) : `${name(id)} (sea zone)`, terrain: t.isLand ? (t.factory ? 'industrial' : 'land') : 'sea', cells };
  }

  const players = [{ id: 'allies', name: 'Allies' }, { id: 'axis', name: 'Axis' }];
  const { units } = AxisAlliesGame.createInitialState(players, {});
  const groups = new Map();
  for (const u of units) {
    const key = `${u.ownerId}|${u.type}|${u.territory}`;
    const g = groups.get(key) ?? { type: u.type, seat: players.findIndex(p => p.id === u.ownerId), at: u.territory, count: 0 };
    g.count++;
    groups.set(key, g);
  }
  const land = { cost: { land: 1, sea: Infinity, air: 1 }, passable: { land: true, sea: false, air: true }, cover: 0 };
  return {
    terrain: {
      land: { name: 'Land', color: '#6b6b63', description: 'A land territory: armies and planes.', ...land },
      industrial: { name: 'Industrial land', color: '#7d7a6a', description: 'A land territory with an industrial complex (in the game, where new units are placed).', ...land },
      sea: { name: 'Sea zone', color: '#234e6e', description: 'A sea zone: ships and planes.', cost: { land: Infinity, sea: 1, air: 1 }, passable: { land: false, sea: true, air: true }, cover: 0 },
    },
    maps: {
      'wwii-1942': {
        name: 'WWII 1942',
        description: 'The 1942 setup: the Allies against the Axis, every piece where the game opens with it',
        board: { topology: 'regions', layout: 'square', stacking: 'count', regions, adjacency: ADJACENCY },
        units: [...groups.values()],
        features: [
          ...Object.entries(CAPITALS).map(([side, at]) => ({ kind: 'capital', name: `${name(side)} capital`, seat: players.findIndex(p => p.id === side), regions: [at] })),
          ...Object.entries(TERRITORIES).filter(([, t]) => t.ipc).map(([id, t]) => ({ kind: 'income', name: `${t.ipc} IPC`, value: t.ipc, regions: [id] })),
        ],
      },
    },
    omitted: [
      'territory ownership, income (IPCs), purchases and placement at industrial complexes: the core has no economy (income is listed as features)',
      'capturing the enemy capital to win (listed as features)',
      'transports and carriers carrying units, amphibious assaults, submarine and bombing rules',
      'the dice: a unit strikes the core\'s deterministic blow, once per member',
      'combat and non-combat moves as separate phases',
    ],
  };
}
