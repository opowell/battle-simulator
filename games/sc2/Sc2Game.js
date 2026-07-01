import { unitStrengthEval, sidesEval } from '../evalHelpers.js';
import { TERRAIN } from './terrain.js';
import { UNITS } from './units.js';
import { BUILDINGS } from './buildings.js';
import { resolveAttack, resolveAttackVsBuilding, inRange, chebyshev, effectiveRange } from './combat.js';
import { generateMap, findAdjacentFree, getReachableTiles, renderMap } from './map.js';
import { getSc2Belief } from './belief.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeUnit(id, ownerId, type, x, y) {
  const s = UNITS[type];
  return {
    id, ownerId, type,
    position: { x, y },
    alive: true,
    hp: s.hp, maxHp: s.hp,
    shields: s.shields ?? 0, maxShields: s.shields ?? 0,
    movesLeft: s.moves,
    attacksLeft: 1,
    domain: s.domain,
    attrs: {},
  };
}

function makeBuilding(id, ownerId, type, x, y, constructTurns) {
  const s = BUILDINGS[type];
  return {
    id, ownerId, type,
    position: { x, y },
    alive: true,
    hp: s.hp, maxHp: s.hp,
    shields: s.shields ?? 0, maxShields: s.shields ?? 0,
    constructTurns: constructTurns ?? 0,
    queue: null,
    domain: 'ground',
    attrs: {},
  };
}

function getResources(state, playerId) {
  return state.gameSpecific.resources[playerId] ?? { minerals: 0, gas: 0 };
}

function getSupply(state, playerId) {
  const max = state.buildings
    .filter(b => b.alive && b.ownerId === playerId && b.constructTurns === 0)
    .reduce((s, b) => s + (BUILDINGS[b.type]?.supplies ?? 0), 0)
    + state.units
      .filter(u => u.alive && u.ownerId === playerId)
      .reduce((s, u) => {
        const sp = UNITS[u.type].special;
        for (const tag of sp) {
          const m = tag.match(/^supply-(\d+)$/);
          if (m) return s + parseInt(m[1], 10);
        }
        return s;
      }, 0);

  const used = state.units
    .filter(u => u.alive && u.ownerId === playerId)
    .reduce((s, u) => s + (UNITS[u.type].supply ?? 0), 0)
    + state.buildings
      .filter(b => b.alive && b.ownerId === playerId && b.constructTurns === 0 && b.queue)
      .reduce((s, b) => s + (UNITS[b.queue.unitType]?.supply ?? 0), 0);

  return { max, used };
}

function hasBuilding(state, playerId, type) {
  return state.buildings.some(
    b => b.alive && b.ownerId === playerId && b.type === type && b.constructTurns === 0
  );
}

function hasRequirements(state, playerId, requirements) {
  return requirements.every(req => hasBuilding(state, playerId, req));
}

// Pylons and nexus provide warp power; units can warp in within range 6 of one
function withinPylonPower(pos, state, playerId) {
  return state.buildings.some(b => {
    if (!b.alive || b.ownerId !== playerId || b.constructTurns > 0) return false;
    if (b.type !== 'pylon' && b.type !== 'nexus') return false;
    return chebyshev(b.position, pos) <= 6;
  });
}

// ── Income ────────────────────────────────────────────────────────────────────

function collectIncome(state, playerId) {
  const resources = { ...getResources(state, playerId) };

  const mineralWorkers = state.units.filter(
    u => u.alive && u.ownerId === playerId && UNITS[u.type].special.includes('worker')
      && u.attrs.gathering === 'minerals'
  );
  resources.minerals += mineralWorkers.length * 8;

  const gasWorkers = state.units.filter(
    u => u.alive && u.ownerId === playerId && UNITS[u.type].special.includes('worker')
      && u.attrs.gathering === 'gas'
  );
  for (const w of gasWorkers) {
    const hasExtractor = state.buildings.some(b =>
      b.alive && b.ownerId === playerId && b.constructTurns === 0
      && BUILDINGS[b.type].special.includes('gas-extractor')
      && chebyshev(b.position, w.position) <= 2
    );
    if (hasExtractor) resources.gas += 4;
  }

  return {
    ...state,
    gameSpecific: {
      ...state.gameSpecific,
      resources: { ...state.gameSpecific.resources, [playerId]: resources },
    },
  };
}

// ── Building production ───────────────────────────────────────────────────────

function processBuildingQueues(state, playerId, nextId) {
  let idCounter = nextId;
  let units = state.units;

  const buildings = state.buildings.map(b => {
    if (b.ownerId !== playerId || !b.alive) return b;

    if (b.constructTurns > 0) return { ...b, constructTurns: b.constructTurns - 1 };

    // Advance warp-gate cooldown
    if (b.type === 'warp-gate' && (b.attrs?.cooldown ?? 0) > 0) {
      return { ...b, attrs: { ...b.attrs, cooldown: b.attrs.cooldown - 1 } };
    }

    if (!b.queue) return b;
    const { unitType, turnsLeft } = b.queue;
    if (turnsLeft > 1) return { ...b, queue: { ...b.queue, turnsLeft: turnsLeft - 1 } };

    const spawnPos = findAdjacentFree(b.position, state.board, units, state.buildings.filter(x => x.id !== b.id));
    if (!spawnPos) return b;

    const count = UNITS[unitType]?.special.includes('pair') ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const sp = i === 0 ? spawnPos : findAdjacentFree(spawnPos, state.board, units, state.buildings.filter(x => x.id !== b.id));
      if (!sp) break;
      units = [...units, makeUnit(`u${idCounter++}`, playerId, unitType, sp.x, sp.y)];
    }

    // Injected hatcheries process queue twice (inject-larva bonus)
    if (b.attrs?.injected && b.queue) {
      const sp2 = findAdjacentFree(b.position, state.board, units, state.buildings.filter(x => x.id !== b.id));
      if (sp2) {
        units = [...units, makeUnit(`u${idCounter++}`, playerId, unitType, sp2.x, sp2.y)];
        if (UNITS[unitType]?.special.includes('pair')) {
          const sp3 = findAdjacentFree(sp2, state.board, units, state.buildings.filter(x => x.id !== b.id));
          if (sp3) units = [...units, makeUnit(`u${idCounter++}`, playerId, unitType, sp3.x, sp3.y)];
        }
      }
    }

    return { ...b, queue: null, attrs: { ...b.attrs, injected: false } };
  });

  return {
    ...state,
    units,
    buildings,
    gameSpecific: { ...state.gameSpecific, nextId: idCounter },
  };
}

// ── Passive effects at turn start ─────────────────────────────────────────────

function processPassives(state, playerId) {
  let units = state.units;

  // Medivac healing: each medivac heals one adjacent bio unit for 2 HP
  const medivacs = units.filter(u => u.alive && u.ownerId === playerId && u.type === 'medivac');
  for (const med of medivacs) {
    const target = units.find(u =>
      u.alive && u.ownerId === playerId && u.id !== med.id
      && UNITS[u.type].special.includes('bio')
      && u.hp < u.maxHp
      && chebyshev(med.position, u.position) <= 1
    );
    if (target) {
      units = units.map(u => u.id === target.id
        ? { ...u, hp: Math.min(u.maxHp, u.hp + 2) } : u);
    }
  }

  // Regeneration: roach, reaper — regen 3 HP/turn when not at max
  units = units.map(u => {
    if (!u.alive || u.ownerId !== playerId) return u;
    if (!UNITS[u.type].special.includes('regenerate')) return u;
    if (u.hp >= u.maxHp) return u;
    return { ...u, hp: Math.min(u.maxHp, u.hp + 3) };
  });

  // Protoss shield regeneration: +1 per turn for all alive Protoss units
  units = units.map(u => {
    if (!u.alive || u.ownerId !== playerId) return u;
    if ((u.maxShields ?? 0) === 0 || u.shields >= u.maxShields) return u;
    return { ...u, shields: Math.min(u.maxShields, u.shields + 1) };
  });

  // Remove temporary units (locusts) spawned last turn
  units = units.filter(u => {
    if (!u.alive || u.ownerId !== playerId) return true;
    return !UNITS[u.type].special.includes('temporary');
  });

  // Spawn locusts from swarm hosts
  const swarmHosts = units.filter(u => u.alive && u.ownerId === playerId && u.type === 'swarmhost');
  let nextId = state.gameSpecific.nextId;
  for (const sh of swarmHosts) {
    for (let i = 0; i < 2; i++) {
      const sp = findAdjacentFree(sh.position, state.board, units, state.buildings);
      if (sp) {
        units = [...units, makeUnit(`u${nextId++}`, playerId, 'locust', sp.x, sp.y)];
      }
    }
  }

  return { ...state, units, gameSpecific: { ...state.gameSpecific, nextId } };
}

// ── Extra unit tech requirements ──────────────────────────────────────────────

function getUnitRequirements(unitType) {
  const reqs = {
    // Terran
    ghost:         ['ghost-academy'],
    thor:          ['armory'],
    battlecruiser: ['fusion-core'],
    // Zerg
    zergling:      ['spawning-pool'],
    baneling:      ['baneling-nest'],
    roach:         ['roach-warren'],
    ravager:       ['roach-warren'],
    hydralisk:     ['hydralisk-den'],
    lurker:        ['lurker-den'],
    infestor:      ['infestation-pit'],
    queen:         ['spawning-pool'],
    swarmhost:     ['infestation-pit'],
    ultralisk:     ['ultralisk-cavern'],
    mutalisk:      ['spire'],
    corruptor:     ['spire'],
    broodlord:     ['greater-spire'],
    // Protoss
    stalker:       ['cybernetics-core'],
    sentry:        ['cybernetics-core'],
    adept:         ['cybernetics-core'],
    'void-ray':    ['cybernetics-core'],
    'high-templar':['templar-archives'],
    'dark-templar':['dark-shrine'],
    archon:        ['templar-archives'],
    colossus:      ['robotics-bay'],
    carrier:       ['fleet-beacon'],
    tempest:       ['fleet-beacon'],
  };
  return reqs[unitType] ?? [];
}

// Units that can be warped in via warp-gate
const WARP_IN_UNITS = ['zealot','stalker','sentry','adept','high-templar','dark-templar','archon'];

// ── Legal actions ─────────────────────────────────────────────────────────────

export function getLegalActions(state, playerId) {
  const { units, buildings, board } = state;
  const myUnits     = units.filter(u => u.alive && u.ownerId === playerId);
  const myBuildings = buildings.filter(b => b.alive && b.ownerId === playerId);
  const enemies     = units.filter(u => u.alive && u.ownerId !== playerId);
  const enemyBldgs  = buildings.filter(b => b.alive && b.ownerId !== playerId);
  const resources   = getResources(state, playerId);
  const supply      = getSupply(state, playerId);
  const actions     = [];

  for (const unit of myUnits) {
    const stats   = UNITS[unit.type];
    const isWorker = stats.special.includes('worker');

    // ── Movement ──────────────────────────────────────────────────────────────
    if (unit.movesLeft > 0 && !unit.attrs.sieged && !unit.attrs.burrowed) {
      const reachable = getReachableTiles(unit, board, units, buildings, playerId);
      for (const to of reachable) {
        actions.push({ type: 'move', unitId: unit.id, from: unit.position, to });
      }
    }

    // ── Charge (zealot): extra move toward enemy ──────────────────────────────
    if (unit.type === 'zealot' && unit.movesLeft > 0 && hasBuilding(state, playerId, 'twilight-council')) {
      const nearEnemy = enemies.find(e => chebyshev(unit.position, e.position) <= 4 && e.domain === 'ground');
      if (nearEnemy) {
        // Provide 2 extra move tiles toward an enemy
        const reachable = getReachableTiles(
          { ...unit, movesLeft: unit.movesLeft + 2 }, board, units, buildings, playerId
        );
        for (const to of reachable) {
          if (!actions.some(a => a.type === 'move' && a.unitId === unit.id &&
              a.to.x === to.x && a.to.y === to.y)) {
            actions.push({ type: 'move', unitId: unit.id, from: unit.position, to, charge: true });
          }
        }
      }
    }

    // ── Attack ────────────────────────────────────────────────────────────────
    if (unit.attacksLeft > 0 && effectiveRange(unit) > 0 && !unit.attrs.burrowed) {
      if (!(stats.special.includes('burrow-attack') && !unit.attrs.burrowed)) {
        for (const enemy of enemies) {
          if (!inRange(unit, enemy.position)) continue;
          if (enemy.domain === 'air' && !stats.special.includes('anti-air') &&
              stats.range <= 1 && stats.domain !== 'air' && unit.type !== 'archon' &&
              unit.type !== 'thor') continue;
          actions.push({ type: 'attack', unitId: unit.id, targetId: enemy.id, targetType: 'unit' });
        }
        for (const eb of enemyBldgs) {
          if (!inRange(unit, eb.position)) continue;
          if (stats.special.includes('anti-air')) continue;
          actions.push({ type: 'attack', unitId: unit.id, targetId: eb.id, targetType: 'building' });
        }
      }
    }

    // Burrowed lurker attacks (if burrowed)
    if (unit.type === 'lurker' && unit.attrs.burrowed && unit.attacksLeft > 0) {
      for (const enemy of enemies) {
        if (inRange(unit, enemy.position)) {
          actions.push({ type: 'attack', unitId: unit.id, targetId: enemy.id, targetType: 'unit' });
        }
      }
    }

    // ── Worker actions ────────────────────────────────────────────────────────
    if (isWorker && unit.movesLeft > 0 && unit.attrs.gathering !== 'minerals') {
      const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
      const adjMineral = dirs.some(([dx,dy]) => {
        const k = `${unit.position.x+dx},${unit.position.y+dy}`;
        return board.tiles[k]?.terrain === 'minerals';
      });
      if (adjMineral) actions.push({ type: 'gather-minerals', unitId: unit.id });
    }

    if (isWorker && unit.movesLeft > 0 && unit.attrs.gathering !== 'gas') {
      const hasExtractor = buildings.some(b =>
        b.alive && b.ownerId === playerId && b.constructTurns === 0
        && BUILDINGS[b.type].special.includes('gas-extractor')
        && chebyshev(b.position, unit.position) <= 2
      );
      if (hasExtractor) actions.push({ type: 'gather-gas', unitId: unit.id });
    }

    if (isWorker && unit.attrs.gathering) {
      actions.push({ type: 'stop-gathering', unitId: unit.id });
    }

    if (isWorker && unit.movesLeft > 0) {
      const k    = `${unit.position.x},${unit.position.y}`;
      const tile = board.tiles[k];
      const td   = TERRAIN[tile?.terrain];
      const occupied = buildings.some(b => b.alive && b.position.x === unit.position.x && b.position.y === unit.position.y);

      if (!occupied) {
        const race = stats.race;
        for (const [btype, bdef] of Object.entries(BUILDINGS)) {
          if (bdef.race !== race) continue;
          if (bdef.buildTime === 0) continue;
          if (bdef.onVespene && tile?.terrain !== 'vespene') continue;
          if (!bdef.onVespene && !td?.buildable) continue;
          if (!hasRequirements(state, playerId, bdef.requirements)) continue;
          if (resources.minerals < bdef.cost.minerals || resources.gas < bdef.cost.gas) continue;
          actions.push({ type: 'build', unitId: unit.id, buildingType: btype });
        }
      }
    }

    // ── Stim pack (marine / marauder) ─────────────────────────────────────────
    if (stats.special.includes('stim') && unit.movesLeft > 0 && !unit.attrs.stimmed) {
      const hpCost = unit.type === 'marauder' ? 20 : 10;
      if (unit.hp > hpCost) {
        actions.push({ type: 'stim', unitId: unit.id });
      }
    }

    // ── Blink (stalker) ───────────────────────────────────────────────────────
    if (unit.type === 'stalker' && unit.movesLeft > 0 && hasBuilding(state, playerId, 'twilight-council')) {
      // Blink to any passable tile within range 8 not occupied by a unit/building
      const occupied = new Set([
        ...units.filter(u => u.alive && u.id !== unit.id).map(u => `${u.position.x},${u.position.y}`),
        ...buildings.filter(b => b.alive).map(b => `${b.position.x},${b.position.y}`),
      ]);
      for (let dy = -8; dy <= 8; dy++) {
        for (let dx = -8; dx <= 8; dx++) {
          const bx = unit.position.x + dx, by = unit.position.y + dy;
          if (chebyshev(unit.position, { x: bx, y: by }) > 8) continue;
          if (bx <= 0 || bx >= board.width - 1 || by <= 0 || by >= board.height - 1) continue;
          const k  = `${bx},${by}`;
          const t  = board.tiles[k];
          if (!t || !TERRAIN[t.terrain]?.passable.ground) continue;
          if (occupied.has(k)) continue;
          actions.push({ type: 'blink', unitId: unit.id, to: { x: bx, y: by } });
        }
      }
    }

    // ── Siege / unsiege (siege tank) ─────────────────────────────────────────
    if (unit.type === 'siege-tank' && unit.movesLeft > 0) {
      if (!unit.attrs.sieged) actions.push({ type: 'siege', unitId: unit.id });
      else                    actions.push({ type: 'unsiege', unitId: unit.id });
    }

    // ── Burrow / unburrow (roach, lurker) ─────────────────────────────────────
    if ((unit.type === 'roach' || unit.type === 'lurker') && unit.movesLeft > 0) {
      if (!unit.attrs.burrowed) actions.push({ type: 'burrow', unitId: unit.id });
      else                      actions.push({ type: 'unburrow', unitId: unit.id });
    }

    // ── Assault mode / fighter mode (viking) ──────────────────────────────────
    if (unit.type === 'viking' && unit.movesLeft > 0) {
      if (!unit.attrs.assaultMode) actions.push({ type: 'assault-mode', unitId: unit.id });
      else                         actions.push({ type: 'fighter-mode', unitId: unit.id });
    }

    // ── Queen: inject larva ───────────────────────────────────────────────────
    if (unit.type === 'queen' && unit.movesLeft > 0) {
      for (const b of myBuildings) {
        if (b.constructTurns > 0) continue;
        if (!['hatchery','lair','hive'].includes(b.type)) continue;
        if (b.attrs?.injected) continue;
        if (chebyshev(unit.position, b.position) <= 3) {
          actions.push({ type: 'inject-larva', unitId: unit.id, buildingId: b.id });
        }
      }
    }

    // ── Skip unit ─────────────────────────────────────────────────────────────
    actions.push({ type: 'skip-unit', unitId: unit.id });
  }

  // ── Building: set production ──────────────────────────────────────────────
  for (const b of myBuildings) {
    if (b.constructTurns > 0 || b.type === 'warp-gate') continue;
    const bdef = BUILDINGS[b.type];
    for (const unitType of (bdef.produces ?? [])) {
      if (!UNITS[unitType]) continue;
      const ucost = UNITS[unitType].cost;
      if (resources.minerals < ucost.minerals || resources.gas < ucost.gas) continue;
      const uSupply = UNITS[unitType].supply ?? 0;
      if (uSupply > 0 && supply.used + uSupply > supply.max) continue;
      if (b.queue?.unitType === unitType) continue;
      const extraReqs = getUnitRequirements(unitType);
      if (!hasRequirements(state, playerId, extraReqs)) continue;
      actions.push({ type: 'set-production', buildingId: b.id, unitType });
    }
  }

  // ── Gateway: morph to warp gate (if cybernetics-core present) ────────────
  if (hasBuilding(state, playerId, 'cybernetics-core')) {
    for (const b of myBuildings) {
      if (b.type === 'gateway' && b.constructTurns === 0 && !b.queue) {
        actions.push({ type: 'morph-to-warp-gate', buildingId: b.id });
      }
    }
  }

  // ── Warp gate: warp in units ──────────────────────────────────────────────
  for (const b of myBuildings) {
    if (b.type !== 'warp-gate' || b.constructTurns > 0) continue;
    if ((b.attrs?.cooldown ?? 0) > 0) continue;
    for (const unitType of WARP_IN_UNITS) {
      const ucost = UNITS[unitType].cost;
      if (resources.minerals < ucost.minerals || resources.gas < ucost.gas) continue;
      const uSupply = UNITS[unitType].supply ?? 0;
      if (uSupply > 0 && supply.used + uSupply > supply.max) continue;
      const extraReqs = getUnitRequirements(unitType);
      if (!hasRequirements(state, playerId, extraReqs)) continue;
      // Find all tiles within pylon power range that are empty and passable
      for (const pb of myBuildings) {
        if ((pb.type !== 'pylon' && pb.type !== 'nexus') || pb.constructTurns > 0) continue;
        for (let dy = -6; dy <= 6; dy++) {
          for (let dx = -6; dx <= 6; dx++) {
            const wx = pb.position.x + dx, wy = pb.position.y + dy;
            if (chebyshev(pb.position, { x: wx, y: wy }) > 6) continue;
            if (wx <= 0 || wx >= state.board.width - 1 || wy <= 0 || wy >= state.board.height - 1) continue;
            const k  = `${wx},${wy}`;
            const t  = state.board.tiles[k];
            if (!t || !TERRAIN[t.terrain]?.passable.ground) continue;
            const unitOccupied = units.some(u => u.alive && u.position.x === wx && u.position.y === wy);
            const bldgOccupied = buildings.some(bk => bk.alive && bk.position.x === wx && bk.position.y === wy);
            if (!unitOccupied && !bldgOccupied) {
              actions.push({ type: 'warp-in', buildingId: b.id, unitType, to: { x: wx, y: wy } });
            }
          }
        }
      }
    }
  }

  actions.push({ type: 'end-turn', unitId: '__player__' });
  return actions;
}

// ── Apply actions ─────────────────────────────────────────────────────────────

export function applyActions(state, playerActions, rng = Math.random) {
  const { playerId, action } = playerActions[0];
  let { units, buildings, board } = state;
  const playerIds  = state.players.map(p => p.id);
  const currentIdx = playerIds.indexOf(playerId);

  // ── end-turn ──────────────────────────────────────────────────────────────
  if (action.type === 'end-turn') {
    let s = processBuildingQueues(state, playerId, state.gameSpecific.nextId);
    s = collectIncome(s, playerId);

    const nextIdx      = (currentIdx + 1) % playerIds.length;
    const nextPlayerId = playerIds[nextIdx];
    const newTurn      = nextIdx === 0 ? s.turnNumber + 1 : s.turnNumber;

    // Apply passives and restore moves for next player
    s = processPassives(s, nextPlayerId);
    const newUnits = s.units.map(u => {
      if (u.ownerId !== nextPlayerId) return u;
      // Clear stim flag
      return { ...u, movesLeft: UNITS[u.type].moves, attacksLeft: 1, attrs: { ...u.attrs, stimmed: false } };
    });

    return {
      ...s,
      units: newUnits,
      activePlayers: [nextPlayerId],
      turnNumber: newTurn,
      lastActions: playerActions,
    };
  }

  // ── move ──────────────────────────────────────────────────────────────────
  if (action.type === 'move') {
    const tile    = board.tiles[`${action.to.x},${action.to.y}`];
    const td      = tile ? TERRAIN[tile.terrain] : null;
    const unit    = units.find(u => u.id === action.unitId);
    const moveCost = td?.moveCost || 1;
    const charge  = action.charge ? 0 : 0; // charge: consumed moves already counted in extra
    const newMoves = Math.max(0, unit.movesLeft - moveCost);
    units = units.map(u =>
      u.id === action.unitId
        ? { ...u, position: action.to, movesLeft: newMoves, attrs: { ...u.attrs, gathering: undefined } }
        : u
    );
    return { ...state, units, lastActions: playerActions };
  }

  // ── attack ────────────────────────────────────────────────────────────────
  if (action.type === 'attack') {
    const attacker = units.find(u => u.id === action.unitId);
    if (!attacker) return state;

    if (action.targetType === 'unit') {
      const defender = units.find(u => u.id === action.targetId);
      if (!defender) return state;

      const result   = resolveAttack(attacker, defender, state, rng);
      let newUnits   = units;

      if (result.hit) {
        const newShields = Math.max(0, defender.shields - result.shieldDmg);
        const newHp      = Math.max(0, defender.hp - result.hpDmg);
        const dead       = newHp <= 0;

        newUnits = units.map(u => {
          if (u.id === action.targetId) {
            return dead ? { ...u, alive: false, hp: 0, shields: 0 }
                        : { ...u, hp: newHp, shields: newShields };
          }
          if (u.id === action.unitId) {
            if (UNITS[u.type].special.includes('self-destruct')) {
              return { ...u, alive: false, hp: 0, attacksLeft: 0 };
            }
            return { ...u, attacksLeft: 0 };
          }
          return u;
        });

        // Splash: half damage to all units within 1 of target (not attacker or target)
        if (UNITS[attacker.type].special.includes('splash') && !result.missed) {
          newUnits = newUnits.map(u => {
            if (!u.alive || u.id === action.targetId || u.id === action.unitId) return u;
            if (chebyshev(u.position, defender.position) > 1) return u;
            const sShield = Math.max(0, u.shields - Math.floor(result.shieldDmg / 2));
            const sHp     = Math.max(0, u.hp - Math.floor(result.hpDmg / 2));
            return sHp <= 0 ? { ...u, alive: false, hp: 0, shields: 0 }
                            : { ...u, hp: sHp, shields: sShield };
          });
        }

        // Mutalisk bounce: deal 3 and 1 to two more random enemies in range
        if (attacker.type === 'mutalisk' && !dead) {
          const others = newUnits.filter(u =>
            u.alive && u.ownerId !== playerId && u.id !== action.targetId
            && chebyshev(u.position, defender.position) <= 5
          );
          let bounced = 0;
          const dmgs  = [3, 1];
          for (const t of others) {
            if (bounced >= 2) break;
            const d   = dmgs[bounced++];
            const sh  = Math.max(0, t.shields - Math.min(d, t.shields));
            const rem = d - (t.shields - sh);
            const hp  = Math.max(0, t.hp - Math.max(1, rem - (UNITS[t.type].armor ?? 0)));
            newUnits  = newUnits.map(u => u.id === t.id
              ? (hp <= 0 ? { ...u, alive: false, hp: 0 } : { ...u, hp, shields: sh }) : u);
          }
        }

        // Colossus laser: also hits all units in a line toward the target from attacker
        if (attacker.type === 'colossus' && !dead) {
          const dx = Math.sign(defender.position.x - attacker.position.x);
          const dy = Math.sign(defender.position.y - attacker.position.y);
          let cx = attacker.position.x + dx, cy = attacker.position.y + dy;
          while (cx !== defender.position.x || cy !== defender.position.y) {
            const laserDmg = 10;
            newUnits = newUnits.map(u => {
              if (!u.alive || u.id === action.targetId || (u.position.x !== cx || u.position.y !== cy)) return u;
              const sh = Math.max(0, u.shields - Math.min(laserDmg, u.shields));
              const hp = Math.max(0, u.hp - Math.max(1, laserDmg - (UNITS[u.type].armor ?? 0)));
              return hp <= 0 ? { ...u, alive: false, hp: 0, shields: 0 } : { ...u, hp, shields: sh };
            });
            cx += dx; cy += dy;
          }
        }
      } else {
        newUnits = units.map(u => u.id === action.unitId ? { ...u, attacksLeft: 0 } : u);
      }

      return { ...state, units: newUnits, lastActions: playerActions };
    }

    if (action.targetType === 'building') {
      const targetBldg = buildings.find(b => b.id === action.targetId);
      if (!targetBldg) return state;

      const result      = resolveAttackVsBuilding(attacker, targetBldg, state, rng);
      let newBuildings  = buildings;
      let newUnits      = units.map(u => u.id === action.unitId ? { ...u, attacksLeft: 0 } : u);

      if (result.hit) {
        const newShields = Math.max(0, targetBldg.shields - result.shieldDmg);
        const newHp      = Math.max(0, targetBldg.hp - result.hpDmg);
        newBuildings = buildings.map(b =>
          b.id === action.targetId
            ? (newHp <= 0 ? { ...b, alive: false, hp: 0 } : { ...b, hp: newHp, shields: newShields })
            : b
        );
      }
      return { ...state, units: newUnits, buildings: newBuildings, lastActions: playerActions };
    }

    return state;
  }

  // ── gather-minerals ───────────────────────────────────────────────────────
  if (action.type === 'gather-minerals') {
    units = units.map(u => u.id === action.unitId
      ? { ...u, movesLeft: 0, attrs: { ...u.attrs, gathering: 'minerals' } } : u);
    return { ...state, units, lastActions: playerActions };
  }

  // ── gather-gas ────────────────────────────────────────────────────────────
  if (action.type === 'gather-gas') {
    units = units.map(u => u.id === action.unitId
      ? { ...u, movesLeft: 0, attrs: { ...u.attrs, gathering: 'gas' } } : u);
    return { ...state, units, lastActions: playerActions };
  }

  // ── stop-gathering ────────────────────────────────────────────────────────
  if (action.type === 'stop-gathering') {
    units = units.map(u => u.id === action.unitId
      ? { ...u, attrs: { ...u.attrs, gathering: undefined } } : u);
    return { ...state, units, lastActions: playerActions };
  }

  // ── build ─────────────────────────────────────────────────────────────────
  if (action.type === 'build') {
    const worker  = units.find(u => u.id === action.unitId);
    const bdef    = BUILDINGS[action.buildingType];
    const nextId  = state.gameSpecific.nextId;
    const res     = getResources(state, playerId);

    const newBuilding = makeBuilding(`b${nextId}`, playerId, action.buildingType,
                                     worker.position.x, worker.position.y, bdef.buildTime);
    buildings = [...buildings, newBuilding];

    const newRes = { minerals: res.minerals - bdef.cost.minerals, gas: res.gas - bdef.cost.gas };
    units = units.map(u => u.id === action.unitId ? { ...u, alive: false } : u);

    return {
      ...state, units, buildings,
      lastActions: playerActions,
      gameSpecific: {
        ...state.gameSpecific,
        nextId: nextId + 1,
        resources: { ...state.gameSpecific.resources, [playerId]: newRes },
      },
    };
  }

  // ── set-production ────────────────────────────────────────────────────────
  if (action.type === 'set-production') {
    const unitStats = UNITS[action.unitType];
    const cost      = unitStats.cost;
    const res       = getResources(state, playerId);
    const newRes    = { minerals: res.minerals - cost.minerals, gas: res.gas - cost.gas };

    buildings = buildings.map(b => b.id === action.buildingId
      ? { ...b, queue: { unitType: action.unitType, turnsLeft: unitStats.buildTime } }
      : b);

    return {
      ...state, buildings,
      lastActions: playerActions,
      gameSpecific: {
        ...state.gameSpecific,
        resources: { ...state.gameSpecific.resources, [playerId]: newRes },
      },
    };
  }

  // ── morph-to-warp-gate ────────────────────────────────────────────────────
  if (action.type === 'morph-to-warp-gate') {
    buildings = buildings.map(b => b.id === action.buildingId
      ? { ...b, type: 'warp-gate', constructTurns: 3 } : b);
    return { ...state, buildings, lastActions: playerActions };
  }

  // ── warp-in ───────────────────────────────────────────────────────────────
  if (action.type === 'warp-in') {
    const unitStats = UNITS[action.unitType];
    const cost      = unitStats.cost;
    const res       = getResources(state, playerId);
    const newRes    = { minerals: res.minerals - cost.minerals, gas: res.gas - cost.gas };
    const nextId    = state.gameSpecific.nextId;

    const newUnit = makeUnit(`u${nextId}`, playerId, action.unitType, action.to.x, action.to.y);
    units = [...units, newUnit];

    buildings = buildings.map(b => b.id === action.buildingId
      ? { ...b, attrs: { ...b.attrs, cooldown: unitStats.buildTime } } : b);

    return {
      ...state, units, buildings,
      lastActions: playerActions,
      gameSpecific: {
        ...state.gameSpecific,
        nextId: nextId + 1,
        resources: { ...state.gameSpecific.resources, [playerId]: newRes },
      },
    };
  }

  // ── stim ──────────────────────────────────────────────────────────────────
  if (action.type === 'stim') {
    const hpCost = action.unitId && units.find(u => u.id === action.unitId)?.type === 'marauder' ? 20 : 10;
    units = units.map(u => u.id === action.unitId
      ? { ...u, hp: u.hp - hpCost, movesLeft: u.movesLeft + 1, attrs: { ...u.attrs, stimmed: true } }
      : u);
    return { ...state, units, lastActions: playerActions };
  }

  // ── blink ─────────────────────────────────────────────────────────────────
  if (action.type === 'blink') {
    units = units.map(u => u.id === action.unitId
      ? { ...u, position: action.to, movesLeft: 0 } : u);
    return { ...state, units, lastActions: playerActions };
  }

  // ── siege / unsiege ───────────────────────────────────────────────────────
  if (action.type === 'siege') {
    units = units.map(u => u.id === action.unitId
      ? { ...u, movesLeft: 0, attrs: { ...u.attrs, sieged: true } } : u);
    return { ...state, units, lastActions: playerActions };
  }
  if (action.type === 'unsiege') {
    units = units.map(u => u.id === action.unitId
      ? { ...u, movesLeft: 0, attrs: { ...u.attrs, sieged: false } } : u);
    return { ...state, units, lastActions: playerActions };
  }

  // ── burrow / unburrow ─────────────────────────────────────────────────────
  if (action.type === 'burrow') {
    units = units.map(u => u.id === action.unitId
      ? { ...u, movesLeft: 0, attrs: { ...u.attrs, burrowed: true } } : u);
    return { ...state, units, lastActions: playerActions };
  }
  if (action.type === 'unburrow') {
    units = units.map(u => u.id === action.unitId
      ? { ...u, movesLeft: 0, attrs: { ...u.attrs, burrowed: false } } : u);
    return { ...state, units, lastActions: playerActions };
  }

  // ── assault-mode / fighter-mode (viking) ──────────────────────────────────
  if (action.type === 'assault-mode') {
    units = units.map(u => u.id === action.unitId
      ? { ...u, domain: 'ground', movesLeft: 0, attrs: { ...u.attrs, assaultMode: true } } : u);
    return { ...state, units, lastActions: playerActions };
  }
  if (action.type === 'fighter-mode') {
    units = units.map(u => u.id === action.unitId
      ? { ...u, domain: 'air', movesLeft: 0, attrs: { ...u.attrs, assaultMode: false } } : u);
    return { ...state, units, lastActions: playerActions };
  }

  // ── inject-larva ──────────────────────────────────────────────────────────
  if (action.type === 'inject-larva') {
    buildings = buildings.map(b => b.id === action.buildingId
      ? { ...b, attrs: { ...b.attrs, injected: true } } : b);
    units = units.map(u => u.id === action.unitId
      ? { ...u, movesLeft: 0, attacksLeft: 0 } : u);
    return { ...state, units, buildings, lastActions: playerActions };
  }

  // ── skip-unit ─────────────────────────────────────────────────────────────
  if (action.type === 'skip-unit') {
    units = units.map(u => u.id === action.unitId
      ? { ...u, movesLeft: 0, attacksLeft: 0 } : u);
    return { ...state, units, lastActions: playerActions };
  }

  return state;
}

// ── Win condition ─────────────────────────────────────────────────────────────

export function getResult(state) {
  const playerIds = state.players.map(p => p.id);
  for (const pid of playerIds) {
    const mainTypes = ['command-center', 'hatchery', 'lair', 'hive', 'nexus'];
    const hasMain   = state.buildings.some(
      b => b.alive && b.ownerId === pid && mainTypes.includes(b.type)
    );
    const hasUnits  = state.units.some(u => u.alive && u.ownerId === pid &&
      !UNITS[u.type].special.includes('temporary'));
    if (!hasMain && !hasUnits) {
      const winner = playerIds.find(id => id !== pid);
      return { outcome: 'win', winnerId: winner, reason: 'base-destroyed' };
    }
  }
  return null;
}

// ── Render ────────────────────────────────────────────────────────────────────

export function renderState(state) {
  const { turnNumber, activePlayers, units, buildings, players } = state;
  const [p1, p2] = players;

  const summarize = pid => {
    const res      = getResources(state, pid);
    const sup      = getSupply(state, pid);
    const aliveU   = units.filter(u => u.alive && u.ownerId === pid &&
      !UNITS[u.type].special.includes('temporary'));
    const aliveB   = buildings.filter(b => b.alive && b.ownerId === pid);
    const unitStr  = aliveU.length
      ? aliveU.map(u => {
          const sh   = u.shields > 0 ? `/${u.shields}sh` : '';
          const attr = u.attrs.sieged ? '[S]' : u.attrs.burrowed ? '[B]' : u.attrs.stimmed ? '[!]' : '';
          return `${u.type}(${u.hp}hp${sh})${attr}`;
        }).join(', ')
      : '—';
    const bldgStr = aliveB.length
      ? aliveB.map(b => {
          const q = b.queue ? ` [${b.queue.unitType} T${b.queue.turnsLeft}]` : '';
          const c = b.constructTurns > 0 ? ` (T${b.constructTurns})` : '';
          const cd = b.attrs?.cooldown > 0 ? ` cd${b.attrs.cooldown}` : '';
          const inj = b.attrs?.injected ? ' [INJ]' : '';
          return `${b.type}${c}${q}${cd}${inj}`;
        }).join(', ')
      : '—';
    return [
      `${pid} | Minerals:${res.minerals}  Gas:${res.gas}  Supply:${sup.used}/${sup.max}`,
      `  Units: ${unitStr}`,
      `  Buildings: ${bldgStr}`,
    ].join('\n');
  };

  return [
    `═══ Turn ${turnNumber} — ${activePlayers[0]} to move ═══`,
    renderMap(state),
    `Terrain: .=open '=elevated /=ramp *=minerals %=vespene #=obstacle`,
    `Units uppercase=P1 lowercase=P2 | Buildings uppercase=P1 lowercase=P2 | (x)=under construction`,
    '',
    summarize(p1.id),
    '',
    summarize(p2.id),
  ].join('\n');
}

// ── createInitialState ────────────────────────────────────────────────────────

export function createInitialState(players, config = {}) {
  const width  = config.width  ?? 30;
  const height = config.height ?? 20;

  const [p1, p2] = players;
  const race1 = config.race1 ?? p1.race ?? 'terran';
  const race2 = config.race2 ?? p2.race ?? 'zerg';

  const tiles = generateMap(width, height);
  const board = { width, height, tiles };

  const pos1 = { x: 3, y: 3 };
  const pos2 = { x: width - 4, y: height - 4 };

  const mainBldg  = { terran: 'command-center', zerg: 'hatchery', protoss: 'nexus' };
  const workerType = { terran: 'scv', zerg: 'drone', protoss: 'probe' };

  let idCtr = 0;
  const buildings = [
    makeBuilding(`b${idCtr++}`, p1.id, mainBldg[race1], pos1.x, pos1.y, 0),
    makeBuilding(`b${idCtr++}`, p2.id, mainBldg[race2], pos2.x, pos2.y, 0),
  ];

  const workers   = [];
  const wkOffsets = [[1, 0], [2, 0], [0, 1], [1, 1]];
  for (const [dx, dy] of wkOffsets) {
    workers.push(makeUnit(`u${idCtr++}`, p1.id, workerType[race1], pos1.x + dx, pos1.y + dy));
    workers.push(makeUnit(`u${idCtr++}`, p2.id, workerType[race2], pos2.x - dx, pos2.y - dy));
  }

  const startMil = { terran: 'marine', zerg: 'zergling', protoss: 'zealot' };
  const milUnits = [];
  for (const [dx, dy] of [[3, 0], [0, 2], [3, 1]]) {
    milUnits.push(makeUnit(`u${idCtr++}`, p1.id, startMil[race1], pos1.x + dx, pos1.y + dy));
    milUnits.push(makeUnit(`u${idCtr++}`, p2.id, startMil[race2], pos2.x - dx, pos2.y - dy));
  }

  const units = [...workers, ...milUnits].filter(u => {
    const k = `${u.position.x},${u.position.y}`;
    const t = tiles[k];
    return t && TERRAIN[t.terrain]?.passable.ground;
  });

  return {
    gameName: 'SC2',
    turnNumber: 1,
    activePlayers: [p1.id],
    currentPhase: 'action',
    players,
    board,
    units,
    buildings,
    lastActions: null,
    gameSpecific: {
      nextId: idCtr,
      races: { [p1.id]: race1, [p2.id]: race2 },
      resources: {
        [p1.id]: { minerals: 50, gas: 0 },
        [p2.id]: { minerals: 50, gas: 0 },
      },
      fogOfWar: config.fogOfWar ?? false,
      startRoster: {
        units:     units.map(u => ({ ...u })),
        buildings: buildings.map(b => ({ ...b })),
      },
    },
  };
}

// ── Fog of war ────────────────────────────────────────────────────────────────

const VISION_RANGE = 3;

function getVisibleState(state, playerId) {
  const myUnits     = state.units.filter(u => u.alive && u.ownerId === playerId);
  const myBuildings = state.buildings.filter(b => b.alive && b.ownerId === playerId);
  const canSee = pos =>
    myUnits.some(m     => Math.max(Math.abs(m.position.x - pos.x), Math.abs(m.position.y - pos.y)) <= VISION_RANGE) ||
    myBuildings.some(b => Math.max(Math.abs(b.position.x - pos.x), Math.abs(b.position.y - pos.y)) <= VISION_RANGE);
  return {
    ...state,
    units:     state.units.filter(u     => u.ownerId === playerId || canSee(u.position)),
    buildings: state.buildings.filter(b => b.ownerId === playerId || canSee(b.position)),
  };
}

// ── Export ────────────────────────────────────────────────────────────────────

function getActionDuration(state, action) {
  if (action.type === 'move') {
    const unit = state.units.find(u => u.id === action.unitId);
    if (!unit) return 1;
    const from = action.from ?? unit.position;
    const dist = Math.max(Math.abs(action.to.x - from.x), Math.abs(action.to.y - from.y));
    return dist / (UNITS[unit.type]?.moves ?? 2);
  }
  if (action.type === 'attack') {
    const unit = state.units.find(u => u.id === action.unitId);
    if (!unit) return 1;
    const range = UNITS[unit.type]?.range ?? 1;
    return 1 / (range <= 1 ? 1.5 : 1);
  }
  if (action.type === 'build')  return 2;
  if (action.type === 'warp-in') return 1;
  return 1;
}

export const Sc2Game = {
  // Units plus buildings, main structures weighted heavily (destroying an
  // enemy's base and army wins). Leaf for the generic ObscuroAgent.
  evaluateState: (state, playerId) =>
    unitStrengthEval(state, playerId)
    + sidesEval(state.buildings, playerId, b =>
        ['command-center', 'hatchery', 'lair', 'hive', 'nexus'].includes(b.type) ? 300 : 80),
  name: 'SC2',
  scenarios: [
    { id: 'tvz', name: 'Terran vs Zerg',    description: 'Marines & siege tanks vs the Swarm',    config: { race1: 'terran',  race2: 'zerg' } },
    { id: 'pvt', name: 'Protoss vs Terran', description: 'High Templar vs Marauder bio ball',      config: { race1: 'protoss', race2: 'terran' } },
    { id: 'zvp', name: 'Zerg vs Protoss',   description: 'Roach-ravager vs stalker blink',         config: { race1: 'zerg',    race2: 'protoss' } },
  ],
  colors: { open: '#6a7a50', elevated: '#8a7060', ramp: '#9a8868', minerals: '#2060a0', vespene: '#20884a', obstacle: '#3a2818' },
  createInitialState,
  getLegalActions,
  applyActions,
  getResult,
  renderState,
  getVisibleState,
  getActionDuration,

  sampleWorlds(observation, playerId, n, rng = Math.random) {
    if (!observation.gameSpecific.fogOfWar) return [];
    const belief = getSc2Belief(observation, playerId);
    belief.beginTurn(observation);
    return belief.sample(observation, n, rng, makeUnit);
  },

  toGrid(state) {
    const { board, units = [], buildings = [] } = state;
    const { width, height, tiles } = board;
    const pidIdx = {};
    (state.players ?? []).forEach((p, i) => { pidIdx[p.id] = i + 1; });
    const umap = {}, bmap = {};
    for (const u of units) if (u.alive) umap[`${u.position.x},${u.position.y}`] = u;
    for (const b of buildings) if (b.alive) bmap[`${b.position.x},${b.position.y}`] = b;
    const cells = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tile = tiles[`${x},${y}`] ?? {};
        const u = umap[`${x},${y}`];
        const b = bmap[`${x},${y}`];
        cells.push({
          x, y: height - 1 - y,
          glyph: u ? u.type[0].toUpperCase() : b ? b.type[0].toUpperCase() : '',
          owner: u ? (pidIdx[u.ownerId] ?? 0) : b ? (pidIdx[b.ownerId] ?? 0) : 0,
          color: this.colors[tile.terrain] ?? this.colors.open ?? '#808070',
        });
      }
    }
    return { width, height, cells };
  },
};
