// Generic hexagon map type: axial-coordinate hex grids, pixel layout, and
// growing contiguous multi-hex "territories" onto them. Any game can build a
// hex board on top of this (see games/kdice/map.js for the first user) instead
// of reinventing axial math/adjacency/map generation per game.

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
 * Grow `territoryCount` territories onto an empty hex grid by accretion, the
 * way DICEWARS (the game K.Dice is a clone of) builds its maps. This is NOT a
 * partition: the grid is a canvas, not the map. Territories are added one at a
 * time, each seeded on the coast of the land built so far, and the algorithm
 * stops when it has enough of them — so the landmass is an amoeba that grew
 * out from a single cell and left the rest of the grid as sea. That is what
 * gives the real game's maps their sprawling, ragged silhouette; carving a
 * shape out of a filled rectangle instead gives a slab with nibbled corners,
 * which reads as a spreadsheet no matter how the nibbling is randomised.
 *
 * The one trick worth spelling out is `order`: every cell draws a random
 * priority once, up front, and all growth then takes the lowest-priority cell
 * available. Because that ranking is fixed rather than re-rolled per step, a
 * territory's growth keeps reaching back to whichever of its *accumulated*
 * frontier cells happens to rank lowest, not just the ones it touched most
 * recently — so blobs come out lopsided and interlocking rather than round.
 *
 * Each territory grows to `size` cells and then annexes its whole remaining
 * frontier in one go (so the finished blobs are noticeably bigger than `size`,
 * and the seam between two of them is jagged); the cells beyond that frontier
 * become the candidate seeds for the next territory. Territories that end up
 * smaller than `minSize` are dropped back to sea — those holes are a feature,
 * they're where the map's inland seas and bays come from — as is any territory
 * not in the largest connected group, since a marooned one could never be
 * conquered.
 *
 * Returns { territoryOf: {hexId: territoryIdx}, territories: [{id, hexIds}] }
 * covering only the cells that ended up as land.
 */
export function growTerritories(cellIds, cells, adjacency, territoryCount, rng, { size = 8, minSize = 6 } = {}) {
  // Fixed random priority per cell — see the note above on why it isn't re-rolled.
  const order = {};
  cellIds.forEach((id, i) => { order[id] = i; });
  for (let i = cellIds.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = cellIds[i], b = cellIds[j];
    [order[a], order[b]] = [order[b], order[a]];
  }
  const lowest = (ids) => {
    let best = null, bestOrder = Infinity;
    for (const id of ids) if (order[id] < bestOrder) { bestOrder = order[id]; best = id; }
    return best;
  };

  const territoryOf = {};
  const bucket = [];

  // Seed the first territory near the middle of the grid. DICEWARS starts
  // anywhere, but a blob that starts in a corner grows into the grid's edges
  // and flattens itself against them — the straight coastline we're trying to
  // get away from.
  let minQ = Infinity, maxQ = -Infinity, minR = Infinity, maxR = -Infinity;
  for (const id of cellIds) {
    const { q, r } = cells[id];
    minQ = Math.min(minQ, q); maxQ = Math.max(maxQ, q);
    minR = Math.min(minR, r); maxR = Math.max(maxR, r);
  }
  const middle = cellIds.filter(id => {
    const { q, r } = cells[id];
    return q > minQ + (maxQ - minQ) * 0.3 && q < minQ + (maxQ - minQ) * 0.7
      && r > minR + (maxR - minR) * 0.3 && r < minR + (maxR - minR) * 0.7;
  });
  const seedPool = middle.length ? middle : cellIds;
  const coast = new Set([seedPool[Math.floor(rng() * seedPool.length)]]);

  while (bucket.length < territoryCount) {
    const start = lowest([...coast].filter(id => territoryOf[id] == null));
    if (start == null) break; // ran out of room on this grid

    const idx = bucket.length;
    const hexIds = [];
    const frontier = new Set();

    let cur = start;
    while (true) {
      territoryOf[cur] = idx;
      hexIds.push(cur);
      frontier.delete(cur);
      for (const nid of (adjacency[cur] ?? [])) if (territoryOf[nid] == null) frontier.add(nid);
      if (hexIds.length >= size) break;
      const next = lowest(frontier);
      if (next == null) break;
      cur = next;
    }

    // Annex the leftover frontier, and open the ring beyond it as the coast the
    // next territory may seed from.
    for (const id of frontier) {
      territoryOf[id] = idx;
      hexIds.push(id);
      for (const nid of (adjacency[id] ?? [])) if (territoryOf[nid] == null) coast.add(nid);
    }

    bucket.push(hexIds);
  }

  // Sea cells with no sea neighbour are single-cell pinholes, not lakes — hand
  // them to a bordering territory rather than leave the map speckled.
  for (const id of cellIds) {
    if (territoryOf[id] != null) continue;
    let owner = null, hasSeaNeighbor = false;
    for (const nid of (adjacency[id] ?? [])) {
      if (territoryOf[nid] == null) hasSeaNeighbor = true; else owner = territoryOf[nid];
    }
    // A cell on the grid's rim has fewer than six neighbours; the missing ones
    // are open sea, so it can never be a pinhole.
    if (!hasSeaNeighbor && owner != null && (adjacency[id] ?? []).length === 6) {
      territoryOf[id] = owner;
      bucket[owner].push(id);
    }
  }

  const alive = bucket.map(hexIds => hexIds.length >= minSize);

  // Drop anything cut off from the main landmass: unreachable territories can
  // never be taken, so a game containing one could never end.
  const groupOf = new Map();
  let biggest = null, biggestSize = -1;
  for (let idx = 0; idx < bucket.length; idx++) {
    if (!alive[idx] || groupOf.has(idx)) continue;
    const group = [idx];
    groupOf.set(idx, idx);
    for (let qi = 0; qi < group.length; qi++) {
      for (const hid of bucket[group[qi]]) {
        for (const nid of (adjacency[hid] ?? [])) {
          const other = territoryOf[nid];
          if (other == null || !alive[other] || groupOf.has(other)) continue;
          groupOf.set(other, idx);
          group.push(other);
        }
      }
    }
    if (group.length > biggestSize) { biggestSize = group.length; biggest = idx; }
  }
  for (let idx = 0; idx < bucket.length; idx++) {
    if (alive[idx] && groupOf.get(idx) !== biggest) alive[idx] = false;
  }

  for (let idx = 0; idx < bucket.length; idx++) {
    if (alive[idx]) continue;
    for (const hid of bucket[idx]) delete territoryOf[hid];
  }

  // Reindex so the surviving territories are numbered 0..n-1.
  const survivingIdx = bucket.map((_, idx) => idx).filter(idx => alive[idx]);
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
 *
 * Depth alone leaves ties, and on a small blob it leaves nothing BUT ties: a
 * territory only a hex or two thick (most of Risk's, where the open sea counts
 * as outside) has every hex at depth 0. Ties go to the hex nearest the blob's
 * centroid, so the marker lands in the middle of the shape rather than on
 * whichever hex the caller happened to list first — which, for a map parsed
 * top-to-bottom, is the top-left corner of every territory on the board.
 */
export function territoryCapital(hexIds, cells, size, adjacency) {
  const hexSet = new Set(hexIds);
  const dist = {};
  const queue = [];
  for (const id of hexIds) {
    const isBoundary = (adjacency?.[id] ?? []).some(nid => !hexSet.has(nid));
    if (isBoundary) { dist[id] = 0; queue.push(id); }
  }
  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi++];
    for (const nid of (adjacency[cur] ?? [])) {
      if (hexSet.has(nid) && dist[nid] == null) { dist[nid] = dist[cur] + 1; queue.push(nid); }
    }
  }

  // The blob's centre of mass, in the same pixels the board is drawn in — a hex
  // one row down is only half a column across, so counting rows and columns
  // instead would pull the answer off to one side on a staggered grid.
  const pts = {};
  let cx = 0, cy = 0;
  for (const id of hexIds) {
    const { q, r } = cells[id];
    const p = hexToPixel(q, r, size);
    pts[id] = p;
    cx += p.x / hexIds.length;
    cy += p.y / hexIds.length;
  }

  // A blob with no boundary at all (it is the whole map) leaves every depth at 0,
  // which is the tie the centroid resolves.
  let best = null, bestD = -1, bestOff = Infinity;
  for (const id of hexIds) {
    const d = dist[id] ?? 0;
    const off = Math.hypot(pts[id].x - cx, pts[id].y - cy);
    if (d > bestD || (d === bestD && off < bestOff)) { best = id; bestD = d; bestOff = off; }
  }
  return best;
}
