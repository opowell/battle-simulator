import { TERRAIN } from './terrain.js';
import { UNITS } from './units.js';
import { BUILDINGS } from './buildings.js';

/**
 * Generate an SC2-style map.
 * Two bases in opposite corners with natural expansions, mineral clusters,
 * vespene geysers, central elevated plateau with ramp chokes.
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
    tiles[`${x},0`]           = { terrain: 'obstacle' };
    tiles[`${x},${height-1}`] = { terrain: 'obstacle' };
  }
  for (let y = 0; y < height; y++) {
    tiles[`0,${y}`]          = { terrain: 'obstacle' };
    tiles[`${width-1},${y}`] = { terrain: 'obstacle' };
  }

  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);

  // Central elevated plateau
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy;
      if (tiles[`${x},${y}`]?.terrain === 'open') {
        tiles[`${x},${y}`] = { terrain: 'elevated' };
      }
    }
  }

  // Ramps into plateau (south and north chokes)
  const rampTiles = [
    { x: cx-1, y: cy-3 }, { x: cx, y: cy-3 }, { x: cx+1, y: cy-3 },
    { x: cx-1, y: cy+3 }, { x: cx, y: cy+3 }, { x: cx+1, y: cy+3 },
    // Side ramps for wider map
    { x: cx-5, y: cy-1 }, { x: cx-5, y: cy }, { x: cx-5, y: cy+1 },
    { x: cx+5, y: cy-1 }, { x: cx+5, y: cy }, { x: cx+5, y: cy+1 },
  ];
  for (const r of rampTiles) {
    if (tiles[`${r.x},${r.y}`]) tiles[`${r.x},${r.y}`] = { terrain: 'ramp' };
  }

  // Obstacle walls (chokepoints)
  const walls = [
    { x: 6, y: cy-1 }, { x: 6, y: cy }, { x: 6, y: cy+1 },
    { x: width-7, y: cy-1 }, { x: width-7, y: cy }, { x: width-7, y: cy+1 },
  ];
  for (const w of walls) {
    if (tiles[`${w.x},${w.y}`]?.terrain === 'open') {
      tiles[`${w.x},${w.y}`] = { terrain: 'obstacle' };
    }
  }

  // ── Player 1 base: bottom-left (base at ~(3,3)) ───────────────────────────
  const p1minerals = [
    { x:4, y:6 }, { x:5, y:6 }, { x:6, y:6 }, { x:7, y:6 },
    { x:4, y:7 }, { x:5, y:7 }, { x:6, y:7 }, { x:7, y:7 },
  ];
  for (const m of p1minerals) tiles[`${m.x},${m.y}`] = { terrain: 'minerals', amount: 1500 };
  tiles[`8,5`]  = { terrain: 'vespene', amount: 2250 };
  tiles[`3,7`]  = { terrain: 'vespene', amount: 2250 };

  // Natural expansion P1 (mid-left)
  const p1nat = [
    { x:3, y:cy-2 }, { x:4, y:cy-2 }, { x:5, y:cy-2 }, { x:6, y:cy-2 },
  ];
  for (const m of p1nat) tiles[`${m.x},${m.y}`] = { terrain: 'minerals', amount: 1500 };
  tiles[`4,${cy-3}`] = { terrain: 'vespene', amount: 2250 };

  // ── Player 2 base: top-right (base at ~(width-4, height-4)) ──────────────
  const p2minerals = [
    { x:width-5, y:height-7 }, { x:width-6, y:height-7 }, { x:width-7, y:height-7 }, { x:width-8, y:height-7 },
    { x:width-5, y:height-8 }, { x:width-6, y:height-8 }, { x:width-7, y:height-8 }, { x:width-8, y:height-8 },
  ];
  for (const m of p2minerals) tiles[`${m.x},${m.y}`] = { terrain: 'minerals', amount: 1500 };
  tiles[`${width-9},${height-6}`] = { terrain: 'vespene', amount: 2250 };
  tiles[`${width-4},${height-8}`] = { terrain: 'vespene', amount: 2250 };

  // Natural expansion P2 (mid-right)
  const p2nat = [
    { x:width-4, y:cy+2 }, { x:width-5, y:cy+2 }, { x:width-6, y:cy+2 }, { x:width-7, y:cy+2 },
  ];
  for (const m of p2nat) tiles[`${m.x},${m.y}`] = { terrain: 'minerals', amount: 1500 };
  tiles[`${width-5},${cy+3}`] = { terrain: 'vespene', amount: 2250 };

  return tiles;
}

/**
 * Find an unoccupied ground-passable tile adjacent to pos.
 */
export function findAdjacentFree(pos, board, units, buildings) {
  const unitPos  = new Set(units.filter(u => u.alive).map(u => `${u.position.x},${u.position.y}`));
  const bldgPos  = new Set(buildings.filter(b => b.alive).map(b => `${b.position.x},${b.position.y}`));
  const dirs = [[0,1],[1,0],[-1,0],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
  for (const [dx, dy] of dirs) {
    const nx = pos.x + dx, ny = pos.y + dy;
    const k  = `${nx},${ny}`;
    const t  = board.tiles[k];
    if (!t) continue;
    const td = TERRAIN[t.terrain];
    if (!td?.passable.ground) continue;
    if (unitPos.has(k) || bldgPos.has(k)) continue;
    return { x: nx, y: ny };
  }
  return null;
}

/**
 * Get all tiles reachable by a unit via Dijkstra.
 */
export function getReachableTiles(unit, board, allUnits, allBuildings, playerId) {
  const stats  = UNITS[unit.type];
  const domain = unit.domain ?? stats.domain;
  const key    = p => `${p.x},${p.y}`;

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

  const best    = new Map([[key(unit.position), unit.movesLeft]]);
  const queue   = [{ pos: unit.position, ml: unit.movesLeft }];
  const reachable = [];

  while (queue.length) {
    queue.sort((a, b) => b.ml - a.ml);
    const { pos, ml } = queue.shift();

    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]) {
      const next = { x: pos.x + dx, y: pos.y + dy };
      const k    = key(next);
      if (next.x < 0 || next.x >= board.width || next.y < 0 || next.y >= board.height) continue;

      const tile = board.tiles[k];
      if (!tile) continue;
      const td = TERRAIN[tile.terrain];
      if (!td) continue;

      if (domain === 'ground' && !td.passable.ground) continue;
      if (domain === 'air'   && !td.passable.air)    continue;

      if (domain === 'ground' && enemyGround.has(k))  continue;
      if (domain === 'ground' && buildingPos.has(k))  continue;
      if (friendlyPos.has(k)) continue;

      const cost      = td.moveCost || 1;
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

function unitSymbol(unit, p1Id) {
  const typeMap = {
    // Terran
    scv:'V', marine:'M', marauder:'R', reaper:'E', ghost:'G',
    hellion:'H', 'siege-tank':'T', thor:'W', medivac:'D',
    viking:'K', banshee:'B', battlecruiser:'C',
    // Zerg
    drone:'d', zergling:'z', baneling:'b', roach:'o', ravager:'v',
    hydralisk:'y', lurker:'l', infestor:'i', queen:'q', swarmhost:'s',
    ultralisk:'u', mutalisk:'m', corruptor:'r', broodlord:'f',
    overlord:'O', locust:'j',
    // Protoss
    probe:'P', zealot:'Z', stalker:'S', sentry:'e', adept:'A',
    immortal:'I', colossus:'L', 'high-templar':'H', 'dark-templar':'D',
    archon:'X', phoenix:'N', 'void-ray':'J', carrier:'Y', tempest:'F',
  };
  const ch = typeMap[unit.type] ?? unit.type[0].toUpperCase();
  return unit.ownerId === p1Id ? ch.toUpperCase() : ch.toLowerCase();
}

function buildingSymbol(building, p1Id) {
  const typeMap = {
    // Terran
    'command-center':'C', 'supply-depot':'S', refinery:'R', barracks:'B',
    factory:'F', starport:'P', 'engineering-bay':'E', armory:'A',
    'ghost-academy':'G', 'fusion-core':'U', 'missile-turret':'T', bunker:'K',
    // Zerg
    hatchery:'H', lair:'L', hive:'V', extractor:'X', 'spawning-pool':'W',
    'roach-warren':'O', 'baneling-nest':'N', 'hydralisk-den':'D', 'lurker-den':'J',
    'infestation-pit':'I', spire:'I', 'greater-spire':'G', 'ultralisk-cavern':'U',
    'evolution-chamber':'E', 'spine-crawler':'Q', 'spore-crawler':'Z',
    // Protoss
    nexus:'N', pylon:'Y', assimilator:'A', gateway:'G', 'warp-gate':'W',
    'cybernetics-core':'Q', forge:'J', 'twilight-council':'T', 'robotics-facility':'F',
    'robotics-bay':'B', stargate:'M', 'fleet-beacon':'F', 'templar-archives':'T',
    'dark-shrine':'D', 'photon-cannon':'Z', 'shield-battery':'S',
  };
  const ch = typeMap[building.type] ?? building.type[0].toUpperCase();
  const base = building.ownerId === p1Id ? ch.toUpperCase() : ch.toLowerCase();
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

  const header = '   ' +
    Array.from({ length: width }, (_, i) => (i % 10 === 0 ? String(Math.floor(i/10)) : ' ')).join('') +
    '\n   ' +
    Array.from({ length: width }, (_, i) => String(i % 10)).join('');
  const rows = [header];

  for (let y = height - 1; y >= 0; y--) {
    let row = String(y).padStart(2) + '|';
    for (let x = 0; x < width; x++) {
      const k     = `${x},${y}`;
      const tile  = board.tiles[k];
      const build = buildMap[k];
      const unit  = unitMap[k];
      if (build)      row += buildingSymbol(build, p1Id)[0];
      else if (unit)  row += unitSymbol(unit, p1Id);
      else            row += TERRAIN[tile?.terrain]?.symbol ?? ' ';
    }
    rows.push(row);
  }

  return rows.join('\n');
}
