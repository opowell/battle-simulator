// Risk's world map in the core's board format (scripts/export-pack.mjs): 42
// territories as regions, each the blob of hexes the game draws it as, with the
// game's own adjacency list (sea routes included), and each continent a terrain
// of its own colour. Armies are counts (`stacking: 'count'`): a territory's
// armies are one group of infantry, as many members as it has armies. Risk deals
// territories at random; the exported map is the game's own deal for two, from a
// fixed seed.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** A seeded rng (mulberry32), so the exported deal is the same every export. */
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

export default async function exportBoards(dir) {
  const { LAYOUT } = await import(pathToFileURL(path.join(dir, 'RiskLayout.js')).href);
  const { ADJACENCY, TERRITORY_NAMES, CONTINENTS } = await import(pathToFileURL(path.join(dir, 'RiskMap.js')).href);
  const { RiskGame } = await import(pathToFileURL(path.join(dir, 'RiskGame.js')).href);
  const offset = (id) => { const { q, r } = LAYOUT.hexCells[id]; return [q + (r - (r & 1)) / 2, r]; };
  // Hexes of open sea on the drawn map would have negative columns on the shifted
  // rows; move every territory right so all columns are ≥ 0.
  const all = Object.values(LAYOUT.hexIdsByTerritory).flat().map(offset);
  const dx = -Math.min(...all.map(([x]) => x));
  const continentOf = Object.fromEntries(Object.entries(CONTINENTS).flatMap(([c, v]) => v.territories.map(t => [t, c])));
  const regions = {};
  for (const [id, hexes] of Object.entries(LAYOUT.hexIdsByTerritory)) {
    const [ax, ay] = offset(LAYOUT.capitalHexByTerritory[id]);
    regions[id] = { name: TERRITORY_NAMES[id] ?? id, terrain: continentOf[id], anchor: [ax + dx, ay], cells: hexes.map(offset).map(([x, y]) => [x + dx, y]) };
  }
  const terrain = Object.fromEntries(Object.entries(CONTINENTS).map(([c, v]) => [c, {
    name: v.name, color: v.color, cost: 1, cover: 0,
    description: `A territory of ${v.name} (holding all of it is worth ${v.bonus} armies a turn in Risk).`,
  }]));

  const players = [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }];
  const { board } = RiskGame.createInitialState(players, { rng: seeded(1) });
  const units = Object.values(board.territories).map(t => ({ type: 'infantry', seat: players.findIndex(p => p.id === t.owner), at: t.id, count: t.armies }));
  return {
    terrain,
    maps: {
      world: {
        name: 'World Domination',
        description: 'The 42 territories of the classic world map, dealt for two with 40 armies each',
        board: { topology: 'regions', layout: 'hex', stacking: 'count', regions, adjacency: ADJACENCY },
        units,
        features: Object.entries(CONTINENTS).map(([c, v]) => ({ kind: 'continent', name: v.name, bonus: v.bonus, regions: v.territories })),
      },
    },
    omitted: [
      'reinforcements and cards: the core has no armies dealt each turn',
      'continent bonuses (listed as features, not played)',
      'the dice: an army strikes the core\'s deterministic blow, once per member',
      'the full table of six: the map is dealt for two',
    ],
  };
}
