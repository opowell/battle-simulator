// specEditor.test.js — battle specs edited as files and played at once: a save
// reaches the next session with no restart, and nothing that can't be played is
// saved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeBattleGame } from '../battle/BattleGame.js';
import { listSpecs, readSpec, checkSpecText, writeSpec, createSpec, deleteSpec, specGames } from './specEditor.js';

const PLAYERS = [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }];

// A BattleGame with one spec on disk, laid out by hand.
function sandbox(name) {
  const dir = mkdtempSync(join(tmpdir(), 'battle-specs-'));
  const duel = { id: 'duel', name: 'Duel', unitTypes: { pike: { hp: 9, attack: 3, defense: 3, range: 1, speed: 2, rate: 1, vision: 4 } }, board: { width: 8, height: 6 } };
  const text = '{\n  "id": "duel", "name": "Duel",\n  "unitTypes": { "pike": { "hp": 9, "attack": 3, "defense": 3, "range": 1, "speed": 2, "rate": 1, "vision": 4 } },\n  "board": { "width": 8, "height": 6 }\n}\n';
  writeFileSync(join(dir, 'duel.json'), text);
  const game = makeBattleGame({ name, specs: { duel }, specsDir: dir, scenarios: () => game.specBook.ids().map(id => ({ id, config: { spec: id } })) });
  return { dir, text, games: { [name]: { game } }, game };
}

const hpOf = (game, spec) => game.createInitialState(PLAYERS, { spec }).units[0].hp;

test('only a BattleGame with a specs folder has editable specs', () => {
  const { games } = sandbox('Spec list');
  const plain = makeBattleGame({ name: 'Spec list, no folder', specs: { a: { unitTypes: { x: { hp: 1 } } } } });
  assert.deepEqual(Object.keys(specGames({ ...games, other: { game: plain }, custom: { game: {} } })), ['Spec list']);
  const [rec] = listSpecs(games);
  assert.equal(rec.id, 'Spec list/duel');
  assert.equal(rec.board, 'square');
  assert.equal(rec.unitTypes, 1);
  assert.deepEqual(rec.errors, []);
});

test('a saved spec is played by the next session, and its file keeps the layout it was sent in', async () => {
  const { dir, text, games, game } = sandbox('Spec save');
  assert.equal((await readSpec(games, 'Spec save', 'duel')).text, text);
  assert.equal(hpOf(game, 'duel'), 9);
  const edited = text.replace('"hp": 9', '"hp": 15');
  await writeSpec(games, 'Spec save', 'duel', edited);
  assert.equal(readFileSync(join(dir, 'duel.json'), 'utf8'), edited);
  assert.equal(hpOf(game, 'duel'), 15, 'no restart needed');
});

test('a spec that can\'t be played is not saved, and the check says why', async () => {
  const { dir, text, games, game } = sandbox('Spec refuse');
  const broken = text.replace('"hp": 9', '"hp": 0');
  assert.match(checkSpecText(games, 'Spec refuse', broken).errors.join(), /hp: must be > 0/);
  await assert.rejects(writeSpec(games, 'Spec refuse', 'duel', broken), /can't be played yet/);
  await assert.rejects(writeSpec(games, 'Spec refuse', 'duel', '{ nope'), /Not JSON/);
  await assert.rejects(writeSpec(games, 'Spec refuse', 'duel', text.replace('"id": "duel"', '"id": "other"')), /must be the same/);
  assert.equal(readFileSync(join(dir, 'duel.json'), 'utf8'), text);
  assert.equal(hpOf(game, 'duel'), 9);
});

test('a new spec is a copy or the starter, and a scenario at once; a deleted one is gone', async () => {
  const { dir, games, game } = sandbox('Spec create');
  const copy = await createSpec(games, 'Spec create', { id: 'duel-two', from: 'duel' });
  assert.equal(copy.name, 'Duel (copy)');
  const text = readFileSync(join(dir, 'duel-two.json'), 'utf8');
  assert.match(text, /"id": "duel-two", "name": "Duel \(copy\)",\n/, 'the original\'s layout');
  assert.equal(hpOf(game, 'duel-two'), 9);
  const fresh = await createSpec(games, 'Spec create', { id: 'starter', name: 'Starter' });
  assert.deepEqual(fresh.errors, []);
  assert.equal(game.createInitialState(PLAYERS, { spec: 'starter' }).units.length, 6);
  assert.deepEqual(game.scenarios.map(s => s.id), ['duel', 'duel-two', 'starter']);
  await assert.rejects(createSpec(games, 'Spec create', { id: 'duel' }), /already has/);
  await assert.rejects(createSpec(games, 'Spec create', { id: '../escape' }), /lowercase letters/);
  await deleteSpec(games, 'Spec create', 'duel-two');
  assert.equal(existsSync(join(dir, 'duel-two.json')), false);
  assert.deepEqual(game.scenarios.map(s => s.id), ['duel', 'starter']);
  assert.throws(() => game.createInitialState(PLAYERS, { spec: 'duel-two' }), /no spec "duel-two"/);
});

test('Arena keeps its specs as files, and every one of them plays as it stands', async () => {
  const { ArenaGame } = await import('../../games/arena/index.js');
  const games = { arena: { game: ArenaGame } };
  const specs = listSpecs(games);
  assert.ok(specs.length >= 5);
  for (const s of specs.filter(s => !s.board.startsWith('map'))) assert.deepEqual(s.errors, [], s.id);
  for (const s of specs) assert.ok(existsSync(join(ArenaGame.specBook.dir, s.file)), s.file);
});
