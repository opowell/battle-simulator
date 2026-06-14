import { TERRAIN } from './terrain.js';
import { UNITS } from './units.js';
import { resolveCombat } from './combat.js';
import { mulberry32, generateMap, getReachableTiles, renderMap } from './map.js';

// ── Starting formation (offsets from camp; P2 mirrors dx) ─────────────────────
// Archers defend the camp from range; warriors form the front line; cavalry flanks.
const FORMATION = [
  { dx: 0, dy:  0, type: 'archer'  },
  { dx: 0, dy:  1, type: 'archer'  },
  { dx: 1, dy:  0, type: 'warrior' },
  { dx: 1, dy:  1, type: 'warrior' },
  { dx: 1, dy: -1, type: 'warrior' },
  { dx: 2, dy:  1, type: 'cavalry' },
  { dx: 2, dy: -1, type: 'cavalry' },
];

// ── Unit factory ──────────────────────────────────────────────────────────────

let _idCtr = 0;

function makeUnit(ownerId, type, x, y) {
  const stats = UNITS[type];
  return {
    id: `u${_idCtr++}`,
    ownerId,
    type,
    position: { x, y },
    alive: true,
    hp: stats.hp,
    maxHp: stats.hp,
    movesLeft: stats.moves,
    attrs: {},
  };
}

// ── Legal actions ─────────────────────────────────────────────────────────────

function getLegalActions(state, playerId) {
  const { units, board } = state;
  const myUnits = units.filter(u => u.alive && u.ownerId === playerId && u.movesLeft > 0);
  const enemies = units.filter(u => u.alive && u.ownerId !== playerId);
  const actions = [];

  for (const unit of myUnits) {
    const { range } = UNITS[unit.type];

    // Movement: all reachable passable tiles (no stacking, can't pass through enemies)
    for (const to of getReachableTiles(unit, board, units, playerId)) {
      actions.push({ type: 'move', unitId: unit.id, from: unit.position, to });
    }

    // Attack: enemies within Chebyshev distance [1, range]
    for (const enemy of enemies) {
      const dx   = Math.abs(enemy.position.x - unit.position.x);
      const dy   = Math.abs(enemy.position.y - unit.position.y);
      const dist = Math.max(dx, dy);
      if (dist >= 1 && dist <= range) {
        actions.push({ type: 'attack', unitId: unit.id, targetId: enemy.id });
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
  let { units, board } = state;
  const playerIds  = state.players.map(p => p.id);
  const currentIdx = playerIds.indexOf(playerId);

  // ── end-turn ──────────────────────────────────────────────────────────────
  if (action.type === 'end-turn') {
    const nextIdx      = (currentIdx + 1) % playerIds.length;
    const nextPlayerId = playerIds[nextIdx];
    const newTurn      = nextIdx === 0 ? state.turnNumber + 1 : state.turnNumber;

    units = units.map(u =>
      u.ownerId === nextPlayerId ? { ...u, movesLeft: UNITS[u.type].moves } : u
    );

    return {
      ...state,
      units,
      activePlayers: [nextPlayerId],
      turnNumber: newTurn,
      lastActions: playerActions,
    };
  }

  // ── move ──────────────────────────────────────────────────────────────────
  if (action.type === 'move') {
    const unit = units.find(u => u.id === action.unitId);
    const tile = board.tiles[`${action.to.x},${action.to.y}`];
    const cost = TERRAIN[tile?.terrain]?.moveCost ?? 1;
    const newMovesLeft = Math.max(0, unit.movesLeft - cost);
    units = units.map(u =>
      u.id === action.unitId ? { ...u, position: action.to, movesLeft: newMovesLeft } : u
    );
    return { ...state, units, lastActions: playerActions };
  }

  // ── attack ────────────────────────────────────────────────────────────────
  if (action.type === 'attack') {
    const attacker = units.find(u => u.id === action.unitId);
    const defender = units.find(u => u.id === action.targetId);
    if (!attacker || !defender || !attacker.alive || !defender.alive) return state;

    const result = resolveCombat(attacker, defender, state, rng);

    units = units.map(u => {
      if (u.id === action.unitId) {
        if (result.attackerSurvived) return { ...u, hp: result.attackerHpLeft, movesLeft: 0 };
        return { ...u, alive: false, hp: 0, movesLeft: 0 };
      }
      if (u.id === action.targetId) {
        if (!result.attackerSurvived) return { ...u, hp: result.defenderHpLeft };
        return { ...u, alive: false, hp: 0 };
      }
      return u;
    });

    // Melee advance: attacker moves into the defender's tile on a kill (range=1 only)
    if (result.attackerSurvived) {
      const defPos = defender.position;
      const dx = Math.abs(defPos.x - attacker.position.x);
      const dy = Math.abs(defPos.y - attacker.position.y);
      if (Math.max(dx, dy) === 1) {
        const occupied = new Set(units.filter(u => u.alive && u.id !== action.unitId).map(u => `${u.position.x},${u.position.y}`));
        if (!occupied.has(`${defPos.x},${defPos.y}`)) {
          units = units.map(u =>
            u.id === action.unitId ? { ...u, position: defPos } : u
          );
        }
      }
    }

    return { ...state, units, lastActions: playerActions };
  }

  // ── skip-unit ─────────────────────────────────────────────────────────────
  if (action.type === 'skip-unit') {
    units = units.map(u => u.id === action.unitId ? { ...u, movesLeft: 0 } : u);
    return { ...state, units, lastActions: playerActions };
  }

  return state;
}

// ── Win condition ─────────────────────────────────────────────────────────────

function getResult(state) {
  const { p1Camp, p2Camp } = state.gameSpecific;
  const [p1, p2] = state.players;

  // Camp capture: any alive unit occupies the enemy camp
  const p1CapP2 = state.units.some(
    u => u.alive && u.ownerId === p1.id && u.position.x === p2Camp.x && u.position.y === p2Camp.y
  );
  if (p1CapP2) return { outcome: 'win', winnerId: p1.id, reason: 'camp-captured' };

  const p2CapP1 = state.units.some(
    u => u.alive && u.ownerId === p2.id && u.position.x === p1Camp.x && u.position.y === p1Camp.y
  );
  if (p2CapP1) return { outcome: 'win', winnerId: p2.id, reason: 'camp-captured' };

  // Army destroyed: opponent has no surviving units
  for (const [p, opp] of [[p1, p2], [p2, p1]]) {
    if (!state.units.some(u => u.alive && u.ownerId === p.id)) {
      return { outcome: 'win', winnerId: opp.id, reason: 'army-destroyed' };
    }
  }

  return null;
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderState(state) {
  const { turnNumber, activePlayers, units, players } = state;
  const [p1, p2] = players;

  const summarize = pid => {
    const alive = units.filter(u => u.alive && u.ownerId === pid);
    const str = alive.length
      ? alive.map(u => `${u.type[0].toUpperCase()}(${u.hp}hp)`).join(' ')
      : '— defeated —';
    return `${pid}: ${str}`;
  };

  return [
    `═══ Turn ${turnNumber} — ${activePlayers[0]} to move ═══`,
    renderMap(state),
    `Legend: 1/2=camp  W=warrior  A=archer  H=horsemen(cavalry)`,
    `        Uppercase=P1  lowercase=P2`,
    `        .=plains  f=forest(+50%def)  n=hills(+75%def)  ^=mountains`,
    '',
    summarize(p1.id),
    summarize(p2.id),
  ].join('\n');
}

// ── createInitialState ────────────────────────────────────────────────────────

function createInitialState(players, config = {}) {
  const width  = config.width  ?? 22;
  const height = config.height ?? 12;
  const seed   = config.seed   ?? 42;

  const cy     = Math.floor((height - 1) / 2);
  const p1Camp = { x: 3,           y: cy };
  const p2Camp = { x: width - 4,   y: cy };

  _idCtr = 0;
  const rng   = mulberry32(seed);
  const tiles = generateMap(width, height, rng, [p1Camp, p2Camp]);
  const board = { width, height, tiles };

  const [p1, p2] = players;

  function placeFormation(camp, ownerId, xSign) {
    return FORMATION.map(({ dx, dy, type }) => {
      const x = camp.x + dx * xSign;
      const y = camp.y + dy;
      if (x < 0 || x >= width || y < 0 || y >= height) return null;
      const tile = tiles[`${x},${y}`];
      if (!tile || !TERRAIN[tile.terrain].passable) return null;
      return makeUnit(ownerId, type, x, y);
    }).filter(Boolean);
  }

  const units = [
    ...placeFormation(p1Camp, p1.id, +1),
    ...placeFormation(p2Camp, p2.id, -1),
  ];

  return {
    gameName: 'AncientArtOfWar',
    turnNumber: 1,
    activePlayers: [p1.id],
    currentPhase: 'action',
    players,
    board,
    units,
    lastActions: null,
    gameSpecific: { p1Camp, p2Camp },
  };
}

// ── Fog of war ────────────────────────────────────────────────────────────────

function getVisibleState(state, playerId) {
  const VISION = 2;
  const myUnits = state.units.filter(u => u.alive && u.ownerId === playerId);
  return {
    ...state,
    units: state.units.filter(u =>
      u.ownerId === playerId ||
      myUnits.some(m => Math.max(Math.abs(m.position.x - u.position.x), Math.abs(m.position.y - u.position.y)) <= VISION)
    ),
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
    return 1 / (UNITS[unit.type]?.range > 1 ? 0.8 : 1.2);
  }
  return 1;
}

export const AowGame = {
  name: 'AncientArtOfWar',
  scenarios: [
    { id: 'conquest',     name: 'Conquest',      description: 'Default 22×12 fantasy map',        config: {} },
    { id: 'epic',         name: 'Epic Campaign',  description: '30×18 expanded world to conquer',  config: { width: 30, height: 18 } },
  ],
  colors: { plains: '#b8a860', forest: '#2a6830', hills: '#9a8050', mountains: '#706050' },
  createInitialState,
  getLegalActions,
  applyActions,
  getResult,
  renderState,
  getVisibleState,
  getActionDuration,

  toGrid(state) {
    const { board, units = [] } = state;
    const { width, height, tiles } = board;
    const pidIdx = {};
    (state.players ?? []).forEach((p, i) => { pidIdx[p.id] = i + 1; });
    const umap = {};
    for (const u of units) if (u.alive) umap[`${u.position.x},${u.position.y}`] = u;
    const cells = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tile = tiles[`${x},${y}`] ?? {};
        const u = umap[`${x},${y}`];
        cells.push({
          x, y: height - 1 - y,
          glyph: u ? u.type[0].toUpperCase() : '',
          owner: u ? (pidIdx[u.ownerId] ?? 0) : 0,
          color: this.colors[tile.terrain] ?? this.colors.plains ?? '#808070',
          hp: u?.hp, maxHp: u?.maxHp,
        });
      }
    }
    return { width, height, cells };
  },
};
