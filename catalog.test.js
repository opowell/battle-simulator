// catalog.test.js — the records /ui/console browses, derived from a registry,
// live sessions and recordings without knowing any particular game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCatalog, createRecordingReader, unitRecords } from './catalog.js';

const game = {
  name: 'Duel',
  scenarios: [{ id: 'quick', name: 'Quick', description: 'Fast', config: { fog: true, players: [{}, {}, {}] } }],
  gameOptions: [{ id: 'size', label: 'Size', type: 'integer', default: 8 }],
  agents: [{ id: 'obscuro', name: 'Duel Obscuro', analyze() {} }, { id: 'duel-ai', name: 'Duel AI' }],
};
const registry = {
  duel: { game, minPlayers: 2, maxPlayers: 3, defaultPlayers: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }] },
};
const preview = () => ({
  unitTypes: ['knight', 'squire'],
  roster: [
    { id: 'k1', ownerId: 'a', type: 'knight', imagePath: null, glyph: 'K', label: 'Knight' },
    { id: 'k2', ownerId: 'b', type: 'knight', imagePath: '/images/duel/knight', glyph: 'K', label: 'Knight' },
  ],
});
const builtinAgents = [{ id: 'random', name: 'AI (random)' }, { id: 'obscuro', name: 'AI (Obscuro/CFR)' }];
const engineOptions = [{ id: 'aiDelay', label: 'AI move delay', type: 'integer', default: 0 }];

const build = (extra = {}) => buildCatalog({
  games: registry, sessions: [], recordings: [], files: { duel: [{ path: 'index.js', size: 40 }] },
  setupPreview: preview, builtinAgents, engineOptions, ...extra,
});

test('a unit type is named and pictured by its first roster entry with art, and counted per side', () => {
  const units = unitRecords('duel', preview());
  const knight = units.find((u) => u.type === 'knight');
  assert.deepEqual(knight, {
    id: 'duel/knight', game: 'duel', type: 'knight', label: 'Knight',
    imagePath: '/images/duel/knight', glyph: 'K', starting: 2, owners: ['a', 'b'],
  });
  // Offered but nobody starts with one: no art to borrow, so none is invented.
  assert.equal(units.find((u) => u.type === 'squire').starting, 0);
  assert.equal(units.find((u) => u.type === 'squire').imagePath, null);
});

test('a game carries the counts its records drill into', () => {
  const c = build();
  const [g] = c.games;
  assert.equal(g.title, 'Duel');
  assert.equal(g.scenarios, 1);
  assert.equal(g.units, 2);
  assert.equal(g.files, 1);
  assert.equal(g.live, true);
  for (const kind of ['sides', 'scenarios', 'units', 'files']) {
    assert.ok(c[kind].every((r) => r.game === 'duel'), `${kind} name their game`);
  }
  assert.equal(c.scenarios[0].players, 3);
  assert.equal(c.scenarios[0].fog, true);
});

test("a game's own agent replaces the builtin of that id for that game only", () => {
  const c = build();
  const own = c.agents.find((a) => a.id === 'duel/obscuro');
  // The only game replaced it, so nothing offers the builtin one.
  assert.equal(c.agents.find((a) => a.id === 'obscuro'), undefined);
  assert.deepEqual(own.game, ['duel']);
  assert.equal(own.analyzable, true);
  assert.deepEqual(c.agents.find((a) => a.id === 'random').game, ['duel']);
});

test('engine options are one record each, offered to every game', () => {
  const engine = build().options.find((o) => o.engine);
  assert.deepEqual(engine.game, ['duel']);
  assert.equal(engine.id, 'engine/aiDelay');
});

test('a game whose opening position throws still lists, with the reason', () => {
  const c = build({ setupPreview: () => { throw new Error('no board'); } });
  assert.equal(c.games[0].unitsError, 'no board');
  assert.equal(c.units.length, 0);
});

test('a registered game the process has not loaded is listed as needing a restart', () => {
  const c = build({ pending: [{ name: 'fresh', minPlayers: 2, maxPlayers: 2, defaultPlayers: [] }, { name: 'duel' }] });
  assert.deepEqual(c.games.map((g) => [g.name, g.live]), [['duel', true], ['fresh', false]]);
});

test('a recording still marked active with no live session was interrupted', () => {
  const session = {
    id: 'live-1', gameName: 'duel', status: 'active', createdAt: new Date(0),
    engine: { state: { turnNumber: 4 } }, pendingAction: () => ({ playerId: 'a' }),
    params: { players: [{ id: 'a', agent: 'human' }, { id: 'b', agent: 'random' }], config: {} },
  };
  const recordings = [{ id: 'live-1', status: 'active' }, { id: 'old', status: 'active' }, { id: 'won', status: 'done' }];
  const c = build({ sessions: [session], recordings });
  assert.deepEqual(c.recordings.map((r) => [r.id, r.status, r.live]), [
    ['live-1', 'active', true], ['old', 'interrupted', false], ['won', 'done', false],
  ]);
  assert.equal(c.sessions[0].humans, 1);
  assert.equal(c.sessions[0].pendingPlayer, 'a');
  assert.equal(c.games[0].sessions, 1);
});

test('recordings are read without their logs, and re-read only when a file changes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bs-catalog-'));
  try {
    const record = { id: 'r1', game: 'duel', status: 'done', params: { players: [{ id: 'a', name: 'Alpha' }] }, log: [1, 2, 3] };
    await writeFile(join(dir, 'one.json'), JSON.stringify(record));
    await writeFile(join(dir, 'broken.json'), '{ half-writ');
    await writeFile(join(dir, 'notes.txt'), 'not a recording');
    const read = createRecordingReader(dir);
    const [first] = await read();
    assert.equal(first.moves, 3);
    assert.equal(first.log, undefined);
    assert.equal(first.players[0].agent, 'human');
    assert.equal((await read()).length, 1, 'a half-written file is skipped, not fatal');

    await writeFile(join(dir, 'one.json'), JSON.stringify({ ...record, log: [1, 2, 3, 4, 5] }));
    assert.equal((await read())[0].moves, 5);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
