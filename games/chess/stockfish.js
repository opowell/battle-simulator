// ---------------------------------------------------------------------------
// Stockfish backend — a standalone, vendored UCI engine (no install required).
//
// We bundle Stockfish 11 (single-threaded WASM build) under ./vendor and load
// it in-process in Node. This is the strong perfect-information evaluator the
// Obscuro paper uses at its search leaves; here we use it directly to pick the
// move when we have full information. Everything degrades gracefully: if the
// vendored files are missing or the engine fails to load, `available()` returns
// false and the agents fall back to the built-in JS search.
//
// Quirk handled below: the vendored build predates Node's global `fetch`, and
// its Emscripten loader mistakes `fetch` for a browser and tries to fetch the
// .wasm as a URL. We temporarily remove `globalThis.fetch` during load so it
// uses the Node filesystem path instead, then restore it.
// ---------------------------------------------------------------------------

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { toFEN, uciToAction } from './fen.js';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
// Loaded via require() so it must be CommonJS; the repo is "type":"module", so
// the vendored loader carries a .cjs extension to opt out of ESM.
const JS_PATH = path.join(HERE, 'vendor', 'stockfish.cjs');
const WASM_PATH = path.join(HERE, 'vendor', 'stockfish.wasm');

let engine = null;
let readyPromise = null;
let listeners = [];          // line handlers currently attached to onmessage
let queue = Promise.resolve(); // serialises searches (UCI is single-threaded/stateful)

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
try { ({ DatabaseSync } = await import('node:sqlite')); } catch {}

const CACHE_PATH_SQLITE = path.join(HERE, 'vendor', 'sf-cache.sqlite');
const CACHE_PATH_NDJSON = path.join(HERE, 'vendor', 'sf-cache.ndjson');
const CACHE_MAX = 20_000;

// SQLite state (used when DatabaseSync is available)
let db = null, stmtGet, stmtSet, stmtTouch, stmtEvict;
let sqliteSize = 0, lruSeq = 0;

// NDJSON fallback state
let sfCache = null;

function loadCache() {
  if (DatabaseSync) {
    if (db) return;
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
  } else {
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
    const row = stmtGet.get(key);
    if (!row) return undefined;
    stmtTouch.run(++lruSeq, key);
    return JSON.parse(row.value);
  }
  const v = sfCache.get(key);
  if (v === undefined) return undefined;
  sfCache.delete(key); sfCache.set(key, v); // move to end (LRU)
  return v;
}

function cacheSet(key, value) {
  if (db) {
    const isNew = !stmtGet.get(key);
    if (isNew && sqliteSize >= CACHE_MAX) { stmtEvict.run(); sqliteSize--; }
    stmtSet.run(key, JSON.stringify(value), ++lruSeq);
    if (isNew) sqliteSize++;
  } else {
    if (sfCache.size >= CACHE_MAX && !sfCache.has(key)) sfCache.delete(sfCache.keys().next().value);
    sfCache.delete(key); sfCache.set(key, value);
    try { fs.appendFileSync(CACHE_PATH_NDJSON, JSON.stringify([key, value]) + '\n'); } catch { /* ignore */ }
  }
}

function send(cmd) { engine.postMessage(cmd, true); }

// Lazily load and hand-shake the engine. Resolves to true if usable.
function init() {
  if (readyPromise) return readyPromise;
  readyPromise = new Promise((resolve) => {
    if (!fs.existsSync(JS_PATH) || !fs.existsSync(WASM_PATH)) return resolve(false);

    let STOCKFISH;
    try { STOCKFISH = require(JS_PATH); } catch { return resolve(false); }

    const savedFetch = globalThis.fetch;
    globalThis.fetch = undefined; // force the Node fs path in the Emscripten loader
    try {
      engine = STOCKFISH(WASM_PATH);
    } catch {
      globalThis.fetch = savedFetch;
      return resolve(false);
    }

    let settled = false;
    const finish = (ok) => { if (settled) return; settled = true; globalThis.fetch = savedFetch; resolve(ok); };

    engine.onmessage = (raw) => {
      const line = String(raw == null ? '' : (raw.data ?? raw));
      for (const l of [...listeners]) l(line);
    };
    const onReady = (line) => {
      if (line.startsWith('readyok')) { listeners = listeners.filter(x => x !== onReady); finish(true); }
    };
    listeners.push(onReady);
    try { send('uci'); send('isready'); } catch { return finish(false); }
    setTimeout(() => finish(false), 8000); // load watchdog
  });
  return readyPromise;
}

/** Whether a usable Stockfish engine is loaded (async, memoised). */
export function available() { return init(); }

/** Best-effort shutdown (used by tests so the process can exit cleanly). */
export function quit() {
  try { if (engine) send('quit'); } catch { /* ignore */ }
  engine = null; readyPromise = null; listeners = [];
}

// Run one UCI request, collecting lines until `isDone(line)` returns a result.
// Serialised behind `queue` so only one search runs at a time.
function request(commands, isDone, timeoutMs) {
  const run = () => new Promise((resolve) => {
    let settled = false;
    const handler = (line) => {
      const r = isDone(line);
      if (r !== undefined && !settled) {
        settled = true;
        listeners = listeners.filter(x => x !== handler);
        resolve(r);
      }
    };
    listeners.push(handler);
    try { for (const c of commands) send(c); } catch { /* fall through to timeout */ }
    setTimeout(() => {
      if (!settled) { settled = true; listeners = listeners.filter(x => x !== handler); resolve(null); }
    }, timeoutMs);
  });
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
 */
export async function multiPV(fen, { multipv = 10, depth = 2 } = {}) {
  if (!(await init())) return null;
  loadCache();
  const key = `${fen}|${multipv}|${depth}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  const best = new Map(); // multipv index -> { move, cp } (kept at the deepest seen)
  const cmds = [`setoption name MultiPV value ${multipv}`, 'position fen ' + fen, 'go depth ' + depth];
  const result = await request(
    cmds,
    (line) => {
      const mpv = line.match(/ multipv (\d+) /);
      const sc = line.match(/ score (cp|mate) (-?\d+)/);
      const pv = line.match(/ pv (\S+)/);
      if (mpv && sc && pv) {
        const cp = sc[1] === 'cp'
          ? Number(sc[2])
          : (Number(sc[2]) > 0 ? 100000 - Number(sc[2]) : -100000 - Number(sc[2]));
        best.set(Number(mpv[1]), { move: pv[1], cp });
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
