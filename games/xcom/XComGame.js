import { unitStrengthEval } from '../evalHelpers.js';
import { createMap, renderMap } from './map.js';
import { getReachable, manhattan } from './grid.js';
import { hasLOS } from './los.js';
import { calcHitChance, rollHit, rollDamage } from './combat.js';
import { createUnit } from './units.js';
import { getXcomBelief } from './belief.js';

function defaultUnits(playerIds) {
  const [xcomId, aliensId] = playerIds;
  return [
    createUnit('xcom-1', 'soldier', xcomId,   { x: 1,  y: 1  }),
    createUnit('xcom-2', 'heavy',   xcomId,   { x: 2,  y: 1  }),
    createUnit('xcom-3', 'sniper',  xcomId,   { x: 1,  y: 2  }),
    createUnit('xcom-4', 'support', xcomId,   { x: 2,  y: 2  }),
    createUnit('alien-1', 'sectoid', aliensId, { x: 11, y: 10 }),
    createUnit('alien-2', 'sectoid', aliensId, { x: 12, y: 10 }),
    createUnit('alien-3', 'floater', aliensId, { x: 11, y: 9  }),
    createUnit('alien-4', 'muton',   aliensId, { x: 12, y: 9  }),
  ];
}

function fmtUnit(u) {
  if (!u.alive) return `${u.attrs.symbol}(dead)`;
  return `${u.attrs.symbol}(${u.hp}hp AP:${u.perTurn.ap})`;
}

export const XComGame = {
  // Heuristic leaf value for the generic ObscuroAgent: own surviving strength
  // minus the enemy's. See games/evalHelpers.js.
  evaluateState: (state, playerId) => unitStrengthEval(state, playerId),
  name: 'X-Com Tactical',
  scenarios: [
    { id: 'ufo-crash', name: 'UFO Crash Site', description: 'Secure a downed UFO against alien survivors', config: {} },
  ],
  gameOptions: [
    { id: 'fogOfWar', label: 'Fog of War', description: 'Each side sees only enemies within sight and line of sight', type: 'boolean', default: false },
  ],
  colors: { floor: '#9a8c7a', wall: '#2a2018', 'cover-low': '#c8943a', 'cover-high': '#8a5a18' },

  createInitialState(players, config = {}) {
    const units = defaultUnits(players.map(p => p.id));
    return {
      gameName: 'xcom',
      turnNumber: 1,
      activePlayers: [players[0].id],
      currentPhase: 'xcom-turn',
      players,
      units,
      board: createMap(),
      lastActions: [],
      gameSpecific: {
        fogOfWar: config.fogOfWar ?? false,
        // Common-knowledge starting deployment (composition + start positions),
        // used to seed the fog belief tracker (belief.js).
        startRoster: units.map(u => ({
          id: u.id, ownerId: u.ownerId, type: u.type, position: { ...u.position },
          hp: u.hp, moveRange: u.attrs.moveRange, maxAP: u.attrs.maxAP,
        })),
      },
    };
  },

  getLegalActions(state, playerId) {
    const myUnits = state.units.filter(u => u.alive && u.ownerId === playerId);
    const enemies = state.units.filter(u => u.alive && u.ownerId !== playerId);
    const actions = [];

    for (const unit of myUnits) {
      if (unit.perTurn.ap <= 0) continue;

      // Move: 1 AP, range defined by unit stat
      const reachable = getReachable(state.board, unit.position, unit.attrs.moveRange, state.units);
      for (const to of reachable) {
        actions.push({ type: 'move', unitId: unit.id, from: unit.position, to });
      }

      // Shoot: uses all remaining AP, ends unit's activation
      for (const enemy of enemies) {
        if (hasLOS(state.board, unit.position, enemy.position)) {
          actions.push({ type: 'shoot', unitId: unit.id, targetId: enemy.id });
        }
      }
    }

    actions.push({ type: 'end-turn', unitId: '__player__' });
    return actions;
  },

  applyActions(state, playerActions, rng = Math.random) {
    const { playerId, action } = playerActions[0];
    let { units } = state;

    if (action.type === 'end-turn') {
      const playerIdx  = state.players.findIndex(p => p.id === playerId);
      const nextIdx    = (playerIdx + 1) % state.players.length;
      const nextId     = state.players[nextIdx].id;
      const isNewRound = nextIdx === 0;

      units = units.map(u =>
        u.ownerId === nextId ? { ...u, perTurn: { ap: u.attrs.maxAP } } : u
      );

      return {
        ...state,
        units,
        activePlayers:  [nextId],
        currentPhase:   nextIdx === 0 ? 'xcom-turn' : 'aliens-turn',
        turnNumber:     isNewRound ? state.turnNumber + 1 : state.turnNumber,
        lastActions:    playerActions,
      };
    }

    if (action.type === 'move') {
      units = units.map(u => {
        if (u.id !== action.unitId) return u;
        // Spend 1 AP regardless of how far within moveRange the unit travels
        return { ...u, position: action.to, perTurn: { ap: u.perTurn.ap - 1 } };
      });
      return { ...state, units, lastActions: playerActions };
    }

    if (action.type === 'shoot') {
      const shooter    = units.find(u => u.id === action.unitId);
      const target     = units.find(u => u.id === action.targetId);
      const hitChance  = calcHitChance(shooter, target, state.board);
      const { hit, crit, roll } = rollHit(hitChance, rng);
      const damage     = hit ? rollDamage(shooter, crit, rng) : 0;

      units = units.map(u => {
        if (u.id === action.unitId) return { ...u, perTurn: { ap: 0 } };
        if (u.id === action.targetId) {
          const newHp = Math.max(0, u.hp - damage);
          return { ...u, hp: newHp, alive: newHp > 0 };
        }
        return u;
      });

      const enriched = { playerId, action: { ...action, hitChance, hit, crit, damage, roll } };
      return { ...state, units, lastActions: [enriched] };
    }

    return state;
  },

  getResult(state) {
    const [p1, p2] = state.players;
    if (!state.units.some(u => u.alive && u.ownerId === p1.id)) {
      return { outcome: 'win', winnerId: p2.id, reason: 'xcom-squad-eliminated' };
    }
    if (!state.units.some(u => u.alive && u.ownerId === p2.id)) {
      return { outcome: 'win', winnerId: p1.id, reason: 'aliens-eliminated' };
    }
    return null;
  },

  renderState(state) {
    const { turnNumber, activePlayers, units, players } = state;
    const [xcomPlayer, aliensPlayer] = players;
    const phase = activePlayers[0] === xcomPlayer.id ? 'XCOM turn' : 'ALIENS turn';

    const mapStr = renderMap(state.board, units);

    const xcomUnits  = units.filter(u => u.ownerId === xcomPlayer.id);
    const alienUnits = units.filter(u => u.ownerId === aliensPlayer.id);
    const statusStr  = [
      `XCOM  [${xcomPlayer.name}]: ${xcomUnits.map(fmtUnit).join('  ')}`,
      `ALIEN [${aliensPlayer.name}]: ${alienUnits.map(fmtUnit).join('  ')}`,
    ].join('\n');

    let lastStr = '';
    if (state.lastActions?.length) {
      const { action } = state.lastActions[0];
      if (action?.type === 'shoot') {
        const shooterUnit = units.find(u => u.id === action.unitId);
        const targetUnit  = units.find(u => u.id === action.targetId);
        const sName = shooterUnit ? `${shooterUnit.type}(${action.unitId})` : action.unitId;
        const tName = targetUnit  ? `${targetUnit.type}(${action.targetId})` : action.targetId;
        const result = action.hit
          ? (action.crit ? `CRIT! ${action.damage} dmg` : `HIT ${action.damage} dmg`)
          : 'MISS';
        lastStr = `>> ${sName} → ${tName}  [${action.hitChance}% hit, rolled ${action.roll}]  ${result}`;
      }
    }

    return [
      `Turn ${turnNumber} — ${phase}`,
      mapStr,
      '',
      statusStr,
      lastStr,
    ].filter(Boolean).join('\n');
  },

  getActionDuration(state, action) {
    if (action.type === 'move') {
      const unit = state.units.find(u => u.id === action.unitId);
      if (!unit) return 1;
      const from = action.from ?? unit.position;
      const dist = Math.max(Math.abs(action.to.x - from.x), Math.abs(action.to.y - from.y));
      return dist / (unit.attrs?.moveRange ?? 3);
    }
    if (action.type === 'shoot') return 0.5;  // aim + fire
    return 1;
  },

  getVisibleState(state, playerId) {
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
  },

  // Fog belief sampler for the generic ObscuroAgent: plausible full worlds with
  // the unseen enemies placed from the stateful XcomBelief (belief.js). Returns
  // [] when fog is off (agent uses the observation as the single world).
  sampleWorlds(observation, playerId, n, rng = Math.random) {
    if (!observation.gameSpecific.fogOfWar) return [];
    const belief = getXcomBelief(observation, playerId);
    belief.beginTurn(observation);
    return belief.sample(observation, n, rng,
      (id, ownerId, type, x, y) => createUnit(id, type, ownerId, { x, y }));
  },

  toGrid(state) {
    const { board, units } = state;
    const { width, height, tiles } = board;
    const pidIdx = {};
    (state.players ?? []).forEach((p, i) => { pidIdx[p.id] = i + 1; });
    const umap = {};
    for (const u of units ?? []) if (u.alive) umap[`${u.position.x},${u.position.y}`] = u;
    const CH = { '.': 'floor', '#': 'wall', c: 'cover-low', C: 'cover-high' };
    const cells = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const ch = tiles[y]?.[x] ?? '#';
        const u = umap[`${x},${y}`];
        const t = CH[ch] ?? 'floor';
        cells.push({
          x, y,
          glyph: u ? (u.attrs?.symbol ?? u.type?.[0]?.toUpperCase() ?? '?') : '',
          owner: u ? (pidIdx[u.ownerId] ?? 0) : 0,
          color: this.colors[t] ?? '#808070',
          hp: u?.hp, maxHp: u?.maxHp,
        });
      }
    }
    return { width, height, cells };
  },
};
