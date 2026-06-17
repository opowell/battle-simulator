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
import { extname, resolve, sep, dirname } from 'node:path';
import { fileURLToPath }         from 'node:url';

// Lazy-loaded Whisper transcriber (first call downloads ~40 MB model)
let _transcriber = null;
async function getTranscriber() {
  if (!_transcriber) {
    const { pipeline } = await import('@xenova/transformers');
    _transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny');
  }
  return _transcriber;
}
// Warm up in background so first real request is fast
getTranscriber().catch(() => {});

import { GameEngine } from './engine/index.js';
import { RandomAgent } from './agents/index.js';
import { ApiAgent } from './agents/ApiAgent.js';

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

// ---------------------------------------------------------------------------
// Static file serving — /ui/<name>/* → apps/<name>/
// ---------------------------------------------------------------------------

const ROOT_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)));
const APPS_DIR = resolve(ROOT_DIR, 'apps');
const GAMES_DIR = resolve(ROOT_DIR, 'games');
const SESSIONS_DIR = resolve(ROOT_DIR, 'sessions');

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
    res.writeHead(200, { 'Content-Type': ct, 'Access-Control-Allow-Origin': '*' });
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

  // /images/:game/:job/:type  →  games/:game/images/:job/{type}*
  if (type) {
    const safeType = type.replace(/[^a-zA-Z0-9_-]/g, '');
    const subdir = resolve(GAMES_DIR, gameName, 'images', safe);
    let files;
    try { files = await readdir(subdir); } catch { files = []; }
    // collect candidates whose stem starts with safeType
    const candidates = files
      .map(f => { const dot = f.lastIndexOf('.'); return dot < 0 ? null : { f, ext: f.slice(dot + 1).toLowerCase() }; })
      .filter(x => x && f_stem(x.f).startsWith(safeType))
      .sort((a, b) => (TYPE_EXT_PREF[a.ext] ?? 99) - (TYPE_EXT_PREF[b.ext] ?? 99));
    for (const { f } of candidates) {
      try {
        const data = await readFile(resolve(subdir, f));
        const ext = f.slice(f.lastIndexOf('.'));
        const ct = sniffMime(data) ?? MIME_TYPES[ext] ?? 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': ct, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=86400' });
        return res.end(data);
      } catch {}
    }
    res.writeHead(404); res.end('Not found');
    return;
  }

  // /images/:game/:job  →  games/:game/images/:job.*  (flat file)
  const dir = resolve(GAMES_DIR, gameName, 'images');
  let files;
  try { files = await readdir(dir); } catch { files = []; }
  for (const f of files) {
    const dot = f.lastIndexOf('.');
    if (dot < 0) continue;
    if (f.slice(0, dot) === safe) {
      try {
        const data = await readFile(resolve(dir, f));
        const ct = sniffMime(data) ?? MIME_TYPES[f.slice(dot)] ?? 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': ct, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=86400' });
        return res.end(data);
      } catch {}
    }
  }
  res.writeHead(404); res.end('Not found');
}

function f_stem(f) { const dot = f.lastIndexOf('.'); return dot < 0 ? f : f.slice(0, dot); }

// ---------------------------------------------------------------------------
// Game registry
// ---------------------------------------------------------------------------

const GAMES = {
  chess:         { game: ChessGame,         icon: 'crown',     minPlayers: 2, maxPlayers: 2,  defaultPlayers: [{ id: 'white', name: 'White' }, { id: 'black', name: 'Black' }] },
  tactical:      { game: TacticalGame,      icon: 'target',    minPlayers: 2, maxPlayers: 4,  defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  cardbattle:    { game: CardBattleGame,    icon: 'cards',     minPlayers: 2, maxPlayers: 2,  defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  civ1:          { game: Civ1Game,          icon: 'flag',      minPlayers: 2, maxPlayers: 4,  defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  civ2:          { game: Civ2Game,          icon: 'city',      minPlayers: 2, maxPlayers: 4,  defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  risk:          { game: RiskGame,          icon: 'globe',     minPlayers: 2, maxPlayers: 6,  defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  axisallies:    { game: AxisAlliesGame,    icon: 'plane',     minPlayers: 2, maxPlayers: 5,  defaultPlayers: [{ id: 'allies', name: 'Allies' }, { id: 'axis', name: 'Axis' }] },
  combatmission: { game: CombatMissionGame, icon: 'tank',      minPlayers: 2, maxPlayers: 2,  defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  xcom:          { game: XComGame,          icon: 'ufo',       minPlayers: 2, maxPlayers: 2,  defaultPlayers: [{ id: 'xcom', name: 'XCOM' }, { id: 'aliens', name: 'Aliens' }] },
  aow:           { game: AowGame,           icon: 'wand',      minPlayers: 2, maxPlayers: 4,  defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  cs:            { game: CsGame,            icon: 'crosshair', minPlayers: 2, maxPlayers: 10, defaultPlayers: [{ id: 'ct', name: 'CT' }, { id: 't', name: 'T' }] },
  ffta:          { game: FFTAGame,          icon: 'sword',     minPlayers: 2, maxPlayers: 2,  defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  sc1:           { game: Sc1Game,           icon: 'zap',       minPlayers: 2, maxPlayers: 4,  defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  sc2:           { game: Sc2Game,           icon: 'star',      minPlayers: 2, maxPlayers: 4,  defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  doom:          { game: DoomGame,          icon: 'flame',     minPlayers: 2, maxPlayers: 2,  defaultPlayers: [{ id: 'marine', name: 'Marine' }, { id: 'demons', name: 'Demons' }] },
  mudandblood:   { game: MudAndBloodGame,   icon: 'skull',     minPlayers: 2, maxPlayers: 2,  defaultPlayers: [{ id: 'allies', name: 'Allies' }, { id: 'axis', name: 'Axis' }] },
  kdice:         { game: KDiceGame,         icon: 'dice',      minPlayers: 2, maxPlayers: 6,  defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }, { id: 'p3', name: 'Player 3' }] },
};

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

const sessions = new Map();

class Session {
  constructor(id, gameName, engine, apiAgents, fog = false) {
    this.id = id;
    this.gameName = gameName;
    this.engine = engine;
    this.apiAgents = apiAgents; // Map<playerId, ApiAgent>
    this.fog = fog;
    this.status = 'active';
    this.result = null;
    this.error = null;
    this._logPath = resolve(SESSIONS_DIR, id, 'log.json');
    this._run();
  }

  async _persistLog() {
    try {
      await mkdir(dirname(this._logPath), { recursive: true });
      await writeFile(this._logPath, JSON.stringify(this.engine.log, null, 2));
    } catch {}
  }

  async _run() {
    try {
      this.engine._init();
      while (this.status === 'active') {
        const { done } = await this.engine.step();
        this._persistLog();
        if (done) {
          this.status = 'done';
          this.result = this.engine.result;
          break;
        }
      }
    } catch (err) {
      if (this.status !== 'closed') {
        this.status = 'error';
        this.error = err.message;
      }
    }
  }

  close() {
    this.status = 'closed';
    for (const agent of this.apiAgents.values()) agent.abort('Session closed');
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
    const viewState = (this.fog && playerId && game.getVisibleState)
      ? game.getVisibleState(rawState, playerId)
      : rawState;
    const pending = this.pendingAction();
    const summary = (this.status === 'done' && rawState && game.getBattleSummary)
      ? game.getBattleSummary(rawState, this.engine.log)
      : null;
    return {
      id: this.id,
      game: this.gameName,
      fog: this.fog,
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
      rendered: rawState ? game.renderState(viewState) : null,
      grid: viewState && game.toGrid ? applyAxisLabels(game, game.toGrid(viewState)) : null,
      lastActions: rawState?.lastActions ?? null,
      log: this.engine.log,
    };
  }

  stateJSON(playerId = null) {
    const { game } = GAMES[this.gameName];
    const rawState = this.engine.state;
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

function readBinaryBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handleTranscribe(req, res) {
  const buf = await readBinaryBody(req);
  if (buf.length === 0 || buf.length % 4 !== 0) return err(res, 400, 'Expected Float32Array binary body');
  const float32 = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  try {
    const t = await getTranscriber();
    const result = await t(float32, { language: 'english', task: 'transcribe' });
    send(res, 200, { text: result.text?.trim() ?? '' });
  } catch (e) {
    err(res, 500, e.message);
  }
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

const BUILTIN_AGENTS = [
  { id: 'random', name: 'AI (random)' },
];

async function handleGames(res) {
  send(res, 200, Object.entries(GAMES).map(([name, { game, icon, defaultPlayers, minPlayers, maxPlayers }]) => ({
    name,
    icon,
    defaultPlayers,
    minPlayers,
    maxPlayers,
    scenarios: game.scenarios ?? [],
    gameOptions: game.gameOptions ?? [],
    ui: game.ui ?? {},
    agents: [...BUILTIN_AGENTS, ...(game.agents ?? []).map(({ id, name: n }) => ({ id, name: n }))],
  })));
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
  const session = new Session(id, gameName, engine, apiAgents, config.fog ?? config.fogOfWar ?? false);
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
  send(res, 200, session.toJSON(playerId));
}

async function handleGetState(res, id, url) {
  const session = sessions.get(id);
  if (!session) return err(res, 404, 'Session not found');
  const playerId = url.searchParams.get('player') ?? null;
  send(res, 200, session.stateJSON(playerId));
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

  try {
    agent.submit(action);
  } catch (e) {
    return err(res, 400, e.message);
  }

  // Give the engine a tick to advance before responding
  await new Promise(r => setImmediate(r));
  send(res, 200, session.toJSON(playerId));
}

async function handleGetLog(res, id) {
  const session = sessions.get(id);
  if (!session) return err(res, 404, 'Session not found');
  send(res, 200, session.engine.log);
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

const PORT = process.env.PORT ?? 3000;

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  try {
    const { parts, method, url } = route(req);

    // Default — redirect to modern UI
    if (method === 'GET' && parts[0] === '') {
      res.writeHead(302, { Location: '/ui/modern' });
      return res.end();
    }

    // Static UI apps — GET /ui/<name>/* or GET /design/* (legacy)
    const UI_APPS = ['classic', 'minimal', 'modern', 'design', 'voice', 'voice2'];
    if (method === 'GET' && parts[0] === 'ui' && UI_APPS.includes(parts[1])) {
      // Redirect /ui/<name> (no trailing slash) so relative asset paths resolve correctly
      if (parts.length === 2 && !url.pathname.endsWith('/')) {
        res.writeHead(302, { Location: `/ui/${parts[1]}/` });
        return res.end();
      }
      return await serveApp(parts[1], req, res);
    }
    if (method === 'GET' && parts[0] === 'design')
      return await serveApp('design', req, res);

    // POST /api/transcribe — offline Whisper transcription (Float32Array binary body at 16kHz)
    if (method === 'POST' && parts[0] === 'api' && parts[1] === 'transcribe')
      return await handleTranscribe(req, res);

    // GET /images/:game/:job[/:type] — serve game images (e.g. /images/ffta/soldier/sprite)
    if (method === 'GET' && parts[0] === 'images' && (parts.length === 3 || parts.length === 4))
      return await serveGameImage(parts[1], parts[2], res, parts[3]);

    // GET /games
    if (method === 'GET' && parts[0] === 'games' && parts.length === 1)
      return await handleGames(res);

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

    // POST /sessions/:id/action
    if (method === 'POST' && parts[0] === 'sessions' && parts.length === 3 && parts[2] === 'action')
      return await handleSubmitAction(req, res, parts[1]);

    // DELETE /sessions/:id
    if (method === 'DELETE' && parts[0] === 'sessions' && parts.length === 2)
      return await handleDeleteSession(res, parts[1]);

    err(res, 404, 'Not found');
  } catch (e) {
    console.error(e);
    err(res, 500, e.message);
  }
});

server.listen(PORT, () => {
  console.log(`Battle Simulator API running on http://localhost:${PORT}`);
  console.log(`\nGames: ${Object.keys(GAMES).join(', ')}`);
  console.log(`\nQuick start:`);
  console.log(`  POST /sessions  { "game": "chess", "players": [{"id":"white","agent":"human"},{"id":"black","agent":"random"}] }`);
  console.log(`  POST /sessions/:id/action  { "playerId": "white", "action": {...} }`);
});
