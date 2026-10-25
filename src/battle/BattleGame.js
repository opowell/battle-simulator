// ---------------------------------------------------------------------------
// BattleGame — the core's battle, driven by a spec.
//
// One GameDefinition for every battle the core can describe: the board (square,
// hex, regions or a plane of shapes), the units (core numbers plus declared
// attributes), their abilities, facing, and how the battle is won all come from
// a battle spec (spec.js), which is data. `makeBattleGame` makes one with a
// default spec, a set of named specs (scenarios) and the hooks those specs may
// name; Arena (games/arena) is the core's own.
//
// The same rules run in all eight corners of (space × time × play):
//
//   space  discrete     units stand on cells; distance is the board's (Chebyshev
//                       or Manhattan on squares, hex distance, hops between
//                       regions); a move is a path of neighbour steps, each
//                       costing the entered cell's terrain price for the unit's
//                       movement class.
//          continuous   units stand on exact points (square and shape boards);
//                       distance is Euclidean; a move is a straight segment,
//                       priced exactly by the length it spends in each terrain.
//
//   time   discrete     a turn is a window of budgets: one move of up to
//                       `speed` movement points and `rate` actions per unit, in
//                       either order. A turn ends when every seat has ended it.
//          continuous   one clock (gameSpecific.rt.clock, in turn windows). An
//                       IDLE unit takes an order, and the order is a task that
//                       finishes later: a move takes cost/speed of a window (the
//                       unit travels meanwhile), an ability lands after its
//                       wind-up (ATTACK_TIME/rate for an attack), a wait for
//                       whatever length was named, a turn for its turn cost.
//                       When nobody has a decision left at this instant the
//                       clock runs to the next completion — or to the end of a
//                       window, where pools regenerate and statuses run down.
//
//   play   sequential   discrete time: I-go-you-go. Continuous time: the seats
//                       with decisions at an instant make them one after another
//                       in initiative order (which rotates every instant).
//          simultaneous discrete time: the engine's we-go path (every seat plans a
//                       turn, src/engine/KineticResolver.js plays them out
//                       together). Continuous time: every seat with a decision
//                       is on move at once.
//
// Fog (`fogOfWar`) hides what no unit of a side sees: vision range, line of
// sight, facing cones, concealing ground; cloaked units need a detector. With
// `fogMemory` a side also keeps where it last saw each enemy.
// ---------------------------------------------------------------------------

import * as ST from '../kit/spacetime.js';
import { resolveSpec, checkSpec, STAT_KEYS, BASE_SPEC } from './spec.js';
import {
  registerBattleGame, rulesOf, st, isContinuousTime, isContinuousSpace, live, seatIds, boardIn, pointOf,
  gap, gapBetween, typeOf, domainOf, stat, statusesOf, blocked, facingOf, bearing, angleBetween,
  seenBy, hiddenFrom, aliveCounts, costFor, passableFor, membersOf, dice, attrsEnv, EPS,
} from './world.js';
import { makeUnit, dress, freshPerTurn, apBudget, addStatus, adjustPool, regenOf, withUnits, BUILT_IN } from './units.js';
import { abilityActions, abilityLegal, abilityOf, damageOf, dealDamage, applyOtherEffects, affected, canUseNow, canTarget, canTargetPoint, abilitiesOf, apCost, landed } from './abilities.js';
import { judgeNow, judgeWindow, resultOf, keepsVerdict } from './victory.js';
import { formula, whole } from './exact.js';
import { callHook } from './world.js';
import { mintForeign } from '../engine/foreignUnits.js';
import { patternsOf, pieceTargets, legalPieceMoves, pieceAction, matchPieceMove, passingOf, occupancy, occAfter, inCheck, checkTag } from './patterns.js';

/** Body radius in continuous space: two units stand at least 2R apart. */
export const UNIT_R = 0.35;
/** Length of one turn window, in clock units. */
export const TURN_DURATION = 1;
/** A strike's wind-up, in turn windows, at rate 1 (rate 2 → half as long). */
export const ATTACK_TIME = 0.5;
/** Shortest / longest wait an idle unit may be told to hold (continuous time). */
export const MIN_WAIT = 0.01;
export const MAX_WAIT = 8;
/** Shortest turn on a clock: a turn that cost nothing would be a free decision for ever. */
const MIN_TURN = 0.1;
/** Clock advance when every seat passes with nothing in progress. */
const IDLE_TICK = 0.5;
/** Consecutive empty advances before the game is a standoff (a draw). */
const MAX_IDLE_TICKS = 40;
/** Continuous-space destination lattice: rings × spokes points, plus strike points. */
const RINGS = 3, SPOKES = 12;

// ── Movement (src/kit/spacetime.js does the quadrant arithmetic) ───────────────

// Where other units stand — and, in continuous time, where moving units are
// going to stand, so two orders cannot claim the same spot.
function claims(state, selfId) {
  const out = [];
  for (const u of state.units) {
    if (!u.alive || u.id === selfId) continue;
    out.push({ u, p: u.position });
    if (u.task?.type === 'move') out.push({ u, p: u.task.to });
  }
  return out;
}

// The price of stepping from `from` into `to` for `unit`, or Infinity: the
// entered cell's terrain for the unit's class, plus climbing.
function stepCost(state, unit, from, to) {
  const B = boardIn(state);
  const t = B.terrainAt(to.x, to.y);
  const domain = domainOf(state, unit);
  if (!passableFor(t, domain) || B.stepBlocked(from, to)) return Infinity;
  let cost = costFor(t, domain);
  if (B.elevated && domain !== 'air') {
    const rise = B.elevAt(to) - B.elevAt(from);
    const jump = typeOf(state, unit).jump;
    if (jump != null && Math.abs(rise) > jump) return Infinity;
    if (rise > 0) cost += rise * (rulesOf(state).spec.board?.climb ?? 1);
  }
  return cost;
}

export const kinematics = {
  turnDuration: TURN_DURATION,
  speed: (u, state) => (state ? stat(state, u, 'speed') : u.stats.speed),
  // Discrete space: neighbour steps priced by the entered cell. A unit may pass
  // through friends (unless the board says `passFriends: false`) but not
  // enemies; where it may STOP is filtered afterwards.
  neighbors(pos, unit, state) {
    const out = [];
    const B = boardIn(state);
    const throughFriends = rulesOf(state).spec.board?.passFriends !== false;
    for (const to of B.adjacent(pos)) {
      const cost = stepCost(state, unit, pos, to);
      if (cost === Infinity) continue;
      if (state.units.some(o => o.alive && o.id !== unit.id && (!throughFriends || o.ownerId !== unit.ownerId) && o.position.x === to.x && o.position.y === to.y)) continue;
      out.push({ to, cost });
    }
    return out;
  },
  walkable: (x, y, unit, state) => passableFor(boardIn(state).terrainUnder(x, y), domainOf(state, unit)),
  occupied: (x, y, unit, state) => claims(state, unit.id).some(({ p }) => Math.hypot(p.x - x, p.y - y) < 2 * UNIT_R - EPS),
};

// May `unit` stop on cell c? One unit a cell, unless the ruleset stacks: then
// friends share (and a counted group joins one of its own type, mergeGroups).
function cellFree(state, unit, c) {
  const mode = rulesOf(state).stacking;
  const here = claims(state, unit.id).filter(({ p }) => p.x === c.x && p.y === c.y).map(({ u }) => u);
  if (mode === 'one') return !here.length;
  return !here.some(u => u.ownerId !== unit.ownerId);
}

/** How far `unit` may still travel on one order. */
function reach(state, unit) {
  return isContinuousTime(state) ? stat(state, unit, 'speed') : unit.perTurn.moveLeft;
}

/** Every place `unit` may be ordered to: [{ to, cost, path }]. */
export function destinations(state, unit) {
  const s = st(state);
  const budget = reach(state, unit);
  if (!(budget > EPS) || blocked(state, unit, 'move')) return [];
  if (s.space === 'discrete') {
    return ST.enumerateDestinations(kinematics, unit, state, s, budget).filter(d => cellFree(state, unit, d.to));
  }
  const o = unit.position;
  const pts = ST.enumerateDestinations({ ...kinematics, rings: RINGS, spokes: SPOKES }, unit, state, s, budget).map(d => d.to);
  // Strike points: the spot on the line to each enemy from which it is just in
  // range, and as far toward it as this order can go — the moves a fight is made
  // of, which a fixed lattice would only hit by luck.
  for (const e of state.units) {
    if (!e.alive || e.ownerId === unit.ownerId) continue;
    if (state.gameSpecific.fogOfWar && !seenBy(state, unit.ownerId, e)) continue;
    if (hiddenFrom(state, unit.ownerId, e)) continue;
    const dx = e.position.x - o.x, dy = e.position.y - o.y, d = Math.hypot(dx, dy);
    if (d < EPS) continue;
    for (const want of [d - stat(state, unit, 'range') * 0.98, Math.min(budget, d - 2 * UNIT_R - 1e-6)]) {
      const step = Math.min(want, budget);
      if (step > EPS) pts.push({ x: o.x + dx / d * step, y: o.y + dy / d * step });
    }
  }
  const out = [];
  for (const p of pts) {
    const cost = continuousMoveCost(state, unit, p);
    if (cost <= budget + EPS) out.push({ to: p, cost, path: [{ x: o.x, y: o.y }, p] });
  }
  return out;
}

/** Movement points to travel the straight segment, by the length in each terrain. */
export function segmentCost(state, unit, x0, y0, x1, y1) {
  const B = boardIn(state);
  if (B.wallBetween?.({ x: x0, y: y0 }, { x: x1, y: y1 })) return Infinity;
  const domain = domainOf(state, unit);
  let cost = 0;
  for (const { len, t } of B.pieces(x0, y0, x1, y1)) {
    if (!t || !passableFor(t, domain)) return Infinity;
    cost += len * costFor(t, domain);
  }
  return cost;
}

// A straight continuous move's price, or Infinity if it can't be made.
function continuousMoveCost(state, unit, p) {
  if (!kinematics.walkable(p.x, p.y, unit, state)) return Infinity;
  if (kinematics.occupied(p.x, p.y, unit, state)) return Infinity;
  const o = unit.position;
  return segmentCost(state, unit, o.x, o.y, p.x, p.y);
}

// Discrete-space path cost of an exact cell route.
const pathCost = (state, unit, path) => path.slice(1).reduce((s, c, i) => s + stepCost(state, unit, path[i], c), 0);

// ── Facing ───────────────────────────────────────────────────────────────────

const facingStep = (state) => (isContinuousSpace(state) ? 45 : 360 / (boardIn(state).facings || 8));
const snap = (state, deg) => {
  if (isContinuousSpace(state)) return ((deg % 360) + 360) % 360;
  const step = facingStep(state);
  const k = deg / step;
  let n = Math.round(k);
  // `orientation.ties: 'horizontal'`: a bearing exactly between two facings
  // takes the one nearer the horizontal (a diagonal step faces east or west).
  if (rulesOf(state).spec.orientation?.ties === 'horizontal' && Math.abs(k - Math.floor(k) - 0.5) < 1e-9) {
    const level = (m) => Math.abs(Math.cos((m * step * Math.PI) / 180));
    n = level(Math.floor(k)) >= level(Math.ceil(k)) - 1e-12 ? Math.floor(k) : Math.ceil(k);
  }
  return ((n * step) % 360 + 360) % 360;
};

/** The facing a move leaves a unit with: the way it went, start to end. */
function facingAfter(state, u, path) {
  if (u.facing == null || path.length < 2) return u.facing;
  const B = boardIn(state);
  const a = path[0], b = path[path.length - 1];
  if (a.x === b.x && a.y === b.y) return u.facing;           // no way went, no turn
  const pa = isContinuousSpace(state) ? a : B.centre(a), pb = isContinuousSpace(state) ? b : B.centre(b);
  return snap(state, bearing(pa, B.near?.(pa, pb) ?? pb));
}

/** What turning `u` to `to` costs: whole movement points, turnCost a facing step. */
function turnCost(state, u, to) {
  const f = facingOf(state, u);
  if (!f) return Infinity;
  const steps = Math.ceil(angleBetween(u.facing, to) / facingStep(state) - 1e-9);
  return steps * f.turnCost;
}

const faceToward = (state, u, t) => (u.facing == null ? u.facing : snap(state, bearing(pointOf(state, u), pointOf(state, t))));
// Toward a point aimed at (a cell's centre in discrete space).
const faceTowardPoint = (state, u, p) => {
  if (u.facing == null) return u.facing;
  const at = isContinuousSpace(state) ? p : boardIn(state).centre(p);
  const from = pointOf(state, u);
  return Math.hypot(at.x - from.x, at.y - from.y) < EPS ? u.facing : snap(state, bearing(from, at));
};

// The facings a unit is offered: every direction of the board (and, in
// continuous space, straight at each enemy it sees).
function facingChoices(state, u) {
  const step = facingStep(state);
  const out = [];
  for (let a = 0; a < 360; a += step) if (angleBetween(a, u.facing) > 1e-6) out.push(a);
  if (isContinuousSpace(state)) {
    for (const e of state.units) {
      if (!e.alive || e.ownerId === u.ownerId || !seenBy(state, u.ownerId, e)) continue;
      const a = snap(state, bearing(pointOf(state, u), pointOf(state, e)));
      if (angleBetween(a, u.facing) > 1e-6 && !out.some(x => angleBetween(x, a) < 1e-6)) out.push(a);
    }
  }
  return out;
}

// ── Setup ────────────────────────────────────────────────────────────────────

// Skirmish: a river down the middle with two fords, woods and hills on either
// bank, a rock outcrop that blocks the centre line of sight. 180°-symmetric, so
// neither side is favoured.
function riverTerrain(w, h) {
  const t = {};
  const set = (x, y, k) => { t[`${x},${y}`] = k; t[`${w - 1 - x},${h - 1 - y}`] = k; };
  const mid = Math.floor(w / 2);
  for (let y = 0; y < h; y++) {
    if (y === 2 || y === h - 3) continue;             // fords
    set(mid - 1, y, 'water');
  }
  for (const [x, y] of [[3, 1], [3, 2], [4, 2], [2, 6], [3, 6], [3, 7]]) set(x, y, 'forest');
  for (const [x, y] of [[4, 4], [4, 5], [2, 4]]) set(x, y, 'hill');
  set(mid - 2, 4, 'rock');
  return t;
}

const LEGEND = { '.': 'open', f: 'forest', h: 'hill', '~': 'water', '#': 'rock' };

// A spec's board as the state carries it.
function buildBoard(b, config) {
  const topology = b.topology ?? 'square';
  if (topology === 'regions') {
    let maxX = 0, maxY = 0;
    for (const r of Object.values(b.regions ?? {})) for (const [x, y] of r.cells ?? []) { maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    return { topology, layout: b.layout ?? 'hex', width: b.width ?? maxX + 1, height: b.height ?? maxY + 1, regions: b.regions, ...(b.adjacency ? { adjacency: b.adjacency } : {}) };
  }
  if (topology === 'shapes') {
    return { topology, width: b.width, height: b.height, ground: b.ground ?? 'open', shapes: b.shapes ?? [], walls: b.walls ?? [], ...(b.elevation ? { elevation: b.elevation } : {}), ...(b.art ? { art: b.art } : {}) };
  }
  const width = config.width ?? b.width ?? 14, height = config.height ?? b.height ?? 10;
  let terrain;
  if (config.terrain) terrain = config.terrain;
  else if (config.map === 'open') terrain = {};
  else if (b.rows) {
    terrain = {};
    const legend = { ...LEGEND, ...(b.legend ?? {}) };
    b.rows.forEach((row, y) => [...row].forEach((ch, x) => { const k = legend[ch] ?? 'open'; if (k !== 'open') terrain[`${x},${y}`] = k; }));
  } else if (b.terrain) terrain = b.terrain;
  else if (b.generator === 'open') terrain = {};
  else terrain = riverTerrain(width, height);
  return {
    ...(topology !== 'square' ? { topology } : {}),
    width, height, terrain,
    ...(b.elevation ? { elevation: b.elevation } : {}),
    ...(b.wrap ? { wrap: true } : {}),
    ...(b.neighbours === 4 ? { neighbours: 4 } : {}),
    ...(b.sightLine ? { sightLine: b.sightLine } : {}),
    ...(b.visionMetric ? { visionMetric: b.visionMetric } : {}),
    ...(b.labels ? { labels: b.labels } : {}),
  };
}

// Each seat faces into the board from its edge.
const SEAT_FACING = [0, 180, 90, 270];

function defaultUnits(state, playerIds, w, h, layout) {
  const units = [];
  playerIds.forEach((pid, seat) => {
    const types = layout[seat % layout.length];
    // Seat 0 deploys on the left edge, seat 1 on the right; more seats take the
    // top and bottom edges.
    types.forEach((type, i) => {
      const span = seat < 2 ? h : w;
      const along = Math.round(((i + 1) * span) / (types.length + 1)) - 1;
      const pos = seat === 0 ? { x: 1, y: along }
        : seat === 1 ? { x: w - 2, y: h - 1 - along }
          : seat === 2 ? { x: along, y: 0 } : { x: w - 1 - along, y: h - 1 };
      units.push(makeUnit(state, { id: `${pid}-${i + 1}`, ownerId: pid, type, position: pos, facing: SEAT_FACING[seat % 4] }));
    });
  });
  return units;
}

// A spec's own placements: [{ type, seat, at: [x, y] | regionId, facing, count }].
// An entry naming a `game` is a unit of that game, from the library, built by
// `foreign` (see makeBattleGame). On a counted board (stacking 'count') `count`
// says how many members the group starts with, instead of its type's.
function placedUnits(state, playerIds, list, foreign) {
  const n = {};
  const B = boardIn(state);
  return list.filter(e => playerIds[e.seat ?? 0] != null).map(e => {
    const pid = playerIds[e.seat ?? 0];
    n[pid] = (n[pid] ?? 0) + 1;
    const at = typeof e.at === 'string' ? B.anchorOf(e.at) : { x: e.at[0], y: e.at[1] };
    const id = e.id ?? `${pid}-${n[pid]}`;
    const facing = e.facing ?? SEAT_FACING[(e.seat ?? 0) % 4];
    let u = e.game ? foreign({ id, ownerId: pid, type: e.type, game: e.game, position: at, facing }) : makeUnit(state, { id, ownerId: pid, type: e.type, position: at, facing });
    if (e.count != null && u.memberHp) u = { ...u, hp: u.memberHp * Math.max(1, e.count), maxHp: u.memberHp * Math.max(1, e.count) };
    return e.hp != null ? { ...u, hp: Math.min(u.maxHp, e.hp) } : u;
  });
}

// Put each unit into the active space's position form: an integer cell in
// discrete space; an exact point in continuous space, where a whole-number
// position (a cell index from a discrete roster) becomes that cell's centre.
function placeForSpace(space, p) {
  if (space === 'discrete') return { x: Math.floor(p.x), y: Math.floor(p.y) };
  return Number.isInteger(p.x) && Number.isInteger(p.y) ? { x: p.x + 0.5, y: p.y + 0.5 } : { x: p.x, y: p.y };
}

// Bring the units and every count derived from them into step with the rules.
function settle(state) {
  const s = st(state);
  const contTime = s.time === 'continuous';
  const types = rulesOf(state).types;
  const units = state.units.map(u0 => {
    const preset = types[u0.type];
    let u = {
      ...u0,
      stats: { ...(preset ? Object.fromEntries(STAT_KEYS.map(k => [k, preset[k]])) : {}), ...u0.stats },
      position: placeForSpace(s.space, u0.position),
      task: null,
    };
    u = dress(state, u, preset ?? typeOf(state, u));
    if (u.facing != null) u = { ...u, facing: snap(state, u.facing) };
    return { ...u, perTurn: contTime ? null : freshPerTurn(state, u) };
  });
  return {
    ...state,
    units,
    gameSpecific: {
      ...state.gameSpecific,
      alive: aliveCounts(state.players, units),
      startRoster: units.map(u => ({ id: u.id, ownerId: u.ownerId, type: u.type, position: { ...u.position }, hp: u.hp, stats: { ...u.stats } })),
    },
  };
}

// ── Legal actions ────────────────────────────────────────────────────────────
// Never depends on whose turn it is: the we-go resolver re-checks every queued
// order against getLegalActions at the moment it completes, whoever is "active".

export const waitAction = (unitId, duration) => ({ type: 'wait', unitId, duration });

function getLegalActions(state, playerId) {
  if (getResult(state)) return [];
  if (chargeOf(state)) return chargeActions(state, playerId);
  const contTime = isContinuousTime(state);
  const actions = [];
  // A side that moves only so many units a turn (`turn.units`) has, once it has
  // used them, only what those units still have left to do.
  const done = actedThisTurn(state, playerId);
  const limit = unitsPerTurn(state);
  const occ = checkTag(state) ? occupancy(state) : null;
  const checked = occ ? inCheck(state, playerId, occ) : false;
  for (const u of state.units) {
    if (!u.alive || u.ownerId !== playerId) continue;
    if (limit && done.length >= limit && !done.includes(u.id)) continue;
    actions.push(...unitActions(state, u, occ, checked));
  }
  // Discrete time: end your turn. Continuous time: let the clock run (pass).
  // Under the check rule a side may not pass a turn it could move in: it has to
  // play, and a side left with no move at all is mated or stalemated.
  if (!occ || done.length || !actions.length) actions.push({ type: 'end-turn', unitId: '__player__' });
  return actions;
}

// What one unit may do now. Under the check rule (`occ` given) no move may leave
// its side's royal units threatened, and while they are, it may do nothing else.
function unitActions(state, u, occ = null, checked = false) {
  const contTime = isContinuousTime(state);
  if (contTime && u.task) return [];                       // busy: orders only when idle
  const actions = [];
  if (patternsOf(state, u)) {
    if (u.perTurn.moveLeft > EPS && !blocked(state, u, 'move')) for (const t of legalPieceMoves(state, u, occ ?? undefined)) actions.push(pieceAction(u, t));
    // A piece takes by moving: its other abilities are its own, but it never strikes.
    actions.push(...abilityActions(state, u).filter(a => a.type !== 'attack' && !checked));
    return actions;
  }
  for (const d of destinations(state, u)) {
    if (occ && inCheck(state, u.ownerId, occAfter(occ, u, d.to))) continue;
    actions.push({ type: 'move', unitId: u.id, from: { ...u.position }, to: d.to, ...(d.path.length > 2 ? { path: d.path } : {}) });
  }
  if (checked) return actions;
  actions.push(...abilityActions(state, u));
  if (u.facing != null && facingOf(state, u) && !blocked(state, u, 'move') && (contTime || !u.perTurn.faced)) {
    for (const a of facingChoices(state, u)) if (contTime || turnCost(state, u, a) <= u.perTurn.moveLeft + EPS) actions.push({ type: 'face', unitId: u.id, facing: a });
  }
  if (contTime) {
    for (const duration of [0.25, 1]) actions.push(waitAction(u.id, duration));
  }
  return actions;
}

// ── Units a turn ─────────────────────────────────────────────────────────────
// `turn: { units: n }` (or the session's `unitsPerTurn`, which overrides it; 0
// for no limit): a side moves n of its units a turn, and its turn ends by itself
// once they have nothing left to do. Discrete time, sides in turn (not the
// charge order, and not we-go, whose orders resolve together).

/** How many units a side may use a turn, or null for every one. */
export function unitsPerTurn(state) {
  if (isContinuousTime(state) || chargeOf(state) || st(state).play === 'simultaneous') return null;
  const n = state.gameSpecific.unitsPerTurn ?? rulesOf(state).spec.turn?.units ?? null;
  return n > 0 ? n : null;
}

// The units `pid` has used this turn, while it is on move.
const actedThisTurn = (state, pid) => (state.gameSpecific.acted?.by === pid ? state.gameSpecific.acted.ids : []);

// Kept only where something reads it: a units limit, or the check rule (which
// lets a side pass once it has played).
const tracksActed = (state) => !isContinuousTime(state) && !chargeOf(state) && (unitsPerTurn(state) != null || checkTag(state) != null);

// `u` has acted: note it, and end its side's turn if that was all it had.
function acted(state, playerId, unitId) {
  if (!tracksActed(state) || getResult(state)) return state;
  const ids = actedThisTurn(state, playerId);
  const next = ids.includes(unitId) ? state : { ...state, gameSpecific: { ...state.gameSpecific, acted: { by: playerId, ids: [...ids, unitId] } } };
  const limit = unitsPerTurn(next);
  const done = actedThisTurn(next, playerId);
  if (limit && done.length >= limit) {
    const left = done.some(id => { const x = next.units.find(o => o.id === id); return x?.alive && unitActions(next, x).length; });
    if (!left) return endTurn(next, playerId);
  }
  return next;
}

// The charge order: the active unit's move (or taking it back), its acts and the
// end of its activation; and for its side's other units, a move queued for when
// their own activations come.
function chargeActions(state, playerId) {
  const u = state.units.find(x => x.id === state.gameSpecific.activeUnitId && x.alive);
  if (!u || u.ownerId !== playerId) return [{ type: 'end-turn', unitId: '__player__' }];
  if (blocked(state, u, 'move') && blocked(state, u, 'act')) return [{ type: 'end-turn', unitId: u.id }];
  const actions = [];
  if (u.perTurn.moveLeft > 0) {
    for (const d of destinations(state, u)) {
      actions.push({ type: 'move', unitId: u.id, from: { ...u.position }, to: d.to, ...(d.path.length > 2 ? { path: d.path } : {}) });
    }
  } else if (u.movedFrom && u.perTurn.attacksLeft > 0) {
    actions.push({ type: 'undo-move', unitId: u.id });
  }
  actions.push(...abilityActions(state, u));
  if (u.facing != null) {
    const step = facingStep(state);
    for (let a = 0; a < 360; a += step) actions.push({ type: 'end-turn', unitId: u.id, facing: a });
  } else {
    actions.push({ type: 'end-turn', unitId: u.id });
  }
  for (const o of state.units) {
    if (!o.alive || o.ownerId !== playerId || (o.id === u.id && u.perTurn.moveLeft > 0)) continue;
    const queue = o.queue ?? [];
    const tail = queue.length ? queue[queue.length - 1] : o.position;
    // Where it could go from the end of its queue, on a fresh activation: a stand-in
    // of its own, so the square it stands on now is in the way like any other. A
    // status that holds it still now is no bar to planning for later.
    const holds = (s) => (rulesOf(state).attrs[s.id] ?? BUILT_IN[s.id])?.blocks?.includes('move');
    const free = o.statuses?.some(holds) ? { ...o, statuses: o.statuses.filter(s => !holds(s)) } : o;
    const ahead = { ...free, id: `${o.id}\u0000ahead`, position: { ...tail }, perTurn: { ...freshPerTurn(state, free), moveLeft: stat(state, free, 'speed') } };
    for (const d of destinations(state, ahead)) actions.push({ type: 'queue-move', unitId: o.id, to: d.to });
    if (queue.length) actions.push({ type: 'queue-pop', unitId: o.id });
  }
  return actions;
}

/**
 * Orders outside the enumerated list that are still legal: a continuous-space
 * move to any reachable point (a clicked spot), a wait of any length
 * (continuous time takes any typed duration, never a menu of presets), a turn
 * to any facing, and an ability aimed at any spot it can reach.
 */
function isActionLegal(state, playerId, action) {
  const u = state.units.find(x => x.id === action?.unitId);
  if (!u?.alive || u.ownerId !== playerId || getResult(state)) return false;
  const contTime = isContinuousTime(state);
  if (contTime && u.task) return false;
  if (action.type === 'wait') {
    return contTime && Number.isFinite(action.duration) && action.duration >= MIN_WAIT && action.duration <= MAX_WAIT;
  }
  if (action.type === 'move' && isContinuousSpace(state)) {
    const p = action.to;
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    if (Math.hypot(p.x - u.position.x, p.y - u.position.y) < EPS) return false;
    if (blocked(state, u, 'move')) return false;
    return continuousMoveCost(state, u, p) <= reach(state, u) + EPS;
  }
  if (action.type === 'face') {
    if (u.facing == null || !Number.isFinite(action.facing) || blocked(state, u, 'move')) return false;
    if (!isContinuousSpace(state) && snap(state, action.facing) !== ((action.facing % 360) + 360) % 360) return false;
    if (angleBetween(action.facing, u.facing) < 1e-6) return false;
    return contTime || (!u.perTurn.faced && turnCost(state, u, action.facing) <= u.perTurn.moveLeft + EPS);
  }
  if (action.type === 'ability' && action.at) return abilityLegal(state, u, action);
  return false;
}

// ── Applying actions ─────────────────────────────────────────────────────────

const replaceUnit = (state, u) => ({ ...state, units: state.units.map(x => (x.id === u.id ? u : x)) });

/** Cost of a move action from where its unit stands (Infinity if it can't be made). */
// The route is always worked out afresh from the position — an action's `path`
// is there for drawing, never trusted.
function moveCost(state, u, action) {
  if (isContinuousSpace(state)) return continuousMoveCost(state, u, action.to);
  const path = discreteRoute(state, u, action.to);
  return path ? pathCost(state, u, path) : Infinity;
}

const discreteRoute = (state, u, to) =>
  destinations(state, u).find(d => d.to.x === to.x && d.to.y === to.y)?.path ?? null;

function routeOf(state, u, action) {
  if (isContinuousSpace(state)) return [u.position, action.to];
  return discreteRoute(state, u, action.to) ?? [u.position, action.to];
}

// A counted group that stops on a group of its own type joins it.
function mergeGroups(state, mover) {
  if (rulesOf(state).stacking !== 'count') return state;
  const into = state.units.find(o => o.alive && o.id !== mover.id && o.ownerId === mover.ownerId && o.type === mover.type
    && o.position.x === mover.position.x && o.position.y === mover.position.y);
  if (!into) return state;
  const merged = { ...into, hp: into.hp + mover.hp, maxHp: into.maxHp + mover.maxHp };
  return withUnits(state, state.units.filter(x => x.id !== mover.id).map(x => (x.id === into.id ? merged : x)));
}

// Use an ability right now (discrete time): pay, then every effect at once.
function useAbility(state, u, ab, action) {
  const target = action.targetId != null ? state.units.find(x => x.id === action.targetId) : null;
  const point = action.at ?? null;
  const ap = rulesOf(state).actionPoints;
  let me = { ...u, perTurn: ap ? { ...u.perTurn, ...apBudget(state, u, u.perTurn.ap - apCost(ab, u.perTurn.ap)) } : { ...u.perTurn, attacksLeft: u.perTurn.attacksLeft - 1 } };
  me = payFor(state, me, ab);
  if (target && target.id !== u.id && me.facing != null) me = { ...me, facing: faceToward(state, me, target) };
  else if (!target && point && me.facing != null) me = { ...me, facing: faceTowardPoint(state, me, point) };
  // Acting fixes where a move left the unit: it can no longer be taken back.
  if (me.movedFrom) { const { movedFrom: _m, ...rest } = me; me = rest; }
  const next = replaceUnit(state, me);
  return resolveUse(next, me.id, ab, target, point, state);
}

function payFor(state, u, ab) {
  let me = u;
  for (const [k, v] of Object.entries(ab.cost ?? {})) {
    if (k === 'hp') me = { ...me, hp: Math.max(1, me.hp - v) };
    else me = adjustPool(me, k, -v);
  }
  if (ab.cooldown > 0) {
    const until = state.gameSpecific.rt ? state.gameSpecific.rt.clock + ab.cooldown * TURN_DURATION : ab.cooldown;
    me = { ...me, cooldowns: { ...(me.cooldowns ?? {}), [ab.id]: until } };
  }
  return me;
}

// The effects of one use: damage worked out against `before` (the moment it
// was made), then everything else.
function resolveUse(state, casterId, ab, target, point, before = state) {
  const caster = state.units.find(x => x.id === casterId);
  const targets = affected(before, caster, ab, target, point);
  const hits = damageOf(before, caster, ab, targets);
  dice.thrown?.push(...hits.filter(h => h.roll != null));
  let next = hits.length ? dealDamage(state, hits) : state;
  next = applyOtherEffects(next, casterId, ab, landed(targets, hits).map(t => t.id), point, before);
  return next;
}

// Discrete time ─────────────────────────────────────────────────────────────

function applyDiscrete(state, playerId, action) {
  const before = state;
  const next = applyDiscreteAction(state, playerId, action);
  if (next === before || action.type === 'end-turn' || !['move', 'attack', 'ability', 'face'].includes(action.type)) return next;
  return acted(next, playerId, action.unitId);
}

// A piece's move (patterns.js): onto its square, taking whatever stood there (or
// slid past it), its partner alongside when it castles, promoted at the far edge.
// A move is all a piece does in a turn.
function movePiece(state, u, action) {
  const t = matchPieceMove(state, u, action);
  if (!t || !(u.perTurn.moveLeft > EPS)) return state;
  let units = state.units;
  if (t.captured) units = units.map(x => (x.id === t.captured.id ? { ...x, hp: 0, alive: false, task: null } : x));
  if (t.castle) units = units.map(x => (x.id === t.castle.unit.id ? { ...x, position: { ...t.castle.to }, moved: true } : x));
  let moved = { ...u, position: { x: t.to.x, y: t.to.y }, moved: true, perTurn: { ...u.perTurn, moveLeft: 0, attacksLeft: 0 } };
  if (u.facing != null) moved.facing = facingAfter(state, u, t.path);
  if (t.promote) {
    const fresh = makeUnit(state, { id: u.id, ownerId: u.ownerId, type: t.promote, position: moved.position, facing: moved.facing });
    moved = { ...fresh, moved: true, perTurn: { ...freshPerTurn(state, fresh), moveLeft: 0, attacksLeft: 0 } };
  }
  units = units.map(x => (x.id === u.id ? moved : x));
  const passing = passingOf(state, u, t);
  const { passing: _p, ...gs } = state.gameSpecific;
  return withUnits({ ...state, gameSpecific: passing ? { ...gs, passing } : gs }, units);
}

function applyDiscreteAction(state, playerId, action) {
  const u = state.units.find(x => x.id === action.unitId);
  if (action.type === 'end-turn') return chargeOf(state) ? endActivation(state, action) : endTurn(state, playerId);
  if (!u?.alive) return state;
  if (action.type === 'move' && patternsOf(state, u)) return movePiece(state, u, action);
  if (action.type === 'undo-move') {
    if (!u.movedFrom || !(u.perTurn.attacksLeft > 0)) return state;
    const { movedFrom, ...rest } = u;
    return replaceUnit(state, { ...rest, position: { ...movedFrom }, perTurn: { ...u.perTurn, moveLeft: stat(state, u, 'speed') } });
  }
  if (action.type === 'queue-move') return replaceUnit(state, { ...u, queue: [...(u.queue ?? []), { x: action.to.x, y: action.to.y }] });
  if (action.type === 'queue-pop') return replaceUnit(state, { ...u, queue: (u.queue ?? []).slice(0, -1) });
  if (action.type === 'move') {
    const cost = moveCost(state, u, action);
    if (!(cost <= u.perTurn.moveLeft + EPS)) return state;
    // One move a turn: what it didn't spend is gone (a budget that could be spent
    // in slivers would let a unit edge about a continuous board for ever). With
    // action points a move spends the ruleset's price for one instead.
    const ap = rulesOf(state).actionPoints;
    const moved = { ...u, position: { x: action.to.x, y: action.to.y }, perTurn: ap ? { ...u.perTurn, ...apBudget(state, u, u.perTurn.ap - rulesOf(state).moveAp) } : { ...u.perTurn, moveLeft: 0 } };
    // In the charge order a move can be taken back until the unit acts.
    if (chargeOf(state)) moved.movedFrom = { x: u.position.x, y: u.position.y };
    if (u.facing != null) moved.facing = facingAfter(state, u, routeOf(state, u, action));
    return mergeGroups(replaceUnit(state, moved), moved);
  }
  if (action.type === 'face') {
    if (!isActionLegal(state, playerId, action)) return state;
    const cost = turnCost(state, u, action.facing);
    return replaceUnit(state, { ...u, facing: snap(state, action.facing), perTurn: { ...u.perTurn, moveLeft: u.perTurn.moveLeft - cost, faced: true } });
  }
  if (action.type === 'attack' || action.type === 'ability') {
    if (!abilityLegal(state, u, action)) return state;
    return useAbility(state, u, abilityOf(state, u, action.type === 'attack' ? 'attack' : action.ability), action);
  }
  return state;
}

// A seat ends its turn; the next seat that hasn't (and still has an army) is up.
// Once every seat has ended, a new turn begins for all of them — the same rule
// whether the seats took turns (sequential) or planned together (we-go), and
// whatever order the we-go resolver plays their end-turns in.
function endTurn(state, playerId) {
  // What the side used this turn is spent with it.
  const { acted: _a, ...gs } = state.gameSpecific;
  const ended = gs.ended.includes(playerId) ? gs.ended : [...gs.ended, playerId];
  const ids = seatIds(state);
  const standing = ids.filter(id => (gs.alive[id] ?? 0) > 0);
  const i = ids.indexOf(playerId);
  const order = [...ids.slice(i + 1), ...ids.slice(0, i + 1)];
  const next = order.find(id => standing.includes(id) && !ended.includes(id));
  if (next) return { ...state, activePlayers: [next], gameSpecific: { ...gs, ended } };
  let out = windowEnds({ ...state, gameSpecific: { ...gs, ended } }, state.turnNumber);
  const still = ids.filter(id => (out.gameSpecific.alive[id] ?? 0) > 0);
  out = {
    ...out,
    turnNumber: state.turnNumber + 1,
    activePlayers: [still[0] ?? standing[0] ?? ids[0]],
    units: out.units.map(u => (u.alive ? { ...u, perTurn: freshPerTurn(out, u) } : u)),
    gameSpecific: { ...out.gameSpecific, ended: [] },
  };
  return out;
}

// ── Charge time ──────────────────────────────────────────────────────────────
// `turn: { order: 'charge', charge: 100, initiative }`: no side has a turn —
// each unit does. Every living unit gains its initiative (a stat's name, its
// speed by default, or a hook) in charge until one holds `charge`; those that
// do act in turn, most charge first (then most initiative, then id), each one
// activation: a move and an act, in either order, the move taken back with
// `undo-move` until it acts. Its activation ends when its side ends it (with a
// facing, where units face), which is also its window: its statuses tick and
// run down then, as a side's do at a turn's end in the turn order. Its charge
// drops by `charge`, the next ready unit acts, and when none is left, everyone
// charges again. A side may queue a waiting unit's next move (`queue-move`); it
// is made as that unit's activation begins. turnNumber counts activations.

export const chargeOf = (state) => (rulesOf(state).spec.turn?.order === 'charge' ? rulesOf(state).spec.turn : null);
const CHARGE = (state) => chargeOf(state).charge ?? 100;

function initiativeOf(state, u) {
  const i = chargeOf(state).initiative ?? 'speed';
  return typeof i === 'object' ? callHook(rulesOf(state).hooks, i, state, u) : stat(state, u, i);
}

// Everyone charges until someone is ready; then the ready, in the order they act.
function chargeUp(state) {
  const full = CHARGE(state);
  let units = state.units.map(u => (u.alive && u.ct == null ? { ...u, ct: 0 } : u));
  const gain = new Map(units.filter(u => u.alive).map(u => [u.id, initiativeOf({ ...state, units }, u)]));
  if (![...gain.values()].some(g => g > 0)) throw new Error('battle: no unit gains any charge');
  while (!units.some(u => u.alive && u.ct >= full)) units = units.map(u => (u.alive ? { ...u, ct: u.ct + gain.get(u.id) } : u));
  const ready = units.filter(u => u.alive && u.ct >= full)
    .sort((a, b) => b.ct - a.ct || gain.get(b.id) - gain.get(a.id) || a.id.localeCompare(b.id)).map(u => u.id);
  return { units, ready };
}

// `id` begins its activation: fresh budgets, and the first move it had queued.
function activate(state, id, queue) {
  let units = state.units.map(u => (u.id === id ? (({ movedFrom: _m, ...rest }) => ({ ...rest, perTurn: freshPerTurn(state, u) }))(u) : u));
  const u = units.find(x => x.id === id);
  const to = u?.queue?.[0];
  if (to) {
    const B = boardIn(state);
    const free = passableFor(B.terrainAt(to.x, to.y), domainOf(state, u))
      && !units.some(o => o.alive && o.id !== u.id && o.position.x === to.x && o.position.y === to.y);
    if (free) {
      const moved = { ...u, position: { x: to.x, y: to.y }, movedFrom: { ...u.position }, queue: u.queue.slice(1), perTurn: { ...u.perTurn, moveLeft: 0 } };
      if (u.facing != null) moved.facing = facingAfter(state, u, [u.position, to]);
      units = units.map(x => (x.id === id ? moved : x));
    }
  }
  return {
    ...state,
    units,
    activePlayers: [u?.ownerId ?? state.players[0].id],
    gameSpecific: { ...state.gameSpecific, activeUnitId: id, turnQueue: queue },
  };
}

// The first activation of a battle in the charge order.
function startCharge(state) {
  const { units, ready } = chargeUp(state);
  const [first, ...queue] = ready;
  return activate({ ...state, units }, first, queue);
}

// The active unit's side ends its activation (facing `action.facing`, where units face).
function endActivation(state, action) {
  const gs = state.gameSpecific;
  const id = gs.activeUnitId;
  let next = state;
  let u = next.units.find(x => x.id === id);
  if (u?.alive && action.facing != null && u.facing != null) next = replaceUnit(next, { ...u, facing: snap(next, action.facing) });
  // Its window ends: its statuses tick and run down, its pools regenerate.
  if (u?.alive) next = unitWindowEnds(next, id);
  // Its activation is spent until its next one comes round.
  next = withUnits(next, next.units.map(x => (x.id === id ? (({ movedFrom: _m, ...rest }) => ({
    ...rest, ct: Math.max(0, (x.ct ?? 0) - CHARGE(next)), ...(rest.perTurn ? { perTurn: { ...rest.perTurn, moveLeft: 0, attacksLeft: 0 } } : {}),
  }))(x) : x)));
  if (getResult(next)) return { ...next, turnNumber: state.turnNumber + 1 };
  let queue = (gs.turnQueue ?? []).filter(q => next.units.find(x => x.id === q)?.alive);
  if (!queue.length) {
    const up = chargeUp(next);
    next = { ...next, units: up.units };
    queue = up.ready;
  }
  const [nextId, ...rest] = queue;
  return activate({ ...next, turnNumber: state.turnNumber + 1 }, nextId, rest);
}

// One unit's window ends (the charge order: its own activation is its window).
function unitWindowEnds(state, id) {
  const next = unitEnds(state, id, isContinuousTime(state));
  return withUnits(next, next.units);
}

// The end of window `n`: pools regenerate, statuses tick and run down,
// cooldowns count down, and the objectives counted in windows are judged.
function windowEnds(state, n) {
  const r = rulesOf(state);
  if (!r.periodic) return state;
  const contTime = isContinuousTime(state);
  let next = state;
  for (const u0 of state.units) next = unitEnds(next, u0.id, contTime);
  next = withUnits(next, next.units);
  return judgeNow(judgeWindow(next, n));
}

// What a window's end does to one unit.
function unitEnds(state, id, contTime) {
  const r = rulesOf(state);
  let next = state;
  let u = next.units.find(x => x.id === id);
  if (!u?.alive) return next;
  for (const pool of Object.keys(u.pools ?? {})) {
    const g = regenOf(next, u, pool);
    if (g) u = adjustPool(u, pool, g);
  }
  if (!contTime && u.cooldowns) {
    const cds = Object.fromEntries(Object.entries(u.cooldowns).map(([k, v]) => [k, v - 1]).filter(([, v]) => v > 0));
    u = Object.keys(cds).length ? { ...u, cooldowns: cds } : (({ cooldowns: _c, ...rest }) => rest)(u);
  }
  next = replaceUnit(next, u);
  // Each status's tick, then one window less of it.
  const decl = (s) => r.attrs[s.id] ?? BUILT_IN[s.id] ?? {};
  for (const s of statusesOf(u)) {
    for (const e of decl(s).tick ?? []) next = tickEffect(next, u.id, e, s.stacks ?? 1);
  }
  u = next.units.find(x => x.id === id);
  if (u?.alive && u.statuses?.length) {
    // A permanent status stays until something removes it; any other runs down,
    // and one that runs out does what it does then (`expire`).
    const ss = u.statuses.map(s => (decl(s).permanent ? s : { ...s, left: s.left - 1 }));
    const out = ss.filter(s => !decl(s).permanent && s.left <= 0);
    next = replaceUnit(next, { ...u, statuses: ss.filter(s => decl(s).permanent || s.left > 0) });
    for (const s of out) for (const e of decl(s).expire ?? []) next = tickEffect(next, u.id, e, s.stacks ?? 1);
  }
  return next;
}

// A status's effect at a window's end, on the unit that has it.
function tickEffect(state, unitId, e, stacks) {
  const u = state.units.find(x => x.id === unitId);
  if (!u?.alive) return state;
  if (e.damage) {
    const each = e.damage.formula != null ? whole(formula(e.damage.formula)(attrsEnv(state, u), dice.rng)) : e.damage.amount ?? 1;
    return dealDamage(state, [{ targetId: u.id, amount: each * stacks }]);
  }
  if (e.heal) return replaceUnit(state, { ...u, hp: Math.min(u.maxHp, u.hp + (e.heal.amount ?? 1) * stacks) });
  if (e.modify && u.pools?.[e.modify.attr]) return replaceUnit(state, adjustPool(u, e.modify.attr, (e.modify.by ?? 0) * stacks));
  if (e.fn != null) return callHook(rulesOf(state).hooks, e, state, { caster: u, targets: [u], effect: e });
  return state;
}

// Continuous time ───────────────────────────────────────────────────────────

const rtOf = (state) => state.gameSpecific.rt;
const withRt = (state, patch) => ({ ...state, gameSpecific: { ...state.gameSpecific, rt: { ...rtOf(state), ...patch } } });

/** Time (in windows) an order takes. Also the engine's getActionDuration. */
function getActionDuration(state, action) {
  const u = state.units.find(x => x.id === action.unitId);
  if (!u) return 0;
  const speed = stat(state, u, 'speed');
  if (action.type === 'move') {
    const cost = isContinuousSpace(state)
      ? segmentCost(state, u, u.position.x, u.position.y, action.to.x, action.to.y)
      : pathCost(state, u, routeOf(state, u, action));
    return Number.isFinite(cost) && speed > 0 ? (cost / speed) * TURN_DURATION : 0;
  }
  if (action.type === 'attack' || action.type === 'ability') {
    const ab = abilityOf(state, u, action.type === 'attack' ? 'attack' : action.ability);
    if (ab?.windup != null) return ab.windup * TURN_DURATION;
    return (ATTACK_TIME * TURN_DURATION) / Math.max(stat(state, u, 'rate'), EPS);
  }
  if (action.type === 'face') {
    const cost = turnCost(state, u, action.facing);
    return Math.max(MIN_TURN, speed > 0 && Number.isFinite(cost) ? (cost / speed) * TURN_DURATION : MIN_TURN);
  }
  if (action.type === 'wait') return action.duration;
  return 0;
}

// The timed journey of a move: [{x, y, t}] waypoints. In discrete space each
// cell of the path is reached when its share of the cost has been paid; in
// continuous space the waypoints are where the segment crosses from one
// terrain to the next, so the unit crosses each at that terrain's own pace.
function legsOf(state, u, action, t0) {
  const speed = stat(state, u, 'speed');
  if (!isContinuousSpace(state)) {
    const path = routeOf(state, u, action);
    let t = t0;
    return path.map((c, i) => {
      if (i > 0) t += (stepCost(state, u, path[i - 1], c) / speed) * TURN_DURATION;
      return { x: c.x, y: c.y, t };
    });
  }
  const { x: x0, y: y0 } = u.position, { x: x1, y: y1 } = action.to;
  const total = Math.hypot(x1 - x0, y1 - y0);
  const legs = [{ x: x0, y: y0, t: t0 }];
  const domain = domainOf(state, u);
  let along = 0, t = t0;
  for (const { len, t: terr } of boardIn(state).pieces(x0, y0, x1, y1)) {
    along += len;
    t += ((len * costFor(terr, domain)) / speed) * TURN_DURATION;
    const f = total > 0 ? along / total : 1;
    legs.push({ x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, t });
  }
  legs[legs.length - 1] = { x: x1, y: y1, t };
  return legs;
}

/** Where a moving unit is at clock time `t`. */
function positionAt(state, legs, t) {
  if (t >= legs[legs.length - 1].t - EPS) return { x: legs[legs.length - 1].x, y: legs[legs.length - 1].y };
  let i = 0;
  while (i + 1 < legs.length && legs[i + 1].t <= t + EPS) i++;
  const a = legs[i], b = legs[i + 1];
  if (!isContinuousSpace(state) || !b) return { x: a.x, y: a.y };
  const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

// Give an idle unit an order. Returns the state unchanged if the order can't
// stand — e.g. a simultaneous rival just claimed the same spot.
function orderTask(state, playerId, action) {
  const u = state.units.find(x => x.id === action.unitId);
  const { clock } = rtOf(state);
  if (!u?.alive || u.ownerId !== playerId || u.task) return state;
  if (action.type === 'move') {
    if (blocked(state, u, 'move')) return state;
    if (!(moveCost(state, u, action) <= stat(state, u, 'speed') + EPS)) return state;
    const legs = legsOf(state, u, action, clock);
    const until = legs[legs.length - 1].t;
    if (!(until > clock + EPS)) return state;
    let moved = { ...u, task: { type: 'move', to: { ...action.to }, legs, from: { ...u.position }, start: clock, until } };
    if (u.facing != null) moved.facing = facingAfter(state, u, routeOf(state, u, action));
    return replaceUnit(state, moved);
  }
  if (action.type === 'attack' || action.type === 'ability') {
    if (!abilityLegal(state, u, action)) return state;
    const ab = abilityOf(state, u, action.type === 'attack' ? 'attack' : action.ability);
    const target = action.targetId != null ? state.units.find(x => x.id === action.targetId) : null;
    let me = payFor(state, u, ab);
    if (target && target.id !== u.id && me.facing != null) me = { ...me, facing: faceToward(state, me, target) };
    const task = action.type === 'attack'
      ? { type: 'attack', targetId: target.id, start: clock, until: clock + getActionDuration(state, action) }
      : { type: 'ability', ability: ab.id, ...(target ? { targetId: target.id } : { at: { ...action.at } }), start: clock, until: clock + getActionDuration(state, action) };
    return replaceUnit(state, { ...me, task });
  }
  if (action.type === 'face') {
    if (!isActionLegal(state, playerId, action)) return state;
    return replaceUnit(state, { ...u, facing: snap(state, action.facing), task: { type: 'face', start: clock, until: clock + getActionDuration(state, action) } });
  }
  if (action.type === 'wait') {
    if (!(action.duration >= MIN_WAIT - EPS)) return state;
    return replaceUnit(state, { ...u, task: { type: 'wait', start: clock, until: clock + action.duration } });
  }
  return state;
}

/** Seats that still have a decision to make at this instant, in initiative order. */
function deciders(state) {
  const rt = rtOf(state);
  const ids = seatIds(state);
  const k = rt.initiative % ids.length;
  return [...ids.slice(k), ...ids.slice(0, k)].filter(pid =>
    !rt.passed.includes(pid) && state.units.some(u => u.alive && u.ownerId === pid && !u.task));
}

const onMove = (state, ds) => (st(state).play === 'simultaneous' ? ds : ds.slice(0, 1));

const turnAt = (clock) => Math.floor(clock / TURN_DURATION + EPS) + 1;
// The next window boundary after `clock`, when anything happens there.
const nextBoundary = (state, clock) => (rulesOf(state).periodic ? (Math.floor(clock / TURN_DURATION + EPS) + 1) * TURN_DURATION : Infinity);

// Run the clock forward until some seat has a decision (or the game is over):
// to the next task completion or window end, resolving everything that happens
// then; or, if nothing is in progress and every seat has passed, by an idle tick.
function advanceClock(state) {
  for (let guard = 0; guard < 10000; guard++) {
    if (getResult(state)) return { ...state, activePlayers: [] };
    const ds = deciders(state);
    if (ds.length) return { ...state, activePlayers: onMove(state, ds) };
    const rt = rtOf(state);
    const busy = state.units.filter(u => u.alive && u.task);
    const edge = nextBoundary(state, rt.clock);
    if (!busy.length) {
      const idleTicks = rt.idleTicks + 1;
      const to = Math.min(rt.clock + IDLE_TICK, edge);
      state = withRt(state, { clock: to, passed: [], initiative: rt.initiative + 1, idleTicks, standoff: idleTicks >= MAX_IDLE_TICKS });
      state = { ...state, turnNumber: turnAt(rtOf(state).clock) };
      if (Math.abs(to - edge) < EPS) state = windowEnds(state, Math.round(edge / TURN_DURATION));
      continue;
    }
    const t = Math.min(...busy.map(u => u.task.until));
    if (edge < t - EPS) {
      state = resolveInstant(state, edge);
      state = windowEnds(state, Math.round(edge / TURN_DURATION));
      continue;
    }
    state = resolveInstant(state, t);
    if (Math.abs(t - edge) < EPS) state = windowEnds(state, Math.round(edge / TURN_DURATION));
  }
  return state;
}

// Everything that completes at time t happens together: units in transit are
// where they are at t, arrivals stand at their destinations, and every strike
// that lands at t is worked out against the same moment before any of them is
// applied — so two units striking each other at once both land.
function resolveInstant(state, t) {
  const done = (u) => u.task && u.task.until <= t + EPS;
  let units = state.units.map(u => {
    if (!u.alive || u.task?.type !== 'move') return u;
    return { ...u, position: done(u) ? { ...u.task.to } : positionAt(state, u.task.legs, t) };
  });
  let next = { ...state, units };
  const hits = [];
  const later = [];
  for (const u of next.units) {
    if (!u.alive || !done(u)) continue;
    if (u.task.type === 'attack') {
      const target = next.units.find(x => x.id === u.task.targetId);
      const ab = abilityOf(next, u, 'attack');
      // Where its dice said who it landed on, its other effects go to them alone.
      let onlyTo = null;
      if (ab && canUseNow(next, u, ab, { landing: true }) && canTarget(next, u, ab, target)) {
        const targets = affected(next, u, ab, target, null);
        const mine = damageOf(next, u, ab, targets);
        hits.push(...mine);
        if (mine.some(h => h.roll != null)) onlyTo = landed(targets, mine);
      }
      if (ab?.effects?.some(e => !e.damage)) later.push({ u, ab, target, point: null, ...(onlyTo ? { targets: onlyTo } : {}) });
    } else if (u.task.type === 'ability') {
      const ab = abilityOf(next, u, u.task.ability);
      const target = u.task.targetId != null ? next.units.find(x => x.id === u.task.targetId) : null;
      const ok = ab && (target ? canTarget(next, u, ab, target) : canTargetPoint(next, u, ab, u.task.at));
      if (ok) {
        const targets = affected(next, u, ab, target, u.task.at ?? null);
        const mine = damageOf(next, u, ab, targets);
        hits.push(...mine);
        later.push({ u, ab, target, point: u.task.at ?? null, targets: landed(targets, mine) });
      }
    }
  }
  units = next.units.map(u => (done(u) ? { ...u, task: null } : u));
  dice.thrown?.push(...hits.filter(h => h.roll != null));
  next = dealDamage({ ...next, units }, hits);
  for (const { u, ab, target, point, targets } of later) {
    const ids = (targets ?? affected(next, u, ab, target, point)).map(x => x.id);
    next = applyOtherEffects(next, u.id, ab, ids, point);
  }
  next = mergeArrivals(next, state, t);
  const rt = rtOf(next);
  next = withRt(next, { clock: t, passed: [], initiative: rt.initiative + 1, idleTicks: 0 });
  return { ...next, turnNumber: turnAt(t) };
}

// Counted groups that arrived on a group of their own type join it.
function mergeArrivals(next, before, t) {
  if (rulesOf(next).stacking !== 'count') return next;
  for (const u of before.units) {
    if (u.task?.type === 'move' && u.task.until <= t + EPS) {
      const now = next.units.find(x => x.id === u.id);
      if (now?.alive) next = mergeGroups(next, now);
    }
  }
  return next;
}

function applyContinuous(state, playerActions) {
  // Simultaneous orders are taken in the instant's initiative order, so no seat
  // is always the one whose claim on a contested spot wins.
  const ids = seatIds(state);
  const k = rtOf(state).initiative % ids.length;
  const rank = (pid) => (ids.indexOf(pid) - k + ids.length) % ids.length;
  const ordered = [...playerActions].sort((a, b) => rank(a.playerId) - rank(b.playerId));
  for (const { playerId, action } of ordered) {
    if (action.type === 'end-turn') {
      const rt = rtOf(state);
      if (!rt.passed.includes(playerId)) state = withRt(state, { passed: [...rt.passed, playerId] });
    } else {
      state = orderTask(state, playerId, action);
    }
  }
  return advanceClock(state);
}

// The engine's seeded rng is the battle's dice for the length of the call (see
// world.js `dice`); an action that threw any carries what they showed:
// `hitChance`, `roll`, `hit`, `crit` and `damage` for one target, or `rolls`, a
// list of those with `targetId`, for several. In continuous time a blow lands
// later than its order, so its dice are on the action of the moment it lands.
function applyActions(state, playerActions, rng = Math.random) {
  const was = { rng: dice.rng, thrown: dice.thrown };
  dice.rng = rng;
  const thrown = [];
  let next;
  try {
    if (isContinuousTime(state)) {
      dice.thrown = [];
      next = applyContinuous(state, playerActions);
      thrown.push(dice.thrown);
    } else {
      next = state;
      for (const { playerId, action } of playerActions) {
        dice.thrown = [];
        next = applyDiscrete(next, playerId, action);
        thrown.push(dice.thrown);
      }
    }
  } finally {
    dice.rng = was.rng;
    dice.thrown = was.thrown;
  }
  next = keepsVerdict(next) ? judgeNow(next) : next;
  if (checkTag(next) && !isContinuousTime(next)) next = judgeMate(next);
  if (next.gameSpecific.fogOfWar && next.gameSpecific.fogMemory) next = remember(next);
  if (isContinuousTime(next) && getResult(next) && next.activePlayers.length) next = { ...next, activePlayers: [] };
  const lastActions = playerActions.map((pa, i) => (thrown[i]?.length ? { ...pa, action: { ...pa.action, ...shown(thrown[i]) } } : pa));
  return { ...next, lastActions };
}

// The check rule's end: the side on move, before it has played, with no move at
// all. Threatened, it is mated — the last side standing beside it wins, or with
// more sides left it is out and leaves the field; not threatened, the game is
// drawn (stalemate).
function judgeMate(state) {
  if (getResult(state) || chargeOf(state)) return state;
  const pid = state.activePlayers[0];
  if (pid == null || actedThisTurn(state, pid).length) return state;
  if (getLegalActions(state, pid).some(a => a.type !== 'end-turn')) return state;
  const gs = state.gameSpecific;
  if (!inCheck(state, pid)) return { ...state, gameSpecific: { ...gs, verdict: { outcome: 'draw', winnerId: null, reason: 'stalemate' } } };
  const others = seatIds(state).filter(id => id !== pid && (gs.alive[id] ?? 0) > 0 && !(gs.out ?? []).includes(id));
  if (others.length === 1) return { ...state, gameSpecific: { ...gs, verdict: { outcome: 'win', winnerId: others[0], reason: 'checkmate' } } };
  const out = withUnits({ ...state, gameSpecific: { ...gs, out: [...(gs.out ?? []), pid] } },
    state.units.map(u => (u.alive && u.ownerId === pid ? { ...u, hp: 0, alive: false, task: null } : u)));
  return judgeMate(endTurn(out, pid));
}

const shown = (hits) => {
  const one = ({ targetId, hitChance, roll, hit, crit, amount }) => ({ targetId, hitChance, roll, hit, crit, damage: amount });
  if (hits.length > 1) return { rolls: hits.map(one) };
  const { targetId: _t, ...rest } = one(hits[0]);
  return rest;
};

// ── Result ───────────────────────────────────────────────────────────────────
// Reads the common-knowledge survivor counts and verdict, never `units`: under
// fog the observation a seat is handed has hidden enemies stripped out of
// `units`, and counting those would declare a phantom win.

function getResult(state) {
  return resultOf(state);
}

// ── Fog ──────────────────────────────────────────────────────────────────────

// What each side last saw of every enemy: gameSpecific.seen[seat][unit id] =
// { type, position, hp, turn }. Kept only under fog with fogMemory on.
function remember(state) {
  const gs = state.gameSpecific;
  const seen = { ...(gs.seen ?? {}) };
  for (const pid of seatIds(state)) {
    const mine = { ...(seen[pid] ?? {}) };
    for (const u of state.units) {
      if (u.ownerId === pid) continue;
      if (!u.alive) { delete mine[u.id]; continue; }
      if (seenBy(state, pid, u)) mine[u.id] = { type: u.type, ownerId: u.ownerId, position: { ...u.position }, hp: u.hp, maxHp: u.maxHp, turn: state.turnNumber };
    }
    seen[pid] = mine;
  }
  return { ...state, gameSpecific: { ...gs, seen } };
}

function getVisibleState(state, playerId) {
  const fog = state.gameSpecific.fogOfWar;
  const cloak = !fog && state.units.some(u => u.alive && u.ownerId !== playerId && hiddenFrom(state, playerId, u));
  if (!fog && !cloak) return state;
  const units = state.units.filter(u => !u.alive || u.ownerId === playerId || (fog ? seenBy(state, playerId, u) : !hiddenFrom(state, playerId, u)));
  const gs = state.gameSpecific;
  if (gs.seen) {
    // A side keeps its own memory, not anyone else's.
    return { ...state, units, gameSpecific: { ...gs, seen: { [playerId]: gs.seen[playerId] ?? {} } } };
  }
  return { ...state, units };
}

// ── Rendering ────────────────────────────────────────────────────────────────

// How a unit looks to its side: its type's `art` for its seat (a piece of each
// colour), else the type's own picture.
const lookOf = (state, u) => {
  const t = typeOf(state, u);
  return t.art?.[Math.max(0, seatIds(state).indexOf(u.ownerId)) % t.art.length] ?? { imagePath: t.imagePath };
};
const glyphOf = (state, u) => rulesOf(state).types[u.type]?.glyph ?? (u.type?.[0] ?? '?').toUpperCase();
const nameOf = (state, u) => rulesOf(state).types[u.type]?.name ?? u.type;

function renderState(state) {
  const { board } = state;
  const ids = seatIds(state);
  const B = boardIn(state);
  const at = new Map();
  for (const u of live(state)) at.set(`${Math.floor(u.position.x)},${Math.floor(u.position.y)}`, u);
  const terr = rulesOf(state).terrain;
  const ch = Object.fromEntries(Object.keys(terr).map(k => [k, Object.entries(LEGEND).find(([, v]) => v === k)?.[0] ?? k[0]]));
  const rows = [];
  if (B.topology === 'square' || B.topology === 'hex') {
    for (let y = 0; y < board.height; y++) {
      let row = B.topology === 'hex' && (y & 1) ? ' ' : '';
      for (let x = 0; x < board.width; x++) {
        const u = at.get(`${x},${y}`);
        row += u ? (ids.indexOf(u.ownerId) === 0 ? glyphOf(state, u) : glyphOf(state, u).toLowerCase()) : ch[board.terrain[`${x},${y}`] ?? 'open'];
        if (B.topology === 'hex') row += ' ';
      }
      rows.push(row);
    }
  } else if (B.topology === 'regions') {
    for (const [id, r] of Object.entries(B.regions)) {
      const a = B.anchorOf(id);
      const here = live(state).filter(u => u.position.x === a.x && u.position.y === a.y);
      rows.push(`${id} (${r.terrain ?? 'open'}): ${here.map(u => `${u.ownerId}:${u.type}`).join(' ') || '—'}`);
    }
  } else {
    rows.push(`${B.width}×${B.height} plane, ${board.shapes.length} shapes, ${board.walls.length} walls`);
  }
  const s = st(state);
  const when = s.time === 'continuous' ? `t=${rtOf(state).clock.toFixed(2)}` : `turn ${state.turnNumber}`;
  const armies = state.players.map(p =>
    `${p.name ?? p.id}: ${live(state).filter(u => u.ownerId === p.id).map(u => `${u.type}(${u.hp})`).join(' ')}`).join(' | ');
  return [`${state.gameName} ${s.space}/${s.time}/${s.play} — ${when}, ${state.activePlayers.join('+') || '—'} to move`, ...rows, armies].join('\n');
}

// A unit's status line: what it is doing (on a clock), its pools and statuses.
function statusOf(state, u, clock) {
  const out = [];
  if (clock != null && u.task) {
    const left = (u.task.until - clock).toFixed(2);
    const what = { move: 'moving', attack: 'striking', ability: u.task.ability, face: 'turning', wait: 'waiting' }[u.task.type] ?? u.task.type;
    out.push(u.task.type === 'move' ? `moving (${left} left)` : `${what} (${left})`);
  }
  const attrs = rulesOf(state).attrs;
  for (const [k, p] of Object.entries(u.pools ?? {})) out.push(`${attrs[k]?.name ?? k} ${p.value}/${p.max}`);
  for (const s of statusesOf(u)) out.push(`${attrs[s.id]?.name ?? s.id}${(s.stacks ?? 1) > 1 ? ` ×${s.stacks}` : ''} (${s.left})`);
  if (u.memberHp) out.push(`${membersOf(u)} strong`);
  return out;
}

function toGrid(state) {
  const { board } = state;
  const s = st(state);
  const B = boardIn(state);
  const pidIdx = Object.fromEntries(seatIds(state).map((id, i) => [id, i + 1]));
  const contTime = s.time === 'continuous';
  const clock = contTime ? rtOf(state).clock : null;
  const unitOut = (u) => {
    const st0 = u.stats;
    const f = facingOf(state, u);
    return {
      id: u.id,
      x: u.position.x, y: u.position.y,
      owner: pidIdx[u.ownerId] ?? 0,
      hp: u.hp, maxHp: u.maxHp,
      glyph: lookOf(state, u).glyph ?? glyphOf(state, u),
      // A piece is what it is: its numbers say nothing about how it moves.
      unitName: patternsOf(state, u) ? nameOf(state, u) : `${nameOf(state, u)} (atk ${stat(state, u, 'attack')} def ${stat(state, u, 'defense')} rng ${stat(state, u, 'range')} spd ${stat(state, u, 'speed')})`,
      type: u.type,
      moveRange: contTime ? (u.task ? 0 : stat(state, u, 'speed')) : (u.perTurn?.moveLeft ?? 0),
      radius: s.space === 'continuous' ? UNIT_R : undefined,
      // Where a unit is heading is something anyone can watch it do.
      queue: contTime && u.task?.type === 'move' ? [{ x: u.task.to.x, y: u.task.to.y }] : undefined,
      statusEffects: statusOf(state, u, clock),
      ...(f ? { facing: (u.facing * Math.PI) / 180, ...(f.fov < 360 ? { fov: f.fov } : {}), visionRange: stat(state, u, 'vision') } : {}),
      ...(lookOf(state, u).imagePath ? { imagePath: lookOf(state, u).imagePath } : {}),
    };
  };
  const ui = {
    showHpBars: true,
    showFacing: rulesOf(state).orientation,
    moveAnimation: s.space === 'continuous' ? 'slide' : 'hop',
    simultaneousMotion: contTime,
    hideTurnTimeline: !contTime,
    gridDestinations: s.space === 'discrete',
    showUnitsLost: true,
  };
  if (B.topology === 'hex' || B.topology === 'regions') return hexGrid(state, B, unitOut, ui, clock);
  const terr = rulesOf(state).terrain;
  // A shape board is drawn as its ground with the shapes over it, so every cell
  // carries the ground's colour (the board draws one backdrop of it).
  const ground = B.topology === 'shapes' ? terr[board.ground]?.color : null;
  const cells = [];
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      const t = B.terrainAt(x, y);
      cells.push({ x, y, color: ground ?? t.color, terrain: { name: t.name, description: t.description }, ...(t.extrude ? { height: t.extrude } : {}) });
    }
  }
  const grid = {
    width: board.width, height: board.height,
    boardType: 'grid',
    spaceType: s.space,
    timeType: s.time,
    locationType: 'continuous',
    cells, units: [...live(state).map(unitOut), ...ghosts(state, pidIdx)],
    ...(contTime ? { clock } : {}),
    ...(board.labels?.x ? { xLabels: board.labels.x } : {}),
    ...(board.labels?.y ? { yLabels: board.labels.y } : {}),
    los: { blocked: B.topology === 'shapes'
      ? B.cells().filter(c => B.terrainAt(c.x, c.y)?.blocksSight).map(c => `${c.x},${c.y}`)
      : Object.entries(board.terrain).filter(([, k]) => terr[k]?.blocksSight).map(([key]) => key) },
    ui,
    // How the scenario wants to be shown (its `display`: a preset and flags), which
    // the client lays over the game's ui and a session's own choice lays over that.
    ...(rulesOf(state).spec.display ? { display: rulesOf(state).spec.display } : {}),
  };
  if (B.topology === 'shapes') {
    grid.shapes = [
      ...board.shapes.map(sh => ({ ...(sh.points ? { shape: 'poly', points: sh.points } : { shape: 'rect', x: sh.x, y: sh.y, w: sh.w, h: sh.h }), fill: terr[sh.terrain]?.color, kind: sh.terrain })),
      ...board.walls.map(w => ({ shape: 'poly', points: wallPoly(w), fill: w.window ? '#9fc6e8' : '#2b2b2b', kind: w.window ? 'window' : 'wall' })),
    ];
  }
  return grid;
}

// A wall segment drawn as a thin quad.
function wallPoly(w) {
  const dx = w.x1 - w.x0, dy = w.y1 - w.y0, l = Math.hypot(dx, dy) || 1, k = 0.06;
  const nx = (-dy / l) * k, ny = (dx / l) * k;
  return [{ x: w.x0 + nx, y: w.y0 + ny }, { x: w.x1 + nx, y: w.y1 + ny }, { x: w.x1 - nx, y: w.y1 - ny }, { x: w.x0 - nx, y: w.y0 - ny }];
}

// Last-seen enemies (fogMemory), drawn faded where they were seen.
function ghosts(state, pidIdx) {
  const seen = state.gameSpecific.seen;
  if (!seen) return [];
  const present = new Set(state.units.filter(u => u.alive).map(u => u.id));
  const out = [];
  for (const mine of Object.values(seen)) {
    for (const [id, g] of Object.entries(mine)) {
      if (present.has(id)) continue;
      out.push({ id: `ghost:${id}`, x: g.position.x, y: g.position.y, owner: pidIdx[g.ownerId] ?? 0, hp: g.hp, maxHp: g.maxHp, glyph: rulesOf(state).types[g.type]?.glyph ?? '?',
        unitName: `${rulesOf(state).types[g.type]?.name ?? g.type} — last seen turn ${g.turn}`, type: g.type, ghost: true, opacity: 0.4, statusEffects: [`last seen turn ${g.turn}`] });
    }
  }
  return out;
}

// A region's colour: its terrain's, a shade lighter or darker by its place in the
// list, so neighbouring regions of one terrain still read as two.
function tint(hex, i) {
  const f = [0, 0.1, -0.08, 0.05, -0.12][i % 5];
  const c = [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16));
  return '#' + c.map(v => Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f)).toString(16).padStart(2, '0')).join('');
}

// Hex and regions boards: a hex per cell in pixel space, units on their cells.
const HEX = 26;
function hexGrid(state, B, unitOut, ui, clock) {
  const pidIdx = Object.fromEntries(seatIds(state).map((id, i) => [id, i + 1]));
  const W = Math.sqrt(3) * HEX, H = 1.5 * HEX;
  const px = (x, y) => ({ x: W * (x + 0.5 * (y & 1)) + W, y: H * y + HEX * 1.5 });
  const byCell = new Map();
  for (const u of live(state)) {
    const k = `${u.position.x},${u.position.y}`;
    if (!byCell.has(k)) byCell.set(k, []);
    byCell.get(k).push(u);
  }
  const cells = [];
  const regions = B.topology === 'regions';
  const regionIndex = new Map(Object.keys(B.regions ?? {}).map((id, i) => [id, i]));
  const coords = regions ? Object.values(B.regions).flatMap(r => r.cells) : B.cells().map(c => [c.x, c.y]);
  for (const [x, y] of coords) {
    const rid = regions ? B.cellRegion(x, y) : null;
    const t = regions ? B.terrainAt(B.anchorOf(rid).x, B.anchorOf(rid).y) : B.terrainAt(x, y);
    const here = byCell.get(`${x},${y}`) ?? [];
    const top = here[0];
    const p = px(x, y);
    const elev = B.elevated ? B.elevAt({ x, y }) : 0;
    const drawn = top ? unitOut(top) : null;
    // A region's units stand on its anchor hex, and that is the hex a move into the
    // region is clicked on (the board marks it as a legal destination).
    cells.push({
      x: p.x, y: p.y, col: x, row: y,
      color: regions ? tint(t?.color ?? '#888888', regionIndex.get(rid)) : t?.color ?? '#888',
      ...(drawn?.facing != null ? { facing: drawn.facing, ...(drawn.fov ? { fov: drawn.fov } : {}) } : {}),
      owner: top ? pidIdx[top.ownerId] ?? 0 : 0,
      glyph: top ? glyphOf(state, top) + (here.length > 1 ? `${here.length}` : '') : '',
      ...(top ? { unitId: top.id, unitName: here.map(u => unitOut(u).unitName).join(' · '), hp: here.reduce((a, u) => a + u.hp, 0), maxHp: here.reduce((a, u) => a + u.maxHp, 0) } : {}),
      terrain: { name: `${regions ? `${B.regions[rid].name ?? rid} — ` : ''}${t?.name ?? ''}${elev ? ` (height ${elev})` : ''}`, description: t?.description ?? '' },
      ...(regions ? { region: rid } : {}),
    });
  }
  const xs = cells.map(c => c.x), ys = cells.map(c => c.y);
  const grid = {
    width: Math.max(...xs) + W, height: Math.max(...ys) + HEX * 1.5,
    grid: 'hexagon', hexSize: HEX,
    spaceType: 'discrete', timeType: st(state).time,
    cells,
    units: live(state).map(unitOut),
    ...(clock != null ? { clock } : {}),
    // Hexes draw their own outlines: no square grid or pixel ruler over them.
    ui: { ...ui, showFacing: ui.showFacing && !regions, hideGridLines: true, showRuler: false },
  };
  if (regions) {
    // One outline per region where it borders another, as territory maps draw.
    const borders = [];
    for (const [i, c] of cells.entries()) {
      const [cx, cy] = coords[i];
      for (const [dx, dy, a0, a1] of [[1, 0, -30, 30], [0, 1, 30, 90], [-1, 1, 90, 150]]) {
        const nx = dx === 0 || dx === -1 ? (cy & 1 ? cx + dx + 1 : cx + dx) : cx + dx;
        const ny = cy + dy;
        const o = dy === 0 ? B.cellRegion(cx + 1, cy) : B.cellRegion(nx, ny);
        if (o === c.region) continue;
        const k = (deg) => [c.x + HEX * Math.cos((deg * Math.PI) / 180), c.y + HEX * Math.sin((deg * Math.PI) / 180)];
        borders.push({ p1: k(a0), p2: k(a1), aId: c.region, bId: o, aOwner: 0, bOwner: 0 });
      }
    }
    grid.territoryBorders = borders;
  }
  return grid;
}

function actionKey(a) {
  return JSON.stringify([a.type, a.unitId ?? null, a.to ?? null, a.targetId ?? null, a.duration ?? null,
    ...(a.ability != null || a.at != null || a.facing != null ? [a.ability ?? null, a.at ?? null, a.facing ?? null] : [])]);
}

// ── The game ─────────────────────────────────────────────────────────────────

/**
 * A BattleGame: one GameDefinition for battles described as specs.
 *
 * @param {object} opts
 * @param {string} opts.name            its name (state.gameName; keys its hooks)
 * @param {object} [opts.spec]          its default spec, over the base (Arena's)
 * @param {object} [opts.specs]         named specs, by id: config.spec names one
 * @param {object[]|() => object[]} [opts.scenarios]  the setup form's scenarios
 * @param {object} [opts.hooks]         the functions `{ fn }` in its specs may name
 * @param {(id: string) => object|null} [opts.findSpec]  specs found elsewhere (the library)
 * @param {string} [opts.specsDir]      the folder its named specs are kept in, one
 *   `<id>.json` each, which makes them editable (src/server/specEditor.js)
 */
export function makeBattleGame({ name, spec = {}, specs = {}, scenarios = [], hooks = {}, findSpec = null, specsDir = null, extend = {} }) {
  const base = resolveSpec(spec, BASE_SPEC);
  registerBattleGame(name, base, hooks);
  // Its own copy: the spec editor changes it while the server runs.
  const named = { ...specs };
  const resolved = new Map();

  // The spec a session plays: config.spec as an id or an inline spec, resolved
  // over this game's default — or null for the default itself.
  function sessionSpec(config) {
    const want = config.spec;
    if (want == null) return null;
    if (typeof want === 'object') return resolveSpec(onMap(want), base);
    if (!resolved.has(want)) {
      const raw = named[want] ?? findSpec?.(want);
      if (!raw) throw new Error(`${name}: no spec "${want}"`);
      resolved.set(want, resolveSpec(onMap(raw), base));
    }
    return resolved.get(want);
  }

  // A spec that names a library `map` plays on that map (its board, terrain and
  // distances), with whatever else it says over it.
  function onMap(raw) {
    if (!raw.map) return raw;
    const m = findSpec?.(`library:${raw.map}`);
    if (!m) throw new Error(`${name}: no library map "${raw.map}"`);
    return { ...m, ...raw, terrain: { ...m.terrain, ...(raw.terrain ?? {}) } };
  }

  // The host a library unit is converted into: this game, with distances in the
  // map's own cells when the map comes from another game (spec.scale).
  const hosts = new Map();
  function hostFor(scale) {
    if (!scale || !game.foreignUnits?.scale) return game;
    const key = `${scale.range}/${scale.move}`;
    if (!hosts.has(key)) hosts.set(key, { ...game, foreignUnits: { ...game.foreignUnits, scale: { ...game.foreignUnits.scale, range: scale.range, move: scale.move } } });
    return hosts.get(key);
  }

  // One unit of another game for a spec's placements, built as foreignUnits.js
  // builds one for a roster.
  function foreignUnit(state, sp, { id, ownerId, type, game: from, position, facing }) {
    const host = hostFor(sp.scale);
    const u = mintForeign(host, state, { ownerId, type, game: from, position }, id,
      (_spec, chassis) => ({ ...makeUnit(state, { id, ownerId, type: chassis, position, facing }), perTurn: null }));
    // On a counted board a member is the foreign unit itself, not its chassis: its
    // hit points are its own, so the group is one of it.
    const member = u.memberHp ? { memberHp: u.maxHp } : {};
    return { ...u, ...member, position: { x: position.x, y: position.y } };
  }

  function createInitialState(players, config = {}) {
    const full = sessionSpec(config);
    const sp = full ?? base;
    const errs = full ? checkSpec(full, hooks) : [];
    if (errs.length) throw new Error(`${name}: spec "${full.id ?? '(inline)'}": ${errs.join('; ')}`);
    let space = ST.resolveSpaceTime(game, { ...(sp.modes ?? {}), ...config });
    if (sp.turn?.order === 'charge') space = { ...space, time: 'discrete', play: 'sequential' };
    const board = buildBoard(sp.board, full ? {} : config);
    // A board with no plane under it is played in discrete space, whatever was asked.
    if (space.space === 'continuous' && !['square', 'shapes'].includes(board.topology ?? 'square')) space = { ...space, space: 'discrete' };
    const ids = players.map(p => p.id);
    const fogOfWar = !!(config.fogOfWar ?? (sp.fog && sp.fog !== 'off'));
    const fogMemory = fogOfWar && !!(config.fogMemory ?? sp.fog === 'remembered');
    const rules = full ? (({ armies: _a, units: _u, board: b, ...rest }) => ({ ...rest, board: { topology: b.topology ?? 'square', ...(b.stacking ? { stacking: b.stacking } : {}), ...(b.stackDeath ? { stackDeath: true } : {}), ...(b.climb != null ? { climb: b.climb } : {}), ...(b.passFriends === false ? { passFriends: false } : {}) } }))(full) : null;
    let state = {
      gameName: name,
      turnNumber: 1,
      activePlayers: [ids[0]],
      currentPhase: 'battle',
      players,
      board,
      units: [],
      lastActions: null,
      gameSpecific: {
        ...(rules ? { rules } : {}),
        spacetime: space,
        fogOfWar,
        ...(fogMemory ? { fogMemory: true } : {}),
        // The session's own units-a-turn, over the spec's `turn.units` (0: no limit).
        ...(config.unitsPerTurn != null && config.unitsPerTurn !== '' ? { unitsPerTurn: Math.max(0, Math.floor(Number(config.unitsPerTurn)) || 0) } : {}),
        ended: [],
        rt: space.time === 'continuous' ? { clock: 0, passed: [], initiative: 0, idleTicks: 0, standoff: false } : null,
      },
    };
    const layout = config.armies ?? sp.armies ?? BASE_SPEC.armies;
    state = {
      ...state,
      units: config.units ?? (sp.units && !config.armies ? placedUnits(state, ids, sp.units, (e) => foreignUnit(state, sp, e)) : defaultUnits(state, ids, board.width, board.height, layout)),
    };
    let settled = settle(state);
    if (keepsVerdict(settled)) settled = judgeNow(settled);
    if (chargeOf(settled)) settled = startCharge(settled);
    if (fogMemory) settled = remember(settled);
    // On a clock, who is on move first is whoever has a decision at t=0.
    return space.time === 'continuous' ? advanceClock(settled) : settled;
  }

  const modeOptions = [
    { id: 'fogOfWar', label: 'Fog of War', description: 'Each side sees only what its units can see (vision, blocked by sight-blocking ground; facing cones and cloaks where the battle has them)', type: 'boolean', default: false },
    { id: 'fogMemory', label: 'Remember last seen', description: 'Under fog, each side keeps where it last saw each enemy', type: 'boolean', default: false },
    { id: 'space', label: 'Space', description: 'Discrete (units on cells) or continuous (units on exact points; square and shape boards only)', type: 'select', default: 'discrete',
      options: [{ value: 'discrete', label: 'Discrete (cells)' }, { value: 'continuous', label: 'Continuous (points)' }] },
    { id: 'time', label: 'Time', description: 'Discrete (turns of move/act budgets) or continuous (one clock; orders take time)', type: 'select', default: 'discrete',
      options: [{ value: 'discrete', label: 'Discrete (turns)' }, { value: 'continuous', label: 'Continuous (clock)' }] },
    // Simultaneous play is the engine's we-go path; `play` is its unified spelling
    // (src/kit/spacetime.js), offered here because only a game built to be played
    // either way should offer it — every other game plays in its own structure.
    { id: 'play', label: 'Play', description: 'Sequential (sides take turns) or simultaneous (every side gives its orders at once, and they resolve together)', type: 'select', default: 'sequential',
      options: [{ value: 'sequential', label: 'Sequential (turns)' }, { value: 'simultaneous', label: 'Simultaneous (we-go)' }] },
    { id: 'unitsPerTurn', label: 'Units per turn', description: 'How many of its units a side may use in a turn (discrete time); its turn ends by itself once they are done. The scenario says, unless this does.', type: 'select', default: '',
      options: [{ value: '', label: "Scenario's own" }, { value: '0', label: 'Every unit' }, { value: '1', label: 'One' }, { value: '2', label: 'Two' }, { value: '3', label: 'Three' }] },
  ];

  const game = {
    name,
    // The quadrant this session plays in comes from config (`space`, `time`, and the
    // engine's Simultaneous Turns switch for `play`); these are the defaults.
    spacetime: { space: 'discrete', time: 'discrete', play: 'sequential' },
    kinematics,
    get scenarios() { return typeof scenarios === 'function' ? scenarios() : scenarios; },
    // Its named specs, as the spec editor reads and changes them: a session
    // started after a change plays the changed spec, and one already running
    // keeps the rules it started with (they travel in its state).
    specBook: {
      dir: specsDir,
      ids: () => Object.keys(named),
      get: (id) => named[id] ?? null,
      /** What is wrong with a spec, as checkSpec says; empty when it can be played. */
      check(raw) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['a spec is a JSON object'];
        try { return checkSpec(resolveSpec(onMap(raw), base), hooks); } catch (e) { return [e.message]; }
      },
      put(id, raw) { named[id] = raw; resolved.delete(id); },
      drop(id) { delete named[id]; resolved.delete(id); },
    },
    gameOptions: modeOptions,
    // No evaluateState on purpose: a BattleGame is played by the generic AI
    // (src/agents/generic), which needs none.
    uiDefaults: { cpuAgent: 'generic' },
    ui: {
      timeEntry: {
        wait: { field: 'duration', label: 'Wait for', button: 'Wait', unit: 'turns', min: MIN_WAIT, max: MAX_WAIT, step: 0.25 },
      },
    },
    // In continuous time a BattleGame runs its own clock and decides itself who is
    // on move at each instant, several seats at once when play is simultaneous — so
    // the engine must not wrap it in its we-go planning (src/engine/GameEngine.js step()).
    nativelySimultaneous: (state) => isContinuousTime(state),

    // The generic unit contract (src/kit/types.js `unitAttributes`): what every unit
    // is, in numbers — its own fields, as statuses leave them — and, on a clock,
    // what it is in the middle of doing; plus what the generic AI should make of
    // what it carries beyond the core numbers (`worthBonus`, see unitWorthBonus).
    unitAttributes(state, u) {
      const out = { hp: u.hp, maxHp: u.maxHp };
      for (const k of STAT_KEYS) out[k] = stat(state, u, k);
      if (u.memberHp) out.attack *= membersOf(u);
      out.heading = u.task?.type === 'move' ? u.task.to : null;
      out.striking = u.task?.type === 'attack' ? u.task.targetId : u.task?.type === 'ability' ? u.task.targetId ?? null : null;
      const f = facingOf(state, u);
      if (f) { out.facing = u.facing; if (f.arcs) out.arcs = f.arcs; if (f.fov < 360) out.fov = f.fov; }
      const bonus = unitWorthBonus(state, u);
      if (bonus) out.worthBonus = bonus;
      if (patternsOf(state, u)) out.exactThreats = true;
      return out;
    },
    // What every piece could take on its next move, whatever is left of this turn
    // (attacker id → Set of target ids): the generic AI's exact threats for units
    // that take by moving (patterns.js), where speed and range say nothing.
    threats(state) {
      const occ = occupancy(state);
      const out = new Map();
      for (const u of state.units) {
        if (!u.alive || !patternsOf(state, u)) continue;
        const ids = pieceTargets(state, u, occ).filter(t => t.captured).map(t => t.captured.id);
        if (ids.length) out.set(u.id, new Set(ids));
      }
      return out;
    },
    // The point a unit stands on, for the generic AI's distances: its cell on a
    // square grid (whose metric it then reads as Chebyshev), else a point on the
    // plane where neighbouring cells are 1 apart.
    unitPoint: (state, u) => (isContinuousSpace(state) || ['square', 'shapes'].includes(boardIn(state).topology) ? { x: u.position.x, y: u.position.y } : pointOf(state, u)),
    unitStats() {
      return Object.fromEntries(Object.entries(rulesOf({ gameName: name, gameSpecific: {} }).types).map(([k, t]) =>
        [k, { hp: t.hp, attack: t.attack, defense: t.defense, range: t.range, move: t.speed, domain: t.domain ?? 'land' }]));
    },

    setupUnitTypes: (state) => Object.keys(state ? rulesOf(state).types : base.unitTypes),
    createSetupUnit(state, { id, ownerId, type, position }) {
      if (!rulesOf(state).types[type] || !position) return null;
      const seat = seatIds(state).indexOf(ownerId);
      const u = makeUnit(state, { id, ownerId, type, position: placeForSpace(st(state).space, position), facing: SEAT_FACING[Math.max(0, seat) % 4] });
      return { ...u, perTurn: isContinuousTime(state) ? null : freshPerTurn(state, u) };
    },
    applyStartingUnits: (state) => settle(state),

    // What makes a position the position it is, for the Obscuro search's information
    // sets: the units (where, how hurt, what they're doing, what's left of their
    // turn) and, on a clock, the time and who has passed. `board` is only terrain.
    identityOf: (state) => ({
      units: state.units.map(u => [u.id, u.alive, u.hp, u.position, u.perTurn, u.task, ...(u.facing != null || u.pools || u.statuses ? [u.facing ?? null, u.pools ?? null, u.statuses ?? null] : []), ...(u.moved ? [u.type, true] : [])]),
      ended: state.gameSpecific.ended,
      ...(state.gameSpecific.passing ? { passing: state.gameSpecific.passing } : {}),
      ...(state.gameSpecific.acted ? { acted: state.gameSpecific.acted } : {}),
      rt: state.gameSpecific.rt ? { clock: state.gameSpecific.rt.clock, passed: state.gameSpecific.rt.passed } : null,
    }),

    createInitialState,
    getLegalActions,
    isActionLegal,
    applyActions,
    getResult,
    getVisibleState,
    getActionDuration,
    renderState,
    toGrid,
    actionKey,
    ...extend,
  };
  return game;
}

// What a unit carries beyond the core numbers is worth to the generic AI, as a
// share of its own worth: each pool by how full it is — its declared `value`,
// else, for one that absorbs damage, what it soaks as hit points would, else only
// a tie-breaker (what a pool buys shows up when the search spends it, and valuing
// it more makes the AI hoard it) — and each status by its declared `value`, or
// what its tick will do to the unit's hit points over the windows it has left,
// or −0.1 a window it stops the unit for. A status's modifiers need no value of
// their own: the stats the AI reads already carry them.
export function unitWorthBonus(state, u) {
  const attrs = rulesOf(state).attrs;
  let b = 0;
  for (const [k, p] of Object.entries(u.pools ?? {})) {
    if (!(p.max > 0)) continue;
    const w = attrs[k]?.value ?? (attrs[k]?.absorbs ? 0.5 * (p.max / Math.max(1, u.maxHp)) : 0.02);
    b += w * (p.value / p.max);
  }
  for (const s of statusesOf(u)) {
    const d = attrs[s.id] ?? BUILT_IN[s.id] ?? {};
    if (d.value != null) { b += d.value * (s.stacks ?? 1); continue; }
    const tick = (d.tick ?? []).reduce((a, e) => a + (e.damage ? -(e.damage.amount ?? 1) : e.heal ? e.heal.amount ?? 1 : 0), 0);
    if (tick) b += (tick * Math.min(s.left, 3) * (s.stacks ?? 1)) / Math.max(1, u.maxHp);
    if (d.blocks?.length) b -= 0.1 * Math.min(s.left, 3);
  }
  return b;
}

export { STAT_KEYS, checkSpec, resolveSpec, abilitiesOf, gapBetween, gap, seenBy };
