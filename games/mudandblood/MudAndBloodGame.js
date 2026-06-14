import { createMap, renderMap } from './map.js';
import { getReachable, manhattan } from './grid.js';
import { calcHitChance, rollHit, rollDamage } from './combat.js';
import { createUnit } from './units.js';

// ---------------------------------------------------------------------------
// Wave definitions — each wave index = wave number - 1
// ---------------------------------------------------------------------------

const WAVE_DEFS = [
  // Wave 1 (deployed at game start)
  [
    { type: 'grenadier', x: 3  },
    { type: 'grenadier', x: 10 },
    { type: 'grenadier', x: 17 },
  ],
  // Wave 2
  [
    { type: 'grenadier', x: 2  },
    { type: 'grenadier', x: 7  },
    { type: 'mg42',      x: 10 },
    { type: 'grenadier', x: 13 },
    { type: 'grenadier', x: 18 },
  ],
  // Wave 3
  [
    { type: 'grenadier', x: 1  },
    { type: 'grenadier', x: 5  },
    { type: 'mg42',      x: 9  },
    { type: 'officer',   x: 12 },
    { type: 'grenadier', x: 15 },
    { type: 'grenadier', x: 19 },
  ],
  // Wave 4
  [
    { type: 'grenadier', x: 0  },
    { type: 'mg42',      x: 4  },
    { type: 'grenadier', x: 7  },
    { type: 'officer',   x: 10 },
    { type: 'grenadier', x: 13 },
    { type: 'mg42',      x: 17 },
  ],
  // Wave 5
  [
    { type: 'mg42',    x: 1  },
    { type: 'grenadier', x: 5  },
    { type: 'officer', x: 8  },
    { type: 'grenadier', x: 11 },
    { type: 'mg42',    x: 14 },
    { type: 'officer', x: 17 },
  ],
  // Wave 6 (final)
  [
    { type: 'mg42',    x: 0  },
    { type: 'grenadier', x: 3  },
    { type: 'officer', x: 6  },
    { type: 'mg42',    x: 9  },
    { type: 'grenadier', x: 13 },
    { type: 'officer', x: 16 },
    { type: 'mg42',    x: 19 },
  ],
];

const TOTAL_WAVES   = WAVE_DEFS.length;
const WAVE_INTERVAL = 4; // full rounds between waves

function spawnWave(waveNumber, axisId, counter) {
  const defs = WAVE_DEFS[waveNumber - 1];
  return defs.map((def, i) =>
    createUnit(`axis-w${waveNumber}-${counter + i}`, def.type, axisId, { x: def.x, y: 0 })
  );
}

// ---------------------------------------------------------------------------
// Allied starting positions — in the trench and sandbags
// ---------------------------------------------------------------------------

function defaultAllies(alliesId) {
  return [
    createUnit('allies-0', 'rifleman', alliesId, { x: 3,  y: 8 }),
    createUnit('allies-1', 'mg',       alliesId, { x: 8,  y: 7 }),
    createUnit('allies-2', 'sniper',   alliesId, { x: 12, y: 8 }),
    createUnit('allies-3', 'medic',    alliesId, { x: 16, y: 8 }),
    createUnit('allies-4', 'rifleman', alliesId, { x: 19, y: 8 }),
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nearbyOfficerBonus(state, unit) {
  return state.units.some(u =>
    u.alive && u.ownerId === unit.ownerId && u.attrs.isOfficer && u.id !== unit.id &&
    manhattan(u.position, unit.position) <= 2
  ) ? 10 : 0;
}

function fmtUnit(u) {
  if (!u.alive) return `${u.attrs.symbol}(KIA)`;
  const sup = u.suppression > 0 ? ` SUP:${u.suppression}` : '';
  return `${u.attrs.symbol}(${u.hp}hp AP:${u.perTurn.ap}${sup})`;
}

// ---------------------------------------------------------------------------
// Game definition
// ---------------------------------------------------------------------------

export const MudAndBloodGame = {
  name: 'Mud and Blood 2',

  createInitialState(players, _config = {}) {
    const [alliesPlayer, axisPlayer] = players;
    const wave1 = spawnWave(1, axisPlayer.id, 0);
    return {
      gameName: 'mudandblood',
      turnNumber: 1,
      activePlayers: [alliesPlayer.id],
      currentPhase: 'allies-turn',
      players,
      units: [...defaultAllies(alliesPlayer.id), ...wave1],
      board: createMap(),
      wave: 1,
      waveTimer: WAVE_INTERVAL,
      axisUnitCounter: wave1.length,
      lastActions: [],
      log: [`Wave 1 incoming! (${wave1.length} units)`],
    };
  },

  getLegalActions(state, playerId) {
    const myUnits  = state.units.filter(u => u.alive && u.ownerId === playerId);
    const enemies  = state.units.filter(u => u.alive && u.ownerId !== playerId);
    const actions  = [];

    for (const unit of myUnits) {
      if (unit.perTurn.ap <= 0) continue;

      // Move (costs 1 AP)
      if (unit.perTurn.ap >= 1) {
        const reachable = getReachable(state.board, unit.position, unit.attrs.moveRange, state.units);
        for (const to of reachable) {
          actions.push({ type: 'move', unitId: unit.id, from: unit.position, to });
        }
      }

      // Shoot (costs all remaining AP, requires >= 1 AP)
      for (const enemy of enemies) {
        if (manhattan(unit.position, enemy.position) <= unit.attrs.maxRange) {
          actions.push({ type: 'shoot', unitId: unit.id, targetId: enemy.id });
        }
      }

      // Heal (medic only, costs all AP, adjacent damaged ally)
      if (unit.attrs.canHeal && unit.perTurn.ap >= 2) {
        const allies = state.units.filter(u =>
          u.alive && u.ownerId === playerId && u.id !== unit.id && u.hp < u.maxHp
        );
        for (const ally of allies) {
          if (manhattan(unit.position, ally.position) <= 1) {
            actions.push({ type: 'heal', unitId: unit.id, targetId: ally.id });
          }
        }
      }
    }

    actions.push({ type: 'end-turn', unitId: '__player__' });
    return actions;
  },

  applyActions(state, playerActions, rng = Math.random) {
    const { playerId, action } = playerActions[0];
    let { units } = state;

    // ---- Move ----
    if (action.type === 'move') {
      units = units.map(u => {
        if (u.id !== action.unitId) return u;
        return { ...u, position: action.to, perTurn: { ap: u.perTurn.ap - 1 } };
      });
      return { ...state, units, lastActions: playerActions, log: [] };
    }

    // ---- Shoot ----
    if (action.type === 'shoot') {
      const shooter    = units.find(u => u.id === action.unitId);
      const target     = units.find(u => u.id === action.targetId);
      const bonus      = nearbyOfficerBonus(state, shooter);
      const hitChance  = calcHitChance(shooter, target, state.board, bonus);
      const { hit, crit, roll } = rollHit(hitChance, rng);
      const damage     = hit ? rollDamage(shooter, crit, rng) : 0;

      units = units.map(u => {
        if (u.id === action.unitId) return { ...u, perTurn: { ap: 0 } };
        if (u.id === action.targetId) {
          const newHp = Math.max(0, u.hp - damage);
          return { ...u, hp: newHp, alive: newHp > 0, suppression: Math.min(3, u.suppression + 1) };
        }
        return u;
      });

      const enriched = { playerId, action: { ...action, hitChance, hit, crit, damage, roll } };
      return { ...state, units, lastActions: [enriched], log: [] };
    }

    // ---- Heal ----
    if (action.type === 'heal') {
      units = units.map(u => {
        if (u.id === action.unitId) return { ...u, perTurn: { ap: 0 } };
        if (u.id === action.targetId) return { ...u, hp: Math.min(u.maxHp, u.hp + 4) };
        return u;
      });
      return { ...state, units, lastActions: playerActions, log: [] };
    }

    // ---- End Turn ----
    if (action.type === 'end-turn') {
      const playerIdx = state.players.findIndex(p => p.id === playerId);
      const nextIdx   = (playerIdx + 1) % state.players.length;
      const nextId    = state.players[nextIdx].id;
      const isNewRound = nextIdx === 0;

      // Refresh next player's units: reset AP, reduce suppression by 1
      units = units.map(u =>
        u.ownerId === nextId
          ? { ...u, perTurn: { ap: u.attrs.maxAP }, suppression: Math.max(0, u.suppression - 1) }
          : u
      );

      let { wave, waveTimer, axisUnitCounter } = state;
      const spawnLog = [];

      // After each complete round (when Axis ends their turn), tick the wave timer
      if (isNewRound) {
        waveTimer -= 1;
        if (waveTimer <= 0 && wave < TOTAL_WAVES) {
          wave++;
          const axisId   = state.players[1].id;
          const newUnits = spawnWave(wave, axisId, axisUnitCounter);
          axisUnitCounter += newUnits.length;
          units = [...units, ...newUnits];
          waveTimer = WAVE_INTERVAL;
          spawnLog.push(`Wave ${wave} incoming! (${newUnits.length} units)`);
        }
      }

      return {
        ...state,
        units,
        activePlayers:  [nextId],
        currentPhase:   nextIdx === 0 ? 'allies-turn' : 'axis-turn',
        turnNumber:     isNewRound ? state.turnNumber + 1 : state.turnNumber,
        wave, waveTimer, axisUnitCounter,
        lastActions: playerActions,
        log: spawnLog,
      };
    }

    return state;
  },

  getResult(state) {
    const [alliesPlayer, axisPlayer] = state.players;

    // Axis wins if any unit reaches the Allied trench (y >= 8)
    if (state.units.some(u => u.alive && u.ownerId === axisPlayer.id && u.position.y >= 8)) {
      return { outcome: 'win', winnerId: axisPlayer.id, reason: 'trench-breached' };
    }

    // Allies win if all waves have been deployed and all Axis units are dead
    if (state.wave >= TOTAL_WAVES && !state.units.some(u => u.alive && u.ownerId === axisPlayer.id)) {
      return { outcome: 'win', winnerId: alliesPlayer.id, reason: `all-${TOTAL_WAVES}-waves-defeated` };
    }

    return null;
  },

  renderState(state) {
    const { turnNumber, activePlayers, units, players, wave, waveTimer, log } = state;
    const [alliesPlayer, axisPlayer] = players;
    const phase = activePlayers[0] === alliesPlayer.id ? 'ALLIED turn' : 'AXIS turn';

    const waveInfo = wave < TOTAL_WAVES
      ? `Wave ${wave}/${TOTAL_WAVES}  (next in ${waveTimer} rounds)`
      : `Wave ${wave}/${TOTAL_WAVES}  FINAL WAVE`;

    const mapStr = renderMap(state.board, units);

    const alliedUnits = units.filter(u => u.ownerId === alliesPlayer.id);
    const axisUnits   = units.filter(u => u.ownerId === axisPlayer.id && u.alive);
    const statusStr = [
      `ALLIES [${alliesPlayer.name}]: ${alliedUnits.map(fmtUnit).join('  ')}`,
      `AXIS   [${axisPlayer.name}]:   ${axisUnits.length} active — ${axisUnits.map(fmtUnit).join('  ')}`,
    ].join('\n');

    let lastStr = '';
    if (state.lastActions?.length) {
      const { action } = state.lastActions[0];
      if (action?.type === 'shoot') {
        const shooter = units.find(u => u.id === action.unitId);
        const target  = units.find(u => u.id === action.targetId);
        const sName = shooter ? `${shooter.type}(${action.unitId})` : action.unitId;
        const tName = target  ? `${target.type}(${action.targetId})` : action.targetId;
        const result = action.hit
          ? (action.crit ? `CRIT! ${action.damage} dmg` : `HIT ${action.damage} dmg`)
          : 'MISS';
        lastStr = `>> ${sName} → ${tName}  [${action.hitChance}% hit, rolled ${action.roll}]  ${result}`;
      } else if (action?.type === 'heal') {
        lastStr = `>> medic healed ${action.targetId} (+4 HP)`;
      }
    }

    const logLines = (log ?? []).map(l => `!! ${l}`);

    return [
      `Turn ${turnNumber} — ${phase}  |  ${waveInfo}`,
      mapStr,
      '',
      statusStr,
      lastStr,
      ...logLines,
    ].filter(Boolean).join('\n');
  },

  getActionDuration(state, action) {
    if (action.type === 'move') {
      const unit = state.units.find(u => u.id === action.unitId);
      if (!unit) return 1;
      const from = action.from ?? unit.position;
      const dist = Math.max(Math.abs(action.to.x - from.x), Math.abs(action.to.y - from.y));
      return dist / (unit.attrs?.moveRange ?? 2);
    }
    if (action.type === 'shoot') return 0.5;
    if (action.type === 'heal')  return 0.75;
    return 1;
  },

  getVisibleState(state, _playerId) {
    // Open battlefield — no fog of war
    return state;
  },
};
