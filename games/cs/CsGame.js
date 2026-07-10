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
  isBombsite, euclidean, getReachable, renderMap,
  isWalkableContinuous,
} from './map.js';
import { getCsBelief, CS_VISION, csVisionCfg, csLosBlockers } from './belief.js';
import { hasClearLine, isClearOfUnits, latticeActions } from '../continuousMove.js';
import { filterVisibleUnits, orientToEnemies } from '../vision.js';
import { segmentClearOf } from '../terrainShapes.js';
import { makePos, parsePos, num, tileNum, posToWire } from '../coord.js';


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

// Blast/effect radius shown as an aim preview when throwing (see toGrid's throw
// action + the design UI's aiming overlay). Decoy has no area effect.
function grenadeBlastRadius(gid) {
  if (gid === 'he') return HE_RADIUS;
  if (gid === 'flash') return FLASH_RADIUS;
  if (gid === 'smoke') return SMOKE_RADIUS;
  if (gid === 'molotov' || gid === 'incendiary') return FIRE_RADIUS;
  return 0;
}

// What the design UI's aiming overlay should preview for each unit caught in the
// blast, while a throw is being aimed (see the 'throw' action's blastRadius above):
// 'damage' shows an estimated hp loss (matches applyActions' HE branch, which hits
// both teams), 'blind' flags the flashbang's blind-the-enemy effect (no damage
// number), 'none' covers zone effects (smoke/fire) with no instant per-unit outcome.
function grenadePreview(gid) {
  if (gid === 'he') return { previewKind: 'damage', damage: HE_DAMAGE };
  if (gid === 'flash') return { previewKind: 'blind' };
  return { previewKind: 'none' };
}

// Zone centres can be continuous (a grenade thrown to an exact point); the tile-key
// membership sets they feed are integer-keyed, so snap each centre to its tile.
function buildFireSet(fireZones) {
  const s = new Set();
  for (const fz of fireZones) {
    const cx = tileNum(fz.x), cy = tileNum(fz.y);
    for (let dy = -FIRE_RADIUS; dy <= FIRE_RADIUS; dy++)
      for (let dx = -FIRE_RADIUS; dx <= FIRE_RADIUS; dx++)
        s.add(`${cx + dx},${cy + dy}`);
  }
  return s;
}

// ── Unit factory ──────────────────────────────────────────────────────────────

function fullAmmo(weaponId) {
  const w = WEAPONS[weaponId];
  return { mag: w.magSize, reserve: w.reserve };
}

// Player-model factions (see counterstrike.fandom.com's "List of factions") — purely
// cosmetic, cycled deterministically per spawn index so a squad shows visual variety
// without adding non-determinism to game state.
const FACTIONS = {
  T:  ['arctic', 'leet', 'guerilla', 'phoenix'],
  CT: ['gign', 'gsg9', 'sas', 'seal'],
};

const FACTION_NAMES = {
  arctic: 'Arctic Avengers', leet: 'Elite Crew', guerilla: 'Guerilla Warfare', phoenix: 'Phoenix Connexion',
  gign: 'GIGN', gsg9: 'GSG-9', sas: 'SAS', seal: 'SEAL Team 6',
};

function makeUnit(id, ownerId, pos, faction) {
  return {
    id, ownerId, type: WEAPONS.pistol.category, faction,
    position: makePos(pos.x, pos.y),
    alive: true,
    hp: 100, maxHp: 100,
    money: STARTING_MONEY,   // per-unit wallet (CS money is per-player, not a team pool)
    armor: 0, helmet: false, hasKit: false,
    weapon: 'pistol',
    ammo: fullAmmo('pistol'),
    grenades: {},
    blinded: 0,
    perTurn: { hasMoved: false, hasActed: false },
  };
}

function spawnUnits(map) {
  // Orient each side toward the enemy at spawn so vision cones point across the map from
  // turn 1; facing then follows movement (see the move handler and games/vision.js).
  return orientToEnemies([
    ...map.tSpawns.map((p, i)  => makeUnit(`T-${i}`,  'T',  p,  FACTIONS.T[i % FACTIONS.T.length])),
    ...map.ctSpawns.map((p, i) => makeUnit(`CT-${i}`, 'CT', p, FACTIONS.CT[i % FACTIONS.CT.length])),
  ], p => [num(p.x), num(p.y)]);
}

// Weapon/equipment icons (see counterstrike.fandom.com's "List of weapons" and "List
// of equipment") — every WEAPONS/GRENADES key plus armor/helmet/defusekit has a
// same-named file in games/cs/images/weapons/.
const WEAPON_ICON = w => `/images/cs/weapons/${w}`;

// ── Legal actions ─────────────────────────────────────────────────────────────

function buyActions(state, teamId) {
  const myUnits = state.units.filter(u => u.alive && u.ownerId === teamId);
  const actions = [];

  for (const u of myUnits) {
    const money = u.money;   // each player buys from their own wallet, not a shared pool
    // Weapons (pistol is free/default, not buyable)
    for (const [wid, w] of Object.entries(WEAPONS)) {
      if (wid === 'pistol') continue;
      if (w.teams && !w.teams.includes(teamId)) continue;
      if (w.cost <= money && u.weapon !== wid)
        actions.push({ type: 'buy', unitId: u.id, item: wid, name: `${w.name} ($${w.cost})`, icon: WEAPON_ICON(wid) });
    }
    // Armor (kevlar)
    if (!u.armor && ARMOR_COST <= money)
      actions.push({ type: 'buy', unitId: u.id, item: 'armor', name: `Kevlar Armor ($${ARMOR_COST})`, icon: WEAPON_ICON('armor') });
    // Helmet (requires armor)
    if (u.armor && !u.helmet && EQUIPMENT.helmet.cost <= money)
      actions.push({ type: 'buy', unitId: u.id, item: 'helmet', name: `${EQUIPMENT.helmet.name} ($${EQUIPMENT.helmet.cost})`, icon: WEAPON_ICON('helmet') });
    // Defuse kit (CT only)
    if (!u.hasKit && teamId === 'CT' && EQUIPMENT.defusekit.cost <= money)
      actions.push({ type: 'buy', unitId: u.id, item: 'defusekit', name: `${EQUIPMENT.defusekit.name} ($${EQUIPMENT.defusekit.cost})`, icon: WEAPON_ICON('defusekit') });
    // Grenades
    for (const [gid, g] of Object.entries(GRENADES)) {
      if (g.teams && !g.teams.includes(teamId)) continue;
      if (g.cost <= money && (u.grenades[gid] ?? 0) < g.maxStack)
        actions.push({ type: 'buy', unitId: u.id, item: gid, name: `${g.name} ($${g.cost})`, icon: WEAPON_ICON(gid) });
    }
  }

  actions.push({ type: 'end-buy', unitId: '__player__' });
  return actions;
}

function actionPhaseActions(state, teamId) {
  const { map: { tiles } } = state.gameSpecific;
  const myUnits  = state.units.filter(u => u.alive && u.ownerId === teamId);
  const actions  = [];
  const bomb     = state.gameSpecific.bomb;
  const losBlockers = csLosBlockers(state.gameSpecific.map, state.gameSpecific.smokeZones ?? []);

  for (const u of myUnits) {
    if (!u.perTurn.hasMoved) {
      for (const to of getReachable(tiles, u.position, MOVE_RANGE, state.units))
        actions.push({ type: 'move', unitId: u.id, from: u.position, to });
    }

    if (!u.perTurn.hasActed) {
      // Shoot (not available while blinded or out of ammo in the magazine). Line of sight
      // is the exact continuous test against walls + smoke (matches getVisibleState).
      if (!u.blinded && u.ammo.mag > 0) {
        const enemies = state.units.filter(e => e.alive && e.ownerId !== teamId);
        const wpn     = WEAPONS[u.weapon];
        for (const e of enemies) {
          const d = euclidean(u.position, e.position);
          if (d <= wpn.range &&
              segmentClearOf(num(u.position.x), num(u.position.y), num(e.position.x), num(e.position.y), losBlockers))
            // damage/accuracy mirror applyActions' shoot formula (see calcDamage there) —
            // an estimate for the design UI's aiming overlay preview, not itself authoritative.
            actions.push({
              type: 'shoot', unitId: u.id, targetId: e.id, range: wpn.range,
              damage: wpn.damage, accuracy: 0.90 - 0.40 * (d / wpn.range),
            });
        }
      }

      // Reload (usable even while blinded)
      {
        const wpn = WEAPONS[u.weapon];
        if (u.ammo.mag < wpn.magSize && u.ammo.reserve > 0)
          actions.push({ type: 'reload', unitId: u.id });
      }

      // Throw grenades (usable even while blinded): one representative action per
      // grenade type held, not a tile lattice — RandomAgent expands this into exact
      // continuous points itself (see RandomAgent.js's getSearchActions fallback,
      // same lattice the Obscuro search uses), and the human UI aims freely at any
      // exact point within range (see isThrowLegal). icon/name/range/blastRadius let
      // the design UI's aiming overlay describe the throw before a point is chosen.
      for (const [gid, count] of Object.entries(u.grenades ?? {})) {
        if (!count) continue;
        actions.push({
          type: 'throw', unitId: u.id, grenade: gid,
          icon: WEAPON_ICON(gid), name: GRENADES[gid].name,
          range: GRENADE_THROW_RANGE, blastRadius: grenadeBlastRadius(gid),
          ...grenadePreview(gid),
        });
      }

      // Plant bomb (T only, at bombsite)
      if (teamId === 'T' && !bomb?.planted && isBombsite(tiles, u.position.x, u.position.y))
        actions.push({ type: 'plant', unitId: u.id });

      // Defuse bomb (CT only, standing on bomb). Positions can be continuous
      // (free-form movement), so "standing on" is a proximity check, not exact equality.
      if (teamId === 'CT' && bomb?.planted && euclidean(u.position, bomb.plantedAt) < 0.5)
        actions.push({ type: 'defuse', unitId: u.id });
    }

    if (!u.perTurn.hasMoved || !u.perTurn.hasActed)
      actions.push({ type: 'skip-unit', unitId: u.id });
  }

  actions.push({ type: 'end-turn', unitId: '__player__' });
  return actions;
}

// ── isMoveLegal (internal, called with team ID) ─────────────────────────────────
// Geometric fallback for the human UI's continuous click-to-move (see the doom
// equivalent in DoomGame.js and engine/ActionValidator.js): actionPhaseActions above
// still enumerates a discrete candidate set for AI search, but a player's move can
// target any point their click resolves to.
function isMoveLegal(state, teamId, action) {
  if (state.currentPhase !== 'action') return false; // no free-form moves during the buy phase
  const map  = state.gameSpecific.map;
  const unit = state.units.find(u => u.id === action.unitId);
  if (!unit || !unit.alive || unit.ownerId !== teamId || unit.perTurn.hasMoved) return false;
  // Continuous geometry runs in float64; convert the authoritative BigNumber position
  // and the incoming wire coordinate to Number here (see games/coord.js §2).
  const px = num(unit.position.x), py = num(unit.position.y);
  const x = num(action.to.x), y = num(action.to.y);
  if (!isWalkableContinuous(map, x, y)) return false;
  if (Math.hypot(px - x, py - y) > MOVE_RANGE) return false;
  if (!hasClearLine(px, py, x, y, (qx, qy) => !isWalkableContinuous(map, qx, qy))) return false;
  if (!isClearOfUnits(x, y, state.units, unit.id)) return false;
  return true;
}

// Geometric fallback for a human continuous grenade throw (see engine/ActionValidator.js).
// actionPhaseActions enumerates a discrete tile candidate set (getThrowTargets) for AI
// search; a player may throw to any exact point within range on a walkable tile (no LOS
// required, matching getThrowTargets). Consuming the grenade is validated at apply time.
function isThrowLegal(state, teamId, action) {
  if (state.currentPhase !== 'action') return false; // grenades are thrown in the action phase
  const map  = state.gameSpecific.map;
  const unit = state.units.find(u => u.id === action.unitId);
  if (!unit || !unit.alive || unit.ownerId !== teamId || unit.perTurn.hasActed) return false;
  if (!(unit.grenades?.[action.grenade] > 0)) return false;
  const x = num(action.target.x), y = num(action.target.y);
  if (!isWalkableContinuous(map, x, y)) return false;
  if (Math.hypot(num(unit.position.x) - x, num(unit.position.y) - y) > GRENADE_THROW_RANGE) return false;
  return true;
}

// Dispatcher for the engine's continuous-action fallback: 'move' and 'throw' carry
// continuous points a player clicked, so they can't be pre-enumerated for exact match.
function isActionLegal(state, teamId, action) {
  if (action.type === 'move')  return isMoveLegal(state, teamId, action);
  if (action.type === 'throw') return isThrowLegal(state, teamId, action);
  return false;
}

// Continuous action set for the ObscuroAgent's tree search: each mover's discrete tile
// moves AND each thrower's discrete grenade targets are replaced by a lattice of exact
// continuous points (see games/continuousMove.js), so the AI positions and aims freely
// like a human. Other actions (shoot/reload/plant/defuse/skip/end-turn) pass through.
function getSearchActions(state, teamId, res) {
  const units = state.units;
  const originOf = a => { const u = units.find(x => x.id === a.unitId); return u ? { x: num(u.position.x), y: num(u.position.y) } : null; };
  // getLegalActions is phase-aware (buy phase has no moves/throws → base passes through).
  let out = latticeActions(getLegalActions(state, teamId), {
    type: 'move', point: 'to',
    origin: a => { const o = originOf(a); return o && { ...o, range: MOVE_RANGE }; },
    isLegal: (a, x, y) => isMoveLegal(state, teamId, { unitId: a.unitId, to: { x, y } }),
  }, res);
  out = latticeActions(out, {
    type: 'throw', point: 'target',
    origin: a => { const o = originOf(a); return o && { ...o, range: GRENADE_THROW_RANGE }; },
    isLegal: (a, x, y) => isThrowLegal(state, teamId, { unitId: a.unitId, grenade: a.grenade, target: { x, y } }),
  }, res);
  return out;
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

  // Money is per-unit and persists across rounds (dead players keep their cash). Carry
  // each unit's wallet onto its freshly-respawned self, then add that team's round-end
  // reward — the win bonus, or a loss bonus that grows with consecutive losses.
  const roundReward = (team) =>
    roundWinner === team ? WIN_REWARD : lossReward(gs.consecutiveLosses[team]);
  const prevMoney = new Map(state.units.map(u => [u.id, u.money]));
  const units = spawnUnits(gs.map).map(u => ({
    ...u,
    money: Math.min(MAX_MONEY, (prevMoney.get(u.id) ?? STARTING_MONEY) + roundReward(u.ownerId)),
  }));

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
      // A buy grants the item to `unitId` AND debits that same unit's wallet — money is
      // per-player, so one CT's purchase never drains the rest of the team's cash.
      const apply = (cost, grant) => {
        units = units.map(u => u.id === unitId ? { ...grant(u), money: u.money - cost } : u);
      };

      if (item === 'armor') {
        apply(ARMOR_COST, u => ({ ...u, armor: ARMOR_HP }));
      } else if (item === 'helmet') {
        apply(EQUIPMENT.helmet.cost, u => ({ ...u, helmet: true }));
      } else if (item === 'defusekit') {
        apply(EQUIPMENT.defusekit.cost, u => ({ ...u, hasKit: true }));
      } else if (GRENADES[item]) {
        apply(GRENADES[item].cost, u => ({ ...u, grenades: { ...u.grenades, [item]: (u.grenades[item] ?? 0) + 1 } }));
      } else if (WEAPONS[item]) {
        apply(WEAPONS[item].cost, u => ({ ...u, weapon: item, type: WEAPONS[item].category, ammo: fullAmmo(item) }));
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

      // action.to: decimal strings (human continuous click) or integer tile (AI); store
      // as the authoritative BigNumber position (see games/coord.js).
      const to = parsePos(action.to);
      units = units.map(u => {
        if (u.id !== action.unitId) return u;
        // Movement-derived heading drives the unit's vision cone (games/vision.js); a
        // zero-length move keeps the prior facing.
        const dx = num(to.x) - num(u.position.x), dy = num(to.y) - num(u.position.y);
        const facing = (dx || dy) ? Math.atan2(dy, dx) : u.facing;
        return { ...u, position: to, facing, perTurn: { ...u.perTurn, hasMoved: true } };
      });
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

      units = units.map(u => u.id === action.unitId
        ? { ...u, ammo: { ...u.ammo, mag: u.ammo.mag - 1 }, perTurn: { ...u.perTurn, hasActed: true } } : u);

      if (rng() > accuracy) {
        return { ...state, units, gameSpecific: { ...gs, bomb, smokeZones, fireZones }, lastActions: playerActions };
      }

      const dmg    = calcDamage(wpn.damage, defender);
      const newHp  = Math.max(0, defender.hp - dmg);
      const killed = newHp === 0;

      units = units.map(u => u.id === action.targetId
        ? { ...u, hp: newHp, alive: !killed, armor: killed ? 0 : u.armor } : u);

      if (killed) {
        units = units.map(u => u.id === action.unitId
          ? { ...u, money: Math.min(MAX_MONEY, u.money + KILL_REWARD) } : u);
        if (bomb.defusingUnitId === action.targetId)
          bomb = { ...bomb, defuseProgress: 0, defusingUnitId: null };
      }

      const s1 = { ...state, units, gameSpecific: { ...gs, bomb, smokeZones, fireZones }, lastActions: playerActions };
      const rr1 = getRoundResult(s1);
      if (rr1) return startNewRound(s1, rr1);
      return s1;
    }

    if (action.type === 'throw') {
      const { grenade } = action;
      // target: decimal strings (human continuous click) or integer tile (AI candidate).
      const target = parsePos(action.target);
      const losBlockers = csLosBlockers(gs.map, smokeZones);

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
          units = units.map(u => u.id === action.unitId
            ? { ...u, money: Math.min(MAX_MONEY, u.money + kills * KILL_REWARD) } : u);
        if (bomb.defusingUnitId && !units.find(u => u.id === bomb.defusingUnitId)?.alive)
          bomb = { ...bomb, defuseProgress: 0, defusingUnitId: null };

      } else if (grenade === 'flash') {
        units = units.map(u => {
          if (!u.alive || u.ownerId === playerId) return u;
          if (euclidean(u.position, target) <= FLASH_RADIUS &&
              segmentClearOf(num(u.position.x), num(u.position.y), num(target.x), num(target.y), losBlockers))
            return { ...u, blinded: FLASH_BLIND_TURNS };
          return u;
        });

      } else if (grenade === 'smoke') {
        smokeZones = [...smokeZones, { x: num(target.x), y: num(target.y), turnsLeft: SMOKE_TURNS }];

      } else if (grenade === 'molotov' || grenade === 'incendiary') {
        fireZones = [...fireZones, { x: num(target.x), y: num(target.y), turnsLeft: FIRE_TURNS }];
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

    if (action.type === 'reload') {
      units = units.map(u => {
        if (u.id !== action.unitId) return u;
        const wpn    = WEAPONS[u.weapon];
        const needed = wpn.magSize - u.ammo.mag;
        const drawn  = Math.min(needed, u.ammo.reserve);
        return { ...u,
          ammo: { mag: u.ammo.mag + drawn, reserve: u.ammo.reserve - drawn },
          perTurn: { ...u.perTurn, hasActed: true } };
      });
      return { ...state, units, gameSpecific: { ...gs, bomb, smokeZones, fireZones }, lastActions: playerActions };
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
          if (!u.alive || !fireSet.has(`${tileNum(u.position.x)},${tileNum(u.position.y)}`)) return u;
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
    const teamUnits = state.units.filter(u => u.ownerId === tid);
    const cash  = teamUnits.reduce((a, u) => a + (u.money ?? 0), 0);
    const uStr  = teamUnits.filter(u => u.alive).map(u => {
      let s = `${u.id}:${u.weapon}(${u.ammo.mag}/${u.ammo.reserve})`;
      if (u.armor)  s += '+vest';
      if (u.helmet) s += '+helm';
      if (u.hasKit) s += '+kit';
      const gStr = Object.entries(u.grenades ?? {}).filter(([, c]) => c > 0).map(([g, c]) => `${g}×${c}`).join(',');
      if (gStr) s += `[${gStr}]`;
      if (u.blinded) s += '(blind)';
      return `${s}(${u.hp}hp,$${u.money})`;
    }).join(' ');
    return `  ${tid} $${cash} | ${uStr || '(all dead)'}`;
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

// ── toGrid (design UI) ──────────────────────────────────────────────────────────

const TERRAIN_INFO = {
  wall:      { name: 'Wall',       description: 'Impassable, blocks line of sight.' },
  floor:     { name: 'Floor',      description: 'Open ground.' },
  bombsiteA: { name: 'Bombsite A', description: 'Bomb can be planted or defused here.' },
  bombsiteB: { name: 'Bombsite B', description: 'Bomb can be planted or defused here.' },
  ctSpawn:   { name: 'CT Spawn',   description: 'Counter-Terrorist starting area.' },
  tSpawn:    { name: 'T Spawn',    description: 'Terrorist starting area.' },
};

const SHAPE_FLOOR = '#c8c0a8';

// Dynamic effects (smoke/fire/bomb) as render shapes, so they layer above the terrain
// rather than recolouring the flat tile backdrop.
function effectShapes(gs) {
  const out = [];
  for (const sz of gs.smokeZones ?? [])
    out.push({ shape: 'oval', x: sz.x - SMOKE_RADIUS, y: sz.y - SMOKE_RADIUS,
               w: SMOKE_RADIUS * 2 + 1, h: SMOKE_RADIUS * 2 + 1, fill: '#9098a0', opacity: 0.6 });
  for (const fz of gs.fireZones ?? [])
    out.push({ shape: 'oval', x: fz.x - FIRE_RADIUS, y: fz.y - FIRE_RADIUS,
               w: FIRE_RADIUS * 2 + 1, h: FIRE_RADIUS * 2 + 1, fill: '#c85a2a', opacity: 0.6 });
  if (gs.bomb?.planted)
    out.push({ shape: 'oval', x: num(gs.bomb.plantedAt.x) - 0.1, y: num(gs.bomb.plantedAt.y) - 0.1,
               w: 1.2, h: 1.2, fill: '#e04040' });
  return out;
}

function equipmentList(u) {
  const activeGrenades = Object.entries(u.grenades ?? {}).filter(([, c]) => c > 0);
  const grenadeStr = activeGrenades
    .map(([g, c]) => `${GRENADES[g]?.name ?? g}${c > 1 ? ` ×${c}` : ''}`)
    .join(', ');
  return [
    { label: 'Weapon',  value: WEAPONS[u.weapon]?.name ?? u.weapon, icon: WEAPON_ICON(u.weapon) },
    { label: 'Ammo',    value: `${u.ammo.mag} / ${u.ammo.reserve}` },
    { label: 'Armor',   value: u.armor ? (u.helmet ? 'Vest + Helmet' : 'Vest') : 'None',
      icon: u.armor ? WEAPON_ICON(u.helmet ? 'helmet' : 'armor') : undefined },
    { label: 'Grenades', value: grenadeStr || 'None',
      icon: activeGrenades.length === 1 ? WEAPON_ICON(activeGrenades[0][0]) : undefined },
    ...(u.ownerId === 'CT' ? [{ label: 'Defuse Kit', value: u.hasKit ? 'Yes' : 'No',
      icon: u.hasKit ? WEAPON_ICON('defusekit') : undefined }] : []),
  ];
}

function toGrid(state) {
  const { units, gameSpecific: gs } = state;
  const { tiles, width, height }    = gs.map;
  const playerIdx = {};
  (state.players ?? []).forEach((p, i) => { playerIdx[p.id] = i + 1; });

  // Terrain-only cells (uniform floor; walls/sites drawn as the SVG shapes below).
  // Unit positions travel in the continuous `units` channel, not by exact-match into
  // this integer grid — every CS map renders as layered SVG shapes and effects
  // (smoke/fire/bomb) draw on top.
  const cells = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = tiles[`${x},${y}`] ?? 'floor';
      cells.push({
        x, y,
        color:   SHAPE_FLOOR,
        terrain: TERRAIN_INFO[t] ?? TERRAIN_INFO.floor,
      });
    }
  }

  // Continuous unit channel: real (possibly non-integer) positions as decimal strings
  // (see games/coord.js), built directly from state.units.
  const unitList = units.filter(u => u.alive).map(u => {
    const p = posToWire(u.position);
    return {
      id: u.id, x: p.x, y: p.y,
      glyph:         'P',
      unitName:      FACTION_NAMES[u.faction] ?? u.id,
      facing:        u.facing,
      money:         u.money,
      // Weapon category (pistol/smg/shotgun/heavy/rifle/sniper), not just the constant
      // 'player' — feeds the generic per-type marker-shape hash (see data.js's
      // markerShapeFor) so a squad's loadouts stay visually distinguishable on the map.
      type:          u.type,
      owner:         playerIdx[gs.teamPlayerMap[u.ownerId]] ?? 0,
      hp:            u.hp,
      maxHp:         u.maxHp,
      job:           u.weapon,
      portraitPath:  `/images/cs/units/${u.faction}`,
      moveRange:     MOVE_RANGE,
      equipment:     equipmentList(u),
      statusEffects: u.blinded ? ['blinded'] : undefined,
      moved:         u.perTurn?.hasMoved,
      acted:         u.perTurn?.hasActed,
      // Fraction of incoming damage this unit shrugs off — lets the design UI's aiming
      // overlay show a generic "expected damage" preview (rawDamage * (1 - reduction))
      // for shoot/throw without knowing CS's armor/helmet model itself.
      damageReduction: u.armor ? ARMOR_REDUCTION + (u.helmet ? HELMET_EXTRA_REDUCTION : 0) : 0,
    };
  });

  // Occluder geometry for the client's fog/reach renderer — the SAME shapes the engine's
  // getVisibleState blocks sight on (csLosBlockers: authored walls incl. ovals like the
  // furnace pit, plus active smoke clouds), so the drawn veil hides exactly what the
  // engine hides. Hand-laid grid maps (none currently) fall back to rasterized wall tiles.
  let los;
  if (gs.map.terrainShapes) {
    los = { blockShapes: csLosBlockers(gs.map, gs.smokeZones ?? []) };
  } else {
    const blocked = [];
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (tiles[`${x},${y}`] === 'wall') blocked.push(`${x},${y}`);
    los = { blocked };
  }

  return {
    width, height, locationType: 'continuous', cells, units: unitList,
    shapes: [...(gs.map.shapes ?? []), ...effectShapes(gs)],
    // Hand the veil the SAME sight range + cone the engine reveals with (CS_VISION), so the
    // drawn vision matches getVisibleState exactly (both Euclidean now).
    // Move/shoot/throw pick a button first, then a location/direction on the map itself
    // (see the design UI's aiming overlay) instead of listing one button per legal
    // move point/target/tile — these carry continuous aim points or resolve to a
    // target by click direction, so they don't fit a flat action list.
    ui: { hideGrid: true, visionRange: CS_VISION.range, fovDegrees: CS_VISION.fovDegrees,
          aimedActionTypes: ['move', 'throw', 'shoot'] },
    los,
  };
}

// ── createInitialState ────────────────────────────────────────────────────────

export function createInitialState(players, config = {}) {
  const winRounds = config.winRounds ?? 8;
  const maxRounds = config.maxRounds ?? 15;
  const map       = MAPS[config.mapId ?? config.scenario ?? 'dust2'] ?? MAPS.dust2;

  const [p1, p2] = players;
  // Slot 0 is always colored teamA (blue) and slot 1 teamB (red) by the generic
  // design-UI slot coloring, so map slot 0 → CT and slot 1 → T to match the
  // conventional CS colors (CT blue, T red).
  const teamMap       = { [p1.id]: 'CT', [p2.id]: 'T' };
  const teamPlayerMap = { CT: p1.id, T: p2.id };

  return {
    gameName: 'CS',
    turnNumber: 1,
    activePlayers: [teamPlayerMap.T],
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
  // Own units + any enemy within an own unit's range and facing cone AND line of sight
  // (walls + smoke). csVisionCfg is shared with belief.js so observation and fog sampler
  // agree — see games/vision.js.
  const cfg = csVisionCfg(state.gameSpecific.map, state.gameSpecific.smokeZones ?? []);
  return {
    ...state,
    units: filterVisibleUnits(state.units, teamId, cfg, p => [num(p.x), num(p.y)]),
  };
}

const PLAYER_SPEED = MOVE_RANGE;
const BULLET_SPEED = 20;

function getActionDuration(state, action) {
  if (action.type === 'move') {
    const unit = state.units.find(u => u.id === action.unitId);
    if (!unit) return 1;
    const from = action.from ?? unit.position;
    const dx = num(action.to.x) - num(from.x), dy = num(action.to.y) - num(from.y);
    return Math.sqrt(dx * dx + dy * dy) / PLAYER_SPEED;
  }
  if (action.type === 'shoot') {
    const shooter = state.units.find(u => u.id === action.unitId);
    const target  = state.units.find(u => u.id === action.targetId);
    if (!shooter || !target) return 1;
    const dx = num(target.position.x) - num(shooter.position.x);
    const dy = num(target.position.y) - num(shooter.position.y);
    return Math.sqrt(dx * dx + dy * dy) / BULLET_SPEED;
  }
  if (action.type === 'throw')  return 1.5;
  if (action.type === 'plant')  return 2;
  if (action.type === 'defuse') return 5;
  if (action.type === 'reload') return 2.5;
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
    { id: 'fogOfWar', label: 'Fog of War', description: 'Each team sees only enemies near its own players', type: 'boolean', default: true },
  ],
  sampleWorlds: withTeam(csSampleWorlds),
  name: 'CS',
  scenarios: [
    { id: 'dust2',    name: 'Dust II',   description: 'Classic defuse map — two sites, mid control', config: { mapId: 'dust2' } },
    { id: 'de_dust',  name: 'de_dust',   description: 'Original Dust — linear corridors, symmetric sites', config: { mapId: 'de_dust' } },
    { id: 'cs_siege', name: 'cs_siege',  description: 'T storms a CT-held compound; bombsites inside', config: { mapId: 'cs_siege' } },
    { id: 'cs_italy', name: 'cs_italy',  description: 'Village map — winding streets, market and wine cellar', config: { mapId: 'cs_italy' } },
    { id: 'de_forge', name: 'de_forge',  description: 'Shape terrain — foundry split by a central oval furnace pit', config: { mapId: 'de_forge' } },
    { id: 'de_pond',  name: 'de_pond',   description: 'Shape terrain — waterfront routed around two oval ponds', config: { mapId: 'de_pond' } },
    { id: 'de_plaza', name: 'de_plaza',  description: 'Shape terrain — open oval plaza with a central fountain', config: { mapId: 'de_plaza' } },
  ],
  createInitialState,
  getLegalActions:  withTeam(getLegalActions),
  isActionLegal:    withTeam(isActionLegal),
  getSearchActions: withTeam(getSearchActions),
  applyActions:     withTeam(applyActions),
  getResult,
  renderState,
  toGrid,
  getVisibleState:  withTeam(getVisibleState),
  getActionDuration,
};
