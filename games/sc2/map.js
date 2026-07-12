import { TERRAIN } from './terrain.js';
import { UNITS } from './units.js';
import { BUILDINGS } from './buildings.js';
import { buildStarcraftMap, MAP_WIDTH, MAP_HEIGHT, mulberry32 } from '../mapTypes/starcraftMap.js';

export { mulberry32, MAP_WIDTH, MAP_HEIGHT };

/**
 * Generate the SC2 map — "Aiur Crossing", a hand-authored 2-player map built from
 * grouped terrain features (see games/mapTypes/starcraftMap.js), the same shape-based
 * approach as games/doom/map.js. Shares the layout with SC1: four mineral-ring bases
 * per player (corner main, natural, third, and a 4th in the opposite corner), impassable
 * rock outcrops that carve the field into lanes, and a contested central plateau ringed
 * by cliffs with four ramp chokes. Returns { width, height, tiles, shapes, bases }.
 *
 * SC2 economy: 1500-mineral fields, 2500 for the contested gold expansions, and
 * 2250-unit vespene geysers (SC2's leaner gas rate).
 */
export function generateMap() {
  return buildStarcraftMap({ mineral: 1500, rich: 2500, vespene: 2250 });
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
