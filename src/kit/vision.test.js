import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chebyshev, euclidean, manhattan,
  resolveFov, resolveRange, seesPoint, anySeesPoint,
  viewersOf, filterVisibleUnits, facingTowardEnemies, orientToEnemies, _internal,
} from './vision.js';

const id = (p) => [p.x, p.y];

// ── config resolution ─────────────────────────────────────────────────────────
test('resolveFov: unit override → game default → 360', () => {
  assert.equal(resolveFov({}, {}), 360);
  assert.equal(resolveFov({ fovDegrees: 90 }, {}), 90);
  assert.equal(resolveFov({ fovDegrees: 90 }, { fov: 120 }), 120);
});

test('resolveRange: unit override → game default', () => {
  assert.equal(resolveRange({ range: 6 }, {}), 6);
  assert.equal(resolveRange({ range: 6 }, { visionRange: 3 }), 3);
});

// ── omnidirectional (face-less) = old radius behaviour ──────────────────────────
test('no facing / no fov ⇒ full disc within range (behaviour-identical to old fog)', () => {
  const cfg = { range: 4 }; // no fovDegrees ⇒ 360
  const v = { x: 5, y: 5 }; // no facing
  for (const [tx, ty] of [[9, 5], [1, 5], [5, 9], [5, 1]])
    assert.equal(seesPoint(v, tx, ty, cfg), true, `${tx},${ty}`);
  assert.equal(seesPoint(v, 5, 10, cfg), false, 'out of range');
});

test('metric selects the distance shape', () => {
  assert.equal(chebyshev(0, 0, 3, 3), 3);
  assert.equal(manhattan(0, 0, 3, 3), 6);
  assert.equal(euclidean(0, 0, 3, 4), 5);
  // euclidean is stricter than chebyshev on diagonals
  assert.equal(seesPoint({ x: 0, y: 0 }, 3, 3, { range: 4, metric: euclidean }), false);
  assert.equal(seesPoint({ x: 0, y: 0 }, 3, 3, { range: 4, metric: chebyshev }), true);
});

// ── LOS ─────────────────────────────────────────────────────────────────────────
test('hasLOS can veto an in-range point', () => {
  const wallAtX3 = (ax, ay, bx, by) => !(Math.min(ax, bx) < 3 && Math.max(ax, bx) > 3);
  const cfg = { range: 6, hasLOS: wallAtX3 };
  assert.equal(seesPoint({ x: 1, y: 1 }, 2, 1, cfg), true, 'near side visible');
  assert.equal(seesPoint({ x: 1, y: 1 }, 5, 1, cfg), false, 'blocked across the wall');
});

// ── facing cone ─────────────────────────────────────────────────────────────────
const cone = { range: 6, fovDegrees: 90, metric: chebyshev };
const east = { x: 5, y: 5, facing: 0 };

test('90° cone: ahead visible, behind and flanks hidden', () => {
  assert.equal(seesPoint(east, 9, 5, cone), true,  'straight ahead');
  assert.equal(seesPoint(east, 8, 7, cone), true,  'ahead within 45°');
  assert.equal(seesPoint(east, 1, 5, cone), false, 'behind');
  assert.equal(seesPoint(east, 5, 9, cone), false, 'straight down (90° off)');
});

test('cone rotates with the unit heading (N = -PI/2, +y down)', () => {
  const north = { x: 5, y: 5, facing: -Math.PI / 2 };
  assert.equal(seesPoint(north, 5, 1, cone), true,  'ahead (north)');
  assert.equal(seesPoint(north, 5, 9, cone), false, 'behind (south)');
});

test('own square always seen; a per-unit fov override widens the cone', () => {
  assert.equal(seesPoint(east, 5, 5, cone), true, 'own square');
  const wide = { x: 5, y: 5, facing: 0, fov: 360 };
  assert.equal(seesPoint(wide, 1, 5, cone), true, 'unit fov override back to omni');
});

test('facing null ⇒ omni even when the game sets a cone default', () => {
  assert.equal(seesPoint({ x: 5, y: 5, facing: null }, 1, 5, cone), true);
});

// ── player union / getVisibleState helper ───────────────────────────────────────
const units = [
  { id: 'a', ownerId: 'p1', alive: true, position: { x: 2, y: 2 }, facing: 0 },   // east cone
  { id: 'b', ownerId: 'p1', alive: true, position: { x: 18, y: 2 }, facing: 0 },  // east cone, far away
  { id: 'd', ownerId: 'p1', alive: false, position: { x: 5, y: 5 } },             // dead → not a viewer
  { id: 'e1', ownerId: 'p2', alive: true, position: { x: 4, y: 2 } },             // east of a, in cone
  { id: 'e2', ownerId: 'p2', alive: true, position: { x: 2, y: 6 } },             // south of a, out of cone; far from b
];

test('viewersOf: only live own units, carrying their facing', () => {
  const vs = viewersOf(units, 'p1', cone, id);
  assert.deepEqual(vs.map(v => [v.x, v.y, v.facing]), [[2, 2, 0], [18, 2, 0]]);
});

test('anySeesPoint is the union of the units vision', () => {
  const vs = viewersOf(units, 'p1', cone, id);
  assert.equal(anySeesPoint(vs, 4, 2, cone), true,  'in a\'s east cone');
  assert.equal(anySeesPoint(vs, 2, 6, cone), false, 'behind a and far from b');
});

test('filterVisibleUnits keeps all own units + only seen enemies', () => {
  const seen = filterVisibleUnits(units, 'p1', cone, id).map(u => u.id);
  assert.ok(seen.includes('a') && seen.includes('b') && seen.includes('d'), 'all own units kept');
  assert.ok(seen.includes('e1'), 'enemy in cone visible');
  assert.ok(!seen.includes('e2'), 'enemy outside every cone hidden');
});

test('cone default hides an enemy the old full-disc radius would have shown', () => {
  const disc = { range: 6, metric: chebyshev }; // no fovDegrees ⇒ 360
  assert.ok(filterVisibleUnits(units, 'p1', disc, id).map(u => u.id).includes('e2'),
    'omni radius sees the flanking enemy');
  assert.ok(!filterVisibleUnits(units, 'p1', cone, id).map(u => u.id).includes('e2'),
    'the cone does not');
});

// ── spawn orientation ────────────────────────────────────────────────────────
test('facingTowardEnemies points at the enemy centroid; degrades to 0 with no enemies', () => {
  const me = { ownerId: 'p1', alive: true, position: { x: 0, y: 0 } };
  const east = [me, { ownerId: 'p2', alive: true, position: { x: 5, y: 0 } }];
  assert.ok(Math.abs(facingTowardEnemies(me, east, id) - 0) < 1e-9, 'due east');
  const south = [me, { ownerId: 'p2', alive: true, position: { x: 0, y: 5 } }];
  assert.ok(Math.abs(facingTowardEnemies(me, south, id) - Math.PI / 2) < 1e-9, 'due south (+y down)');
  assert.equal(facingTowardEnemies(me, [me], id), 0, 'no enemies ⇒ 0');
  // dead enemies are ignored
  const onlyDead = [me, { ownerId: 'p2', alive: false, position: { x: 5, y: 0 } }];
  assert.equal(facingTowardEnemies(me, onlyDead, id), 0);
});

test('orientToEnemies gives each side a heading toward the other, and vision then hides its back', () => {
  const raw = [
    { id: 'a', ownerId: 'p1', alive: true, position: { x: 0, y: 0 } },
    { id: 'b', ownerId: 'p2', alive: true, position: { x: 4, y: 0 } },
  ];
  const [a, b] = orientToEnemies(raw, id);
  assert.ok(Math.abs(a.facing - 0) < 1e-9, 'a faces east toward b');
  assert.ok(Math.abs(Math.abs(b.facing) - Math.PI) < 1e-9, 'b faces west toward a');
  // a, now oriented east, can see b ahead but not a point behind it
  const cfg = { range: 6, fovDegrees: 90, metric: chebyshev };
  assert.equal(seesPoint({ x: a.position.x, y: a.position.y, facing: a.facing }, 4, 0, cfg), true);
  assert.equal(seesPoint({ x: a.position.x, y: a.position.y, facing: a.facing }, -3, 0, cfg), false);
});

test('angleDelta wraps around ±PI', () => {
  const { angleDelta } = _internal;
  assert.ok(Math.abs(angleDelta(3, -3) - (2 * Math.PI - 6)) < 1e-9);
  assert.ok(Math.abs(angleDelta(0, Math.PI) - Math.PI) < 1e-9);
});
