import { WEAPONS, ARMOR_COST, ARMOR_HP, ARMOR_REDUCTION, STARTING_MONEY, WIN_REWARD, KILL_REWARD, MAX_MONEY, lossReward } from './weapons.js';
import { MAP_TILES, MAP_WIDTH, MAP_HEIGHT, isBombsite, isWalkable, hasLOS, euclidean, getReachable, renderMap } from './map.js';

// ── Spawn positions ───────────────────────────────────────────────────────────

const T_SPAWNS  = [{ x:17,y:5 },{ x:18,y:5 },{ x:17,y:6 },{ x:18,y:6 },{ x:17,y:4 }];
const CT_SPAWNS = [{ x:1,y:5  },{ x:2,y:5  },{ x:1,y:6  },{ x:2,y:6  },{ x:1,y:4  }];

const MOVE_RANGE     = 4;
const BOMB_TIMER     = 8;  // decrements each T end-turn after plant
const DEFUSE_NEEDED  = 2;
const ROUND_TURN_MAX = 24; // max end-turns per round before CT wins (time)
const TEAM_IDS       = ['T', 'CT'];

// ── Unit factory ──────────────────────────────────────────────────────────────

function makeUnit(id, ownerId, pos) {
  return { id, ownerId, type: 'player', position: { ...pos }, alive: true,
           hp: 100, maxHp: 100, armor: 0, weapon: 'pistol',
           perTurn: { hasMoved: false, hasActed: false } };
}

function spawnUnits() {
  return [
    ...T_SPAWNS.map((p, i)  => makeUnit(`T-${i}`,  'T',  p)),
    ...CT_SPAWNS.map((p, i) => makeUnit(`CT-${i}`, 'CT', p)),
  ];
}

// ── Legal actions ─────────────────────────────────────────────────────────────

function buyActions(state, teamId) {
  const money  = state.gameSpecific.money[teamId];
  const myUnits = state.units.filter(u => u.alive && u.ownerId === teamId);
  const actions = [];

  for (const u of myUnits) {
    // Weapons affordable & not already owning better
    for (const [wid, w] of Object.entries(WEAPONS)) {
      if (wid === 'pistol') continue;
      if (w.cost <= money && u.weapon !== wid)
        actions.push({ type: 'buy', unitId: u.id, item: wid });
    }
    // Armor
    if (u.armor === 0 && ARMOR_COST <= money)
      actions.push({ type: 'buy', unitId: u.id, item: 'armor' });
  }
  actions.push({ type: 'end-buy', unitId: '__player__' });
  return actions;
}

function actionPhaseActions(state, teamId) {
  const myUnits = state.units.filter(u => u.alive && u.ownerId === teamId);
  const actions = [];
  const bomb    = state.gameSpecific.bomb;

  for (const u of myUnits) {
    if (!u.perTurn.hasMoved) {
      for (const to of getReachable(u.position, MOVE_RANGE, state.units))
        actions.push({ type: 'move', unitId: u.id, from: u.position, to });
    }

    if (!u.perTurn.hasActed) {
      // Shoot enemies in range + LOS
      const enemies = state.units.filter(e => e.alive && e.ownerId !== teamId);
      const wpn     = WEAPONS[u.weapon];
      for (const e of enemies) {
        if (euclidean(u.position, e.position) <= wpn.range &&
            hasLOS(u.position.x, u.position.y, e.position.x, e.position.y)) {
          actions.push({ type: 'shoot', unitId: u.id, targetId: e.id });
        }
      }

      // Plant bomb (any T at a bombsite)
      if (teamId === 'T' && !bomb?.planted && isBombsite(u.position.x, u.position.y))
        actions.push({ type: 'plant', unitId: u.id });

      // Defuse bomb (any CT at bomb location)
      if (teamId === 'CT' && bomb?.planted &&
          u.position.x === bomb.plantedAt.x && u.position.y === bomb.plantedAt.y)
        actions.push({ type: 'defuse', unitId: u.id });
    }

    // Only offer skip-unit if unit still has something to spend
    if (!u.perTurn.hasMoved || !u.perTurn.hasActed)
      actions.push({ type: 'skip-unit', unitId: u.id });
  }

  actions.push({ type: 'end-turn', unitId: '__player__' });
  return actions;
}

// ── Round result check ────────────────────────────────────────────────────────

function getRoundResult(state) {
  const gs   = state.gameSpecific;
  const tAlive  = state.units.some(u => u.ownerId === 'T' && u.alive);
  const ctAlive = state.units.some(u => u.ownerId === 'CT' && u.alive);

  if (!tAlive)  return 'CT'; // all Ts dead
  if (!ctAlive) return 'T';  // all CTs dead

  if (gs.bomb?.planted && gs.bomb.timer <= 0) return 'T';  // detonation
  if (gs.bomb?.defuseProgress >= DEFUSE_NEEDED) return 'CT'; // defused

  if (!gs.bomb?.planted && gs.roundEndTurns >= ROUND_TURN_MAX) return 'CT'; // time out

  return null;
}

// ── Start next round ──────────────────────────────────────────────────────────

function startNewRound(state, roundWinner) {
  const gs = state.gameSpecific;

  const tScore  = gs.tScore  + (roundWinner === 'T' ? 1 : 0);
  const ctScore = gs.ctScore + (roundWinner === 'CT' ? 1 : 0);

  const losses = {
    T:  roundWinner === 'T'  ? 0 : gs.consecutiveLosses.T  + 1,
    CT: roundWinner === 'CT' ? 0 : gs.consecutiveLosses.CT + 1,
  };

  const money = {
    T:  Math.min(MAX_MONEY, gs.money.T  + (roundWinner === 'T'  ? WIN_REWARD : lossReward(gs.consecutiveLosses.T))),
    CT: Math.min(MAX_MONEY, gs.money.CT + (roundWinner === 'CT' ? WIN_REWARD : lossReward(gs.consecutiveLosses.CT))),
  };

  const units = spawnUnits();

  return {
    ...state,
    turnNumber: state.turnNumber + 1,
    activePlayers: [gs.teamPlayerMap['T']],
    currentPhase: 'buy',
    units,
    lastActions: state.lastActions,
    gameSpecific: {
      ...gs,
      roundNumber: gs.roundNumber + 1,
      tScore, ctScore,
      money,
      consecutiveLosses: losses,
      buyPhase: 'T',
      bomb: { planted: false, plantedAt: null, timer: BOMB_TIMER, defuseProgress: 0, defusingUnitId: null },
      roundEndTurns: 0,
      roundResult: null,
    },
  };
}

// ── applyActions ──────────────────────────────────────────────────────────────

function applyActions(state, playerActions, rng = Math.random) {
  const { playerId, action } = playerActions[0];
  let { units } = state;
  let gs = { ...state.gameSpecific };

  // ── BUY PHASE ────────────────────────────────────────────────────────────────
  if (state.currentPhase === 'buy') {
    if (action.type === 'buy') {
      const item = action.item;
      if (item === 'armor') {
        units = units.map(u => u.id === action.unitId ? { ...u, armor: ARMOR_HP } : u);
        gs = { ...gs, money: { ...gs.money, [playerId]: gs.money[playerId] - ARMOR_COST } };
      } else {
        const wpn = WEAPONS[item];
        units = units.map(u => u.id === action.unitId ? { ...u, weapon: item } : u);
        gs = { ...gs, money: { ...gs.money, [playerId]: gs.money[playerId] - wpn.cost } };
      }
      return { ...state, units, gameSpecific: gs, lastActions: playerActions };
    }

    if (action.type === 'end-buy') {
      if (gs.buyPhase === 'T') {
        return { ...state, units, activePlayers: [gs.teamPlayerMap['CT']], currentPhase: 'buy',
                 gameSpecific: { ...gs, buyPhase: 'CT' }, lastActions: playerActions };
      }
      // Both teams done → start action phase
      return { ...state, units, activePlayers: [gs.teamPlayerMap['T']], currentPhase: 'action',
               gameSpecific: { ...gs, buyPhase: 'done' }, lastActions: playerActions };
    }
  }

  // ── ACTION PHASE ──────────────────────────────────────────────────────────────
  if (state.currentPhase === 'action') {
    let bomb = { ...gs.bomb };

    if (action.type === 'move') {
      // If defusing CT moves away, reset defuse progress
      if (playerId === 'CT' && bomb.planted && bomb.defusingUnitId === action.unitId)
        bomb = { ...bomb, defuseProgress: 0, defusingUnitId: null };

      units = units.map(u => u.id === action.unitId
        ? { ...u, position: action.to, perTurn: { ...u.perTurn, hasMoved: true } } : u);
      const newState = { ...state, units, gameSpecific: { ...gs, bomb }, lastActions: playerActions };
      const rr = getRoundResult(newState);
      if (rr) return startNewRound(newState, rr);
      return newState;
    }

    if (action.type === 'shoot') {
      const attacker = units.find(u => u.id === action.unitId);
      const defender = units.find(u => u.id === action.targetId);
      const wpn      = WEAPONS[attacker.weapon];
      const d        = euclidean(attacker.position, defender.position);
      // Accuracy: 90% at close range → 50% at max range
      const accuracy = 0.90 - 0.40 * (d / wpn.range);
      // Mark attacker as having acted regardless of hit/miss
      units = units.map(u => u.id === action.unitId ? { ...u, perTurn: { ...u.perTurn, hasActed: true } } : u);
      if (rng() > accuracy) {
        return { ...state, units, gameSpecific: { ...gs, bomb }, lastActions: playerActions };
      }
      const raw      = wpn.damage;
      const dmg      = defender.armor > 0 ? Math.round(raw * (1 - ARMOR_REDUCTION)) : raw;
      const newHp    = Math.max(0, defender.hp - dmg);
      const killed   = newHp === 0;

      units = units.map(u => {
        if (u.id === action.targetId) return { ...u, hp: newHp, alive: !killed, armor: killed ? 0 : u.armor };
        return u;
      });

      // Kill reward
      if (killed) {
        gs = { ...gs, money: { ...gs.money, [playerId]: Math.min(MAX_MONEY, gs.money[playerId] + KILL_REWARD) } };
        // If killed the defusing unit, reset defuse
        if (bomb.defusingUnitId === action.targetId)
          bomb = { ...bomb, defuseProgress: 0, defusingUnitId: null };
      }

      const newState = { ...state, units, gameSpecific: { ...gs, bomb }, lastActions: playerActions };
      const rr = getRoundResult(newState);
      if (rr) return startNewRound(newState, rr);
      return newState;
    }

    if (action.type === 'plant') {
      const u = units.find(u => u.id === action.unitId);
      bomb = { planted: true, plantedAt: { ...u.position }, timer: BOMB_TIMER, defuseProgress: 0, defusingUnitId: null };
      units = units.map(u => u.id === action.unitId ? { ...u, perTurn: { hasMoved: true, hasActed: true } } : u);
      return { ...state, units, gameSpecific: { ...gs, bomb }, lastActions: playerActions };
    }

    if (action.type === 'defuse') {
      const u = units.find(u => u.id === action.unitId);
      let progress = bomb.defuseProgress;
      if (bomb.defusingUnitId !== action.unitId) progress = 0; // different CT started
      progress += 1;
      bomb = { ...bomb, defuseProgress: progress, defusingUnitId: action.unitId };
      units = units.map(u => u.id === action.unitId ? { ...u, perTurn: { ...u.perTurn, hasActed: true } } : u);

      const newState = { ...state, units, gameSpecific: { ...gs, bomb }, lastActions: playerActions };
      const rr = getRoundResult(newState);
      if (rr) return startNewRound(newState, rr);
      return newState;
    }

    if (action.type === 'skip-unit') {
      units = units.map(u => u.id === action.unitId
        ? { ...u, perTurn: { hasMoved: true, hasActed: true } } : u);
      return { ...state, units, gameSpecific: { ...gs, bomb }, lastActions: playerActions };
    }

    if (action.type === 'end-turn') {
      const otherTeam = playerId === 'T' ? 'CT' : 'T';
      const roundEndTurns = gs.roundEndTurns + 1;

      // Tick bomb timer when T ends their turn after plant
      let newBomb = { ...bomb };
      if (playerId === 'T' && bomb.planted) newBomb = { ...bomb, timer: bomb.timer - 1 };

      // Reset perTurn for players on the team that just acted
      units = units.map(u => u.ownerId === playerId
        ? { ...u, perTurn: { hasMoved: false, hasActed: false } } : u);

      const tentativeState = {
        ...state, units,
        activePlayers: [gs.teamPlayerMap[otherTeam]],
        turnNumber: playerId === 'CT' ? state.turnNumber + 1 : state.turnNumber,
        gameSpecific: { ...gs, bomb: newBomb, roundEndTurns },
        lastActions: playerActions,
      };

      const rr = getRoundResult(tentativeState);
      if (rr) return startNewRound(tentativeState, rr);
      return tentativeState;
    }
  }

  return state;
}

// ── getLegalActions ───────────────────────────────────────────────────────────

function getLegalActions(state, playerId) {
  if (state.currentPhase === 'buy') return buyActions(state, playerId);
  return actionPhaseActions(state, playerId);
}

// ── getResult ─────────────────────────────────────────────────────────────────

function getResult(state) {
  const { tScore, ctScore, winRounds, maxRounds, roundNumber, teamPlayerMap } = state.gameSpecific;
  if (tScore  >= winRounds) return { outcome: 'win', winnerId: teamPlayerMap['T'],  reason: `T ${tScore}-${ctScore} CT` };
  if (ctScore >= winRounds) return { outcome: 'win', winnerId: teamPlayerMap['CT'], reason: `CT ${ctScore}-${tScore} T` };
  if (roundNumber > maxRounds) {
    if (tScore > ctScore) return { outcome: 'win', winnerId: teamPlayerMap['T'],  reason: `T ${tScore}-${ctScore} CT` };
    if (ctScore > tScore) return { outcome: 'win', winnerId: teamPlayerMap['CT'], reason: `CT ${ctScore}-${tScore} T` };
    return { outcome: 'draw', winnerId: null, reason: `tied ${tScore}-${ctScore}` };
  }
  return null;
}

// ── renderState ───────────────────────────────────────────────────────────────

function renderState(state) {
  const gs    = state.gameSpecific;
  const activeTeam = gs.teamMap?.[state.activePlayers[0]] ?? state.activePlayers[0];
  const phase = state.currentPhase === 'buy'
    ? `BUY (${gs.buyPhase} buying)`
    : `ACTION (${activeTeam} to move)`;

  const teamSummary = (tid) => {
    const alive = state.units.filter(u => u.ownerId === tid && u.alive);
    const units = alive.map(u => `${u.id}:${u.weapon}${u.armor ? '+vest' : ''}(${u.hp}hp)`).join(' ');
    return `  ${tid} $${gs.money[tid]} | ${units || '(all dead)'}`;
  };

  const bombLine = !gs.bomb?.planted ? '  Bomb: not planted'
    : `  Bomb: PLANTED at (${gs.bomb.plantedAt.x},${gs.bomb.plantedAt.y}) — ${gs.bomb.timer} turns left${gs.bomb.defuseProgress ? ` [defuse ${gs.bomb.defuseProgress}/${DEFUSE_NEEDED}]` : ''}`;

  return [
    `═══ Round ${gs.roundNumber}  T ${gs.tScore} — ${gs.ctScore} CT  |  ${phase} ═══`,
    renderMap(state),
    `Legend: T=Terrorist C=Counter-Terrorist A=Site-A B=Site-B c=CT-spawn t=T-spawn !=bomb`,
    '',
    teamSummary('T'),
    teamSummary('CT'),
    bombLine,
  ].join('\n');
}

// ── createInitialState ────────────────────────────────────────────────────────

export function createInitialState(players, config = {}) {
  const winRounds  = config.winRounds  ?? 8;
  const maxRounds  = config.maxRounds  ?? 15;

  const [p1, p2] = players;
  // teamMap:       player-id  → 'T'|'CT'
  // teamPlayerMap: 'T'|'CT'  → player-id
  const teamMap       = { [p1.id]: 'T', [p2.id]: 'CT' };
  const teamPlayerMap = { T: p1.id, CT: p2.id };

  const units = spawnUnits();

  return {
    gameName: 'CS',
    turnNumber: 1,
    activePlayers: [p1.id],
    currentPhase: 'buy',
    players,
    board: { width: MAP_WIDTH, height: MAP_HEIGHT },
    units,
    lastActions: null,
    gameSpecific: {
      roundNumber: 1,
      tScore: 0, ctScore: 0,
      winRounds, maxRounds,
      buyPhase: 'T',
      money: { T: STARTING_MONEY, CT: STARTING_MONEY },
      consecutiveLosses: { T: 0, CT: 0 },
      bomb: { planted: false, plantedAt: null, timer: BOMB_TIMER, defuseProgress: 0, defusingUnitId: null },
      roundEndTurns: 0,
      roundResult: null,
      teamMap, teamPlayerMap,
    },
  };
}

// ── Adapter: translate player IDs → team IDs ─────────────────────────────────
// The engine calls getLegalActions/applyActions with player IDs from players[].
// We store teamMap so player-1 ↔ T, player-2 ↔ CT.

function withTeam(fn) {
  return (state, playerIdOrActions, ...rest) => {
    const { teamMap } = state.gameSpecific;
    if (Array.isArray(playerIdOrActions)) {
      // applyActions: translate each playerId in the array
      const translated = playerIdOrActions.map(pa => ({ ...pa, playerId: teamMap[pa.playerId] ?? pa.playerId }));
      return fn(state, translated, ...rest);
    }
    // getLegalActions: single playerId string
    return fn(state, teamMap[playerIdOrActions] ?? playerIdOrActions, ...rest);
  };
}

function getVisibleState(state, teamId) {
  const VISION = 4;
  const myUnits = state.units.filter(u => u.alive && u.ownerId === teamId);
  return {
    ...state,
    units: state.units.filter(u =>
      u.ownerId === teamId ||
      myUnits.some(m => Math.max(Math.abs(m.position.x - u.position.x), Math.abs(m.position.y - u.position.y)) <= VISION)
    ),
  };
}

const PLAYER_SPEED  = MOVE_RANGE;       // tiles per second
const BULLET_SPEED  = 20;               // tiles per second

function getActionDuration(state, action) {
  if (action.type === 'move') {
    const unit = state.units.find(u => u.id === action.unitId);
    if (!unit) return 1;
    const from = action.from ?? unit.position;
    const dx = action.to.x - from.x, dy = action.to.y - from.y;
    return Math.sqrt(dx * dx + dy * dy) / PLAYER_SPEED;
  }
  if (action.type === 'shoot') {
    const shooter = state.units.find(u => u.id === action.unitId);
    const target  = state.units.find(u => u.id === action.targetId);
    if (!shooter || !target) return 1;
    const dx = target.position.x - shooter.position.x;
    const dy = target.position.y - shooter.position.y;
    return Math.sqrt(dx * dx + dy * dy) / BULLET_SPEED;
  }
  if (action.type === 'plant')  return 2;
  if (action.type === 'defuse') return 5;
  return 1;
}

export const CsGame = {
  name: 'CS',
  createInitialState,
  getLegalActions:   withTeam(getLegalActions),
  applyActions:      withTeam(applyActions),
  getResult,
  renderState,
  getVisibleState:   withTeam(getVisibleState),
  getActionDuration,
};
