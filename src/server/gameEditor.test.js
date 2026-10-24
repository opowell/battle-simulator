// gameEditor.test.js — registry edits change the one entry they are about, and
// leave the rest of the registry exactly as it was written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGame, deleteGame, formatRegistry, parseRegistry, registryList, removeRegistryEntry, setRegistryEntry, updateGameMeta } from './gameEditor.js';

// A registry of two made-up games, laid out the way the editor writes one.
const seats = [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }];
const original = formatRegistry({
  alpha: { module: './alpha/index.js', export: 'AlphaGame', minPlayers: 2, maxPlayers: 2, defaultPlayers: seats, note: 'Two, because alpha is a duel.' },
  beta:  { module: './beta/index.js', export: 'BetaGame', minPlayers: 2, maxPlayers: 4, defaultPlayers: seats },
});

/** The lines of `after` that are not in `before`, and the other way round. */
function lineDiff(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  return { added: b.filter((l) => !a.includes(l)), removed: a.filter((l) => !b.includes(l)) };
}

test("the repo's own registry is laid out the way the editor writes it", async () => {
  const text = await readFile(new URL('../../games/games.json', import.meta.url), 'utf8');
  assert.equal(formatRegistry(parseRegistry(text)), text);
});

test('updating one game rewrites only that line', () => {
  const alpha = parseRegistry(original).alpha;
  const out = setRegistryEntry(original, 'alpha', { ...alpha, maxPlayers: 3 });
  const { added, removed } = lineDiff(original, out);
  assert.equal(removed.length, 1);
  assert.match(removed[0], /^ {2}"alpha":/);
  assert.equal(added.length, 1);
  assert.match(added[0], /^ {2}"alpha": .*"maxPlayers": 3,/);
  assert.equal(parseRegistry(out).alpha.maxPlayers, 3);
});

test('a new entry goes at the end, and removing it restores the file', () => {
  const entry = { module: './zz/index.js', export: 'ZzGame', minPlayers: 2, maxPlayers: 2, defaultPlayers: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] };
  const added = setRegistryEntry(original, 'zz', entry);
  assert.equal(Object.keys(parseRegistry(added)).at(-1), 'zz');
  assert.deepEqual(parseRegistry(added).zz, entry);
  assert.equal(removeRegistryEntry(added, 'zz'), original);
});

test('the list the editor shows names each game by its class', () => {
  assert.deepEqual(registryList(original).map((g) => [g.name, g.gameClass]), [['alpha', 'AlphaGame'], ['beta', 'BetaGame']]);
});

test('create, update, delete through the file API: the note survives, and the file comes back byte-identical', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bs-editor-'));
  try {
    const registry = join(dir, 'games.json');
    await writeFile(registry, original);
    const meta = { minPlayers: 2, maxPlayers: 2, defaultPlayers: [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }] };
    await createGame(registry, dir, 'zzedit', meta);
    await updateGameMeta(registry, 'zzedit', { ...meta, maxPlayers: 4 });
    await updateGameMeta(registry, 'alpha', { ...meta, maxPlayers: 2 });
    const edited = parseRegistry(await readFile(registry, 'utf8'));
    assert.equal(edited.zzedit.maxPlayers, 4);
    assert.equal(edited.zzedit.module, './zzedit/index.js');
    assert.equal(edited.zzedit.export, 'ZzeditGame');
    assert.equal(edited.alpha.note, 'Two, because alpha is a duel.');
    await updateGameMeta(registry, 'alpha', { ...meta, defaultPlayers: seats });
    await deleteGame(registry, dir, 'zzedit');
    assert.equal(await readFile(registry, 'utf8'), original);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
