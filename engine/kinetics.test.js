import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalMotion, contactTime, interceptTime, polyRootsInRange } from './kinetics.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('contactTime: head-on straight-line approach is exact', () => {
  // Disks r=0.5 each at (0,0) and (10,0) closing at combined speed 2:
  // gap 10−1=9 closes at t=4.5.
  const a = { x0: 0, y0: 0, vx: 1, vy: 0, tRef: 0 };
  const b = { x0: 10, y0: 0, vx: -1, vy: 0, tRef: 0 };
  assert.ok(close(contactTime(a, b, 1, 0), 4.5));
});

test('contactTime: paths that never come within range return null', () => {
  const a = { x0: 0, y0: 0, vx: 1, vy: 0, tRef: 0 };
  const b = { x0: 0, y0: 5, vx: 1, vy: 0, tRef: 0 };   // parallel, 5 apart
  assert.equal(contactTime(a, b, 1, 0), null);
  const c = { x0: 10, y0: 0, vx: 1, vy: 0, tRef: 0 };  // receding
  assert.equal(contactTime(a, c, 1, 0), null);
});

test('contactTime: crossing paths hit at the first quadratic root', () => {
  // a heads +x, b heads +y through the same point (5,5)... b from (5,-5)? keep
  // simple: a from (0,0) at (1,1)/√2·√2 → use velocities (1,0) and (0,1) from
  // (0,0) and (5,-5): positions (t,0) and (5,-5+t); distance² = (t−5)² + (t−5)².
  const a = { x0: 0, y0: 0, vx: 1, vy: 0, tRef: 0 };
  const b = { x0: 5, y0: -5, vx: 0, vy: 1, tRef: 0 };
  // √2·|t−5| = 1 → t = 5 − 1/√2
  assert.ok(close(contactTime(a, b, 1, 0), 5 - Math.SQRT1_2));
});

test('contactTime: constant-acceleration (polynomial) paths solve via quartic roots', () => {
  // b starts 10 ahead at rest and accelerates away; a chases at constant 2.
  // Relative gap g(t) = 10 − 2t + 0.05t² touches R=1 when 0.05t² − 2t + 9 = 0
  // → t = (2 − √(4−1.8))/0.1 = 5.166852…
  const a = { x0: 0, y0: 0, vx: 2, vy: 0, tRef: 0 };
  const b = { x0: 10, y0: 0, vx: 0, vy: 0, ax: 0.1, ay: 0, tRef: 0 };
  const expected = (2 - Math.sqrt(4 - 4 * 0.05 * 9)) / (2 * 0.05);
  assert.ok(close(contactTime(a, b, 1, 0), expected, 1e-6));
});

test('polyRootsInRange finds all roots of a quartic', () => {
  // (x−1)(x−2)(x−3)(x−4) = 24 −50x +35x² −10x³ + x⁴
  const roots = polyRootsInRange([24, -50, 35, -10, 1], 0, 5);
  assert.equal(roots.length, 4);
  [1, 2, 3, 4].forEach((r, i) => assert.ok(close(roots[i], r, 1e-6)));
});

test('interceptTime: stationary target at exact range/speed time', () => {
  const target = { x0: 10, y0: 0, vx: 0, vy: 0, tRef: 0 };
  const hit = interceptTime(0, 0, 2, target, 0.5, 0);
  assert.ok(close(hit.t, (10 - 0.5) / 2));
});

test('interceptTime: lead-aimed shot meets a crossing target exactly', () => {
  // Target crosses at (5, t); projectile speed 2 from origin. Verify the
  // returned time/velocity actually put the projectile on the target's disk.
  const target = { x0: 5, y0: 0, vx: 0, vy: 1, tRef: 0 };
  const hit = interceptTime(0, 0, 2, target, 0.35, 0);
  assert.ok(hit && hit.t > 0);
  const proj = { x0: 0, y0: 0, vx: hit.vx, vy: hit.vy, tRef: 0 };
  const pp = evalMotion(proj, hit.t);
  const tp = evalMotion(target, hit.t);
  assert.ok(close(Math.hypot(pp.x - tp.x, pp.y - tp.y), 0.35, 1e-6));
});

test('interceptTime: target faster than projectile and receding is unhittable', () => {
  const target = { x0: 5, y0: 0, vx: 3, vy: 0, tRef: 0 };
  assert.equal(interceptTime(0, 0, 1, target, 0.35, 0), null);
});
