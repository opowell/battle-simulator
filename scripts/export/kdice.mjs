// KDice's maps in the core's board format (scripts/export-pack.mjs). KDice has no
// fixed map: every game grows a new one (map.js, which stays with the game). These
// are a few of them, dealt by the game itself from fixed seeds: for two, for four,
// and for the seven of a KDice table. Each territory is a region, the blob of hexes
// it was grown as, beside the territories it touches; its dice are one counted
// group (`stacking: 'count'`), a member a die.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** A seeded rng (mulberry32), so an exported map is the same every export. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEALS = [
  { id: 'two', seats: 2, seed: 1, name: 'Two players' },
  { id: 'four', seats: 4, seed: 2, name: 'Four players' },
  { id: 'seven', seats: 7, seed: 3, name: 'A table of seven' },
];

export default async function exportBoards(dir) {
  const { KDiceGame } = await import(pathToFileURL(path.join(dir, 'KDiceGame.js')).href);
  const maps = {};
  for (const deal of DEALS) {
    const players = Array.from({ length: deal.seats }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));
    const { board } = KDiceGame.createInitialState(players, { rng: seeded(deal.seed) });
    // Axial hexes (q, r) to the odd-row-shifted columns the core lays regions out on.
    const offset = (hex) => { const { q, r } = board.hexCells[hex]; return [q + (r - (r & 1)) / 2, r]; };
    const regions = Object.fromEntries(Object.entries(board.hexIdsByTerritory).map(([id, hexes]) => (
      [id, { name: `Territory ${id.slice(1)}`, terrain: 'land', anchor: offset(board.capitalHexByTerritory[id]), cells: hexes.map(offset) }])));
    maps[deal.id] = {
      name: deal.name,
      description: `A grown KDice map of ${Object.keys(regions).length} territories, dealt for ${deal.seats} (seed ${deal.seed})`,
      board: { topology: 'regions', layout: 'hex', stacking: 'count', regions, adjacency: board.adjacency },
      units: Object.values(board.territories).map(t => ({ type: 'die', seat: players.findIndex(p => p.id === t.owner), at: t.id, count: t.dice })),
    };
  }
  return {
    terrain: { land: { name: 'Land', color: '#c9c2a0', description: 'A KDice territory.', cost: 1, cover: 0 } },
    maps,
    omitted: [
      'the map generator: these are a few of its maps, from fixed seeds',
      'the dice: a die strikes the core\'s deterministic blow, once per member',
      'the eight-dice cap, the reserve and the dice earned for the largest connected group',
    ],
  };
}
