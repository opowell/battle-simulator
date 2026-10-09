// rules.js — Combat Mission's orders: what a unit may do, what it costs, and what it
// does when it resolves. CombatMissionGame.js wires these into the game definition.
//
// ── Time ────────────────────────────────────────────────────────────────────
// A turn is one minute of battle (TURN_SECONDS). How a unit spends it depends on the
// time axis of the session (games/spacetime.js; `gameSpecific.spacetime.time`):
//
//   discrete   — the classic budget: `ap` action points (2), a move of up to
//                `moveRange` movement points costs one, so does a burst of fire.
//   continuous — the unit has the whole minute, kept as an integer count of ticks
//                (TICKS_PER_SECOND per second, so no float dust accumulates). A move
//                costs the time it takes to walk it — terrain-weighted distance over
//                the unit's speed (moveRange × ap per minute, the same total reach as
//                two discrete moves); a burst of fire costs TURN_TICKS / ap. Spend it
//                in any mix: three short hops and a burst, one long run, two bursts.
//
// A walk's time is rounded UP to a whole tick: the tick is the game's clock quantum,
// and the only rounding there is — every budget is an integer from then on.
//
// ── Play ────────────────────────────────────────────────────────────────────
// Sequential or simultaneous ("we-go", the engine's simultaneousTurns) — either way a
// turn closes only once EVERY side has ended it: `end-turn` marks that side done and
// hands the move on to the next side still playing; the last one opens the next turn,
// refreshing every unit's budget at once (upkeep). In we-go mode the engine resolves
// both sides' orders together (engine/KineticResolver.js) and their end-turns arrive
// as each side's orders drain, so the same rule closes the turn there too.
//
// ── Fire ────────────────────────────────────────────────────────────────────
// A `fire` order names its target one of two ways:
//   { type:'fire', unitId, targetId }      — at an enemy UNIT. The shot follows it: in
//        we-go play the round flies it at the target's motion as it moves, and when it
//        lands the target must still be visible to the shooter (alive, in range, in its
//        line of sight — and, under fog, spotted by the side) or the order fizzles.
//   { type:'fire', unitId, target:{x,y} }  — area fire at a LOCATION. Everything hostile
//        within the weapon's blast radius of the point is shot at (a lower hit chance
//        than an aimed shot) and suppressed. Direct-fire weapons need line of sight to
//        the point; mortars (`indirect`) don't. This is how you shoot at where you
//        think the enemy is, under fog.
// Under fog a unit may only aim at enemies its side can see — the legal action set is
// then a function of what the player knows, which the fog search (Obscuro) needs.

import { UNIT_DEFS } from './units.js';
import { isPassableContinuous, getMoveCostContinuous } from './map.js';
import { getReachable, squareCentre } from './grid.js';
import { hasLOS } from './los.js';
import { calcHitChance, resolveFire } from './combat.js';
import { lineCost, isClearOfUnits, latticeActions } from '../continuousMove.js';
import { parsePos, num } from '../coord.js';

export const TURN_SECONDS = 60;
export const TICKS_PER_SECOND = 10;
export const TURN_TICKS = TURN_SECONDS * TICKS_PER_SECOND;
// Spotting: a side sees an enemy within this Chebyshev distance of one of its units
// that has line of sight to it (getVisibleState uses the same rule).
export const VISION = 5;
// How fast a shot crosses the map in a we-go round's playback (cells per second).
export const PROJECTILE_SPEED = 3;
// Area fire: blast radius (cells) unless a weapon names its own, and how much harder it
// is to hit something you are not aiming at.
export const AREA_RADIUS = 1;
export const AREA_PENALTY = 20;
const EPS = 1e-9;

// The quadrant this state is played in. Sessions saved before the time axis existed
// carry none — they were discrete-time sequential games.
export function spaceTimeOf(state) {
  return state.gameSpecific?.spacetime ?? { space: 'continuous', time: 'discrete', play: 'sequential' };
}

const defOf = (u) => UNIT_DEFS[u.type];
const dist = (a, b) => Math.hypot(num(a.x) - num(b.x), num(a.y) - num(b.y));

// ── budgets ──────────────────────────────────────────────────────────────────

/** A unit's budget at the start of a turn. */
export function freshPerTurn(st, def) {
  return st.time === 'continuous' ? { time: TURN_TICKS } : { ap: def.ap };
}

// Tolerant reads: a unit made by createUnit (setup, sampled fog worlds) carries the
// discrete `ap` shape, and a session whose time axis is switched mid-game keeps
// whichever shape its units had until the next upkeep.
export function ticksLeft(u) {
  if (u.perTurn?.time != null) return u.perTurn.time;
  return (u.perTurn?.ap ?? 0) > 0 ? TURN_TICKS : 0;
}
export function apLeft(u) {
  if (u.perTurn?.ap != null) return u.perTurn.ap;
  return (u.perTurn?.time ?? 0) > 0 ? defOf(u).ap : 0;
}

/** Ticks a unit takes to cover `cost` movement points (terrain-weighted distance). */
export function moveTicks(def, cost) {
  return Math.max(1, Math.ceil(cost * TURN_TICKS / (def.moveRange * def.ap) - EPS));
}
/** Ticks one burst of fire takes. */
export const fireTicks = (def) => TURN_TICKS / def.ap;

/** Movement points the unit can still spend on ONE move this turn. */
export function reachLeft(st, u) {
  const def = defOf(u);
  if (st.time === 'continuous') return ticksLeft(u) * def.moveRange * def.ap / TURN_TICKS;
  return apLeft(u) > 0 ? def.moveRange : 0;
}
export const hasBudget = (st, u) => (st.time === 'continuous' ? ticksLeft(u) : apLeft(u)) > 0;
export const canFire = (st, u) =>
  st.time === 'continuous' ? ticksLeft(u) >= fireTicks(defOf(u)) : apLeft(u) > 0;

function spend(st, u, ticks) {
  return st.time === 'continuous'
    ? { ...u.perTurn, time: Math.max(0, ticksLeft(u) - ticks) }
    : { ...u.perTurn, ap: Math.max(0, apLeft(u) - 1) };
}

// ── spotting ─────────────────────────────────────────────────────────────────

export function sees(board, m, u) {
  return Math.max(Math.abs(num(m.position.x) - num(u.position.x)), Math.abs(num(m.position.y) - num(u.position.y))) <= VISION
    && hasLOS(board, m.position, u.position);
}

/** Ids of the enemy units `playerId`'s side currently sees. */
export function spottedIds(state, playerId) {
  const mine = state.units.filter(u => u.alive && u.ownerId === playerId);
  return new Set(state.units
    .filter(u => u.ownerId !== playerId && mine.some(m => sees(state.board, m, u)))
    .map(u => u.id));
}

// ── legality ─────────────────────────────────────────────────────────────────

function ownReadyUnit(state, playerId, unitId) {
  const u = state.units.find(x => x.id === unitId);
  return u && u.alive && u.ownerId === playerId ? u : null;
}

// Terrain-weighted cost of the straight walk to (x, y), or Infinity through a wall.
function walkCost(board, from, x, y) {
  return lineCost(num(from.x), num(from.y), x, y,
    (qx, qy) => isPassableContinuous(board, qx, qy) ? getMoveCostContinuous(board, qx, qy) : Infinity);
}

// Geometric check for a move to any point (a click, a lattice point): a straight walk
// within this turn's reach, onto passable ground clear of other units.
export function isMoveLegal(state, playerId, action) {
  const unit = ownReadyUnit(state, playerId, action.unitId);
  if (!unit || !action.to) return false;
  const st = spaceTimeOf(state);
  const x = num(action.to.x), y = num(action.to.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (!isPassableContinuous(state.board, x, y)) return false;
  const reach = reachLeft(st, unit);
  if (!(reach > 0)) return false;
  if (walkCost(state.board, unit.position, x, y) > reach + EPS) return false;
  return isClearOfUnits(x, y, state.units, unit.id);
}

/** Can `shooter` fire at `target` now? (It must be visible to the shooter.) */
export function canEngage(state, playerId, shooter, target, spotted = null) {
  if (!target || !target.alive || target.ownerId === playerId) return false;
  if (state.gameSpecific?.fogOfWar && !(spotted ?? spottedIds(state, playerId)).has(target.id)) return false;
  const def = defOf(shooter);
  if (dist(shooter.position, target.position) > def.range) return false;
  return !!def.indirect || hasLOS(state.board, shooter.position, target.position);
}

export function isTargetFireLegal(state, playerId, action) {
  const shooter = ownReadyUnit(state, playerId, action.unitId);
  if (!shooter || !canFire(spaceTimeOf(state), shooter)) return false;
  return canEngage(state, playerId, shooter, state.units.find(u => u.id === action.targetId));
}

export function isAreaFireLegal(state, playerId, action) {
  const shooter = ownReadyUnit(state, playerId, action.unitId);
  if (!shooter || !canFire(spaceTimeOf(state), shooter) || !action.target) return false;
  const p = { x: num(action.target.x), y: num(action.target.y) };
  const { width, height } = state.board;
  if (!(p.x >= 0 && p.y >= 0 && p.x < width && p.y < height)) return false;
  const d = dist(shooter.position, p);
  const def = defOf(shooter);
  if (d < 0.5 || d > def.range + EPS) return false;
  return !!def.indirect || hasLOS(state.board, shooter.position, p);
}

/** Every order the engine's structural match can't cover (free points, typed labels). */
export function isActionLegal(state, playerId, action) {
  switch (action.type) {
    case 'move': return isMoveLegal(state, playerId, action);
    case 'fire': return action.targetId != null
      ? isTargetFireLegal(state, playerId, action)
      : isAreaFireLegal(state, playerId, action);
    case 'skip-unit': {
      const u = ownReadyUnit(state, playerId, action.unitId);
      return !!u && hasBudget(spaceTimeOf(state), u);
    }
    case 'end-turn': return true;
    default: return false;
  }
}

// ── enumeration ──────────────────────────────────────────────────────────────

// One representative area-fire point per unit, so the order exists in the legal set
// (a panel button needs one; the random/greedy AIs may use it): the farthest point
// the unit can hit on the bearing toward the enemy's deployment (public: startRoster),
// stepping back until the shot is legal. Snapped to quarter cells.
function areaFireCandidate(state, playerId, unit) {
  const foes = (state.gameSpecific?.startRoster ?? []).filter(r => r.ownerId !== playerId);
  if (!foes.length) return null;
  const cx = foes.reduce((s, r) => s + num(r.position.x), 0) / foes.length;
  const cy = foes.reduce((s, r) => s + num(r.position.y), 0) / foes.length;
  const ox = num(unit.position.x), oy = num(unit.position.y);
  const toward = Math.hypot(cx - ox, cy - oy);
  if (toward < 1) return null;
  const range = defOf(unit).range;
  for (let d = Math.min(range, toward); d >= 1; d -= 0.5) {
    const x = Math.round((ox + (cx - ox) / toward * d) * 4) / 4;
    const y = Math.round((oy + (cy - oy) / toward * d) * 4) / 4;
    const action = { type: 'fire', unitId: unit.id, target: { x, y } };
    // range/blast ride along for the aiming overlay (reach arc, blast preview).
    if (isAreaFireLegal(state, playerId, action))
      return { ...action, label: 'Area fire', range, blast: defOf(unit).blast ?? AREA_RADIUS };
  }
  return null;
}

const unitName = (u) => defOf(u)?.label ?? u.type;

export function getLegalActions(state, playerId) {
  const st = spaceTimeOf(state);
  const { units, board } = state;
  const spotted = spottedIds(state, playerId);
  const actions = [];

  for (const unit of units) {
    if (!unit.alive || unit.ownerId !== playerId || !hasBudget(st, unit)) continue;
    const def = defOf(unit);

    // Moves: to the middle of each square the tile graph reaches (a finite set for
    // search). In continuous time a single move is capped at one discrete move's worth,
    // and must be a straight walk the clock can pay for — the unit may still make several.
    const reach = Math.min(reachLeft(st, unit), def.moveRange);
    if (reach > 0) {
      for (const sq of getReachable(board, unit.position, reach, units)) {
        const move = { type: 'move', unitId: unit.id, to: squareCentre(sq.x, sq.y) };
        if (st.time !== 'continuous' || isMoveLegal(state, playerId, move)) actions.push(move);
      }
    }

    if (canFire(st, unit)) {
      for (const enemy of units) {
        if (canEngage(state, playerId, unit, enemy, spotted))
          actions.push({ type: 'fire', unitId: unit.id, targetId: enemy.id, label: `Fire at ${unitName(enemy)}` });
      }
      const area = areaFireCandidate(state, playerId, unit);
      if (area) actions.push(area);
    }

    actions.push({ type: 'skip-unit', unitId: unit.id });
  }

  actions.push({ type: 'end-turn', unitId: '__player__' });
  return actions;
}

// Continuous action set for the ObscuroAgent's tree search: each mover's tile moves
// are replaced by a lattice of exact reachable points (see games/continuousMove.js).
export function getSearchActions(state, playerId, res) {
  const st = spaceTimeOf(state);
  const units = state.units;
  return latticeActions(getLegalActions(state, playerId), {
    type: 'move', point: 'to',
    origin: a => {
      const u = units.find(x => x.id === a.unitId);
      return u ? { x: num(u.position.x), y: num(u.position.y), range: Math.min(reachLeft(st, u), defOf(u).moveRange) } : null;
    },
    isLegal: (a, x, y) => isMoveLegal(state, playerId, { unitId: a.unitId, to: { x, y } }),
  }, res);
}

// ── resolution ───────────────────────────────────────────────────────────────

// Every unit refreshed at once when the last side ends the turn.
function upkeep(state) {
  const st = spaceTimeOf(state);
  return {
    ...state,
    turnNumber: state.turnNumber + 1,
    activePlayers: [state.players[0].id],
    units: state.units.map(u => u.alive
      ? { ...u, perTurn: freshPerTurn(st, defOf(u)), suppression: Math.max(0, u.suppression - 1) }
      : u),
    gameSpecific: { ...state.gameSpecific, turnEnded: [] },
  };
}

function endTurn(state, playerId) {
  const ids = state.players.map(p => p.id);
  const ended = new Set([...(state.gameSpecific?.turnEnded ?? []), playerId]);
  if (ids.every(id => ended.has(id))) return upkeep(state);
  const at = ids.indexOf(playerId);
  const next = [...ids.slice(at + 1), ...ids.slice(0, at)].find(id => !ended.has(id));
  return { ...state, activePlayers: [next], gameSpecific: { ...state.gameSpecific, turnEnded: [...ended] } };
}

function fireAtPoint(state, shooter, point, rng) {
  const def = defOf(shooter);
  const radius = def.blast ?? AREA_RADIUS;
  const hits = [];
  const units = state.units.map(u => {
    if (!u.alive || u.ownerId === shooter.ownerId || dist(u.position, point) > radius) return u;
    const r = resolveFire(shooter, u, state.board, rng, AREA_PENALTY);
    hits.push({ targetId: u.id, ...r });
    const hp = Math.max(0, u.hp - r.damage);
    return { ...u, hp, alive: hp > 0, suppression: u.suppression + r.targetSuppression };
  });
  return { units, combat: { area: true, at: { x: num(point.x), y: num(point.y) }, radius, hits } };
}

export function applyActions(state, playerActions, rng = Math.random) {
  const { playerId, action } = playerActions[0];
  const st = spaceTimeOf(state);
  const done = (s) => ({ ...s, lastActions: playerActions });

  if (action.type === 'end-turn') return done(endTurn(state, playerId));

  const actor = state.units.find(u => u.id === action.unitId);
  if (!actor) return state;
  const def = defOf(actor);

  if (action.type === 'move') {
    // action.to: decimal strings (human click) or numbers (AI); stored as the
    // authoritative BigNumber position (see games/coord.js).
    const to = parsePos(action.to);
    const cost = walkCost(state.board, actor.position, num(to.x), num(to.y));
    const ticks = moveTicks(def, Number.isFinite(cost) ? cost : dist(actor.position, to));
    // A unit that moves stops facing whatever it last fired at (see `aimAt` below).
    const units = state.units.map(u => {
      if (u.id !== actor.id) return u;
      const { aimAt: _aim, ...rest } = u;
      return { ...rest, position: to, perTurn: spend(st, u, ticks) };
    });
    return done({ ...state, units });
  }

  if (action.type === 'fire') {
    // `aimAt`: where the shooter last fired — presentation only (its silhouette turns to
    // face it, CombatMissionGame's unitHeading), never read by a rule.
    const aimed = action.targetId != null ? state.units.find(u => u.id === action.targetId)?.position : action.target;
    const aimAt = aimed ? { x: num(aimed.x), y: num(aimed.y) } : undefined;
    const paid = (units) => units.map(u => u.id === actor.id ? { ...u, perTurn: spend(st, u, fireTicks(def)), aimAt } : u);
    if (action.targetId != null) {
      const target = state.units.find(u => u.id === action.targetId);
      if (!target) return state;
      const result = resolveFire(actor, target, state.board, rng);
      const units = paid(state.units.map(u => {
        if (u.id !== target.id) return u;
        const hp = Math.max(0, u.hp - result.damage);
        return { ...u, hp, alive: hp > 0, suppression: u.suppression + result.targetSuppression };
      }));
      return done({ ...state, units, gameSpecific: { ...state.gameSpecific, lastCombat: { ...result, targetId: target.id } } });
    }
    if (!action.target) return state;
    const { units, combat } = fireAtPoint(state, actor, action.target, rng);
    return done({ ...state, units: paid(units), gameSpecific: { ...state.gameSpecific, lastCombat: combat } });
  }

  if (action.type === 'skip-unit') {
    const units = state.units.map(u => u.id === actor.id
      ? { ...u, perTurn: st.time === 'continuous' ? { ...u.perTurn, time: 0 } : { ...u.perTurn, ap: 0 } } : u);
    return done({ ...state, units });
  }

  return state;
}

// ── timing (we-go playback) ──────────────────────────────────────────────────

/** Sim-seconds an order takes on the round's timeline. */
export function getActionDuration(state, action) {
  const unit = action.unitId ? state.units.find(u => u.id === action.unitId) : null;
  if (!unit) return 0;
  if (action.type === 'move') {
    const x = num(action.to.x), y = num(action.to.y);
    const cost = walkCost(state.board, unit.position, x, y);
    return moveTicks(defOf(unit), Number.isFinite(cost) ? cost : dist(unit.position, { x, y })) / TICKS_PER_SECOND;
  }
  if (action.type === 'fire') {
    const at = action.targetId != null ? state.units.find(u => u.id === action.targetId)?.position : action.target;
    return at ? dist(unit.position, at) / PROJECTILE_SPEED : 0;
  }
  return 0;
}

export const getProjectileSpeed = () => PROJECTILE_SPEED;

/** Order identity for the we-go resolver: an area shot's point is part of it. */
export function actionKey(a) {
  return JSON.stringify([a.type, a.unitId ?? null, a.to ?? null, a.targetId ?? null, a.target ?? null]);
}

/** Hit chance an aimed shot would have (for previews/tests). */
export const hitChance = (shooter, target, board) => calcHitChance(shooter, target, board);
