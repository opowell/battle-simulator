// Risk's world map in the core's board format (scripts/export-pack.mjs): 42
// territories as regions, each the blob of hexes the game draws it as, with the
// game's own adjacency list (sea routes included). Risk deals territories at
// random; the exported map opens with North America against Asia.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export default async function exportBoards(dir) {
  const { LAYOUT } = await import(pathToFileURL(path.join(dir, 'RiskLayout.js')).href);
  const { ADJACENCY, TERRITORY_NAMES, CONTINENTS } = await import(pathToFileURL(path.join(dir, 'RiskMap.js')).href);
  const offset = (id) => { const { q, r } = LAYOUT.hexCells[id]; return [q + (r - (r & 1)) / 2, r]; };
  // Hexes of open sea on the drawn map would have negative columns on the shifted
  // rows; move every territory right so all columns are ≥ 0.
  const all = Object.values(LAYOUT.hexIdsByTerritory).flat().map(offset);
  const dx = -Math.min(...all.map(([x]) => x));
  const regions = {};
  for (const [id, hexes] of Object.entries(LAYOUT.hexIdsByTerritory)) {
    const [ax, ay] = offset(LAYOUT.capitalHexByTerritory[id]);
    regions[id] = { name: TERRITORY_NAMES[id] ?? id, terrain: 'territory', anchor: [ax + dx, ay], cells: hexes.map(offset).map(([x, y]) => [x + dx, y]) };
  }
  const continentOf = Object.fromEntries(Object.entries(CONTINENTS).flatMap(([c, v]) => (v.territories ?? v).map(t => [t, c])));
  const pick = (continent, n) => Object.keys(regions).filter(t => continentOf[t] === continent).slice(0, n);
  const types = ['infantry', 'infantry', 'cavalry', 'artillery', 'infantry'];
  const units = [
    ...pick('northAmerica', 5).map((at, i) => ({ type: types[i], seat: 0, at })),
    ...pick('asia', 5).map((at, i) => ({ type: types[i], seat: 1, at })),
  ];
  return {
    terrain: { territory: { name: 'Territory', color: '#c9b98f', description: 'A Risk territory.', cost: 1, cover: 0 } },
    maps: {
      world: {
        name: 'World Domination',
        description: 'The 42 territories of the classic world map, North America against Asia',
        board: { topology: 'regions', layout: 'hex', stacking: 'stack', regions, adjacency: ADJACENCY },
        units,
        features: Object.entries(CONTINENTS).map(([c, v]) => ({ kind: 'continent', name: c, regions: v.territories ?? v })),
      },
    },
    omitted: ['armies, reinforcements and cards: the core fields units, not counts dealt each turn', 'continent bonuses'],
  };
}
