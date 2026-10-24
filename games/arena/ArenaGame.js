// ---------------------------------------------------------------------------
// Arena — the generic battle.
//
// A board of terrain cells, and armies of units that are nothing but numbers:
//
//   hp       how much damage it takes to kill
//   attack   how hard it hits            defense  how well it resists a hit
//   range    how far it strikes          speed    how far it travels in a turn
//   rate     strikes per turn            vision   how far it sees (fog of war)
//
// The unit types (UNIT_TYPES) are only presets. Every unit carries its own
// numbers in `unit.stats`, so a roster can field anything — including units of
// other games, converted by engine/foreignUnits.js — and no rule ever asks what
// a unit IS, only what its numbers are.
//
// The same rules run in all eight corners of (space × time × play):
//
//   space  discrete     units stand on cells; distance is Chebyshev; a move is a
//                       path of 8-neighbour steps, each costing the entered
//                       cell's terrain price.
//          continuous   units stand on exact points; distance is Euclidean; a
//                       move is a straight segment, priced exactly by the length
//                       it spends in each cell (geometry.js).
//
//   time   discrete     a turn is a window of budgets: one move of up to
//                       `speed` movement points and `rate` strikes per unit,
//                       in either order. A turn ends when every seat has ended it.
//          continuous   one clock (gameSpecific.rt.clock, in turn windows). An
//                       IDLE unit takes an order, and the order is a task that
//                       finishes later: a move takes cost/speed of a window (the
//                       unit travels meanwhile — sliding in continuous space,
//                       hopping cell to cell in discrete space), a strike lands
//                       after a wind-up of ATTACK_TIME/rate, a wait for whatever
//                       length was named. When nobody has a decision left at
//                       this instant the clock runs to the next completion.
//
//   play   sequential   discrete time: I-go-you-go. Continuous time: the seats
//                       with decisions at an instant make them one after another
//                       in initiative order (which rotates every instant), each
//                       seeing the orders given before it.
//          simultaneous discrete time: the engine's we-go path — every seat
//                       plans a whole turn, then engine/KineticResolver.js plays
//                       the plans out together. Continuous time: every seat with
//                       a decision is on move at once (the engine asks them all
//                       and hands the orders over together).
//
// Combat is deterministic: a strike deals
//     max(1, ⌊ attack² / (attack + defense × (1 + cover)) ⌋)
// where cover is the defender's terrain bonus. Wipe out every other side to win.
// Hit points and damage are integers; discrete-space movement points too.
// ---------------------------------------------------------------------------

import * as ST from '../spacetime.js';
import { TERRAIN, terrainAt, terrainUnder, segmentCells, segmentCost, lineOfSight, inBounds } from './geometry.js';
import { whole } from '../../engine/foreignUnits.js';

// ── Unit presets ─────────────────────────────────────────────────────────────

export const UNIT_TYPES = {
  infantry:  { name: 'Infantry',  glyph: 'I', hp: 10, attack: 4, defense: 4, range: 1, speed: 3, rate: 1, vision: 4 },
  archer:    { name: 'Archer',    glyph: 'A', hp: 7,  attack: 4, defense: 2, range: 4, speed: 3, rate: 1, vision: 5 },
  cavalry:   { name: 'Cavalry',   glyph: 'C', hp: 10, attack: 5, defense: 3, range: 1, speed: 6, rate: 1, vision: 5 },
  knight:    { name: 'Knight',    glyph: 'K', hp: 16, attack: 6, defense: 6, range: 1, speed: 2, rate: 1, vision: 3 },
  artillery: { name: 'Artillery', glyph: 'G', hp: 6,  attack: 8, defense: 1, range: 6, speed: 2, rate: 1, vision: 4 },
  scout:     { name: 'Scout',     glyph: 'S', hp: 5,  attack: 2, defense: 2, range: 1, speed: 8, rate: 2, vision: 8 },
};

/** The numbers a unit carries in `unit.stats` (hit points live on the unit itself). */
export const STAT_KEYS = ['attack', 'defense', 'range', 'speed', 'rate', 'vision'];

// ── Constants ────────────────────────────────────────────────────────────────

const EPS = 1e-9;
/** Body radius in continuous space: two units stand at least 2R apart. */
export const UNIT_R = 0.35;
/** Length of one turn window, in clock units. */
export const TURN_DURATION = 1;
/** A strike's wind-up, in turn windows, at rate 1 (rate 2 → half as long). */
export const ATTACK_TIME = 0.5;
/** Shortest / longest wait an idle unit may be told to hold (continuous time). */
export const MIN_WAIT = 0.01;
export const MAX_WAIT = 8;
/** Clock advance when every seat passes with nothing in progress. */
const IDLE_TICK = 0.5;
/** Consecutive empty advances before the game is a standoff (a draw). */
const MAX_IDLE_TICKS = 40;
/** Continuous-space destination lattice: rings × spokes points, plus strike points. */
const RINGS = 3, SPOKES = 12;

// ── Small helpers ────────────────────────────────────────────────────────────

const st = (state) => state.gameSpecific.spacetime;
const isContinuousTime = (state) => st(state).time === 'continuous';
const live = (state) => state.units.filter(u => u.alive);
const seatIds = (state) => state.players.map(p => p.id);

/** The point a unit occupies, for geometry: a cell's centre in discrete space. */
export function pointOf(state, u) {
  const p = u.position;
  return st(state).space === 'continuous' ? { x: p.x, y: p.y } : { x: p.x + 0.5, y: p.y + 0.5 };
}

/** Distance between two positions in the active space's metric. */
export function gapBetween(state, a, b) {
  return st(state).space === 'continuous'
    ? Math.hypot(a.x - b.x, a.y - b.y)
    : Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}
const gap = (state, u, v) => gapBetween(state, u.position, v.position);

const coverOf = (state, u) => {
  const p = pointOf(state, u);
  return terrainUnder(state.board, p.x, p.y)?.cover ?? 0;
};

/** The damage one strike of `a` deals to `d` where `d` stands now. Always an integer. */
export function strikeDamage(state, a, d) {
  const atk = a.stats.attack, def = d.stats.defense, cover = coverOf(state, d);
  return Math.max(1, Math.floor((100 * atk * atk) / (100 * atk + def * (100 + cover))));
}

function makeUnit(id, ownerId, type, position, stats = null) {
  const preset = UNIT_TYPES[type] ?? UNIT_TYPES.infantry;
  const s = stats ?? preset;
  return {
    id, ownerId, type,
    position: { x: position.x, y: position.y },
    alive: true,
    hp: s.hp ?? preset.hp, maxHp: s.hp ?? preset.hp,
    stats: Object.fromEntries(STAT_KEYS.map(k => [k, s[k] ?? preset[k]])),
    perTurn: null,
    task: null,
  };
}

const freshPerTurn = (u) => ({ moveLeft: u.stats.speed, attacksLeft: u.stats.rate });

// ── Vision ───────────────────────────────────────────────────────────────────

function sees(state, viewer, target) {
  if (gap(state, viewer, target) > viewer.stats.vision + EPS) return false;
  const a = pointOf(state, viewer), b = pointOf(state, target);
  return lineOfSight(state.board, a.x, a.y, b.x, b.y);
}

/** Does any live unit of `playerId` see `target`? */
export function seenBy(state, playerId, target) {
  if (target.ownerId === playerId) return true;
  return state.units.some(u => u.alive && u.ownerId === playerId && sees(state, u, target));
}

// ── Striking ─────────────────────────────────────────────────────────────────

function canStrike(state, u, t) {
  if (!t?.alive || t.ownerId === u.ownerId || !(u.stats.attack > 0)) return false;
  const d = gap(state, u, t);
  if (d > u.stats.range + EPS) return false;
  // Beyond arm's length a strike is a missile, and needs a clear line.
  if (d > 1 + EPS) {
    const a = pointOf(state, u), b = pointOf(state, t);
    if (!lineOfSight(state.board, a.x, a.y, b.x, b.y)) return false;
  }
  // Under fog a side can only strike what it can see.
  if (state.gameSpecific.fogOfWar && !seenBy(state, u.ownerId, t)) return false;
  return true;
}

// ── Movement (games/spacetime.js does the quadrant arithmetic) ───────────────

const DIRS8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

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

const kinematics = {
  turnDuration: TURN_DURATION,
  speed: (u) => u.stats.speed,
  // Discrete space: 8-neighbour steps priced by the entered cell. A unit may pass
  // through friends but not enemies; where it may STOP is filtered afterwards.
  neighbors(pos, unit, state) {
    const out = [];
    for (const [dx, dy] of DIRS8) {
      const x = pos.x + dx, y = pos.y + dy;
      const t = terrainAt(state.board, x, y);
      if (!t?.passable) continue;
      if (state.units.some(o => o.alive && o.ownerId !== unit.ownerId && o.position.x === x && o.position.y === y)) continue;
      out.push({ to: { x, y }, cost: t.cost });
    }
    return out;
  },
  walkable: (x, y, unit, state) => !!terrainUnder(state.board, x, y)?.passable,
  occupied: (x, y, unit, state) => claims(state, unit.id).some(({ p }) => Math.hypot(p.x - x, p.y - y) < 2 * UNIT_R - EPS),
};

const cellFree = (state, unit, c) => !claims(state, unit.id).some(({ p }) => p.x === c.x && p.y === c.y);

/** How far `unit` may still travel on one order. */
function reach(state, unit) {
  return isContinuousTime(state) ? unit.stats.speed : unit.perTurn.moveLeft;
}

/** Every place `unit` may be ordered to: [{ to, cost, path }]. */
export function destinations(state, unit) {
  const s = st(state);
  const budget = reach(state, unit);
  if (!(budget > EPS)) return [];
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
    const dx = e.position.x - o.x, dy = e.position.y - o.y, d = Math.hypot(dx, dy);
    if (d < EPS) continue;
    for (const want of [d - unit.stats.range * 0.98, Math.min(budget, d - 2 * UNIT_R - 1e-6)]) {
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

// A straight continuous move's price, or Infinity if it can't be made.
function continuousMoveCost(state, unit, p) {
  if (!terrainUnder(state.board, p.x, p.y)?.passable) return Infinity;
  if (kinematics.occupied(p.x, p.y, unit, state)) return Infinity;
  const o = unit.position;
  return segmentCost(state.board, o.x, o.y, p.x, p.y);
}

// Discrete-space path cost of an exact cell route (each entered cell's price).
const pathCost = (state, path) => path.slice(1).reduce((s, c) => s + terrainAt(state.board, c.x, c.y).cost, 0);

// ── Setup ────────────────────────────────────────────────────────────────────

// Skirmish: a river down the middle with two fords, woods and hills on either
// bank, a rock outcrop that blocks the centre line of sight. 180°-symmetric, so
// neither side is favoured.
function skirmishTerrain(w, h) {
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

const ARMY = ['infantry', 'infantry', 'archer', 'cavalry', 'artillery'];

function defaultUnits(playerIds, w, h, layout) {
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
      units.push(makeUnit(`${pid}-${i + 1}`, pid, type, pos));
    });
  });
  return units;
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
  const units = state.units.map(u => ({
    ...u,
    stats: { ...(UNIT_TYPES[u.type] ? Object.fromEntries(STAT_KEYS.map(k => [k, UNIT_TYPES[u.type][k]])) : {}), ...u.stats },
    position: placeForSpace(s.space, u.position),
    perTurn: contTime ? null : freshPerTurn({ stats: { ...UNIT_TYPES[u.type], ...u.stats } }),
    task: null,
  }));
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

const aliveCounts = (players, units) =>
  Object.fromEntries(players.map(p => [p.id, units.filter(u => u.alive && u.ownerId === p.id).length]));

export function createInitialState(players, config = {}) {
  const space = ST.resolveSpaceTime(ArenaGame, config);
  const width = config.width ?? 14, height = config.height ?? 10;
  const terrain = config.terrain ?? (config.map === 'open' ? {} : skirmishTerrain(width, height));
  const layout = config.armies ?? [ARMY];
  const ids = players.map(p => p.id);
  const state = {
    gameName: 'Arena',
    turnNumber: 1,
    activePlayers: [ids[0]],
    currentPhase: 'battle',
    players,
    board: { width, height, terrain },
    units: config.units ?? defaultUnits(ids, width, height, layout),
    lastActions: null,
    gameSpecific: {
      spacetime: space,
      fogOfWar: !!config.fogOfWar,
      ended: [],
      rt: space.time === 'continuous' ? { clock: 0, passed: [], initiative: 0, idleTicks: 0, standoff: false } : null,
    },
  };
  const settled = settle(state);
  // On a clock, who is on move first is whoever has a decision at t=0.
  return space.time === 'continuous' ? advanceClock(settled) : settled;
}

// ── Legal actions ────────────────────────────────────────────────────────────
// Never depends on whose turn it is: the we-go resolver re-checks every queued
// order against getLegalActions at the moment it completes, whoever is "active".

export function getLegalActions(state, playerId) {
  if (getResult(state)) return [];
  const contTime = isContinuousTime(state);
  const actions = [];
  for (const u of state.units) {
    if (!u.alive || u.ownerId !== playerId) continue;
    if (contTime && u.task) continue;                       // busy: orders only when idle
    for (const d of destinations(state, u)) {
      actions.push({ type: 'move', unitId: u.id, from: { ...u.position }, to: d.to, ...(d.path.length > 2 ? { path: d.path } : {}) });
    }
    if (contTime || u.perTurn.attacksLeft > 0) {
      for (const t of state.units) if (canStrike(state, u, t)) actions.push({ type: 'attack', unitId: u.id, targetId: t.id });
    }
    if (contTime) {
      for (const duration of [0.25, 1]) actions.push(waitAction(u.id, duration));
    }
  }
  // Discrete time: end your turn. Continuous time: let the clock run (pass).
  actions.push({ type: 'end-turn', unitId: '__player__' });
  return actions;
}

export const waitAction = (unitId, duration) => ({ type: 'wait', unitId, duration });

/**
 * Orders outside the enumerated list that are still legal: a continuous-space
 * move to any reachable point (a clicked spot), and a wait of any length
 * (continuous time takes any typed duration, never a menu of presets).
 */
export function isActionLegal(state, playerId, action) {
  const u = state.units.find(x => x.id === action?.unitId);
  if (!u?.alive || u.ownerId !== playerId || getResult(state)) return false;
  const contTime = isContinuousTime(state);
  if (contTime && u.task) return false;
  if (action.type === 'wait') {
    return contTime && Number.isFinite(action.duration) && action.duration >= MIN_WAIT && action.duration <= MAX_WAIT;
  }
  if (action.type === 'move' && st(state).space === 'continuous') {
    const p = action.to;
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    if (Math.hypot(p.x - u.position.x, p.y - u.position.y) < EPS) return false;
    return continuousMoveCost(state, u, p) <= reach(state, u) + EPS;
  }
  return false;
}

// ── Applying actions ─────────────────────────────────────────────────────────

const replaceUnit = (state, u) => ({ ...state, units: state.units.map(x => (x.id === u.id ? u : x)) });

/** Cost of a move action from where its unit stands (Infinity if it can't be made). */
// The route is always worked out afresh from the position — an action's `path`
// is there for drawing, never trusted.
function moveCost(state, u, action) {
  if (st(state).space === 'continuous') return continuousMoveCost(state, u, action.to);
  const path = discreteRoute(state, u, action.to);
  return path ? pathCost(state, path) : Infinity;
}

const discreteRoute = (state, u, to) =>
  destinations(state, u).find(d => d.to.x === to.x && d.to.y === to.y)?.path ?? null;

function routeOf(state, u, action) {
  if (st(state).space === 'continuous') return [u.position, action.to];
  return discreteRoute(state, u, action.to) ?? [u.position, action.to];
}

function dealDamage(state, hits) {
  let units = state.units;
  for (const { targetId, amount } of hits) {
    units = units.map(u => {
      if (u.id !== targetId || !u.alive) return u;
      const hp = Math.max(0, u.hp - amount);
      return hp > 0 ? { ...u, hp } : { ...u, hp: 0, alive: false, task: null };
    });
  }
  return { ...state, units, gameSpecific: { ...state.gameSpecific, alive: aliveCounts(state.players, units) } };
}

// Discrete time ─────────────────────────────────────────────────────────────

function applyDiscrete(state, playerId, action) {
  const u = state.units.find(x => x.id === action.unitId);
  if (action.type === 'end-turn') return endTurn(state, playerId);
  if (!u?.alive) return state;
  if (action.type === 'move') {
    const cost = moveCost(state, u, action);
    if (!(cost <= u.perTurn.moveLeft + EPS)) return state;
    // One move a turn: what it didn't spend is gone (a budget that could be spent
    // in slivers would let a unit edge about a continuous board for ever).
    return replaceUnit(state, { ...u, position: { x: action.to.x, y: action.to.y }, perTurn: { ...u.perTurn, moveLeft: 0 } });
  }
  if (action.type === 'attack') {
    const t = state.units.find(x => x.id === action.targetId);
    if (!(u.perTurn.attacksLeft > 0) || !canStrike(state, u, t)) return state;
    const next = replaceUnit(state, { ...u, perTurn: { ...u.perTurn, attacksLeft: u.perTurn.attacksLeft - 1 } });
    return dealDamage(next, [{ targetId: t.id, amount: strikeDamage(state, u, t) }]);
  }
  return state;
}

// A seat ends its turn; the next seat that hasn't (and still has an army) is up.
// Once every seat has ended, a new turn begins for all of them — the same rule
// whether the seats took turns (sequential) or planned together (we-go), and
// whatever order the we-go resolver plays their end-turns in.
function endTurn(state, playerId) {
  const gs = state.gameSpecific;
  const ended = gs.ended.includes(playerId) ? gs.ended : [...gs.ended, playerId];
  const ids = seatIds(state);
  const standing = ids.filter(id => (gs.alive[id] ?? 0) > 0);
  const i = ids.indexOf(playerId);
  const order = [...ids.slice(i + 1), ...ids.slice(0, i + 1)];
  const next = order.find(id => standing.includes(id) && !ended.includes(id));
  if (next) return { ...state, activePlayers: [next], gameSpecific: { ...gs, ended } };
  return {
    ...state,
    turnNumber: state.turnNumber + 1,
    activePlayers: [standing[0] ?? ids[0]],
    units: state.units.map(u => (u.alive ? { ...u, perTurn: freshPerTurn(u) } : u)),
    gameSpecific: { ...gs, ended: [] },
  };
}

// Continuous time ───────────────────────────────────────────────────────────

const rtOf = (state) => state.gameSpecific.rt;
const withRt = (state, patch) => ({ ...state, gameSpecific: { ...state.gameSpecific, rt: { ...rtOf(state), ...patch } } });

/** Time (in windows) an order takes. Also the engine's getActionDuration. */
export function getActionDuration(state, action) {
  const u = state.units.find(x => x.id === action.unitId);
  if (!u) return 0;
  if (action.type === 'move') {
    const cost = st(state).space === 'continuous'
      ? segmentCost(state.board, u.position.x, u.position.y, action.to.x, action.to.y)
      : pathCost(state, routeOf(state, u, action));
    return Number.isFinite(cost) && u.stats.speed > 0 ? (cost / u.stats.speed) * TURN_DURATION : 0;
  }
  if (action.type === 'attack') return (ATTACK_TIME * TURN_DURATION) / Math.max(u.stats.rate, EPS);
  if (action.type === 'wait') return action.duration;
  return 0;
}

// The timed journey of a move: [{x, y, t}] waypoints. In discrete space each
// cell of the path is reached when its share of the cost has been paid; in
// continuous space the waypoints are where the segment crosses cell borders, so
// the unit crosses each cell at that cell's own pace.
function legsOf(state, u, action, t0) {
  const speed = u.stats.speed;
  if (st(state).space === 'discrete') {
    const path = routeOf(state, u, action);
    let t = t0;
    return path.map((c, i) => {
      if (i > 0) t += (terrainAt(state.board, c.x, c.y).cost / speed) * TURN_DURATION;
      return { x: c.x, y: c.y, t };
    });
  }
  const { x: x0, y: y0 } = u.position, { x: x1, y: y1 } = action.to;
  const total = Math.hypot(x1 - x0, y1 - y0);
  const legs = [{ x: x0, y: y0, t: t0 }];
  let along = 0, t = t0;
  for (const { cx, cy, len } of segmentCells(x0, y0, x1, y1)) {
    along += len;
    t += ((len * terrainAt(state.board, cx, cy).cost) / speed) * TURN_DURATION;
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
  if (st(state).space === 'discrete' || !b) return { x: a.x, y: a.y };
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
    if (!(moveCost(state, u, action) <= u.stats.speed + EPS)) return state;
    const legs = legsOf(state, u, action, clock);
    const until = legs[legs.length - 1].t;
    if (!(until > clock + EPS)) return state;
    return replaceUnit(state, { ...u, task: { type: 'move', to: { ...action.to }, legs, from: { ...u.position }, start: clock, until } });
  }
  if (action.type === 'attack') {
    const t = state.units.find(x => x.id === action.targetId);
    if (!canStrike(state, u, t)) return state;
    return replaceUnit(state, { ...u, task: { type: 'attack', targetId: t.id, start: clock, until: clock + getActionDuration(state, action) } });
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

// Run the clock forward until some seat has a decision (or the game is over):
// to the next task completion, resolving everything that completes then; or,
// if nothing is in progress and every seat has passed, by an idle tick.
function advanceClock(state) {
  for (let guard = 0; guard < 10000; guard++) {
    if (getResult(state)) return { ...state, activePlayers: [] };
    const ds = deciders(state);
    if (ds.length) return { ...state, activePlayers: onMove(state, ds) };
    const rt = rtOf(state);
    const busy = state.units.filter(u => u.alive && u.task);
    if (!busy.length) {
      const idleTicks = rt.idleTicks + 1;
      state = withRt(state, { clock: rt.clock + IDLE_TICK, passed: [], initiative: rt.initiative + 1, idleTicks, standoff: idleTicks >= MAX_IDLE_TICKS });
      state = { ...state, turnNumber: turnAt(rtOf(state).clock) };
      continue;
    }
    const t = Math.min(...busy.map(u => u.task.until));
    state = resolveInstant(state, t);
  }
  return state;
}

const turnAt = (clock) => Math.floor(clock / TURN_DURATION + EPS) + 1;

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
  for (const u of next.units) {
    if (!u.alive || !done(u) || u.task.type !== 'attack') continue;
    const target = next.units.find(x => x.id === u.task.targetId);
    if (canStrike(next, u, target)) hits.push({ targetId: target.id, amount: strikeDamage(next, u, target) });
  }
  units = next.units.map(u => (done(u) ? { ...u, task: null } : u));
  next = dealDamage({ ...next, units }, hits);
  const rt = rtOf(next);
  next = withRt(next, { clock: t, passed: [], initiative: rt.initiative + 1, idleTicks: 0 });
  return { ...next, turnNumber: turnAt(t) };
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

export function applyActions(state, playerActions) {
  if (isContinuousTime(state)) return { ...applyContinuous(state, playerActions), lastActions: playerActions };
  let next = state;
  for (const { playerId, action } of playerActions) next = applyDiscrete(next, playerId, action);
  return { ...next, lastActions: playerActions };
}

// ── Result ───────────────────────────────────────────────────────────────────
// Reads the common-knowledge survivor counts, never `units`: under fog the
// observation a seat is handed has hidden enemies stripped out of `units`, and
// counting those would declare a phantom win.

export function getResult(state) {
  const alive = state.gameSpecific.alive;
  const standing = seatIds(state).filter(id => (alive[id] ?? 0) > 0);
  if (standing.length === 1) return { outcome: 'win', winnerId: standing[0], reason: 'elimination' };
  if (standing.length === 0) return { outcome: 'draw', winnerId: null, reason: 'mutual-destruction' };
  if (state.gameSpecific.rt?.standoff) return { outcome: 'draw', winnerId: null, reason: 'standoff' };
  return null;
}

// ── Fog ──────────────────────────────────────────────────────────────────────

export function getVisibleState(state, playerId) {
  if (!state.gameSpecific.fogOfWar) return state;
  return { ...state, units: state.units.filter(u => !u.alive || u.ownerId === playerId || seenBy(state, playerId, u)) };
}

// ── Rendering ────────────────────────────────────────────────────────────────

const glyphOf = (u) => UNIT_TYPES[u.type]?.glyph ?? (u.type?.[0] ?? '?').toUpperCase();

export function renderState(state) {
  const { board } = state;
  const ids = seatIds(state);
  const at = new Map();
  for (const u of live(state)) at.set(`${Math.floor(u.position.x)},${Math.floor(u.position.y)}`, u);
  const ch = { open: '.', forest: 'f', hill: 'h', water: '~', rock: '#' };
  const rows = [];
  for (let y = 0; y < board.height; y++) {
    let row = '';
    for (let x = 0; x < board.width; x++) {
      const u = at.get(`${x},${y}`);
      row += u ? (ids.indexOf(u.ownerId) === 0 ? glyphOf(u) : glyphOf(u).toLowerCase()) : ch[board.terrain[`${x},${y}`] ?? 'open'];
    }
    rows.push(row);
  }
  const s = st(state);
  const when = s.time === 'continuous' ? `t=${rtOf(state).clock.toFixed(2)}` : `turn ${state.turnNumber}`;
  const armies = state.players.map(p =>
    `${p.name ?? p.id}: ${live(state).filter(u => u.ownerId === p.id).map(u => `${u.type}(${u.hp})`).join(' ')}`).join(' | ');
  return [`Arena ${s.space}/${s.time}/${s.play} — ${when}, ${state.activePlayers.join('+') || '—'} to move`, ...rows, armies].join('\n');
}

export function toGrid(state) {
  const { board } = state;
  const s = st(state);
  const pidIdx = Object.fromEntries(seatIds(state).map((id, i) => [id, i + 1]));
  const cells = [];
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      const t = terrainAt(board, x, y);
      cells.push({ x, y, color: t.color, terrain: { name: t.name, description: t.description } });
    }
  }
  const contTime = s.time === 'continuous';
  const clock = contTime ? rtOf(state).clock : null;
  const units = live(state).map(u => {
    const status = [];
    if (contTime && u.task) {
      const left = (u.task.until - clock).toFixed(2);
      status.push(u.task.type === 'move' ? `moving (${left} left)` : u.task.type === 'attack' ? `striking (${left})` : `waiting (${left})`);
    }
    const st0 = u.stats;
    return {
      id: u.id,
      x: u.position.x, y: u.position.y,
      owner: pidIdx[u.ownerId] ?? 0,
      hp: u.hp, maxHp: u.maxHp,
      glyph: glyphOf(u),
      unitName: `${UNIT_TYPES[u.type]?.name ?? u.type} (atk ${st0.attack} def ${st0.defense} rng ${st0.range} spd ${st0.speed})`,
      type: u.type,
      moveRange: contTime ? (u.task ? 0 : st0.speed) : (u.perTurn?.moveLeft ?? 0),
      radius: s.space === 'continuous' ? UNIT_R : undefined,
      // Where a unit is heading is something anyone can watch it do.
      queue: contTime && u.task?.type === 'move' ? [{ x: u.task.to.x, y: u.task.to.y }] : undefined,
      statusEffects: status,
    };
  });
  return {
    width: board.width, height: board.height,
    boardType: 'grid',
    spaceType: s.space,
    timeType: s.time,
    locationType: 'continuous',
    cells, units,
    ...(contTime ? { clock } : {}),
    los: { blocked: Object.entries(board.terrain).filter(([, k]) => TERRAIN[k]?.blocksSight).map(([key]) => key) },
    ui: {
      showHpBars: true,
      showFacing: false,
      moveAnimation: s.space === 'continuous' ? 'slide' : 'hop',
      simultaneousMotion: contTime,
      hideTurnTimeline: !contTime,
      gridDestinations: s.space === 'discrete',
      showUnitsLost: true,
    },
  };
}

export function actionKey(a) {
  return JSON.stringify([a.type, a.unitId ?? null, a.to ?? null, a.targetId ?? null, a.duration ?? null]);
}

// ── Definition ───────────────────────────────────────────────────────────────

export const ArenaGame = {
  name: 'Arena',
  // The quadrant this session plays in comes from config (`space`, `time`, and the
  // engine's Simultaneous Turns switch for `play`); these are the defaults.
  spacetime: { space: 'discrete', time: 'discrete', play: 'sequential' },
  kinematics,
  scenarios: [
    { id: 'skirmish', name: 'Skirmish', description: '14×10 — a river with two fords, woods, hills; five units a side', config: {} },
    { id: 'open-field', name: 'Open field', description: '12×8 of open ground — nothing but the numbers', config: { width: 12, height: 8, map: 'open' } },
    { id: 'real-time', name: 'Real-time skirmish', description: 'The skirmish on one clock, everyone ordering at once, free movement',
      config: { space: 'continuous', time: 'continuous', simultaneousTurns: true } },
  ],
  gameOptions: [
    { id: 'fogOfWar', label: 'Fog of War', description: 'Each side sees only what its units can see (vision, blocked by rock)', type: 'boolean', default: false },
    { id: 'space', label: 'Space', description: 'Discrete (units on cells) or continuous (units on exact points)', type: 'select', default: 'discrete',
      options: [{ value: 'discrete', label: 'Discrete (cells)' }, { value: 'continuous', label: 'Continuous (points)' }] },
    { id: 'time', label: 'Time', description: 'Discrete (turns of move/strike budgets) or continuous (one clock; orders take time)', type: 'select', default: 'discrete',
      options: [{ value: 'discrete', label: 'Discrete (turns)' }, { value: 'continuous', label: 'Continuous (clock)' }] },
    // Sequential vs simultaneous is the engine's Simultaneous Turns switch.
  ],
  // Arena has no evaluateState on purpose: it is played by the generic AI
  // (agents/generic), which needs none.
  uiDefaults: { cpuAgent: 'generic' },
  ui: {
    timeEntry: {
      wait: { field: 'duration', label: 'Wait for', button: 'Wait', unit: 'turns', min: MIN_WAIT, max: MAX_WAIT, step: 0.25 },
    },
  },
  // In continuous time Arena runs its own clock and decides itself who is on move
  // at each instant, several seats at once when play is simultaneous — so the
  // engine must not wrap it in its we-go planning (engine/GameEngine.js step()).
  nativelySimultaneous: (state) => isContinuousTime(state),

  // The generic unit contract (games/types.js `unitAttributes`): what every unit
  // is, in numbers — Arena's own fields — and, on a clock, what it is in the
  // middle of doing.
  unitAttributes(state, u) {
    return {
      hp: u.hp, maxHp: u.maxHp, ...u.stats,
      heading: u.task?.type === 'move' ? u.task.to : null,
      striking: u.task?.type === 'attack' ? u.task.targetId : null,
    };
  },
  unitStats: () => Object.fromEntries(Object.entries(UNIT_TYPES).map(([k, t]) =>
    [k, { hp: t.hp, attack: t.attack, defense: t.defense, range: t.range, move: t.speed, domain: 'land' }])),

  setupUnitTypes: () => Object.keys(UNIT_TYPES),
  createSetupUnit(state, { id, ownerId, type, position }) {
    if (!UNIT_TYPES[type] || !position) return null;
    const u = makeUnit(id, ownerId, type, placeForSpace(st(state).space, position));
    return { ...u, perTurn: isContinuousTime(state) ? null : freshPerTurn(u) };
  },
  applyStartingUnits: (state) => settle(state),

  // Units from other games (engine/foreignUnits.js). The conversion factor is the
  // infantryman, except range, where it is the archer's reach.
  foreignUnits: {
    scale: { hp: 10, attack: 4, defense: 4, range: 4, move: 3 },
    profiles: () => ArenaGame.unitStats(),
    adopt: (u, s) => {
      const hp = whole(s.hp);
      const stats = { ...u.stats, attack: whole(s.attack, 0), defense: whole(s.defense, 0), range: Math.max(1, s.range), speed: s.move };
      return { ...u, hp, maxHp: hp, stats, perTurn: u.perTurn ? freshPerTurn({ stats }) : u.perTurn };
    },
    realize: (_type, s) => ({ hp: whole(s.hp), attack: whole(s.attack, 0), defense: whole(s.defense, 0), range: Math.max(1, s.range), move: s.move }),
    art: (type) => ({ glyph: UNIT_TYPES[type]?.glyph ?? type[0].toUpperCase(), name: UNIT_TYPES[type]?.name ?? type }),
  },

  // What makes a position the position it is, for the Obscuro search's information
  // sets: the units (where, how hurt, what they're doing, what's left of their
  // turn) and, on a clock, the time and who has passed. `board` is only terrain.
  identityOf: (state) => ({
    units: state.units.map(u => [u.id, u.alive, u.hp, u.position, u.perTurn, u.task]),
    ended: state.gameSpecific.ended,
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
};
