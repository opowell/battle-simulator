// gameEditor.test.js — registry edits change the one entry they are about, and
// leave the rest of api-server.js exactly as it was written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame, deleteGame, parseRegistry, removeRegistryEntry, setRegistryEntry, updateGameMeta } from './gameEditor.js';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const original = await readFile(join(ROOT, 'api-server.js'), 'utf8');

/** The lines of `after` that are not in `before`, and the other way round. */
function lineDiff(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  return { added: b.filter((l) => !a.includes(l)), removed: a.filter((l) => !b.includes(l)) };
}

test('updating one game rewrites only that line', () => {
  const chess = parseRegistry(original).chess;
  const out = setRegistryEntry(original, 'chess', { ...chess, maxPlayers: 3 });
  const { added, removed } = lineDiff(original, out);
  assert.equal(removed.length, 1);
  assert.match(removed[0], /^ {2}chess:/);
  assert.equal(added.length, 1);
  assert.match(added[0], /^ {2}chess: .*maxPlayers: 3,/);
  assert.equal(parseRegistry(out).chess.maxPlayers, 3);
});

test("the block's comments and computed values survive an edit elsewhere in it", () => {
  const comments = original.match(/^ {2}\/\/.*$/gm) ?? [];
  assert.ok(comments.length > 0, 'this test needs the registry to carry comments');
  const tactical = parseRegistry(original).tactical;
  const out = setRegistryEntry(original, 'tactical', { ...tactical, minPlayers: 3 });
  for (const c of comments) assert.ok(out.includes(c), `lost: ${c}`);
  assert.match(out, /risk: .*Array\.from\(/);
});

test('a new entry goes at the end of the block, and removing it restores the file', () => {
  const entry = { game: 'ZzGame', minPlayers: 2, maxPlayers: 2, defaultPlayers: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] };
  const added = setRegistryEntry(original, 'zz', entry);
  const names = Object.keys(parseRegistry(added));
  assert.equal(names.at(-1), 'zz');
  assert.deepEqual(parseRegistry(added).zz, entry);
  assert.equal(removeRegistryEntry(added, 'zz'), original);
});

test("removing an entry takes the comment above it, which was about it", () => {
  const [, comment] = original.match(/((?:^ {2}\/\/.*\n)+)^ {2}civ1:/m) ?? [];
  assert.ok(comment, 'this test needs civ1 to carry a comment');
  const out = removeRegistryEntry(original, 'civ1');
  assert.equal(parseRegistry(out).civ1, undefined);
  assert.ok(!out.includes(comment));
  assert.ok(parseRegistry(out).civ2, 'the next entry is untouched');
});

test('create then delete through the file API leaves api-server.js byte-identical', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bs-editor-'));
  try {
    const server = join(dir, 'api-server.js');
    await copyFile(join(ROOT, 'api-server.js'), server);
    const meta = { minPlayers: 2, maxPlayers: 2, defaultPlayers: [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }] };
    await createGame(server, dir, 'zzedit', meta);
    await updateGameMeta(server, 'zzedit', { ...meta, maxPlayers: 4 });
    const edited = await readFile(server, 'utf8');
    assert.equal(parseRegistry(edited).zzedit.maxPlayers, 4);
    assert.match(edited, /import \{ ZzeditGame \} from '\.\/games\/zzedit\/index\.js';/);
    await deleteGame(server, dir, 'zzedit');
    assert.equal(await readFile(server, 'utf8'), original);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an entry that is not one line is refused rather than half-rewritten', () => {
  const split = original.replace(/^( {2}chess: +\{ game: ChessGame,)/m, '$1\n   ');
  assert.notEqual(split, original);
  const chess = parseRegistry(split).chess;
  assert.throws(() => setRegistryEntry(split, 'chess', { ...chess, maxPlayers: 3 }), /edit it by hand/);
});
