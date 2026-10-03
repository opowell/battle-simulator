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

// ---------------------------------------------------------------------------
// Customised starting units (engine/startingSetup.js) over the wire: what a
// setup screen asks for, and what a session created from its answer plays.
// ---------------------------------------------------------------------------

test('a game hands out its opening roster, and a session can be created from an edited one', async () => {
  const players = [{ id: 'white', name: 'White' }, { id: 'black', name: 'Black' }];
  const preview = await post('/games/chess/setup', { players, config: {} });
  assert.equal(preview.roster.length, 32);
  assert.equal(preview.placeable, true);
  assert.equal(preview.board.width, 8);
  // Each unit comes back with the board cell it stands on, so a setup screen can
  // draw it without knowing chess reads positions as 'e4'.
  const whiteKing = preview.roster.find(u => u.ownerId === 'white' && u.type === 'king');
  assert.deepEqual(whiteKing.cell, [4, 7]);

  // Play it without knights, and with white's queen started on d4.
  const roster = preview.roster
    .filter(u => u.type !== 'knight')
    .map(u => (u.ownerId === 'white' && u.type === 'queen' ? { ...u, position: 'd4' } : u))
    .map(({ id, ownerId, type, position }) => ({ id, ownerId, type, position }));
  const s = await post('/sessions', {
    game: 'chess',
    players: [{ id: 'white', agent: 'human' }, { id: 'black', agent: 'human' }],
    config: { startingUnits: roster },
  });
  const snap = await get(`/sessions/${s.id}?player=white`);
  const occupied = snap.grid.cells.filter(c => c.unitId);
  assert.equal(occupied.length, 28, 'the four knights should not be on the board');
  const d4 = snap.grid.cells.find(c => c.x === 3 && c.y === 4);
  assert.ok(d4.unitId, "white's queen should be standing on d4");
  // ...and the game is really played from there: the queen has moves a queen on
  // d1 behind a pawn wall could not have.
  const moves = snap.legalActions.filter(a => a.from === 'd4');
  assert.ok(moves.length > 5, `a queen on d4 should have moves, got ${moves.length}`);
});

test('a roster the game cannot build is refused with a reason', async () => {
  const bad = await post('/sessions', {
    game: 'chess',
    players: [{ id: 'white', agent: 'human' }, { id: 'black', agent: 'human' }],
    config: { startingUnits: [{ ownerId: 'white', type: 'dragon', position: 'e4' }] },
  });
  assert.match(bad.error ?? '', /not a starting unit type/);
});

test('a session can field units of other games, drawn as themselves', async () => {
  const players = [{ id: 'white', name: 'White' }, { id: 'black', name: 'Black' }];
  const preview = await post('/games/chess/setup', { players, config: {} });
  const sc1 = preview.foreign.find(g => g.game === 'sc1');
  assert.ok(sc1, 'chess should be offered SC1\'s units');
  assert.equal(sc1.units.find(u => u.type === 'zergling').plays.white.chassis, 'pawn');

  const roster = [
    ...preview.roster.map(({ id, ownerId, type, position }) => ({ id, ownerId, type, position })),
    { ownerId: 'white', type: 'zergling', game: 'sc1', position: 'e4' },
  ];
  const s = await post('/sessions', {
    game: 'chess',
    players: [{ id: 'white', agent: 'human' }, { id: 'black', agent: 'human' }],
    config: { startingUnits: roster },
  });
  const snap = await get(`/sessions/${s.id}?player=white`);
  const e4 = snap.grid.cells.find(c => c.x === 4 && c.y === 4);
  assert.equal(e4.imagePath, '/images/sc1/units/zergling', 'drawn as a zergling, not as the pawn it plays as');
  assert.deepEqual(e4.origin, { game: 'sc1', type: 'zergling', chassis: 'pawn' });
  assert.ok(snap.legalActions.some(a => a.from === 'e4'), 'and it moves, as a pawn');

  // The in-game editor reads it back as the zergling it was asked for.
  const live = await post(`/sessions/${s.id}/setup`, { config: {}, by: 'white' });
  assert.deepEqual(live.roster.filter(u => u.game).map(u => [u.game, u.type]), [['sc1', 'zergling']]);

  const bad = await post('/sessions', {
    game: 'chess',
    players: [{ id: 'white', agent: 'human' }, { id: 'black', agent: 'human' }],
    config: { startingUnits: [...roster, { ownerId: 'black', type: 'dragon', game: 'sc1', position: 'e5' }] },
  });
  assert.match(bad.error ?? '', /not a unit of SC1/);
});

test('the console catalog lists every game and what it defines, and sees a session as it starts', async () => {
  const games = await get('/games');
  const before = await get('/catalog');
  assert.deepEqual(before.games.filter(g => g.live).map(g => g.name).sort(), games.map(g => g.name).sort());
  const chess = before.games.find(g => g.name === 'chess');
  assert.equal(chess.units, 6, 'chess has six piece types');
  assert.equal(before.units.filter(u => u.game === 'chess').reduce((n, u) => n + u.starting, 0), 32);
  assert.equal(chess.scenarios, before.scenarios.filter(s => s.game === 'chess').length);

  const s = await post('/sessions', {
    game: 'chess',
    players: [{ id: 'white', name: 'W', agent: 'human' }, { id: 'black', name: 'B', agent: 'human' }],
    config: {},
  });
  const after = await get('/catalog');
  const session = after.sessions.find(x => x.id === s.id);
  assert.equal(session.game, 'chess');
  assert.equal(session.humans, 2);
  assert.equal(after.games.find(g => g.name === 'chess').sessions, chess.sessions + 1);
});

test('the appfr framework is served for the console: its modules and stylesheet only', async () => {
  const js = await fetch(BASE + '/appfr/index.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.equal((await fetch(BASE + '/appfr/style.css')).status, 200);
  assert.equal((await fetch(BASE + '/appfr/index.d.ts')).status, 404);
});

// ── Changing settings mid-game (Session.reconfigure, engine/reconfigure.js) ──

/** A two-human chess game after 1. e4 — black to move. */
async function chessAfterE4(config = {}) {
  const s = await post('/sessions', {
    game: 'chess',
    players: [{ id: 'white', name: 'W', agent: 'human' }, { id: 'black', name: 'B', agent: 'human' }],
    config,
  });
  const snap = await get(`/sessions/${s.id}?player=white`);
  const e4 = snap.legalActions.find(a => a.from === 'e2' && a.to === 'e4');
  await post(`/sessions/${s.id}/action`, { playerId: 'white', action: e4 });
  return s.id;
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
  const id = await chessAfterE4();
  const r = await post(`/sessions/${id}/reconfigure`, { config: { fogOfWar: true }, by: 'black' });
  assert.equal(r.applied, 'patch');
  assert.deepEqual(r.change.options, [{ key: 'fogOfWar', from: null, to: true }]);
  assert.equal(r.change.by, 'black');
  const snap = await pendingFor(id, 'black');
  assert.equal(snap.fog, true);
  assert.equal(snap.log.length, 1, 'the move already played is still the game');
  assert.equal(snap.changes.length, 1);
  // History replays the patch at the ply it landed, so it reads the same as the game.
  const hist = await get(`/sessions/${id}/history`);
  assert.ok(Array.isArray(hist) || Array.isArray(hist.frames));
  const reply = snap.legalActions.find(a => a.from === 'e7' && a.to === 'e5');
  const after = await post(`/sessions/${id}/action`, { playerId: 'black', action: reply });
  assert.equal(after.status, 'active', after.error ?? '');
  assert.equal(after.log.length, 2);
});

test('switching chess to continuous space mid-game rebuilds it with every piece where it stood', async () => {
  const id = await chessAfterE4();
  const r = await post(`/sessions/${id}/reconfigure`, { config: { space: 'continuous' }, by: 'white' });
  assert.equal(r.applied, 'rebuild');
  assert.equal(r.change.rebuilt, true);
  const snap = await pendingFor(id, 'black');
  assert.deepEqual(snap.activePlayers ?? [snap.pendingPlayer], ['black'], 'still black to move');
  assert.equal(snap.log.length, 0, 'a rebuilt game starts a segment of its own');
  assert.equal(snap.earlierLog.length, 1, 'with the move played before it still there to read');
  // Continuous space draws pieces as bodies at points (grid.units), not on cells.
  // The e-pawn that went to e4 stands at the centre of e4 — file 4, row 4 — and
  // nothing is left on e2.
  const at = (x, y) => (snap.grid.units ?? []).filter(u => u.x === x && u.y === y);
  assert.equal(at(4.5, 4.5).length, 1, 'a piece stands at the centre of e4');
  assert.equal(at(4.5, 4.5)[0].type, 'pawn');
  assert.equal(at(4.5, 6.5).length, 0, 'and not where it came from');
  assert.equal((snap.grid.units ?? []).length, 32);
  assert.ok(snap.legalActions.length > 0, 'black can move in the rebuilt game');
});

test('a seat handed from a human to an AI is played by the AI from then on', async () => {
  const id = await chessAfterE4();
  await pendingFor(id, 'black');
  const r = await post(`/sessions/${id}/reconfigure`, { players: [{ id: 'black', agent: 'random' }], by: 'black' });
  assert.equal(r.applied, 'seats');
  assert.deepEqual(r.change.seats, [{ seat: 'black', field: 'player', from: 'human', to: 'random' }]);
  // The AI answers, and it is white's move again.
  const snap = await pendingFor(id, 'white');
  assert.equal(snap.log.length, 2);
});

test('units added and removed mid-game go onto the game as it stands', async () => {
  const id = await chessAfterE4();
  const preview = await post(`/sessions/${id}/setup`, { config: {}, by: 'white' });
  assert.equal(preview.rebuild, false);
  assert.equal(preview.roster.length, 32);
  const knight = preview.roster.find(u => u.ownerId === 'black' && u.type === 'knight');
  const units = preview.roster
    .filter(u => u !== knight)
    .map(({ id: uid, ownerId, type, position }) => ({ id: uid, ownerId, type, position }))
    .concat([{ ownerId: 'white', type: 'queen', position: 'd4' }]);
  const r = await post(`/sessions/${id}/reconfigure`, { units, by: 'white' });
  assert.equal(r.applied, 'rebuild');
  assert.equal(r.change.unitsEdited, true);
  const snap = await pendingFor(id, 'black');
  const pieces = snap.grid.cells.filter(c => c.unitId);
  assert.equal(pieces.length, 32, 'one knight off, one queen on');
  assert.ok(snap.grid.cells.find(c => c.x === 3 && c.y === 4)?.unitId, 'the new queen stands on d4');
  assert.deepEqual(snap.activePlayers ?? ['black'], ['black'], 'and it is still black to move');
});

test('under fog the units editor shows a seat only what it can see, and an edit leaves the rest alone', async () => {
  const id = await chessAfterE4({ fogOfWar: true });
  const preview = await post(`/sessions/${id}/setup`, { by: 'white' });
  assert.ok(preview.hiddenUnits > 0, 'some of black is out of white\'s sight');
  assert.equal(preview.roster.length + preview.hiddenUnits, 32);
  // White edits with only what it can see — and black's hidden pieces survive it.
  const units = preview.roster.map(({ id: uid, ownerId, type, position }) => ({ id: uid, ownerId, type, position }));
  const r = await post(`/sessions/${id}/reconfigure`, { units, by: 'white' });
  assert.equal(r.applied, 'rebuild');
  const all = await post(`/sessions/${id}/setup`, { by: 'black' });
  assert.equal(all.roster.length + (all.hiddenUnits ?? 0), 32, 'no piece was lost to the fog');
});

test('a unit added to a civ game in progress keeps its cities, its map and its turn', async () => {
  const s = await post('/sessions', {
    game: 'civ1',
    players: [{ id: 'p1', name: 'A', agent: 'human' }, { id: 'p2', name: 'B', agent: 'human' }],
    config: {},
  });
  const snap = await pendingFor(s.id, 'p1');
  const found = snap.legalActions.find(a => a.type === 'found-city');
  assert.ok(found, 'the opening settlers can found a city');
  await post(`/sessions/${s.id}/action`, { playerId: 'p1', action: found });
  const before = await get(`/sessions/${s.id}/state`);
  assert.equal(before.cities.length, 1);

  const preview = await post(`/sessions/${s.id}/setup`, { by: 'p1' });
  assert.equal(preview.rebuild, false, 'adding a unit changes no setting');
  const home = preview.roster.find(u => u.ownerId === 'p1');
  const units = preview.roster.map(({ id: uid, ownerId, type, position }) => ({ id: uid, ownerId, type, position }))
    .concat([{ ownerId: 'p1', type: home.type, position: home.position }]);
  const r = await post(`/sessions/${s.id}/reconfigure`, { units, by: 'p1' });
  assert.equal(r.error, undefined);

  const after = await get(`/sessions/${s.id}/state`);
  assert.equal(after.cities.length, 1, 'the city founded is still there');
  assert.equal(after.cities[0].name, before.cities[0].name);
  assert.equal(after.units.filter(u => u.alive !== false).length, before.units.filter(u => u.alive !== false).length + 1);
  assert.equal(after.turnNumber, before.turnNumber);
  assert.deepEqual(after.activePlayers, before.activePlayers);
  assert.equal(JSON.stringify(after.board.tiles), JSON.stringify(before.board.tiles), 'on the very same map');
});

test('a change that cannot be made is refused, and the game is left exactly as it was', async () => {
  const id = await chessAfterE4();
  const before = await pendingFor(id, 'black');
  const bad = await post(`/sessions/${id}/reconfigure`, { players: [{ id: 'black', agent: 'grandmaster' }] });
  assert.match(bad.error ?? '', /Unknown player type/);
  const noKing = await post(`/sessions/${id}/reconfigure`, { units: [{ ownerId: 'white', type: 'king', position: 'e1' }] });
  assert.match(noKing.error ?? '', /black must start with at least one unit/);
  const after = await pendingFor(id, 'black');
  assert.equal(after.changes.length, 0);
  assert.equal(after.log.length, before.log.length);
});

test('settings changed while two AIs are playing land between moves, and the game goes on', async () => {
  const s = await post('/sessions', {
    game: 'chess',
    players: [{ id: 'white', agent: 'random' }, { id: 'black', agent: 'random' }],
    config: { aiDelay: 5, maxTurns: 400 },
  });
  await sleep(60);
  const r1 = await post(`/sessions/${s.id}/reconfigure`, { config: { difficulty: 60 } });
  assert.equal(r1.error, undefined);
  const r2 = await post(`/sessions/${s.id}/reconfigure`, { config: { space: 'continuous' } });
  assert.equal(r2.error, undefined);
  await sleep(150);
  const snap = await get(`/sessions/${s.id}`);
  assert.notEqual(snap.status, 'error', snap.error);
  assert.equal(snap.changes.length, 2);
  await fetch(`${BASE}/sessions/${s.id}`, { method: 'DELETE' });
});
