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
