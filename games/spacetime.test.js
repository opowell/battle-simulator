import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSpaceTime, moveBudget, travelTime, moveDuration,
  toContinuous, toDiscrete, defaultToContinuous, defaultToDiscrete,
  enumerateDestinations, slidePosition, distance, num,
} from './spacetime.js';

// A minimal spec: constant-speed units on an open grid with a wall column at x=2.
function spec(speed = 3) {
  return {
    turnDuration: 6,
    speed: (u) => u.speed ?? speed,
    neighbors(pos) {
      const out = [];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const to = { x: pos.x + dx, y: pos.y + dy };
        if (to.x < 0 || to.y < 0 || to.x > 5 || to.y > 5) continue;
        if (to.x === 2) continue; // wall column
        out.push({ to, cost: 1 });
      }
      return out;
    },
    walkable: (x, y) => x >= 0 && y >= 0 && x <= 5 && y <= 5 && Math.floor(x) !== 2,
    pathClear: (x0, y0, x1, y1) => {
      // Blocked if the straight segment crosses the x=2 wall column.
      return !((x0 < 2 && x1 >= 2) || (x1 < 2 && x0 >= 2));
    },
  };
}

const unit = (x, y, speed) => ({ id: 'u', position: { x, y }, speed });

// ── Config resolution ─────────────────────────────────────────────────────────

test('resolveSpaceTime: defaults to sequential discrete/discrete', () => {
  const st = resolveSpaceTime({});
  assert.deepEqual(st, { space: 'discrete', time: 'discrete', play: 'sequential', turnDuration: 1 });
});

test('resolveSpaceTime: config overrides game defaults', () => {
  const game = { spacetime: { space: 'discrete', time: 'discrete', play: 'sequential' }, kinematics: { turnDuration: 6 } };
  const st = resolveSpaceTime(game, { space: 'continuous', time: 'continuous', play: 'simultaneous' });
  assert.deepEqual(st, { space: 'continuous', time: 'continuous', play: 'simultaneous', turnDuration: 6 });
});

test('resolveSpaceTime: honours legacy aliases (timeType, simultaneousTurns)', () => {
  const st = resolveSpaceTime({}, { timeType: 'continuous', simultaneousTurns: true, turnDuration: 10 });
  assert.equal(st.time, 'continuous');
  assert.equal(st.play, 'simultaneous');
  assert.equal(st.turnDuration, 10);
});

test('resolveSpaceTime: rejects invalid values', () => {
  assert.throws(() => resolveSpaceTime({}, { space: 'fuzzy' }), /invalid space/);
  assert.throws(() => resolveSpaceTime({}, { time: 'sometimes' }), /invalid time/);
});

// ── Coordinate transforms ──────────────────────────────────────────────────────

test('default transforms: tile centre ↔ floor round-trip', () => {
  assert.deepEqual(defaultToContinuous({ x: 3, y: 4 }), { x: 3.5, y: 4.5 });
  assert.deepEqual(defaultToDiscrete({ x: 3.5, y: 4.5 }), { x: 3, y: 4 });
  // Any point in a cell floors back to that cell.
  assert.deepEqual(defaultToDiscrete(defaultToContinuous({ x: 3, y: 4 })), { x: 3, y: 4 });
});

test('transforms: a game may override them', () => {
  const kin = {
    toContinuous: (t) => ({ x: t.x * 10, y: t.y * 10 }),
    toDiscrete: (p) => ({ x: Math.round(p.x / 10), y: Math.round(p.y / 10) }),
  };
  assert.deepEqual(toContinuous(kin, { x: 2, y: 1 }), { x: 20, y: 10 });
  assert.deepEqual(toDiscrete(kin, { x: 20, y: 10 }), { x: 2, y: 1 });
});

// ── The one number, two ways ────────────────────────────────────────────────────

test('moveBudget is the raw speed; double speed → double range', () => {
  const kin = spec();
  assert.equal(moveBudget(kin, unit(0, 0, 3)), 3);
  assert.equal(moveBudget(kin, unit(0, 0, 6)), 6);
});

test('travelTime: full-range move costs exactly one turn window', () => {
  const kin = spec();
  const st = resolveSpaceTime({ kinematics: kin }, { time: 'continuous' });
  // speed 3, turnDuration 6 → a distance-3 move takes the whole 6-unit window.
  assert.equal(travelTime(kin, unit(0, 0, 3), {}, st, 3), 6);
  // A single step (dist 1) is a third of that.
  assert.equal(travelTime(kin, unit(0, 0, 3), {}, st, 1), 2);
});

test('travelTime: double speed → half the time (cooldown)', () => {
  const kin = spec();
  const st = resolveSpaceTime({ kinematics: kin }, { time: 'continuous' });
  const slow = travelTime(kin, unit(0, 0, 3), {}, st, 1);
  const fast = travelTime(kin, unit(0, 0, 6), {}, st, 1);
  assert.equal(fast, slow / 2);
});

test('travelTime: a speed-0 unit never arrives', () => {
  const kin = spec();
  const st = resolveSpaceTime({ kinematics: kin }, { time: 'continuous' });
  assert.equal(travelTime(kin, unit(0, 0, 0), {}, st, 1), Infinity);
});

// ── Destination enumeration per quadrant ────────────────────────────────────────

test('discrete space: reachable cells within budget, respecting the wall', () => {
  const kin = spec();
  const st = resolveSpaceTime({}, { space: 'discrete' });
  const dests = enumerateDestinations(kin, unit(0, 0, 3), {}, st, moveBudget(kin, unit(0, 0, 3)));
  const keys = new Set(dests.map(d => `${d.to.x},${d.to.y}`));
  // Cells at Manhattan distance ≤ 3 on the x<2 side are reachable; x=2 wall blocks passage.
  assert.ok(keys.has('0,3'));
  assert.ok(keys.has('1,1'));
  assert.ok(!keys.has('2,0'), 'wall column is unreachable');
  assert.ok(!keys.has('3,0'), 'cannot cross the wall to the far side');
  // Every destination carries a step path starting at the origin.
  const d = dests.find(x => x.to.x === 1 && x.to.y === 1);
  assert.deepEqual(d.path[0], { x: 0, y: 0 });
  assert.equal(d.path[d.path.length - 1].x, 1);
  assert.equal(d.cost, 2);
});

test('discrete space: bigger budget reaches farther', () => {
  const kin = spec();
  const st = resolveSpaceTime({}, { space: 'discrete' });
  const near = enumerateDestinations(kin, unit(0, 0, 1), {}, st, 1);
  const far = enumerateDestinations(kin, unit(0, 0, 5), {}, st, 5);
  assert.ok(far.length > near.length);
});

test('continuous space: free points within the radius, none through the wall', () => {
  const kin = spec();
  const st = resolveSpaceTime({}, { space: 'continuous' });
  const dests = enumerateDestinations(kin, unit(0.5, 0.5, 3), {}, st, 3);
  assert.ok(dests.length > 0);
  for (const d of dests) {
    assert.ok(distance({ x: 0.5, y: 0.5 }, d.to) <= 3 + 1e-9);
    assert.ok(d.to.x < 2, 'no candidate crosses the wall column');
    assert.equal(d.path.length, 2, 'a continuous move is a single straight slide');
  }
});

// ── Slide interpolation ─────────────────────────────────────────────────────────

test('slidePosition: interpolates then clamps at arrival', () => {
  const kin = spec();
  const st = resolveSpaceTime({ kinematics: kin }, { time: 'continuous', space: 'continuous' });
  const u = unit(0, 0, 3);
  const from = { x: 0, y: 0 }, to = { x: 3, y: 0 }; // dist 3 → arrives at t = 0 + 6
  assert.deepEqual(slidePosition(kin, u, {}, st, from, to, 0, 0), { x: 0, y: 0 });
  const mid = slidePosition(kin, u, {}, st, from, to, 0, 3); // halfway through the window
  assert.ok(Math.abs(mid.x - 1.5) < 1e-9);
  assert.deepEqual(slidePosition(kin, u, {}, st, from, to, 0, 6), { x: 3, y: 0 });
  assert.deepEqual(slidePosition(kin, u, {}, st, from, to, 0, 99), { x: 3, y: 0 }, 'clamps past arrival');
});

// ── num() tolerates BigNumber-like coordinates ──────────────────────────────────

test('num: reads BigNumber-like, string, and number coordinates', () => {
  assert.equal(num(3), 3);
  assert.equal(num('2.5'), 2.5);
  assert.equal(num({ toNumber: () => 7 }), 7);
});

test('moveDuration: uses the distance actually covered', () => {
  const kin = spec();
  const st = resolveSpaceTime({ kinematics: kin }, { time: 'continuous', space: 'continuous' });
  const u = unit(0, 0, 3);
  assert.equal(moveDuration(kin, u, {}, st, { x: 0, y: 0 }, { x: 3, y: 0 }), 6);
  assert.equal(moveDuration(kin, u, {}, st, { x: 0, y: 0 }, { x: 0, y: 0 }), 0);
});
