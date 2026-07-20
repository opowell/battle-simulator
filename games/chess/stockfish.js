// ---------------------------------------------------------------------------
// Stockfish backend — a standalone, vendored UCI engine (no install required).
//
// We bundle Stockfish 11 (single-threaded WASM build) under ./vendor. It is the
// strong evaluator the Obscuro subgame scores its leaves with. Everything
// degrades gracefully: if the vendored files are missing or the engine fails to
// load, `available()` returns false and the agents fall back to the JS search.
//
// The engine is loaded inside a worker thread (vendor/sf-worker.cjs) rather than
// in-process, for one reason: the WASM heap grows with use and eventually aborts
// with "memory access out of bounds", and only tearing down a whole worker
// reclaims that memory (a fresh in-process instance shares the same linear
// memory). We therefore recycle the worker periodically and respawn it if it
// ever crashes — see maybeRecycle / init below. (The fetch-hiding quirk the
// Emscripten loader needs now lives in the worker.)
// ---------------------------------------------------------------------------

import { toFEN, uciToAction } from './fen.js';

// This module is imported both server-side (Node) and inside the browser
// analysis Web Worker (apps/design/analysis-worker.js), which pulls in the whole
// chess graph. Node's worker_threads/url/path/fs don't exist in a browser, so
// they're loaded lazily behind an isNode guard: in the browser Stockfish is
// simply unavailable (`available()` → false) and callers fall back to the JS
// search or, for the analysis panel, fetch centipawn evals from the server.
const isNode = typeof process !== 'undefined' && !!process.versions?.node;
let Worker, fileURLToPath, path, fs;
if (isNode) {
  ({ Worker } = await import('worker_threads'));
  ({ fileURLToPath } = await import('url'));
  path = (await import('path')).default;
  fs = (await import('fs')).default;
}

const HERE = isNode ? path.dirname(fileURLToPath(import.meta.url)) : '';
// The engine runs inside this worker (see sf-worker.cjs) so it can be terminated
// and respawned to reclaim WASM memory. Both are .cjs to opt out of the repo's
// ESM default and match the vendored CommonJS loader.
const WORKER_PATH = isNode ? path.join(HERE, 'vendor', 'sf-worker.cjs') : '';
const WASM_PATH = isNode ? path.join(HERE, 'vendor', 'stockfish.wasm') : '';

let worker = null;
let readyPromise = null;
let listeners = [];          // line handlers currently attached to the engine output
let queue = Promise.resolve(); // serialises searches (UCI is single-threaded/stateful)

// The vendored Stockfish WASM accrues heap memory across searches and, in a
// long-lived process, eventually aborts with "memory access out of bounds". An
// in-process reload cannot reclaim it — a fresh instance shares the same linear
// memory — so the engine lives in a worker thread that we terminate + respawn:
// proactively every RECYCLE_AFTER searches (below the observed failure point),
// and reactively if it ever does abort (the worker dies, this process does not).
let callsSinceLoad = 0;
const RECYCLE_AFTER = 400;

// Abort callbacks for in-flight requests. When the worker dies mid-search we
// call these to resolve each pending request as null immediately, rather than
// leaving it to wait out its (multi-second) timeout.
const pending = new Set();
function failAllPending() { for (const abort of [...pending]) abort(); }

// ---------------------------------------------------------------------------
// Disk-backed LRU cache for multiPV results. multiPV is deterministic given
// (fen, depth, multipv) so results are safe to cache across turns and games.
// bestMove uses movetime (non-deterministic) so is intentionally not cached.
//
// Uses node:sqlite (Node >= 22.5) when available: O(1) reads/writes, proper
// LRU via a monotonic sequence column, no compaction needed.
// Falls back to append-only NDJSON on older Node: each entry is one JSON
// line "[key,value]\n" — a single append is atomic so a killed process can't
// corrupt existing lines. Duplicates are compacted on startup when >50% stale.
// ---------------------------------------------------------------------------
let DatabaseSync = null;
if (isNode) { try { ({ DatabaseSync } = await import('node:sqlite')); } catch {} }

const CACHE_PATH_SQLITE = isNode ? path.join(HERE, 'vendor', 'sf-cache.sqlite') : '';
const CACHE_PATH_NDJSON = isNode ? path.join(HERE, 'vendor', 'sf-cache.ndjson') : '';
const CACHE_MAX = 20_000;

// SQLite state (used when DatabaseSync is available)
let db = null, stmtGet, stmtSet, stmtTouch, stmtEvict;
let sqliteSize = 0, lruSeq = 0;

// NDJSON fallback state
let sfCache = null;

function loadCache() {
  if (!isNode) return; // no disk cache in the browser
  if (DatabaseSync && !sfCache) {
    if (db) return;
    // Concurrent processes (e.g. parallel test files) share this DB; a busy
    // lock can throw anywhere in here. Never leave `db` half-initialised —
    // fall back to the in-memory/NDJSON path instead of crashing callers.
    try {
      db = new DatabaseSync(CACHE_PATH_SQLITE);
      db.exec(`CREATE TABLE IF NOT EXISTS cache (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        lru   INTEGER NOT NULL DEFAULT 0
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS cache_lru ON cache(lru)');
      stmtGet   = db.prepare('SELECT value FROM cache WHERE key = ?');
      stmtSet   = db.prepare('INSERT OR REPLACE INTO cache(key, value, lru) VALUES(?, ?, ?)');
      stmtTouch = db.prepare('UPDATE cache SET lru = ? WHERE key = ?');
      stmtEvict = db.prepare('DELETE FROM cache WHERE key = (SELECT key FROM cache ORDER BY lru LIMIT 1)');
      const row = db.prepare('SELECT COUNT(*) as n, COALESCE(MAX(lru), 0) as m FROM cache').get();
      sqliteSize = row.n; lruSeq = row.m;
      return;
    } catch {
      try { db?.close(); } catch { /* ignore */ }
      db = null; // degrade to the NDJSON/in-memory path below
    }
  }
  {
    if (sfCache) return;
    sfCache = new Map();
    let lineCount = 0;
    try {
      for (const line of fs.readFileSync(CACHE_PATH_NDJSON, 'utf8').split('\n')) {
        if (!line) continue;
        try { const [k, v] = JSON.parse(line); sfCache.delete(k); sfCache.set(k, v); lineCount++; }
        catch { /* corrupt line — skip */ }
      }
    } catch { /* missing — start fresh */ }
    while (sfCache.size > CACHE_MAX) sfCache.delete(sfCache.keys().next().value);
    if (lineCount > sfCache.size * 1.5) compactNdjson();
  }
}

function compactNdjson() {
  try { fs.writeFileSync(CACHE_PATH_NDJSON, [...sfCache.entries()].map(e => JSON.stringify(e)).join('\n') + '\n'); }
  catch { /* ignore */ }
}

function cacheGet(key) {
  if (db) {
    // A concurrent writer can make any sqlite op throw (SQLITE_BUSY); a cache
    // miss is always an acceptable answer.
    try {
      const row = stmtGet.get(key);
      if (!row) return undefined;
      stmtTouch.run(++lruSeq, key);
      return JSON.parse(row.value);
    } catch { return undefined; }
  }
  if (!sfCache) return undefined;
  const v = sfCache.get(key);
  if (v === undefined) return undefined;
  sfCache.delete(key); sfCache.set(key, v); // move to end (LRU)
  return v;
}

function cacheSet(key, value) {
  if (db) {
    try {
      const isNew = !stmtGet.get(key);
      if (isNew && sqliteSize >= CACHE_MAX) { stmtEvict.run(); sqliteSize--; }
      stmtSet.run(key, JSON.stringify(value), ++lruSeq);
      if (isNew) sqliteSize++;
    } catch { /* busy — skip this write */ }
  } else if (sfCache) {
    if (sfCache.size >= CACHE_MAX && !sfCache.has(key)) sfCache.delete(sfCache.keys().next().value);
    sfCache.delete(key); sfCache.set(key, value);
    try { fs.appendFileSync(CACHE_PATH_NDJSON, JSON.stringify([key, value]) + '\n'); } catch { /* ignore */ }
  }
}

function send(cmd) { if (worker) worker.postMessage(cmd); }

// Spawn the engine worker and hand-shake it. Resolves true once usable.
function init() {
  if (readyPromise) return readyPromise;
  readyPromise = new Promise((resolve) => {
    if (!isNode) return resolve(false); // browser: Stockfish runs server-side only
    if (!fs.existsSync(WORKER_PATH) || !fs.existsSync(WASM_PATH)) return resolve(false);

    let w;
    try { w = new Worker(WORKER_PATH); } catch { return resolve(false); }
    worker = w;

    let settled = false;
    const finish = (ok) => { if (settled) return; settled = true; resolve(ok); };

    const onReady = (line) => {
      if (line.startsWith('readyok')) { listeners = listeners.filter(x => x !== onReady); finish(true); }
    };
    listeners.push(onReady);

    w.on('message', (line) => {
      if (typeof line !== 'string') return;
      if (line.startsWith('__error__')) { finish(false); return; } // engine failed to construct
      for (const l of [...listeners]) l(line);
    });
    // An abort inside the WASM (the "memory access out of bounds" fault) kills
    // the worker — surfaced here as 'error'/'exit' — but not this process. Drop
    // the dead worker so the next call respawns a fresh one; any in-flight
    // request falls through to its timeout.
    const die = () => {
      finish(false); // no-op once ready; fails the handshake if still loading
      if (worker === w) { worker = null; readyPromise = null; }
      failAllPending(); // an in-flight search will never complete now
    };
    w.on('error', die);
    w.on('exit', die);

    send('uci'); send('isready');
    setTimeout(() => finish(false), 8000); // load watchdog
  });
  return readyPromise;
}

/** Whether a usable Stockfish engine is loaded (async, memoised). */
export function available() { return init(); }

/** Best-effort shutdown (used by tests so the process can exit cleanly). */
export function quit() {
  const w = worker;
  worker = null; readyPromise = null; listeners = [];
  failAllPending();
  if (w) { w.removeAllListeners(); w.terminate().catch(() => {}); }
}

// Terminate the worker and spawn a fresh one once the search budget is spent, so
// WASM heap growth never reaches the abort. Runs inside the serialised queue
// (between requests), so no search is ever interrupted. Terminating a whole
// worker (vs. reloading in-process) is what actually reclaims the memory.
async function maybeRecycle() {
  if (callsSinceLoad < RECYCLE_AFTER) return;
  callsSinceLoad = 0;
  const old = worker;
  worker = null; readyPromise = null; listeners = [];
  if (old) { old.removeAllListeners(); try { await old.terminate(); } catch { /* ignore */ } }
  await init();
}

// Run one UCI request, collecting lines until `isDone(line)` returns a result.
// Serialised behind `queue` so only one search runs at a time.
function request(commands, isDone, timeoutMs) {
  const run = async () => {
    await maybeRecycle();
    if (!(await init())) return null; // ensure a live worker (respawns if it crashed)
    callsSinceLoad++;
    return new Promise((resolve) => {
      let settled = false;
      let timer;
      const done = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        listeners = listeners.filter(x => x !== handler);
        pending.delete(abort);
        resolve(result);
      };
      const handler = (line) => { const r = isDone(line); if (r !== undefined) done(r); };
      const abort = () => done(null); // worker died — give up now, don't wait for the timeout
      listeners.push(handler);
      pending.add(abort);
      try { for (const c of commands) send(c); } catch { /* fall through to timeout */ }
      timer = setTimeout(() => done(null), timeoutMs);
    });
  };
  const p = queue.then(run);
  queue = p.catch(() => {});
  return p;
}

/**
 * Best move for a FEN, as a UCI string (e.g. "e2e4"), or null.
 * @param {string} fen
 * @param {{movetime?:number, skill?:number|null}} [opts]
 */
export async function bestMove(fen, { movetime = 300, skill = null } = {}) {
  if (!(await init())) return null;
  const cmds = ['setoption name MultiPV value 1'];
  if (skill != null) cmds.push(`setoption name Skill Level value ${skill}`);
  cmds.push('position fen ' + fen, 'go movetime ' + movetime);
  const uci = await request(cmds, line => (line.startsWith('bestmove') ? (line.split(/\s+/)[1] || null) : undefined), movetime + 5000);
  return uci && uci !== '(none)' ? uci : null;
}

/**
 * Static-ish evaluation of a FEN in centipawns from the side-to-move's view, or
 * null. (Exposed for future use as a leaf evaluator; the agents currently use
 * bestMove directly.)
 */
export async function evaluate(fen, { movetime = 100 } = {}) {
  if (!(await init())) return null;
  let last = null;
  const val = await request(
    ['setoption name MultiPV value 1', 'position fen ' + fen, 'go movetime ' + movetime],
    (line) => {
      const m = line.match(/score (cp|mate) (-?\d+)/);
      if (m) last = m[1] === 'cp' ? Number(m[2]) : (m[2] > 0 ? 100000 - Number(m[2]) : -100000 - Number(m[2]));
      return line.startsWith('bestmove') ? last : undefined;
    },
    movetime + 5000,
  );
  return val;
}

/**
 * Evaluate the top `multipv` moves of a position in a single call — the paper's
 * batched node heuristic ("MultiPV at low depth gives evaluations for all
 * children at once"). Returns [{ move, cp }] with scores from the side-to-move's
 * perspective, or null. Used to score the fog subgame's leaves cheaply.
 *
 * `onInfo({ depth, candidates })` is optional and fires once per completed
 * iterative-deepening depth (as Stockfish's own `info depth N ...` lines
 * arrive, keyed off the multipv-1 line so it's one tick per depth rather than
 * one per multipv slot), letting a caller show live search progress the way
 * lichess does. Purely a side channel — the awaited return value is unchanged.
 */
export async function multiPV(fen, { multipv = 10, depth = 2, onInfo } = {}) {
  if (!(await init())) return null;
  loadCache();
  const key = `${fen}|${multipv}|${depth}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  const best = new Map(); // multipv index -> { move, cp } (kept at the deepest seen)
  let lastReportedDepth = 0;
  const cmds = [`setoption name MultiPV value ${multipv}`, 'position fen ' + fen, 'go depth ' + depth];
  const result = await request(
    cmds,
    (line) => {
      const dm = line.match(/^info depth (\d+)/);
      const mpv = line.match(/ multipv (\d+) /);
      const sc = line.match(/ score (cp|mate) (-?\d+)/);
      const pv = line.match(/ pv (\S+)/);
      if (mpv && sc && pv) {
        const cp = sc[1] === 'cp'
          ? Number(sc[2])
          : (Number(sc[2]) > 0 ? 100000 - Number(sc[2]) : -100000 - Number(sc[2]));
        best.set(Number(mpv[1]), { move: pv[1], cp });
      }
      if (onInfo && dm && mpv?.[1] === '1') {
        const d = Number(dm[1]);
        if (d !== lastReportedDepth) { lastReportedDepth = d; onInfo({ depth: d, candidates: [...best.values()] }); }
      }
      return line.startsWith('bestmove') ? [...best.values()] : undefined;
    },
    depth * 400 + 5000,
  );
  if (result !== null) cacheSet(key, result);
  return result;
}

// Difficulty is a 0–100 number (0 = weakest, 100 = strongest). Legacy string
// tiers are mapped onto the scale so old saved sessions keep working.
const LEGACY_DIFFICULTY = { easy: 10, medium: 35, hard: 65, expert: 90 };
export function difficultyToNumber(difficulty) {
  const n = typeof difficulty === 'number' ? difficulty : (LEGACY_DIFFICULTY[difficulty] ?? 25);
  return n < 0 ? 0 : n > 100 ? 100 : n;
}

// Map difficulty (0–100) to engine strength (Skill Level 0–20) and time per move.
export function sfOptsForDifficulty(difficulty) {
  const t = difficultyToNumber(difficulty) / 100;
  return { movetime: Math.round(50 + t * 950), skill: Math.round(t * 20) };
}

/**
 * Pick the best action for a *fully observed* position using Stockfish, or null
 * if the engine is unavailable / the move can't be mapped. Only valid with
 * perfect information (the board must be complete — never call under fog).
 */
export async function stockfishBestAction(state, legalActions, opts = {}) {
  if (!(await init())) return null;
  const us = state.activePlayers[0];
  const fen = toFEN(state.board, state.gameSpecific, us === 'white' ? 'w' : 'b', state.turnNumber ?? 1);
  const uci = await bestMove(fen, opts);
  return uci ? uciToAction(uci, legalActions) : null;
}
