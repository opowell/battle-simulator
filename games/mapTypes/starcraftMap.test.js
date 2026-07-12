import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStarcraftMap, MAP_WIDTH as W, MAP_HEIGHT as H } from './starcraftMap.js';

const k = (x, y) => `${x},${y}`;
const build = () => buildStarcraftMap();

test('starcraftMap: two-player map with correct dimensions', () => {
  const { width, height } = build();
  assert.equal(width, W);
  assert.equal(height, H);
});

test('starcraftMap: at least 500 grouped terrain features', () => {
  const { shapes } = build();
  assert.ok(shapes.length >= 500, `expected >=500 features, got ${shapes.length}`);
});

test('starcraftMap: 4 mineral-ring bases per player, CC fits in the middle', () => {
  // Each base is a horseshoe RING of minerals around a buildable centre (a real SC
  // resource layout, not a flat block). Check all four P1 base centres and their P2
  // mirrors: the centre is buildable and is ringed by a run of mineral patches.
  const { tiles } = build();
  const buildable = (x, y) => ['open', 'elevated'].includes(tiles[k(x, y)]?.terrain);
  const ringCount = (x, y) => {
    let n = 0;
    for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++)
      if (tiles[k(x + dx, y + dy)]?.terrain === 'minerals') n++;
    return n;
  };
  const P1_CENTRES = [[5, 5], [15, 6], [7, 19], [41, 7]];
  const centres = [...P1_CENTRES, ...P1_CENTRES.map(([x, y]) => [W - 1 - x, H - 1 - y])];
  assert.equal(centres.length, 8, 'expected 4 bases per player');
  for (const [x, y] of centres) {
    assert.ok(buildable(x, y), `base centre (${x},${y}) must be buildable for a command centre`);
    assert.ok(ringCount(x, y) >= 6, `base centre (${x},${y}) must be ringed by minerals, saw ${ringCount(x, y)}`);
  }
});

test('starcraftMap: 4th expansion sits in a previously empty corner', () => {
  // P1's 4th is in the bottom-right corner region; P2's mirror lands top-left.
  const { tiles } = build();
  const near = (x, y) => {
    for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++)
      if (tiles[k(x + dx, y + dy)]?.terrain === 'minerals') return true;
    return false;
  };
  assert.ok(near(41, 7), 'expected a 4th base in the bottom-right corner');
  assert.ok(near(W - 1 - 41, H - 1 - 7), 'expected a 4th base in the top-left corner');
});

test('starcraftMap: impassable rock formations break up the open field', () => {
  // Beyond the 1-tile border, the interior carries substantial impassable rock (the
  // outcrops / expansion shields), so the map isn't a big open square.
  const { tiles } = build();
  let interiorRock = 0;
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++)
    if (tiles[k(x, y)]?.terrain === 'obstacle') interiorRock++;
  assert.ok(interiorRock >= 120, `expected plenty of interior impassable terrain, got ${interiorRock}`);
});

test('starcraftMap: perfectly mirror-symmetric terrain (180° rotation)', () => {
  const { tiles } = build();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = tiles[k(x, y)]?.terrain;
    const b = tiles[k(W - 1 - x, H - 1 - y)]?.terrain;
    assert.equal(a, b, `asymmetry at (${x},${y})`);
  }
});

test('starcraftMap: the two main bases are connected by walkable ground', () => {
  const { tiles, bases } = build();
  const pass = (x, y) => ['open', 'elevated', 'ramp'].includes(tiles[k(x, y)]?.terrain);
  const seen = new Set([k(bases.main1.x, bases.main1.y)]);
  const q = [[bases.main1.x, bases.main1.y]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen.has(k(nx, ny)) || !pass(nx, ny)) continue;
      seen.add(k(nx, ny));
      q.push([nx, ny]);
    }
  }
  assert.ok(seen.has(k(bases.main2.x, bases.main2.y)), 'P1 main cannot reach P2 main');
});

test('starcraftMap: contested central plateau is high ground', () => {
  const { tiles } = build();
  assert.equal(tiles[k(24, 20)]?.terrain, 'elevated');
});
