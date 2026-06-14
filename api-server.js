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
import { readFile }              from 'node:fs/promises';
import { extname, resolve }      from 'node:path';
import { fileURLToPath }         from 'node:url';

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

const APPS_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), 'apps');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.vue':  'text/plain; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

async function serveApp(appName, req, res) {
  const urlPath  = new URL(req.url, 'http://localhost').pathname;
  const prefix   = new RegExp(`^/(?:ui/)?${appName}/?`);
  const rel      = urlPath.replace(prefix, '') || 'index.html';
  const appDir   = resolve(APPS_DIR, appName);
  const abs      = resolve(appDir, rel);

  if (!abs.startsWith(appDir + '/') && abs !== appDir) {
    res.writeHead(403); return res.end('Forbidden');
  }

  try {
    const data = await readFile(abs);
    const ct   = MIME_TYPES[extname(abs)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ct, 'Access-Control-Allow-Origin': '*' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

// ---------------------------------------------------------------------------
// Game registry
// ---------------------------------------------------------------------------

const GAMES = {
  chess:         { game: ChessGame,         defaultPlayers: [{ id: 'white', name: 'White' }, { id: 'black', name: 'Black' }] },
  tactical:      { game: TacticalGame,      defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  cardbattle:    { game: CardBattleGame,    defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  civ1:          { game: Civ1Game,          defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  civ2:          { game: Civ2Game,          defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  risk:          { game: RiskGame,          defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  axisallies:    { game: AxisAlliesGame,    defaultPlayers: [{ id: 'allies', name: 'Allies' }, { id: 'axis', name: 'Axis' }] },
  combatmission: { game: CombatMissionGame, defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  xcom:          { game: XComGame,          defaultPlayers: [{ id: 'xcom', name: 'XCOM' }, { id: 'aliens', name: 'Aliens' }] },
  aow:           { game: AowGame,           defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  cs:            { game: CsGame,            defaultPlayers: [{ id: 'ct', name: 'CT' }, { id: 't', name: 'T' }] },
  ffta:          { game: FFTAGame,          defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  sc1:           { game: Sc1Game,           defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  sc2:           { game: Sc2Game,           defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] },
  doom:          { game: DoomGame,          defaultPlayers: [{ id: 'marine', name: 'Marine' }, { id: 'demons', name: 'Demons' }] },
  mudandblood:   { game: MudAndBloodGame,  defaultPlayers: [{ id: 'allies', name: 'Allies' }, { id: 'axis', name: 'Axis' }] },
  kdice:         { game: KDiceGame,        defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }, { id: 'p3', name: 'Player 3' }] },
};

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

const sessions = new Map();

class Session {
  constructor(id, gameName, engine, apiAgents) {
    this.id = id;
    this.gameName = gameName;
    this.engine = engine;
    this.apiAgents = apiAgents; // Map<playerId, ApiAgent>
    this.status = 'active';
    this.result = null;
    this.error = null;
    this._run();
  }

  async _run() {
    try {
      this.engine._init();
      while (this.status === 'active') {
        const { done } = await this.engine.step();
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
    const viewState = (playerId && game.getVisibleState)
      ? game.getVisibleState(rawState, playerId)
      : rawState;
    const pending = this.pendingAction();
    return {
      id: this.id,
      game: this.gameName,
      status: this.status,
      result: this.result,
      error: this.error,
      turn: rawState?.turnNumber ?? null,
      phase: rawState?.currentPhase ?? null,
      activePlayers: rawState?.activePlayers ?? [],
      humanPlayers: [...this.apiAgents.keys()],
      pendingPlayer: pending?.playerId ?? null,
      legalActions: pending?.legalActions ?? null,
      rendered: rawState ? game.renderState(viewState) : null,
      grid: stateToGrid(this.gameName, viewState),
    };
  }

  stateJSON(playerId = null) {
    const { game } = GAMES[this.gameName];
    const rawState = this.engine.state;
    if (playerId && game.getVisibleState) return game.getVisibleState(rawState, playerId);
    return rawState;
  }
}

// ---------------------------------------------------------------------------
// Structured grid extraction
// Each game resolves terrain → color via game.colors; the frontend is color-agnostic.
// ---------------------------------------------------------------------------

function stateToGrid(gameName, state) {
  if (!state) return null;
  try {
    const { game } = GAMES[gameName] ?? {};
    const colors = game?.colors ?? {};
    const players = state.players ?? [];
    const pidIdx = {};
    players.forEach((p, i) => { pidIdx[p.id] = i + 1; });

    if (gameName === 'chess') {
      const FILES = 'abcdefgh';
      const SYMS = { king: 'K', queen: 'Q', rook: 'R', bishop: 'B', knight: 'N', pawn: 'P' };
      const cells = [];
      for (let rank = 1; rank <= 8; rank++) {
        for (let fi = 0; fi < 8; fi++) {
          const piece = state.board?.[FILES[fi] + rank];
          const sq = (fi + rank) % 2 === 0 ? 'light' : 'dark';
          cells.push({
            x: fi, y: 8 - rank,
            glyph: piece ? (SYMS[piece.type] ?? piece.type[0].toUpperCase()) : '',
            owner: piece ? (pidIdx[piece.ownerId] ?? 0) : 0,
            color: colors[sq] ?? '#808070',
          });
        }
      }
      return { width: 8, height: 8, cells, xLabels: FILES.split(''), yLabels: '87654321'.split('') };
    }

    if (gameName === 'tactical') {
      const { board, units } = state;
      const { width, height, terrain: tmap = {} } = board;
      const umap = {};
      for (const u of units ?? []) if (u.alive) umap[`${u.position.x},${u.position.y}`] = u;
      const cells = [];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const u = umap[`${x},${y}`];
          const t = tmap[`${x},${y}`] ?? 'plains';
          cells.push({
            x, y: height - 1 - y,
            glyph: u ? u.type[0].toUpperCase() : '',
            owner: u ? (pidIdx[u.ownerId] ?? 0) : 0,
            color: colors[t] ?? colors.plains ?? '#808070',
            hp: u?.hp, maxHp: u?.maxHp,
          });
        }
      }
      return { width, height, cells };
    }

    if (gameName === 'xcom') {
      const { board, units } = state;
      const { width, height, tiles } = board;
      const umap = {};
      for (const u of units ?? []) if (u.alive) umap[`${u.position.x},${u.position.y}`] = u;
      const CH = { '.': 'floor', '#': 'wall', c: 'cover-low', C: 'cover-high' };
      const cells = [];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const ch = tiles[y]?.[x] ?? '#';
          const u = umap[`${x},${y}`];
          const t = CH[ch] ?? 'floor';
          cells.push({
            x, y,
            glyph: u ? (u.attrs?.symbol ?? u.type?.[0]?.toUpperCase() ?? '?') : '',
            owner: u ? (pidIdx[u.ownerId] ?? 0) : 0,
            color: colors[t] ?? '#808070',
            hp: u?.hp, maxHp: u?.maxHp,
          });
        }
      }
      return { width, height, cells };
    }

    if (gameName === 'civ1' || gameName === 'civ2') {
      const { board, units = [], cities = [] } = state;
      const { width, height, tiles } = board;
      const umap = {}, cmap = {};
      for (const u of units) if (u.alive) umap[`${u.position.x},${u.position.y}`] = u;
      for (const c of cities) cmap[`${c.position.x},${c.position.y}`] = c;
      const gameAssets = game?.assets;
      const cells = [];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const tile = tiles[`${x},${y}`] ?? {};
          const u = umap[`${x},${y}`];
          const city = cmap[`${x},${y}`];
          const ta = gameAssets?.terrain?.[tile.terrain];
          const ua = u ? gameAssets?.units?.[u.type] : null;
          const ca = !u && city ? gameAssets?.city : null;
          cells.push({
            x, y: height - 1 - y,
            glyph: u ? u.type[0].toUpperCase() : city ? '★' : '',
            emoji: (ua ?? ca ?? ta)?.emoji ?? null,
            owner: u ? (pidIdx[u.ownerId] ?? 0) : city ? (pidIdx[city.ownerId] ?? 0) : 0,
            color: ta?.color ?? colors[tile.terrain] ?? colors.plains ?? '#808070',
            hp: u?.hp,
            maxHp: u?.maxHp,
          });
        }
      }
      return { width, height, cells };
    }

    if (gameName === 'sc1' || gameName === 'sc2') {
      const { board, units = [], buildings = [] } = state;
      const { width, height, tiles } = board;
      const umap = {}, bmap = {};
      for (const u of units) if (u.alive) umap[`${u.position.x},${u.position.y}`] = u;
      for (const b of buildings) if (b.alive) bmap[`${b.position.x},${b.position.y}`] = b;
      const cells = [];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const tile = tiles[`${x},${y}`] ?? {};
          const u = umap[`${x},${y}`];
          const b = bmap[`${x},${y}`];
          cells.push({
            x, y: height - 1 - y,
            glyph: u ? u.type[0].toUpperCase() : b ? b.type[0].toUpperCase() : '',
            owner: u ? (pidIdx[u.ownerId] ?? 0) : b ? (pidIdx[b.ownerId] ?? 0) : 0,
            color: colors[tile.terrain] ?? colors.open ?? '#808070',
          });
        }
      }
      return { width, height, cells };
    }

    if (gameName === 'aow') {
      const { board, units = [] } = state;
      const { width, height, tiles } = board;
      const umap = {};
      for (const u of units) if (u.alive) umap[`${u.position.x},${u.position.y}`] = u;
      const cells = [];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const tile = tiles[`${x},${y}`] ?? {};
          const u = umap[`${x},${y}`];
          cells.push({
            x, y: height - 1 - y,
            glyph: u ? u.type[0].toUpperCase() : '',
            owner: u ? (pidIdx[u.ownerId] ?? 0) : 0,
            color: colors[tile.terrain] ?? colors.plains ?? '#808070',
            hp: u?.hp, maxHp: u?.maxHp,
          });
        }
      }
      return { width, height, cells };
    }

    if (gameName === 'ffta') {
      const { board, units = [] } = state;
      const { width, height, tiles } = board;
      const umap = {};
      for (const u of units) if (u.alive) umap[`${u.position.x},${u.position.y}`] = u;
      const cells = [];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const tile = tiles[`${x},${y}`] ?? {};
          const t = !tile.passable ? 'wall' : tile.height === 2 ? 'elevated-high' : tile.height === 1 ? 'elevated' : 'floor';
          const u = umap[`${x},${y}`];
          cells.push({
            x, y,
            glyph: u ? (u.symbol ?? u.job?.[0]?.toUpperCase() ?? '?') : '',
            owner: u ? (pidIdx[u.ownerId] ?? 0) : 0,
            color: colors[t] ?? '#808070',
            hp: u?.hp, maxHp: u?.maxHp,
          });
        }
      }
      return { width, height, cells };
    }

    if (gameName === 'mudandblood') {
      const MNB_COLOR = {
        '.': '#c8b87a', '~': '#5a4530', 'o': '#8a7a6a',
        's': '#b8a040', 'T': '#4a3828', '#': '#1a1208',
      };
      const { board, units = [] } = state;
      const { width, height, tiles } = board;
      const umap = {};
      for (const u of units) if (u.alive) umap[`${u.position.x},${u.position.y}`] = u;
      const cells = [];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const ch = tiles[y]?.[x] ?? '.';
          const u  = umap[`${x},${y}`];
          cells.push({
            x, y,
            glyph: u ? u.attrs.symbol : '',
            owner: u ? (pidIdx[u.ownerId] ?? 0) : 0,
            color: MNB_COLOR[ch] ?? MNB_COLOR['.'],
            hp: u?.hp, maxHp: u?.maxHp,
          });
        }
      }
      return { width, height, cells };
    }
  } catch {}
  return null;
}

// ---------------------------------------------------------------------------
// Router helpers
// ---------------------------------------------------------------------------

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

async function handleGames(res) {
  send(res, 200, Object.entries(GAMES).map(([name, { game, defaultPlayers }]) => ({
    name,
    defaultPlayers,
    scenarios: game.scenarios ?? [],
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
    if (agentType === 'random') {
      agent = RandomAgent;
    } else {
      const a = new ApiAgent(id);
      apiAgents.set(id, a);
      agent = a;
    }
    return { id, name: name ?? id, agent };
  });

  const engine = new GameEngine(entry.game, players, { maxTurns: config.maxTurns ?? 500, ...config });
  const id = randomUUID();
  const session = new Session(id, gameName, engine, apiAgents);
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
    const UI_APPS = ['classic', 'minimal', 'modern', 'design'];
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
