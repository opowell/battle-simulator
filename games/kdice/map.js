import {
  generateHexRect, carveOrganicShape, clusterIntoTerritories, territoryAdjacency, territoryCapital,
} from '../mapTypes/hexagon.js';

const HEX_SIZE = 1;
const TERRITORIES_PER_PLAYER = 8;
const MIN_TERRITORY_SIZE = 6;

/**
 * Generate a hex-grid map (default ~20x20 hexes) and cluster it into
 * multi-hex territories, K.Dice-style. Returns the territory graph plus the
 * underlying hex layout so KDiceGame.toGrid can render the real hex blobs.
 */
export function generateMap(numPlayers, rng, { cols = 20, rows = 20 } = {}) {
  const rect = generateHexRect(cols, rows);
  // A hard rectangle reads as a spreadsheet, not a map — carve a rounded,
  // uneven coastline (plus a few interior lakes) so the board has real empty
  // space around and within it, like the original board game's tin.
  const { cellIds, cells, adjacency: hexAdjacency } = carveOrganicShape(
    rect.cellIds, rect.cells, rect.adjacency, rng);

  const territoryCount = Math.max(numPlayers * TERRITORIES_PER_PLAYER, numPlayers * 2);
  const { territoryOf, territories } = clusterIntoTerritories(
    cellIds, hexAdjacency, territoryCount, rng, { minSize: MIN_TERRITORY_SIZE });
  const adjacencyList = territoryAdjacency(territories, territoryOf, hexAdjacency);

  const territoryIds = territories.map(t => `t${t.id}`);
  const adjacency = {};
  const hexIdsByTerritory = {};
  const capitalHexByTerritory = {};

  territories.forEach(t => {
    const id = `t${t.id}`;
    adjacency[id] = adjacencyList[t.id].map(idx => `t${idx}`);
    hexIdsByTerritory[id] = t.hexIds;
    capitalHexByTerritory[id] = territoryCapital(t.hexIds, cells, HEX_SIZE, hexAdjacency);
  });

  return {
    territoryIds,
    adjacency,
    hexIdsByTerritory,
    capitalHexByTerritory,
    hexCells: cells,
    hexSize: HEX_SIZE,
    cols,
    rows,
  };
}

/**
 * Return the territory ids in the largest contiguous block owned by ownerId.
 */
export function getLargestConnectedRegion(ownerId, territories, adjacency) {
  const owned = Object.keys(territories).filter(id => territories[id].owner === ownerId);
  if (owned.length === 0) return [];

  const visited = new Set();
  let largest = [];

  for (const start of owned) {
    if (visited.has(start)) continue;
    const region = [];
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
      const cur = queue.shift();
      region.push(cur);
      for (const nid of (adjacency[cur] ?? [])) {
        if (!visited.has(nid) && territories[nid]?.owner === ownerId) {
          visited.add(nid);
          queue.push(nid);
        }
      }
    }
    if (region.length > largest.length) largest = region;
  }

  return largest;
}
