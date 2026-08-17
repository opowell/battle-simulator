import {
  generateHexRect, growTerritories, territoryAdjacency, territoryCapital,
} from '../mapTypes/hexagon.js';

const HEX_SIZE = 1;
const TERRITORIES_PER_PLAYER = 8;
const GROW_TO = 8;            // cells grown per territory before it annexes its frontier
const MIN_TERRITORY_SIZE = 6;
// How much grid each territory gets to grow into. The land only ever uses a
// fraction of the canvas (see growTerritories) and that unused sea is the
// point: wherever the landmass does reach the edge of the grid it gets a
// ruler-straight coastline, the exact thing this map generator exists to
// avoid, so the canvas is sized at roughly 2.5x the land it will hold to keep
// that from happening often.
const CELLS_PER_TERRITORY = 52;
// Grid columns per row, chosen so the finished map is wider than it is tall:
// a hex column step is sqrt(3) wide against a row step of 1.5 (hexToPixel), so
// this is a ~1.5:1 landscape board, which is the shape the battlefield view is.
const GRID_ASPECT = 1.3;

/**
 * Generate a K.Dice map: territories grown onto a hex grid by accretion, so the
 * landmass is a ragged amoeba surrounded (and pocked) by sea rather than a
 * filled rectangle — see games/mapTypes/hexagon.js growTerritories. Returns the
 * territory graph plus the underlying hex layout so KDiceGame.toGrid can render
 * the real hex blobs.
 */
export function generateMap(numPlayers, rng, opts = {}) {
  const territoryCount = Math.max(numPlayers * TERRITORIES_PER_PLAYER, numPlayers * 2);
  const rows = opts.rows ?? Math.round(Math.sqrt(territoryCount * CELLS_PER_TERRITORY / GRID_ASPECT));
  const cols = opts.cols ?? Math.round(rows * GRID_ASPECT);

  const rect = generateHexRect(cols, rows);
  const { territoryOf, territories } = growTerritories(
    rect.cellIds, rect.cells, rect.adjacency, territoryCount, rng,
    { size: GROW_TO, minSize: MIN_TERRITORY_SIZE });

  // Only the cells that ended up as land are part of the map; the rest of the
  // grid is sea and must not reach the renderer (or it would draw as a hex).
  const cellIds = Object.keys(territoryOf);
  const cells = {};
  for (const id of cellIds) cells[id] = rect.cells[id];
  const hexAdjacency = {};
  for (const id of cellIds) hexAdjacency[id] = rect.adjacency[id].filter(nid => territoryOf[nid] != null);

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
