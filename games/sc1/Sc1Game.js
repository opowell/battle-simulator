import { unitStrengthEval, sidesEval } from '../evalHelpers.js';
import { TERRAIN } from './terrain.js';
import { UNITS } from './units.js';
import { BUILDINGS } from './buildings.js';
import { resolveAttack, resolveAttackVsBuilding, inRange, chebyshev } from './combat.js';
import { generateMap, findAdjacentFree, getReachableTiles, renderMap } from './map.js';
import { getSc1Belief } from './belief.js';

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
    queue: null,  // { unitType, turnsLeft }
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
    .reduce((s, b) => s + (BUILDINGS[b.type].supplies ?? 0), 0)
    + state.units
      .filter(u => u.alive && u.ownerId === playerId && UNITS[u.type].special.includes('supply-8'))
      .length * 8;

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

// ── Income ────────────────────────────────────────────────────────────────────

function collectIncome(state, playerId) {
  const resources = { ...getResources(state, playerId) };

  // Workers gathering minerals: earn 8 minerals each
  const mineralWorkers = state.units.filter(
    u => u.alive && u.ownerId === playerId && UNITS[u.type].special.includes('worker')
      && u.attrs.gathering === 'minerals'
  );
  resources.minerals += mineralWorkers.length * 8;

  // Workers gathering gas (must be adjacent to a gas extractor building on vespene)
  const gasWorkers = state.units.filter(
    u => u.alive && u.ownerId === playerId && UNITS[u.type].special.includes('worker')
      && u.attrs.gathering === 'gas'
  );
  // Verify each has an extractor on an adjacent vespene
  for (const w of gasWorkers) {
    const hasExtractor = state.buildings.some(b =>
      b.alive && b.ownerId === playerId && b.constructTurns === 0
      && BUILDINGS[b.type].special.includes('gas-extractor')
      && chebyshev(b.position, w.position) <= 2
    );
    if (hasExtractor) resources.gas += 4;
  }

  return { ...state, gameSpecific: {
    ...state.gameSpecific,
    resources: { ...state.gameSpecific.resources, [playerId]: resources },
  }};
}

// ── Building production ───────────────────────────────────────────────────────

function processBuildingQueues(state, playerId, nextId) {
  let idCounter = nextId;
  let units = state.units;
  let resources = { ...getResources(state, playerId) };

  const buildings = state.buildings.map(b => {
    if (b.ownerId !== playerId || !b.alive) return b;

    // Advance construction
    if (b.constructTurns > 0) return { ...b, constructTurns: b.constructTurns - 1 };

    // Advance unit training queue
    if (!b.queue) return b;
    const { unitType, turnsLeft } = b.queue;
    if (turnsLeft > 1) return { ...b, queue: { ...b.queue, turnsLeft: turnsLeft - 1 } };

    // Unit is ready — spawn it
    const spawnPos = findAdjacentFree(b.position, state.board, units, state.buildings.filter(x => x.id !== b.id));
    if (!spawnPos) return b; // no room, queue stalls

    const count = UNITS[unitType]?.special.includes('pair') ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const sp = i === 0 ? spawnPos : findAdjacentFree(spawnPos, state.board, units, state.buildings.filter(x => x.id !== b.id));
      if (!sp) break;
      units = [...units, makeUnit(`u${idCounter++}`, playerId, unitType, sp.x, sp.y)];
    }
    return { ...b, queue: null };
  });

  return {
    ...state,
    units,
    buildings,
    gameSpecific: {
      ...state.gameSpecific,
      nextId: idCounter,
      resources: { ...state.gameSpecific.resources, [playerId]: resources },
    },
  };
}

// ── Shield regeneration ───────────────────────────────────────────────────────

function regenShields(state, playerId) {
  const units = state.units.map(u => {
    if (!u.alive || u.ownerId !== playerId) return u;
    if ((u.maxShields ?? 0) === 0 || u.shields >= u.maxShields) return u;
    return { ...u, shields: Math.min(u.maxShields, u.shields + 2) };
  });
  return { ...state, units };
}

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
    const stats = UNITS[unit.type];
    const isWorker = stats.special.includes('worker');

    // ── Movement ──────────────────────────────────────────────────────────────
    if (unit.movesLeft > 0 && !unit.attrs.sieged && !unit.attrs.burrowed) {
      const reachable = getReachableTiles(unit, board, units, buildings, playerId);
      for (const to of reachable) {
        actions.push({ type: 'move', unitId: unit.id, from: unit.position, to });
      }
    }

    // ── Attack ────────────────────────────────────────────────────────────────
    if (unit.attacksLeft > 0 && stats.range > 0) {
      // Lurkers can only attack when burrowed
      if (stats.special.includes('burrow-attack') && !unit.attrs.burrowed) {
        // skip attack
      } else {
        for (const enemy of enemies) {
          if (inRange(unit, enemy.position)) {
            // Air units can't be attacked by ground-only attackers
            if (enemy.domain === 'air' && !stats.special.includes('anti-air') &&
                !stats.special.includes('bonus-air-20') && stats.domain !== 'air' &&
                stats.range <= 1) continue;
            actions.push({ type: 'attack', unitId: unit.id, targetId: enemy.id, targetType: 'unit' });
          }
        }
        for (const eb of enemyBldgs) {
          if (inRange(unit, eb.position) && !stats.special.includes('anti-air')) {
            actions.push({ type: 'attack', unitId: unit.id, targetId: eb.id, targetType: 'building' });
          }
        }
      }
    }

    // ── Worker: gather minerals ───────────────────────────────────────────────
    if (isWorker && unit.movesLeft > 0 && unit.attrs.gathering !== 'minerals') {
      // Adjacent to a mineral tile?
      const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
      const adjMineral = dirs.some(([dx,dy]) => {
        const k = `${unit.position.x+dx},${unit.position.y+dy}`;
        return board.tiles[k]?.terrain === 'minerals';
      });
      if (adjMineral) {
        actions.push({ type: 'gather-minerals', unitId: unit.id });
      }
    }

    // ── Worker: gather gas ────────────────────────────────────────────────────
    if (isWorker && unit.movesLeft > 0 && unit.attrs.gathering !== 'gas') {
      const hasExtractor = buildings.some(b =>
        b.alive && b.ownerId === playerId && b.constructTurns === 0
        && BUILDINGS[b.type].special.includes('gas-extractor')
        && chebyshev(b.position, unit.position) <= 2
      );
      if (hasExtractor) {
        actions.push({ type: 'gather-gas', unitId: unit.id });
      }
    }

    // ── Worker: stop gathering ────────────────────────────────────────────────
    if (isWorker && unit.attrs.gathering) {
      actions.push({ type: 'stop-gathering', unitId: unit.id });
    }

    // ── Worker: build ─────────────────────────────────────────────────────────
    if (isWorker && unit.movesLeft > 0) {
      const k = `${unit.position.x},${unit.position.y}`;
      const tile = board.tiles[k];
      const td   = TERRAIN[tile?.terrain];
      const occupied = buildings.some(b => b.alive && b.position.x === unit.position.x && b.position.y === unit.position.y);

      if (!occupied) {
        const race = UNITS[unit.type].race;
        for (const [btype, bdef] of Object.entries(BUILDINGS)) {
          if (bdef.race !== race) continue;
          if (bdef.buildTime === 0) continue; // can't build starting buildings
          if (bdef.onVespene && tile?.terrain !== 'vespene') continue;
          if (!bdef.onVespene && !td?.buildable) continue;
          if (!hasRequirements(state, playerId, bdef.requirements)) continue;
          if (resources.minerals < bdef.cost.minerals || resources.gas < bdef.cost.gas) continue;
          actions.push({ type: 'build', unitId: unit.id, buildingType: btype });
        }
      }
    }

    // ── Siege tank: siege / unsiege ───────────────────────────────────────────
    if (unit.type === 'siege-tank' && unit.movesLeft > 0) {
      if (!unit.attrs.sieged) {
        actions.push({ type: 'siege', unitId: unit.id });
      } else {
        actions.push({ type: 'unsiege', unitId: unit.id });
      }
    }

    // ── Lurker: burrow / unburrow ─────────────────────────────────────────────
    if (unit.type === 'lurker' && unit.movesLeft > 0) {
      if (!unit.attrs.burrowed) {
        actions.push({ type: 'burrow', unitId: unit.id });
      } else {
        actions.push({ type: 'unburrow', unitId: unit.id });
      }
    }

    // ── Skip unit ─────────────────────────────────────────────────────────────
    actions.push({ type: 'skip-unit', unitId: unit.id });
  }

  // ── Building: set production ─────────────────────────────────────────────────
  for (const b of myBuildings) {
    if (b.constructTurns > 0) continue;
    const bdef = BUILDINGS[b.type];
    for (const unitType of (bdef.produces ?? [])) {
      if (!UNITS[unitType]) continue;
      const ucost = UNITS[unitType].cost;
      if (resources.minerals < ucost.minerals || resources.gas < ucost.gas) continue;
      const uSupply = UNITS[unitType].supply ?? 0;
      if (uSupply > 0 && supply.used + uSupply > supply.max) continue;
      if (b.queue?.unitType === unitType) continue; // already queued
      // Check extra requirements for advanced units
      const extraReqs = getUnitRequirements(unitType);
      if (!hasRequirements(state, playerId, extraReqs)) continue;
      actions.push({ type: 'set-production', buildingId: b.id, unitType });
    }
  }

  actions.push({ type: 'end-turn', unitId: '__player__' });
  return actions;
}

// Extra requirements for units beyond just their buildingType
function getUnitRequirements(unitType) {
  const reqs = {
    ghost:            ['barracks','engineering-bay'],
    hydralisk:        ['hydralisk-den'],
    lurker:           ['hydralisk-den'],
    mutalisk:         ['spire'],
    scourge:          ['spire'],
    ultralisk:        ['ultralisk-cavern'],
    'high-templar':   ['templar-archives'],
    'dark-templar':   ['templar-archives'],
    archon:           ['templar-archives'],
    corsair:          ['stargate'],
    carrier:          ['stargate'],
    arbiter:          ['stargate'],
    scout:            ['stargate'],
  };
  return reqs[unitType] ?? [];
}

// ── Apply actions ─────────────────────────────────────────────────────────────

export function applyActions(state, playerActions, rng = Math.random) {
  const { playerId, action } = playerActions[0];
  let { units, buildings, board } = state;
  const playerIds = state.players.map(p => p.id);
  const currentIdx = playerIds.indexOf(playerId);

  // ── end-turn ──────────────────────────────────────────────────────────────
  if (action.type === 'end-turn') {
    // Process building queues and resource income for the player who just ended
    let s = processBuildingQueues(state, playerId, state.gameSpecific.nextId);
    s = collectIncome(s, playerId);

    const nextIdx = (currentIdx + 1) % playerIds.length;
    const nextPlayerId = playerIds[nextIdx];
    const newTurn = nextIdx === 0 ? s.turnNumber + 1 : s.turnNumber;

    // Restore moves and attacks for the next player's units
    const newUnits = s.units.map(u => {
      if (u.ownerId !== nextPlayerId) return u;
      // Shield regen for Protoss
      const shieldRegen = (u.maxShields ?? 0) > 0 ? Math.min(u.maxShields, u.shields + 2) : u.shields;
      return { ...u, movesLeft: UNITS[u.type].moves, attacksLeft: 1, shields: shieldRegen };
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
    const tile = board.tiles[`${action.to.x},${action.to.y}`];
    const td   = tile ? TERRAIN[tile.terrain] : null;
    const unit = units.find(u => u.id === action.unitId);
    const cost = td?.moveCost ?? 1;
    const newMoves = Math.max(0, unit.movesLeft - cost);
    units = units.map(u =>
      u.id === action.unitId ? { ...u, position: action.to, movesLeft: newMoves, attrs: { ...u.attrs, gathering: undefined } } : u
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

      const result = resolveAttack(attacker, defender, state, rng);
      let newUnits = units;

      if (result.hit) {
        const newShields = Math.max(0, defender.shields - result.shieldDmg);
        const newHp      = Math.max(0, defender.hp - result.hpDmg);
        const dead = newHp <= 0;
        newUnits = units.map(u => {
          if (u.id === action.targetId) {
            return dead ? { ...u, alive: false, hp: 0, shields: 0 }
                        : { ...u, hp: newHp, shields: newShields };
          }
          if (u.id === action.unitId) {
            // Self-destruct (scourge)
            if (UNITS[u.type].special.includes('self-destruct')) {
              return { ...u, alive: false, hp: 0, attacksLeft: 0 };
            }
            return { ...u, attacksLeft: 0 };
          }
          return u;
        });

        // Splash: deal half damage to all other units in range 1 of target
        if (UNITS[attacker.type].special.includes('splash') && !result.missed) {
          newUnits = newUnits.map(u => {
            if (!u.alive || u.id === action.targetId || u.id === action.unitId) return u;
            if (chebyshev(u.position, defender.position) > 1) return u;
            const splashDmg = Math.floor(result.hpDmg / 2);
            const sh = Math.max(0, u.shields - Math.floor(result.shieldDmg / 2));
            const hp = Math.max(0, u.hp - splashDmg);
            return hp <= 0 ? { ...u, alive: false, hp: 0, shields: 0 }
                           : { ...u, hp, shields: sh };
          });
        }
      } else {
        newUnits = units.map(u => u.id === action.unitId ? { ...u, attacksLeft: 0 } : u);
      }
      return { ...state, units: newUnits, lastActions: playerActions };
    }

    if (action.targetType === 'building') {
      const targetBldg = buildings.find(b => b.id === action.targetId);
      if (!targetBldg) return state;

      const result = resolveAttackVsBuilding(attacker, targetBldg, state, rng);
      let newBuildings = buildings;
      let newUnits = units.map(u => u.id === action.unitId ? { ...u, attacksLeft: 0 } : u);

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

    // Deduct cost
    const newRes = { minerals: res.minerals - bdef.cost.minerals, gas: res.gas - bdef.cost.gas };

    // Zerg drones morph into buildings (consumed); Terran/Protoss workers stay alive
    const workerRace = UNITS[worker.type].race;
    if (workerRace === 'zerg') {
      units = units.map(u => u.id === action.unitId ? { ...u, alive: false } : u);
    } else {
      units = units.map(u => u.id === action.unitId ? { ...u, movesLeft: 0 } : u);
    }

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
    const building  = buildings.find(b => b.id === action.buildingId);
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
    const hasMain = state.buildings.some(
      b => b.alive && b.ownerId === pid && mainTypes.includes(b.type)
    );
    const hasAnyUnit = state.units.some(u => u.alive && u.ownerId === pid);
    if (!hasMain && !hasAnyUnit) {
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
    const res  = getResources(state, pid);
    const sup  = getSupply(state, pid);
    const aliveUnits = units.filter(u => u.alive && u.ownerId === pid);
    const aliveBldgs = buildings.filter(b => b.alive && b.ownerId === pid);
    const unitStr = aliveUnits.length
      ? aliveUnits.map(u => `${u.type}(${u.hp}hp${u.shields > 0 ? `/${u.shields}sh` : ''})`).join(', ')
      : '—';
    const bldgStr = aliveBldgs.length
      ? aliveBldgs.map(b => {
          const q = b.queue ? ` [${b.queue.unitType} T${b.queue.turnsLeft}]` : '';
          const c = b.constructTurns > 0 ? ` (bldg T${b.constructTurns})` : '';
          return `${b.type}${c}${q}`;
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
    `Units uppercase=P1 lowercase=P2 | Buildings: uppercase=P1 lowercase=P2 | ()=under construction`,
    '',
    summarize(p1.id),
    '',
    summarize(p2.id),
  ].join('\n');
}

// ── createInitialState ────────────────────────────────────────────────────────

export function createInitialState(players, config = {}) {
  const width  = config.width  ?? 28;
  const height = config.height ?? 18;

  const [p1, p2] = players;
  const race1 = config.race1 ?? p1.race ?? 'terran';
  const race2 = config.race2 ?? p2.race ?? 'zerg';

  const tiles = generateMap(width, height);
  const board = { width, height, tiles };

  // Starting positions
  const pos1 = { x: 3, y: 3 };   // P1: bottom-left
  const pos2 = { x: width - 4, y: height - 4 };  // P2: top-right

  // Main building type per race
  const mainBldg = { terran: 'command-center', zerg: 'hatchery', protoss: 'nexus' };
  const workerType = { terran: 'scv', zerg: 'drone', protoss: 'probe' };

  let idCtr = 0;
  const buildings = [
    makeBuilding(`b${idCtr++}`, p1.id, mainBldg[race1], pos1.x, pos1.y, 0),
    makeBuilding(`b${idCtr++}`, p2.id, mainBldg[race2], pos2.x, pos2.y, 0),
  ];

  // Starting workers near each base
  const workerOffsets = [[1, 0], [2, 0], [0, 1], [1, 1]];
  const units = [];

  for (const [dx, dy] of workerOffsets) {
    units.push(makeUnit(`u${idCtr++}`, p1.id, workerType[race1], pos1.x + dx, pos1.y + dy));
    units.push(makeUnit(`u${idCtr++}`, p2.id, workerType[race2], pos2.x - dx, pos2.y - dy));
  }

  // Starting military units
  const startMilitary = { terran: 'marine', zerg: 'zergling', protoss: 'zealot' };
  const mil = startMilitary;
  for (const [dx, dy] of [[3, 0], [0, 2]]) {
    units.push(makeUnit(`u${idCtr++}`, p1.id, mil[race1], pos1.x + dx, pos1.y + dy));
    units.push(makeUnit(`u${idCtr++}`, p2.id, mil[race2], pos2.x - dx, pos2.y - dy));
  }

  return {
    gameName: 'SC1',
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
      // Snapshot of all starting units and buildings — used by belief.js to seed
      // the fog tracker with common-knowledge starting positions.
      startRoster: {
        units:     units.map(u => ({ ...u })),
        buildings: buildings.map(b => ({ ...b })),
      },
    },
  };
}

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
    return 1 / (range <= 1 ? 1.5 : 1);  // melee attacks faster than ranged
  }
  return 1;
}

export const Sc1Game = {
  // Units plus buildings, main structures weighted heavily (destroying an
  // enemy's base and army wins). Leaf for the generic ObscuroAgent.
  evaluateState: (state, playerId) =>
    unitStrengthEval(state, playerId)
    + sidesEval(state.buildings, playerId, b =>
        ['command-center', 'hatchery', 'lair', 'hive', 'nexus'].includes(b.type) ? 300 : 80),
  name: 'SC1',
  scenarios: [
    { id: 'tvz', name: 'Terran vs Zerg',    description: 'Biomech forces vs the Swarm',          config: { race1: 'terran',   race2: 'zerg' } },
    { id: 'pvt', name: 'Protoss vs Terran', description: 'Psionic warriors vs human marines',    config: { race1: 'protoss',  race2: 'terran' } },
    { id: 'zvp', name: 'Zerg vs Protoss',   description: 'Hive swarm vs shielded Templar',       config: { race1: 'zerg',     race2: 'protoss' } },
  ],
  colors: { open: '#6a7a50', elevated: '#8a7060', ramp: '#9a8868', minerals: '#2060a0', vespene: '#20884a', obstacle: '#3a2818' },
  createInitialState,
  getLegalActions,
  applyActions,
  getResult,
  renderState,
  getVisibleState,
  getActionDuration,

  // Fog belief sampler for the generic ObscuroAgent. Returns [] when fog is off
  // (agent uses the observation as the single world).
  sampleWorlds(observation, playerId, n, rng = Math.random) {
    if (!observation.gameSpecific.fogOfWar) return [];
    const belief = getSc1Belief(observation, playerId);
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
