import { test } from 'node:test';
import assert from 'node:assert/strict';
// vision.js is a classic browser global (no ESM export, so vue3-sfc-loader can load it);
// importing it for its side effect publishes the API on globalThis.VISION (see its tail).
await import('./vision.js');
const {
  resolveFov, resolveRange, facingOn, unitHeading,
  pointVisibleToUnit, visionSources, visibleTileSet,
  unitVisionRegion, visionRegions, sectorPath, _internal,
} = globalThis.VISION;

const world = { w: 10, h: 10 };
const fieldFacingOn  = (ui = {}) => ({ world, ui: { showFacing: true, ...ui } });
const fieldFacingOff = (ui = {}) => ({ world, ui: { showFacing: false, ...ui } });
// East-facing (ang 0), centred, generous range so the cone, not the radius, decides.
const unit = (o = {}) => ({ id: 'u1', team: 'p1', friendly: true, dead: false, x: 5, y: 5, ang: 0, ...o });

// ── config resolution ─────────────────────────────────────────────────────────
test('FoV defaults: 360 when facing off, 90 when facing on', () => {
  assert.equal(resolveFov(fieldFacingOff(), unit()), 360);
  assert.equal(resolveFov(fieldFacingOn(),  unit()), 90);
});

test('FoV override at the game level and unit level (unit wins)', () => {
  assert.equal(resolveFov(fieldFacingOn({ fovDegrees: 120 }), unit()), 120);
  assert.equal(resolveFov(fieldFacingOn({ fovDegrees: 120 }), unit({ fov: 45 })), 45);
  // game override applies even with facing off
  assert.equal(resolveFov(fieldFacingOff({ fovDegrees: 200 }), unit()), 200);
});

test('range defaults to board fraction, overridable at game and unit level', () => {
  assert.equal(resolveRange({ world }, unit()), Math.max(world.w, world.h) * 0.3);
  assert.equal(resolveRange({ world, ui: { visionRange: 4 } }, unit()), 4);
  assert.equal(resolveRange({ world, ui: { visionRange: 4 } }, unit({ visionRange: 7 })), 7);
});

test('facingOn / unitHeading reflect showFacing', () => {
  assert.equal(facingOn(fieldFacingOn()), true);
  assert.equal(facingOn(fieldFacingOff()), false);
  assert.equal(unitHeading(fieldFacingOn(), unit({ ang: 1.2 })), 1.2);
  assert.equal(unitHeading(fieldFacingOff(), unit({ ang: 1.2 })), null); // omni
  assert.equal(unitHeading(fieldFacingOn(), unit({ ang: undefined })), null);
});

// ── point visibility: radius ────────────────────────────────────────────────────
test('point outside the sight radius is never visible', () => {
  const f = fieldFacingOff({ visionRange: 3 });
  assert.equal(pointVisibleToUnit(f, unit(), 5.5, 5.5), true);   // ~0.7 away
  assert.equal(pointVisibleToUnit(f, unit(), 9.5, 9.5), false);  // ~6.4 away
});

// ── point visibility: 360° disc ─────────────────────────────────────────────────
test('facing-off unit sees in every direction within range', () => {
  const f = fieldFacingOff({ visionRange: 5 });
  for (const [px, py] of [[8, 5], [2, 5], [5, 8], [5, 2]]) // E, W, S, N
    assert.equal(pointVisibleToUnit(f, unit(), px, py), true, `${px},${py}`);
});

// ── point visibility: facing cone ───────────────────────────────────────────────
test('90° cone: in-front visible, behind and to the sides hidden', () => {
  const f = fieldFacingOn({ visionRange: 5 }); // ang 0 = east, half-cone 45°
  assert.equal(pointVisibleToUnit(f, unit(), 8, 5),   true,  'straight ahead');
  assert.equal(pointVisibleToUnit(f, unit(), 7.5, 7), true,  'ahead-right within 45°');
  assert.equal(pointVisibleToUnit(f, unit(), 2, 5),   false, 'directly behind');
  assert.equal(pointVisibleToUnit(f, unit(), 5, 9),   false, 'straight down (90° off heading)');
});

test('cone can be rotated by the unit heading', () => {
  const f = fieldFacingOn({ visionRange: 5 });
  const north = unit({ ang: -Math.PI / 2 }); // -y is up on screen
  assert.equal(pointVisibleToUnit(f, north, 5, 1), true,  'ahead (north)');
  assert.equal(pointVisibleToUnit(f, north, 5, 9), false, 'behind (south)');
});

test('own position is always visible even in a cone', () => {
  assert.equal(pointVisibleToUnit(fieldFacingOn(), unit(), 5, 5), true);
});

// ── vision sources: selected unit vs player union ───────────────────────────────
test('visionSources: selected friendly unit isolates its own vision', () => {
  const units = [unit({ id: 'a' }), unit({ id: 'b', x: 1, y: 1 }), unit({ id: 'e', friendly: false })];
  assert.deepEqual(visionSources(units, null, 'a').map(u => u.id), ['a']);
});

test('visionSources: no selection ⇒ every live friendly unit', () => {
  const units = [unit({ id: 'a' }), unit({ id: 'b' }), unit({ id: 'd', dead: true }), unit({ id: 'e', friendly: false })];
  assert.deepEqual(visionSources(units, null, null).map(u => u.id), ['a', 'b']);
});

test('visionSources: selecting an enemy/unknown id falls back to the player union', () => {
  const units = [unit({ id: 'a' }), unit({ id: 'e', friendly: false })];
  assert.deepEqual(visionSources(units, null, 'e').map(u => u.id), ['a']); // enemy not a valid source
  assert.deepEqual(visionSources(units, null, 'nope').map(u => u.id), ['a']);
});

test('visionSources honours an explicit viewer team id', () => {
  const units = [unit({ id: 'a', team: 'p1', friendly: false }), unit({ id: 'b', team: 'p2', friendly: false })];
  assert.deepEqual(visionSources(units, 'p2', null).map(u => u.id), ['b']);
});

// ── player union / fog complement (discrete tiles) ──────────────────────────────
test('visibleTileSet: player vision is the union of its units', () => {
  const f = fieldFacingOff({ visionRange: 1.2 });
  const a = unit({ id: 'a', x: 1.5, y: 1.5, ang: 0 });
  const b = unit({ id: 'b', x: 8.5, y: 8.5, ang: 0 });
  const only = visibleTileSet(f, [a]);
  const union = visibleTileSet(f, [a, b]);
  assert.ok(only.has('1,1'));
  assert.ok(!only.has('8,8'));
  assert.ok(union.has('1,1') && union.has('8,8'), 'union covers both units');
});

test('fog is the exact complement of the visible tile set', () => {
  const f = fieldFacingOff({ visionRange: 2 });
  const vis = visibleTileSet(f, [unit({ x: 5.5, y: 5.5 })]);
  let fogCount = 0, total = world.w * world.h;
  for (let y = 0; y < world.h; y++)
    for (let x = 0; x < world.w; x++)
      if (!vis.has(`${x},${y}`)) fogCount++;
  assert.equal(fogCount, total - vis.size);
  assert.ok(vis.size > 0 && fogCount > 0, 'partial visibility (some fog, some seen)');
});

test('a selected unit reveals less than the whole player union', () => {
  const f = fieldFacingOff({ visionRange: 1.5 });
  const units = [unit({ id: 'a', x: 1.5, y: 1.5 }), unit({ id: 'b', x: 8.5, y: 8.5 })];
  const selected = visibleTileSet(f, visionSources(units, null, 'a'));
  const player   = visibleTileSet(f, visionSources(units, null, null));
  assert.ok(selected.size < player.size, 'selecting one unit shrinks the visible area');
  for (const k of selected) assert.ok(player.has(k), 'selected vision ⊆ player vision');
});

// ── continuous region descriptors ───────────────────────────────────────────────
test('unitVisionRegion: circle when omnidirectional, sector when facing', () => {
  const circle = unitVisionRegion(fieldFacingOff({ visionRange: 4 }), unit());
  assert.deepEqual(circle, { kind: 'circle', cx: 5, cy: 5, r: 4 });
  const sector = unitVisionRegion(fieldFacingOn({ visionRange: 4 }), unit({ ang: 0.5 }));
  assert.equal(sector.kind, 'sector');
  assert.equal(sector.r, 4);
  assert.equal(sector.ang, 0.5);
  assert.ok(Math.abs(sector.fov - Math.PI / 2) < 1e-9, '90° in radians');
});

test('unitVisionRegion: a ≥360 override collapses a facing unit back to a circle', () => {
  const r = unitVisionRegion(fieldFacingOn({ fovDegrees: 360 }), unit());
  assert.equal(r.kind, 'circle');
});

test('visionRegions maps each source unit', () => {
  const regions = visionRegions(fieldFacingOff(), [unit({ id: 'a' }), unit({ id: 'b', x: 2, y: 2 })]);
  assert.equal(regions.length, 2);
  assert.deepEqual(regions.map(r => r.kind), ['circle', 'circle']);
});

// ── sector path geometry ────────────────────────────────────────────────────────
test('sectorPath: endpoints sit on the arc at ±fov/2 and small cone is not large-arc', () => {
  const cx = 0, cy = 0, r = 10, ang = 0, fov = Math.PI / 2;
  const d = sectorPath(cx, cy, r, ang, fov);
  assert.match(d, /^M 0 0 L /, 'starts at the centre');
  assert.match(d, / A 10 10 0 0 1 /, 'radius 10 arc, large-arc flag 0 for a 90° cone');
  // parse the two arc endpoints
  const nums = d.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g).map(Number);
  // M cx cy L x0 y0 A r r 0 large sweep x1 y1
  const [, , x0, y0] = nums;
  const x1 = nums[nums.length - 2], y1 = nums[nums.length - 1];
  assert.ok(Math.abs(Math.hypot(x0, y0) - r) < 1e-6, 'start point on the circle');
  assert.ok(Math.abs(Math.hypot(x1, y1) - r) < 1e-6, 'end point on the circle');
  // ±45° of east ⇒ (r·cos±45, r·sin±45)
  assert.ok(Math.abs(y0 - (-r * Math.SQRT1_2)) < 1e-6 && Math.abs(y1 - (r * Math.SQRT1_2)) < 1e-6);
});

test('sectorPath: wide cone (>180°) sets the large-arc flag', () => {
  const d = sectorPath(0, 0, 5, 0, (270 * Math.PI) / 180);
  assert.match(d, / A 5 5 0 1 1 /, 'large-arc flag 1');
});

// ── line-of-sight occlusion (walls) ──────────────────────────────────────────────
// A vertical wall column at x=5 splits a 10×10 board; a unit at x=2 can't see past it.
const walled = (ui = {}) => ({
  world, ui: { showFacing: false, ...ui },
  los: { blocked: Array.from({ length: 10 }, (_, y) => `5,${y}`) },
});

test('pointVisibleToUnit: a wall between viewer and target blocks sight', () => {
  const f = walled({ visionRange: 9 });
  const u = unit({ x: 2.5, y: 5.5 });
  assert.equal(pointVisibleToUnit(f, u, 4.5, 5.5), true,  'near side of the wall');
  assert.equal(pointVisibleToUnit(f, u, 7.5, 5.5), false, 'behind the wall');
});

test('unitVisionRegion: occluded map returns an exact polyarc that stops at the wall', () => {
  // East-facing cone so every ray crosses the wall column within the board rows.
  const f = walled({ showFacing: true, visionRange: 9 });
  const region = unitVisionRegion(f, unit({ x: 2.5, y: 5.5, ang: 0 }));
  assert.equal(region.kind, 'polyarc');
  // No vertex reaches past the wall face at x=5 (allowing float epsilon).
  const maxX = Math.max(...region.points.map(p => p.x));
  assert.ok(maxX <= 5 + 1e-6, `polygon should not extend past the wall (got maxX=${maxX})`);
  // Vertices sit exactly on the wall face x=5 (not near it) — no approximation.
  assert.ok(region.points.some(p => Math.abs(p.x - 5) < 1e-9), 'a vertex lands exactly on the wall');
  assert.ok(region.apex && Math.abs(region.apex.x - 2.5) < 1e-12, 'cone apex is the unit');
});

test('raySegT: exact ray↔segment intersection distance', () => {
  const { raySegT } = _internal;
  // ray east from origin, vertical segment x=3 spanning y∈[-1,1] ⇒ hit at distance 3
  assert.ok(Math.abs(raySegT(0, 0, 1, 0, [3, -1, 3, 1]) - 3) < 1e-12);
  // parallel / missed ⇒ Infinity
  assert.equal(raySegT(0, 0, 1, 0, [3, 1, 3, 2]), Infinity);
});

test('wallSegments: a wall column merges into one segment per exposed face', () => {
  const { wallSegments } = _internal;
  const blocked = new Set(Array.from({ length: 10 }, (_, y) => `5,${y}`));
  const segs = wallSegments(blocked, 2.5, 5.5, 9);
  // The left face (x=5) and right face (x=6) each merge into a single tall segment.
  assert.ok(segs.some(s => s[0] === 5 && s[2] === 5 && Math.abs(s[3] - s[1]) >= 6), 'merged left face');
  assert.ok(segs.some(s => s[0] === 6 && s[2] === 6 && Math.abs(s[3] - s[1]) >= 6), 'merged right face');
});

test('occludedRegion: shadow vertices are exact tile corners (no epsilon nudge)', () => {
  const { occludedRegion } = _internal;
  // A single wall tile at (5,5); viewer due west sees its near face and casts a shadow
  // past its corners. The silhouette vertices must be the exact corners (5,5)/(5,6),
  // to full float precision — an epsilon-nudged ray would miss them.
  const blocked = new Set(['5,5']);
  const region = occludedRegion(blocked, 2.5, 5.5, 20, true, null, 2 * Math.PI);
  assert.equal(region.kind, 'polyarc');
  const onCorner = (cx, cy) => region.points.some(p => Math.abs(p.x - cx) < 1e-12 && Math.abs(p.y - cy) < 1e-12);
  assert.ok(onCorner(5, 5), 'exact top corner (5,5)');
  assert.ok(onCorner(5, 6), 'exact bottom corner (5,6)');
});

// ── exact shape-based occlusion (rects + ovals) ──────────────────────────────────
test('shapeExit (open/union): ray runs clear inside the floor, stops exactly at its edge', () => {
  const { shapeExit } = _internal;
  const shapes = [{ shape: 'rect', x: 0, y: 0, w: 10, h: 4 }];
  // viewer at (5,2) inside the rect; east exits at x=10 (dist 5), south exits at y=4 (dist 2)
  assert.ok(Math.abs(shapeExit(5, 2, 0, shapes, 20, 'open').dist - 5) < 1e-9);
  assert.ok(Math.abs(shapeExit(5, 2, Math.PI / 2, shapes, 20, 'open').dist - 2) < 1e-9);
});

test('shapeExit (open): two rooms joined by a narrow slit — far room mostly unreachable', () => {
  const { shapeExit } = _internal;
  // Room A on top, room B below, joined only by a 1-wide vertical slit at x∈[5,6].
  const shapes = [
    { shape: 'rect', x: 0, y: 0, w: 10, h: 4 }, // room A
    { shape: 'rect', x: 5, y: 4, w: 1, h: 1 },  // slit
    { shape: 'rect', x: 0, y: 5, w: 10, h: 4 }, // room B
  ];
  const O = [5.5, 2]; // directly above the slit
  // Straight down threads the slit (x=5.5 ∈ [5,6]) → reaches into room B.
  const thru = shapeExit(O[0], O[1], Math.PI / 2, shapes, 30, 'open');
  assert.ok(thru.dist > 5, `sight passes through the slit into room B (got ${thru.dist})`);
  // A steep down-left ray leaves x∈[5,6] before y=4 → blocked at room A's bottom wall.
  const blocked = shapeExit(O[0], O[1], Math.atan2(2, -3), shapes, 30, 'open');
  assert.ok(blocked.dist < 4, `blocked at room A bottom edge, not through the wall (got ${blocked.dist})`);
});

test('unitVisionRegion: shape-occluded map returns a polyarc confined to the floor', () => {
  const f = { world: { w: 12, h: 12 }, ui: { showFacing: false }, los: { openShapes: [{ shape: 'rect', x: 0, y: 0, w: 10, h: 4 }] } };
  const region = unitVisionRegion(f, { id: 'u', friendly: true, x: 5, y: 2, ang: 0 });
  assert.equal(region.kind, 'polyarc');
  // Every boundary vertex lies within the room rect (vision can't escape the floor).
  for (const p of region.points) {
    assert.ok(p.x >= -1e-6 && p.x <= 10 + 1e-6, `x in room (${p.x})`);
    assert.ok(p.y >= -1e-6 && p.y <= 4 + 1e-6, `y in room (${p.y})`);
  }
});

test('reachRegion: plain circle with no walls, wall-occluded polyarc with walls', () => {
  const { reachRegion, regionPath } = VISION;
  assert.deepEqual(reachRegion({ world }, 5, 5, 4), { kind: 'circle', cx: 5, cy: 5, r: 4 });
  const f = walled();
  const region = reachRegion(f, 2.5, 5.5, 9);
  assert.equal(region.kind, 'polyarc');
  assert.equal(region.apex, null, 'movement reach is a full 360° ring, no apex');
  // The reach is occluded by the wall column: it has vertices exactly on the wall face
  // x=5 (an unoccluded circle never would).
  assert.ok(region.points.some(p => Math.abs(p.x - 5) < 1e-9), 'reach clipped exactly at the wall');
  // regionPath renders it as a closed SVG path (identity fit).
  const id = { x: v => v, y: v => v, len: v => v };
  assert.match(regionPath(region, id), /^M .*Z$/);
});

test('segCircleAngles: a wall crossing the range circle yields the exact crossing angles', () => {
  const { segCircleAngles } = _internal;
  // vertical wall at x=3, viewer at origin, range 5 ⇒ crosses circle at (3,±4)
  const angs = segCircleAngles([3, -10, 3, 10], 0, 0, 5).map(a => a).sort((p, q) => p - q);
  assert.equal(angs.length, 2);
  assert.ok(Math.abs(Math.abs(angs[0]) - Math.atan2(4, 3)) < 1e-9);
});

test('angleDelta wraps around ±PI correctly', () => {
  const { angleDelta } = _internal;
  assert.ok(Math.abs(angleDelta(0.1, -0.1) - 0.2) < 1e-9);
  assert.ok(Math.abs(angleDelta(3.0, -3.0) - (2 * Math.PI - 6.0)) < 1e-9, 'shortest way around');
  assert.ok(Math.abs(angleDelta(0, Math.PI) - Math.PI) < 1e-9);
});
