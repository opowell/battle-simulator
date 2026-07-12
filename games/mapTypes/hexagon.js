// Generic hexagon map type: axial-coordinate hex grids, pixel layout, and
// clustering hex cells into contiguous multi-hex "territories". Any game can
// build a hex board on top of this (see games/kdice/map.js for the first user)
// instead of reinventing axial math/adjacency/clustering per game.

const HEX_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];

export function hexId(q, r) {
  return `${q},${r}`;
}

export function hexNeighbors(q, r) {
  return HEX_DIRS.map(([dq, dr]) => [q + dq, r + dr]);
}

// Pointy-top axial → pixel, hex "radius" (center-to-corner) = size.
export function hexToPixel(q, r, size) {
  return {
    x: size * Math.sqrt(3) * (q + r / 2),
    y: size * 1.5 * r,
  };
}

// The 6 corner points of a pointy-top hex centered at (cx, cy).
export function hexCorners(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const ang = (Math.PI / 180) * (60 * i - 30);
    pts.push([cx + size * Math.cos(ang), cy + size * Math.sin(ang)]);
  }
  return pts;
}

/**
 * Generate a roughly rectangular hex grid of cols×rows cells using an
 * even-row offset → axial conversion, plus their axial adjacency.
 * Returns { cellIds, cells: {id: {q, r}}, adjacency: {id: id[]} }.
 */
export function generateHexRect(cols, rows) {
  const cellIds = [];
  const cells = {};
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const q = col - Math.floor(row / 2);
      const r = row;
      const id = hexId(q, r);
      cellIds.push(id);
      cells[id] = { q, r };
    }
  }

  const adjacency = {};
  for (const id of cellIds) {
    const { q, r } = cells[id];
    adjacency[id] = hexNeighbors(q, r)
      .map(([nq, nr]) => hexId(nq, nr))
      .filter(nid => cells[nid]);
  }

  return { cellIds, cells, adjacency };
}

/**
 * Carve an organic (non-rectangular) silhouette out of a hex grid: cells near
 * the edge are randomly dropped via a jittered radial cutoff — a rounded,
 * uneven coastline instead of a hard rectangle — and a handful of small
 * interior "lakes" are punched out too, so the map isn't a solid filled
 * block. Always returns a single connected region (keeps only the largest
 * connected component after carving), so territory growth never has to deal
 * with an unreachable pocket left over from the carving.
 * Returns { cellIds, cells, adjacency } in the same shape as generateHexRect.
 */
export function carveOrganicShape(cellIds, cells, adjacency, rng, opts = {}) {
  const { edgeJitter = 0.22, lakeCount = 4, lakeRadius = 1.6 } = opts;

  let minQ = Infinity, maxQ = -Infinity, minR = Infinity, maxR = -Infinity;
  for (const id of cellIds) {
    const { q, r } = cells[id];
    minQ = Math.min(minQ, q); maxQ = Math.max(maxQ, q);
    minR = Math.min(minR, r); maxR = Math.max(maxR, r);
  }
  const cx = (minQ + maxQ) / 2, cy = (minR + maxR) / 2;
  const rx = (maxQ - minQ) / 2 || 1, ry = (maxR - minR) / 2 || 1;

  const keep = new Set(cellIds);

  // Jittered radial cutoff for a rounded, uneven coastline instead of a hard
  // rectangle — each cell's own random jitter nudges the effective radius in
  // or out, so the dropped edge is ragged rather than a perfect ellipse.
  for (const id of cellIds) {
    const { q, r } = cells[id];
    const nx = (q - cx) / rx, ny = (r - cy) / ry;
    const dist = Math.sqrt(nx * nx + ny * ny);
    const jitter = 1 + (rng() - 0.5) * edgeJitter * 2;
    if (dist > jitter) keep.delete(id);
  }

  // A handful of small interior lakes/gaps.
  for (let i = 0; i < lakeCount; i++) {
    const centerId = cellIds[Math.floor(rng() * cellIds.length)];
    const { q: lq, r: lr } = cells[centerId];
    const centerPx = hexToPixel(lq, lr, 1);
    const radius = lakeRadius * (0.5 + rng() * 0.5);
    for (const id of cellIds) {
      const { q, r } = cells[id];
      const p = hexToPixel(q, r, 1);
      if (Math.hypot(p.x - centerPx.x, p.y - centerPx.y) < radius) keep.delete(id);
    }
  }

  // Keep only the largest connected component.
  const visited = new Set();
  let largest = [];
  for (const start of keep) {
    if (visited.has(start)) continue;
    const region = [];
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
      const cur = queue.shift();
      region.push(cur);
      for (const nid of (adjacency[cur] ?? [])) {
        if (keep.has(nid) && !visited.has(nid)) { visited.add(nid); queue.push(nid); }
      }
    }
    if (region.length > largest.length) largest = region;
  }

  const finalCells = {};
  for (const id of largest) finalCells[id] = cells[id];
  const idSet = new Set(largest);
  const finalAdjacency = {};
  for (const id of largest) finalAdjacency[id] = (adjacency[id] ?? []).filter(nid => idSet.has(nid));

  return { cellIds: largest, cells: finalCells, adjacency: finalAdjacency };
}

/**
 * Compute the pixel-space bounding box + centered coordinates for a set of
 * hex cells, so callers can size a world/viewport around them.
 */
export function hexLayoutBounds(cellIds, cells, size) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const pixels = {};
  for (const id of cellIds) {
    const { q, r } = cells[id];
    const p = hexToPixel(q, r, size);
    pixels[id] = p;
    minX = Math.min(minX, p.x - size);
    maxX = Math.max(maxX, p.x + size);
    minY = Math.min(minY, p.y - size);
    maxY = Math.max(maxY, p.y + size);
  }
  return { pixels, minX, minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Partition hex cells into `territoryCount` contiguous, roughly-similar-sized
 * blobs via randomized simultaneous multi-source BFS (a Voronoi-like growth
 * from random seed cells) — the standard technique for organic-looking
 * territory maps (Risk-style/K.Dice-style) on a regular grid. Any blob that
 * ends up smaller than `minSize` (a sliver the growth left stranded) is
 * merged into its smallest adjacent neighbor, repeated until every surviving
 * territory clears the floor.
 *
 * Returns { territoryOf: {hexId: territoryIdx}, territories: [{id, hexIds}] }.
 */
export function clusterIntoTerritories(cellIds, adjacency, territoryCount, rng, { minSize = 1 } = {}) {
  const n = Math.min(territoryCount, cellIds.length);
  const shuffled = [...cellIds].sort(() => rng() - 0.5);
  const seeds = shuffled.slice(0, n);

  const territoryOf = {};
  const bucket = seeds.map(() => []);

  let frontier = seeds.map((id, idx) => ({ id, idx }));
  seeds.forEach((id, idx) => { territoryOf[id] = idx; bucket[idx].push(id); });

  while (frontier.length > 0) {
    // Shuffle the frontier each round so no single territory's growth order
    // systematically races ahead of the others (keeps blob sizes balanced).
    frontier.sort(() => rng() - 0.5);
    const next = [];
    for (const { id, idx } of frontier) {
      for (const nid of (adjacency[id] ?? [])) {
        if (territoryOf[nid] != null) continue;
        territoryOf[nid] = idx;
        bucket[idx].push(nid);
        next.push({ id: nid, idx });
      }
    }
    frontier = next;
  }

  // Fold undersized blobs into a neighbor (the smallest one bordering them,
  // to keep sizes balanced) — may cascade, so keep sweeping until stable.
  let changed = true;
  while (changed) {
    changed = false;
    for (let idx = 0; idx < bucket.length; idx++) {
      if (bucket[idx].length === 0 || bucket[idx].length >= minSize) continue;
      const neighborSizes = new Map();
      for (const hid of bucket[idx]) {
        for (const nid of (adjacency[hid] ?? [])) {
          const nIdx = territoryOf[nid];
          if (nIdx != null && nIdx !== idx) neighborSizes.set(nIdx, bucket[nIdx].length);
        }
      }
      if (neighborSizes.size === 0) continue; // isolated on a fully-partitioned grid — shouldn't happen
      let target = null, targetSize = Infinity;
      for (const [nIdx, size] of neighborSizes) if (size < targetSize) { target = nIdx; targetSize = size; }
      for (const hid of bucket[idx]) { territoryOf[hid] = target; bucket[target].push(hid); }
      bucket[idx] = [];
      changed = true;
    }
  }

  // Reindex to drop emptied territories and keep ids dense/sequential.
  const survivingIdx = [];
  bucket.forEach((hexIds, idx) => { if (hexIds.length > 0) survivingIdx.push(idx); });
  const remap = new Map(survivingIdx.map((oldIdx, newIdx) => [oldIdx, newIdx]));
  for (const id of Object.keys(territoryOf)) territoryOf[id] = remap.get(territoryOf[id]);
  const territories = survivingIdx.map((oldIdx, newIdx) => ({ id: newIdx, hexIds: bucket[oldIdx] }));

  return { territoryOf, territories };
}

/**
 * Derive territory-level adjacency from hex-cell adjacency: two territories
 * are adjacent iff any of their hexes are hex-neighbors.
 */
export function territoryAdjacency(territories, territoryOf, adjacency) {
  const adj = territories.map(() => new Set());
  for (const t of territories) {
    for (const hid of t.hexIds) {
      for (const nid of (adjacency[hid] ?? [])) {
        const otherIdx = territoryOf[nid];
        if (otherIdx != null && otherIdx !== t.id) adj[t.id].add(otherIdx);
      }
    }
  }
  return adj.map(s => [...s]);
}

// Direction index (matching HEX_DIRS' order) → which pair of adjacent hex
// corners (see hexCorners) that direction's edge sits between. Derived once
// from the pixel angle each direction points at (multiples of 60°), rather
// than hand-mapped, so it stays correct if HEX_DIRS' ordering ever changes.
const EDGE_FOR_DIR = HEX_DIRS.map(([dq, dr]) => {
  const p = hexToPixel(dq, dr, 1);
  const angle = ((Math.atan2(p.y, p.x) * 180) / Math.PI + 360) % 360;
  return Math.round(angle / 60) % 6;
});

/**
 * Trace the outer boundary of every territory as a flat, DEDUPED list of edge
 * segments — only the edges that face a different territory (or the edge of
 * the map) — so a renderer can draw one clean outline around each multi-hex
 * blob instead of stroking every individual hex.
 *
 * Each physical edge sits between exactly two hexes, so without dedup both
 * sides would independently emit their own copy of the same geometric
 * segment; whichever copy painted last would silently win the pixel,
 * making a "this territory is selected" recolor look randomly incomplete
 * wherever the loser was the selected side. Emitting it once, tagged with
 * BOTH bordering territory ids (`b` is null at the map's outer edge), lets a
 * renderer color a shared edge correctly regardless of which side asks.
 *
 * Returns segment[] of { p1: [x,y], p2: [x,y], a: territoryId, b: territoryId|null }.
 */
export function territoryBorders(hexIds, territoryOf, cells, size) {
  const segments = [];
  const seenEdges = new Set();
  for (const id of hexIds) {
    const tId = territoryOf[id];
    if (tId == null) continue;
    const { q, r } = cells[id];
    const center = hexToPixel(q, r, size);
    const corners = hexCorners(center.x, center.y, size);
    const neighbors = hexNeighbors(q, r).map(([nq, nr]) => hexId(nq, nr));
    neighbors.forEach((nid, i) => {
      const otherT = territoryOf[nid] ?? null;
      if (otherT === tId) return; // interior edge — shared with our own territory
      // Canonical key for this physical edge: the unordered hex-id pair (map-edge
      // segments have no "other side" hex to collide with, so they're inherently
      // unique — key them by their own hex + direction instead).
      const key = cells[nid] ? [id, nid].sort().join('|') : `${id}|void|${i}`;
      if (seenEdges.has(key)) return;
      seenEdges.add(key);
      const edgeIdx = EDGE_FOR_DIR[i];
      segments.push({ p1: corners[edgeIdx], p2: corners[(edgeIdx + 1) % 6], a: tId, b: otherT });
    });
  }
  return segments;
}

/**
 * Pick a good "capital" cell to anchor a label/marker for the whole blob —
 * the hex with the most hex-steps to the nearest cell outside the territory
 * (BFS distance-to-boundary), not just the one nearest the centroid. Blobs
 * left by clusterIntoTerritories' merge step are often concave/irregular, so
 * the centroid-closest hex can land in a thin inlet bordered by a *different*
 * territory on most sides — a marker there visually crowds the neighbor's
 * colour. The deepest-interior hex is always fully (or as close to fully as
 * the blob allows) surrounded by its own territory's hexes instead.
 */
export function territoryCapital(hexIds, cells, size, adjacency) {
  const hexSet = new Set(hexIds);
  const dist = {};
  const queue = [];
  for (const id of hexIds) {
    const isBoundary = (adjacency?.[id] ?? []).some(nid => !hexSet.has(nid));
    if (isBoundary) { dist[id] = 0; queue.push(id); }
  }
  // Every hex is on the boundary (a sliver with no interior) — any hex works.
  if (queue.length === 0) return hexIds[0];

  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi++];
    for (const nid of (adjacency[cur] ?? [])) {
      if (hexSet.has(nid) && dist[nid] == null) { dist[nid] = dist[cur] + 1; queue.push(nid); }
    }
  }

  let best = hexIds[0], bestD = -1;
  for (const id of hexIds) {
    const d = dist[id] ?? 0;
    if (d > bestD) { bestD = d; best = id; }
  }
  return best;
}
