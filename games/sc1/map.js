import { TERRAIN } from './terrain.js';
import { UNITS } from './units.js';
import { BUILDINGS } from './buildings.js';

// Fast seeded PRNG
export function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate an SC1-style map.
 * Layout: two bases in opposite corners, mineral clusters + vespene near each base,
 * elevated plateau in the center connected by ramps, obstacle patches.
 *
 * Coordinate system: x=0 left, y=0 bottom; displayed with y=height-1 at top.
 */
export function generateMap(width, height) {
  const tiles = {};

  // Fill with open ground
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      tiles[`${x},${y}`] = { terrain: 'open' };
    }
  }

  // Obstacle border
  for (let x = 0; x < width; x++) {
    tiles[`${x},0`]          = { terrain: 'obstacle' };
    tiles[`${x},${height-1}`]= { terrain: 'obstacle' };
  }
  for (let y = 0; y < height; y++) {
    tiles[`0,${y}`]         = { terrain: 'obstacle' };
    tiles[`${width-1},${y}`]= { terrain: 'obstacle' };
  }

  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);

  // Central elevated plateau (5 wide, 4 tall)
  for (let dy = -2; dy <= 1; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const x = cx + dx, y = cy + dy;
      if (tiles[`${x},${y}`]?.terrain === 'open') {
        tiles[`${x},${y}`] = { terrain: 'elevated' };
      }
    }
  }

  // Ramps into plateau (south and north)
  const rampTiles = [
    { x: cx-1, y: cy-3 }, { x: cx, y: cy-3 }, { x: cx+1, y: cy-3 }, // south ramps
    { x: cx-1, y: cy+2 }, { x: cx, y: cy+2 }, { x: cx+1, y: cy+2 }, // north ramps
  ];
  for (const r of rampTiles) {
    tiles[`${r.x},${r.y}`] = { terrain: 'ramp' };
  }

  // Additional obstacle patches (interior walls)
  const obstaclePatches = [
    // Left corridor wall
    { x: 5, y: cy-1 }, { x: 5, y: cy }, { x: 5, y: cy+1 },
    // Right corridor wall
    { x: width-6, y: cy-1 }, { x: width-6, y: cy }, { x: width-6, y: cy+1 },
  ];
  for (const p of obstaclePatches) {
    if (tiles[`${p.x},${p.y}`]?.terrain === 'open') {
      tiles[`${p.x},${p.y}`] = { terrain: 'obstacle' };
    }
  }

  // Player 1 base: bottom-left area (base at ~(3,3))
  // Mineral cluster: above the base
  const p1minerals = [
    { x:4, y:5 }, { x:5, y:5 }, { x:6, y:5 }, { x:7, y:5 },
    { x:4, y:6 }, { x:5, y:6 }, { x:6, y:6 }, { x:7, y:6 },
  ];
  for (const m of p1minerals) {
    tiles[`${m.x},${m.y}`] = { terrain: 'minerals', amount: 1500 };
  }
  // Vespene geyser P1
  tiles[`8,4`] = { terrain: 'vespene', amount: 5000 };

  // Player 2 base: top-right area (base at ~(width-4, height-4))
  const p2minerals = [
    { x:width-5, y:height-6 }, { x:width-6, y:height-6 }, { x:width-7, y:height-6 }, { x:width-8, y:height-6 },
    { x:width-5, y:height-7 }, { x:width-6, y:height-7 }, { x:width-7, y:height-7 }, { x:width-8, y:height-7 },
  ];
  for (const m of p2minerals) {
    tiles[`${m.x},${m.y}`] = { terrain: 'minerals', amount: 1500 };
  }
  // Vespene geyser P2
  tiles[`${width-9},${height-5}`] = { terrain: 'vespene', amount: 5000 };

  return tiles;
}

/**
 * Find an unoccupied tile adjacent (including diagonals) to a position.
 */
export function findAdjacentFree(pos, board, units, buildings) {
  const unitPos   = new Set(units.filter(u => u.alive).map(u => `${u.position.x},${u.position.y}`));
  const buildPos  = new Set(buildings.filter(b => b.alive).map(b => `${b.position.x},${b.position.y}`));
  const dirs = [[0,1],[1,0],[-1,0],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
  for (const [dx, dy] of dirs) {
    const nx = pos.x + dx, ny = pos.y + dy;
    const k = `${nx},${ny}`;
    const t = board.tiles[k];
    if (!t) continue;
    const td = TERRAIN[t.terrain];
    if (!td?.passable.ground) continue;
    if (unitPos.has(k) || buildPos.has(k)) continue;
    return { x: nx, y: ny };
  }
  return null;
}

/**
 * Get all tiles reachable by a unit with Dijkstra.
 * Ground units blocked by obstacles, minerals (impassable), buildings, and enemy units.
 * Air units can fly over everything except obstacle borders.
 */
export function getReachableTiles(unit, board, allUnits, allBuildings, playerId) {
  const stats = UNITS[unit.type];
  const { domain } = stats;
  const key = p => `${p.x},${p.y}`;

  const enemyGround = new Set(
    allUnits.filter(u => u.alive && u.ownerId !== playerId && u.domain !== 'air')
            .map(u => key(u.position))
  );
  const friendlyPos = new Set(
    allUnits.filter(u => u.alive && u.ownerId === playerId && u.id !== unit.id)
            .map(u => key(u.position))
  );
  const buildingPos = new Set(
    allBuildings.filter(b => b.alive).map(b => key(b.position))
  );

  const best = new Map([[key(unit.position), unit.movesLeft]]);
  const queue = [{ pos: unit.position, ml: unit.movesLeft }];
  const reachable = [];

  while (queue.length) {
    queue.sort((a, b) => b.ml - a.ml);
    const { pos, ml } = queue.shift();

    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]) {
      const next = { x: pos.x + dx, y: pos.y + dy };
      const k = key(next);
      if (next.x < 0 || next.x >= board.width || next.y < 0 || next.y >= board.height) continue;

      const tile = board.tiles[k];
      if (!tile) continue;
      const td = TERRAIN[tile.terrain];
      if (!td) continue;

      if (domain === 'ground' && !td.passable.ground) continue;
      if (domain === 'air'   && !td.passable.air)    continue;

      // Ground units blocked by enemy ground units (must attack to enter) and buildings
      if (domain === 'ground' && enemyGround.has(k)) continue;
      if (domain === 'ground' && buildingPos.has(k)) continue;

      // Can't stack with friendly units
      if (friendlyPos.has(k)) continue;

      const cost = td.moveCost || 1;
      if (ml <= 0) continue;
      const remaining = Math.max(0, ml - cost);
      if ((best.get(k) ?? -1) >= remaining) continue;
      best.set(k, remaining);
      reachable.push(next);
      if (remaining > 0) queue.push({ pos: next, ml: remaining });
    }
  }

  return reachable;
}

// ── ASCII rendering ───────────────────────────────────────────────────────────

// Unit display: first letter of type, uppercase=P1, lowercase=P2
function unitSymbol(unit, p1Id) {
  // Special multi-char types — use distinctive single chars
  const typeMap = {
    'siege-tank': 'T', 'high-templar': 'H', 'dark-templar': 'D',
    battlecruiser: 'B', overlord: 'O', ultralisk: 'U',
    hydralisk: 'H', zergling: 'Z', mutalisk: 'M', scourge: 'C',
    dragoon: 'G', zealot: 'A', archon: 'X', corsair: 'R', arbiter: 'I',
  };
  const ch = typeMap[unit.type] ?? unit.type[0].toUpperCase();
  return unit.ownerId === p1Id ? ch : ch.toLowerCase();
}

// Building display: first char of type, uppercase=P1, lowercase=P2
function buildingSymbol(building, p1Id) {
  const typeMap = {
    'command-center': 'C', 'supply-depot': 'S', refinery: 'R', barracks: 'B',
    factory: 'F', starport: 'P', 'engineering-bay': 'E', 'missile-turret': 'T', bunker: 'K',
    hatchery: 'H', lair: 'L', hive: 'V', extractor: 'X', 'spawning-pool': 'W',
    'hydralisk-den': 'D', spire: 'I', 'sunken-colony': 'N', 'spore-colony': 'O',
    'ultralisk-cavern': 'U',
    nexus: 'N', pylon: 'Y', assimilator: 'A', gateway: 'G',
    'cybernetics-core': 'Q', forge: 'J', 'photon-cannon': 'Z',
    'templar-archives': 'T', stargate: 'M', 'robotics-facility': 'F',
  };
  const ch = typeMap[building.type] ?? building.type[0].toUpperCase();
  const base = building.ownerId === p1Id ? ch : ch.toLowerCase();
  return building.constructTurns > 0 ? `(${base})` : base;
}

export function renderMap(state) {
  const { board, units, buildings } = state;
  const { width, height } = board;
  const p1Id = state.players[0].id;

  const unitMap = {};
  for (const u of units) {
    if (!u.alive) continue;
    const k = `${u.position.x},${u.position.y}`;
    if (!unitMap[k] || u.ownerId === p1Id) unitMap[k] = u;
  }
  const buildMap = {};
  for (const b of buildings) {
    if (!b.alive) continue;
    buildMap[`${b.position.x},${b.position.y}`] = b;
  }

  const header = '   ' + Array.from({ length: width }, (_, i) => (i % 10 === 0 ? String(Math.floor(i/10)) : ' ')).join('') +
                 '\n   ' + Array.from({ length: width }, (_, i) => String(i % 10)).join('');
  const rows = [header];

  for (let y = height - 1; y >= 0; y--) {
    let row = String(y).padStart(2) + '|';
    for (let x = 0; x < width; x++) {
      const k = `${x},${y}`;
      const tile = board.tiles[k];
      const build = buildMap[k];
      const unit  = unitMap[k];
      if (build) {
        // buildingSymbol returns 'C' for completed, '(C)' for constructing
        const bsym = buildingSymbol(build, p1Id);
        row += bsym.length > 1 ? bsym[1] : bsym[0];
      } else if (unit) {
        row += unitSymbol(unit, p1Id);
      } else {
        row += TERRAIN[tile?.terrain]?.symbol ?? ' ';
      }
    }
    rows.push(row);
  }

  return rows.join('\n');
}
