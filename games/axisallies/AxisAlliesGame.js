import { UNITS } from './units.js';
import { TERRITORIES, ADJACENCY, STARTING_OWNERS, STARTING_UNITS, CAPITALS } from './territories.js';
import { resolveBattle } from './combat.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function enemy(playerId) { return playerId === 'axis' ? 'allies' : 'axis'; }

/** BFS: territories reachable within `maxMoves` steps for a unit given its domain. */
function reachable(startTerritory, domain, maxMoves, board, units, playerId, combatMove) {
  const enemyId = enemy(playerId);
  const visited = new Map([[startTerritory, maxMoves]]);
  const queue = [{ t: startTerritory, m: maxMoves }];
  const destinations = [];

  // Pre-compute which territories have any unit (for blocking naval paths)
  const enemyNavalZones = new Set(
    units.filter(u => u.alive && u.ownerId === enemyId && UNITS[u.type].domain === 'sea')
          .map(u => u.territory)
  );

  while (queue.length) {
    const { t, m } = queue.shift();
    for (const adj of (board.adj[t] || [])) {
      if (visited.has(adj) && visited.get(adj) >= m - 1) continue;
      const info = board.territories[adj];

      // Domain constraints
      if (domain === 'land' && !info.isLand) continue;
      if (domain === 'sea'  &&  info.isLand) continue;
      // Air can fly anywhere

      if (m < 1) continue;
      visited.set(adj, m - 1);

      // During non-combat move, land units can't enter enemy territories
      if (!combatMove && domain === 'land' && board.ownership[adj] === enemyId) continue;

      destinations.push(adj);

      // Land: stop on entering enemy land territory (combat move) or friendly (ok to continue)
      const stopsHere = (domain === 'land' && board.ownership[adj] === enemyId)
        || (domain === 'sea' && enemyNavalZones.has(adj)); // naval: stop in contested sea zone

      if (!stopsHere && m - 1 > 0) {
        queue.push({ t: adj, m: m - 1 });
      }
    }
  }
  return [...new Set(destinations)].filter(t => t !== startTerritory);
}

// ── Unit factory ──────────────────────────────────────────────────────────────

let _idCtr = 0;
function makeUnit(ownerId, type, territory) {
  const stats = UNITS[type];
  return {
    id: `u${_idCtr++}`,
    ownerId,
    type,
    territory,
    alive: true,
    hp: stats.hp,
    maxHp: stats.hp,
    hasMoved: false,
    cargo: [], // for transports / carriers
  };
}

// ── Phase helpers ─────────────────────────────────────────────────────────────

function computeIncome(ownership) {
  return Object.entries(ownership).reduce((sum, [t, owner]) => {
    return owner ? sum + (TERRITORIES[t]?.ipc ?? 0) : sum;
  }, 0);
}

function computeIncomeFor(ownership, playerId) {
  return Object.entries(ownership)
    .filter(([, owner]) => owner === playerId)
    .reduce((sum, [t]) => sum + (TERRITORIES[t]?.ipc ?? 0), 0);
}

/** Return all territories that have both-side units → contested. */
function contestedTerritories(units, ownership) {
  const contested = new Set();
  for (const [territory] of Object.entries(ownership)) {
    const here = units.filter(u => u.alive && u.territory === territory);
    const hasAxis   = here.some(u => u.ownerId === 'axis');
    const hasAllies = here.some(u => u.ownerId === 'allies');
    if (hasAxis && hasAllies) contested.add(territory);
  }
  // Also check sea zones
  const seaZones = Object.keys(TERRITORIES).filter(t => !TERRITORIES[t].isLand);
  for (const sz of seaZones) {
    const here = units.filter(u => u.alive && u.territory === sz);
    const hasAxis   = here.some(u => u.ownerId === 'axis');
    const hasAllies = here.some(u => u.ownerId === 'allies');
    if (hasAxis && hasAllies) contested.add(sz);
  }
  return contested;
}

/** Auto-resolve combat in all contested territories. Returns { units, ownership }. */
function resolveAllCombat(state, rng) {
  let { units, board } = state;
  let ownership = { ...board.ownership };

  const contested = contestedTerritories(units, ownership);

  for (const territory of contested) {
    for (const attackerId of ['axis', 'allies']) {
      const defenderId = enemy(attackerId);
      const attackers = units.filter(u => u.alive && u.ownerId === attackerId && u.territory === territory);
      const defenders = units.filter(u => u.alive && u.ownerId === defenderId && u.territory === territory);
      if (!attackers.length || !defenders.length) continue;

      const result = resolveBattle(attackers, defenders, rng);

      const survivorIds = new Set([
        ...result.survivingAttackers.map(u => u.id),
        ...result.survivingDefenders.map(u => u.id),
      ]);
      const hpMap = new Map([
        ...result.survivingAttackers.map(u => [u.id, u.hp]),
        ...result.survivingDefenders.map(u => [u.id, u.hp]),
      ]);

      units = units.map(u => {
        if (u.territory !== territory) return u;
        if (!survivorIds.has(u.id)) return { ...u, alive: false };
        return { ...u, hp: hpMap.get(u.id) ?? u.hp };
      });

      // Update ownership if attacker won a land territory
      if (result.attackerWon && TERRITORIES[territory]?.isLand) {
        ownership[territory] = attackerId;
      }
      break; // only one combat per territory per resolution
    }
  }

  return { units, ownership };
}

// ── getLegalActions ───────────────────────────────────────────────────────────

function getLegalActions(state, playerId) {
  const { currentPhase } = state;

  if (currentPhase === 'purchase')         return getPurchaseActions(state, playerId);
  if (currentPhase === 'combat-move')      return getCombatMoveActions(state, playerId);
  if (currentPhase === 'non-combat-move')  return getNonCombatMoveActions(state, playerId);
  if (currentPhase === 'mobilize')         return getMobilizeActions(state, playerId);
  return [{ type: 'end-turn', unitId: '__player__' }];
}

function getPurchaseActions(state, playerId) {
  const ipc = state.gameSpecific.ipcs[playerId];
  const actions = [];
  for (const [unitType, stats] of Object.entries(UNITS)) {
    if (ipc >= stats.cost) {
      actions.push({ type: 'buy', unitId: '__purchase__', payload: { unit: unitType } });
    }
  }
  actions.push({ type: 'end-purchase', unitId: '__player__' });
  return actions;
}

function getCombatMoveActions(state, playerId) {
  const { units, board } = state;
  const myUnits = units.filter(u => u.alive && u.ownerId === playerId && !u.hasMoved);
  const actions = [];

  for (const unit of myUnits) {
    const stats = UNITS[unit.type];
    const dests = reachable(unit.territory, stats.domain, stats.moves, board, units, playerId, true);

    for (const dest of dests) {
      actions.push({ type: 'move', unitId: unit.id, from: unit.territory, to: dest });
    }

    // Board a transport: land units adjacent to a sea zone with friendly transport
    if (stats.domain === 'land') {
      for (const adj of (board.adj[unit.territory] || [])) {
        if (board.territories[adj]?.isLand) continue;
        const transports = units.filter(u =>
          u.alive && u.ownerId === playerId && u.type === 'transport' &&
          u.territory === adj && u.cargo.length < UNITS.transport.capacity
        );
        for (const tr of transports) {
          actions.push({ type: 'board', unitId: unit.id, transportId: tr.id });
        }
      }
    }

    // Unload transport cargo to adjacent land (amphibious assault)
    if (unit.type === 'transport' && unit.cargo.length > 0) {
      for (const adj of (board.adj[unit.territory] || [])) {
        if (!board.territories[adj]?.isLand) continue;
        if (board.ownership[adj] === playerId) continue; // only enemy/neutral for combat
        for (const cargoId of unit.cargo) {
          actions.push({ type: 'unload', unitId: cargoId, transportId: unit.id, to: adj });
        }
      }
    }

    actions.push({ type: 'skip-unit', unitId: unit.id });
  }

  actions.push({ type: 'end-combat-move', unitId: '__player__' });
  return actions;
}

function getNonCombatMoveActions(state, playerId) {
  const { units, board } = state;
  const myUnits = units.filter(u => u.alive && u.ownerId === playerId && !u.hasMoved);
  const actions = [];

  for (const unit of myUnits) {
    const stats = UNITS[unit.type];
    const dests = reachable(unit.territory, stats.domain, stats.moves, board, units, playerId, false);

    for (const dest of dests) {
      // Non-combat: land/air units can't move into enemy territory
      if ((stats.domain === 'land' || stats.domain === 'air') && board.ownership[dest] === enemy(playerId)) continue;
      // Non-combat: air units must land on land (no carrier logic yet)
      if (stats.domain === 'air' && !board.territories[dest].isLand) continue;
      actions.push({ type: 'move', unitId: unit.id, from: unit.territory, to: dest });
    }

    // Unload transport cargo to adjacent friendly land
    if (unit.type === 'transport' && unit.cargo.length > 0) {
      for (const adj of (board.adj[unit.territory] || [])) {
        if (!board.territories[adj]?.isLand) continue;
        if (board.ownership[adj] !== playerId) continue; // only friendly
        for (const cargoId of unit.cargo) {
          actions.push({ type: 'unload', unitId: cargoId, transportId: unit.id, to: adj });
        }
      }
    }

    actions.push({ type: 'skip-unit', unitId: unit.id });
  }

  actions.push({ type: 'end-non-combat-move', unitId: '__player__' });
  return actions;
}

function getMobilizeActions(state, playerId) {
  const pending = state.gameSpecific.pendingUnits[playerId];
  const actions = [];

  // Find territories the player owns that have a factory
  const myFactories = Object.entries(state.board.ownership)
    .filter(([t, owner]) => owner === playerId && TERRITORIES[t]?.factory)
    .map(([t]) => t);

  for (const { type } of pending) {
    const stats = UNITS[type];
    // Land/air units → land factories; sea units → sea zones adjacent to factories
    if (stats.domain === 'land' || stats.domain === 'air') {
      for (const factory of myFactories) {
        if (TERRITORIES[factory].isLand) {
          actions.push({ type: 'place', unitId: '__place__', payload: { unit: type, territory: factory } });
        }
      }
    } else {
      // Sea units: place in a sea zone adjacent to a friendly factory
      for (const factory of myFactories) {
        for (const adj of (ADJACENCY[factory] || [])) {
          if (!TERRITORIES[adj]?.isLand) {
            actions.push({ type: 'place', unitId: '__place__', payload: { unit: type, territory: adj } });
          }
        }
      }
    }
  }

  if (pending.length === 0 || actions.length === 0) {
    actions.push({ type: 'end-mobilize', unitId: '__player__' });
  }
  // Always allow skipping remaining placements
  if (actions.length > 0 && !actions.some(a => a.type === 'end-mobilize')) {
    actions.push({ type: 'end-mobilize', unitId: '__player__' });
  }

  return actions;
}

// ── applyActions ──────────────────────────────────────────────────────────────

function applyActions(state, playerActions, rng = Math.random) {
  const { playerId, action } = playerActions[0];

  switch (action.type) {
    case 'buy':             return handleBuy(state, playerId, action);
    case 'end-purchase':    return handleEndPurchase(state, playerId);
    case 'move':            return handleMove(state, playerId, action);
    case 'board':           return handleBoard(state, playerId, action);
    case 'unload':          return handleUnload(state, playerId, action);
    case 'skip-unit':       return handleSkipUnit(state, playerId, action);
    case 'end-combat-move': return handleEndCombatMove(state, playerId, rng);
    case 'end-non-combat-move': return handleEndNonCombatMove(state, playerId);
    case 'place':           return handlePlace(state, playerId, action);
    case 'end-mobilize':    return handleEndMobilize(state, playerId);
    default:                return state;
  }
}

function handleBuy(state, playerId, action) {
  const unitType = action.payload.unit;
  const cost = UNITS[unitType].cost;
  const { ipcs, pendingUnits } = state.gameSpecific;

  if (ipcs[playerId] < cost) return state;

  return {
    ...state,
    lastActions: [{ playerId, action }],
    gameSpecific: {
      ...state.gameSpecific,
      ipcs: { ...ipcs, [playerId]: ipcs[playerId] - cost },
      pendingUnits: {
        ...pendingUnits,
        [playerId]: [...pendingUnits[playerId], { type: unitType }],
      },
    },
  };
}

function handleEndPurchase(state, playerId) {
  return {
    ...state,
    currentPhase: 'combat-move',
    lastActions: [{ playerId, action: { type: 'end-purchase', unitId: '__player__' } }],
  };
}

function handleMove(state, playerId, action) {
  let { units } = state;
  const unit = units.find(u => u.id === action.unitId);
  if (!unit) return state;

  units = units.map(u => u.id === action.unitId ? { ...u, territory: action.to, hasMoved: true } : u);

  return { ...state, units, lastActions: [{ playerId, action }] };
}

function handleBoard(state, playerId, action) {
  let { units } = state;
  const landUnit = units.find(u => u.id === action.unitId);
  const transport = units.find(u => u.id === action.transportId);
  if (!landUnit || !transport) return state;

  // Land unit is "absorbed" into transport cargo; mark both as moved
  units = units.map(u => {
    if (u.id === action.transportId) return { ...u, cargo: [...u.cargo, landUnit.id] };
    if (u.id === action.unitId) return { ...u, hasMoved: true };
    return u;
  });

  return { ...state, units, lastActions: [{ playerId, action }] };
}

function handleUnload(state, playerId, action) {
  let { units, board } = state;
  const transport = units.find(u => u.id === action.transportId);
  const cargoUnit = units.find(u => u.id === action.unitId);
  if (!transport || !cargoUnit) return state;

  // Remove from cargo, place in territory
  units = units.map(u => {
    if (u.id === action.transportId) return { ...u, cargo: u.cargo.filter(id => id !== action.unitId) };
    if (u.id === action.unitId) return { ...u, territory: action.to, hasMoved: true };
    return u;
  });

  return { ...state, units, lastActions: [{ playerId, action }] };
}

function handleSkipUnit(state, playerId, action) {
  const units = state.units.map(u => u.id === action.unitId ? { ...u, hasMoved: true } : u);
  return { ...state, units, lastActions: [{ playerId, action }] };
}

function handleEndCombatMove(state, playerId, rng) {
  // Resolve all battles, then transition to non-combat-move
  const { units: resolvedUnits, ownership: resolvedOwnership } = resolveAllCombat(state, rng);

  // Reset hasMoved for non-combat-move phase (all units can potentially move)
  const units = resolvedUnits.map(u => ({ ...u, hasMoved: false }));

  return {
    ...state,
    units,
    board: { ...state.board, ownership: resolvedOwnership },
    currentPhase: 'non-combat-move',
    lastActions: [{ playerId, action: { type: 'end-combat-move', unitId: '__player__' } }],
  };
}

function handleEndNonCombatMove(state, playerId) {
  // Units that already moved in non-combat phase can't move again;
  // reset flags for next player's turn
  return {
    ...state,
    currentPhase: 'mobilize',
    lastActions: [{ playerId, action: { type: 'end-non-combat-move', unitId: '__player__' } }],
  };
}

function handlePlace(state, playerId, action) {
  const { pendingUnits } = state.gameSpecific;
  const queue = [...pendingUnits[playerId]];
  // Remove first matching pending unit
  const idx = queue.findIndex(p => p.type === action.payload.unit);
  if (idx === -1) return state;
  queue.splice(idx, 1);

  const newUnit = makeUnit(playerId, action.payload.unit, action.payload.territory);
  return {
    ...state,
    units: [...state.units, newUnit],
    lastActions: [{ playerId, action }],
    gameSpecific: {
      ...state.gameSpecific,
      pendingUnits: { ...pendingUnits, [playerId]: queue },
    },
  };
}

function handleEndMobilize(state, playerId) {
  const playerIds = state.players.map(p => p.id);
  const currentIdx = playerIds.indexOf(playerId);
  const nextIdx = (currentIdx + 1) % playerIds.length;
  const nextPlayerId = playerIds[nextIdx];
  const newTurnNumber = nextIdx === 0 ? state.turnNumber + 1 : state.turnNumber;

  // Collect income for the player whose turn is ending
  const income = computeIncomeFor(state.board.ownership, playerId);
  const newIpcs = { ...state.gameSpecific.ipcs, [playerId]: state.gameSpecific.ipcs[playerId] + income };

  // Reset hasMoved for all units (new turn starts)
  const units = state.units.map(u => ({ ...u, hasMoved: false }));

  return {
    ...state,
    units,
    turnNumber: newTurnNumber,
    activePlayers: [nextPlayerId],
    currentPhase: 'purchase',
    lastActions: [{ playerId, action: { type: 'end-mobilize', unitId: '__player__' } }],
    gameSpecific: {
      ...state.gameSpecific,
      ipcs: newIpcs,
      pendingUnits: { ...state.gameSpecific.pendingUnits, [playerId]: [] },
    },
  };
}

// ── Win condition ─────────────────────────────────────────────────────────────

function getResult(state) {
  const { board, units } = state;
  const { ownership } = board;

  for (const [attackerId, capital] of Object.entries(CAPITALS)) {
    const defenderId = enemy(attackerId);
    if (ownership[capital] === attackerId) continue; // still safe
    // Capital was captured by the enemy
    return { outcome: 'win', winnerId: defenderId, reason: `captured-${capital}` };
  }

  // Also check if either side has literally no units left
  for (const pid of ['axis', 'allies']) {
    if (!units.some(u => u.alive && u.ownerId === pid)) {
      return { outcome: 'win', winnerId: enemy(pid), reason: 'no-units' };
    }
  }

  return null;
}

// ── renderState ───────────────────────────────────────────────────────────────

function renderState(state) {
  const { turnNumber, activePlayers, units, board, players, gameSpecific, currentPhase } = state;
  const { ownership } = board;
  const { ipcs } = gameSpecific;

  const lines = [];
  lines.push(`╔══ Turn ${turnNumber} — ${activePlayers[0]} [${currentPhase}] ══╗`);
  lines.push(`  Axis IPCs: ${ipcs.axis}   Allies IPCs: ${ipcs.allies}`);
  lines.push('');

  const regions = [
    ['── Europe ─────────────────────────────────',
      ['germany','france','scandinavia','eastern-europe','southern-europe','uk','north-africa',
       'sz-north-sea','sz-north-atlantic','sz-mediterranean']],
    ['── USSR ────────────────────────────────────',
      ['moscow','karelia','ukraine','caucasus']],
    ['── Americas ────────────────────────────────',
      ['eastern-usa','western-usa']],
    ['── Asia/Pacific ────────────────────────────',
      ['japan','manchuria','china','india','philippines','dutch-east-indies','australia',
       'sz-north-pacific','sz-south-pacific','sz-indian-ocean']],
  ];

  for (const [header, territories] of regions) {
    lines.push(header);
    for (const t of territories) {
      const owner = ownership[t] ?? null;
      const ipc = TERRITORIES[t].ipc;
      const ownerSym = owner === 'axis' ? 'X' : owner === 'allies' ? 'L' : '-';
      const label = TERRITORIES[t].isLand ? `[${ownerSym}]` : `(${ownerSym})`;
      const factory = TERRITORIES[t].factory ? '⚙' : ' ';
      const here = units.filter(u => u.alive && u.territory === t);
      const unitStr = summarizeUnits(here);
      const ipcStr = ipc > 0 ? `$${ipc}` : '  ';
      lines.push(`  ${label}${factory} ${t.padEnd(22)} ${ipcStr.padStart(3)}  ${unitStr}`);
    }
    lines.push('');
  }

  for (const p of players) {
    const alive = units.filter(u => u.alive && u.ownerId === p.id);
    const income = computeIncomeFor(ownership, p.id);
    lines.push(`${p.id.toUpperCase()}: ${alive.length} units, ${income} IPC/turn, ${ipcs[p.id]} IPC in hand`);
  }

  return lines.join('\n');
}

function ownerSym(ownerId) { return ownerId === 'axis' ? 'X' : 'L'; }

function summarizeUnits(units) {
  if (!units.length) return '';
  const counts = {};
  for (const u of units) {
    const key = `${ownerSym(u.ownerId)}:${u.type[0]}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.entries(counts).map(([k, n]) => `${n}${k.split(':')[1]}(${k[0]})`).join(' ');
}

// ── createInitialState ────────────────────────────────────────────────────────

export function createInitialState(players, config = {}) {
  _idCtr = 0;

  const ownership = { ...STARTING_OWNERS };

  const units = [];
  for (const { ownerId, type, territory, count } of STARTING_UNITS) {
    for (let i = 0; i < count; i++) {
      units.push(makeUnit(ownerId, type, territory));
    }
  }

  const board = { territories: TERRITORIES, adj: ADJACENCY, ownership };

  return {
    gameName: 'AxisAllies',
    turnNumber: 1,
    activePlayers: [players[0].id],
    currentPhase: 'purchase',
    players,
    units,
    board,
    lastActions: null,
    gameSpecific: {
      ipcs: { axis: 30, allies: 36 },
      pendingUnits: { axis: [], allies: [] },
    },
  };
}

// ── Export ────────────────────────────────────────────────────────────────────

export const AxisAlliesGame = {
  name: 'AxisAllies',
  createInitialState,
  getLegalActions,
  applyActions,
  getResult,
  renderState,
  getVisibleState: (state) => state,
};
