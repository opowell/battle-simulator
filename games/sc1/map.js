import { TERRAIN } from './terrain.js';
import { UNITS } from './units.js';
import { BUILDINGS } from './buildings.js';
import { tileNum } from '../coord.js';
import { buildStarcraftMap, MAP_WIDTH, MAP_HEIGHT, mulberry32 } from '../mapTypes/starcraftMap.js';

export { mulberry32, MAP_WIDTH, MAP_HEIGHT };

/**
 * Generate the SC1 map — "Aiur Crossing", a hand-authored 2-player map built from
 * grouped terrain features (see games/mapTypes/starcraftMap.js), the same shape-based
 * approach as games/doom/map.js. Four mineral-ring bases per player (corner main,
 * natural, third, and a 4th in the opposite corner), impassable rock outcrops that
 * carve the field into lanes, and a contested central plateau ringed by cliffs with
 * four ramp chokes. Returns { width, height, tiles, shapes, bases } — `tiles` drives
 * movement / build / LOS, `shapes` is the grouped render layer for the design UI, and
 * `bases` gives the two main-base centres.
 *
 * SC1 economy: 1500-mineral fields, 2500 for the contested gold expansions, and
 * fat 5000-unit vespene geysers.
 */
export function generateMap() {
  return buildStarcraftMap({ mineral: 1500, rich: 2500, vespene: 5000 });
}

// Continuous (non-rasterized) terrain lookup for free-form unit movement — positions
// can now be continuous (see games/coord.js), so snap to the tile they sit in before
// indexing the tile dictionary.
export function isPassableContinuous(board, x, y, domain) {
  const t  = board.tiles[`${tileNum(x)},${tileNum(y)}`];
  const td = TERRAIN[t?.terrain];
  if (!td) return false;
  return domain === 'air' ? td.passable.air : td.passable.ground;
}

export function getMoveCostContinuous(board, x, y) {
  const t = board.tiles[`${tileNum(x)},${tileNum(y)}`];
  return TERRAIN[t?.terrain]?.moveCost ?? 1;
}

/**
 * Find an unoccupied tile adjacent (including diagonals) to a position.
 */
export function findAdjacentFree(pos, board, units, buildings) {
  const unitPos   = new Set(units.filter(u => u.alive).map(u => `${tileNum(u.position.x)},${tileNum(u.position.y)}`));
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
  // Still builds the AI's discrete candidate set even once positions are continuous
  // (free-form movement, see games/coord.js), so every position is pinned to the
  // integer tile it sits in before indexing.
  const key = p => `${tileNum(p.x)},${tileNum(p.y)}`;

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

  const start = { x: tileNum(unit.position.x), y: tileNum(unit.position.y) };
  const best = new Map([[key(start), unit.movesLeft]]);
  const queue = [{ pos: start, ml: unit.movesLeft }];
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
    const k = `${tileNum(u.position.x)},${tileNum(u.position.y)}`;
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
