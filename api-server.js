/**
 * HTTP API server for the battle-simulator engine.
 *
 * Endpoints:
 *   GET  /games                       List available games and their default players
 *   POST /sessions                    Create a session
 *   GET  /sessions                    List sessions
 *   GET  /sessions/:id                Get session state
 *   POST /sessions/:id/action         Submit an action for the pending player
 *   POST /sessions/:id/resign         Surrender the match as a given player
 *   DELETE /sessions/:id              Delete a session
 */

import { createServer }          from 'node:http';
import { randomUUID }            from 'node:crypto';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, resolve, sep, dirname } from 'node:path';
import { fileURLToPath }         from 'node:url';


import { WebSocketServer } from './vendor/ws/wrapper.mjs';

import { GameEngine } from './engine/index.js';
import { validate as validateAction } from './engine/ActionValidator.js';
import * as gameEditor from './gameEditor.js';
import { RandomAgent } from './agents/index.js';
import { ApiAgent } from './agents/ApiAgent.js';
import { ObscuroAgent } from './agents/ObscuroAgent.js';
import { makeGreedyAgent } from './agents/GreedyAgent.js';

import { ChessGame }         from './games/chess/index.js';
import { TacticalGame }      from './games/tactical/index.js';
import { CardBattleGame }    from './games/cardbattle/index.js';
import { Civ1Game }          from './games/civ1/index.js';
import { Civ2Game }          from './games/civ2/index.js';
import { RiskGame }          from './games/risk/index.js';
import { AxisAlliesGame }    from './games/axisallies/index.js';
import { CombatMissionGame } from './games/combatmission/index.js';
import { XComGame }          from './games/xcom/index.js';
import { AowGame }           from './games/aow/index.js';
import { CsGame }            from './games/cs/index.js';
import { CsMiniGame }        from './games/csmini/index.js';
import { FFTAGame }          from './games/ffta/index.js';
import { Sc1Game }           from './games/sc1/index.js';
import { Sc2Game }           from './games/sc2/index.js';
import { DoomGame }          from './games/doom/index.js';
import { MudAndBloodGame }  from './games/mudandblood/index.js';
import { KDiceGame }        from './games/kdice/index.js';
import { WarodDotsGame }   from './games/warofdots/WarodDotsGame.js';
import { SurvivGame }        from './games/surviv/index.js';
import { Memoir44Game }      from './games/memoir44/index.js';

// ---------------------------------------------------------------------------
// Static file serving — /ui/<name>/* → apps/<name>/
// ---------------------------------------------------------------------------

const ROOT_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)));
const APPS_DIR = resolve(ROOT_DIR, 'apps');
const GAMES_DIR = resolve(ROOT_DIR, 'games');
const SESSIONS_DIR = resolve(ROOT_DIR, 'sessions');
const SERVER_PATH = resolve(ROOT_DIR, 'api-server.js');

/** Filesystem-safe local datetime for recording filenames, e.g. 2026-07-12T14-16-03. */
function fileTimestamp(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.vue':  'text/plain; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.gif':  'image/gif',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.wav':  'audio/wav',
  '.mp3':  'audio/mpeg',
  '.ogg':  'audio/ogg',
};

async function serveApp(appName, req, res) {
  const urlPath  = new URL(req.url, 'http://localhost').pathname;
  const prefix   = new RegExp(`^/(?:ui/)?${appName}/?`);
  const rel      = urlPath.replace(prefix, '') || 'index.html';
  const appDir   = resolve(APPS_DIR, appName);
  const abs      = resolve(appDir, rel);

  if (!abs.startsWith(appDir + sep) && abs !== appDir) {
    res.writeHead(403); return res.end('Forbidden');
  }

  try {
    const data = await readFile(abs);
    const ct   = MIME_TYPES[extname(abs)] || 'application/octet-stream';
    // Never cache .vue/.js source files so code changes are reflected immediately.
    const ext  = extname(abs);
    const cc   = (ext === '.vue' || ext === '.js') ? 'no-cache' : undefined;
    const hdrs = { 'Content-Type': ct, 'Access-Control-Allow-Origin': '*' };
    if (cc) hdrs['Cache-Control'] = cc;
    res.writeHead(200, hdrs);
    res.end(data);
  } catch {
    // SPA fallback: unknown paths without a file extension serve index.html
    if (!MIME_TYPES[extname(abs)]) {
      try {
        const html = await readFile(resolve(APPS_DIR, appName, 'index.html'));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        return res.end(html);
      } catch {}
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

// Serve repo ES modules (games/*, agents/*, …) to the browser analysis Web
// Worker (apps/design/analysis-worker.js), which imports the real chess + CFR
// code directly instead of a bundle. Restricted to JS/WASM so it can't read
// arbitrary source, with path-escape protection. The worker imports absolute
// URLs like /lib/games/chess/ChessGame.js; those modules' own relative imports
// (./board.js, ../../vendor/obscuro/src/search.js) then resolve under /lib/ too.
async function serveLibModule(res, relPath) {
  const abs = resolve(ROOT_DIR, relPath);
  if (abs !== ROOT_DIR && !abs.startsWith(ROOT_DIR + sep)) { res.writeHead(403); return res.end('Forbidden'); }
  const ext = extname(abs);
  if (!['.js', '.mjs', '.cjs', '.wasm'].includes(ext)) { res.writeHead(404); return res.end('Not found'); }
  try {
    const data = await readFile(abs);
    res.writeHead(200, {
      'Content-Type': ext === '.wasm' ? 'application/wasm' : 'text/javascript; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}

// ---------------------------------------------------------------------------
// Game image serving — /images/:game/:job[/:type] → games/:game/images/…
// ---------------------------------------------------------------------------

function sniffMime(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xFF && buf[1] === 0xD8) return 'image/jpeg';
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57) return 'image/webp';
  return null;
}

// GIF preferred over PNG/JPG for animated sprites.
const TYPE_EXT_PREF = { gif: 0, png: 1, jpg: 2, jpeg: 2, webp: 3 };

async function serveGameImage(gameName, job, res, type) {
  const safe = job.replace(/[^a-zA-Z0-9_-]/g, '');
  // Search both images/ and assets/ directories
  const baseDirs = [
    resolve(GAMES_DIR, gameName, 'images'),
    resolve(GAMES_DIR, gameName, 'assets'),
  ];
  // Sprite art is still being iterated on (files get replaced in place at stable
  // URLs, e.g. re-sliced or re-mapped facing sets), so never let a browser reuse
  // a cached image without revalidating — otherwise a swapped file keeps showing
  // the old pixels for up to a day. `no-cache` = "always revalidate before use".
  const cacheControl = 'no-cache';

  // /images/:game/:job/:type  →  games/:game/{images,assets}/:job/{type}*
  if (type) {
    const safeType = type.replace(/[^a-zA-Z0-9_-]/g, '');
    for (const base of baseDirs) {
      const subdir = resolve(base, safe);
      let files;
      try { files = await readdir(subdir); } catch { continue; }
      const candidates = files
        .map(f => { const dot = f.lastIndexOf('.'); return dot < 0 ? null : { f, ext: f.slice(dot + 1).toLowerCase() }; })
        .filter(x => x && f_stem(x.f).startsWith(safeType))
        .sort((a, b) => (TYPE_EXT_PREF[a.ext] ?? 99) - (TYPE_EXT_PREF[b.ext] ?? 99));
      for (const { f } of candidates) {
        try {
          const data = await readFile(resolve(subdir, f));
          const ext = f.slice(f.lastIndexOf('.'));
          const ct = sniffMime(data) ?? MIME_TYPES[ext] ?? 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': ct, 'Access-Control-Allow-Origin': '*', 'Cache-Control': cacheControl });
          return res.end(data);
        } catch {}
      }
    }
    res.writeHead(404); res.end('Not found');
    return;
  }

  // /images/:game/:job  →  games/:game/{images,assets}/:job.*  (flat file)
  for (const base of baseDirs) {
    let files;
    try { files = await readdir(base); } catch { continue; }
    for (const f of files) {
      const dot = f.lastIndexOf('.');
      if (dot < 0) continue;
      if (f.slice(0, dot) === safe) {
        try {
          const data = await readFile(resolve(base, f));
          const ct = sniffMime(data) ?? MIME_TYPES[f.slice(dot)] ?? 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': ct, 'Access-Control-Allow-Origin': '*', 'Cache-Control': cacheControl });
          return res.end(data);
        } catch {}
      }
    }
  }
  res.writeHead(404); res.end('Not found');
}

function f_stem(f) { const dot = f.lastIndexOf('.'); return dot < 0 ? f : f.slice(0, dot); }

// ---------------------------------------------------------------------------
// Game sound serving — /sounds/:game/:name → games/:game/sounds/:name.*
// ---------------------------------------------------------------------------

async function serveGameSound(gameName, name, res) {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, '');
  const dir  = resolve(GAMES_DIR, gameName, 'sounds');
  let files;
  try { files = await readdir(dir); } catch { files = []; }
  for (const f of files) {
    if (f_stem(f) === safe) {
      try {
        const data = await readFile(resolve(dir, f));
        const ct = MIME_TYPES[f.slice(f.lastIndexOf('.'))] ?? 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': ct, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        return res.end(data);
      } catch {}
    }
  }
  res.writeHead(404); res.end('Not found');
}

// ---------------------------------------------------------------------------
// Game registry
// ---------------------------------------------------------------------------

const GAMES = {
  chess:         { game: ChessGame,         minPlayers: 2, maxPlayers: 2,  defaultPlayers: [{ id: 'white', name: 'White' }, { id: 'black', name: 'Black' }] },
  tactical:      { game: TacticalGame,      minPlayers: 2, maxPlayers: 4,  defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  cardbattle:    { game: CardBattleGame,    minPlayers: 2, maxPlayers: 2,  defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  civ1:          { game: Civ1Game,          minPlayers: 2, maxPlayers: 4,  defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  civ2:          { game: Civ2Game,          minPlayers: 2, maxPlayers: 4,  defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  risk:          { game: RiskGame,          minPlayers: 2, maxPlayers: 6,  defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  axisallies:    { game: AxisAlliesGame,    minPlayers: 2, maxPlayers: 5,  defaultPlayers: [{ id: 'allies', name: 'Allies' }, { id: 'axis', name: 'Axis' }] },
  combatmission: { game: CombatMissionGame, minPlayers: 2, maxPlayers: 2,  defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  xcom:          { game: XComGame,          minPlayers: 2, maxPlayers: 2,  defaultPlayers: [{ id: 'xcom', name: 'XCOM' }, { id: 'aliens', name: 'Aliens' }] },
  aow:           { game: AowGame,           minPlayers: 2, maxPlayers: 4,  defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  cs:            { game: CsGame,            minPlayers: 2, maxPlayers: 10, defaultPlayers: [{ id: 'ct', name: 'CT' }, { id: 't', name: 'T' }] },
  csmini:        { game: CsMiniGame,        minPlayers: 2, maxPlayers: 2,  defaultPlayers: [{ id: 'ct', name: 'CT' }, { id: 't', name: 'T' }] },
  ffta:          { game: FFTAGame,          minPlayers: 2, maxPlayers: 2,  defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  sc1:           { game: Sc1Game,           minPlayers: 2, maxPlayers: 4,  defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  sc2:           { game: Sc2Game,           minPlayers: 2, maxPlayers: 4,  defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  doom:          { game: DoomGame,          minPlayers: 2, maxPlayers: 2,  defaultPlayers: [{ id: 'marine', name: 'Marine' }, { id: 'demons', name: 'Demons' }] },
  mudandblood:   { game: MudAndBloodGame,   minPlayers: 2, maxPlayers: 2,  defaultPlayers: [{ id: 'allies', name: 'Allies' }, { id: 'axis', name: 'Axis' }] },
  kdice:         { game: KDiceGame,         minPlayers: 2, maxPlayers: 6,  defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }, { id: 'p3', name: 'Player 3' }, { id: 'p4', name: 'Player 4' }] },
  warofdots:     { game: WarodDotsGame,     minPlayers: 2, maxPlayers: 2,  defaultPlayers: [{ id: 'player', name: 'You' }, { id: 'ai', name: 'AI' }] },
  surviv:        { game: SurvivGame,        minPlayers: 2, maxPlayers: 2,  defaultPlayers: [{ id: 'blue', name: 'Blue' }, { id: 'red', name: 'Red' }] },
  memoir44:      { game: Memoir44Game,      minPlayers: 2, maxPlayers: 2,  defaultPlayers: [{ id: 'allies', name: 'Allies' }, { id: 'axis', name: 'Axis' }] },
};

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

const sessions = new Map();

// Cap on retained gridHistory frames (see Session._pushGridHistory). A pure-AI
// session with no human to pace it races through engine.step() unthrottled —
// on a game with a large board (e.g. civ1's default 50x30 map, ~half a
// megabyte per captured grid) an uncapped history array reaches multiple
// gigabytes and crashes the whole process — every session on the shared dev
// server, not just the one that grew it — within seconds to a couple minutes.
const MAX_GRID_HISTORY = 600;

// `state.players[i].agent` is the live agent instance the engine actually calls
// to choose that seat's moves (e.g. a ChessObscuroAgent) — never meant to leave
// the server, and not always even serializable: Obscuro lazily attaches
// `this.game = ChessGame` the first time it plays a move, and since
// ChessGame.agents[].agent === the very same Obscuro singleton, that closes a
// circular reference JSON.stringify chokes on (Node module singletons, so this
// then breaks EVERY session in the process, not just the one that triggered
// it). Strip agents down to an id wherever raw state reaches a client — used by
// stateJSON (the only endpoint that ever hands out raw `players`; toJSON always
// projects through curated fields instead).
function sanitizePlayers(state) {
  if (!state || !Array.isArray(state.players)) return state;
  return { ...state, players: state.players.map(p => (p.agent ? { ...p, agent: { id: p.agent.id ?? null } } : p)) };
}

class Session {
  constructor(id, gameName, engine, apiAgents, fog = false, debugAI = false, params = {}) {
    this.id = id;
    this.gameName = gameName;
    this.engine = engine;
    this.apiAgents = apiAgents; // Map<playerId, ApiAgent>
    this.fog = fog;
    this.debugAI = debugAI;
    // Full set of parameters the session was created with (game, players, config) —
    // persisted with the recording so a run can be reproduced/inspected later.
    this.params = params;
    // Observer support: clients may connect read-only (?observer=1) and see the
    // full game state, bypassing fog. `observerDelay` holds their view back by N ms.
    this.allowObservers = params.config?.allowObservers ?? false;
    this.observerDelay = Math.max(0, Number(params.config?.observerDelay) || 0);
    // Live playback controls (adjustable at runtime via POST /sessions/:id/control):
    //  - `aiDelay` paces pure-AI steps so auto-advancing games are watchable.
    //  - `paused` halts the run loop before its next step (AI won't move until resumed).
    // `_resumeWaiters` are promise resolvers the loop parks on while paused.
    this.aiDelay = Math.max(0, Number(params.config?.aiDelay) || 0);
    // Observer-paced (lock-step) mode: a pure-AI session that is meant to be
    // watched. Instead of a wall-clock `aiDelay`, the run loop computes one step,
    // shows it, then WAITS for the observing client to finish animating that
    // step's playback and send an `advance` signal before computing the next —
    // so an observer never falls behind a game that would otherwise finish
    // instantly. Such a session also starts paused, so nothing runs until the
    // observer clicks Resume. Off by default for any session with a human seat
    // (those are paced by human input) and for headless AI runs (no observers).
    const noHumans = this.apiAgents.size === 0;
    this.observerPaced = params.config?.observerPaced ?? (noHumans && this.allowObservers);
    this.paused = params.config?.startPaused ?? this.observerPaced;
    this._resumeWaiters = [];
    // Lock-step advance gate (observer-paced mode): the loop parks on
    // `_advanceWaiters` after each step; the client's playback-done signal
    // (POST /control { advance: <seq> }) releases it. `_seq` is a monotonic
    // per-step counter the client acks against so a stale/duplicate ack can't
    // skip a step; `_advancePending` covers an ack that races in before the loop
    // parks; `_awaitingAdvance` tells the client a step is on screen awaiting ack.
    this._advanceWaiters = [];
    this._advancePending = false;
    this._seq = 0;
    this._awaitingAdvance = false;
    this._stepSimTime = null;
    this._sawHumanPending = false;
    this.createdAt = new Date();
    this.status = 'active';
    this.result = null;
    this.error = null;
    this.gridHistory = [];
    // See _pushGridHistory: once gridHistory hits MAX_GRID_HISTORY it's thinned
    // to every other frame and _gridStride doubles, so retained frames stay
    // spread across the whole game instead of memory growing without bound.
    this._gridStride = 1;
    this._gridStepCount = 0;
    // Every unit lost so far, generic across every game (see _recordCasualties):
    // { id, ownerId, type, name, imagePath, ply, witnessedBy }. witnessedBy is the
    // list of player ids who had this unit in their fog-filtered view the instant
    // before it died — always includes ownerId (a player's own units are never
    // fog-stripped from themselves) — so toJSON can hand each viewer exactly the
    // deaths they're entitled to know about, own losses always included. Kept for
    // the session's whole lifetime, unlike the client's old per-tab "ever seen"
    // heuristic, so a reconnect/reload never loses history.
    this.casualties = [];
    this._persisting = false;
    this._persistQueued = false;
    // Latest AI decision record per player (candidate moves + rankings), captured
    // off each AI agent after every step for the AI-analysis panel. Persists the
    // most recent decision per player so the panel keeps showing it between turns.
    this.aiAnalysis = {};
    // WebSocket subscribers: Set<{ ws, playerId, observer, viewAs }>. Each player
    // client gets a per-player (fog-filtered) snapshot pushed whenever this session's
    // state changes; observer clients get the full unfiltered snapshot (or, if they
    // set `viewAs`, that player's fog-filtered view), optionally held back by
    // `observerDelay` ms.
    this.wsClients = new Set();
    // Recording file is named with the creation datetime so runs sort chronologically.
    this._recordPath = resolve(SESSIONS_DIR, `${fileTimestamp(this.createdAt)}-${id.slice(0, 8)}.json`);
    // Push the "your turn" state the moment a human agent starts waiting — the
    // engine is otherwise parked inside `await step()` with nothing to observe.
    // Seeing a human go pending also marks the current step as human-driven, so the
    // AI pacing delay below is skipped for it (humans already pace themselves).
    for (const agent of this.apiAgents.values()) {
      agent.onPending = () => { this._sawHumanPending = true; this._broadcast(); };
    }
    this._run();
  }

  /**
   * Adjust live playback controls. `paused` halts/resumes the run loop; `aiDelay`
   * (ms) sets the pacing between auto-advancing AI steps. Both take effect on the
   * next loop iteration. Returns the applied values.
   */
  setControl({ paused, aiDelay, advance } = {}) {
    if (typeof paused === 'boolean') {
      this.paused = paused;
      if (!paused) {
        const waiters = this._resumeWaiters;
        this._resumeWaiters = [];
        for (const resume of waiters) resume();
      }
    }
    if (aiDelay != null && Number.isFinite(Number(aiDelay))) {
      this.aiDelay = Math.max(0, Number(aiDelay));
    }
    // `advance: true` acks the current step; `advance: <seq>` acks a specific one.
    if (advance != null) this._advance(advance === true ? this._seq : Number(advance));
    this._broadcast();
    return { paused: this.paused, aiDelay: this.aiDelay, seq: this._seq, awaitingAdvance: this._awaitingAdvance };
  }

  /**
   * Observer-paced mode: the client signals that it has finished animating the
   * step numbered `seq`, releasing the run loop to compute the next one. A `seq`
   * that doesn't match the step currently awaiting an ack is ignored (a stale or
   * duplicate signal must never advance an unwatched step). An ack that arrives
   * before the loop has parked is remembered (`_advancePending`) and consumed by
   * the next park, so the handoff never deadlocks on that race.
   */
  _advance(seq) {
    if (seq != null && Number.isFinite(seq) && seq !== this._seq) return;
    this._awaitingAdvance = false;
    if (this._advanceWaiters.length) {
      const waiters = this._advanceWaiters;
      this._advanceWaiters = [];
      for (const resume of waiters) resume();
    } else {
      this._advancePending = true;
    }
  }

  /**
   * Game-time (in the game's own units) that the step just computed represents,
   * or null if the game exposes no timing. A we-go round reports its resolved
   * `playback.duration`; a discrete step is the max getActionDuration over its
   * action(s), evaluated on `preState` (before the move applied). Observers scale
   * this to wall-clock so playback runs at real sim-speed.
   */
  _computeStepSimTime(preState) {
    const pb = this.engine.playback;
    if (pb?.duration != null) return pb.duration;
    const { game } = GAMES[this.gameName];
    if (!game.getActionDuration || !preState) return null;
    // The step's action(s) from the engine log (reliable across games — some set
    // `lastAction` singular, not the engine-standard `lastActions`).
    const entry = this.engine.log[this.engine.log.length - 1];
    const actions = entry?.playerActions ?? [];
    if (!actions.length) return null;
    let max = 0;
    for (const pa of actions) {
      try { max = Math.max(max, Number(game.getActionDuration(preState, pa.action)) || 0); } catch {}
    }
    return max || null;
  }

  /** Park the run loop while paused; resolves when resumed (or the session ends). */
  async _waitWhilePaused() {
    while (this.paused && this.status === 'active') {
      await new Promise(resolve => { this._resumeWaiters.push(resolve); });
    }
  }

  /**
   * Observer-paced mode: park the run loop after a step until the observing
   * client acks it (see _advance), or the session ends. A no-op when not
   * observer-paced (normal games advance on their own timer).
   */
  async _waitForAdvance() {
    if (!this.observerPaced) return;
    if (this._advancePending) { this._advancePending = false; return; }
    if (this.status !== 'active') return;
    await new Promise(resolve => { this._advanceWaiters.push(resolve); });
  }

  /** Push the current per-player snapshot to every subscribed WebSocket client. */
  _broadcast() {
    if (this.wsClients.size === 0) return;
    for (const client of this.wsClients) this._sendTo(client);
  }

  /**
   * Send the current snapshot to one WebSocket client. Observers get the full
   * unfiltered view; the payload is serialized now and, if `observerDelay` is set,
   * delivered `observerDelay` ms later so observers always trail live players.
   */
  _sendTo(client) {
    if (client.ws.readyState !== 1 /* WebSocket.OPEN */) return;
    // Observers default to the full, fog-bypassing view; if they pick a player
    // perspective (`viewAs`), they instead get that player's own fog-filtered
    // snapshot — still held back by observerDelay like any observer payload.
    const payload = client.observer
      ? (client.viewAs
          ? JSON.stringify(this.toJSON(client.viewAs))
          : JSON.stringify(this.toJSON(null, { observer: true })))
      : JSON.stringify(this.toJSON(client.playerId));
    const delay = client.observer ? this.observerDelay : 0;
    if (delay > 0) {
      setTimeout(() => {
        if (client.ws.readyState !== 1) return;
        try { client.ws.send(payload); } catch {}
      }, delay);
    } else {
      try { client.ws.send(payload); } catch {}
    }
  }

  /** Pull the latest decision record off each AI agent that just moved. */
  _collectAnalysis() {
    for (const p of this.engine.players ?? []) {
      const a = p.agent?.lastAnalysis;
      if (a && a.player === p.id) this.aiAnalysis[p.id] = a;
    }
  }

  _captureGrid() {
    try {
      const { game } = GAMES[this.gameName];
      const rawState = this.engine.state;
      if (!rawState || !game.toGrid) return null;
      return applyAxisLabels(game, game.toGrid(rawState));
    } catch { return null; }
  }

  /**
   * Diff `preState.units` (generic, per games/types.js: an alive-only array like
   * chess's, or the alive:false-tagged form the type doc describes — both are
   * handled) against the just-stepped `this.engine.state.units` and append one
   * casualty entry per unit that dropped out. Zero game-specific code: it only
   * relies on the universal Unit.id/ownerId/type contract, so it works for any
   * game without that game having to opt in or annotate anything.
   *
   * For display, the unit's last position is still in preState, so its cell (and
   * therefore imagePath/glyph) can be read straight out of a toGrid(preState)
   * call — no per-game "describe this unit out of context" hook needed either.
   *
   * witnessedBy answers "who actually saw this die" — own team always (their
   * units are never fog-stripped from themselves; see getVisibleState), plus
   * anyone else whose fog view had this unit visible the instant before it
   * vanished. That's the honest fog answer: a unit merely walking back out of
   * sight is never a false "captured" (it's still in afterAlive, so never
   * reaches this method at all), and an opponent's death off in the fog you
   * never had eyes on is correctly never reported to you either.
   */
  _recordCasualties(preState) {
    if (!preState) return;
    const { game } = GAMES[this.gameName];
    const alive = (arr) => (arr ?? []).filter(u => u.alive !== false);
    const before = new Map(alive(preState.units).map(u => [u.id, u]));
    const afterIds = new Set(alive(this.engine.state.units).map(u => u.id));
    const dead = [...before.values()].filter(u => !afterIds.has(u.id));
    if (!dead.length) return;
    let preGrid = null;
    if (game.toGrid) {
      try { preGrid = applyAxisLabels(game, game.toGrid(preState)); } catch { preGrid = null; }
    }
    const players = this.params.players ?? [];
    for (const u of dead) {
      const cell = preGrid?.cells?.find(c => c.unitId === u.id);
      const witnessedBy = [];
      for (const p of players) {
        if (p.id === u.ownerId) { witnessedBy.push(p.id); continue; }
        if (!this.fog || !game.getVisibleState) { witnessedBy.push(p.id); continue; }
        try {
          const vis = game.getVisibleState(preState, p.id);
          if ((vis.units ?? []).some(vu => vu.id === u.id)) witnessedBy.push(p.id);
        } catch { /* treat as unwitnessed */ }
      }
      this.casualties.push({
        id: u.id,
        ownerId: u.ownerId,
        type: u.type,
        name: cell?.unitName ?? cell?.glyph ?? u.type,
        imagePath: cell?.imagePath ?? null,
        ply: this._seq,
        witnessedBy,
      });
    }
  }

  /**
   * Append a captured grid to gridHistory, keeping the array bounded to
   * MAX_GRID_HISTORY frames regardless of how long the session runs. Frames are
   * sampled at `_gridStride` (starting at 1, i.e. every frame); once the cap is
   * hit the buffer is thinned to every other frame and the stride doubles, so
   * long games keep frames evenly spread across their whole length rather than
   * losing the earliest or latest part of the timeline.
   */
  _pushGridHistory(g) {
    if (!g) return;
    this._gridStepCount++;
    if ((this._gridStepCount - 1) % this._gridStride !== 0) return;
    this.gridHistory.push(g);
    if (this.gridHistory.length >= MAX_GRID_HISTORY) {
      this.gridHistory = this.gridHistory.filter((_, i) => i % 2 === 0);
      this._gridStride *= 2;
    }
  }

  /**
   * Persist the full session record — all game parameters plus the move log.
   * Called once per engine step without being awaited by the run loop, so on
   * an unthrottled pure-AI game (no human to pace it) steps can outrun the
   * disk: each call re-serializes the whole (ever-growing) log, and with no
   * backpressure those writes pile up faster than they drain, holding more
   * and more full-log JSON strings in memory at once until the process OOMs.
   * `_persisting`/`_persistQueued` coalesce concurrent calls into at most one
   * in-flight write plus one pending follow-up (which picks up the latest
   * state), instead of one write per step.
   */
  async _persist() {
    if (this._persisting) { this._persistQueued = true; return; }
    this._persisting = true;
    try {
      do {
        this._persistQueued = false;
        await mkdir(dirname(this._recordPath), { recursive: true });
        const record = {
          id: this.id,
          createdAt: this.createdAt.toISOString(),
          game: this.gameName,
          fog: this.fog,
          debugAI: this.debugAI,
          params: this.params,
          status: this.status,
          result: this.result,
          log: this.engine.log,
        };
        await writeFile(this._recordPath, JSON.stringify(record, null, 2));
      } while (this._persistQueued);
    } catch {
    } finally {
      this._persisting = false;
    }
  }

  async _run() {
    try {
      this.engine._init();
      this._pushGridHistory(this._captureGrid());
      this._broadcast();
      while (this.status === 'active') {
        await this._waitWhilePaused();
        if (this.status !== 'active') break;
        this._sawHumanPending = false;
        const preState = this.engine.state; // pre-step state, for sim-time timing below
        const { done } = await this.engine.step();
        this._seq++;
        // How much game-time this step represents, so an observer can play it back
        // at real sim-speed (e.g. csmini's 5-second turn takes 5 seconds on screen)
        // instead of instantly. A we-go round carries its own resolved duration;
        // a single sequential action is priced by the game's getActionDuration on
        // the PRE-step state (post-step the unit has already moved, so distance —
        // and duration — would read as 0).
        this._stepSimTime = this._computeStepSimTime(preState);
        this._collectAnalysis();
        this._recordCasualties(preState);
        this._pushGridHistory(this._captureGrid());
        if (done) {
          this.status = 'done';
          this.result = this.engine.result;
        }
        // Tell observer-paced clients a step is on screen awaiting their ack.
        this._awaitingAdvance = this.observerPaced && !done;
        this._persist();
        this._broadcast();
        if (done) break;
        if (this.observerPaced) {
          // Lock-step: don't compute the next step until the observer has
          // finished animating this one and acked it (see _advance).
          await this._waitForAdvance();
        } else if (!this._sawHumanPending && this.aiDelay > 0) {
          // Pace pure-AI advancement so a watcher can follow it; a step that
          // waited on a human is already self-paced, so skip the delay for it.
          await new Promise(r => setTimeout(r, this.aiDelay));
        }
      }
    } catch (err) {
      // A resign() forces status to 'done' and aborts any in-flight human agent to
      // unblock this loop — that abort rejects the chooseAction() promise the engine
      // was awaiting, throwing here. That's an intentional teardown, not a failure,
      // so don't let it clobber the terminal status resign() already set.
      if (this.status !== 'closed' && this.status !== 'done') {
        this.status = 'error';
        this.error = err.message;
        this._broadcast();
      }
    }
  }

  /**
   * End the match immediately because `playerId` gave up — generic across every
   * game (no per-game support needed) since it never touches game rules: it just
   * forces the session's terminal result the same way a natural game-over does,
   * then unblocks the run loop wherever it's parked (paused, an observer-paced
   * advance gate, or a human agent's pending chooseAction) so it can notice the
   * status change and stop on its own. Two players: the other one wins. Otherwise
   * there's no single natural winner, so it's scored a draw (matching the engine's
   * own no-legal-actions/max-turns fallback).
   */
  resign(playerId) {
    if (this.status !== 'active') throw new Error(`Session is ${this.status}`);
    if (!this.apiAgents.has(playerId)) throw new Error(`Player ${playerId} is not a human player in this session`);

    const others = (this.engine.players ?? []).map(p => p.id).filter(id => id !== playerId);
    const winnerId = others.length === 1 ? others[0] : null;
    this.result = { outcome: winnerId ? 'win' : 'draw', winnerId, reason: 'surrender', resignedBy: playerId };
    this.status = 'done';

    this.paused = false;
    const waiters = [...this._resumeWaiters, ...this._advanceWaiters];
    this._resumeWaiters = [];
    this._advanceWaiters = [];
    for (const resume of waiters) resume();
    for (const agent of this.apiAgents.values()) agent.abort('Player resigned');

    this._persist();
    this._broadcast();
    return this.result;
  }

  close() {
    this.status = 'closed';
    // Release the run loop if it's parked on a pause or an advance gate so it can
    // observe the status change and exit.
    this.paused = false;
    const waiters = [...this._resumeWaiters, ...this._advanceWaiters];
    this._resumeWaiters = [];
    this._advanceWaiters = [];
    for (const resume of waiters) resume();
    for (const agent of this.apiAgents.values()) agent.abort('Session closed');
    for (const client of this.wsClients) {
      try { client.ws.close(); } catch {}
    }
    this.wsClients.clear();
  }

  /** Returns { playerId, legalActions } for the currently pending human action, or null. */
  pendingAction() {
    for (const [playerId, agent] of this.apiAgents) {
      if (agent.pending) return { playerId, legalActions: agent.pending.legalActions };
    }
    return null;
  }

  /**
   * The pending action to report to a given viewer. In simultaneous-turns mode
   * several humans can be pending at once, so a viewer with their own pending
   * always gets that one; otherwise fall back to the first pending human
   * (which is what keeps hotseat play working — one browser drives every
   * human seat, exactly as in sequential mode).
   */
  pendingFor(playerId) {
    const own = playerId ? this.apiAgents.get(playerId)?.pending : null;
    if (own) return { playerId, legalActions: own.legalActions };
    return this.pendingAction();
  }

  toJSON(playerId = null, { observer = false } = {}) {
    const { game } = GAMES[this.gameName];
    // Observers see everything: fog is disabled for their view regardless of the
    // session's fog setting, so the branches below fall through to full-information.
    const fog = this.fog && !observer;
    // In a simultaneous planning window each player is shown their own plan state
    // (turn start + their queued orders) instead of the authoritative state.
    // Observers never get a private plan state — they watch the authoritative game.
    const rawState = (!observer && playerId && this.engine.planState?.(playerId)) || this.engine.state;
    // The board is ALWAYS fog-filtered for the requesting player — debugAI never reveals
    // it (it only reveals the move log below). A playerless fog request therefore cannot
    // be given any board/log state; we return session metadata only (so a client can
    // discover the human player and re-request with it) and withhold everything secret.
    const fogNoPlayer = fog && !playerId;
    const viewState = (fog && playerId && game.getVisibleState)
      ? game.getVisibleState(rawState, playerId)
      : rawState;
    const pending = this.pendingFor(playerId);
    const summary = (this.status === 'done' && rawState && game.getBattleSummary)
      ? game.getBattleSummary(rawState, this.engine.log)
      : null;
    // In fog mode (without debugAI) hide the opponent's move from log and lastActions.
    const humanIds = new Set(this.apiAgents.keys());
    const fogFilter = fog && !this.debugAI && !!playerId;
    const lastActions = fogNoPlayer ? null : fogFilter
      ? (rawState?.lastActions?.filter(pa => pa.playerId === playerId) ?? null)
      : (rawState?.lastActions ?? null);
    const log = fogNoPlayer ? [] : fogFilter
      ? this.engine.log.filter(e => e.playerActions?.every(pa => humanIds.has(pa.playerId)))
      : this.engine.log;
    // Sampled position frames of the last resolved simultaneous round, for the
    // client's replay-turn feature. Under fog, frames are trimmed to the units
    // currently visible to the viewer (an approximation — true per-frame
    // visibility would need the game's vision model at every sample instant).
    let playback = fogNoPlayer ? null : (this.engine.playback ?? null);
    if (playback && fog && playerId && game.getVisibleState) {
      const visible = new Set(((game.getVisibleState(this.engine.state, playerId).units) ?? []).map(u => u.id));
      playback = { ...playback, frames: playback.frames.map(f => ({ ...f, units: f.units.filter(u => visible.has(u.id)) })) };
    }
    return {
      id: this.id,
      game: this.gameName,
      params: this.params,
      fog: this.fog,
      // This snapshot is an observer's full-information view (fog bypassed).
      observer,
      allowObservers: this.allowObservers,
      // Live playback controls (see setControl / POST /sessions/:id/control).
      paused: this.paused,
      aiDelay: this.aiDelay,
      // Observer lock-step (see observerPaced / _advance): `seq` numbers the step
      // currently shown; when `awaitingAdvance` is true the server is waiting for
      // this observer to finish animating it and POST { advance: seq }.
      observerPaced: this.observerPaced,
      seq: this._seq,
      awaitingAdvance: this._awaitingAdvance,
      // Game-time this step spans (game units), scaled by the game's own replay
      // pace preference (default 1×, e.g. csmini slows its watch-pace down without
      // changing the true sim-time actions cost). The observer plays it back over
      // that long in real time so a turn unfolds at its (scaled) natural pace.
      stepSimTime: this._stepSimTime == null ? null
        : this._stepSimTime * (GAMES[this.gameName].game.replayPaceMultiplier ?? 1),
      debugAI: this.debugAI,
      status: this.status,
      result: this.result,
      summary,
      error: this.error,
      turn: rawState?.turnNumber ?? null,
      phase: rawState?.currentPhase ?? null,
      activePlayers: rawState?.activePlayers ?? [],
      humanPlayers: [...this.apiAgents.keys()],
      // Which seat this snapshot was rendered for — i.e. whose fog it is. The
      // client derives the viewer itself (App.vue's viewAsId) but must not
      // re-derive it a second time somewhere else: a board drawn from one seat's
      // eyes alongside an analysis computed for the other is silently misleading.
      // Echoing it back keeps every consumer on the one authoritative answer.
      viewerId: fogNoPlayer ? null : (playerId ?? null),
      pendingPlayer: pending?.playerId ?? null,
      // All humans currently waited on (simultaneous mode can have several at once).
      pendingPlayers: [...this.apiAgents.entries()].filter(([, a]) => a.pending).map(([id]) => id),
      legalActions: pending?.legalActions ?? null,
      rendered: fogNoPlayer ? null : (rawState ? game.renderState(viewState) : null),
      grid: fogNoPlayer ? null : (viewState && game.toGrid ? applyAxisLabels(game, game.toGrid(viewState)) : null),
      // Every unit lost so far that this viewer is entitled to know about — see
      // _recordCasualties. Observers and non-fog games get the whole list
      // unconditionally (nothing to hide); a fog player gets their own losses
      // always, plus only the enemy deaths their witnessedBy actually includes.
      confirmedCaptures: fogNoPlayer ? [] : this.casualties.filter(c =>
        observer || !this.fog || c.witnessedBy.includes(playerId)),
      lastActions,
      log,
      playback,
      // AI deliberation (candidate moves + rankings). In fog it can leak the AI's
      // own move, so it is only revealed with debugAI on; with full information it
      // is always shown (both sides see the board anyway).
      aiAnalysis: fogNoPlayer ? null : ((this.debugAI || !fog) ? this.aiAnalysis : null),
    };
  }

  stateJSON(playerId = null) {
    const { game } = GAMES[this.gameName];
    const rawState = this.engine.state;
    if (this.fog && !playerId) throw new Error('player required for fog-of-war session');
    const state = (this.fog && playerId && game.getVisibleState) ? game.getVisibleState(rawState, playerId) : rawState;
    return sanitizePlayers(state);
  }

  // Keep a HUMAN seat's imperfect-information belief up to date, the same way an AI
  // seat's is kept by the generic ObscuroAgent (see agents/ObscuroAgent.js: it
  // samples worlds — which advances the belief for this turn — and then reports its
  // chosen move through onActionCommitted).
  //
  // Both halves are needed, in this order, on EVERY one of the seat's turns. A
  // belief that advances the opponent from a position where our OWN last move was
  // never applied is inconsistent with what we now observe, so it empties out and
  // the tracker abandons exactness — after which chess's fallback hands back a
  // confidently wrong guess (the enemy army still on its starting squares). Nothing
  // used to do this for a human seat, because onActionCommitted's only caller is
  // the AI agent, so the analysis panel — whose whole job is to reason about the
  // HUMAN's side — was reading a broken belief from the second turn onward.
  //
  // Called just before the action is handed to the engine, so `engine.state` is
  // still the pre-move position this seat actually observed when choosing.
  // Idempotent per turn (the game's own trackers key on turn number), so it costs
  // nothing when the analysis panel has already advanced the belief this turn.
  syncSeatBelief(playerId, action) {
    if (!this.fog) return;
    const { game } = GAMES[this.gameName];
    if (!game.beliefPopulation || !game.onActionCommitted || !game.getVisibleState) return;
    try {
      const view = game.getVisibleState(this.engine.state, playerId);
      game.beliefPopulation(view, playerId);      // advance + filter for this turn
      game.onActionCommitted(view, playerId, action); // then apply the move we just made
    } catch { /* belief upkeep is best-effort; never block a legal move */ }
  }

  // The EXACT resolved state at fraction `f` (0..1) of the last simultaneous round —
  // what a mid-turn scrub requests when it's paused BETWEEN the sampled playback
  // frames, so the board shows the true state rather than a client-side lerp. Returns
  // null when there's no live playback model. Fog-trimmed to the requester's currently
  // visible units, exactly like toJSON's `playback` (same approximation: visibility is
  // taken at the resolved state, not re-cast per sub-turn instant).
  playbackFrameJSON(playerId = null, f = 0, { observer = false } = {}) {
    const { game } = GAMES[this.gameName];
    const fog = this.fog && !observer;
    if (fog && !playerId) return null; // a playerless fog request gets nothing secret
    const frame = this.engine.playbackFrameAt(f);
    if (!frame) return null;
    if (fog && playerId && game.getVisibleState) {
      const visible = new Set(((game.getVisibleState(this.engine.state, playerId).units) ?? []).map(u => u.id));
      return { ...frame, units: frame.units.filter(u => visible.has(u.id)) };
    }
    return frame;
  }
}

// ---------------------------------------------------------------------------
// Router helpers
// ---------------------------------------------------------------------------

// A game's static `axisLabels` (e.g. Chess's algebraic file letters) always wins over
// whatever labels its `toGrid` happened to compute, so renderers stay correct even if
// `toGrid` changes independently.
function applyAxisLabels(game, grid) {
  if (!grid || !game.axisLabels) return grid;
  const { x, y } = game.axisLabels;
  if (x) grid.xLabels = x;
  if (y) grid.yLabels = y;
  return grid;
}

function readBody(req) {
  // Embedded mode: the host launcher's express.json()/urlencoded() middleware
  // already drained the request stream and parsed it into req.body, so reading
  // the raw stream again below would hang forever waiting for 'end'.
  if (req.body !== undefined) return Promise.resolve(req.body ?? {});
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}


function send(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(payload);
}

function err(res, status, message) {
  send(res, status, { error: message });
}

function route(req) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.replace(/^\/|\/$/g, '').split('/');
  return { parts, method: req.method, url };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

// Available for every game. 'greedy' is the generic low-memory/high-performance
// 1-ply heuristic agent (agents/GreedyAgent.js); 'obscuro' is the generic
// equilibrium/CFR agent (agents/ObscuroAgent.js). A game may override either by
// declaring an entry with the same id in its own `agents` array (chess does).
const BUILTIN_AGENTS = [
  { id: 'random', name: 'AI (random)' },
  { id: 'greedy', name: 'AI (greedy heuristic)' },
  { id: 'obscuro', name: 'AI (Obscuro/CFR)' },
];

// Merge builtin + game-declared agents, keeping the LAST entry per id so a
// game's specialised agent (e.g. chess's Obscuro) overrides the builtin label.
function dedupeAgents(list) {
  const byId = new Map();
  for (const a of list) byId.set(a.id, a);
  return [...byId.values()];
}

// Engine-level options offered for every game — config flags the GameEngine
// itself interprets (games never see them), so no game has to declare them.
const ENGINE_OPTIONS = [
  {
    id: 'simultaneousTurns',
    label: 'Simultaneous turns',
    description: 'All players give orders at the same time; once everyone has ended their turn, the orders resolve together and play back.',
    type: 'boolean',
    default: false,
  },
  {
    id: 'allowObservers',
    label: 'Allow observers',
    description: 'Let clients connect as observers who see the full game state — the whole board, log and AI analysis, bypassing fog of war.',
    type: 'boolean',
    default: false,
  },
  {
    id: 'observerDelay',
    label: 'Observer time delay (ms)',
    description: 'Delay information sent to observers by this many milliseconds (0 = live). Keeps observers behind the live players.',
    type: 'integer',
    default: 0,
  },
  {
    id: 'aiDelay',
    label: 'AI move delay (ms)',
    description: 'Pause this many milliseconds between AI moves so a fast game is watchable. Adjustable live during play (0 = full speed).',
    type: 'integer',
    default: 0,
  },
];

async function handleGames(res) {
  send(res, 200, Object.entries(GAMES).map(([name, { game, defaultPlayers, minPlayers, maxPlayers }]) => ({
    name,
    defaultPlayers,
    minPlayers,
    maxPlayers,
    scenarios: game.scenarios ?? [],
    gameOptions: [...(game.gameOptions ?? []), ...ENGINE_OPTIONS],
    ui: game.ui ?? {},
    // Preferred Quick play / Configure defaults (per-slot agents + engine-option
    // overrides), applied client-side over the generic defaults — see gameDefaults.js.
    uiDefaults: game.uiDefaults ?? null,
    // `analyzable` tells the client which agents can back the position-analysis
    // panel (POST /sessions/:id/analyze) — the `analyze` function itself is
    // server-only and never serialized. `clientAnalyze` (when present) lets the
    // browser's analysis Web Worker run that same analysis locally instead: it's
    // a { module, export } pointer the worker dynamically imports from /lib/ and
    // resolves a dot-path into (see apps/design/analysis-worker.js). `clientGame`
    // is the matching pointer for deriving legal actions client-side.
    agents: dedupeAgents([...BUILTIN_AGENTS, ...(game.agents ?? []).map(({ id, name: n, analyze, clientAnalyze }) => ({ id, name: n, analyzable: !!analyze, clientAnalyze: clientAnalyze ?? null }))]),
    clientGame: game.clientGame ?? null,
    // Whether this game has a database of recorded human games to look positions
    // up in, and what to call it. The query function itself is server-only (it
    // reads a corpus off disk) — the client only needs to know the panel exists.
    database: game.database ? { label: game.database.label ?? 'Database', source: game.database.source ?? null } : null,
  })));
}

// ---------------------------------------------------------------------------
// Game-definition CRUD (for the /ui/game-editor app). These edit api-server.js's
// GAMES registry and the games/<name>/ source files on disk; metadata / create /
// delete changes need a server restart to take effect (flagged in the response).
// ---------------------------------------------------------------------------

async function handleAdminGamesList(res) {
  try {
    const src = await readFile(SERVER_PATH, 'utf8');
    const games = gameEditor.registryList(src);
    // Attach the editable file list for each game.
    for (const g of games) {
      g.files = await gameEditor.listGameFiles(GAMES_DIR, g.name);
      g.live = Boolean(GAMES[g.name]); // false = registered but needs restart
    }
    send(res, 200, { games });
  } catch (e) { err(res, 500, e.message); }
}

async function handleAdminUpdateGame(req, res, name) {
  try {
    const body = await readBody(req);
    const meta = await gameEditor.updateGameMeta(SERVER_PATH, name, body);
    send(res, 200, { ...meta, restartRequired: true });
  } catch (e) { err(res, 400, e.message); }
}

async function handleAdminCreateGame(req, res) {
  try {
    const body = await readBody(req);
    const meta = await gameEditor.createGame(SERVER_PATH, GAMES_DIR, body.name, body);
    send(res, 201, { ...meta, restartRequired: true });
  } catch (e) { err(res, 400, e.message); }
}

async function handleAdminDeleteGame(res, name) {
  try {
    await gameEditor.deleteGame(SERVER_PATH, GAMES_DIR, name);
    send(res, 200, { name, restartRequired: true });
  } catch (e) { err(res, 400, e.message); }
}

async function handleAdminReadFile(res, name, url) {
  try {
    const path = url.searchParams.get('path');
    const content = await gameEditor.readGameFile(GAMES_DIR, name, path);
    send(res, 200, { path, content });
  } catch (e) { err(res, 400, e.message); }
}

async function handleAdminWriteFile(req, res, name) {
  try {
    const body = await readBody(req);
    const info = await gameEditor.writeGameFile(GAMES_DIR, name, body.path, body.content ?? '');
    send(res, 200, info);
  } catch (e) { err(res, 400, e.message); }
}

async function handleCreateSession(req, res) {
  let body;
  try { body = await readBody(req); }
  catch { return err(res, 400, 'Invalid JSON'); }

  const { game: gameName, players: playerDefs, config = {} } = body;

  if (!gameName) return err(res, 400, 'Missing game');
  const entry = GAMES[gameName];
  if (!entry) return err(res, 404, `Unknown game: ${gameName}. Available: ${Object.keys(GAMES).join(', ')}`);

  const defs = playerDefs ?? entry.defaultPlayers.map(p => ({ ...p, agent: 'human' }));
  if (!Array.isArray(defs) || defs.length < 2) return err(res, 400, 'Need at least 2 players');

  const apiAgents = new Map();
  const players = defs.map(({ id, name, agent: agentType = 'human' }) => {
    let agent;
    if (agentType === 'random' || agentType === 'ai') {
      agent = RandomAgent;
    } else {
      const gameAgent = entry.game.agents?.find(a => a.id === agentType);
      if (gameAgent) {
        agent = gameAgent.agent;
      } else if (agentType === 'greedy') {
        // Generic 1-ply heuristic agent — low-memory, fast, runs for any game.
        agent = makeGreedyAgent(entry.game);
      } else if (agentType === 'obscuro') {
        // Generic equilibrium agent — runs for any game the engine can drive.
        agent = new ObscuroAgent(entry.game);
      }
    }
    if (!agent) {
      const a = new ApiAgent(id);
      apiAgents.set(id, a);
      agent = a;
    }
    return { id, name: name ?? id, agent };
  });

  const fogOfWar = config.fog ?? config.fogOfWar ?? false;
  // A game can declare engine-level defaults (e.g. CS runs in simultaneous "we-go"
  // mode). Request config still wins, so a session can override them.
  const engine = new GameEngine(entry.game, players, { maxTurns: config.maxTurns ?? 500, ...entry.game.defaultConfig, ...config, fogOfWar });
  const id = randomUUID();
  const params = { game: gameName, players: defs, config };
  const session = new Session(id, gameName, engine, apiAgents, config.fog ?? config.fogOfWar ?? false, config.debugAI ?? false, params);
  sessions.set(id, session);

  // With no human players and observers allowed, connect the creator as an
  // observer: return the full-information observer snapshot so the client subscribes
  // read-only (?observer=1) instead of vainly waiting to play a seat it doesn't hold.
  const firstHumanId = [...apiAgents.keys()][0] ?? null;
  const asObserver = firstHumanId === null && session.allowObservers;
  send(res, 201, session.toJSON(firstHumanId, { observer: asObserver }));
}

async function handleListSessions(res) {
  send(res, 200, [...sessions.values()].map(s => ({
    id: s.id,
    game: s.gameName,
    status: s.status,
    turn: s.engine.state?.turnNumber ?? null,
    pendingPlayer: s.pendingAction()?.playerId ?? null,
  })));
}

async function handleGetSession(res, id, url) {
  const session = sessions.get(id);
  if (!session) return err(res, 404, 'Session not found');
  // ?observer=1 returns the full-information observer view over plain REST too
  // (the same view the observer WebSocket streams), so a fog game is watchable
  // by polling even where a WebSocket upgrade can't be established (e.g. behind
  // a proxy). Gated by allowObservers, like the WS observer handshake.
  const observer = ['1', 'true'].includes(url.searchParams.get('observer'));
  if (observer && !session.allowObservers) return err(res, 403, 'Observers not allowed for this session');
  const viewAs = observer ? (url.searchParams.get('viewAs') || null) : null;
  const playerId = observer ? viewAs : (url.searchParams.get('player') ?? null);
  try {
    send(res, 200, session.toJSON(playerId, { observer: observer && !viewAs }));
  } catch (e) {
    err(res, 400, e.message);
  }
}

async function handleGetState(res, id, url) {
  const session = sessions.get(id);
  if (!session) return err(res, 404, 'Session not found');
  const playerId = url.searchParams.get('player') ?? null;
  try {
    send(res, 200, session.stateJSON(playerId));
  } catch (e) {
    err(res, 400, e.message);
  }
}

async function handleGetPlaybackFrame(res, id, url) {
  const session = sessions.get(id);
  if (!session) return err(res, 404, 'Session not found');
  // Same viewer resolution as handleGetSession: an observer (?observer=1, optionally
  // ?viewAs=<player>) sees the full board; otherwise ?player=<id> is the fog viewer.
  const observer = ['1', 'true'].includes(url.searchParams.get('observer'));
  if (observer && !session.allowObservers) return err(res, 403, 'Observers not allowed for this session');
  const viewAs = observer ? (url.searchParams.get('viewAs') || null) : null;
  const playerId = observer ? viewAs : (url.searchParams.get('player') ?? null);
  const t = parseFloat(url.searchParams.get('t'));
  if (!Number.isFinite(t)) return err(res, 400, 'Query param t (fraction 0..1) is required');
  try {
    const frame = session.playbackFrameJSON(playerId, t, { observer: observer && !viewAs });
    if (!frame) return err(res, 404, 'No playback frame available');
    send(res, 200, frame);
  } catch (e) {
    err(res, 400, e.message);
  }
}

async function handleSubmitAction(req, res, id) {
  const session = sessions.get(id);
  if (!session) return err(res, 404, 'Session not found');
  if (session.status !== 'active') return err(res, 409, `Session is ${session.status}`);

  let body;
  try { body = await readBody(req); }
  catch { return err(res, 400, 'Invalid JSON'); }

  const { playerId, action } = body;
  if (!playerId) return err(res, 400, 'Missing playerId');
  if (!action)   return err(res, 400, 'Missing action');

  const agent = session.apiAgents.get(playerId);
  if (!agent) return err(res, 400, `Player ${playerId} is not a human player in this session`);
  if (!agent.pending) return err(res, 409, `Not waiting for player ${playerId} — current pending: ${session.pendingAction()?.playerId ?? 'none'}`);

  // Validate before consuming the pending promise: the engine re-validates this same
  // action once the agent's chooseAction() resolves, but by then it's too late to reject
  // gracefully — an illegal action (e.g. a continuous-move click that clips a wall corner)
  // would throw inside the session's run loop and permanently end the game as an error,
  // surfacing to players as a bogus "Draw". Rejecting it here as a 400 instead leaves the
  // agent pending so the player can just try a different action.
  try {
    // In a simultaneous planning window the player's actions are legal against
    // their private plan state, not the (turn-start) authoritative state.
    const checkState = session.engine.planState?.(playerId) ?? session.engine.state;
    validateAction(action, agent.pending.legalActions, GAMES[session.gameName].game, checkState, playerId);
  } catch (e) {
    return err(res, 400, e.message);
  }

  // Record the move against this seat's own fog belief before the engine advances
  // past the position it was chosen from — see Session.syncSeatBelief.
  session.syncSeatBelief(playerId, action);

  try {
    agent.submit(action);
  } catch (e) {
    return err(res, 400, e.message);
  }

  // Give the engine a tick to advance before responding
  await new Promise(r => setImmediate(r));
  send(res, 200, session.toJSON(playerId));
}

// Generic surrender: works the same for every game since it never touches game
// rules — it just forces the match's terminal result (see Session.resign). Unlike
// /action this doesn't require it to be that player's turn.
async function handleResign(req, res, id) {
  const session = sessions.get(id);
  if (!session) return err(res, 404, 'Session not found');

  let body;
  try { body = await readBody(req); }
  catch { return err(res, 400, 'Invalid JSON'); }

  const { playerId } = body;
  if (!playerId) return err(res, 400, 'Missing playerId');

  try {
    session.resign(playerId);
  } catch (e) {
    return err(res, 400, e.message);
  }

  send(res, 200, session.toJSON(playerId));
}

// Live playback controls: pause/resume the run loop and set the AI pacing delay.
// Not a game move — it doesn't touch the authoritative state or consume a turn; it
// just changes how fast (and whether) the engine auto-advances. The change is
// broadcast to every subscriber via setControl, so all watchers stay in sync.
async function handleControl(req, res, id) {
  const session = sessions.get(id);
  if (!session) return err(res, 404, 'Session not found');

  let body;
  try { body = await readBody(req); }
  catch { return err(res, 400, 'Invalid JSON'); }

  const applied = session.setControl(body);
  send(res, 200, { ok: true, ...applied });
}

// Player-placed fog-square annotations (e.g. "I think the queen went here"). Unlike
// /action this isn't a game move: it doesn't require it to be that player's turn and
// doesn't advance the engine — it patches persisted UI metadata directly so a guess
// survives a reload and updates immediately for the player who set it (and anyone else
// watching, via the broadcast below).
async function handleSetMarker(req, res, id) {
  const session = sessions.get(id);
  if (!session) return err(res, 404, 'Session not found');
  if (session.status !== 'active') return err(res, 409, `Session is ${session.status}`);

  let body;
  try { body = await readBody(req); }
  catch { return err(res, 400, 'Invalid JSON'); }

  const { playerId, col, row, type } = body;
  let { square } = body;
  if (!playerId) return err(res, 400, 'Missing playerId');
  if (!session.apiAgents.has(playerId)) return err(res, 400, `Player ${playerId} is not a human player in this session`);

  const { game } = GAMES[session.gameName];
  if (!game.setManualMarker) return err(res, 400, `${session.gameName} does not support manual fog markers`);
  // Client sends generic grid coords, not game-specific square notation, so it never
  // needs to know chess's algebraic-square scheme (or any other game's).
  if (!square && col != null && row != null && game.gridToSquare) square = game.gridToSquare(col, row);
  if (!square) return err(res, 400, 'Missing square (or col/row)');

  session.engine.patchState(state => game.setManualMarker(state, playerId, square, type ?? null));
  session._broadcast();
  send(res, 200, session.toJSON(playerId));
}

// Reconstruct the raw (unfiltered) game state after `ply` real moves, by
// replaying the session's own log through the game's pure `applyActions` —
// no engine/session involved, so this can never affect the live game. Used by
// both /analyze and /fork-move to look at (or branch from) a historical ply
// without the per-ply raw state having ever been stored.
//
// Deliberately builds a FRESH players array (new objects, not the session's
// stored `params.players` reference) on every call: belief-tracking agents key
// their per-color Belief on `state.players`' object identity (the vendored chess AI's belief.js
// getBelief), and beginTurn() only advances safely when re-entered with the SAME
// turnKey it already knows about. Reusing one shared array across repeated,
// possibly out-of-order ply lookups would let a later analyze() call for an
// EARLIER ply silently re-advance (and corrupt) whatever belief the live game
// is actually relying on for real play. A brand-new array each call guarantees
// every reconstruction gets its own throwaway, isolated belief instead.
function replayStateAtPly(game, session, ply) {
  const players = (session.params.players ?? []).map(p => ({ id: p.id, name: p.name ?? p.id }));
  let state = game.createInitialState(players, session.params.config ?? {});
  const log = session.engine.log;
  const n = Math.max(0, Math.min(ply, log.length));
  for (let i = 0; i < n; i++) state = game.applyActions(state, log[i].playerActions);
  return state;
}

// Every position from the start of the game up to and including `ply`, from the
// same replay. Imperfect-information questions are asked of a HISTORY, not of a
// position — what a fog player knows is the sequence of boards they were handed
// (see games/chess/fowDatabase.js) — and reconstructing that with one
// replayStateAtPly call per ply would be quadratic for no reason.
function replayStatesToPly(game, session, ply) {
  const players = (session.params.players ?? []).map(p => ({ id: p.id, name: p.name ?? p.id }));
  let state = game.createInitialState(players, session.params.config ?? {});
  const log = session.engine.log;
  const n = Math.max(0, Math.min(ply, log.length));
  const states = [state];
  for (let i = 0; i < n; i++) states.push(state = game.applyActions(state, log[i].playerActions));
  return states;
}

// Shared setup for both /analyze (single-shot) and /analyze-stream (SSE,
// live depth/round progress): resolves the position (current or a
// reconstructed historical ply), fog-filters it exactly like a real agent
// would see it, and looks up the requested AI's `analyze` function. Never
// touches the real session/engine.
//
// Which side gets analyzed, and hence whose fog-limited information the
// analysis is allowed to see. Two different questions are being answered
// depending on where the viewer is standing:
//
//   LIVE position (ply == null) under fog — "what should I play?". Answered for
//   the REQUESTING player, not for whoever the true state says is to move: the
//   belief-driven agents (ChessAgent, ObscuroAgent) reason entirely from the
//   viewer's own fog-limited information, so the question stays well-defined
//   (and leaks nothing) even mid-way through the opponent's turn.
//
//   HISTORICAL ply — "what was good HERE?". The position on screen belongs to
//   whoever is to move in it; answering for the other side hands back moves
//   that cannot be played from the board being shown, computed without the
//   reply that is about to land. So the analysis follows the side to move, the
//   way the full-information path always has.
//
// Under fog that means analyzing the OPPONENT's side at half the historical
// plies, from the opponent's own view — real information the viewer does not
// have while the game is live, so it is only served once the session is over
// (at which point /history already reveals the whole game anyway). During play
// those plies get a "hidden" error instead of a wrong-side answer.
export function resolveAnalysisContext(session, { playerId, agentId, ply }) {
  if (!playerId) throw new Error('Missing playerId');
  if (!agentId)  throw new Error('Missing agentId');

  const { game } = GAMES[session.gameName];
  const rosterEntry = (game.agents ?? []).find(a => a.id === agentId);
  if (!rosterEntry?.analyze) throw new Error(`${agentId} does not support analysis`);

  const rawState = (ply == null) ? session.engine.state : replayStateAtPly(game, session, ply);
  if (!rawState) throw new Error('No position available yet');

  const toMove = rawState.activePlayers?.[0] ?? null;
  const color = (session.fog && ply == null) ? playerId : (toMove ?? playerId);
  if (session.fog && color !== playerId && session.status === 'active')
    throw new Error(`${color} to move — hidden until the game ends`);

  // Fog-filter for the side actually being analyzed (identical to filtering for
  // the requester in every case except the revealed-replay one above): an agent
  // must never be handed information its own side cannot see.
  const viewState = (session.fog && game.getVisibleState) ? game.getVisibleState(rawState, color) : rawState;
  const legalActions = game.getLegalActions(viewState, color);
  return { game, rosterEntry, viewState, color, legalActions };
}

// Read-only "what's good here" analysis for a live or replayed position — the
// single-shot form (see handleAnalyzeStream below for the live-progress SSE
// version). Hands the resolved position to the chosen AI's `analyze` function
// (see games/chess/ChessGame.js `agents[].analyze`).
async function handleAnalyze(req, res, id) {
  const session = sessions.get(id);
  if (!session) return err(res, 404, 'Session not found');

  let body;
  try { body = await readBody(req); }
  catch { return err(res, 400, 'Invalid JSON'); }

  let ctx;
  try { ctx = resolveAnalysisContext(session, body); }
  catch (e) { return err(res, 400, e.message); }

  try {
    // A single HTTP response cannot stream partial progress, and the analysis
    // walk below refines indefinitely (wider over belief worlds, deeper over the
    // Stockfish ladder) until told to stop — so give this form a short budget and
    // let it answer with the best it reached. The SSE/worker paths keep the long
    // default: they show progress live and stop when the viewer looks away.
    const result = await ctx.rosterEntry.analyze(ctx.viewState, ctx.legalActions, {
      game: ctx.game, color: ctx.color, maxTotalMs: 15000,
    });
    send(res, 200, { ...result, ply: body.ply ?? null, color: ctx.color });
  } catch (e) {
    err(res, 500, `Analysis failed: ${e.message}`);
  }
}

// Same analysis as handleAnalyze, but streamed over Server-Sent Events so the
// client can show live search progress the way lichess does — "depth N/14"
// ticking up for Stockfish-backed chess-ai, "round N/30" for Obscuro's CFR
// search (see the onInfo/onRound side channels in stockfish.js and
// vendor/obscuro/src/search.js). GET + query params (not POST) because
// EventSource can only do GET. Emits zero or more `data: {..., done:false}`
// progress frames, then
// exactly one `data: {..., done:true}` frame (the final result, or an error)
// and closes the connection — the client doesn't need to know which agent
// supports progress ticks vs. answers in one shot, it just renders whatever
// arrives.
async function handleAnalyzeStream(req, res, id, url) {
  const session = sessions.get(id);
  const playerId = url.searchParams.get('playerId');
  const agentId  = url.searchParams.get('agentId');
  const plyRaw   = url.searchParams.get('ply');
  const ply = (plyRaw != null && plyRaw !== '') ? Number(plyRaw) : null;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  let closed = false;
  req.on('close', () => { closed = true; });
  const emit = (obj) => { if (!closed) { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { closed = true; } } };

  if (!session) { emit({ error: 'Session not found', done: true }); return res.end(); }

  let ctx;
  try { ctx = resolveAnalysisContext(session, { playerId, agentId, ply }); }
  catch (e) { emit({ error: e.message, done: true }); return res.end(); }

  try {
    const result = await ctx.rosterEntry.analyze(ctx.viewState, ctx.legalActions, {
      game: ctx.game, color: ctx.color,
      // `color` rides along on every frame: which side is being analyzed is not
      // always the viewer's own (see resolveAnalysisContext), and suggestions
      // for a side the viewer didn't ask about are misleading unless labelled.
      onProgress: (info) => emit({ ...info, ply, color: ctx.color, done: false }),
      // Lets an agent that has more to gain from a longer look (e.g. Obscuro's
      // fog analysis, which can always sample another belief-world batch) keep
      // refining until the viewer actually stops watching this position,
      // instead of settling for one fixed-size batch — see analyzeObscuro's
      // isCancelled-driven progressive mode in vendor/obscuro-chess/src/ObscuroAgent.js.
      isCancelled: () => closed,
    });
    emit({ ...result, ply, color: ctx.color, done: true });
  } catch (e) {
    emit({ error: `Analysis failed: ${e.message}`, done: true });
  }
  if (!closed) res.end();
}

// Play any legal move from a live or historical position into a throwaway
// sandbox — never touches the real session. The client round-trips the
// returned `state` back in as `forkState` for subsequent moves within the same
// fork; the very first move of a fork instead passes `ply` to seed from
// history. Deliberately ignores fog (full-info scratch board, either side
// movable) since this is exploration, not the real hidden game.
async function handleForkMove(req, res, id) {
  const session = sessions.get(id);
  if (!session) return err(res, 404, 'Session not found');

  let body;
  try { body = await readBody(req); }
  catch { return err(res, 400, 'Invalid JSON'); }

  const { ply, forkState, playerId, action } = body;
  if (!playerId) return err(res, 400, 'Missing playerId');
  if (!action)   return err(res, 400, 'Missing action');

  const { game } = GAMES[session.gameName];
  let state;
  try {
    state = forkState ?? (ply != null ? replayStateAtPly(game, session, ply) : session.engine.state);
  } catch (e) { return err(res, 400, `Could not resolve fork position: ${e.message}`); }
  if (!state) return err(res, 400, 'Missing ply or forkState');

  const legalActions = game.getLegalActions(state, playerId);
  try {
    validateAction(action, legalActions, game, state, playerId);
  } catch (e) { return err(res, 400, e.message); }

  const newState = game.applyActions(state, [{ playerId, action }]);
  send(res, 200, {
    state: newState,
    grid: applyAxisLabels(game, game.toGrid(newState)),
    legalActions: game.getLegalActions(newState, newState.activePlayers[0]),
    activePlayers: newState.activePlayers,
    turnNumber: newState.turnNumber ?? null,
  });
}

// Cached `game.database` query functions, keyed by module pointer — the module
// is imported the first time somebody opens the panel, not at startup, because
// a game database can be tens of megabytes of corpus that most sessions never
// touch.
const databaseQueries = new Map();
async function resolveDatabaseQuery(pointer) {
  const cacheKey = `${pointer.module}#${pointer.export}`;
  if (!databaseQueries.has(cacheKey)) {
    const mod = await import(new URL(pointer.module, import.meta.url).href);
    const fn = pointer.export.split('.').reduce((o, k) => o?.[k], mod);
    if (typeof fn !== 'function') throw new Error(`${cacheKey} is not a function`);
    databaseQueries.set(cacheKey, fn);
  }
  return databaseQueries.get(cacheKey);
}

// GET /sessions/:id/database?ply= — "what did recorded human players do from
// here?", for games that declare a `database` (see games/chess/ChessGame.js).
//
// REPLAY ONLY, and that is a rule about the feature, not a technicality: an
// opening book consulted mid-game is an outside engine playing for you. It is
// served once the session is finished, which is also when /history stops
// hiding anything.
//
// The question is asked for whoever is TO MOVE at the ply on screen, not for
// the viewer, so scrubbing through a game shows each side's own book in turn.
// Under fog the game's query decides what "from here" means — for chess it is
// everything the mover has watched up to this point, never the true position
// (games/chess/fowDatabase.js), which is why the whole prefix is handed over
// and not just one board.
async function handleDatabase(res, id, url) {
  const session = sessions.get(id);
  if (!session) return err(res, 404, 'Session not found');

  const { game } = GAMES[session.gameName];
  const pointer = game.database;
  if (!pointer) return err(res, 400, `${session.gameName} has no game database`);
  if (session.status === 'active')
    return err(res, 403, 'The game database is only available in replay, not during a live game');

  const plyRaw = url.searchParams.get('ply');
  const ply = (plyRaw != null && plyRaw !== '') ? Number(plyRaw) : null;

  // The whole prefix, not just the position: under fog what a player knows is
  // the sequence of boards they have been handed, so the game's query needs the
  // plies before this one to reconstruct that (see games/chess/fowDatabase.js's
  // observation trail). One replay produces all of them.
  let states;
  try {
    states = replayStatesToPly(game, session, ply ?? session.engine.log.length);
  } catch (e) { return err(res, 400, `Could not resolve position: ${e.message}`); }
  const state = states.pop();
  if (!state) return err(res, 400, 'No position available yet');

  const color = state.activePlayers?.[0] ?? null;
  if (!color) return err(res, 400, 'No side to move at this ply');

  try {
    const query = await resolveDatabaseQuery(pointer);
    // The mover's own legal actions — under fog a player's action set is fully
    // determined by what they can see, so these are theirs to know, and they are
    // what lets each row in the answer be hovered and played on the board.
    const legalActions = game.getLegalActions(state, color);
    const result = await query(state, color, { legalActions, priorStates: states });
    // The answer describes its own grouping (`label`/`hint`) and must not be
    // overwritten with the panel's title — that one rides on GET /games.
    send(res, 200, { ...result, ply, color });
  } catch (e) {
    console.error(e);
    err(res, 500, `Database lookup failed: ${e.message}`);
  }
}

async function handleGetLog(res, id) {
  const session = sessions.get(id);
  if (!session) return err(res, 404, 'Session not found');
  send(res, 200, session.engine.log);
}

async function handleGetHistory(res, id) {
  const session = sessions.get(id);
  if (!session) return err(res, 404, 'Session not found');
  send(res, 200, session.gridHistory);
}

async function handleDeleteSession(res, id) {
  const session = sessions.get(id);
  if (!session) return err(res, 404, 'Session not found');
  session.close();
  sessions.delete(id);
  send(res, 200, { ok: true });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

function resolvePort() {
  const argMatch = process.argv.find(a => a.startsWith('--port='));
  if (argMatch) return Number(argMatch.slice('--port='.length));
  const argIdx = process.argv.indexOf('--port');
  if (argIdx !== -1 && process.argv[argIdx + 1]) return Number(process.argv[argIdx + 1]);
  if (process.env.PORT) return Number(process.env.PORT);
  try {
    const settings = JSON.parse(readFileSync(resolve(ROOT_DIR, 'settings.json'), 'utf8'));
    if (settings.port) return Number(settings.port);
  } catch {}
  return 3333;
}

const PORT = resolvePort();

// The request handler doubles as a plain node:http listener (standalone mode)
// and as Express middleware (embedded mode, see the default export below).
// Express strips the mount prefix from req.url and exposes it via req.baseUrl,
// which is '' under plain node:http, so `base` resolves correctly either way.
async function handleRequest(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  const base = req.baseUrl || '';

  try {
    const { parts, method, url } = route(req);

    // Default — redirect to design UI
    if (method === 'GET' && parts[0] === '') {
      res.writeHead(302, { Location: `${base}/ui/design` });
      return res.end();
    }

    // Repo ES modules for the browser analysis Web Worker — GET /lib/*
    if (method === 'GET' && parts[0] === 'lib')
      return await serveLibModule(res, parts.slice(1).join('/'));

    // Static UI apps — GET /ui/<name>/* or GET /design/* (legacy)
    const UI_APPS = ['design', 'game-editor'];
    if (method === 'GET' && parts[0] === 'ui' && UI_APPS.includes(parts[1])) {
      // Redirect /ui/<name> (no trailing slash) so relative asset paths resolve correctly
      if (parts.length === 2 && !url.pathname.endsWith('/')) {
        res.writeHead(302, { Location: `${base}/ui/${parts[1]}/` });
        return res.end();
      }
      return await serveApp(parts[1], req, res);
    }
    if (method === 'GET' && parts[0] === 'design')
      return await serveApp('design', req, res);

    // Standalone browser games — GET /play/<name>/* → games/<name>/
    if (method === 'GET' && parts[0] === 'play' && parts[1]) {
      const gameName = parts[1];
      if (parts.length === 2 && !url.pathname.endsWith('/')) {
        res.writeHead(302, { Location: `${base}/play/${gameName}/` });
        return res.end();
      }
      const rel     = url.pathname.replace(new RegExp(`^/play/${gameName}/?`), '') || 'index.html';
      const gameDir = resolve(GAMES_DIR, gameName);
      const abs     = resolve(gameDir, rel);
      if (!abs.startsWith(gameDir + sep) && abs !== gameDir) { res.writeHead(403); return res.end('Forbidden'); }
      try {
        const data = await readFile(abs);
        res.writeHead(200, { 'Content-Type': MIME_TYPES[extname(abs)] ?? 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
        return res.end(data);
      } catch {
        if (!MIME_TYPES[extname(abs)]) {
          try {
            const html = await readFile(resolve(gameDir, 'index.html'));
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            return res.end(html);
          } catch {}
        }
        res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found');
      }
    }

    // GET /images/:game/:job[/:type] — serve game images (e.g. /images/ffta/soldier/sprite)
    if (method === 'GET' && parts[0] === 'images' && (parts.length === 3 || parts.length === 4))
      return await serveGameImage(parts[1], parts[2], res, parts[3]);

    // GET /sounds/:game/:name — serve game sound effects (e.g. /sounds/cs/rifle)
    if (method === 'GET' && parts[0] === 'sounds' && parts.length === 3)
      return await serveGameSound(parts[1], parts[2], res);

    // GET /games
    if (method === 'GET' && parts[0] === 'games' && parts.length === 1)
      return await handleGames(res);

    // Game-definition CRUD for the editor — /admin/games…
    if (parts[0] === 'admin' && parts[1] === 'games') {
      // GET /admin/games
      if (method === 'GET' && parts.length === 2) return await handleAdminGamesList(res);
      // POST /admin/games
      if (method === 'POST' && parts.length === 2) return await handleAdminCreateGame(req, res);
      // GET/PUT /admin/games/:name/file
      if (parts.length === 4 && parts[3] === 'file') {
        if (method === 'GET') return await handleAdminReadFile(res, parts[2], url);
        if (method === 'PUT') return await handleAdminWriteFile(req, res, parts[2]);
      }
      // PUT/DELETE /admin/games/:name
      if (parts.length === 3) {
        if (method === 'PUT')    return await handleAdminUpdateGame(req, res, parts[2]);
        if (method === 'DELETE') return await handleAdminDeleteGame(res, parts[2]);
      }
    }

    // POST /sessions
    if (method === 'POST' && parts[0] === 'sessions' && parts.length === 1)
      return await handleCreateSession(req, res);

    // GET /sessions
    if (method === 'GET' && parts[0] === 'sessions' && parts.length === 1)
      return await handleListSessions(res);

    // GET /sessions/:id
    if (method === 'GET' && parts[0] === 'sessions' && parts.length === 2)
      return await handleGetSession(res, parts[1], url);

    // GET /sessions/:id/state
    if (method === 'GET' && parts[0] === 'sessions' && parts.length === 3 && parts[2] === 'state')
      return await handleGetState(res, parts[1], url);

    // GET /sessions/:id/log
    if (method === 'GET' && parts[0] === 'sessions' && parts.length === 3 && parts[2] === 'log')
      return await handleGetLog(res, parts[1]);

    // GET /sessions/:id/history
    if (method === 'GET' && parts[0] === 'sessions' && parts.length === 3 && parts[2] === 'history')
      return await handleGetHistory(res, parts[1]);

    // GET /sessions/:id/playback-frame?t=<fraction 0..1> — the exact resolved state
    // at an off-sample mid-turn time, for a scrub paused between playback frames.
    if (method === 'GET' && parts[0] === 'sessions' && parts.length === 3 && parts[2] === 'playback-frame')
      return await handleGetPlaybackFrame(res, parts[1], url);

    // POST /sessions/:id/action
    if (method === 'POST' && parts[0] === 'sessions' && parts.length === 3 && parts[2] === 'action')
      return await handleSubmitAction(req, res, parts[1]);

    // POST /sessions/:id/resign — generic surrender, any game, any turn
    if (method === 'POST' && parts[0] === 'sessions' && parts.length === 3 && parts[2] === 'resign')
      return await handleResign(req, res, parts[1]);

    // POST /sessions/:id/marker
    if (method === 'POST' && parts[0] === 'sessions' && parts.length === 3 && parts[2] === 'marker')
      return await handleSetMarker(req, res, parts[1]);

    // POST /sessions/:id/control — pause/resume + AI pacing delay
    if (method === 'POST' && parts[0] === 'sessions' && parts.length === 3 && parts[2] === 'control')
      return await handleControl(req, res, parts[1]);

    // POST /sessions/:id/analyze
    if (method === 'POST' && parts[0] === 'sessions' && parts.length === 3 && parts[2] === 'analyze')
      return await handleAnalyze(req, res, parts[1]);

    // GET /sessions/:id/database?ply= — recorded human games from this position
    // (replay only; see handleDatabase)
    if (method === 'GET' && parts[0] === 'sessions' && parts.length === 3 && parts[2] === 'database')
      return await handleDatabase(res, parts[1], url);

    // GET /sessions/:id/analyze-stream?playerId=&agentId=&ply= (SSE, live progress)
    if (method === 'GET' && parts[0] === 'sessions' && parts.length === 3 && parts[2] === 'analyze-stream')
      return await handleAnalyzeStream(req, res, parts[1], url);

    // POST /sessions/:id/fork-move
    if (method === 'POST' && parts[0] === 'sessions' && parts.length === 3 && parts[2] === 'fork-move')
      return await handleForkMove(req, res, parts[1]);

    // DELETE /sessions/:id
    if (method === 'DELETE' && parts[0] === 'sessions' && parts.length === 2)
      return await handleDeleteSession(res, parts[1]);

    err(res, 404, 'Not found');
  } catch (e) {
    console.error(e);
    err(res, 500, e.message);
  }
}

// ---------------------------------------------------------------------------
// WebSocket push — clients subscribe at /sessions/:id/ws?player=:playerId and
// receive the same per-player snapshot handleGetSession returns, pushed on every
// state change. Replaces the old 2s poll; REST stays for initial load + fallback.
//
// handleUpgrade is shared between standalone mode (prefix '', every upgrade is
// ours) and embedded mode (prefix '/<app.id>', where several apps may share one
// httpServer — we only claim upgrades under our own prefix and leave the rest
// alone for other apps' listeners). Returns true if this call claimed the
// request (serviced or rejected it), false if it belongs to someone else.
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ noServer: true });

function handleUpgrade(req, socket, head, prefix = '') {
  const url = new URL(req.url, 'http://localhost');
  if (prefix && url.pathname !== prefix && !url.pathname.startsWith(prefix + '/')) return false;
  const relPath = prefix ? (url.pathname.slice(prefix.length) || '/') : url.pathname;
  const parts = relPath.replace(/^\/|\/$/g, '').split('/');

  // Only /sessions/:id/ws upgrades; anything else gets refused during handshake.
  if (parts[0] !== 'sessions' || parts.length !== 3 || parts[2] !== 'ws') {
    socket.destroy();
    return true;
  }

  const session = sessions.get(parts[1]);
  if (!session) {
    // Reject before accepting rather than accept-then-close, so the client sees a
    // clean failed upgrade and falls back to polling.
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return true;
  }

  const observerParam = url.searchParams.get('observer');
  const observer = observerParam === '1' || observerParam === 'true';
  // Observer connections require the session to allow them — reject during the
  // handshake so a client without permission can't peek at the full state.
  if (observer && !session.allowObservers) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return true;
  }

  const playerId = observer ? null : (url.searchParams.get('player') ?? null);
  // Observers may narrow their view to a single player's fog-limited perspective
  // via ?viewAs=:playerId (only honoured for observers, who are already allowed
  // to see everything — a per-player view is strictly less information).
  const viewAs = observer ? (url.searchParams.get('viewAs') || null) : null;
  wss.handleUpgrade(req, socket, head, (ws) => {
    const client = { ws, playerId, observer, viewAs };
    session.wsClients.add(client);
    // Immediate snapshot so a freshly-connected client is in sync without a REST
    // round-trip (observers get the delayed, full-information view via _sendTo).
    session._sendTo(client);
    const drop = () => session.wsClients.delete(client);
    ws.on('close', drop);
    ws.on('error', drop);
  });
  return true;
}

// Only bind our own listening server + process-wide 'upgrade' handler when run
// directly (`node api-server.js`); when imported as an embedded app server
// (see the default export below) the host process owns the httpServer.
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const server = createServer((req, res) => handleRequest(req, res));

  server.on('upgrade', (req, socket, head) => handleUpgrade(req, socket, head, ''));

  server.listen(PORT, () => {
    console.log(`Battle Simulator API running on http://localhost:${PORT}`);
    console.log(`\nGames: ${Object.keys(GAMES).join(', ')}`);
    console.log(`\nQuick start:`);
    console.log(`  POST /sessions  { "game": "chess", "players": [{"id":"white","agent":"human"},{"id":"black","agent":"random"}] }`);
    console.log(`  POST /sessions/:id/action  { "playerId": "white", "action": {...} }`);
  });
}

// Embedded mode — mounted by the jas-repo launcher (server/processApps.js) per
// its "servers" contract: default export (router, app, httpServer) => void.
// Static files, REST, and (if httpServer is shared) WebSocket upgrades all get
// scoped under this app's own route prefix, e.g. /battle-simulator/games.
export default (router, app, httpServer) => {
  const prefix = '/' + app.id;
  router.use(prefix, (req, res) => handleRequest(req, res));

  if (httpServer && !httpServer.__battleSimulatorUpgradeAttached) {
    httpServer.on('upgrade', (req, socket, head) => handleUpgrade(req, socket, head, prefix));
    httpServer.__battleSimulatorUpgradeAttached = true;
  }
};
