// ---------------------------------------------------------------------------
// units.js — a BattleGame unit, and the attributes a ruleset declares for it.
//
// Every unit carries the core numbers (`hp`/`maxHp` on the unit, attack, defense,
// range, speed, rate and vision in `unit.stats`), which the engine, the generic
// AI and the UI understand without being told. Anything more is declared once
// per ruleset in `spec.attributes`, by kind, and only then appears on a unit:
//
//   number   { kind: 'number', default }           unit.attrs[id]
//            carried, shown, readable in formulas (d.armor) and modifiers.
//   pool     { kind: 'pool', max, regen, start, absorbs, value }
//                                                  unit.pools[id] = { value, max }
//            a current / max that regenerates `regen` a window; abilities spend
//            it (cost: { mp: 12 }); one marked `absorbs` takes damage before hp
//            (shields). A unit type gives its own: pools: { mp: 30 } or
//            { mp: { max, regen, start } }.
//   tag      { kind: 'tag' }                       a unit type's `tags`
//            for target filters and rules. Built in: 'royal' (victory),
//            'cloaked' and 'detector' (fog), and every movement class.
//   status   { kind: 'status', turns, stack, max, mods, tick, blocks, tags,
//              harmful, value }                    unit.statuses = [{ id, left, stacks }]
//            timed in windows; `stack` says what a second dose does ('refresh'
//            the time, 'extend' it, 'stack' up to `max`, or 'ignore');
//            `mods` change numbers while it lasts ({ speed: '*3/2' }); `tick`
//            effects happen at the end of every window; `blocks` stops 'move'
//            or 'act'; `tags` are granted while it lasts. `value` tells the
//            generic AI what it is worth beyond what its mods do to the numbers.
//
// A unit only carries the fields its ruleset uses, so a battle that declares
// nothing plays exactly as Arena's numbers-only units always have.
// ---------------------------------------------------------------------------

import { rulesOf, typeOf, stat, statusesOf, aliveCounts } from './world.js';
import { STAT_KEYS } from './spec.js';

/** The pools a unit of `type` starts with: { id: { value, max } }, or null. */
function poolsFor(r, t) {
  if (!r.pools.length) return null;
  const out = {};
  for (const id of r.pools) {
    const decl = r.attrs[id];
    const own = t.pools?.[id];
    const max = typeof own === 'number' ? own : own?.max ?? decl.max;
    if (max == null) continue;
    const start = (typeof own === 'object' ? own?.start : undefined) ?? decl.start ?? 'max';
    out[id] = { value: start === 'max' ? max : start === 'empty' ? 0 : Math.min(max, start), max };
  }
  return Object.keys(out).length ? out : null;
}

function numbersFor(r, t) {
  if (!r.numbers.length) return null;
  return Object.fromEntries(r.numbers.map(id => [id, t.attrs?.[id] ?? r.attrs[id].default ?? 0]));
}

/** A pool's regeneration a window, for this unit. */
export function regenOf(state, u, id) {
  const own = typeOf(state, u).pools?.[id];
  return (typeof own === 'object' ? own?.regen : undefined) ?? rulesOf(state).attrs[id]?.regen ?? 0;
}

/**
 * A fresh unit of `type` (an unknown type is made as the ruleset's first). Its
 * numbers are the type's unless `stats` gives its own.
 */
export function makeUnit(state, { id, ownerId, type, position, stats = null, facing = null }) {
  const r = rulesOf(state);
  const preset = r.types[type] ?? Object.values(r.types)[0];
  const s = stats ?? preset;
  const u = {
    id, ownerId, type,
    position: { x: position.x, y: position.y },
    alive: true,
    hp: s.hp ?? preset.hp, maxHp: s.hp ?? preset.hp,
    stats: Object.fromEntries(STAT_KEYS.map(k => [k, s[k] ?? preset[k] ?? defaultStat(k)])),
    perTurn: null,
    task: null,
  };
  return dress(state, u, preset, facing);
}

const defaultStat = (k) => (k === 'rate' ? 1 : k === 'vision' ? 4 : k === 'range' ? 1 : 0);

// The declared extras a unit of this ruleset carries: pools, numbers, facing,
// and a counted group's member size. Only what is missing is filled in.
export function dress(state, u, preset = typeOf(state, u), facing = null) {
  const r = rulesOf(state);
  let out = u;
  const pools = u.pools ?? poolsFor(r, preset);
  if (pools && !u.pools) out = { ...out, pools };
  const attrs = numbersFor(r, preset);
  if (attrs && !u.attrs) out = { ...out, attrs };
  if (r.orientation && out.facing == null) out = { ...out, facing: facing ?? 0 };
  if (r.stacking === 'count' && !out.memberHp) {
    const n = Math.max(1, u.count ?? preset.count ?? 1);
    out = { ...out, memberHp: out.maxHp, hp: out.hp * n, maxHp: out.maxHp * n };
  }
  return out;
}

/** A unit's budgets for one turn window (discrete time). */
export function freshPerTurn(state, u) {
  const ap = rulesOf(state).actionPoints;
  const p = ap ? apBudget(state, u, ap) : { moveLeft: stat(state, u, 'speed'), attacksLeft: stat(state, u, 'rate') };
  if (rulesOf(state).orientation) p.faced = false;
  return p;
}

/**
 * A unit's budgets with `ap` action points left, where the ruleset counts them
 * (`turn.actionPoints`): every move is a fresh one of up to `speed` while a
 * move's points are left, and it may act while any are.
 */
export function apBudget(state, u, ap) {
  const r = rulesOf(state);
  return { ap, moveLeft: ap >= r.moveAp ? stat(state, u, 'speed') : 0, attacksLeft: ap > 0 ? Math.max(1, stat(state, u, 'rate')) : 0 };
}

// ── Statuses ─────────────────────────────────────────────────────────────────

/** `u` with status `id` applied for `turns` windows (its declaration's by default). */
export function addStatus(state, u, id, turns = null, extra = null) {
  const decl = rulesOf(state).attrs[id] ?? BUILT_IN[id] ?? {};
  const left = turns ?? decl.turns ?? 1;
  const ss = statusesOf(u);
  const i = ss.findIndex(s => s.id === id);
  if (i < 0) return { ...u, statuses: [...ss, { id, left, stacks: 1, ...(extra ?? {}) }] };
  const cur = ss[i];
  const how = decl.stack ?? 'refresh';
  let next = cur;
  if (how === 'refresh') next = { ...cur, left: Math.max(cur.left, left) };
  else if (how === 'extend') next = { ...cur, left: cur.left + left };
  else if (how === 'stack') next = { ...cur, left: Math.max(cur.left, left), stacks: Math.min(decl.max ?? Infinity, (cur.stacks ?? 1) + 1) };
  return { ...u, statuses: ss.map((s, j) => (j === i ? next : s)) };
}

/** `u` without the statuses `which` names (or every harmful one). */
export function removeStatuses(state, u, which = null) {
  const attrs = rulesOf(state).attrs;
  const drop = (s) => (which ? which.includes(s.id) : !!(attrs[s.id] ?? BUILT_IN[s.id])?.harmful);
  const ss = statusesOf(u).filter(s => !drop(s));
  return ss.length === statusesOf(u).length ? u : { ...u, statuses: ss };
}

/** Statuses the core gives meaning to without a declaration. */
export const BUILT_IN = {
  revealed: { kind: 'status', turns: 1, harmful: true },
  cloaked: { kind: 'status', turns: 1, tags: ['cloaked'] },
};

// ── Pools ────────────────────────────────────────────────────────────────────

export const poolValue = (u, id) => u.pools?.[id]?.value ?? 0;

/** Can `u` pay `cost` ({ pool: amount, hp: amount })? */
export const canPay = (u, cost) => Object.entries(cost ?? {}).every(([k, v]) => (k === 'hp' ? u.hp > v : poolValue(u, k) >= v));

/** `u` having paid `cost`. */
export function pay(u, cost) {
  let out = u;
  for (const [k, v] of Object.entries(cost ?? {})) {
    if (!v) continue;
    if (k === 'hp') out = { ...out, hp: out.hp - v };
    else out = { ...out, pools: { ...out.pools, [k]: { ...out.pools[k], value: out.pools[k].value - v } } };
  }
  return out;
}

/** `u` with pool `id` changed by `by`, kept between 0 and its max. */
export function adjustPool(u, id, by) {
  const p = u.pools?.[id];
  if (!p) return u;
  const value = Math.max(0, Math.min(p.max, p.value + by));
  return value === p.value ? u : { ...u, pools: { ...u.pools, [id]: { ...p, value } } };
}

/**
 * `amount` of damage taken by `u`: first by every pool marked `absorbs`
 * (shields), then by its hit points. Returns the unit, perhaps dead.
 */
export function takeDamage(state, u, amount) {
  let left = amount, out = u;
  const attrs = rulesOf(state).attrs;
  for (const [id, p] of Object.entries(u.pools ?? {})) {
    if (!attrs[id]?.absorbs || left <= 0) continue;
    const soak = Math.min(p.value, left);
    if (soak > 0) { out = adjustPool(out, id, -soak); left -= soak; }
  }
  if (left <= 0) return out;
  const hp = Math.max(0, out.hp - left);
  return hp > 0 ? { ...out, hp } : { ...out, hp: 0, alive: false, task: null };
}

/** Replace units by id and recount the survivors. */
export function withUnits(state, units) {
  return { ...state, units, gameSpecific: { ...state.gameSpecific, alive: aliveCounts(state.players, units) } };
}
