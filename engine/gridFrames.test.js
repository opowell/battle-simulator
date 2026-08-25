import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridCursor, encodeGridFrame, applyGridFrame, mergeGridFrames, GridTimeline } from './gridFrames.js';

/** A board of `n` cells, with `changes` applied as {index: value}. */
const board = (n, changes = {}, extra = {}) => ({
  width: n, height: 1,
  cells: Array.from({ length: n }, (_, i) => ({ x: i, y: 0, terrain: changes[i] ?? 'grass' })),
  ...extra,
});

/** Encode a whole run of grids the way a session does, one after another. */
function encodeAll(grids) {
  const frames = [];
  let cursor = null;
  for (const g of grids) {
    const r = encodeGridFrame(cursor, g);
    frames.push(r.frame);
    cursor = r.cursor;
  }
  return frames;
}

/** Rebuild every grid from its frames, exactly as a reader does. */
function decodeAll(frames) {
  const out = [];
  let cur = null;
  for (const f of frames) { cur = applyGridFrame(cur, f); out.push(cur); }
  return out;
}

test('a run of boards survives encode → decode unchanged', () => {
  const grids = [
    board(20),
    board(20, { 3: 'forest' }),
    board(20, { 3: 'forest', 11: 'hills' }),
    board(20, { 11: 'hills' }),                  // cell 3 goes back
    board(20, { 11: 'hills' }),                  // nothing moved at all
  ];
  const frames = encodeAll(grids);
  assert.deepEqual(decodeAll(frames), grids);
  // Only the first frame should be a whole board.
  assert.ok(frames[0].full, 'the first frame must carry a whole board');
  assert.equal(frames.slice(1).filter(f => f.full).length, 0);
  // ...and the diffs must be diffs, not the board again.
  assert.deepEqual(frames[1].patch.map(([i]) => i), [3]);
  assert.deepEqual(frames[4].patch, [], 'an unchanged board is an empty patch');
});

test('non-cell grid fields are carried, and dropped ones are dropped', () => {
  // Continuous-location boards (cs, doom) move units in grid.units, not between
  // cells — a codec that only watched `cells` would freeze them in place.
  const a = board(8, {}, { units: [{ id: 'u1', x: 1, y: 1 }], locationType: 'continuous' });
  const b = board(8, {}, { units: [{ id: 'u1', x: 4, y: 2 }], locationType: 'continuous' });
  const c = board(8, {}, { locationType: 'continuous' });   // units field gone
  const rebuilt = decodeAll(encodeAll([a, b, c]));
  assert.deepEqual(rebuilt, [a, b, c]);
  assert.deepEqual(rebuilt[1].units, [{ id: 'u1', x: 4, y: 2 }]);
  assert.ok(!('units' in rebuilt[2]), 'a field that went away must not linger');
});

test('a board that changes shape restarts with a whole frame', () => {
  const frames = encodeAll([board(10), board(25)]);
  assert.ok(frames[1].full, 'a resized board cannot be a patch of the old one');
  assert.deepEqual(decodeAll(frames), [board(10), board(25)]);
});

test('a board that mostly changed is stored whole rather than as a diff', () => {
  const churn = {};
  for (let i = 0; i < 18; i++) churn[i] = 'desert';   // 18 of 20
  const frames = encodeAll([board(20), board(20, churn)]);
  assert.ok(frames[1].full, 'a diff bigger than the board is not worth keeping');
});

test('thinning folds dropped frames into their successor', () => {
  // Ten boards, each changing one more cell than the last.
  const grids = [];
  const acc = {};
  for (let i = 0; i < 10; i++) {
    if (i) acc[i * 2] = 'forest';
    grids.push(board(40, { ...acc }));
  }
  const frames = encodeAll(grids);

  // Thin exactly as Session._pushGridHistory does: keep 0, 2, 4... folding each
  // dropped frame into the one after it.
  const thinned = [frames[0]];
  for (let i = 2; i < frames.length; i += 2) thinned.push(mergeGridFrames(frames[i - 1], frames[i]));

  // What survives must be the boards at those positions, unchanged.
  assert.deepEqual(decodeAll(thinned), grids.filter((_, i) => i % 2 === 0));
});

test('thinning twice still lands on the right boards', () => {
  const grids = [];
  const acc = {};
  for (let i = 0; i < 16; i++) {
    if (i) acc[i] = 'hills';
    grids.push(board(40, { ...acc }, { turn: i }));
  }
  let frames = encodeAll(grids);
  let kept = grids;
  for (let pass = 0; pass < 2; pass++) {
    const next = [frames[0]];
    for (let i = 2; i < frames.length; i += 2) next.push(mergeGridFrames(frames[i - 1], frames[i]));
    frames = next;
    kept = kept.filter((_, i) => i % 2 === 0);
  }
  assert.deepEqual(decodeAll(frames), kept);
  assert.deepEqual(decodeAll(frames).map(g => g.turn), [0, 4, 8, 12]);
});

test('merging across a whole-grid frame keeps the whole grid', () => {
  const a = board(10, { 1: 'forest' });
  const b = board(30, { 2: 'hills' });          // reshape forces a full frame
  const c = board(30, { 2: 'hills', 5: 'sea' });
  const frames = encodeAll([a, b, c]);
  assert.ok(frames[1].full);
  // Dropping `b` must not lose it: c still has to rebuild correctly from a merge.
  assert.deepEqual(applyGridFrame(a, mergeGridFrames(frames[1], frames[2])), c);
});

test('each rebuilt frame is its own object', () => {
  const grids = [board(6), board(6, { 1: 'forest' }), board(6, { 1: 'forest', 2: 'sea' })];
  const rebuilt = decodeAll(encodeAll(grids));
  // The scrub bar holds all of these at once; aliases would show one position twice.
  assert.notEqual(rebuilt[0], rebuilt[1]);
  assert.notEqual(rebuilt[1].cells, rebuilt[2].cells);
  rebuilt[2].cells[0] = { poisoned: true };
  assert.deepEqual(rebuilt[1].cells[0], { x: 0, y: 0, terrain: 'grass' });
});

test('gridCursor copes with a grid that has no cells', () => {
  const g = { width: 3, note: 'no board here' };
  const frames = encodeAll([g, { width: 3, note: 'still none' }]);
  assert.ok(frames.every(f => f.full), 'nothing to diff means nothing but whole frames');
  assert.equal(gridCursor(g).cellJson, null);
});


// ── GridTimeline ────────────────────────────────────────────────
// A timeline that has been thinned is where the interesting bugs are: the frames get
// re-indexed under the cursor that the NEXT diff is taken against, and getting that
// wrong corrupts every later frame by a few cells — silently, with nothing thrown.

/** Rebuild every frame a timeline holds, by paging it exactly as a reader does. */
function readAll(tl, pageSize = 7) {
  const out = [];
  for (let from = 0; from < tl.length; from += pageSize) {
    const page = tl.read(from, pageSize);
    let cur = null;
    for (const f of page.frames) { cur = applyGridFrame(cur, f); out.push(cur); }
  }
  return out;
}

test('a timeline under its cap holds every position, in order', () => {
  const tl = new GridTimeline({ max: 100 });
  const grids = [];
  const acc = {};
  for (let i = 0; i < 30; i++) {
    if (i) acc[i] = 'forest';
    const g = board(60, { ...acc }, { step: i });
    grids.push(g);
    tl.push(g);
  }
  assert.equal(tl.length, 30);
  assert.deepEqual(readAll(tl), grids);
});

test('pushing on PAST a thinning still rebuilds every surviving position', () => {
  // The regression this exists for: thinning drops the frame just pushed, so the
  // cursor the next diff is taken against described a frame that no longer exists.
  // Every frame after the first thinning then decoded onto the wrong board — and the
  // damage was a handful of stale cells, not an error.
  const tl = new GridTimeline({ max: 10 });
  const pushed = [];
  const acc = {};
  for (let i = 0; i < 90; i++) {
    if (i) acc[i % 50] = 'terrain' + i;      // churn that revisits cells
    const g = board(50, { ...acc }, { step: i });
    pushed.push(g);
    tl.push(g);
  }
  assert.ok(tl.length < 10, `timeline should stay under its cap, got ${tl.length}`);
  assert.ok(tl.revision > 1, 'this run should have thinned more than once');

  const rebuilt = readAll(tl);
  assert.equal(rebuilt.length, tl.length);
  // Whatever survived must be positions the game really passed through — matched by
  // `step`, then compared whole.
  for (const g of rebuilt) {
    const original = pushed.find(p => p.step === g.step);
    assert.ok(original, `rebuilt a frame at step ${g.step} that never happened`);
    assert.deepEqual(g, original, `frame at step ${g.step} is not the board that was pushed`);
  }
  // And the newest surviving frame must be a real position near the end.
  assert.ok(rebuilt[rebuilt.length - 1].step >= 80, 'the timeline lost its recent end');
});

test('every page rebuilds the same boards, whatever the page size', () => {
  const tl = new GridTimeline({ max: 40 });
  const acc = {};
  for (let i = 0; i < 120; i++) {
    if (i) acc[i % 30] = 'x' + i;
    tl.push(board(30, { ...acc }, { step: i }));
  }
  const byOne = readAll(tl, 1);
  const bySeven = readAll(tl, 7);
  const byAll = readAll(tl, 1000);
  assert.deepEqual(byOne, bySeven);
  assert.deepEqual(byOne, byAll);
  assert.equal(byOne.length, tl.length);
});

test('a page is self-contained and reports where it sits', () => {
  const tl = new GridTimeline({ max: 100 });
  for (let i = 0; i < 25; i++) tl.push(board(20, { [i % 20]: 'z' + i }, { step: i }));
  const page = tl.read(10, 5);
  assert.equal(page.from, 10);
  assert.equal(page.total, 25);
  assert.equal(page.frames.length, 5);
  assert.ok(page.frames[0].full, 'a page must open on a whole board so it stands alone');
  // Rebuilt from nothing but itself, it must match the same frames read from the start.
  let cur = null;
  const fromPage = page.frames.map(f => (cur = applyGridFrame(cur, f)));
  assert.deepEqual(fromPage, readAll(tl, 1000).slice(10, 15));
});

test('reset empties the timeline and moves the revision on', () => {
  const tl = new GridTimeline({ max: 100 });
  for (let i = 0; i < 12; i++) tl.push(board(10, {}, { step: i }));
  const before = tl.revision;
  tl.reset();
  assert.equal(tl.length, 0);
  assert.ok(tl.revision > before, 'a reader must be able to tell the timeline changed under it');
  // And it starts cleanly rather than diffing against the world it just forgot.
  tl.push(board(10, { 2: 'sea' }, { step: 99 }));
  assert.deepEqual(readAll(tl), [board(10, { 2: 'sea' }, { step: 99 })]);
});

test('a timeline stores diffs, not a stack of boards', () => {
  const tl = new GridTimeline({ max: 1000 });
  const acc = {};
  for (let i = 0; i < 200; i++) {
    if (i) acc[i] = 'forest';                 // one cell changes per position
    tl.push(board(400, { ...acc }));
  }
  const whole = tl.frames.filter(f => f.full).length;
  assert.equal(whole, 1, 'only the first frame should carry a whole board');
  const patched = tl.frames.reduce((n, f) => n + (f.patch?.length ?? 0), 0);
  // 200 positions x 400 cells = 80,000 cell-copies if stored whole; ~199 as diffs.
  assert.ok(patched < 400, `expected a few hundred changed cells, got ${patched}`);
});
