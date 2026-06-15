import { UNIT_DEFS, createUnit } from './units.js';
import { createMap, renderMap } from './map.js';
import { getReachable } from './grid.js';
import { hasLOS } from './los.js';
import { resolveFire } from './combat.js';

// ── Scenario ──────────────────────────────────────────────────────────────────

function createScenario(players) {
  const [allied, axis] = players;
  let n = 0;
  const id = () => `u${n++}`;
  return [
    // Allies (US) — deploy in northern half (y 1–6)
    createUnit(id(), 'rifle-squad',  allied.id, { x:  1, y:  2 }),
    createUnit(id(), 'rifle-squad',  allied.id, { x:  8, y:  1 }),
    createUnit(id(), 'mg-team',      allied.id, { x:  1, y:  4 }),
    createUnit(id(), 'sniper',       allied.id, { x:  5, y:  1 }),
    createUnit(id(), 'bazooka-team', allied.id, { x:  3, y:  3 }),
    createUnit(id(), 'mortar-team',  allied.id, { x:  2, y:  6 }),
    createUnit(id(), 'sherman',      allied.id, { x:  9, y:  5 }),
    createUnit(id(), 'stuart',       allied.id, { x: 14, y:  4 }),
    // Axis (German) — deploy in southern half (y 8–14)
    createUnit(id(), 'volks-squad',   axis.id,  { x:  1, y: 14 }),
    createUnit(id(), 'volks-squad',   axis.id,  { x: 11, y: 14 }),
    createUnit(id(), 'mg42-team',     axis.id,  { x: 18, y: 10 }),
    createUnit(id(), 'german-sniper', axis.id,  { x: 14, y: 14 }),
    createUnit(id(), 'panzerschreck', axis.id,  { x: 16, y: 11 }),
    createUnit(id(), 'mortar-ger',    axis.id,  { x: 17, y: 13 }),
    createUnit(id(), 'panzer-iv',     axis.id,  { x:  5, y: 12 }),
    createUnit(id(), 'tiger',         axis.id,  { x: 11, y:  9 }),
  ];
}

// ── Legal actions ─────────────────────────────────────────────────────────────

function getLegalActions(state, playerId) {
  const { units, board } = state;
  const myUnits = units.filter(u => u.alive && u.ownerId === playerId && u.perTurn.ap > 0);
  const actions = [];

  for (const unit of myUnits) {
    const def = UNIT_DEFS[unit.type];

    // Move (1 AP)
    const reachable = getReachable(board, unit.position, def.moveRange, units);
    for (const to of reachable) {
      actions.push({ type: 'move', unitId: unit.id, to });
    }

    // Fire (1 AP) — target must be in range and have LOS
    const enemies = units.filter(u => u.alive && u.ownerId !== playerId);
    for (const enemy of enemies) {
      const dist = Math.sqrt(
        (enemy.position.x - unit.position.x) ** 2 +
        (enemy.position.y - unit.position.y) ** 2
      );
      if (dist <= def.range && hasLOS(board, unit.position, enemy.position)) {
        actions.push({ type: 'fire', unitId: unit.id, targetId: enemy.id });
      }
    }

    actions.push({ type: 'skip-unit', unitId: unit.id });
  }

  actions.push({ type: 'end-turn', unitId: '__player__' });
  return actions;
}

// ── Apply actions ─────────────────────────────────────────────────────────────

function applyActions(state, playerActions, rng = Math.random) {
  const { playerId, action } = playerActions[0];
  let { units } = state;
  const playerIds = state.players.map(p => p.id);
  const currentIdx = playerIds.indexOf(playerId);

  if (action.type === 'end-turn') {
    const nextIdx = (currentIdx + 1) % playerIds.length;
    const nextPlayerId = playerIds[nextIdx];
    const newTurn = nextIdx === 0 ? state.turnNumber + 1 : state.turnNumber;

    // Restore AP and decay suppression for the player who is about to move
    units = units.map(u => {
      if (u.ownerId !== nextPlayerId) return u;
      return {
        ...u,
        perTurn: { ap: UNIT_DEFS[u.type].ap },
        suppression: Math.max(0, u.suppression - 1),
      };
    });

    return {
      ...state, units,
      activePlayers: [nextPlayerId],
      turnNumber: newTurn,
      lastActions: playerActions,
    };
  }

  if (action.type === 'move') {
    units = units.map(u =>
      u.id === action.unitId
        ? { ...u, position: action.to, perTurn: { ...u.perTurn, ap: u.perTurn.ap - 1 } }
        : u
    );
    return { ...state, units, lastActions: playerActions };
  }

  if (action.type === 'fire') {
    const shooter = units.find(u => u.id === action.unitId);
    const target  = units.find(u => u.id === action.targetId);
    if (!shooter || !target) return state;

    const result = resolveFire(shooter, target, state.board, rng);

    units = units.map(u => {
      if (u.id === action.unitId) {
        return { ...u, perTurn: { ...u.perTurn, ap: u.perTurn.ap - 1 } };
      }
      if (u.id === action.targetId) {
        const newHp = Math.max(0, u.hp - result.damage);
        return { ...u, hp: newHp, alive: newHp > 0, suppression: u.suppression + result.targetSuppression };
      }
      return u;
    });

    return {
      ...state, units, lastActions: playerActions,
      gameSpecific: { ...state.gameSpecific, lastCombat: result },
    };
  }

  if (action.type === 'skip-unit') {
    units = units.map(u =>
      u.id === action.unitId ? { ...u, perTurn: { ...u.perTurn, ap: 0 } } : u
    );
    return { ...state, units, lastActions: playerActions };
  }

  return state;
}

// ── Win condition ─────────────────────────────────────────────────────────────

function getResult(state) {
  for (const pid of state.players.map(p => p.id)) {
    if (!state.units.some(u => u.ownerId === pid && u.alive)) {
      const winner = state.players.find(p => p.id !== pid).id;
      return { outcome: 'win', winnerId: winner, reason: 'all-units-eliminated' };
    }
  }
  return null;
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderState(state) {
  const { turnNumber, activePlayers, units, players, gameSpecific } = state;

  const summarize = pid => {
    const name = players.find(p => p.id === pid).name;
    const alive = units.filter(u => u.ownerId === pid && u.alive);
    if (!alive.length) return `${name}: (eliminated)`;
    return `${name}: ` + alive.map(u => {
      const sup = u.suppression > 0 ? ` sup:${u.suppression}` : '';
      return `${UNIT_DEFS[u.type].label}(${u.hp}hp${sup})`;
    }).join(', ');
  };

  const combatLine = gameSpecific?.lastCombat
    ? `Last fire: ${gameSpecific.lastCombat.hit ? 'HIT' : 'MISS'} ` +
      `(roll ${gameSpecific.lastCombat.roll}/${gameSpecific.lastCombat.hitChance}% needed) ` +
      `dmg=${gameSpecific.lastCombat.damage}`
    : '';

  return [
    `═══ Turn ${turnNumber} — ${activePlayers[0]} ═══`,
    renderMap(state.board, units),
    `Legend: R=Rifle G=MG N=Sniper Z=Bazooka O=Mortar S=Sherman U=Stuart  |  V=Volks M=MG42 X=GSniper P=Pzschreck Q=GMortar F=PanzerIV K=Tiger  |  w=hedge T=trees r=road #=building`,
    '',
    summarize(players[0].id),
    summarize(players[1].id),
    combatLine,
  ].filter(Boolean).join('\n');
}

// ── createInitialState ────────────────────────────────────────────────────────

function createInitialState(players, config = {}) {
  const board = createMap();
  const units = config.units ?? createScenario(players);
  return {
    gameName: 'CombatMission',
    turnNumber: 1,
    activePlayers: [players[0].id],
    currentPhase: 'action',
    players,
    board,
    units,
    lastActions: null,
    gameSpecific: { lastCombat: null },
  };
}

// ── Fog of war ────────────────────────────────────────────────────────────────

function getVisibleState(state, playerId) {
  const VISION = 5;
  const myUnits = state.units.filter(u => u.alive && u.ownerId === playerId);
  return {
    ...state,
    units: state.units.filter(u =>
      u.ownerId === playerId ||
      myUnits.some(m =>
        Math.max(Math.abs(m.position.x - u.position.x), Math.abs(m.position.y - u.position.y)) <= VISION &&
        hasLOS(state.board, m.position, u.position)
      )
    ),
  };
}

// ── Export ────────────────────────────────────────────────────────────────────

function getActionDuration(state, action) {
  if (action.type === 'move') {
    const unit = state.units.find(u => u.id === action.unitId);
    if (!unit) return 1;
    const from = unit.position;
    const dist = Math.max(Math.abs(action.to.x - from.x), Math.abs(action.to.y - from.y));
    return dist / (UNIT_DEFS[unit.type]?.moveRange ?? 2);
  }
  if (action.type === 'fire') {
    const unit   = state.units.find(u => u.id === action.unitId);
    const target = state.units.find(u => u.id === action.targetId);
    if (!unit || !target) return 1;
    const dx = target.position.x - unit.position.x;
    const dy = target.position.y - unit.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    return dist / 15;  // bullet travel at 15 tiles/sec
  }
  return 1;
}

export const CombatMissionGame = {
  name: 'CombatMission',
  scenarios: [
    { id: 'standard', name: 'Ambush', description: 'Platoon-level infantry ambush on mixed terrain', config: {} },
  ],
  createInitialState,
  getLegalActions,
  applyActions,
  getResult,
  renderState,
  getVisibleState,
  getActionDuration,
};
