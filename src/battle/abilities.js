// ---------------------------------------------------------------------------
// abilities.js — what a unit can do to other units, as data.
//
// `attack` is just the default ability: strike one enemy within the unit's
// range for one blow of the ruleset's damage formula. Any other is declared in
// `spec.abilities` and given to unit types by id:
//
//   { id: 'fira', name, cost: { mp: 12 }, cooldown: 0, range: 4, minRange: 0,
//     targets: 'enemy' | 'ally' | 'self' | 'any' | 'ground' | 'fallen',
//     filter: { not: 'flying' }, area: { radius: 1, shape: 'radius' | 'line' },
//     aim: 'units' | 'cells', affects: 'enemy' | 'ally' | 'all',
//     los: true | false | 'missile',          // 'missile': only beyond arm's length
//     windup: 0.5,                            // continuous time: windows until it lands
//     effects: [{ damage: { power: 1.1, type: 'fire' } }, { status: { id: 'blind', turns: 2 } }] }
//
// A unit type may also reshape its own attack (`strike: { cost: { ammo: 1 } }`)
// or have none (`strike: false`). Using any ability spends one of the unit's
// strikes for the window (`rate`), plus its cost — or, where the ruleset counts
// action points (`turn.actionPoints`), its `ap` (1 unless it says; 'all' spends
// what the unit has left).
//
// Chance, where an ability asks for it (none does unless it says):
//
//   hit: 'clamp(a.aim - 4 * dist - cover, 5, 95)'   percent; a d100 is rolled
//                                                   per target, a hit when it is
//                                                   at most this
//   crit: 'floor(hit / 4)'                          percent, on the same roll
//                                                   (`hit` is the chance above)
//   critPower: 2                                    a crit's damage multiplier
//
// A target missed takes nothing from the use, damage or any other effect. The
// dice are the battle's (world.js `dice`), and a damage formula may throw more
// of them with roll(n); everything thrown is recorded on the action.
//
// `targets: 'fallen'` aims at a fallen unit of the caster's side (a revival).
// An area is every cell within its `radius` of the point aimed at, in the
// board's measure, or with `shape: 'line'` the `radius` cells running straight
// out from the caster toward it (aimed at a neighbouring cell). A ground-aimed
// ability is offered where the units it could hit stand, or with `aim: 'cells'`
// at every cell in range whose area would hit someone.
//
// The effect vocabulary is closed — damage, heal, modify, status, cleanse, move,
// spawn, transform, reveal, conceal — with `{ fn: 'name' }` as the way out: the
// named hook gets (state, { caster, target, point, ability, effect }) and
// returns the next state.
// ---------------------------------------------------------------------------

import {
  rulesOf, typeOf, stat, gap, gapBetween, pointOf, isContinuousSpace, boardIn, seenBy, hiddenFrom,
  inCone, blocked, matches, strikeDamage, strikeEnv, dice, callHook, bearing, EPS, passableFor, domainOf,
} from './world.js';
import { formula, whole, R } from './exact.js';
import { addStatus, removeStatuses, adjustPool, takeDamage, canPay, makeUnit, dress, withUnits, freshPerTurn } from './units.js';
import { STAT_KEYS } from './spec.js';

export const ATTACK = { id: 'attack', name: 'Attack', range: 'range', targets: 'enemy', los: 'missile', effects: [{ damage: {} }] };

/** Every ability `u` has: its attack (if any) and its type's own. */
export function abilitiesOf(state, u) {
  const r = rulesOf(state);
  const t = typeOf(state, u);
  const out = [];
  // A type's own strike, else the ruleset's (`spec.strike`), else the plain attack.
  const strike = t.strike !== undefined ? t.strike : r.spec.strike;
  if (strike !== false) out.push(strike && typeof strike === 'object' ? { ...ATTACK, ...strike, id: 'attack' } : ATTACK);
  for (const id of t.abilities ?? []) if (r.abilities[id]) out.push({ ...r.abilities[id], id });
  return out;
}

export const abilityOf = (state, u, id) => abilitiesOf(state, u).find(a => a.id === (id ?? 'attack')) ?? null;

export const rangeOf = (state, u, ab) => (ab.range == null || ab.range === 'range' ? stat(state, u, 'range') : ab.range);

/** Is the ability off cooldown? (discrete time: windows left; continuous: the clock) */
function ready(state, u, ab) {
  const cd = u.cooldowns?.[ab.id];
  if (cd == null) return true;
  return state.gameSpecific.rt ? state.gameSpecific.rt.clock >= cd - EPS : cd <= 0;
}

/** May `u` use `ab` at all now, whatever the target: budget, cost, cooldown, statuses. */
export function canUseNow(state, u, ab, { landing = false } = {}) {
  if (!u?.alive) return false;
  if (ab.id === 'attack' && !(stat(state, u, 'attack') > 0) && !ab.effects?.some(e => !e.damage)) return false;
  if (landing) return true;
  if (blocked(state, u, 'act')) return false;
  if (!state.gameSpecific.rt) {
    const ap = rulesOf(state).actionPoints;
    if (ap ? !(u.perTurn?.ap >= Math.max(1, apCost(ab, u.perTurn.ap))) : !(u.perTurn?.attacksLeft > 0)) return false;
  }
  return canPay(u, ab.cost) && ready(state, u, ab);
}

/** The action points `ab` costs a unit holding `left` of them. */
export const apCost = (ab, left) => (ab.ap === 'all' ? left : ab.ap ?? 1);

const sideOk = (u, t, targets) => (targets === 'enemy' ? t.ownerId !== u.ownerId
  : targets === 'ally' || targets === 'fallen' ? t.ownerId === u.ownerId : targets === 'self' ? t.id === u.id : true);

/** Can `u` aim `ab` at unit `t` (range, side, filter, line, sight, cone)? */
export function canTarget(state, u, ab, t) {
  const targets = ab.targets ?? 'enemy';
  if (!t || (targets === 'fallen' ? t.alive : !t.alive)) return false;
  if (!sideOk(u, t, targets)) return false;
  if (!matches(state, t, ab.filter)) return false;
  if (t.id === u.id) return targets === 'self' || targets === 'any' || targets === 'ally';
  const d = gap(state, u, t);
  if (d > rangeOf(state, u, ab) + EPS) return false;
  if (ab.minRange && d < ab.minRange - EPS) return false;
  const los = ab.los ?? 'missile';
  // Beyond arm's length a strike is a missile, and needs a clear line.
  if (los === true || (los === 'missile' && d > 1 + EPS)) {
    if (!boardIn(state).sight(pointOf(state, u), pointOf(state, t))) return false;
  }
  if (t.ownerId !== u.ownerId) {
    if (hiddenFrom(state, u.ownerId, t)) return false;
    // Under fog a side can only strike what it can see.
    if (state.gameSpecific.fogOfWar && !seenBy(state, u.ownerId, t)) return false;
    if (!inCone(state, u, t)) return false;
  }
  return true;
}

/** Can `u` aim ground-targeted `ab` at point / cell `p`? */
export function canTargetPoint(state, u, ab, p) {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  const B = boardIn(state);
  if (isContinuousSpace(state)) {
    if (!B.terrainUnder(p.x, p.y)) return false;
  } else if (!Number.isInteger(p.x) || !Number.isInteger(p.y) || !B.inBounds(p.x, p.y)) return false;
  const d = gapBetween(state, u.position, p);
  if (d > rangeOf(state, u, ab) + EPS || (ab.minRange && d < ab.minRange - EPS)) return false;
  const los = ab.los ?? 'missile';
  if (los === true || (los === 'missile' && d > 1 + EPS)) {
    const at = isContinuousSpace(state) ? p : B.centre(p);
    if (!B.sight(pointOf(state, u), at)) return false;
  }
  if (teleports(ab) && !landingFree(state, u, p)) return false;
  // A line runs out from the caster: it is aimed at a neighbouring cell.
  if (ab.area?.shape === 'line' && !isContinuousSpace(state) && !B.adjacent(u.position).some(c => c.x === p.x && c.y === p.y)) return false;
  return true;
}

const teleports = (ab) => (ab.effects ?? []).some(e => e.move?.kind === 'teleport');

/** The actions for every use of every ability `u` can make now. */
export function abilityActions(state, u) {
  const out = [];
  for (const ab of abilitiesOf(state, u)) {
    if (!canUseNow(state, u, ab)) continue;
    const targets = ab.targets ?? 'enemy';
    if (targets === 'ground') {
      for (const p of groundTargets(state, u, ab)) out.push({ type: 'ability', ability: ab.id, unitId: u.id, at: p });
      continue;
    }
    if (targets === 'self') {
      out.push({ type: 'ability', ability: ab.id, unitId: u.id, targetId: u.id });
      continue;
    }
    for (const t of state.units) {
      if (!canTarget(state, u, ab, t)) continue;
      out.push(ab === ATTACK || ab.id === 'attack' ? { type: 'attack', unitId: u.id, targetId: t.id } : { type: 'ability', ability: ab.id, unitId: u.id, targetId: t.id });
    }
  }
  return out;
}

// Where a ground-targeted ability is offered: for a teleport, every free spot in
// range; otherwise where the units it could hit stand.
function groundTargets(state, u, ab) {
  const B = boardIn(state);
  const range = rangeOf(state, u, ab);
  const out = [];
  if (teleports(ab)) {
    if (isContinuousSpace(state)) {
      for (let k = 0; k < 12; k++) {
        const a = (k * Math.PI) / 6;
        const p = { x: u.position.x + Math.cos(a) * range, y: u.position.y + Math.sin(a) * range };
        if (canTargetPoint(state, u, ab, p)) out.push(p);
      }
      return out;
    }
    for (const c of B.cells()) if ((c.x !== u.position.x || c.y !== u.position.y) && canTargetPoint(state, u, ab, c)) out.push(c);
    return out;
  }
  // Every cell in range whose area would hit a unit the caster's side can see.
  if (ab.aim === 'cells' && !isContinuousSpace(state)) {
    const cells = ab.area?.shape === 'line' ? B.adjacent(u.position) : B.cells();
    for (const c of cells) {
      if ((c.x === u.position.x && c.y === u.position.y) || !canTargetPoint(state, u, ab, c)) continue;
      const hits = affected(state, u, ab, null, c).filter(t => t.ownerId === u.ownerId
        || !(hiddenFrom(state, u.ownerId, t) || (state.gameSpecific.fogOfWar && !seenBy(state, u.ownerId, t))));
      if (hits.length) out.push({ x: c.x, y: c.y });
    }
    return out;
  }
  const seen = new Set();
  for (const t of state.units) {
    if (!t.alive || !sideOk(u, t, ab.affects ?? 'enemy') || t.id === u.id) continue;
    if (t.ownerId !== u.ownerId && (hiddenFrom(state, u.ownerId, t) || (state.gameSpecific.fogOfWar && !seenBy(state, u.ownerId, t)))) continue;
    const p = { ...t.position };
    const k = `${p.x},${p.y}`;
    if (!seen.has(k) && canTargetPoint(state, u, ab, p)) { seen.add(k); out.push(p); }
  }
  return out;
}

/** Is an ability action legal for `u` now? */
export function abilityLegal(state, u, action) {
  const ab = abilityOf(state, u, action.type === 'attack' ? 'attack' : action.ability);
  if (!ab || !canUseNow(state, u, ab)) return false;
  if ((ab.targets ?? 'enemy') === 'ground') return canTargetPoint(state, u, ab, action.at);
  const t = state.units.find(x => x.id === action.targetId);
  return canTarget(state, u, ab, t);
}

// ── Resolving ────────────────────────────────────────────────────────────────

/** The units an ability lands on: its target, or everyone in its area. */
export function affected(state, u, ab, target, point) {
  const at = target ? target.position : point;
  if (ab.area?.shape === 'line' && at) return lineOf(state, u, ab, at);
  if (!ab.area) return target ? [target] : state.units.filter(x => x.alive && x.position.x === at?.x && x.position.y === at?.y && sideOk(u, x, ab.affects ?? 'enemy'));
  const affects = ab.affects ?? (ab.targets === 'ally' || ab.targets === 'self' ? 'ally' : ab.targets === 'any' ? 'all' : 'enemy');
  return state.units.filter(x => x.alive && sideOk(u, x, affects) && matches(state, x, ab.filter)
    && gapBetween(state, x.position, at) <= ab.area.radius + EPS);
}

// The units on a line from the caster toward `at`: `radius` cells along the
// stronger axis of the way to it (the horizontal, where they are level).
function lineOf(state, u, ab, at) {
  const dx = at.x - u.position.x, dy = at.y - u.position.y;
  if (!dx && !dy) return [];
  const sx = Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : 0, sy = sx ? 0 : Math.sign(dy);
  const cells = new Set(Array.from({ length: ab.area.radius }, (_, i) => `${u.position.x + sx * (i + 1)},${u.position.y + sy * (i + 1)}`));
  const affects = ab.affects ?? (ab.targets === 'ally' ? 'ally' : ab.targets === 'any' ? 'all' : 'enemy');
  return state.units.filter(x => x.alive && sideOk(u, x, affects) && matches(state, x, ab.filter) && cells.has(`${x.position.x},${x.position.y}`));
}

/**
 * In a stack (stacking 'stack'), a blow aimed at any unit lands on the stack's
 * best defender — the one with the most defense, then the most hit points.
 */
export function defenderFor(state, t) {
  if (rulesOf(state).stacking !== 'stack') return t;
  const here = state.units.filter(x => x.alive && x.ownerId === t.ownerId && x.position.x === t.position.x && x.position.y === t.position.y);
  let best = t;
  const rank = (x) => [stat(state, x, 'defense'), x.hp];
  for (const x of here) {
    const [d, h] = rank(x), [bd, bh] = rank(best);
    if (d > bd || (d === bd && h > bh)) best = x;
  }
  return best;
}

/**
 * Whether a use of `ab` by `u` lands on each target, where it asks for chance:
 * Map(targetId → { hitChance, roll, hit, crit }), thrown with the battle's dice.
 * Empty for an ability without `hit`, which always lands.
 */
export function chanceOf(state, u, ab, targets) {
  const out = new Map();
  if (ab.hit == null) return out;
  for (const t of targets) {
    const env = strikeEnv(state, u, t);
    const hitChance = whole(formula(ab.hit)(env));
    const crit = ab.crit != null ? whole(formula(ab.crit)({ ...env, hit: hitChance })) : 0;
    const roll = Math.floor((dice.rng ?? Math.random)() * 100) + 1;
    out.set(t.id, { hitChance, roll, hit: roll <= hitChance, crit: roll <= hitChance && roll <= crit });
  }
  return out;
}

/**
 * The damage each target takes from `ab` used by `u`, worked out against
 * `state` as it is: [{ targetId, amount }], with the roll that decided it where
 * the ability throws one (a miss is an amount of 0). Every strike that lands at
 * one instant is worked out before any is applied.
 */
export function damageOf(state, u, ab, targets, chance = chanceOf(state, u, ab, targets)) {
  const hits = [];
  for (const e of ab.effects ?? []) {
    if (!e.damage) continue;
    for (const t0 of targets) {
      const t = targets.length === 1 && !ab.area ? defenderFor(state, t0) : t0;
      const c = chance.get(t0.id);
      if (c && !c.hit) { hits.push({ targetId: t.id, amount: 0, ...c }); continue; }
      let amount = e.damage.amount ?? strikeDamage(state, u, t, e.damage);
      if (c?.crit) amount = whole(R.mul(R.rat(amount), R.rat(ab.critPower ?? 2)));
      hits.push({ targetId: t.id, amount, ...(c ?? {}) });
    }
  }
  // An ability with no damage still throws its dice: who it lands on.
  if (!hits.length) for (const [targetId, c] of chance) hits.push({ targetId, amount: 0, ...c });
  return hits;
}

/** The targets a use's dice let it land on (all of them, for one that throws none). */
export const landed = (targets, hits) => targets.filter(t => !hits.some(h => h.targetId === t.id && h.hit === false));

/** Apply damage hits; a stack whose defender falls dies with it where the ruleset says so. */
export function dealDamage(state, hits) {
  let units = state.units;
  const r = rulesOf(state);
  for (const { targetId, amount } of hits) {
    let fell = null;
    units = units.map(u => {
      if (u.id !== targetId || !u.alive) return u;
      const next = takeDamage(state, u, amount);
      if (!next.alive) fell = next;
      return next;
    });
    if (fell && r.stacking === 'stack' && r.spec.board?.stackDeath) {
      units = units.map(u => (u.alive && u.ownerId === fell.ownerId && u.position.x === fell.position.x && u.position.y === fell.position.y ? { ...u, hp: 0, alive: false, task: null } : u));
    }
  }
  return withUnits(state, units);
}

/**
 * Everything but the damage: the ability's other effects, in order. `before` is
 * the battle as it was when the ability was used, for a hook that asks.
 */
export function applyOtherEffects(state, casterId, ab, targetIds, point, before = state) {
  for (const e of ab.effects ?? []) {
    if (e.damage) continue;
    const caster = state.units.find(x => x.id === casterId);
    const targets = targetIds.map(id => state.units.find(x => x.id === id)).filter(t => t && (t.alive || ab.targets === 'fallen'));
    state = applyEffect(state, caster, ab, e, targets, point, before);
  }
  return state;
}

const replace = (state, u) => withUnits(state, state.units.map(x => (x.id === u.id ? u : x)));

function applyEffect(state, caster, ab, e, targets, point, before = state) {
  const r = rulesOf(state);
  if (e.fn != null) {
    // A hook may fell or raise units: the survivor counts follow what it did.
    const s = callHook(r.hooks, e, state, { caster, targets, point, ability: ab, effect: e, before });
    return withUnits(s, s.units);
  }
  if (e.move?.kind === 'teleport') return caster?.alive && point ? replace(state, { ...caster, position: { x: point.x, y: point.y } }) : state;
  if (e.spawn) return spawn(state, caster, e.spawn, point ?? targets[0]?.position ?? caster.position);
  for (const t0 of targets) {
    const t = state.units.find(x => x.id === t0.id);
    if (!t?.alive) continue;
    let u = t;
    if (e.heal) {
      const amount = e.heal.amount ?? 0;
      u = { ...u, hp: Math.min(u.maxHp, u.hp + amount) };
    } else if (e.modify) {
      const { attr, by = 0, turns } = e.modify;
      if (u.pools?.[attr]) u = adjustPool(u, attr, by);
      else if (turns) u = addStatus(state, u, `modify:${attr}`, turns, { mods: { [attr]: `${by >= 0 ? '+' : '-'}${Math.abs(by)}` } });
      else if (STAT_KEYS.includes(attr)) u = { ...u, stats: { ...u.stats, [attr]: Math.max(0, u.stats[attr] + by) } };
      else if (attr === 'hp' || attr === 'maxHp') u = { ...u, [attr]: Math.max(1, u[attr] + by) };
      else u = { ...u, attrs: { ...(u.attrs ?? {}), [attr]: (u.attrs?.[attr] ?? 0) + by } };
    } else if (e.status) {
      const id = e.status.id ?? e.status;
      u = addStatus(state, u, id, e.status.turns ?? null);
    } else if (e.cleanse) {
      u = removeStatuses(state, u, e.cleanse.statuses ?? null);
    } else if (e.reveal) {
      u = addStatus(state, u, 'revealed', e.reveal.turns ?? 1);
    } else if (e.conceal) {
      u = addStatus(state, u, 'cloaked', e.conceal.turns ?? 1);
    } else if (e.transform) {
      u = transform(state, u, e.transform.into);
    } else if (e.move) {
      u = shove(state, caster, u, e.move);
    }
    if (u !== t) state = replace(state, u);
  }
  return state;
}

function transform(state, u, into) {
  const t = rulesOf(state).types[into];
  if (!t) return u;
  const hp = Math.max(1, Math.floor((u.hp * t.hp) / u.maxHp));
  const stats = Object.fromEntries(STAT_KEYS.map(k => [k, t[k] ?? u.stats[k]]));
  const { pools: _p, attrs: _a, ...rest } = u;
  let next = dress(state, { ...rest, type: into, hp, maxHp: t.hp, stats }, t, u.facing);
  if (u.pools && next.pools) {
    // A pool both shapes have keeps what was in it.
    next = { ...next, pools: Object.fromEntries(Object.entries(next.pools).map(([k, p]) => [k, u.pools[k] ? { ...p, value: Math.min(p.max, u.pools[k].value) } : p])) };
  }
  if (next.perTurn) next = { ...next, perTurn: { ...freshPerTurn(state, next), moveLeft: Math.min(u.perTurn.moveLeft, stat(state, next, 'speed')), attacksLeft: u.perTurn.attacksLeft } };
  return next;
}

// Is `p` somewhere `u` could stand?
function landingFree(state, u, p) {
  const B = boardIn(state);
  const t = isContinuousSpace(state) ? B.terrainUnder(p.x, p.y) : B.terrainAt(p.x, p.y);
  if (!passableFor(t, domainOf(state, u))) return false;
  if (isContinuousSpace(state)) return !state.units.some(o => o.alive && o.id !== u.id && Math.hypot(o.position.x - p.x, o.position.y - p.y) < 0.7 - EPS);
  return !state.units.some(o => o.alive && o.id !== u.id && o.position.x === p.x && o.position.y === p.y);
}

// Push (away from the caster) or pull (toward it), `distance` steps, stopping
// at the first spot it can't go.
function shove(state, caster, u, { kind = 'push', distance = 1 }) {
  if (!caster) return u;
  const from = pointOf(state, caster), at = pointOf(state, u);
  let dir = bearing(from, at);
  if (kind === 'pull') dir = (dir + 180) % 360;
  const rad = (dir * Math.PI) / 180;
  let pos = u.position;
  if (isContinuousSpace(state)) {
    for (let k = distance; k > 0; k -= 0.25) {
      const p = { x: u.position.x + Math.cos(rad) * k, y: u.position.y + Math.sin(rad) * k };
      if (landingFree(state, u, p) && boardIn(state).sight(u.position, p)) { pos = p; break; }
    }
    return pos === u.position ? u : { ...u, position: pos };
  }
  const B = boardIn(state);
  for (let i = 0; i < distance; i++) {
    const here = B.centre(pos);
    let best = null, bestD = 50;
    for (const n of B.adjacent(pos)) {
      if (B.stepBlocked(pos, n)) continue;
      const d = Math.abs(((bearing(here, B.centre(n)) - dir + 540) % 360) - 180);
      if (d < bestD - 1e-6) { bestD = d; best = n; }
    }
    if (!best || !landingFree(state, u, best)) break;
    pos = best;
  }
  return pos === u.position ? u : { ...u, position: { x: pos.x, y: pos.y } };
}

// New units of `type` for the caster's side, on the free spots nearest `at`.
function spawn(state, caster, { type, count = 1 }, at) {
  if (!caster) return state;
  const B = boardIn(state);
  const gs = state.gameSpecific;
  let n = gs.spawned ?? 0;
  const units = [...state.units];
  for (let k = 0; k < count; k++) {
    const spots = isContinuousSpace(state)
      ? [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({ x: at.x + Math.cos((i * Math.PI) / 4) * 0.8, y: at.y + Math.sin((i * Math.PI) / 4) * 0.8 }))
      : [at, ...B.adjacent(at), ...B.adjacent(at).flatMap(c => B.adjacent(c))];
    const probe = { ...caster, type, domain: undefined };
    const spot = spots.find(p => landingFree({ ...state, units }, probe, p));
    if (!spot) break;
    n++;
    let u = makeUnit(state, { id: `${caster.ownerId}-s${n}`, ownerId: caster.ownerId, type, position: spot, facing: caster.facing });
    u = { ...u, perTurn: state.gameSpecific.rt ? null : { ...freshPerTurn(state, u), moveLeft: 0, attacksLeft: 0 } };
    units.push(u);
  }
  return withUnits({ ...state, gameSpecific: { ...gs, spawned: n } }, units);
}
