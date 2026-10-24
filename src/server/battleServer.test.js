// battleServer.test.js — the server an app constructs: one per copy of the core,
// several of them side by side in one JAS, and the /lib route the browser's
// analysis worker imports game modules through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

// Each import URL is a module instance of its own: two copies of the core, as
// two game repos vendoring it would be.
const one = await import('./battleServer.js?copy=one');
const two = await import('./battleServer.js?copy=two');
const serverOne = one.createBattleServer({ games: {} });
const serverTwo = two.createBattleServer({ games: {} });

test('one copy of the core serves one registry', () => {
  assert.throws(() => one.createBattleServer({ games: {} }), /already serves a registry/);
});

test('two battle apps on one httpServer both get their WebSocket upgrades', () => {
  const upgrades = [];
  const httpServer = { on: (event, fn) => upgrades.push([event, fn]) };
  const router = { use() {} };
  serverOne.mount(router, { id: 'first' }, httpServer);
  serverTwo.mount(router, { id: 'second' }, httpServer);
  // Mounting the same app again attaches nothing more.
  serverOne.mount(router, { id: 'first' }, httpServer);
  assert.deepEqual(upgrades.map(([event]) => event), ['upgrade', 'upgrade']);
  // Each claims only its own prefix: an upgrade for the other app is left alone.
  let destroyed = 0;
  const socket = { destroy: () => destroyed++, write() {} };
  const [[, first], [, second]] = upgrades;
  assert.equal(first({ url: '/second/sessions/x/ws' }, socket, null), false);
  assert.equal(second({ url: '/first/sessions/x/ws' }, socket, null), false);
  assert.equal(destroyed, 0);
});

// A game's own repo runs JAS with JAS_DEFAULT_APP, which serves the app at / for
// HTTP only: the Browser there opens its sockets on /sessions/:id/ws, unprefixed.
test('the app JAS serves at / gets its sockets opened at /', () => {
  const upgrades = [];
  const httpServer = { on: (event, fn) => upgrades.push(fn) };
  const was = process.env.JAS_DEFAULT_APP;
  process.env.JAS_DEFAULT_APP = 'atroot';
  try {
    serverOne.mount({ use() {} }, { id: 'atroot' }, httpServer);
  } finally {
    if (was === undefined) delete process.env.JAS_DEFAULT_APP; else process.env.JAS_DEFAULT_APP = was;
  }
  serverTwo.mount({ use() {} }, { id: 'beside' }, httpServer);
  const [atRoot, beside] = upgrades;
  let refused = 0;
  const socket = { destroy() {}, write: (s) => { if (/404/.test(s)) refused++; } };
  // No such session, so it is refused, but by the app at / — not left hanging.
  assert.equal(atRoot({ url: '/sessions/x/ws?player=p1' }, socket, null), true);
  assert.equal(refused, 1);
  // Any other socket at / is somebody else's, and an app JAS does not serve at /
  // claims nothing there.
  assert.equal(atRoot({ url: '/elsewhere/ws' }, socket, null), false);
  assert.equal(beside({ url: '/sessions/x/ws' }, socket, null), false);
});

test('/lib serves a game module with its #core imports rewritten to URLs', async () => {
  const http = serverOne.listen(0);
  try {
    if (!http.listening) await once(http, 'listening');
    const res = await fetch(`http://localhost:${http.address().port}/lib/games/arena/ArenaGame.js`);
    assert.equal(res.status, 200);
    const source = await res.text();
    assert.doesNotMatch(source, /from\s*['"]#/);
    assert.match(source, /from\s*['"]\.\.\/\.\.\/src\/battle\//);
  } finally {
    http.close();
  }
});

// A game's defaultConfig is what a session that names nothing plays, as a game
// fought under fog by default would be: an API-made session skips the setup
// form's gameOptions.
test('a session that names no fog takes the game\'s default', async () => {
  const three = await import('./battleServer.js?copy=three');
  const { ArenaGame } = await import('../../games/arena/index.js');
  const foggy = { ...ArenaGame, defaultConfig: { ...ArenaGame.defaultConfig, fogOfWar: true } };
  const seats = [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }];
  const server = three.createBattleServer({ games: { foggy: { game: foggy, minPlayers: 2, maxPlayers: 2, defaultPlayers: seats } } });
  const http = server.listen(0);
  try {
    if (!http.listening) await once(http, 'listening');
    const base = `http://localhost:${http.address().port}`;
    const start = (config) => fetch(`${base}/sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ game: 'foggy', players: seats.map(p => ({ ...p, agent: 'human' })), ...(config ? { config } : {}) }),
    }).then(r => r.json());
    const fogOf = async (s) => (await (await fetch(`${base}/sessions/${s.id}`)).json()).fog;
    assert.equal(await fogOf(await start()), true);
    assert.equal(await fogOf(await start({ fog: false })), false, 'a request still wins');
  } finally {
    http.close();
  }
});

test('/library serves a pack\'s pictures, and nothing else of it', async () => {
  const http = serverOne.listen(0);
  try {
    if (!http.listening) await once(http, 'listening');
    const base = `http://localhost:${http.address().port}/library/civ1`;
    const art = await fetch(`${base}/art/units/settlers.png`);
    assert.equal(art.status, 200);
    assert.equal(art.headers.get('content-type'), 'image/png');
    assert.equal((await fetch(`${base}/units.json`)).status, 404);
  } finally {
    http.close();
  }
});
