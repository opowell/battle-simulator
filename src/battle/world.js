// ---------------------------------------------------------------------------
// world.js — what every rule of a BattleGame asks of a state: which ruleset it
// is played under, where a unit stands, how far apart two units are, what a
// unit's numbers are right now, and who can see whom.
//
// The ruleset travels with the state: `state.gameSpecific.rules` is the spec
// (spec.js) a session was started with, or absent for the game's own default
// spec. Compiled lookups are cached per spec object, so this is cheap to ask on
// every call. Hooks (`{ fn }`) can't travel in a state, so each BattleGame
// registers its own under its name (state.gameName).
// ---------------------------------------------------------------------------

import { boardOf, costFor, passableFor, EPS } from './board.js';
import { formula, whole, rat, R as Q } from './exact.js';
import { STAT_KEYS } from './spec.js';

export { EPS, costFor, passableFor };

const games = new Map();         // gameName → { base (resolved spec), hooks }

/** Make `name` a BattleGame: its default spec and the hooks its specs may name. */
export function registerBattleGame(name, base, hooks = {}) {
  games.set(name, { base, hooks });
}

const compiled = new WeakMap();  // resolved spec → (hooks → rules)

/** The compiled ruleset of `state`. */
export function rulesOf(state) {
  const g = games.get(state.gameName) ?? games.values().next().value;
  return compile(state.gameSpecific?.rules ?? g.base, g.hooks);
}

/** A resolved spec compiled into the lookups the rules use. */
export function compile(spec, hooks = {}) {
  let byHooks = compiled.get(spec);
  if (!byHooks) { byHooks = new WeakMap(); compiled.set(spec, byHooks); }
  let r = byHooks.get(hooks);
  if (r) return r;
  const attrs = spec.attributes ?? {};
  const kinds = (k) => Object.entries(attrs).filter(([, a]) => a.kind === k).map(([id]) => id);
  const types = spec.unitTypes ?? {};
  const dmg = spec.formulas?.damage;
  const orientation = !!spec.orientation || Object.values(types).some(t => t.facing);
  r = {
    spec, hooks,
    terrain: spec.terrain,
    types,
    attrs,
    abilities: spec.abilities ?? {},
    numbers: kinds('number'),
    pools: kinds('pool'),
    statusIds: kinds('status'),
    tagIds: kinds('tag'),
    damage: typeof dmg === 'string' ? formula(dmg) : (env) => rat(callHook(hooks, dmg, env)),
    victory: spec.victory ?? [{ type: 'eliminate' }],
    orientation,
    stacking: spec.board?.stacking ?? (spec.board?.topology === 'regions' ? 'stack' : 'one'),
    // Action points (`turn: { actionPoints, move }`): a unit's turn is that many
    // points, a move costs `move` of them and an ability its `ap`.
    actionPoints: spec.turn?.actionPoints ?? null,
    moveAp: spec.turn?.move ?? 1,
    // Anything that happens at a window's end beyond fresh budgets: pools that
    // regenerate, statuses that run out or tick, cooldowns, objectives counted
    // in windows.
    periodic: kinds('status').length > 0 || kinds('pool').some(id => (attrs[id].regen ?? 0) !== 0 || Object.values(types).some(t => t.pools?.[id]?.regen))
      || Object.values(spec.abilities ?? {}).some(a => a.cooldown > 0)
      || Object.values(types).some(t => t.strike?.cooldown > 0) || spec.strike?.cooldown > 0
      || (spec.victory ?? []).some(v => ['hold', 'survive', 'points'].includes(v.type) || v.fn),
  };
  byHooks.set(hooks, r);
  return r;
}

export function callHook(hooks, ref, ...args) {
  const f = hooks?.[ref?.fn];
  if (typeof f !== 'function') throw new Error(`battle: no hook "${ref?.fn}"`);
  return f(...args, ref);
}

// ── Where things are ─────────────────────────────────────────────────────────

export const st = (state) => state.gameSpecific.spacetime;
export const isContinuousTime = (state) => st(state).time === 'continuous';
export const isContinuousSpace = (state) => st(state).space === 'continuous';
export const live = (state) => state.units.filter(u => u.alive);
export const seatIds = (state) => state.players.map(p => p.id);
export const boardIn = (state) => boardOf(state.board, rulesOf(state).terrain);

/** The point a unit occupies, for geometry: a cell's centre in discrete space. */
export function pointOf(state, u) {
  const p = u.position;
  return isContinuousSpace(state) ? { x: p.x, y: p.y } : boardIn(state).centre(p);
}

/** Distance between two positions in the active space's metric. */
export function gapBetween(state, a, b) {
  if (isContinuousSpace(state)) return Math.hypot(a.x - b.x, a.y - b.y);
  return boardIn(state).dist(a, b);
}
export const gap = (state, u, v) => gapBetween(state, u.position, v.position);

/** The terrain a unit stands in. */
export function terrainOfUnit(state, u) {
  const B = boardIn(state);
  if (isContinuousSpace(state)) return B.terrainUnder(u.position.x, u.position.y);
  return B.terrainAt(u.position.x, u.position.y);
}
export const elevationOf = (state, u) => { const B = boardIn(state); return B.elevated ? B.elevAt(u.position) : 0; };

// ── A unit's numbers ─────────────────────────────────────────────────────────

/** Its type's entry in the ruleset (a unit of an unknown type reads as the first type). */
export function typeOf(state, u) {
  const types = rulesOf(state).types;
  return types[u.type] ?? Object.values(types)[0];
}

/** Its movement class. */
export const domainOf = (state, u) => u.domain ?? typeOf(state, u).domain ?? 'land';

/** The statuses on it now: [{ id, left, stacks }]. */
export const statusesOf = (u) => u.statuses ?? [];

/**
 * A stat or declared number as it is right now: its own value, then every active
 * status's modifier in the order they were applied. Modifiers are exact
 * ('*3/2', '+2', '-1', '=0') and the result is floored to a whole number.
 */
export function stat(state, u, k) {
  const base = u.stats?.[k] ?? u.attrs?.[k] ?? (STAT_KEYS.includes(k) ? 0 : rulesOf(state).attrs[k]?.default ?? 0);
  const ss = statusesOf(u);
  if (!ss.length) return base;
  const attrs = rulesOf(state).attrs;
  let v = rat(base), touched = false;
  for (const s of ss) {
    const mods = [attrs[s.id]?.mods, s.mods].filter(Boolean);
    for (const m of mods) {
      if (m[k] == null) continue;
      for (let i = 0; i < (s.stacks ?? 1); i++) v = applyMod(v, m[k]);
      touched = true;
    }
  }
  return touched ? Math.max(0, whole(v)) : base;
}

function applyMod(v, mod) {
  const m = /^\s*([*+\-=])\s*(-?\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?\s*$/.exec(String(mod));
  if (!m) throw new Error(`battle: modifier "${mod}" is not one of *x +x -x =x`);
  const x = m[3] ? Q.div(decimal(m[2]), decimal(m[3])) : decimal(m[2]);
  return m[1] === '*' ? Q.mul(v, x) : m[1] === '+' ? Q.add(v, x) : m[1] === '-' ? Q.sub(v, x) : x;
}
const decimal = (s) => { const [i, f = ''] = s.replace('-', '').split('.'); const r = { n: BigInt(i + f) * (s.startsWith('-') ? -1n : 1n), d: 10n ** BigInt(f.length) }; return Q.div(r, { n: 1n, d: 1n }); };

/** Its tags: its type's, its domain, and whatever its statuses grant. */
export function tagsOf(state, u) {
  const t = typeOf(state, u);
  const out = new Set([...(t.tags ?? []), ...(u.tags ?? []), domainOf(state, u)]);
  const attrs = rulesOf(state).attrs;
  for (const s of statusesOf(u)) {
    out.add(s.id);
    for (const g of attrs[s.id]?.tags ?? []) out.add(g);
  }
  return out;
}
export const hasTag = (state, u, tag) => tagsOf(state, u).has(tag);

/** Does the unit match a target filter: 'tag', { tag }, { not }, { any: [] }, { all: [] }? */
export function matches(state, u, f) {
  if (f == null) return true;
  if (typeof f === 'string') return hasTag(state, u, f);
  if (Array.isArray(f)) return f.every(x => matches(state, u, x));
  if (f.tag != null) return hasTag(state, u, f.tag);
  if (f.not != null) return !matches(state, u, f.not);
  if (f.any) return f.any.some(x => matches(state, u, x));
  if (f.all) return f.all.every(x => matches(state, u, x));
  if (f.type != null) return u.type === f.type;
  return true;
}

/** Is a status of this kind stopping the unit from doing `what` ('move' | 'act')? */
export function blocked(state, u, what) {
  const attrs = rulesOf(state).attrs;
  return statusesOf(u).some(s => (attrs[s.id]?.blocks ?? []).includes(what));
}

/** Members of a counted group (stacking 'count'): one for any other unit. */
export const membersOf = (u) => (u.memberHp ? Math.ceil(u.hp / u.memberHp) : 1);

// ── Facing ───────────────────────────────────────────────────────────────────

/** The facing settings of a unit's type (null when it has no orientation). */
export function facingOf(state, u) {
  const r = rulesOf(state);
  if (!r.orientation || u.facing == null) return null;
  const t = typeOf(state, u).facing ?? {};
  const d = r.spec.orientation ?? {};
  return { fov: t.fov ?? d.fov ?? 360, arcs: t.arcs ?? d.arcs ?? null, turnCost: t.turnCost ?? d.turnCost ?? 1 };
}

/** Bearing in degrees from point a to point b (0 = +x, 90 = +y: screen, y down). */
export const bearing = (a, b) => ((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 360) % 360;
/** The smallest angle between two bearings, 0…180. */
export const angleBetween = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** Is the bearing from viewer to target inside the viewer's cone? */
export function inCone(state, viewer, target) {
  const f = facingOf(state, viewer);
  if (!f || f.fov >= 360) return true;
  const a = pointOf(state, viewer), b = pointOf(state, target);
  if (Math.hypot(a.x - b.x, a.y - b.y) < EPS) return true;
  return angleBetween(viewer.facing, bearing(a, boardIn(state).near?.(a, b) ?? b)) <= f.fov / 2 + 1e-6;
}

/** Which side of a defender a blow from `from` lands on: 'front' | 'flank' | 'rear'. */
export function arcOf(state, defender, from) {
  if (defender.facing == null) return 'front';
  const a = pointOf(state, defender), b = pointOf(state, from);
  if (Math.hypot(a.x - b.x, a.y - b.y) < EPS) return 'front';
  const d = angleBetween(defender.facing, bearing(a, boardIn(state).near?.(a, b) ?? b));
  return d <= 60 + 1e-6 ? 'front' : d >= 120 - 1e-6 ? 'rear' : 'flank';
}

// ── Sight ────────────────────────────────────────────────────────────────────

/** Distance within which a unit always senses another, cone or not. */
export const AWARENESS = 1;

/** Can `viewer` see `target` (range, cone, line, concealment)? Cloak is detection's business. */
export function sees(state, viewer, target) {
  const B = boardIn(state);
  const d = !isContinuousSpace(state) && B.visionDist ? B.visionDist(viewer.position, target.position) : gap(state, viewer, target);
  const vision = stat(state, viewer, 'vision');
  if (d > vision + EPS) return false;
  // Concealing ground hides a unit from anyone farther than its concealment.
  const conceal = terrainOfUnit(state, target)?.concealment;
  if (conceal != null && d > conceal + EPS && !revealed(state, target)) return false;
  if (d > AWARENESS + EPS && !inCone(state, viewer, target)) return false;
  const a = pointOf(state, viewer), b = pointOf(state, target);
  return boardIn(state).sight(a, b);
}

const revealed = (state, u) => statusesOf(u).some(s => s.id === 'revealed');

/** Is `target` cloaked and not shown up — by a reveal, or a detector of `side` that sees it? */
export function hiddenFrom(state, side, target) {
  if (target.ownerId === side || !hasTag(state, target, 'cloaked') || revealed(state, target)) return false;
  return !state.units.some(u => u.alive && u.ownerId === side && hasTag(state, u, 'detector') && sees(state, u, target));
}

/** Does any live unit of `playerId` see `target`? */
export function seenBy(state, playerId, target) {
  if (target.ownerId === playerId) return true;
  if (hiddenFrom(state, playerId, target)) return false;
  return state.units.some(u => u.alive && u.ownerId === playerId && sees(state, u, target));
}

// ── Damage ───────────────────────────────────────────────────────────────────

/**
 * The battle's dice while an action is applied: BattleGame.applyActions sets
 * `rng` to the engine's seeded one for the length of the call, and everything
 * that throws a die — a strike's `hit` roll, `roll()` in a formula — draws from
 * it, so a replay throws the same. Null outside an action: a formula with a die
 * in it can't be evaluated then (a preview, the AI's estimate) — see chanceOf.
 */
export const dice = { rng: null };

const coverOf = (state, u) => terrainOfUnit(state, u)?.cover ?? 0;

/**
 * What a formula about `a` striking `d` may read: both sides' numbers, the
 * blow's `power`, the defender's `cover`, `height` (attacker's ground over the
 * defender's), `arc` (the defense modifier for the side it's struck on) and
 * `dist` (how far apart they are, in the board's own measure).
 */
export function strikeEnv(state, a, d, power = 1) {
  const arcs = facingOf(state, d)?.arcs;
  return {
    a: attrsEnv(state, a), d: attrsEnv(state, d),
    power, cover: coverOf(state, d),
    height: elevationOf(state, a) - elevationOf(state, d),
    arc: arcs ? arcs[arcOf(state, d, a)] ?? 0 : 0,
    dist: gap(state, a, d),
  };
}

/** The formula environment for a unit: its stats, numbers, pools and hit points. */
export function attrsEnv(state, u) {
  const env = { hp: u.hp, maxHp: u.maxHp, count: membersOf(u) };
  for (const k of STAT_KEYS) env[k] = stat(state, u, k);
  for (const k of rulesOf(state).numbers) env[k] = stat(state, u, k);
  for (const [k, p] of Object.entries(u.pools ?? {})) { env[k] = p.value; env[`${k}Max`] = p.max; }
  return env;
}

/**
 * The damage one blow of `a` deals to `d` where `d` stands now, with `power`
 * (the ability's; 1 for a plain attack) and its damage `type`. Always a whole
 * number ≥ 0.
 */
export function strikeDamage(state, a, d, { power = 1, type = null, formula: own = null } = {}) {
  const r = rulesOf(state);
  const env = strikeEnv(state, a, d, power);
  const f = own ? (typeof own === 'string' ? formula(own) : (e) => rat(callHook(r.hooks, own, e, state, a, d))) : r.damage;
  let dmg = whole(f(env, dice.rng));
  if (type) {
    const resist = typeOf(state, d).resist?.[type] ?? 0;
    if (resist) dmg = Math.max(0, whole(Q.mul(rat(dmg), Q.div(rat(100 - resist), rat(100)))));
  }
  const n = membersOf(a);
  return n > 1 ? dmg * n : dmg;
}

/** The common-knowledge survivor count of each seat. */
export const aliveCounts = (players, units) =>
  Object.fromEntries(players.map(p => [p.id, units.filter(u => u.alive && u.ownerId === p.id).length]));
