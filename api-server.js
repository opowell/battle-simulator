/**
 * HTTP API server for the battle-simulator engine.
 *
 * Endpoints:
 *   GET  /games                       List available games and their default players
 *   POST /sessions                    Create a session
 *   GET  /sessions                    List sessions
 *   GET  /sessions/:id                Get session state
 *   POST /sessions/:id/action         Submit an action for the pending player
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
import { FFTAGame }          from './games/ffta/index.js';
import { Sc1Game }           from './games/sc1/index.js';
import { Sc2Game }           from './games/sc2/index.js';
import { DoomGame }          from './games/doom/index.js';
import { MudAndBloodGame }  from './games/mudandblood/index.js';
import { KDiceGame }        from './games/kdice/index.js';
import { WarodDotsGame }   from './games/warofdots/WarodDotsGame.js';
import { SurvivGame }        from './games/surviv/index.js';

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
  ffta:          { game: FFTAGame,          minPlayers: 2, maxPlayers: 2,  defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  sc1:           { game: Sc1Game,           minPlayers: 2, maxPlayers: 4,  defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  sc2:           { game: Sc2Game,           minPlayers: 2, maxPlayers: 4,  defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  doom:          { game: DoomGame,          minPlayers: 2, maxPlayers: 2,  defaultPlayers: [{ id: 'marine', name: 'Marine' }, { id: 'demons', name: 'Demons' }] },
  mudandblood:   { game: MudAndBloodGame,   minPlayers: 2, maxPlayers: 2,  defaultPlayers: [{ id: 'allies', name: 'Allies' }, { id: 'axis', name: 'Axis' }] },
  kdice:         { game: KDiceGame,         minPlayers: 2, maxPlayers: 6,  defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }, { id: 'p3', name: 'Player 3' }, { id: 'p4', name: 'Player 4' }] },
  warofdots:     { game: WarodDotsGame,     minPlayers: 2, maxPlayers: 2,  defaultPlayers: [{ id: 'player', name: 'You' }, { id: 'ai', name: 'AI' }] },
  surviv:        { game: SurvivGame,        minPlayers: 2, maxPlayers: 2,  defaultPlayers: [{ id: 'blue', name: 'Blue' }, { id: 'red', name: 'Red' }] },
};

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

const sessions = new Map();

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
    this.createdAt = new Date();
    this.status = 'active';
    this.result = null;
    this.error = null;
    this.gridHistory = [];
    // Latest AI decision record per player (candidate moves + rankings), captured
    // off each AI agent after every step for the AI-analysis panel. Persists the
    // most recent decision per player so the panel keeps showing it between turns.
    this.aiAnalysis = {};
    // WebSocket subscribers: Set<{ ws, playerId }>. Each gets a per-player
    // (fog-filtered) snapshot pushed whenever this session's state changes.
    this.wsClients = new Set();
    // Recording file is named with the creation datetime so runs sort chronologically.
    this._recordPath = resolve(SESSIONS_DIR, `${fileTimestamp(this.createdAt)}-${id.slice(0, 8)}.json`);
    // Push the "your turn" state the moment a human agent starts waiting — the
    // engine is otherwise parked inside `await step()` with nothing to observe.
    for (const agent of this.apiAgents.values()) agent.onPending = () => this._broadcast();
    this._run();
  }

  /** Push the current per-player snapshot to every subscribed WebSocket client. */
  _broadcast() {
    if (this.wsClients.size === 0) return;
    for (const client of this.wsClients) {
      if (client.ws.readyState !== 1 /* WebSocket.OPEN */) continue;
      try { client.ws.send(JSON.stringify(this.toJSON(client.playerId))); } catch {}
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

  /** Persist the full session record — all game parameters plus the move log. */
  async _persist() {
    try {
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
    } catch {}
  }

  async _run() {
    try {
      this.engine._init();
      const g0 = this._captureGrid();
      if (g0) this.gridHistory.push(g0);
      this._broadcast();
      while (this.status === 'active') {
        const { done } = await this.engine.step();
        this._collectAnalysis();
        const g = this._captureGrid();
        if (g) this.gridHistory.push(g);
        if (done) {
          this.status = 'done';
          this.result = this.engine.result;
        }
        this._persist();
        this._broadcast();
        if (done) break;
      }
    } catch (err) {
      if (this.status !== 'closed') {
        this.status = 'error';
        this.error = err.message;
        this._broadcast();
      }
    }
  }

  close() {
    this.status = 'closed';
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

  toJSON(playerId = null) {
    const { game } = GAMES[this.gameName];
    const rawState = this.engine.state;
    // The board is ALWAYS fog-filtered for the requesting player — debugAI never reveals
    // it (it only reveals the move log below). A playerless fog request therefore cannot
    // be given any board/log state; we return session metadata only (so a client can
    // discover the human player and re-request with it) and withhold everything secret.
    const fogNoPlayer = this.fog && !playerId;
    const viewState = (this.fog && playerId && game.getVisibleState)
      ? game.getVisibleState(rawState, playerId)
      : rawState;
    const pending = this.pendingAction();
    const summary = (this.status === 'done' && rawState && game.getBattleSummary)
      ? game.getBattleSummary(rawState, this.engine.log)
      : null;
    // In fog mode (without debugAI) hide the opponent's move from log and lastActions.
    const humanIds = new Set(this.apiAgents.keys());
    const fogFilter = this.fog && !this.debugAI && !!playerId;
    const lastActions = fogNoPlayer ? null : fogFilter
      ? (rawState?.lastActions?.filter(pa => pa.playerId === playerId) ?? null)
      : (rawState?.lastActions ?? null);
    const log = fogNoPlayer ? [] : fogFilter
      ? this.engine.log.filter(e => e.playerActions?.every(pa => humanIds.has(pa.playerId)))
      : this.engine.log;
    return {
      id: this.id,
      game: this.gameName,
      params: this.params,
      fog: this.fog,
      debugAI: this.debugAI,
      status: this.status,
      result: this.result,
      summary,
      error: this.error,
      turn: rawState?.turnNumber ?? null,
      phase: rawState?.currentPhase ?? null,
      activePlayers: rawState?.activePlayers ?? [],
      humanPlayers: [...this.apiAgents.keys()],
      pendingPlayer: pending?.playerId ?? null,
      legalActions: pending?.legalActions ?? null,
      rendered: fogNoPlayer ? null : (rawState ? game.renderState(viewState) : null),
      grid: fogNoPlayer ? null : (viewState && game.toGrid ? applyAxisLabels(game, game.toGrid(viewState)) : null),
      lastActions,
      log,
      // AI deliberation (candidate moves + rankings). In fog it can leak the AI's
      // own move, so it is only revealed with debugAI on; with full information it
      // is always shown (both sides see the board anyway).
      aiAnalysis: fogNoPlayer ? null : ((this.debugAI || !this.fog) ? this.aiAnalysis : null),
    };
  }

  stateJSON(playerId = null) {
    const { game } = GAMES[this.gameName];
    const rawState = this.engine.state;
    if (this.fog && !playerId) throw new Error('player required for fog-of-war session');
    if (this.fog && playerId && game.getVisibleState) return game.getVisibleState(rawState, playerId);
    return rawState;
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

// Available for every game. 'obscuro' is the generic equilibrium/CFR agent
// (agents/ObscuroAgent.js); a game may override it with a stronger specialised
// version by declaring an 'obscuro' entry in its own `agents` array (chess does).
const BUILTIN_AGENTS = [
  { id: 'random', name: 'AI (random)' },
  { id: 'obscuro', name: 'AI (Obscuro/CFR)' },
];

// Merge builtin + game-declared agents, keeping the LAST entry per id so a
// game's specialised agent (e.g. chess's Obscuro) overrides the builtin label.
function dedupeAgents(list) {
  const byId = new Map();
  for (const a of list) byId.set(a.id, a);
  return [...byId.values()];
}

async function handleGames(res) {
  send(res, 200, Object.entries(GAMES).map(([name, { game, defaultPlayers, minPlayers, maxPlayers }]) => ({
    name,
    defaultPlayers,
    minPlayers,
    maxPlayers,
    scenarios: game.scenarios ?? [],
    gameOptions: game.gameOptions ?? [],
    ui: game.ui ?? {},
    agents: dedupeAgents([...BUILTIN_AGENTS, ...(game.agents ?? []).map(({ id, name: n }) => ({ id, name: n }))]),
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
  const engine = new GameEngine(entry.game, players, { maxTurns: config.maxTurns ?? 500, ...config, fogOfWar });
  const id = randomUUID();
  const params = { game: gameName, players: defs, config };
  const session = new Session(id, gameName, engine, apiAgents, config.fog ?? config.fogOfWar ?? false, config.debugAI ?? false, params);
  sessions.set(id, session);

  const firstHumanId = [...apiAgents.keys()][0] ?? null;
  send(res, 201, session.toJSON(firstHumanId));
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
  const playerId = url.searchParams.get('player') ?? null;
  try {
    send(res, 200, session.toJSON(playerId));
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
    validateAction(action, agent.pending.legalActions, GAMES[session.gameName].game, session.engine.state, playerId);
  } catch (e) {
    return err(res, 400, e.message);
  }

  try {
    agent.submit(action);
  } catch (e) {
    return err(res, 400, e.message);
  }

  // Give the engine a tick to advance before responding
  await new Promise(r => setImmediate(r));
  send(res, 200, session.toJSON(playerId));
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

    // POST /sessions/:id/action
    if (method === 'POST' && parts[0] === 'sessions' && parts.length === 3 && parts[2] === 'action')
      return await handleSubmitAction(req, res, parts[1]);

    // POST /sessions/:id/marker
    if (method === 'POST' && parts[0] === 'sessions' && parts.length === 3 && parts[2] === 'marker')
      return await handleSetMarker(req, res, parts[1]);

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

  const playerId = url.searchParams.get('player') ?? null;
  wss.handleUpgrade(req, socket, head, (ws) => {
    const client = { ws, playerId };
    session.wsClients.add(client);
    // Immediate snapshot so a freshly-connected client is in sync without a REST round-trip.
    try { ws.send(JSON.stringify(session.toJSON(playerId))); } catch {}
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
