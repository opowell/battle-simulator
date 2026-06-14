// Hex grid using axial coordinates (q, r).
// Six neighbors per hex: the 3 axial directions and their opposites.
const HEX_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];

function hexId(q, r) {
  return `${q},${r}`;
}

/**
 * Generate a parallelogram hex grid of cols×rows cells.
 * Returns { territoryIds, adjacency } where adjacency maps id → id[].
 */
export function generateMap(numPlayers, _rng) {
  const total = Math.max(16, numPlayers * 8);
  const cols = Math.ceil(Math.sqrt(total));
  const rows = Math.ceil(total / cols);

  const territoryIds = [];
  for (let q = 0; q < cols; q++) {
    for (let r = 0; r < rows; r++) {
      territoryIds.push(hexId(q, r));
    }
  }

  const adjacency = {};
  for (const id of territoryIds) {
    const [q, r] = id.split(',').map(Number);
    adjacency[id] = [];
    for (const [dq, dr] of HEX_DIRS) {
      const nq = q + dq, nr = r + dr;
      if (nq >= 0 && nq < cols && nr >= 0 && nr < rows) {
        adjacency[id].push(hexId(nq, nr));
      }
    }
  }

  return { territoryIds, adjacency, cols, rows };
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
