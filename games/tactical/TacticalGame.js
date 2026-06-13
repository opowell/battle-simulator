import { chebyshev, reachableSquares } from './grid.js';
import { UNIT_STATS, calculateDamage } from './combat.js';

// ---------------------------------------------------------------------------
// Default scenario
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = {
  width: 8,
  height: 8,
  terrain: {},
};

function makeUnit(id, ownerId, type, x, y) {
  const stats = UNIT_STATS[type];
  return {
    id,
    ownerId,
    type,
    position: { x, y },
    alive: true,
    hp: stats.hp,
    maxHp: stats.maxHp,
    perTurn: { hasMoved: false, hasAttacked: false },
  };
}

function defaultUnits(playerIds) {
  const [p1, p2] = playerIds;
  return [
    makeUnit(`${p1}-warrior`, p1, 'warrior', 1, 1),
    makeUnit(`${p1}-archer`,  p1, 'archer',  2, 1),
    makeUnit(`${p1}-mage`,    p1, 'mage',    1, 2),
    makeUnit(`${p2}-warrior`, p2, 'warrior', 6, 6),
    makeUnit(`${p2}-archer`,  p2, 'archer',  5, 6),
    makeUnit(`${p2}-mage`,    p2, 'mage',    6, 5),
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function occupiedPositions(units) {
  const set = new Set();
  for (const u of units) {
    if (u.alive) set.add(`${u.position.x},${u.position.y}`);
  }
  return set;
}

function updateUnit(units, id, updates) {
  return units.map(u => u.id === id ? { ...u, ...updates } : u);
}

function renderGrid(state) {
  const { board, units } = state;
  const posMap = {};
  for (const u of units) {
    if (u.alive) posMap[`${u.position.x},${u.position.y}`] = u;
  }
  const rows = [];
  for (let y = board.height - 1; y >= 0; y--) {
    let row = '';
    for (let x = 0; x < board.width; x++) {
      const k = `${x},${y}`;
      const u = posMap[k];
      if (u) {
        const sym = u.type[0].toUpperCase();
        row += u.ownerId === state.players[0].id ? sym : sym.toLowerCase();
      } else if (board.terrain?.[k] === 'water') {
        row += '~';
      } else if (board.terrain?.[k] === 'forest') {
        row += 'f';
      } else {
        row += '.';
      }
      row += ' ';
    }
    rows.push(`${y} ${row.trimEnd()}`);
  }
  rows.push('  ' + Array.from({ length: board.width }, (_, i) => i).join(' '));
  return rows.join('\n');
}

// ---------------------------------------------------------------------------
// GameDefinition
// ---------------------------------------------------------------------------

export const TacticalGame = {
  name: 'Tactical',

  createInitialState(players, config = {}) {
    const boardConfig = { ...DEFAULT_CONFIG, ...config };
    const units = config.units ?? defaultUnits(players.map(p => p.id));
    return {
      gameName: 'Tactical',
      turnNumber: 1,
      activePlayers: [players[0].id],
      currentPhase: 'action',
      players,
      board: { width: boardConfig.width, height: boardConfig.height, terrain: boardConfig.terrain },
      units,
      lastActions: null,
      gameSpecific: {},
    };
  },

  getLegalActions(state, playerId) {
    const { units, board } = state;
    const myUnits = units.filter(u => u.alive && u.ownerId === playerId);
    const occupied = occupiedPositions(units);
    const actions = [];

    for (const unit of myUnits) {
      const stats = UNIT_STATS[unit.type];

      // Move actions
      if (!unit.perTurn.hasMoved) {
        // Temporarily remove this unit's own position so it isn't blocked by itself
        const occupiedExcludeSelf = new Set(occupied);
        occupiedExcludeSelf.delete(`${unit.position.x},${unit.position.y}`);
        const targets = reachableSquares(unit.position, stats.moveRange, board, occupiedExcludeSelf);
        for (const to of targets) {
          actions.push({ type: 'move', unitId: unit.id, from: unit.position, to });
        }
      }

      // Attack actions
      if (!unit.perTurn.hasAttacked) {
        const enemies = units.filter(u => u.alive && u.ownerId !== playerId);
        for (const enemy of enemies) {
          if (chebyshev(unit.position, enemy.position) <= stats.attackRange) {
            actions.push({ type: 'attack', unitId: unit.id, targetId: enemy.id });
          }
        }
      }
    }

    // Always include end-turn
    actions.push({ type: 'end-turn', unitId: '__player__' });
    return actions;
  },

  applyActions(state, playerActions, rng = Math.random) {
    const { playerId, action } = playerActions[0];
    let { units } = state;
    const playerIds = state.players.map(p => p.id);
    const currentIdx = playerIds.indexOf(playerId);

    if (action.type === 'end-turn') {
      const nextIdx = (currentIdx + 1) % playerIds.length;
      const nextPlayerId = playerIds[nextIdx];
      const newTurn = nextIdx === 0 ? state.turnNumber + 1 : state.turnNumber;
      // Reset perTurn flags for the player who just ended their turn
      units = units.map(u =>
        u.ownerId === playerId
          ? { ...u, perTurn: { hasMoved: false, hasAttacked: false } }
          : u
      );
      return { ...state, units, activePlayers: [nextPlayerId], turnNumber: newTurn, lastActions: playerActions };
    }

    if (action.type === 'move') {
      units = updateUnit(units, action.unitId, {
        position: action.to,
        perTurn: { ...units.find(u => u.id === action.unitId).perTurn, hasMoved: true },
      });
      return { ...state, units, lastActions: playerActions };
    }

    if (action.type === 'attack') {
      const attacker = units.find(u => u.id === action.unitId);
      const defender = units.find(u => u.id === action.targetId);
      const damage = calculateDamage(attacker, defender, rng);
      const newHp = Math.max(0, defender.hp - damage);
      units = units.map(u => {
        if (u.id === action.unitId) return { ...u, perTurn: { ...u.perTurn, hasAttacked: true } };
        if (u.id === action.targetId) return { ...u, hp: newHp, alive: newHp > 0 };
        return u;
      });
      return { ...state, units, lastActions: playerActions };
    }

    return state;
  },

  getResult(state) {
    const playerIds = state.players.map(p => p.id);
    for (const pid of playerIds) {
      const hasAlive = state.units.some(u => u.ownerId === pid && u.alive);
      if (!hasAlive) {
        const winner = playerIds.find(id => id !== pid);
        return { outcome: 'win', winnerId: winner, reason: 'all-enemies-eliminated' };
      }
    }
    return null;
  },

  renderState(state) {
    const { turnNumber, activePlayers, units } = state;
    const unitSummary = state.players.map(p => {
      const alive = units.filter(u => u.ownerId === p.id && u.alive);
      return `${p.name}: [${alive.map(u => `${u.type}(${u.hp}hp)`).join(', ')}]`;
    }).join('  |  ');
    return [
      `Turn ${turnNumber} — ${activePlayers[0]} to move`,
      renderGrid(state),
      unitSummary,
    ].join('\n');
  },

  getVisibleState(state, playerId) {
    const VISION = 2;
    const myUnits = state.units.filter(u => u.alive && u.ownerId === playerId);
    return {
      ...state,
      units: state.units.filter(u =>
        u.ownerId === playerId ||
        myUnits.some(m => Math.max(Math.abs(m.position.x - u.position.x), Math.abs(m.position.y - u.position.y)) <= VISION)
      ),
    };
  },
};
