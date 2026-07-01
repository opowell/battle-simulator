import { unitStrengthEval } from '../evalHelpers.js';
import {
  WEAPONS, GRENADES, EQUIPMENT,
  ARMOR_COST, ARMOR_HP, ARMOR_REDUCTION, HELMET_EXTRA_REDUCTION,
  STARTING_MONEY, WIN_REWARD, KILL_REWARD, MAX_MONEY, lossReward,
  GRENADE_THROW_RANGE, HE_RADIUS, HE_DAMAGE,
  FLASH_RADIUS, FLASH_BLIND_TURNS,
  SMOKE_RADIUS, SMOKE_TURNS,
  FIRE_RADIUS, FIRE_DAMAGE, FIRE_TURNS,
} from './weapons.js';
import {
  MAPS,
  isBombsite, hasLOS, euclidean, getReachable, getThrowTargets, renderMap,
} from './map.js';
import { getCsBelief } from './belief.js';


const MOVE_RANGE     = 4;
const BOMB_TIMER     = 8;
const DEFUSE_NEEDED  = 2;
const ROUND_TURN_MAX = 24;

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcDamage(raw, unit) {
  if (!unit.armor) return raw;
  const reduction = ARMOR_REDUCTION + (unit.helmet ? HELMET_EXTRA_REDUCTION : 0);
  return Math.round(raw * (1 - reduction));
}

function buildSmokeSet(smokeZones) {
  const s = new Set();
  for (const sz of smokeZones)
    for (let dy = -SMOKE_RADIUS; dy <= SMOKE_RADIUS; dy++)
      for (let dx = -SMOKE_RADIUS; dx <= SMOKE_RADIUS; dx++)
        s.add(`${sz.x + dx},${sz.y + dy}`);
  return s;
}

function buildFireSet(fireZones) {
  const s = new Set();
  for (const fz of fireZones)
    for (let dy = -FIRE_RADIUS; dy <= FIRE_RADIUS; dy++)
      for (let dx = -FIRE_RADIUS; dx <= FIRE_RADIUS; dx++)
        s.add(`${fz.x + dx},${fz.y + dy}`);
  return s;
}

// ── Unit factory ──────────────────────────────────────────────────────────────

function makeUnit(id, ownerId, pos) {
  return {
    id, ownerId, type: 'player',
    position: { ...pos },
    alive: true,
    hp: 100, maxHp: 100,
    armor: 0, helmet: false, hasKit: false,
    weapon: 'pistol',
    grenades: {},
    blinded: 0,
    perTurn: { hasMoved: false, hasActed: false },
  };
}

function spawnUnits(map) {
  return [
    ...map.tSpawns.map((p, i)  => makeUnit(`T-${i}`,  'T',  p)),
    ...map.ctSpawns.map((p, i) => makeUnit(`CT-${i}`, 'CT', p)),
  ];
}

// ── Legal actions ─────────────────────────────────────────────────────────────

function buyActions(state, teamId) {
  const money   = state.gameSpecific.money[teamId];
  const myUnits = state.units.filter(u => u.alive && u.ownerId === teamId);
  const actions = [];

  for (const u of myUnits) {
    // Weapons (pistol is free/default, not buyable)
    for (const [wid, w] of Object.entries(WEAPONS)) {
      if (wid === 'pistol') continue;
      if (w.teams && !w.teams.includes(teamId)) continue;
      if (w.cost <= money && u.weapon !== wid)
        actions.push({ type: 'buy', unitId: u.id, item: wid });
    }
    // Armor (kevlar)
    if (!u.armor && ARMOR_COST <= money)
      actions.push({ type: 'buy', unitId: u.id, item: 'armor' });
    // Helmet (requires armor)
    if (u.armor && !u.helmet && EQUIPMENT.helmet.cost <= money)
      actions.push({ type: 'buy', unitId: u.id, item: 'helmet' });
    // Defuse kit (CT only)
    if (!u.hasKit && teamId === 'CT' && EQUIPMENT.defusekit.cost <= money)
      actions.push({ type: 'buy', unitId: u.id, item: 'defusekit' });
    // Grenades
    for (const [gid, g] of Object.entries(GRENADES)) {
      if (g.teams && !g.teams.includes(teamId)) continue;
      if (g.cost <= money && (u.grenades[gid] ?? 0) < g.maxStack)
        actions.push({ type: 'buy', unitId: u.id, item: gid });
    }
  }

  actions.push({ type: 'end-buy', unitId: '__player__' });
  return actions;
}

function actionPhaseActions(state, teamId) {
  const { map: { tiles, width, height } } = state.gameSpecific;
  const myUnits  = state.units.filter(u => u.alive && u.ownerId === teamId);
  const actions  = [];
  const bomb     = state.gameSpecific.bomb;
  const smokeSet = buildSmokeSet(state.gameSpecific.smokeZones ?? []);

  for (const u of myUnits) {
    if (!u.perTurn.hasMoved) {
      for (const to of getReachable(tiles, u.position, MOVE_RANGE, state.units))
        actions.push({ type: 'move', unitId: u.id, from: u.position, to });
    }

    if (!u.perTurn.hasActed) {
      // Shoot (not available while blinded)
      if (!u.blinded) {
        const enemies = state.units.filter(e => e.alive && e.ownerId !== teamId);
        const wpn     = WEAPONS[u.weapon];
        for (const e of enemies) {
          if (euclidean(u.position, e.position) <= wpn.range &&
              hasLOS(tiles, u.position.x, u.position.y, e.position.x, e.position.y, smokeSet))
            actions.push({ type: 'shoot', unitId: u.id, targetId: e.id });
        }
      }

      // Throw grenades (usable even while blinded)
      for (const [gid, count] of Object.entries(u.grenades ?? {})) {
        if (!count) continue;
        for (const target of getThrowTargets(tiles, width, height, u.position, GRENADE_THROW_RANGE))
          actions.push({ type: 'throw', unitId: u.id, grenade: gid, target });
      }

      // Plant bomb (T only, at bombsite)
      if (teamId === 'T' && !bomb?.planted && isBombsite(tiles, u.position.x, u.position.y))
        actions.push({ type: 'plant', unitId: u.id });

      // Defuse bomb (CT only, standing on bomb)
      if (teamId === 'CT' && bomb?.planted &&
          u.position.x === bomb.plantedAt.x && u.position.y === bomb.plantedAt.y)
        actions.push({ type: 'defuse', unitId: u.id });
    }

    if (!u.perTurn.hasMoved || !u.perTurn.hasActed)
      actions.push({ type: 'skip-unit', unitId: u.id });
  }

  actions.push({ type: 'end-turn', unitId: '__player__' });
  return actions;
}

// ── Round result check ────────────────────────────────────────────────────────

function getRoundResult(state) {
  const gs      = state.gameSpecific;
  const tAlive  = state.units.some(u => u.ownerId === 'T'  && u.alive);
  const ctAlive = state.units.some(u => u.ownerId === 'CT' && u.alive);

  if (!tAlive)  return 'CT';
  if (!ctAlive) return 'T';

  if (gs.bomb?.planted && gs.bomb.timer <= 0) return 'T';
  if (gs.bomb?.defuseProgress >= (gs.bomb.defuseNeeded ?? DEFUSE_NEEDED)) return 'CT';

  if (!gs.bomb?.planted && gs.roundEndTurns >= ROUND_TURN_MAX) return 'CT';

  return null;
}

// ── Start next round ──────────────────────────────────────────────────────────

function startNewRound(state, roundWinner) {
  const gs = state.gameSpecific;

  const tScore  = gs.tScore  + (roundWinner === 'T'  ? 1 : 0);
  const ctScore = gs.ctScore + (roundWinner === 'CT' ? 1 : 0);

  const losses = {
    T:  roundWinner === 'T'  ? 0 : gs.consecutiveLosses.T  + 1,
    CT: roundWinner === 'CT' ? 0 : gs.consecutiveLosses.CT + 1,
  };

  const money = {
    T:  Math.min(MAX_MONEY, gs.money.T  + (roundWinner === 'T'  ? WIN_REWARD : lossReward(gs.consecutiveLosses.T))),
    CT: Math.min(MAX_MONEY, gs.money.CT + (roundWinner === 'CT' ? WIN_REWARD : lossReward(gs.consecutiveLosses.CT))),
  };

  return {
    ...state,
    turnNumber: state.turnNumber + 1,
    activePlayers: [gs.teamPlayerMap['T']],
    currentPhase: 'buy',
    units: spawnUnits(gs.map),
    lastActions: state.lastActions,
    gameSpecific: {
      ...gs,
      roundNumber: gs.roundNumber + 1,
      tScore, ctScore,
      money,
      consecutiveLosses: losses,
      buyPhase: 'T',
      bomb: { planted: false, plantedAt: null, timer: BOMB_TIMER,
              defuseProgress: 0, defusingUnitId: null, defuseNeeded: DEFUSE_NEEDED },
      smokeZones: [],
      fireZones: [],
      roundEndTurns: 0,
      roundResult: null,
      map: gs.map,
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
      const { item, unitId } = action;
      const deduct = (cost) => {
        gs = { ...gs, money: { ...gs.money, [playerId]: gs.money[playerId] - cost } };
      };

      if (item === 'armor') {
        units = units.map(u => u.id === unitId ? { ...u, armor: ARMOR_HP } : u);
        deduct(ARMOR_COST);
      } else if (item === 'helmet') {
        units = units.map(u => u.id === unitId ? { ...u, helmet: true } : u);
        deduct(EQUIPMENT.helmet.cost);
      } else if (item === 'defusekit') {
        units = units.map(u => u.id === unitId ? { ...u, hasKit: true } : u);
        deduct(EQUIPMENT.defusekit.cost);
      } else if (GRENADES[item]) {
        units = units.map(u => u.id === unitId
          ? { ...u, grenades: { ...u.grenades, [item]: (u.grenades[item] ?? 0) + 1 } } : u);
        deduct(GRENADES[item].cost);
      } else if (WEAPONS[item]) {
        units = units.map(u => u.id === unitId ? { ...u, weapon: item } : u);
        deduct(WEAPONS[item].cost);
      }

      return { ...state, units, gameSpecific: gs, lastActions: playerActions };
    }

    if (action.type === 'end-buy') {
      if (gs.buyPhase === 'T') {
        return { ...state, units, activePlayers: [gs.teamPlayerMap['CT']], currentPhase: 'buy',
                 gameSpecific: { ...gs, buyPhase: 'CT' }, lastActions: playerActions };
      }
      return { ...state, units, activePlayers: [gs.teamPlayerMap['T']], currentPhase: 'action',
               gameSpecific: { ...gs, buyPhase: 'done' }, lastActions: playerActions };
    }
  }

  // ── ACTION PHASE ──────────────────────────────────────────────────────────────
  if (state.currentPhase === 'action') {
    const { tiles } = gs.map;
    let bomb       = { ...gs.bomb };
    let smokeZones = [...(gs.smokeZones ?? [])];
    let fireZones  = [...(gs.fireZones  ?? [])];

    if (action.type === 'move') {
      // Moving CT away from bomb resets defuse progress
      if (playerId === 'CT' && bomb.planted && bomb.defusingUnitId === action.unitId)
        bomb = { ...bomb, defuseProgress: 0, defusingUnitId: null };

      units = units.map(u => u.id === action.unitId
        ? { ...u, position: action.to, perTurn: { ...u.perTurn, hasMoved: true } } : u);
      const s0 = { ...state, units, gameSpecific: { ...gs, bomb, smokeZones, fireZones }, lastActions: playerActions };
      const rr = getRoundResult(s0);
      if (rr) return startNewRound(s0, rr);
      return s0;
    }

    if (action.type === 'shoot') {
      const attacker = units.find(u => u.id === action.unitId);
      const defender = units.find(u => u.id === action.targetId);
      const wpn      = WEAPONS[attacker.weapon];
      const d        = euclidean(attacker.position, defender.position);
      const accuracy = 0.90 - 0.40 * (d / wpn.range);

      units = units.map(u => u.id === action.unitId ? { ...u, perTurn: { ...u.perTurn, hasActed: true } } : u);

      if (rng() > accuracy) {
        return { ...state, units, gameSpecific: { ...gs, bomb, smokeZones, fireZones }, lastActions: playerActions };
      }

      const dmg    = calcDamage(wpn.damage, defender);
      const newHp  = Math.max(0, defender.hp - dmg);
      const killed = newHp === 0;

      units = units.map(u => u.id === action.targetId
        ? { ...u, hp: newHp, alive: !killed, armor: killed ? 0 : u.armor } : u);

      if (killed) {
        gs = { ...gs, money: { ...gs.money, [playerId]: Math.min(MAX_MONEY, gs.money[playerId] + KILL_REWARD) } };
        if (bomb.defusingUnitId === action.targetId)
          bomb = { ...bomb, defuseProgress: 0, defusingUnitId: null };
      }

      const s1 = { ...state, units, gameSpecific: { ...gs, bomb, smokeZones, fireZones }, lastActions: playerActions };
      const rr1 = getRoundResult(s1);
      if (rr1) return startNewRound(s1, rr1);
      return s1;
    }

    if (action.type === 'throw') {
      const { grenade, target } = action;
      const smokeSet = buildSmokeSet(smokeZones);

      // Consume grenade and mark hasActed
      units = units.map(u => u.id === action.unitId
        ? { ...u,
            grenades: { ...u.grenades, [grenade]: (u.grenades[grenade] ?? 1) - 1 },
            perTurn:  { ...u.perTurn, hasActed: true } }
        : u);

      if (grenade === 'he') {
        const enemiesBefore = new Set(units.filter(u => u.alive && u.ownerId !== playerId).map(u => u.id));
        units = units.map(u => {
          if (!u.alive || euclidean(u.position, target) > HE_RADIUS) return u;
          const newHp = Math.max(0, u.hp - calcDamage(HE_DAMAGE, u));
          return { ...u, hp: newHp, alive: newHp > 0, armor: newHp > 0 ? u.armor : 0 };
        });
        const kills = units.filter(u => !u.alive && enemiesBefore.has(u.id)).length;
        if (kills > 0)
          gs = { ...gs, money: { ...gs.money, [playerId]: Math.min(MAX_MONEY, gs.money[playerId] + kills * KILL_REWARD) } };
        if (bomb.defusingUnitId && !units.find(u => u.id === bomb.defusingUnitId)?.alive)
          bomb = { ...bomb, defuseProgress: 0, defusingUnitId: null };

      } else if (grenade === 'flash') {
        units = units.map(u => {
          if (!u.alive || u.ownerId === playerId) return u;
          if (euclidean(u.position, target) <= FLASH_RADIUS &&
              hasLOS(tiles, u.position.x, u.position.y, target.x, target.y, smokeSet))
            return { ...u, blinded: FLASH_BLIND_TURNS };
          return u;
        });

      } else if (grenade === 'smoke') {
        smokeZones = [...smokeZones, { x: target.x, y: target.y, turnsLeft: SMOKE_TURNS }];

      } else if (grenade === 'molotov' || grenade === 'incendiary') {
        fireZones = [...fireZones, { x: target.x, y: target.y, turnsLeft: FIRE_TURNS }];
      }
      // decoy: no mechanical effect

      const s2 = { ...state, units, gameSpecific: { ...gs, bomb, smokeZones, fireZones }, lastActions: playerActions };
      const rr2 = getRoundResult(s2);
      if (rr2) return startNewRound(s2, rr2);
      return s2;
    }

    if (action.type === 'plant') {
      const u = units.find(u => u.id === action.unitId);
      bomb = { planted: true, plantedAt: { ...u.position }, timer: BOMB_TIMER,
               defuseProgress: 0, defusingUnitId: null, defuseNeeded: DEFUSE_NEEDED };
      units = units.map(u => u.id === action.unitId ? { ...u, perTurn: { hasMoved: true, hasActed: true } } : u);
      return { ...state, units, gameSpecific: { ...gs, bomb, smokeZones, fireZones }, lastActions: playerActions };
    }

    if (action.type === 'defuse') {
      const u = units.find(u => u.id === action.unitId);
      let { defuseProgress, defusingUnitId, defuseNeeded = DEFUSE_NEEDED } = bomb;
      if (defusingUnitId !== action.unitId) {
        // New unit started defusing — kit status determines speed
        defuseProgress = 0;
        defuseNeeded   = u.hasKit ? 1 : DEFUSE_NEEDED;
      }
      defuseProgress += 1;
      bomb = { ...bomb, defuseProgress, defusingUnitId: action.unitId, defuseNeeded };
      units = units.map(u => u.id === action.unitId ? { ...u, perTurn: { ...u.perTurn, hasActed: true } } : u);

      const s3 = { ...state, units, gameSpecific: { ...gs, bomb, smokeZones, fireZones }, lastActions: playerActions };
      const rr3 = getRoundResult(s3);
      if (rr3) return startNewRound(s3, rr3);
      return s3;
    }

    if (action.type === 'skip-unit') {
      units = units.map(u => u.id === action.unitId
        ? { ...u, perTurn: { hasMoved: true, hasActed: true } } : u);
      return { ...state, units, gameSpecific: { ...gs, bomb, smokeZones, fireZones }, lastActions: playerActions };
    }

    if (action.type === 'end-turn') {
      const otherTeam     = playerId === 'T' ? 'CT' : 'T';
      const roundEndTurns = gs.roundEndTurns + 1;

      // Tick bomb timer when T ends turn after plant
      let newBomb = { ...bomb };
      if (playerId === 'T' && bomb.planted) newBomb = { ...bomb, timer: bomb.timer - 1 };

      // Tick smoke zones
      const newSmokeZones = smokeZones
        .map(sz => ({ ...sz, turnsLeft: sz.turnsLeft - 1 }))
        .filter(sz => sz.turnsLeft > 0);

      // Apply fire damage then tick fire zones
      let newFireZones = fireZones;
      if (fireZones.length > 0) {
        const fireSet = buildFireSet(fireZones);
        units = units.map(u => {
          if (!u.alive || !fireSet.has(`${u.position.x},${u.position.y}`)) return u;
          const newHp = Math.max(0, u.hp - calcDamage(FIRE_DAMAGE, u));
          return { ...u, hp: newHp, alive: newHp > 0, armor: newHp > 0 ? u.armor : 0 };
        });
        if (newBomb.defusingUnitId && !units.find(u => u.id === newBomb.defusingUnitId)?.alive)
          newBomb = { ...newBomb, defuseProgress: 0, defusingUnitId: null };
        newFireZones = fireZones
          .map(fz => ({ ...fz, turnsLeft: fz.turnsLeft - 1 }))
          .filter(fz => fz.turnsLeft > 0);
      }

      // Reset perTurn for current team; reduce blind timers (blind expires at end of their own turn)
      units = units.map(u => {
        if (u.ownerId !== playerId) return u;
        return { ...u, blinded: Math.max(0, u.blinded - 1), perTurn: { hasMoved: false, hasActed: false } };
      });

      const tentative = {
        ...state, units,
        activePlayers: [gs.teamPlayerMap[otherTeam]],
        turnNumber: playerId === 'CT' ? state.turnNumber + 1 : state.turnNumber,
        gameSpecific: { ...gs, bomb: newBomb, smokeZones: newSmokeZones, fireZones: newFireZones, roundEndTurns },
        lastActions: playerActions,
      };

      const rr = getRoundResult(tentative);
      if (rr) return startNewRound(tentative, rr);
      return tentative;
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
  const gs         = state.gameSpecific;
  const activeTeam = gs.teamMap?.[state.activePlayers[0]] ?? state.activePlayers[0];
  const phase      = state.currentPhase === 'buy'
    ? `BUY (${gs.buyPhase} buying)`
    : `ACTION (${activeTeam} to move)`;

  const teamSummary = (tid) => {
    const alive = state.units.filter(u => u.ownerId === tid && u.alive);
    const uStr  = alive.map(u => {
      let s = `${u.id}:${u.weapon}`;
      if (u.armor)  s += '+vest';
      if (u.helmet) s += '+helm';
      if (u.hasKit) s += '+kit';
      const gStr = Object.entries(u.grenades ?? {}).filter(([, c]) => c > 0).map(([g, c]) => `${g}×${c}`).join(',');
      if (gStr) s += `[${gStr}]`;
      if (u.blinded) s += '(blind)';
      return `${s}(${u.hp}hp)`;
    }).join(' ');
    return `  ${tid} $${gs.money[tid]} | ${uStr || '(all dead)'}`;
  };

  const defuseNeeded = gs.bomb?.defuseNeeded ?? DEFUSE_NEEDED;
  const bombLine = !gs.bomb?.planted
    ? '  Bomb: not planted'
    : `  Bomb: PLANTED at (${gs.bomb.plantedAt.x},${gs.bomb.plantedAt.y}) — ${gs.bomb.timer} turns left` +
      (gs.bomb.defuseProgress ? ` [defuse ${gs.bomb.defuseProgress}/${defuseNeeded}]` : '');

  const effectLines = [];
  if ((gs.smokeZones ?? []).length > 0)
    effectLines.push(`  Smoke: ${gs.smokeZones.map(s => `(${s.x},${s.y})×${s.turnsLeft}t`).join(' ')}`);
  if ((gs.fireZones ?? []).length > 0)
    effectLines.push(`  Fire:  ${gs.fireZones.map(f => `(${f.x},${f.y})×${f.turnsLeft}t`).join(' ')}`);

  return [
    `═══ Round ${gs.roundNumber}  T ${gs.tScore} — ${gs.ctScore} CT  |  ${phase} ═══`,
    renderMap(state),
    `Legend: T=Terrorist C=Counter-Terrorist A=Bombsite-A B=Bombsite-B c=CT-spawn t=T-spawn !=bomb @=smoke *=fire`,
    '',
    teamSummary('T'),
    teamSummary('CT'),
    bombLine,
    ...effectLines,
  ].join('\n');
}

// ── createInitialState ────────────────────────────────────────────────────────

export function createInitialState(players, config = {}) {
  const winRounds = config.winRounds ?? 8;
  const maxRounds = config.maxRounds ?? 15;
  const map       = MAPS[config.mapId ?? 'dust2'];

  const [p1, p2] = players;
  const teamMap       = { [p1.id]: 'T', [p2.id]: 'CT' };
  const teamPlayerMap = { T: p1.id, CT: p2.id };

  return {
    gameName: 'CS',
    turnNumber: 1,
    activePlayers: [p1.id],
    currentPhase: 'buy',
    players,
    board: { width: map.width, height: map.height },
    units: spawnUnits(map),
    lastActions: null,
    gameSpecific: {
      roundNumber: 1,
      tScore: 0, ctScore: 0,
      winRounds, maxRounds,
      buyPhase: 'T',
      money: { T: STARTING_MONEY, CT: STARTING_MONEY },
      consecutiveLosses: { T: 0, CT: 0 },
      bomb: { planted: false, plantedAt: null, timer: BOMB_TIMER,
              defuseProgress: 0, defusingUnitId: null, defuseNeeded: DEFUSE_NEEDED },
      smokeZones: [],
      fireZones: [],
      roundEndTurns: 0,
      roundResult: null,
      fogOfWar: config.fogOfWar ?? false,
      map,
      teamMap, teamPlayerMap,
    },
  };
}

// ── Adapter: translate player IDs → team IDs ─────────────────────────────────

function withTeam(fn) {
  return (state, playerIdOrActions, ...rest) => {
    const { teamMap } = state.gameSpecific;
    if (Array.isArray(playerIdOrActions)) {
      const translated = playerIdOrActions.map(pa => ({ ...pa, playerId: teamMap[pa.playerId] ?? pa.playerId }));
      return fn(state, translated, ...rest);
    }
    return fn(state, teamMap[playerIdOrActions] ?? playerIdOrActions, ...rest);
  };
}

function getVisibleState(state, teamId) {
  const VISION  = 4;
  const myUnits = state.units.filter(u => u.alive && u.ownerId === teamId);
  return {
    ...state,
    units: state.units.filter(u =>
      u.ownerId === teamId ||
      myUnits.some(m => Math.max(Math.abs(m.position.x - u.position.x), Math.abs(m.position.y - u.position.y)) <= VISION)
    ),
  };
}

const PLAYER_SPEED = MOVE_RANGE;
const BULLET_SPEED = 20;

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
  if (action.type === 'throw')  return 1.5;
  if (action.type === 'plant')  return 2;
  if (action.type === 'defuse') return 5;
  return 1;
}

// ── Fog-of-war belief sampler ───────────────────────────────────────────────
// Under fog getVisibleState hands the agent only its own team plus enemies
// within sight. csSampleWorlds reconstructs plausible full worlds ("particles")
// for the generic ObscuroAgent from the stateful CsBelief tracker (belief.js),
// which remembers sightings across turns and localises each unseen enemy near
// where it was last seen. Returns [] when fog is off (agent uses the
// observation as the single known world).
function csSampleWorlds(observation, myTeam, n, rng = Math.random) {
  if (!observation.gameSpecific.fogOfWar) return [];
  const belief = getCsBelief(observation, myTeam);
  belief.beginTurn(observation);
  return belief.sample(observation, n, rng, makeUnit);
}

export const CsGame = {
  // Heuristic leaf value for the generic ObscuroAgent: own surviving strength
  // minus the enemy's. See games/evalHelpers.js.
  // Team game: withTeam translates the player id to its team ownerId (T/CT,
  // marine/demon) before the material eval. See games/evalHelpers.js.
  evaluateState: withTeam((state, teamId) => unitStrengthEval(state, teamId)),
  // Fog of war: each team sees only enemies near its players; the generic
  // ObscuroAgent samples the unseen enemies via sampleWorlds below.
  gameOptions: [
    { id: 'fogOfWar', label: 'Fog of War', description: 'Each team sees only enemies near its own players', type: 'boolean', default: false },
  ],
  sampleWorlds: withTeam(csSampleWorlds),
  name: 'CS',
  scenarios: [
    { id: 'dust2',    name: 'Dust II',   description: 'Classic defuse map — two sites, mid control', config: { mapId: 'dust2' } },
    { id: 'de_dust',  name: 'de_dust',   description: 'Original Dust — linear corridors, symmetric sites', config: { mapId: 'de_dust' } },
    { id: 'cs_siege', name: 'cs_siege',  description: 'T storms a CT-held compound; bombsites inside', config: { mapId: 'cs_siege' } },
    { id: 'cs_italy', name: 'cs_italy',  description: 'Village map — winding streets, market and wine cellar', config: { mapId: 'cs_italy' } },
  ],
  createInitialState,
  getLegalActions:  withTeam(getLegalActions),
  applyActions:     withTeam(applyActions),
  getResult,
  renderState,
  getVisibleState:  withTeam(getVisibleState),
  getActionDuration,
};
