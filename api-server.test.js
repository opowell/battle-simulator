// api-server.test.js — the observer WATCH path: how a pure-AI game is paced, batched
// and pushed to whoever is watching it.
//
// These run against a real server process over a real socket, because that is where
// the things being checked live: the lock-step handshake, the per-connection delta
// base, and the run loop's batching are all properties of the wire, not of a function.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from 'node:net';
import { readFile } from 'node:fs/promises';
import { runInThisContext } from 'node:vm';
import { applyGridFrame as applyFrame } from './engine/gridFrames.js';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const PORT = 4700 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;

let proc, sessionsDir;
// Every socket a test opens, closed in `after` — an open WebSocket (or a pending
// timer) keeps the event loop alive and the whole run hangs on it.
const openSockets = [];

const post = (path, body) => fetch(BASE + path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}).then(r => r.json());
const get = (path) => fetch(BASE + path).then(r => r.json());
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Resolve once the server is accepting connections (or throw after ~15s). */
async function waitForPort() {
  for (let i = 0; i < 150; i++) {
    const up = await new Promise((res) => {
      const sock = connect(PORT, '127.0.0.1');
      sock.on('connect', () => { sock.destroy(); res(true); });
      sock.on('error', () => res(false));
    });
    if (up) return;
    await sleep(100);
  }
  throw new Error('server did not start');
}

before(async () => {
  sessionsDir = await mkdtemp(join(tmpdir(), 'bs-sessions-'));
  proc = spawn(process.execPath, [resolve(ROOT, 'api-server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), BATTLE_SIM_SESSIONS_DIR: sessionsDir },
    stdio: 'ignore',
  });
  await waitForPort();
});

after(async () => {
  for (const ws of openSockets) { try { ws.close(); } catch {} }
  proc?.kill();
  if (sessionsDir) await rm(sessionsDir, { recursive: true, force: true });
});

/** A paused, observer-paced civ1 game with `n` AI seats, plus an observer socket. */
async function watchedCiv1(n = 4, agent = 'random') {
  const s = await post('/sessions', {
    game: 'civ1',
    players: Array.from({ length: n }, (_, i) => ({ id: 'p' + (i + 1), agent })),
    config: { fog: true, allowObservers: true },
  });
  assert.equal(s.observerPaced, true, 'a pure-AI game with observers should be observer-paced');
  await post(`/sessions/${s.id}/control`, { paused: false });
  return s;
}

/** Open an observer socket and hand each parsed message to `onMessage`. */
function observe(sessionId, onMessage, query = '?observer=1') {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/sessions/${sessionId}/ws${query}`);
  ws.onmessage = (ev) => onMessage(JSON.parse(ev.data), ws);
  openSockets.push(ws);
  return ws;
}

/** A promise that rejects after `ms`, on a timer that never holds the loop open. */
function deadline(ms, what) {
  let id;
  const p = new Promise((_, reject) => { id = setTimeout(() => reject(new Error('timed out ' + what)), ms); });
  id.unref?.();
  return { promise: p, clear: () => clearTimeout(id) };
}

// THE REAL CLIENT. apps/design/api.js is a plain browser script that hangs its API off
// `window`, so give it a window pointed at the test server and run it — the delta
// rebuilding under test is the code the UI actually ships, not a restatement of it
// that could quietly drift out of step with the server it has to agree with.
let browserApi = null;
async function loadBrowserApi() {
  if (browserApi) return browserApi;
  const src = await readFile(resolve(ROOT, 'apps/design/api.js'), 'utf8');
  // Left in place for the run, not restored around the call: the module's own
  // fallback paths reach back through `window.api` long after it has loaded.
  globalThis.window = { location: { pathname: '/ui/design/', origin: BASE } };
  runInThisContext(src, { filename: 'apps/design/api.js' });
  browserApi = globalThis.window.api;
  return browserApi;
}

test('watched civ1 publishes one update per TURN, not per unit action', async () => {
  const s = await watchedCiv1();
  const turns = [], simTimes = [];
  const done = new Promise((resolveDone) => {
    const seen = new Set();
    observe(s.id, async (msg) => {
      if (!msg.awaitingAdvance || seen.has(msg.seq)) return;
      seen.add(msg.seq);
      turns.push(msg.turn);
      simTimes.push(msg.stepSimTime);
      if (seen.size >= 8) return resolveDone();
      await post(`/sessions/${s.id}/control`, { advance: msg.seq });
    });
  });
  const dl = deadline(60000, 'waiting for 8 updates');
  await Promise.race([done, dl.promise]); dl.clear();

  // Each update moves the game on by exactly one turn.
  for (let i = 1; i < turns.length; i++) {
    assert.equal(turns[i] - turns[i - 1], 1, `update ${i} advanced ${turns[i] - turns[i - 1]} turns`);
  }
  // ...and carries a whole turn's worth of game-time, not one action's. civ1 prices an
  // action at 1 sim-second and scales the watch-pace by replayPaceMultiplier, so a
  // single-action update would come in at exactly that multiplier.
  const oneAction = 0.25;
  const singles = simTimes.filter(t => t != null && t <= oneAction * 1.001).length;
  assert.ok(singles <= 1, `${singles} of ${simTimes.length} updates carried only one action's game-time`);
});

test('the shipped client rebuilds exactly the snapshot a full fetch gives', async () => {
  const api = await loadBrowserApi();
  const s = await watchedCiv1();
  let checked = 0;
  let sub;
  const done = new Promise((resolveDone, rejectDone) => {
    const seen = new Set();
    // The client swallows exceptions thrown out of onUpdate (it must — a broken
    // consumer can't be allowed to kill the socket), so a failed assertion here
    // would otherwise surface only as this test timing out. Reject explicitly.
    sub = api.subscribeSession(s.id, null, async (full) => {
      try {
        if (!full?.awaitingAdvance) return;
        // The run loop is parked on our ack, so the shown position cannot move under
        // us: a full REST snapshot must equal what the client rebuilt from the patch.
        const ref = await get(`/sessions/${s.id}?observer=1`);
        assert.equal(ref.seq, full.seq, 'REST and socket disagree about which step is shown');
        assert.deepEqual(full.grid.cells, ref.grid.cells, 'rebuilt board differs from the real one');
        assert.deepEqual(full.log, ref.log, 'rebuilt log differs from the real one');
        assert.equal(full.turn, ref.turn);
        checked++;
        if (seen.has(full.seq)) return;
        seen.add(full.seq);
        if (seen.size >= 6) return resolveDone();
        await post(`/sessions/${s.id}/control`, { advance: full.seq });
      } catch (e) { rejectDone(e); }
    }, true, null);
  });
  const dl = deadline(60000, 'rebuilding snapshots');
  try { await Promise.race([done, dl.promise]); } finally { dl.clear(); sub?.close(); }
  assert.ok(checked >= 6, `only ${checked} snapshots were checked`);
});

test('a turn patches a handful of squares, not the whole board', async () => {
  const s = await watchedCiv1();
  let deltas = 0, patched = 0, boardCells = 0;
  const done = new Promise((resolveDone) => {
    const seen = new Set();
    observe(s.id, async (msg) => {
      if (msg.delta) { deltas++; patched += msg.gridPatch?.length ?? 0; }
      else boardCells = msg.grid?.cells?.length ?? boardCells;
      if (!msg.awaitingAdvance || seen.has(msg.seq)) return;
      seen.add(msg.seq);
      if (seen.size >= 6) return resolveDone();
      await post(`/sessions/${s.id}/control`, { advance: msg.seq });
    });
  });
  const dl = deadline(60000, 'measuring patches');
  await Promise.race([done, dl.promise]); dl.clear();

  assert.ok(deltas >= 4, `expected the observer to be sent deltas, got ${deltas}`);
  assert.ok(boardCells > 0, 'never saw a full board to compare against');
  assert.ok(patched / deltas < boardCells / 10,
    `patches averaged ${(patched / deltas).toFixed(1)} of ${boardCells} cells — not much of a saving`);
});

test('a client that cannot apply a delta can ask for a whole snapshot back', async () => {
  const s = await watchedCiv1();
  let asked = false, fullAfterAsk = 0;
  const done = new Promise((resolveDone) => {
    observe(s.id, async (msg, ws) => {
      if (asked) { if (!msg.delta) fullAfterAsk++; return; }
      if (!msg.awaitingAdvance) return;
      if (!msg.delta) { await post(`/sessions/${s.id}/control`, { advance: msg.seq }); return; }
      asked = true;                                   // we're mid-stream on deltas now
      ws.send(JSON.stringify({ resync: true }));
      setTimeout(resolveDone, 1500);
    });
  });
  const dl = deadline(60000, 'waiting for a resync');
  await Promise.race([done, dl.promise]); dl.clear();
  assert.equal(fullAfterAsk, 1, 'resync should be answered with exactly one full snapshot');
});

test('acking a step does not push a second copy of it', async () => {
  const s = await watchedCiv1();
  let msgs = 0;
  const done = new Promise((resolveDone) => {
    const seen = new Set();
    observe(s.id, async (msg) => {
      msgs++;
      if (!msg.awaitingAdvance || seen.has(msg.seq)) return;
      seen.add(msg.seq);
      if (seen.size >= 6) return resolveDone();
      await post(`/sessions/${s.id}/control`, { advance: msg.seq });
    });
  });
  const dl = deadline(60000, 'counting messages');
  await Promise.race([done, dl.promise]); dl.clear();
  // One message per update. The ack used to broadcast the whole snapshot straight
  // back — doubling everything a watched game pushes for no new information.
  assert.ok(msgs <= 7, `6 updates pushed ${msgs} messages; the ack is echoing again`);
});

/** Watch a civ1 game through to its end, acking every update, and return it. */
async function playWatchedCiv1(maxTurns) {
  const s = await post('/sessions', {
    game: 'civ1',
    players: Array.from({ length: 4 }, (_, i) => ({ id: 'p' + (i + 1), agent: 'random' })),
    config: { fog: true, allowObservers: true, maxTurns },
  });
  await post(`/sessions/${s.id}/control`, { paused: false });
  const done = new Promise((resolveDone) => {
    const seen = new Set();
    observe(s.id, async (msg) => {
      if (msg.status !== 'active') return resolveDone();
      if (!msg.awaitingAdvance || seen.has(msg.seq)) return;
      seen.add(msg.seq);
      await post(`/sessions/${s.id}/control`, { advance: msg.seq });
    });
  });
  const dl = deadline(120000, 'playing a civ1 game out');
  await Promise.race([done, dl.promise]); dl.clear();
  return s;
}

test('the scrub timeline rebuilds to the boards the game passed through', async () => {
  const api = await loadBrowserApi();
  // Long enough to need more than one page, short enough that the timeline has not
  // been thinned — while it is still sampling every position, the newest frame IS
  // the final board, which is the one anchor to a source outside this machinery.
  const s = await playWatchedCiv1(22);

  const first = await get(`/sessions/${s.id}/history?from=0&limit=200`);
  assert.ok(first.total > 200, `wanted a timeline long enough to page, got ${first.total}`);
  assert.equal(first.revision, 0, `wanted an un-thinned timeline, got revision ${first.revision}`);
  assert.equal(first.frames.length, 200, 'a page should be capped at the page size');
  assert.ok(first.frames[0].full, 'every page must open on a whole board');
  assert.ok(first.frames.slice(1).every(f => !f.full),
    'the rest of a page should be diffs, not whole boards again');

  // The shipped client pages through and rebuilds — the array App.vue consumes.
  const grids = await api.history(s.id);
  assert.equal(grids.length, first.total, 'the rebuilt timeline is short');

  const live = await get(`/sessions/${s.id}?observer=1`);
  assert.deepEqual(grids[grids.length - 1].cells, live.grid.cells,
    'the last frame of the timeline is not the final position');

  // Every frame must be a whole, well-formed board of its own.
  const n = grids[0].cells.length;
  for (let i = 0; i < grids.length; i++) {
    assert.equal(grids[i].cells.length, n, `frame ${i} has the wrong number of cells`);
    assert.ok(grids[i].cells.every(Boolean), `frame ${i} has a hole in it`);
    if (i) assert.notEqual(grids[i].cells, grids[i - 1].cells, `frame ${i} aliases its predecessor`);
  }
});

test('a long game keeps its timeline bounded and still rebuilds', async () => {
  const api = await loadBrowserApi();
  // Long enough to blow past MAX_GRID_HISTORY, so the timeline is thinned and frames
  // are folded into their successors.
  //
  // No comparison against the live board here: once thinning has doubled the sampling
  // stride, the last position only lands on the timeline if it falls on that stride,
  // so the newest frame legitimately trails the final board by a step. That is how
  // this has always sampled — unmodified main does the same, measured over repeated
  // runs — and it is not what these frames are for. Whether the DIFFS themselves
  // survive thinning is settled deterministically in engine/gridFrames.test.js, which
  // drives a timeline past its cap many times over and checks every surviving frame
  // against the board that produced it.
  const s = await playWatchedCiv1(70);
  const page = await get(`/sessions/${s.id}/history?from=0&limit=200`);
  // Bounded is the claim that always holds; whether THIS game happened to run long
  // enough to thin depends on how many actions its random seats took, so asserting it
  // would just be flaky.
  assert.ok(page.total < 600, `timeline should stay bounded, got ${page.total} frames`);

  const grids = await api.history(s.id);
  assert.equal(grids.length, page.total, 'the rebuilt timeline is short');
  const n = grids[0].cells.length;
  for (let i = 0; i < grids.length; i++) {
    assert.equal(grids[i].cells.length, n, `frame ${i} has the wrong number of cells`);
    assert.ok(grids[i].cells.every(Boolean), `frame ${i} has a hole in it`);
    if (i) assert.notEqual(grids[i].cells, grids[i - 1].cells, `frame ${i} aliases its predecessor`);
  }
});

test('history paging covers the timeline exactly once', async () => {
  const s = await playWatchedCiv1(12);
  const total = (await get(`/sessions/${s.id}/history?from=0&limit=1`)).total;
  // Walk it in small pages and rebuild each independently — pages are self-contained,
  // so page N must not need page N-1 to make sense.
  const seen = [];
  for (let from = 0; from < total; from += 37) {
    const page = await get(`/sessions/${s.id}/history?from=${from}&limit=37`);
    assert.equal(page.from, from);
    assert.ok(page.frames[0].full, `page at ${from} does not open on a whole board`);
    let cur = null;
    for (const f of page.frames) { cur = applyFrame(cur, f); seen.push(cur); }
  }
  assert.equal(seen.length, total, 'paging did not cover the timeline exactly once');

  // Independently-paged frames must match the ones read in one go.
  const whole = [];
  let cur = null;
  for (let from = 0; from < total; from += 200) {
    const page = await get(`/sessions/${s.id}/history?from=${from}&limit=200`);
    cur = null;
    for (const f of page.frames) { cur = applyFrame(cur, f); whole.push(cur); }
  }
  assert.equal(seen.length, whole.length);
  for (let i = 0; i < seen.length; i++) {
    assert.deepEqual(seen[i].cells, whole[i].cells, `frame ${i} differs between page sizes`);
  }
});

test('a fog player seat is never sent deltas', async () => {
  const s = await post('/sessions', {
    game: 'chess',
    players: [{ id: 'white', agent: 'human' }, { id: 'black', agent: 'random' }],
    config: { fog: true },
  });
  assert.equal(s.observerPaced, false, 'a game with a human seat paces itself');
  const seen = [];
  observe(s.id, (msg) => seen.push(msg), '?player=white');
  await sleep(1500);
  assert.ok(seen.length > 0, 'the player socket received nothing');
  for (const msg of seen) {
    assert.equal(msg.delta, undefined, 'a fog seat must get whole snapshots');
    assert.equal(msg.gridPatch, undefined);
    assert.ok(Array.isArray(msg.grid?.cells), 'a fog seat must get a whole board');
  }
});
