// ---------------------------------------------------------------------------
// The generic AI's judgement of a position, from unit numbers alone.
//
//   value(me) =   Σ worth(my units)       − Σ worth(enemy units)          material
//               − wThreat · pressure(enemies → my units)                  exposure
//               + wStrike · pressure(my units → enemies)                  threat
//               − wApproach · Σ distance my fighters still have to close  initiative
//
// Every quantity is in units of the battle's own reference scales (mean hp,
// attack, defense, range, speed over all the units — battleView.scalesOf), so
// the same weights read chess pieces, civ1 legions and Arena archers alike.
//
// worth(u)     a unit's fighting value: hit points × (attack·rate + defense),
//              nudged up for reach and mobility, and scaled by the share of
//              its hit points it still has — with a floor, so the kill itself is
//              worth something beyond the last hit point.
//
// pressure     what one side's units could do to the other's before they can
//              react: every attacker within `speed + range` of a target (one
//              turn's move plus a strike) picks the target it would hurt most,
//              greedily, with damage already assigned to a target counted so no
//              unit is killed twice. Damage is estimated as
//                  k · attack² / (attack + defense)
//              — the shape of most games' combat — where `k`, the game's damage
//              scale, starts from a guess and is CALIBRATED by GenericAgent
//              against the hits it actually sees the game deal.
//
// Readiness: geometry says who COULD be struck; only the game knows who can be
// struck right now — whether a gun is loaded, a target inside a vision cone, a
// strike left this turn. When the agent can afford it, it reads that off the
// game's own legal actions for its side (ctx.ready: attacker id → the target ids
// it has a legal strike on). A ready attacker's pressure is exactly those
// strikes; an attacker with none counts its geometric reach at NOT_READY. So
// reloading, or turning to face the enemy, is worth what it makes possible.
//
// Captures: a game whose units take by moving onto their victims says exactly
// what each threatens (game.threats, ctx.captures: attacker id → target ids, for
// every side, whoever is on move). Such a unit's pressure is those captures and
// nothing else, each one taking its target whole: there is no damage to guess.
//
// Facing (when the game says how its units face): an attacker whose vision cone
// does not hold its target must turn first, so its threat counts at NOT_READY.
// Defense arcs are left out on purpose: counting a blow from behind at the rear
// modifier rates flanking positions as if the defender would not turn before it
// is struck, and measured clearly worse (hex scenario, 24 games against the AI
// without it: 6–12 with arcs, 13–4 without). What a unit carries beyond its
// numbers (pools, statuses) scales its worth by the game's `worthBonus`.
//
// The weights depend on the play mode. Sequential: after my turn the enemy moves
// first, so its pressure is nearly certain and mine is only a prospect (they can
// step away). Simultaneous (we-go, or a shared clock): both land together.
// ---------------------------------------------------------------------------

import { distance } from './battleView.js';

export const WIN = 1e6;

const WEIGHTS = {
  sequential:   { threat: 0.85, strike: 0.35 },
  simultaneous: { threat: 0.6,  strike: 0.6 },
};
const KILL_FLOOR = 0.3;       // share of a unit's worth that is in being alive at all
const APPROACH = 0.04;        // per unit worth, per turn of travel still to make
const MOVE_DISCOUNT = 0.85;   // a strike that first needs a move is less certain
const GHOST_WEIGHT = 0.6;     // pressure from an enemy only remembered, not seen
const NOT_READY = 0.5;        // pressure from an attacker with no legal strike now

/** A unit's full-health fighting value, in reference-unit terms. */
export function baseWorth(u, sc) {
  const hp = u.maxHp / sc.hp;
  const atk = (u.attack / sc.attack) * Math.max(u.rate, 0.25);
  const def = u.defense / sc.defense;
  const reach = 1 + 0.25 * Math.log2(1 + u.range / sc.range);
  const mobility = 1 + 0.1 * Math.log2(1 + u.speed / sc.speed);
  return Math.max(hp * (0.5 * atk + 0.5 * def) * reach * mobility * Math.max(0.1, 1 + (u.worthBonus ?? 0)), 1e-6);
}

/** Worth of unit `u` were it at `hp` hit points. */
export function worthAt(u, hp, sc) {
  if (hp <= 0) return 0;
  return baseWorth(u, sc) * (KILL_FLOOR + (1 - KILL_FLOOR) * Math.min(1, hp / u.maxHp));
}

/** The default damage scale: a strike between average units takes 35% of an average unit's hp. */
export const defaultDamageScale = (sc) => (0.7 * sc.hp) / sc.attack;

export function strikeDamage(a, d, k) {
  if (!(a.attack > 0)) return 0;
  return (k * a.attack * a.attack) / (a.attack + Math.max(d.defense, 0));
}

const bearing = (p, q) => ((Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI + 360) % 360;
const angleBetween = (a, b) => { const x = Math.abs(a - b) % 360; return x > 180 ? 360 - x : x; };

// Can `a` strike at `d` without turning first?
const inCone = (a, d) => a.facing == null || a.fov >= 360 || !a.point || !d.point
  || angleBetween(a.facing, bearing(a.point, d.point)) <= a.fov / 2 + 1e-6;

// Greedy one-turn assignment of attackers to targets; returns the total worth
// the attackers could take off the defenders.
function pressure(attackers, defenders, metric, sc, k, ready = null, captures = null) {
  const assigned = new Map();
  let total = 0;
  const order = attackers.filter(a => a.point && a.attack > 0).sort((a, b) => b.attack - a.attack);
  for (const a of order) {
    const reach = a.speed + a.range;
    const takes = a.exactThreats ? captures?.get(a.id) ?? new Set() : null;
    const now = takes ?? ready?.get(a.id) ?? null;
    let best = 0, bestId = null, bestDmg = 0;
    for (const d of defenders) {
      if (!d.point) continue;
      const dist = distance(metric, a.point, d.point);
      if (now ? !now.has(d.id) : dist > reach + 1e-9) continue;
      const left = d.hp - (assigned.get(d.id) ?? 0);
      if (left <= 0) continue;
      const dmg = takes ? left : Math.min(left, strikeDamage(a, d, k) * Math.max(1, a.rate));
      const sure = now ? 1 : ready || !inCone(a, d) ? NOT_READY : dist <= a.range + 1e-9 ? 1 : MOVE_DISCOUNT;
      const v = (worthAt(d, left, sc) - worthAt(d, left - dmg, sc)) * sure;
      if (v > best) { best = v; bestId = d.id; bestDmg = dmg; }
    }
    if (bestId != null) {
      assigned.set(bestId, (assigned.get(bestId) ?? 0) + bestDmg);
      total += best * (a.ghost ? GHOST_WEIGHT : 1);
    }
  }
  return total;
}

// Strikes already under way (battleView `striking`) are counted as landed: the
// target's hit points are taken down by the expected damage before anything else
// is weighed. Mutates the per-evaluation copies in `mine` / `theirs`.
function bookStrikes(mine, theirs, k) {
  const all = [...mine, ...theirs];
  const byId = new Map(all.map((u, i) => [u.id, i]));
  for (const a of all) {
    if (a.striking == null || !byId.has(a.striking)) continue;
    const list = byId.get(a.striking) < mine.length ? mine : theirs;
    const i = list === mine ? byId.get(a.striking) : byId.get(a.striking) - mine.length;
    const t = list[i];
    list[i] = { ...t, hp: Math.max(0, t.hp - strikeDamage(a, t, k)) };
  }
  for (const list of [mine, theirs]) for (let i = list.length - 1; i >= 0; i--) if (list[i].hp <= 0) list.splice(i, 1);
}

/**
 * Value of `battle` (battleView.readBattle) to player `me`.
 * ctx: { ghosts: unitView[] of enemies remembered but not seen, damageScale,
 *        turn, aggression (default 1), objective: {x,y} to march on when no
 *        enemy position is known, ready: Map(my attacker id → Set(target ids))
 *        of the strikes the game allows me right now, when known,
 *        captures: Map(attacker id → Set(target ids)) of what every side's
 *        exactThreats units threaten (game.threats) }
 */
export function evaluateBattle(battle, me, ctx = {}) {
  const { metric, scale: sc, mode } = battle;
  const k = ctx.damageScale ?? defaultDamageScale(sc);
  const mine = [], theirs = [];
  for (const u of battle.units) {
    if (!u.alive) continue;
    (u.owner === me ? mine : theirs).push(u);
  }
  const seen = new Set(theirs.map(u => u.id));
  for (const g of ctx.ghosts ?? []) if (!seen.has(g.id)) theirs.push({ ...g, ghost: true });
  bookStrikes(mine, theirs, k);

  let material = 0;
  for (const u of mine) material += worthAt(u, u.hp, sc);
  let theirMaterial = 0;
  for (const u of theirs) theirMaterial += worthAt(u, u.hp, sc);
  material -= theirMaterial;

  const w = WEIGHTS[mode.play === 'simultaneous' || mode.time === 'continuous' ? 'simultaneous' : 'sequential'];
  // A unit in the middle of a strike can't start another before it lands.
  const free = (us) => us.filter(u => !u.striking);
  const exposure = pressure(free(theirs), mine, metric, sc, k, null, ctx.captures ?? null);
  const threat = pressure(free(mine), theirs, metric, sc, k, ctx.ready ?? null, ctx.captures ?? null);

  // Initiative: fighters close on the nearest known enemy (or the objective)
  // until it is in range — harder when ahead, and harder as the game drags on.
  const targets = theirs.filter(u => u.point).map(u => u.point);
  if (!targets.length && ctx.objective) targets.push(ctx.objective);
  let approach = 0;
  if (targets.length) {
    const ratio = Math.min(2, Math.max(0.5, (material + theirMaterial) / Math.max(theirMaterial, 1e-6)));
    const urgency = ratio * (1 + (ctx.turn ?? 0) / 30) * (ctx.aggression ?? 1);
    for (const m of mine) {
      if (!m.point || !(m.attack > 0)) continue;
      let near = Infinity;
      for (const t of targets) near = Math.min(near, distance(metric, m.point, t));
      approach += baseWorth(m, sc) * Math.max(0, near - m.range) / sc.speed;
    }
    approach *= APPROACH * urgency;
  }

  return material - w.threat * exposure + w.strike * threat - approach;
}
