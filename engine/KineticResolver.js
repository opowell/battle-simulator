/**
 * Exact event-driven resolution of a simultaneous ("we-go") round.
 *
 * Every seat's plan splits into one sequential LANE per unit, and all lanes
 * launch together at t=0 — the whole army starts executing at once; within a
 * lane, order i+1 starts the instant order i completes. A seat's trailing
 * non-positional orders (end-turn) run only after all its unit lanes drain.
 * Orders with numeric geometry become continuous kinetics — analytic
 * straight-line motions, never timestep integration:
 *
 *   • a move gives its unit a velocity toward the destination; "unit reaches
 *     destination" is an exact arrival event at distance/speed.
 *   • an attack on a positioned target launches a lead-aimed projectile whose
 *     impact time is the exact solution of the intercept quadratic
 *     (kinetics.interceptTime) against the target's CURRENT motion. When the
 *     target's velocity changes before impact (it starts/finishes a move, or
 *     dies), the intercept is re-solved from the projectile's position at that
 *     instant — "adjust positions and velocities, then repeat".
 *   • if the game defines onUnitContact(state, aId, bId, info, rng) — info is
 *     { t, positions: { [unitId]: {x, y} } } with the exact contact points —
 *     every pair of unit bodies is also watched for exact disk contact
 *     (kinetics.contactTime); at contact both units stop, their in-flight move
 *     orders are cancelled, and the hook resolves the collision (it should
 *     commit info.positions into the units it wants left at the contact spot).
 *
 * The next event is always the globally earliest of these solved times, kept
 * in a (time, seq) min-heap. Two optimisations keep it fast:
 *   1. Predictions are version-stamped and validated lazily on pop — an event
 *      whose participants changed velocity since it was predicted is discarded
 *      instead of being searched for and removed.
 *   2. After an event only the pairs involving bodies whose velocity actually
 *      changed are re-solved (O(N) work per event), never all O(N²) pairs.
 *
 * Orders with no numeric geometry (chess squares, card plays) fall back to
 * plain getActionDuration completions on the same timeline.
 *
 * Game-state effects still flow through game.applyActions at each event time;
 * an order that is illegal by its completion (target already dead, square now
 * occupied) fizzles — it consumes its time but changes nothing. The whole
 * round is recorded as per-body motion segments and sampled into 61 evenly
 * spaced playback frames (units + projectiles).
 */

import { freeze } from './StateManager.js';
import { evalMotion, contactTime, interceptTime } from './kinetics.js';

const DEFAULT_RADIUS = 0.35;   // grid units; sub-half-cell so adjacent units don't overlap
const SAMPLES = 60;

// Positional geometry, as plain float64 — or null when the value carries none
// (chess's "e4", a card play, a missing position), which is how callers below
// decide whether an order has kinetics at all.
//
// Coordinates are NOT always plain numbers: the continuous-location games store
// authoritative positions as BigNumber (see games/coord.js — CS, doom and
// combatmission all do). A `typeof p.x === 'number'` test silently rejects every
// one of their units, so no motion body is ever built for them and the whole
// round samples into playback frames of {x: null, y: null} — the round resolves
// correctly, but the replay animates nothing. Coerce instead of type-testing;
// Number() reads BigNumber through its valueOf, and yields NaN (→ null here) for
// genuinely non-numeric geometry, which is exactly the distinction we want.
//
// Deliberately duck-typed rather than importing games/coord.js: the engine stays
// game-agnostic, and this needs no knowledge of which numeric class a game picked.
function pt(p) {
  if (!p || typeof p !== 'object') return null;
  const x = Number(p.x), y = Number(p.y);
  return (Number.isFinite(x) && Number.isFinite(y)) ? { x, y } : null;
}

class Heap {
  constructor() { this._h = []; this._seq = 0; }
  get size() { return this._h.length; }
  push(ev) { ev.seq = this._seq++; const h = this._h; h.push(ev); let i = h.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (this._lt(h[p], h[i])) break; [h[p], h[i]] = [h[i], h[p]]; i = p; } }
  pop() { const h = this._h; const top = h[0]; const last = h.pop();
    if (h.length) { h[0] = last; let i = 0;
      for (;;) { let s = i; const l = 2 * i + 1, r = l + 1;
        if (l < h.length && this._lt(h[l], h[s])) s = l;
        if (r < h.length && this._lt(h[r], h[s])) s = r;
        if (s === i) break; [h[s], h[i]] = [h[i], h[s]]; i = s; } }
    return top; }
  _lt(a, b) { return a.time < b.time || (a.time === b.time && a.seq < b.seq); }
}

export function resolveTimeline({ game, turnStart, plans, rng, orderKey, diffEvents }) {
  let state = turnStart;
  const heap = new Heap();
  const entries = [];
  let result = null;
  let simTime = 0;

  // ── bodies: analytic motions + recorded segments for playback ────────────
  const bodies = new Map();   // unitId → { r, ver, motion, segs, movingSeat }
  const deathAt = new Map();  // unitId → time it died (for frame alive flags)
  for (const u of turnStart.units ?? []) {
    const p0 = pt(u.position);
    if (!p0) continue;
    const r = game.getBodyRadius?.(turnStart, u) ?? DEFAULT_RADIUS;
    const motion = { x0: p0.x, y0: p0.y, vx: 0, vy: 0, tRef: 0 };
    bodies.set(u.id, { id: u.id, r, ver: 0, motion, movingLane: null, segs: [{ t0: 0, ...motion }] });
    if (u.alive === false) deathAt.set(u.id, 0);
  }
  const projectiles = new Map(); // pid → { id, motion, speed, targetId, seatIdx, ver, segs, launchT, fizzleT }
  const projByTarget = new Map(); // targetId → Set<pid>
  let projSeq = 0;

  const setMotion = (b, t, vx, vy, x, y) => {
    const p = (x != null) ? { x, y } : evalMotion(b.motion, t);
    b.segs[b.segs.length - 1].t1 = t;
    b.motion = { x0: p.x, y0: p.y, vx, vy, tRef: t };
    b.segs.push({ t0: t, ...b.motion });
    b.ver++;
  };

  // ── lanes: per-unit parallel order queues ────────────────────────────────
  // A seat's plan splits into one sequential lane per unit (all lanes launch
  // at t=0 — every unit starts executing its orders at once), plus a trailing
  // seat lane for non-positional orders (end-turn, phase actions) that only
  // starts once all of that seat's unit lanes have drained — so the turn's
  // bookkeeping (flag resets, rotation) still happens after the action.
  const lanes = [];
  const seats = plans.map(({ playerId, orders }, i) => {
    const seat = { i, playerId, unitLaneIds: [], seatLaneId: null, openUnitLanes: 0 };
    const byUnit = new Map();
    const seatOrders = [];
    for (const action of orders) {
      if (action.unitId && bodies.has(action.unitId)) {
        if (!byUnit.has(action.unitId)) byUnit.set(action.unitId, []);
        byUnit.get(action.unitId).push(action);
      } else {
        seatOrders.push(action);
      }
    }
    for (const [unitId, unitOrders] of byUnit) {
      const lane = { id: lanes.length, seat, playerId, unitId, orders: unitOrders, next: 0, ver: 0, lastStart: 0 };
      lanes.push(lane);
      seat.unitLaneIds.push(lane.id);
    }
    seat.openUnitLanes = seat.unitLaneIds.length;
    const seatLane = { id: lanes.length, seat, playerId, unitId: null, orders: seatOrders, next: 0, ver: 0, lastStart: 0 };
    lanes.push(seatLane);
    seat.seatLaneId = seatLane.id;
    return seat;
  });

  const stillLegal = (playerId, action, cur) => {
    const key = orderKey(action);
    return game.getLegalActions(cur, playerId).some(a => orderKey(a) === key) ||
      !!game.isActionLegal?.(cur, playerId, action);
  };

  // Apply an order's game-state effect at time t; returns true if it was legal.
  const apply = (playerId, action, t0, t1) => {
    const cur = freeze({ ...state, activePlayers: [playerId] });
    if (!stillLegal(playerId, action, cur)) return false;
    state = freeze(game.applyActions(cur, [{ playerId, action }], rng));
    entries.push({
      playerActions: [{ playerId, action }],
      events: diffEvents(cur, state),
      t0, t1,
    });
    afterApply(t1);
    result = game.getResult(state);
    return true;
  };

  // Re-sync bodies to authoritative state: resting bodies snap to any changed
  // game position (knockback etc.); newly dead units stop where they are.
  const afterApply = (t) => {
    for (const u of state.units ?? []) {
      const b = bodies.get(u.id);
      if (!b) continue;
      if (u.alive === false && !deathAt.has(u.id)) {
        deathAt.set(u.id, t);
        if (b.motion.vx !== 0 || b.motion.vy !== 0) { setMotion(b, t, 0, 0); onVelocityChange(b, t); }
        continue;
      }
      const up = b.movingLane == null ? pt(u.position) : null;
      if (up) {
        const p = evalMotion(b.motion, t);
        if (Math.abs(p.x - up.x) > 1e-9 || Math.abs(p.y - up.y) > 1e-9) {
          setMotion(b, t, 0, 0, up.x, up.y);
          onVelocityChange(b, t);
        }
      }
    }
  };

  // ── prediction (the lazy-invalidation optimisation) ──────────────────────
  // Called whenever `b`'s velocity changed at time t: only interactions
  // involving b are re-solved — projectiles homing on it, and (if the game
  // resolves collisions) contacts against every other body.
  const onVelocityChange = (b, t) => {
    for (const pid of projByTarget.get(b.id) ?? []) retarget(projectiles.get(pid), t);
    if (game.onUnitContact) predictContacts(b, t);
  };

  const predictContacts = (b, t) => {
    for (const o of bodies.values()) {
      if (o.id === b.id) continue;
      if (deathAt.has(b.id) || deathAt.has(o.id)) continue;
      const tc = contactTime(b.motion, o.motion, b.r + o.r, t);
      if (tc != null) heap.push({ time: tc, kind: 'contact', aId: b.id, bId: o.id, aVer: b.ver, bVer: o.ver });
    }
  };

  const retarget = (proj, t) => {
    if (!proj || proj.done) return;
    const target = bodies.get(proj.targetId);
    const p = evalMotion(proj.motion, t);
    const hit = target ? interceptTime(p.x, p.y, proj.speed, target.motion, target.r, t) : null;
    proj.ver++;
    proj.segs[proj.segs.length - 1].t1 = t;
    if (hit) {
      proj.motion = { x0: p.x, y0: p.y, vx: hit.vx, vy: hit.vy, tRef: t };
      proj.segs.push({ t0: t, ...proj.motion });
      heap.push({ time: hit.t, kind: 'impact', pid: proj.id, pver: proj.ver });
    } else {
      // Lost the intercept (target now too fast/receding): fly on straight and
      // fizzle when the attacker's nominal action time is up.
      proj.motion = { x0: p.x, y0: p.y, vx: proj.motion.vx, vy: proj.motion.vy, tRef: t };
      proj.segs.push({ t0: t, ...proj.motion });
      heap.push({ time: Math.max(t, proj.fizzleT), kind: 'impact', pid: proj.id, pver: proj.ver, fizzle: true });
    }
  };

  // ── order lifecycle ──────────────────────────────────────────────────────
  const startNext = (lane, t) => {
    if (result || lane.next >= lane.orders.length) return;
    const action = lane.orders[lane.next];
    const dur = game.getActionDuration ? game.getActionDuration(state, action) : 1;
    lane.ver++;
    lane.lastStart = t;
    const ev = { kind: 'complete', laneIdx: lane.id, lver: lane.ver };

    // Kinetic move: velocity toward the destination, exact arrival event.
    const b = action.unitId ? bodies.get(action.unitId) : null;
    const from = pt(action.from), to = pt(action.to);
    if (b && from && to && dur > 0 && !deathAt.has(action.unitId)) {
      const p = evalMotion(b.motion, t);
      const speed = Math.hypot(to.x - from.x, to.y - from.y) / dur;
      const dist = Math.hypot(to.x - p.x, to.y - p.y);
      if (speed > 0 && dist > 1e-9) {
        setMotion(b, t, (to.x - p.x) / dist * speed, (to.y - p.y) / dist * speed);
        b.movingLane = lane.id;
        onVelocityChange(b, t);
        heap.push({ ...ev, time: t + dist / speed, move: true });
        return;
      }
    }

    // Projectile attack: lead-aimed at the target's current motion.
    const target = action.targetId ? bodies.get(action.targetId) : null;
    if (b && target && dur > 0) {
      const p = evalMotion(b.motion, t);
      const tp = evalMotion(target.motion, t);
      const flightDist = Math.hypot(tp.x - p.x, tp.y - p.y);
      const speed = game.getProjectileSpeed?.(state, action) ?? (flightDist > 0 ? flightDist / dur : 0);
      if (speed > 0) {
        const hit = interceptTime(p.x, p.y, speed, target.motion, target.r, t);
        const pid = `proj${projSeq++}`;
        const motion = hit
          ? { x0: p.x, y0: p.y, vx: hit.vx, vy: hit.vy, tRef: t }
          : { x0: p.x, y0: p.y, vx: (tp.x - p.x) / (flightDist || 1) * speed, vy: (tp.y - p.y) / (flightDist || 1) * speed, tRef: t };
        const proj = { id: pid, motion, speed, targetId: action.targetId, laneIdx: lane.id,
          ver: 0, segs: [{ t0: t, ...motion }], launchT: t, fizzleT: t + dur, done: false };
        projectiles.set(pid, proj);
        if (!projByTarget.has(action.targetId)) projByTarget.set(action.targetId, new Set());
        projByTarget.get(action.targetId).add(pid);
        heap.push({ time: hit ? hit.t : proj.fizzleT, kind: 'impact', pid, pver: 0, fizzle: !hit });
        return;
      }
    }

    // Everything else: plain duration on the same timeline.
    heap.push({ ...ev, time: t + Math.max(dur, 0) });
  };

  const finishOrder = (lane, t) => {
    lane.next++;
    if (lane.next < lane.orders.length) { startNext(lane, t); return; }
    // Lane drained. Once a seat's LAST unit lane drains, its seat lane
    // (end-turn and other non-positional orders) starts.
    if (lane.unitId != null && --lane.seat.openUnitLanes === 0) {
      heap.push({ time: t, kind: 'start', laneIdx: lane.seat.seatLaneId });
    }
  };

  // ── main loop: always process the globally earliest solved interaction ───
  // All unit lanes launch together at t=0 ("units start moving"); seats with
  // no unit lanes start their seat lane immediately.
  for (const seat of seats) {
    for (const laneId of seat.unitLaneIds) heap.push({ time: 0, kind: 'start', laneIdx: laneId });
    if (seat.openUnitLanes === 0) heap.push({ time: 0, kind: 'start', laneIdx: seat.seatLaneId });
  }

  while (heap.size > 0 && !result) {
    const ev = heap.pop();
    const t = ev.time;

    if (ev.kind === 'start') {
      startNext(lanes[ev.laneIdx], t);
      continue;
    }

    if (ev.kind === 'complete') {
      const lane = lanes[ev.laneIdx];
      if (ev.lver !== lane.ver) continue;                      // stale (order was cancelled)
      simTime = Math.max(simTime, t);
      const action = lane.orders[lane.next];
      if (ev.move) {
        const b = bodies.get(action.unitId);
        b.movingLane = null;
        const ok = apply(lane.playerId, action, lane.lastStart, t);
        // Arrival: legal → rest exactly at the destination; fizzled → the unit
        // never moved in game terms, so its body snaps back to the authoritative
        // position (unless it died mid-flight — then it rests where it stopped).
        const u = (state.units ?? []).find(x => x.id === action.unitId);
        const dest = pt(action.to), rest = (u && u.alive !== false) ? pt(u.position) : null;
        if (ok && dest) setMotion(b, t, 0, 0, dest.x, dest.y);
        else if (rest) setMotion(b, t, 0, 0, rest.x, rest.y);
        else setMotion(b, t, 0, 0);
        onVelocityChange(b, t);
      } else {
        apply(lane.playerId, action, lane.lastStart, t);
      }
      finishOrder(lane, t);
      continue;
    }

    if (ev.kind === 'impact') {
      const proj = projectiles.get(ev.pid);
      if (!proj || proj.done || ev.pver !== proj.ver) continue; // stale (retargeted since)
      simTime = Math.max(simTime, t);
      proj.done = true;
      proj.segs[proj.segs.length - 1].t1 = t;
      projByTarget.get(proj.targetId)?.delete(ev.pid);
      const lane = lanes[proj.laneIdx];
      const action = lane.orders[lane.next];
      if (!ev.fizzle) apply(lane.playerId, action, proj.launchT, t);
      finishOrder(lane, t);
      continue;
    }

    if (ev.kind === 'contact') {
      const a = bodies.get(ev.aId), b = bodies.get(ev.bId);
      if (!a || !b || ev.aVer !== a.ver || ev.bVer !== b.ver) continue;
      simTime = Math.max(simTime, t);
      // Both participants stop dead at the exact contact instant; any in-flight
      // move order of theirs is cancelled (its completion event goes stale).
      for (const body of [a, b]) {
        if (body.motion.vx !== 0 || body.motion.vy !== 0) setMotion(body, t, 0, 0);
        if (body.movingLane != null) {
          const lane = lanes[body.movingLane];
          body.movingLane = null;
          lane.ver++;
          finishOrder(lane, t);
        }
        onVelocityChange(body, t);
      }
      const cur = freeze({ ...state, activePlayers: turnStart.activePlayers });
      const positions = { [ev.aId]: evalMotion(a.motion, t), [ev.bId]: evalMotion(b.motion, t) };
      state = freeze(game.onUnitContact(cur, ev.aId, ev.bId, { t, positions }, rng));
      entries.push({ playerActions: [], events: diffEvents(cur, state), contact: [ev.aId, ev.bId], t0: t, t1: t });
      afterApply(t);
      result = game.getResult(state);
      continue;
    }
  }

  // Close all open segments at the end of the round.
  for (const b of bodies.values()) { const s = b.segs[b.segs.length - 1]; if (s.t1 == null) s.t1 = simTime; }
  for (const p of projectiles.values()) { const s = p.segs[p.segs.length - 1]; if (s.t1 == null) s.t1 = simTime; }

  // `frameAt` keeps the motion model (segments) alive so the server can compute the
  // EXACT state at any sim-time after the round resolves — what an off-sample mid-turn
  // scrub requests (see GameEngine.playbackFrameAt). Clamped to the round's span.
  const frameAt = simTime > 0
    ? (t) => sampleFrame(turnStart, bodies, projectiles, deathAt, Math.min(Math.max(t, 0), simTime))
    : null;
  return { state, result, entries, duration: simTime, playback: buildPlayback(turnStart, bodies, projectiles, deathAt, simTime), frameAt };
}

// ── playback sampling: 60 even intervals over the round ────────────────────
function segAt(segs, t) {
  for (let i = segs.length - 1; i >= 0; i--) if (segs[i].t0 <= t + 1e-9) return segs[i];
  return segs[0];
}

// The exact resolved state at sim-time `t`, evaluated analytically from the motion
// segments — NOT interpolated between samples. This is both the per-sample builder
// below AND what an on-demand mid-turn scrub asks for: a client paused at a time
// that falls between samples requests THIS (via GameEngine.playbackFrameAt →
// api-server), so the paused board shows the true state, not a straight lerp that
// would mis-place a unit across a motion event (an arrival, a death) between samples.
export function sampleFrame(turnStart, bodies, projectiles, deathAt, t) {
  const units = (turnStart.units ?? []).map(u => {
    const b = bodies.get(u.id);
    const alive = deathAt.has(u.id) ? deathAt.get(u.id) > t : true;
    if (!b) return { id: u.id, x: null, y: null, alive };
    const seg = segAt(b.segs, t);
    const p = evalMotion(seg, Math.min(t, seg.t1 ?? t));
    return { id: u.id, x: p.x, y: p.y, alive };
  });
  const projs = [];
  for (const pr of projectiles.values()) {
    const end = pr.segs[pr.segs.length - 1].t1;
    if (t < pr.launchT || t > end) continue;
    const seg = segAt(pr.segs, t);
    const p = evalMotion(seg, t);
    projs.push({ id: pr.id, x: p.x, y: p.y, targetId: pr.targetId });
  }
  return { t: Number(t.toFixed(4)), units, ...(projs.length ? { projectiles: projs } : {}) };
}

function buildPlayback(turnStart, bodies, projectiles, deathAt, duration) {
  if (!(duration > 0)) return null;
  const interval = duration / SAMPLES;
  const frames = [];
  for (let k = 0; k <= SAMPLES; k++) {
    frames.push(sampleFrame(turnStart, bodies, projectiles, deathAt, k * interval));
  }
  return { duration, interval, frames };
}
