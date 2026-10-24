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
import { applyGridFrame as applyFrame } from './src/engine/gridFrames.js';

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

// The watched battle: Arena on a wide open field, so that a turn moves a few of
// its squares and most of the board stays as it was.
const FIELD = { width: 40, height: 24, map: 'open' };

/** A paused, observer-paced Arena battle with `n` AI seats, plus an observer socket. */
async function watchedBattle(n = 4, agent = 'random') {
  const s = await post('/sessions', {
    game: 'arena',
    players: Array.from({ length: n }, (_, i) => ({ id: 'p' + (i + 1), agent })),
    config: { fog: true, allowObservers: true, ...FIELD },
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

// THE REAL CLIENT. apps/browser/play/api.js is a plain browser script that hangs its API off
// `window`, so give it a window pointed at the test server and run it — the delta
// rebuilding under test is the code the UI actually ships, not a restatement of it
// that could quietly drift out of step with the server it has to agree with.
let browserApi = null;
async function loadBrowserApi() {
  if (browserApi) return browserApi;
  const src = await readFile(resolve(ROOT, 'apps/browser/play/api.js'), 'utf8');
  // Left in place for the run, not restored around the call: the module's own
  // fallback paths reach back through `window.api` long after it has loaded.
  globalThis.window = { location: { pathname: '/', origin: BASE } };
  runInThisContext(src, { filename: 'apps/browser/play/api.js' });
  browserApi = globalThis.window.api;
  return browserApi;
}

test('a watched battle publishes one update per TURN, not per unit action', async () => {
  const s = await watchedBattle();
  const turns = [], logs = [];
  const done = new Promise((resolveDone) => {
    const seen = new Set();
    observe(s.id, async (msg) => {
      if (!msg.awaitingAdvance || seen.has(msg.seq)) return;
      seen.add(msg.seq);
      turns.push(msg.turn);
      // The run loop is parked on our ack, so the log read now is this update's.
      logs.push((await get(`/sessions/${s.id}?observer=1`)).log.length);
      if (seen.size >= 8) return resolveDone();
      await post(`/sessions/${s.id}/control`, { advance: msg.seq });
    });
  });
  const dl = deadline(60000, 'waiting for 8 updates');
  await Promise.race([done, dl.promise]); dl.clear();

  // Each update moves the game on by exactly one turn...
  for (let i = 1; i < turns.length; i++) {
    assert.equal(turns[i] - turns[i - 1], 1, `update ${i} advanced ${turns[i] - turns[i - 1]} turns`);
  }
  // ...and carries every seat's actions in it, not one unit's: four seats of five
  // units each act several times a turn.
  const singles = logs.slice(1).filter((n, i) => n - logs[i] <= 1).length;
  assert.ok(singles <= 1, `${singles} of ${logs.length - 1} updates carried only one action`);
});

test('the shipped client rebuilds exactly the snapshot a full fetch gives', async () => {
  const api = await loadBrowserApi();
  const s = await watchedBattle();
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
  const s = await watchedBattle();
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
  const s = await watchedBattle();
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
  const s = await watchedBattle();
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

/** Watch a battle through to its end, acking every update, and return it. */
async function playWatchedBattle(maxTurns) {
  const s = await post('/sessions', {
    game: 'arena',
    players: Array.from({ length: 4 }, (_, i) => ({ id: 'p' + (i + 1), agent: 'random' })),
    config: { fog: true, allowObservers: true, maxTurns, ...FIELD },
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
  const dl = deadline(120000, 'playing a battle out');
  await Promise.race([done, dl.promise]); dl.clear();
  return s;
}

test('the scrub timeline rebuilds to the boards the game passed through', async () => {
  const api = await loadBrowserApi();
  // Long enough to need more than one page, short enough that the timeline has not
  // been thinned — while it is still sampling every position, the newest frame IS
  // the final board, which is the one anchor to a source outside this machinery.
  const s = await playWatchedBattle(22);

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
  // survive thinning is settled deterministically in src/engine/gridFrames.test.js, which
  // drives a timeline past its cap many times over and checks every surviving frame
  // against the board that produced it.
  const s = await playWatchedBattle(70);
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
  const s = await playWatchedBattle(12);
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
    game: 'arena',
    players: [{ id: 'p1', agent: 'human' }, { id: 'p2', agent: 'random' }],
    config: { fog: true },
  });
  assert.equal(s.observerPaced, false, 'a game with a human seat paces itself');
  const seen = [];
  observe(s.id, (msg) => seen.push(msg), '?player=p1');
  await sleep(1500);
  assert.ok(seen.length > 0, 'the player socket received nothing');
  for (const msg of seen) {
    assert.equal(msg.delta, undefined, 'a fog seat must get whole snapshots');
    assert.equal(msg.gridPatch, undefined);
    assert.ok(Array.isArray(msg.grid?.cells), 'a fog seat must get a whole board');
  }
});

// ---------------------------------------------------------------------------
// A board's static parts (src/engine/gridStatics.js): a shape map's terrain is sent
// once per connection (and not at all to a REST caller that says it holds it), and
// the shipped client puts it back so nothing downstream sees a board without it.
// ---------------------------------------------------------------------------

test('a shape map\'s terrain goes over a socket once, and the shipped client puts it back', async () => {
  const api = await loadBrowserApi();
  const s = await post('/sessions', {
    game: 'arena',
    players: [{ id: 'p1', agent: 'human' }, { id: 'p2', agent: 'random' }],
    config: { spec: 'library:cs/de_dust2' },
  });
  // A caller that says nothing gets whole boards, each field named by its key.
  const whole = await get(`/sessions/${s.id}?player=p1`);
  assert.ok(whole.grid.shapes.length > 5, 'a shape map has shapes');
  assert.ok(whole.grid.statics?.shapes, 'the shapes should be named by key');
  const raw = [];
  observe(s.id, (msg) => raw.push(msg), '?player=p1');
  const got = [];
  const sub = api.subscribeSession(s.id, 'p1', (full) => got.push(full));
  try {
    await sleep(1000);
    // Acting through the shipped client: its request names what it holds, and the
    // move makes the server push the seat a fresh snapshot.
    const answered = await api.action(s.id, 'p1', whole.legalActions.find(a => a.type === 'move'));
    await sleep(1500);
    const ref = await get(`/sessions/${s.id}?player=p1`);
    for (const [what, snap] of [['the action\'s answer', answered], ['the last pushed update', got.at(-1)]]) {
      assert.deepEqual(snap.grid.shapes, ref.grid.shapes, `${what} lost its terrain`);
      assert.deepEqual(snap.grid.cells, ref.grid.cells, `${what} lost its cells`);
    }
    assert.ok(got.length >= 2, `the client saw ${got.length} updates`);
  } finally { sub.close(); }

  assert.ok(raw[0].grid.shapes, 'the first message on a socket carries the terrain');
  const later = raw.slice(1).filter(m => m.grid);
  assert.ok(later.length >= 1, 'no later message to check');
  for (const m of later) {
    assert.equal(m.grid.shapes, undefined, 'a later message re-sent the terrain');
    assert.equal(m.grid.statics.shapes, raw[0].grid.statics.shapes);
  }
  const lean = await fetch(`${BASE}/sessions/${s.id}?player=p1`, { headers: { 'x-grid-have': whole.grid.statics.shapes } }).then(r => r.json());
  assert.equal(lean.grid.shapes, undefined, 'a REST caller holding the terrain is not sent it again');
  assert.equal(lean.grid.statics.shapes, whole.grid.statics.shapes);

  // The browser opens a new socket every turn: one that names the terrain it holds
  // is not sent it even first — and the shipped client, which names what it holds,
  // still hands its consumer whole boards from a new subscription.
  const named = [];
  observe(s.id, (msg) => named.push(msg), `?player=p1&have=${whole.grid.statics.shapes}`);
  const again = [];
  const sub2 = api.subscribeSession(s.id, 'p1', (full) => again.push(full));
  try { await sleep(1000); } finally { sub2.close(); }
  assert.ok(named[0]?.grid, 'the named socket was sent nothing');
  assert.equal(named[0].grid.shapes, undefined, 'a socket that holds the terrain was sent it anyway');
  assert.ok(again[0], 'the second subscription saw nothing');
  assert.deepEqual(again[0].grid.shapes, whole.grid.shapes, 'a new subscription lost the terrain');
});

test('a socket that asks to resync is sent the terrain again', async () => {
  const s = await post('/sessions', {
    game: 'arena',
    players: [{ id: 'p1', agent: 'human' }, { id: 'p2', agent: 'random' }],
    config: { spec: 'library:cs/de_dust2' },
  });
  const seen = [];
  const ws = observe(s.id, (msg) => seen.push(msg), '?player=p1');
  await sleep(800);
  assert.ok(seen[0]?.grid?.shapes, 'the first message carries the terrain');
  ws.send(JSON.stringify({ resync: true }));
  await sleep(800);
  assert.ok(seen.length >= 2, 'the resync was not answered');
  assert.ok(seen.at(-1).grid.shapes, 'a resync must re-send the terrain');
});

// ---------------------------------------------------------------------------
// Customised starting units (src/engine/startingSetup.js) over the wire: what a
// setup screen asks for, and what a session created from its answer plays.
// ---------------------------------------------------------------------------

// Two humans on Arena's open field: 12×8 of open ground, five units a side.
const TWO = [{ id: 'p1', name: 'One', agent: 'human' }, { id: 'p2', name: 'Two', agent: 'human' }];
const OPEN = { width: 12, height: 8, map: 'open' };

test('a game hands out its opening roster, and a session can be created from an edited one', async () => {
  const preview = await post('/games/arena/setup', { players: TWO, config: OPEN });
  assert.equal(preview.roster.length, 10);
  assert.equal(preview.placeable, true);
  assert.equal(preview.board.width, 12);
  // Each unit comes back with the board cell it stands on, so a setup screen can
  // draw it without knowing how the game writes a position.
  for (const u of preview.roster) assert.deepEqual(u.cell, [u.position.x, u.position.y]);

  // Play it without cavalry, and with p1's archer started in the middle.
  const roster = preview.roster
    .filter(u => u.type !== 'cavalry')
    .map(u => (u.ownerId === 'p1' && u.type === 'archer' ? { ...u, position: { x: 6, y: 4 } } : u))
    .map(({ id, ownerId, type, position }) => ({ id, ownerId, type, position }));
  const s = await post('/sessions', { game: 'arena', players: TWO, config: { ...OPEN, startingUnits: roster } });
  const snap = await get(`/sessions/${s.id}?player=p1`);
  // Arena draws its units as tokens (grid.units), at their squares.
  assert.equal(snap.grid.units.length, 8, 'the two cavalry should not be on the board');
  const middle = snap.grid.units.find(u => u.x === 6 && u.y === 4);
  assert.equal(middle?.type, 'archer', "p1's archer should be standing in the middle");
  // ...and the game is really played from there.
  const moves = snap.legalActions.filter(a => a.from?.x === 6 && a.from?.y === 4);
  assert.ok(moves.length > 5, `an archer in the open should have moves, got ${moves.length}`);
});

test('a roster the game cannot build is refused with a reason', async () => {
  const bad = await post('/sessions', {
    game: 'arena',
    players: TWO,
    config: { ...OPEN, startingUnits: [{ ownerId: 'p1', type: 'dragon', position: { x: 4, y: 4 } }] },
  });
  assert.match(bad.error ?? '', /not a starting unit type/);
});

test('an Arena session can field units from the library, drawn as themselves', async () => {
  const players = [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }];
  const preview = await post('/games/arena/setup', { players, config: {} });
  const sc1 = preview.foreign.find(g => g.game === 'sc1');
  assert.ok(sc1, 'Arena should be offered SC1\'s units from the library');
  const marine = sc1.units.find(u => u.type === 'marine');
  assert.ok(marine.plays.p1.chassis, 'a marine plays as one of Arena\'s own types');
  assert.equal(marine.imagePath, '/library/sc1/art/units/marine.png');

  const taken = new Set(preview.roster.map(u => JSON.stringify(u.position)));
  const spot = preview.board.cells.find(c => c.pos != null && !taken.has(JSON.stringify(c.pos))).pos;
  const roster = [
    ...preview.roster.map(({ id, ownerId, type, position }) => ({ id, ownerId, type, position })),
    { ownerId: 'p1', type: 'marine', game: 'sc1', position: spot },
  ];
  const s = await post('/sessions', {
    game: 'arena',
    players: [{ id: 'p1', agent: 'human' }, { id: 'p2', agent: 'human' }],
    config: { ...preview.config, startingUnits: roster },
  });
  const snap = await get(`/sessions/${s.id}?player=p1`);
  const drawn = [...(snap.grid.cells ?? []), ...(snap.grid.units ?? [])].find(c => c?.origin?.game === 'sc1');
  assert.ok(drawn, 'the marine is on the board');
  assert.equal(drawn.imagePath, '/library/sc1/art/units/marine.png', 'drawn as a marine, not as the Arena type it plays as');
  assert.equal(drawn.origin.type, 'marine');

  // The in-game editor reads it back as the marine it was asked for.
  const live = await post(`/sessions/${s.id}/setup`, { config: {}, by: 'p1' });
  assert.deepEqual(live.roster.filter(u => u.game).map(u => [u.game, u.type]), [['sc1', 'marine']]);

  const bad = await post('/sessions', {
    game: 'arena',
    players: [{ id: 'p1', agent: 'human' }, { id: 'p2', agent: 'human' }],
    config: { ...preview.config, startingUnits: [...roster, { ownerId: 'p2', type: 'dragon', game: 'sc1', position: spot }] },
  });
  assert.match(bad.error ?? '', /not a unit of SC1/);
});

test('the browser catalog lists every game and what it defines, and sees a session as it starts', async () => {
  const games = await get('/games');
  const before = await get('/catalog');
  assert.deepEqual(before.games.filter(g => g.live).map(g => g.name).sort(), games.map(g => g.name).sort());
  const arena = before.games.find(g => g.name === 'arena');
  assert.equal(arena.units, 6, 'Arena has six unit types');
  assert.equal(before.units.filter(u => u.game === 'arena').reduce((n, u) => n + u.starting, 0), 10);
  assert.equal(arena.scenarios, before.scenarios.filter(s => s.game === 'arena').length);

  const s = await post('/sessions', { game: 'arena', players: TWO, config: {} });
  const after = await get('/catalog');
  const session = after.sessions.find(x => x.id === s.id);
  assert.equal(session.game, 'arena');
  assert.equal(session.humans, 2);
  assert.equal(after.games.find(g => g.name === 'arena').sessions, arena.sessions + 1);
});

test('the appfr framework is served for the browser: its modules and stylesheet only', async () => {
  const js = await fetch(BASE + '/appfr/index.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.equal((await fetch(BASE + '/appfr/style.css')).status, 200);
  assert.equal((await fetch(BASE + '/appfr/index.d.ts')).status, 404);
});

test('the browser is served at the root, its files from /ui/browser/, and its old addresses land there', async () => {
  const page = await fetch(BASE + '/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<base href="\/ui\/browser\/"\/>/);
  assert.equal((await fetch(BASE + '/ui/browser/App.vue')).status, 200);
  for (const old of ['/ui/browser/', '/ui/console/', '/ui/design', '/design']) {
    const r = await fetch(BASE + old + '?w=x', { redirect: 'manual' });
    assert.equal(r.status, 302, old);
    assert.equal(new URL(r.headers.get('location'), BASE).pathname + new URL(r.headers.get('location'), BASE).search, '/?w=x', old);
  }
});

// ── Changing settings mid-game (Session.reconfigure, src/engine/reconfigure.js) ──

/** A two-human battle after p1 has moved one unit and ended its turn — p2 to move. */
async function afterFirstMove(config = {}) {
  const s = await post('/sessions', { game: 'arena', players: TWO, config: { ...OPEN, ...config } });
  let snap = await get(`/sessions/${s.id}?player=p1`);
  const move = snap.legalActions.find(a => a.type === 'move');
  snap = await post(`/sessions/${s.id}/action`, { playerId: 'p1', action: move });
  const end = snap.legalActions.find(a => a.type === 'end-turn');
  await post(`/sessions/${s.id}/action`, { playerId: 'p1', action: end });
  return { id: s.id, moved: { unitId: move.unitId, to: move.to } };
}

/** Wait until `seat` is being asked for a move (the run loop re-asks asynchronously). */
async function pendingFor(id, seat) {
  for (let i = 0; i < 100; i++) {
    const snap = await get(`/sessions/${id}?player=${seat}`);
    if (snap.pendingPlayer === seat && snap.legalActions?.length) return snap;
    await sleep(20);
  }
  throw new Error(`${seat} was never asked to move`);
}

test('fog switched on mid-game patches the position, and the game plays on', async () => {
  const { id } = await afterFirstMove();
  const r = await post(`/sessions/${id}/reconfigure`, { config: { fogOfWar: true }, by: 'p2' });
  assert.equal(r.applied, 'patch');
  assert.deepEqual(r.change.options, [{ key: 'fogOfWar', from: null, to: true }]);
  assert.equal(r.change.by, 'p2');
  const snap = await pendingFor(id, 'p2');
  assert.equal(snap.fog, true);
  assert.equal(snap.log.length, 2, 'the move and the turn already played are still the game');
  assert.equal(snap.changes.length, 1);
  // History replays the patch at the ply it landed, so it reads the same as the game.
  const hist = await get(`/sessions/${id}/history`);
  assert.ok(Array.isArray(hist) || Array.isArray(hist.frames));
  const reply = snap.legalActions.find(a => a.type === 'move');
  const after = await post(`/sessions/${id}/action`, { playerId: 'p2', action: reply });
  assert.equal(after.status, 'active', after.error ?? '');
  assert.equal(after.log.length, 3);
});

test('switching to continuous space mid-game rebuilds the battle with every unit where it stood', async () => {
  const { id, moved } = await afterFirstMove();
  const r = await post(`/sessions/${id}/reconfigure`, { config: { space: 'continuous' }, by: 'p1' });
  assert.equal(r.applied, 'rebuild');
  assert.equal(r.change.rebuilt, true);
  const snap = await pendingFor(id, 'p2');
  assert.deepEqual(snap.activePlayers ?? [snap.pendingPlayer], ['p2'], 'still p2 to move');
  assert.equal(snap.log.length, 0, 'a rebuilt game starts a segment of its own');
  assert.equal(snap.earlierLog.length, 2, 'with the moves played before it still there to read');
  // Continuous space draws units as bodies at points (grid.units), not on cells:
  // the unit that moved stands at the centre of the square it moved to.
  const units = snap.grid.units ?? [];
  assert.equal(units.length, 10);
  const mover = units.find(u => u.id === moved.unitId);
  assert.ok(mover, 'the unit that moved is on the board');
  assert.deepEqual([mover.x, mover.y], [moved.to.x + 0.5, moved.to.y + 0.5]);
  assert.ok(snap.legalActions.length > 0, 'p2 can move in the rebuilt game');
});

test('a seat handed from a human to an AI is played by the AI from then on', async () => {
  const { id } = await afterFirstMove();
  await pendingFor(id, 'p2');
  const r = await post(`/sessions/${id}/reconfigure`, { players: [{ id: 'p2', agent: 'random' }], by: 'p2' });
  assert.equal(r.applied, 'seats');
  assert.deepEqual(r.change.seats, [{ seat: 'p2', field: 'player', from: 'human', to: 'random' }]);
  // The AI plays its turn out, and it is p1's move again.
  const snap = await pendingFor(id, 'p1');
  assert.ok(snap.log.length > 2, 'the AI played');
});

test('units added and removed mid-game go onto the game as it stands', async () => {
  const { id } = await afterFirstMove();
  const preview = await post(`/sessions/${id}/setup`, { config: {}, by: 'p1' });
  assert.equal(preview.rebuild, false);
  assert.equal(preview.roster.length, 10);
  const gone = preview.roster.find(u => u.ownerId === 'p2');
  const units = preview.roster
    .filter(u => u !== gone)
    .map(({ id: uid, ownerId, type, position }) => ({ id: uid, ownerId, type, position }))
    .concat([{ ownerId: 'p1', type: 'knight', position: { x: 6, y: 4 } }]);
  const r = await post(`/sessions/${id}/reconfigure`, { units, by: 'p1' });
  assert.equal(r.applied, 'rebuild');
  assert.equal(r.change.unitsEdited, true);
  const snap = await pendingFor(id, 'p2');
  assert.equal(snap.grid.units.length, 10, 'one unit off, one on');
  assert.equal(snap.grid.units.find(u => u.x === 6 && u.y === 4)?.type, 'knight', 'the new knight stands in the middle');
  assert.deepEqual(snap.activePlayers ?? ['p2'], ['p2'], 'and it is still p2 to move');
});

test('under fog the units editor shows a seat only what it can see, and an edit leaves the rest alone', async () => {
  const { id } = await afterFirstMove({ fogOfWar: true });
  const preview = await post(`/sessions/${id}/setup`, { by: 'p1' });
  assert.ok(preview.hiddenUnits > 0, 'some of p2 is out of p1\'s sight');
  assert.equal(preview.roster.length + preview.hiddenUnits, 10);
  // p1 edits with only what it can see — and p2's hidden units survive it.
  const units = preview.roster.map(({ id: uid, ownerId, type, position }) => ({ id: uid, ownerId, type, position }));
  const r = await post(`/sessions/${id}/reconfigure`, { units, by: 'p1' });
  assert.equal(r.applied, 'rebuild');
  const all = await post(`/sessions/${id}/setup`, { by: 'p2' });
  assert.equal(all.roster.length + (all.hiddenUnits ?? 0), 10, 'no unit was lost to the fog');
});

test('a change that cannot be made is refused, and the game is left exactly as it was', async () => {
  const { id } = await afterFirstMove();
  const before = await pendingFor(id, 'p2');
  const bad = await post(`/sessions/${id}/reconfigure`, { players: [{ id: 'p2', agent: 'grandmaster' }] });
  assert.match(bad.error ?? '', /Unknown player type/);
  const alone = await post(`/sessions/${id}/reconfigure`, { units: [{ ownerId: 'p1', type: 'knight', position: { x: 1, y: 1 } }] });
  assert.match(alone.error ?? '', /p2 must start with at least one unit/);
  const after = await pendingFor(id, 'p2');
  assert.equal(after.changes.length, 0);
  assert.equal(after.log.length, before.log.length);
});

test('settings changed while two AIs are playing land between moves, and the game goes on', async () => {
  const s = await post('/sessions', {
    game: 'arena',
    players: [{ id: 'p1', agent: 'random' }, { id: 'p2', agent: 'random' }],
    config: { aiDelay: 5, maxTurns: 400 },
  });
  await sleep(60);
  const r1 = await post(`/sessions/${s.id}/reconfigure`, { config: { fogOfWar: true } });
  assert.equal(r1.error, undefined);
  const r2 = await post(`/sessions/${s.id}/reconfigure`, { config: { space: 'continuous' } });
  assert.equal(r2.error, undefined);
  await sleep(150);
  const snap = await get(`/sessions/${s.id}`);
  assert.notEqual(snap.status, 'error', snap.error);
  assert.equal(snap.changes.length, 2);
  await fetch(`${BASE}/sessions/${s.id}`, { method: 'DELETE' });
});
