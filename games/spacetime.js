// spacetime.js — one movement spec, four worlds.
//
// A game normally hard-codes how far a unit moves and how a turn is structured.
// This module lets a game declare that ONCE, as a single "kinematics" spec, and
// then be played in any of the four quadrants of the (space × time) plane, with
// either simultaneous or sequential play — without the game re-deriving movement
// rules per mode. The engine picks the quadrant from config; the game asks this
// module how movement behaves there.
//
// The single spec quantity is a unit's SPEED: the distance it covers in one full
// turn window at 1× (csmini's "move range 3", civ1's unit `moves`). Everything
// else in each quadrant is derived from that one number:
//
//                        DISCRETE TIME                  CONTINUOUS TIME
//                 (a turn = one action window)     (a global clock; actions
//                                                   take real time to finish)
//   ┌───────────────────────────────────────────────────────────────────────┐
//   │ DISCRETE   destinations are grid cells;    destinations are grid cells; │
//   │ SPACE      a unit may move up to `speed`   a step is instantaneous but  │
//   │            cells this turn (double speed   is followed by a cooldown =  │
//   │            → twice as far). civ animates   stepDist/speed before the    │
//   │            the slide, chess teleports —    unit may move again (double  │
//   │            a rendering choice, not a rule. speed → half the cooldown).  │
//   ├───────────────────────────────────────────────────────────────────────┤
//   │ CONTINUOUS destinations are any point      units slide along their path;│
//   │ SPACE      within `speed` of the unit;     arrival = dist/speed later   │
//   │            the move is instantaneous       (double speed → twice as     │
//   │            (double speed → double range).  quickly). Exact paths honored.│
//   └───────────────────────────────────────────────────────────────────────┘
//
// A game supplies the spec (see the `Kinematics` typedef below) plus the small
// set of world primitives that ARE inherently game-specific — what a cell's
// neighbours/costs are, whether a continuous point is walkable, occupancy — and
// this module handles the quadrant-dependent parts: coordinate transforms,
// per-turn budget vs. per-action duration, and destination enumeration.
//
// Coordinate transforms have sensible defaults (tile centre ↔ floor) that a game
// may override in its spec (e.g. a hex game, or a game whose tile origin isn't a
// corner).

import { movePointLattice } from './continuousMove.js';

/**
 * @typedef {'discrete'|'continuous'} SpaceType
 * @typedef {'discrete'|'continuous'} TimeType
 * @typedef {'sequential'|'simultaneous'} PlayType
 */

/**
 * @typedef {Object} Kinematics  A game's single movement specification.
 *
 * @property {number} [turnDuration]
 *   Length of one turn window in the game's own time units (continuous time
 *   only — how long a full turn's worth of actions has to fit). Default 1.
 *
 * @property {(unit: object, state: object) => number} speed
 *   THE single spec number: distance a unit covers in one full turn window at
 *   1×. Interpreted per-quadrant (see the table above). Distance is measured in
 *   whatever units the game's positions use (grid cells for discrete space).
 *
 * @property {(pos: {x:number,y:number}, unit: object, state: object) => {to:{x:number,y:number}, cost:number}[]} [neighbors]
 *   DISCRETE space only. The movement graph: legal one-step moves out of `pos`
 *   for `unit`, each with its movement-point `cost`. Occupancy/terrain/bounds
 *   are the game's call. Required to enumerate discrete destinations.
 *
 * @property {(x: number, y: number, unit: object, state: object) => boolean} [walkable]
 *   CONTINUOUS space only. Is the exact point (x,y) a legal place to stand?
 *
 * @property {(x0: number, y0: number, x1: number, y1: number, unit: object, state: object) => boolean} [pathClear]
 *   CONTINUOUS space only. Is the straight segment (x0,y0)→(x1,y1) unobstructed?
 *   Defaults to always-clear when omitted.
 *
 * @property {(x: number, y: number, unit: object, state: object) => boolean} [occupied]
 *   CONTINUOUS space only. Is (x,y) too close to another unit to stand on?
 *   Defaults to never-occupied when omitted.
 *
 * @property {(tile: {x:number,y:number}) => {x:number,y:number}} [toContinuous]
 *   Map a discrete tile to its continuous position. Default: tile centre.
 *
 * @property {(point: {x:number,y:number}) => {x:number,y:number}} [toDiscrete]
 *   Map a continuous point to its containing tile. Default: component-wise floor.
 *
 * @property {number} [rings] @property {number} [spokes]
 *   CONTINUOUS space destination-lattice resolution (see continuousMove.js).
 */

/**
 * @typedef {Object} SpaceTime  A resolved quadrant + play mode.
 * @property {SpaceType} space
 * @property {TimeType}  time
 * @property {PlayType}  play
 * @property {number}    turnDuration
 */

// ── Config resolution ─────────────────────────────────────────────────────────

const SPACE = new Set(['discrete', 'continuous']);
const TIME = new Set(['discrete', 'continuous']);
const PLAY = new Set(['sequential', 'simultaneous']);

/**
 * Resolve the active quadrant + play mode from a config object, falling back to
 * the game's declared defaults (`game.spacetime`) and then to sequential
 * discrete/discrete. Accepts both the new unified fields (`space`/`time`/`play`)
 * and the engine's historical aliases (`timeType`, `simultaneousTurns`) so old
 * call sites keep working.
 *
 * @param {object} game    The game definition (may carry `spacetime` + `kinematics`).
 * @param {object} [config] Engine/session config.
 * @returns {SpaceTime}
 */
export function resolveSpaceTime(game = {}, config = {}) {
  const d = game.spacetime ?? {};

  const space = pick(config.space, d.space, 'discrete', SPACE, 'space');

  const time = pick(
    config.time ?? config.timeType,
    d.time ?? d.timeType,
    'discrete', TIME, 'time',
  );

  // `simultaneousTurns: true` is the old boolean spelling of `play: 'simultaneous'`.
  const playDefault = d.play ?? (d.simultaneousTurns ? 'simultaneous' : 'sequential');
  const play = pick(
    config.play ?? (config.simultaneousTurns ? 'simultaneous' : undefined),
    playDefault, 'sequential', PLAY, 'play',
  );

  const turnDuration = config.turnDuration
    ?? game.kinematics?.turnDuration
    ?? d.turnDuration
    ?? 1;

  return { space, time, play, turnDuration };
}

function pick(configVal, defaultVal, fallback, allowed, label) {
  const v = configVal ?? defaultVal ?? fallback;
  if (!allowed.has(v)) {
    throw new Error(`spacetime: invalid ${label} "${v}" (expected ${[...allowed].join(' | ')})`);
  }
  return v;
}

// ── Coordinate transforms ─────────────────────────────────────────────────────

/** Default discrete→continuous: the tile's centre point. */
export const defaultToContinuous = (t) => ({ x: t.x + 0.5, y: t.y + 0.5 });
/** Default continuous→discrete: the containing tile (component-wise floor). */
export const defaultToDiscrete = (p) => ({ x: Math.floor(p.x), y: Math.floor(p.y) });

/** The discrete→continuous transform for a game (spec override or default). */
export const toContinuous = (kin, tile) => (kin.toContinuous ?? defaultToContinuous)(tile);
/** The continuous→discrete transform for a game (spec override or default). */
export const toDiscrete = (kin, point) => (kin.toDiscrete ?? defaultToDiscrete)(point);

// ── Time derivation (the one number, two ways) ────────────────────────────────

/**
 * DISCRETE time: how far `unit` may travel in one turn window — its full speed.
 * (Double speed → twice as far / double the range.)
 */
export function moveBudget(kin, unit, state) {
  return kin.speed(unit, state);
}

/**
 * CONTINUOUS time: real time for `unit` to traverse `dist`. Also the cooldown
 * after a discrete step of length `dist`. A full-turn-range move (dist == speed)
 * costs exactly one turn window, so double speed → half the time. Returns
 * Infinity for a stationary (speed 0) unit.
 */
export function travelTime(kin, unit, state, st, dist) {
  const s = kin.speed(unit, state);
  if (!(s > 0)) return Infinity;
  return (st.turnDuration * dist) / s;
}

/**
 * Duration to charge an action in continuous time. Movement uses `travelTime`
 * over the distance actually covered; every other action defaults to one
 * "tick" (turnDuration / speedRef) unless the game overrides via
 * `game.getActionDuration`. Kept simple on purpose — games with richer action
 * timing implement getActionDuration directly.
 */
export function moveDuration(kin, unit, state, st, from, to) {
  return travelTime(kin, unit, state, st, distance(from, to));
}

// ── Destination enumeration ───────────────────────────────────────────────────

/**
 * All legal move destinations for `unit` in the active quadrant, each as
 * `{ to, cost, path }` where `path` is the sequence of positions to follow
 * (grid cells for discrete space; [from, to] for a continuous slide).
 *
 * `budget` is the distance the unit may spend on THIS enumeration:
 *   • discrete time  → the full per-turn move budget (moveBudget), or whatever
 *     the unit has left this turn.
 *   • continuous time, discrete space → one step (pass the max single-step
 *     cost, or Infinity to offer every reachable cell and let the cooldown pace
 *     it); the engine charges the cooldown per step.
 *   • continuous time, continuous space → the reach you want to offer as slide
 *     targets (commonly `moveBudget`, i.e. a turn-window's worth of travel).
 *
 * @param {Kinematics} kin
 * @param {object} unit
 * @param {object} state
 * @param {SpaceTime} st
 * @param {number} budget
 * @returns {{to:{x:number,y:number}, cost:number, path:{x:number,y:number}[]}[]}
 */
export function enumerateDestinations(kin, unit, state, st, budget) {
  return st.space === 'continuous'
    ? continuousDestinations(kin, unit, state, st, budget)
    : discreteDestinations(kin, unit, state, budget);
}

// Dijkstra over the game's neighbour graph, collecting every cell reachable
// within `budget` movement points, cheapest path to each.
function discreteDestinations(kin, unit, state, budget) {
  if (!kin.neighbors) throw new Error('spacetime: discrete space needs kinematics.neighbors');
  const key = (p) => `${p.x},${p.y}`;
  const start = unit.position;
  const best = new Map([[key(start), { spent: 0, path: [start] }]]);
  // Max-remaining-budget frontier so a cell is settled by its cheapest route.
  const queue = [{ pos: start, spent: 0, path: [start] }];

  const out = [];
  const seen = new Set([key(start)]);
  while (queue.length) {
    queue.sort((a, b) => a.spent - b.spent);
    const { pos, spent, path } = queue.shift();
    for (const { to, cost } of kin.neighbors(pos, unit, state)) {
      const nspent = spent + cost;
      if (nspent > budget) continue;
      const k = key(to);
      const prev = best.get(k);
      if (prev && prev.spent <= nspent) continue;
      const npath = [...path, to];
      best.set(k, { spent: nspent, path: npath });
      queue.push({ pos: to, spent: nspent, path: npath });
      if (!seen.has(k)) { seen.add(k); }
    }
  }
  best.delete(key(start));
  for (const [, { spent, path }] of best) out.push({ to: path[path.length - 1], cost: spent, path });
  return out;
}

// A polar lattice of exact points within `budget` of the unit, filtered by the
// game's continuous walkability / path / occupancy. Reuses the same generator
// the fog-search AI uses, so human clicks and AI candidates share resolution.
function continuousDestinations(kin, unit, state, st, budget) {
  const ox = num(unit.position.x), oy = num(unit.position.y);
  const walkable = kin.walkable ?? (() => true);
  const pathClear = kin.pathClear ?? (() => true);
  const occupied = kin.occupied ?? (() => false);
  const pts = movePointLattice(
    ox, oy, budget,
    (x, y) => walkable(x, y, unit, state)
      && pathClear(ox, oy, x, y, unit, state)
      && !occupied(x, y, unit, state),
    kin.rings ?? 2, kin.spokes ?? 8,
  );
  return pts.map((p) => ({
    to: p,
    cost: Math.hypot(p.x - ox, p.y - oy),
    path: [{ x: ox, y: oy }, p],
  }));
}

// ── Slide interpolation (continuous space + continuous time) ──────────────────

/**
 * Position of a unit that departed `from` toward `to` at `startTime`, sampled at
 * clock time `now`. Before arrival it is the exact interpolated point along the
 * straight path; at/after arrival it is `to`. Arrival time is
 * `startTime + travelTime(dist)`.
 */
export function slidePosition(kin, unit, state, st, from, to, startTime, now) {
  const dist = distance(from, to);
  const dur = travelTime(kin, unit, state, st, dist);
  if (!(dur > 0) || now >= startTime + dur) return { x: num(to.x), y: num(to.y) };
  const frac = Math.max(0, (now - startTime) / dur);
  return {
    x: num(from.x) + (num(to.x) - num(from.x)) * frac,
    y: num(from.y) + (num(to.y) - num(from.y)) * frac,
  };
}

// ── Small shared helpers ──────────────────────────────────────────────────────

// Plain-number view of a coordinate (tolerates BigNumber / string / number), so
// this module works for both integer-grid and BigNumber-continuous games without
// importing coord.js's BigNumber machinery.
export function num(v) {
  return (v != null && typeof v === 'object' && typeof v.toNumber === 'function')
    ? v.toNumber() : Number(v);
}

export function distance(a, b) {
  return Math.hypot(num(a.x) - num(b.x), num(a.y) - num(b.y));
}
