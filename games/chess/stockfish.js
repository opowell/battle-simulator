// ---------------------------------------------------------------------------
// Stockfish backend — a standalone, vendored UCI engine (no install required).
//
// We bundle Stockfish 11 (single-threaded WASM build) under ./vendor. It is the
// strong evaluator the Obscuro subgame scores its leaves with. Everything
// degrades gracefully: if the vendored files are missing or the engine fails to
// load, `available()` returns false and the agents fall back to the JS search.
//
// Runs identically in Node and in the browser — same UCI protocol, same
// multiPV/bestMove/evaluate API — just a different transport underneath:
//   - Node: the engine lives in a worker thread (vendor/sf-worker.cjs), a thin
//     bridge that requires the vendored CommonJS loader directly.
//   - Browser: vendor/stockfish.cjs is ALSO the upstream stockfish.js browser
//     build (github.com/nmrugg/stockfish.js) — loaded as a classic (non-module)
//     Worker, it self-detects `importScripts` and bootstraps its own
//     onmessage/postMessage UCI bridge, fetching vendor/stockfish.wasm relative
//     to its own script URL. Both files are already served byte-for-byte over
//     HTTP (api-server.js's serveLibModule, under /lib/), so no build step is
//     needed to reach the browser — see apps/design/analysis-worker.js, which
//     runs this module inside its own (nested) Worker.
// Either way the engine is torn down and respawned periodically (maybeRecycle)
// rather than reused indefinitely: the WASM heap grows with use and eventually
// aborts with "memory access out of bounds", and only tearing down the whole
// worker reclaims that memory (a fresh in-process instance shares the same
// linear memory).
// ---------------------------------------------------------------------------

import { toFEN, uciToAction } from './fen.js';

// This module is imported both server-side (Node) and inside the browser
// analysis Web Worker (apps/design/analysis-worker.js), which pulls in the whole
// chess graph. Node's worker_threads/url/path/fs don't exist in a browser, so
// they're loaded lazily behind an isNode guard.
const isNode = typeof process !== 'undefined' && !!process.versions?.node;
const isBrowser = !isNode && typeof Worker !== 'undefined';
let Worker_, fileURLToPath, path, fs;
if (isNode) {
  ({ Worker: Worker_ } = await import('worker_threads'));
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
// Sibling URL to this module's own — resolves correctly however this file was
// itself fetched (mounted under a base path, served from /lib/, etc.).
const BROWSER_ENGINE_URL = isBrowser ? new URL('./vendor/stockfish.cjs', import.meta.url).href : '';

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
// Exported so games/chess/obscuro-settings.js can list it alongside every
// other fog-chess default.
export const RECYCLE_AFTER = 400;

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
export const CACHE_MAX = 20_000;

// SQLite state (used when DatabaseSync is available)
let db = null, stmtGet, stmtSet, stmtTouch, stmtEvict;
let sqliteSize = 0, lruSeq = 0;

// NDJSON fallback state
let sfCache = null;

function loadCache() {
  if (!isNode) { if (!sfCache) sfCache = new Map(); return; } // browser: in-memory only, no disk
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
// Node and browser share everything past this point (send/request/multiPV/…);
// only how a line handler gets attached and how the worker is constructed differ.
function init() {
  if (readyPromise) return readyPromise;
  readyPromise = new Promise((resolve) => {
    if (!isNode && !isBrowser) return resolve(false); // neither Node nor a real Worker ctor available

    let w;
    if (isNode) {
      if (!fs.existsSync(WORKER_PATH) || !fs.existsSync(WASM_PATH)) return resolve(false);
      try { w = new Worker_(WORKER_PATH); } catch { return resolve(false); }
    } else {
      // Classic (non-module) Worker: vendor/stockfish.cjs self-bootstraps its
      // own UCI onmessage/postMessage bridge when it detects it's running as a
      // Worker (typeof importScripts === 'function') — see the file's own
      // tail. It fetches vendor/stockfish.wasm synchronously relative to its
      // own script URL, which BROWSER_ENGINE_URL already points at.
      try { w = new Worker(BROWSER_ENGINE_URL); } catch { return resolve(false); }
    }
    worker = w;

    let settled = false;
    const finish = (ok) => { if (settled) return; settled = true; resolve(ok); };

    const onReady = (line) => {
      if (line.startsWith('readyok')) { listeners = listeners.filter(x => x !== onReady); finish(true); }
    };
    listeners.push(onReady);

    const onLine = (line) => {
      if (typeof line !== 'string') return;
      if (line.startsWith('__error__')) { finish(false); return; } // engine failed to construct (Node bridge only)
      for (const l of [...listeners]) l(line);
    };
    // An abort inside the WASM (the "memory access out of bounds" fault) kills
    // the worker — surfaced here as an error/exit — but not this process. Drop
    // the dead worker so the next call respawns a fresh one; any in-flight
    // request falls through to its timeout.
    const die = () => {
      finish(false); // no-op once ready; fails the handshake if still loading
      if (worker === w) { worker = null; readyPromise = null; }
      failAllPending(); // an in-flight search will never complete now
    };
    if (isNode) {
      w.on('message', onLine);
      w.on('error', die);
      w.on('exit', die);
    } else {
      w.onmessage = (e) => onLine(e.data);
      w.onerror = die;
    }

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
  if (w) {
    if (isNode) { w.removeAllListeners(); w.terminate().catch(() => {}); }
    else w.terminate();
  }
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
  if (old) {
    if (isNode) { old.removeAllListeners(); try { await old.terminate(); } catch { /* ignore */ } }
    else old.terminate();
  }
  await init();
}

// How often an in-flight search re-checks its caller's `isCancelled` (see below).
export const STOP_POLL_MS = 100;

// Run one UCI request, collecting lines until `isDone(line)` returns a result.
// Serialised behind `queue` so only one search runs at a time.
//
// `opts.isCancelled` lets a caller interrupt a search that is already running.
// Cancellation used to take effect only BETWEEN calls, which was fine when every
// call was a sub-second shallow search; on the iterative-deepening ladder a
// single deep rung can run for tens of seconds, so a position change or an
// expired move clock would otherwise be felt a whole rung late. Sending the UCI
// `stop` command makes the engine emit its current-best `bestmove` immediately —
// which the line handler already resolves on, so there is no new resolution
// path. `opts.onStopped` fires when that happens, so the caller can tell a
// truncated result (shallower than the depth it asked for) from a complete one.
function request(commands, isDone, timeoutMs, { isCancelled, onStopped } = {}) {
  const run = async () => {
    await maybeRecycle();
    if (!(await init())) return null; // ensure a live worker (respawns if it crashed)
    callsSinceLoad++;
    return new Promise((resolve) => {
      let settled = false;
      let timer, poll;
      const done = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(poll);
        listeners = listeners.filter(x => x !== handler);
        pending.delete(abort);
        resolve(result);
      };
      const handler = (line) => { const r = isDone(line); if (r !== undefined) done(r); };
      const abort = () => done(null); // worker died — give up now, don't wait for the timeout
      listeners.push(handler);
      pending.add(abort);
      try { for (const c of commands) send(c); } catch { /* fall through to timeout */ }
      if (isCancelled) {
        poll = setInterval(() => {
          if (settled || !isCancelled()) return;
          clearInterval(poll); poll = null;
          onStopped?.();
          try { send('stop'); } catch { /* engine gone — the timeout still fires */ }
        }, STOP_POLL_MS);
      }
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
 *
 * `isCancelled` interrupts an in-flight search (see request above): the engine
 * returns whatever it had reached instead of running the depth out. A result cut
 * short that way is NOT cached — it is shallower than the `depth` its cache key
 * claims — and `onStopped` fires so the caller can treat it as truncated.
 */
export async function multiPV(fen, { multipv = 10, depth = 2, onInfo, isCancelled, onStopped } = {}) {
  if (!(await init())) return null;
  loadCache();
  const key = `${fen}|${multipv}|${depth}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  const best = new Map(); // multipv index -> { move, cp } (kept at the deepest seen)
  let lastReportedDepth = 0;
  let stopped = false;
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
    { isCancelled, onStopped: () => { stopped = true; onStopped?.(); } },
  );
  if (result !== null && !stopped) cacheSet(key, result);
  return result;
}

// Difficulty is a 0–100 number (0 = weakest, 100 = strongest). Legacy string
// tiers are mapped onto the scale so old saved sessions keep working.
export const LEGACY_DIFFICULTY = { easy: 10, medium: 35, hard: 65, expert: 90 };
export function difficultyToNumber(difficulty) {
  const n = typeof difficulty === 'number' ? difficulty : (LEGACY_DIFFICULTY[difficulty] ?? 25);
  return n < 0 ? 0 : n > 100 ? 100 : n;
}

// Map difficulty (0–100) to engine strength (Skill Level 0–20) and time per
// move. Endpoints re-exported via games/chess/obscuro-settings.js's
// SF_DIFFICULTY_RAMP for documentation; this function is the source of truth.
export const SF_DIFFICULTY_RAMP = {
  movetimeMs: { min: 50, max: 1000 },
  skill: { min: 0, max: 20 },
};
export function sfOptsForDifficulty(difficulty) {
  const t = difficultyToNumber(difficulty) / 100;
  const { movetimeMs, skill } = SF_DIFFICULTY_RAMP;
  return {
    movetime: Math.round(movetimeMs.min + t * (movetimeMs.max - movetimeMs.min)),
    skill: Math.round(skill.min + t * (skill.max - skill.min)),
  };
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
