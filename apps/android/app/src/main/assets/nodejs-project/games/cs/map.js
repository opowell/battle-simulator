// Tile types: 'wall' | 'floor' | 'bombsiteA' | 'bombsiteB' | 'ctSpawn' | 'tSpawn'
// y increases upward (y=0 = bottom row, y=H-1 = top row)
// All utility functions accept `tiles` as first argument.

function k(x, y) { return `${x},${y}`; }

function fillRect(t, x1, y1, x2, y2, type) {
  for (let y = y1; y <= y2; y++)
    for (let x = x1; x <= x2; x++)
      t[k(x, y)] = type;
}

function buildBase(w, h) {
  const t = {};
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) t[k(x, y)] = 'floor';
  for (let x = 0; x < w; x++) { t[k(x, 0)] = 'wall'; t[k(x, h - 1)] = 'wall'; }
  for (let y = 0; y < h; y++) { t[k(0, y)] = 'wall'; t[k(w - 1, y)] = 'wall'; }
  return t;
}

// ── Dust II (improved) ────────────────────────────────────────────────────────
//
//  11 ####################
//  10 #.AAAA.####.####...#   A site (upper-left), long-A wall, T catwalk
//   9 #.AAAA.............#
//   8 #.AAAA.##.......##.#   A site cover + T-side entry wall
//   7 #.cc..............t.#
//   6 #.cc....##......tt.#   mid boxes
//   5 #.cc....##......tt.#
//   4 #.cc..............t.#
//   3 #.BBBB.##.......##.#   B site cover + T-side entry wall
//   2 #.BBBB.............#
//   1 #.BBBB.####.####...#   B tunnels wall
//   0 ####################
//      01234567890123456789

function buildDust2() {
  const W = 20, H = 12;
  const t = buildBase(W, H);

  fillRect(t, 1, 5, 2, 7, 'ctSpawn');
  fillRect(t, 17, 5, 18, 7, 'tSpawn');
  fillRect(t, 2, 8, 5, 10, 'bombsiteA');
  fillRect(t, 2, 1, 5, 3, 'bombsiteB');

  // Mid boxes (simulate dust2 mid barrels)
  [[9,5],[9,6],[10,5],[10,6]].forEach(([x,y]) => t[k(x,y)] = 'wall');

  // A site — car and platform cover
  [[6,9],[6,10],[7,10]].forEach(([x,y]) => t[k(x,y)] = 'wall');
  // Long-A wall (upper sightline break)
  for (let x = 8; x <= 11; x++) t[k(x,10)] = 'wall';
  // Short A entry corner
  [[7,8],[8,8]].forEach(([x,y]) => t[k(x,y)] = 'wall');

  // B site — tunnel entry walls
  [[6,1],[6,2],[7,1]].forEach(([x,y]) => t[k(x,y)] = 'wall');
  // Long-B lower wall
  for (let x = 8; x <= 11; x++) t[k(x,1)] = 'wall';
  // Short B entry corner
  [[7,3],[8,3]].forEach(([x,y]) => t[k(x,y)] = 'wall');

  // T-side upper and lower approach cover
  [[14,8],[14,9],[15,8]].forEach(([x,y]) => t[k(x,y)] = 'wall');
  [[14,2],[14,3],[15,3]].forEach(([x,y]) => t[k(x,y)] = 'wall');

  // T catwalk wall
  for (let x = 13; x <= 16; x++) t[k(x,10)] = 'wall';
  for (let x = 13; x <= 16; x++) t[k(x,1)] = 'wall';

  return {
    width: W, height: H, tiles: t,
    tSpawns:  [{ x:17,y:6 },{ x:18,y:6 },{ x:17,y:5 },{ x:18,y:5 },{ x:17,y:7 }],
    ctSpawns: [{ x:1,y:6  },{ x:2,y:6  },{ x:1,y:5  },{ x:2,y:5  },{ x:1,y:7  }],
  };
}

// ── de_dust ───────────────────────────────────────────────────────────────────
//
//  Original Dust: symmetric, linear corridors connecting two bombsites.
//  CTs start left-center; Ts start right-center.
//  Two mid corridors (upper/lower) funnel into A (top) and B (bottom).
//
//  11 ####################
//  10 #..AAAA...........##
//   9 #..AAAA..#####....##   A site + upper corridor walls
//   8 #..AAAA...........##
//   7 #ccc...##.....###..#   upper passage
//   6 #ccc...##.....###..#   mid
//   5 #ccc...##.....###..#   lower passage
//   4 #ccc...##.....###..#
//   3 #..BBBB...........##
//   2 #..BBBB..#####....##   B site + lower corridor walls
//   1 #..BBBB...........##
//   0 ####################
//      01234567890123456789

function buildDeDust() {
  const W = 20, H = 12;
  const t = buildBase(W, H);

  fillRect(t, 1, 4, 3, 7, 'ctSpawn');
  fillRect(t, 16, 4, 18, 7, 'tSpawn');
  fillRect(t, 2, 8, 5, 10, 'bombsiteA');
  fillRect(t, 2, 1, 5, 3, 'bombsiteB');

  // Mid corridor walls — force players through two passages
  fillRect(t, 7, 4, 7, 7, 'wall');
  fillRect(t, 14, 4, 14, 7, 'wall');

  // Mid center boxes
  [[9,5],[9,6],[10,5],[10,6]].forEach(([x,y]) => t[k(x,y)] = 'wall');

  // Upper arch (A entrance)
  for (let x = 5; x <= 7; x++) t[k(x,9)] = 'wall';
  for (let x = 11; x <= 13; x++) t[k(x,9)] = 'wall';

  // Lower arch (B entrance)
  for (let x = 5; x <= 7; x++) t[k(x,2)] = 'wall';
  for (let x = 11; x <= 13; x++) t[k(x,2)] = 'wall';

  // A-site entry cover
  [[6,8],[6,7]].forEach(([x,y]) => t[k(x,y)] = 'wall');
  [[13,8],[13,7]].forEach(([x,y]) => t[k(x,y)] = 'wall');

  // B-site entry cover
  [[6,3],[6,4]].forEach(([x,y]) => t[k(x,y)] = 'wall');
  [[13,3],[13,4]].forEach(([x,y]) => t[k(x,y)] = 'wall');

  // Far wall (T side) so there is cover on approach
  for (let y = 8; y <= 10; y++) t[k(18,y)] = 'wall';
  for (let y = 1; y <= 3; y++) t[k(18,y)] = 'wall';

  return {
    width: W, height: H, tiles: t,
    tSpawns:  [{ x:17,y:5 },{ x:16,y:5 },{ x:17,y:6 },{ x:16,y:6 },{ x:18,y:5 }],
    ctSpawns: [{ x:2,y:5  },{ x:1,y:5  },{ x:2,y:6  },{ x:3,y:5  },{ x:2,y:4  }],
  };
}

// ── cs_siege ──────────────────────────────────────────────────────────────────
//
//  T must storm a CT-held fortified building (center-left compound).
//  Three breach points: east gate and two roof/floor openings.
//  Bombsites A and B are inside the compound.
//
//  11 ####################
//  10 #.####..##.........#
//   9 #.#AA#..##.........#   A site inside compound (north room)
//   8 #.#AA#..##...###...#
//   7 #.####.........#...#   east gate passage (y=5-6 in compound wall)
//   6 #.#..........#.#tt.#
//   5 #.#..........#.#tt.#
//   4 #.####.........#...#
//   3 #.#BB#..##...###...#   B site inside compound (south room)
//   2 #.#BB#..##.........#
//   1 #.####..##.........#
//   0 ####################
//      01234567890123456789

function buildCsSiege() {
  const W = 20, H = 12;
  const t = buildBase(W, H);

  // T spawn — right side, outside compound
  fillRect(t, 16, 5, 18, 6, 'tSpawn');
  // CTs hold compound interior; Ts storm from right.
  fillRect(t, 4, 5, 5, 6, 'ctSpawn');

  // Compound outer walls (x=2-8, y=1-10)
  for (let x = 2; x <= 8; x++) { t[k(x,1)] = 'wall'; t[k(x,10)] = 'wall'; }
  for (let y = 1; y <= 10; y++) { t[k(2,y)] = 'wall'; t[k(8,y)] = 'wall'; }

  // Compound interior (carve out floor)
  fillRect(t, 3, 2, 7, 9, 'floor');

  // Re-stamp CT spawn inside
  fillRect(t, 4, 5, 5, 6, 'ctSpawn');

  // Bombsite A — north room
  fillRect(t, 3, 7, 5, 9, 'bombsiteA');
  // Bombsite B — south room
  fillRect(t, 3, 2, 5, 4, 'bombsiteB');

  // Internal divider (between A/B rooms and east half of compound)
  for (let y = 5; y <= 6; y++) t[k(7,y)] = 'wall';

  // East gate — breach opening in x=8 wall
  t[k(8,5)] = 'floor'; t[k(8,6)] = 'floor';

  // North breach — opening in y=10 wall
  t[k(4,10)] = 'floor'; t[k(5,10)] = 'floor';

  // South breach — opening in y=1 wall
  t[k(4,1)] = 'floor'; t[k(5,1)] = 'floor';

  // External cover for T's approaching from east
  [[10,4],[10,7],[11,5],[11,6],[12,4],[12,7]].forEach(([x,y]) => t[k(x,y)] = 'wall');

  // Northern T approach corridor walls
  for (let x = 9; x <= 13; x++) t[k(x,9)] = 'wall';
  // Southern T approach corridor walls
  for (let x = 9; x <= 13; x++) t[k(x,2)] = 'wall';

  // T-side boxes near spawn
  [[14,5],[14,6],[15,4],[15,7]].forEach(([x,y]) => t[k(x,y)] = 'wall');

  return {
    width: W, height: H, tiles: t,
    tSpawns:  [{ x:17,y:5 },{ x:16,y:5 },{ x:17,y:6 },{ x:16,y:6 },{ x:18,y:5 }],
    ctSpawns: [{ x:4,y:5  },{ x:5,y:5  },{ x:4,y:6  },{ x:5,y:6  },{ x:4,y:4  }],
  };
}

// ── cs_italy ──────────────────────────────────────────────────────────────────
//
//  Village map: CTs top-left (police station), Ts bottom-right (warehouse).
//  Multiple winding routes through buildings and alleyways.
//  Bombsite A: upper-right market. Bombsite B: lower-left wine cellar.
//
//  11 ####################
//  10 #ccc.......######..#
//   9 #ccc.......#....#..#   CT spawn + upper building
//   8 #ccc.......#AAAA#..#   A site (market, upper-right)
//   7 #....######.AAAA...#
//   6 #....#....#.AAAA...#   mid building blocks routes
//   5 #....#....#.......##
//   4 #..##......######.##
//   3 #.BB##.....#....#.##   B site (wine cellar, lower-left)
//   2 #.BB.......#....#ttt   T spawn + lower building
//   1 #.BB........####.ttt
//   0 ####################
//      01234567890123456789

function buildCsItaly() {
  const W = 20, H = 12;
  const t = buildBase(W, H);

  // CT spawn — upper-left (police station)
  fillRect(t, 1, 8, 3, 10, 'ctSpawn');
  // T spawn — lower-right (warehouse)
  fillRect(t, 16, 1, 18, 3, 'tSpawn');

  // Bombsite A — market (upper-right)
  fillRect(t, 13, 7, 16, 9, 'bombsiteA');
  // Bombsite B — wine cellar (lower-left)
  fillRect(t, 2, 1, 4, 3, 'bombsiteB');

  // Upper building (blocks direct CT→A, forces detour)
  fillRect(t, 5, 7, 10, 10, 'wall');
  // Door on south face
  t[k(7,7)] = 'floor'; t[k(8,7)] = 'floor';
  // Door on east face
  t[k(10,9)] = 'floor'; t[k(10,8)] = 'floor';

  // Lower building (blocks direct T→B, forces detour)
  fillRect(t, 9, 1, 14, 4, 'wall');
  // Door on north face
  t[k(11,4)] = 'floor'; t[k(12,4)] = 'floor';
  // Door on west face
  t[k(9,2)] = 'floor'; t[k(9,3)] = 'floor';

  // Alley walls — narrow mid passages
  for (let y = 5; y <= 6; y++) t[k(5,y)] = 'wall';  // left alley
  for (let y = 5; y <= 6; y++) t[k(14,y)] = 'wall'; // right alley

  // Mid cover boxes
  [[7,5],[7,6],[8,5],[8,6]].forEach(([x,y]) => t[k(x,y)] = 'wall');

  // A-site approach cover (from west)
  [[11,7],[11,8],[12,6]].forEach(([x,y]) => t[k(x,y)] = 'wall');

  // B-site approach cover (from east)
  [[5,3],[5,4],[6,2]].forEach(([x,y]) => t[k(x,y)] = 'wall');

  // T-side upper passage blocker
  [[15,5],[15,6],[16,5]].forEach(([x,y]) => t[k(x,y)] = 'wall');

  return {
    width: W, height: H, tiles: t,
    tSpawns:  [{ x:17,y:2 },{ x:16,y:2 },{ x:17,y:3 },{ x:16,y:3 },{ x:18,y:2 }],
    ctSpawns: [{ x:2,y:9  },{ x:1,y:9  },{ x:2,y:10 },{ x:3,y:9  },{ x:2,y:8  }],
  };
}

// ── Map registry ──────────────────────────────────────────────────────────────

export const MAPS = {
  dust2:    buildDust2(),
  de_dust:  buildDeDust(),
  cs_siege: buildCsSiege(),
  cs_italy: buildCsItaly(),
};

// ── Utility functions (all take tiles as first argument) ──────────────────────

export function isBombsite(tiles, x, y) {
  const t = tiles[k(x, y)];
  return t === 'bombsiteA' || t === 'bombsiteB';
}

export function isWalkable(tiles, x, y) {
  const t = tiles[k(x, y)];
  return t !== undefined && t !== 'wall';
}

// Bresenham LOS — returns false if any intermediate tile is a wall or in extraBlocked
export function hasLOS(tiles, x0, y0, x1, y1, extraBlocked = null) {
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let cx = x0, cy = y0;
  while (cx !== x1 || cy !== y1) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; cx += sx; }
    if (e2 < dx)  { err += dx; cy += sy; }
    if (cx === x1 && cy === y1) break;
    if (tiles[k(cx, cy)] === 'wall') return false;
    if (extraBlocked?.has(k(cx, cy))) return false;
  }
  return true;
}

export function euclidean(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// BFS reachable positions (4-directional, excludes occupied tiles)
export function getReachable(tiles, pos, range, units) {
  const occupied = new Set(
    units.filter(u => u.alive && !(u.position.x === pos.x && u.position.y === pos.y))
         .map(u => k(u.position.x, u.position.y))
  );
  const visited = new Set([k(pos.x, pos.y)]);
  const queue   = [{ x: pos.x, y: pos.y, rem: range }];
  const result  = [];
  while (queue.length) {
    const { x, y, rem } = queue.shift();
    if (rem === 0) continue;
    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nx = x + dx, ny = y + dy, nk = k(nx, ny);
      if (!visited.has(nk) && isWalkable(tiles, nx, ny) && !occupied.has(nk)) {
        visited.add(nk);
        result.push({ x: nx, y: ny });
        queue.push({ x: nx, y: ny, rem: rem - 1 });
      }
    }
  }
  return result;
}

// All walkable tiles within Euclidean range (for grenade throws — no LOS required)
export function getThrowTargets(tiles, width, height, pos, range) {
  const r2 = range * range;
  const result = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (isWalkable(tiles, x, y) && (x - pos.x) ** 2 + (y - pos.y) ** 2 <= r2)
        result.push({ x, y });
  return result;
}

const TILE_CHARS = { wall: '#', floor: '.', bombsiteA: 'A', bombsiteB: 'B', ctSpawn: 'c', tSpawn: 't' };

export function renderMap(state) {
  const { units, gameSpecific: { bomb, smokeZones = [], fireZones = [], map } } = state;
  const { tiles, width, height } = map;
  const posMap = {};
  for (const u of units) if (u.alive) posMap[k(u.position.x, u.position.y)] = u;

  const smokeSet = new Set();
  for (const sz of smokeZones)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        smokeSet.add(k(sz.x + dx, sz.y + dy));

  const fireSet = new Set();
  for (const fz of fireZones)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        fireSet.add(k(fz.x + dx, fz.y + dy));

  const rows = [];
  for (let y = height - 1; y >= 0; y--) {
    let row = '';
    for (let x = 0; x < width; x++) {
      const kk = k(x, y);
      const u = posMap[kk];
      if (u) {
        row += u.ownerId === 'T' ? 'T' : 'C';
      } else if (bomb?.planted && bomb.plantedAt.x === x && bomb.plantedAt.y === y) {
        row += '!';
      } else if (fireSet.has(kk)) {
        row += '*';
      } else if (smokeSet.has(kk)) {
        row += '@';
      } else {
        row += TILE_CHARS[tiles[kk]] ?? '?';
      }
    }
    rows.push(`${String(y).padStart(2)} ${row}`);
  }
  rows.push('   ' + Array.from({ length: width }, (_, i) => i % 10).join(''));
  return rows.join('\n');
}
