/**
 * specEditor.js — the battle specs of every BattleGame the server plays, for the
 * Browser's Specs (the spec editor).
 *
 * A BattleGame made with a `specsDir` (src/battle/BattleGame.js) keeps each of
 * its named specs there as `<id>.json`, and is a scenario per spec. Its
 * `specBook` is the copy the running game plays from. An edit goes to both: the
 * file, written as the editor sent it (a spec's layout is its author's), and the
 * book, so the next session started plays the edit with no server restart.
 *
 * A spec is only saved when it can be played: it parses, its `id` is its file's,
 * and the game's own check finds nothing wrong with it (checkSpec, with the
 * game's hooks and the library's maps).
 */

import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

/** The games whose specs can be edited: { name: game } for each with a specsDir. */
export function specGames(games) {
  return Object.fromEntries(Object.entries(games)
    .filter(([, entry]) => entry.game?.specBook?.dir)
    .map(([name, entry]) => [name, entry.game]));
}

export function validateSpecId(id) {
  if (!id || typeof id !== 'string') return 'Missing spec id';
  if (!/^[a-z][a-z0-9-]*$/.test(id)) return 'A spec id is lowercase letters, digits and dashes, starting with a letter (e.g. "river-crossing")';
  return null;
}

function bookOf(games, gameName) {
  const game = specGames(games)[gameName];
  if (!game) throw new Error(`${gameName} has no editable specs`);
  return game.specBook;
}

function fileOf(book, id) {
  const err = validateSpecId(id);
  if (err) throw new Error(err);
  return join(book.dir, `${id}.json`);
}

/** The spec a text holds, or an error saying why it holds none. */
export function parseSpec(text) {
  let raw;
  try { raw = JSON.parse(text); } catch (e) { throw new Error(`Not JSON: ${e.message}`); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('A spec is a JSON object');
  return raw;
}

const countOf = (v) => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0);

/** What the Browser lists about one spec. */
function specRecord(gameName, book, id) {
  const raw = book.get(id);
  return {
    id: `${gameName}/${id}`,
    game: gameName,
    spec: id,
    name: raw.name ?? id,
    description: raw.description ?? '',
    file: `${id}.json`,
    // A spec on a library map takes its board from there.
    board: raw.map ? `map ${raw.map}` : raw.board?.topology ?? 'square',
    unitTypes: countOf(raw.unitTypes),
    abilities: countOf(raw.abilities),
    attributes: countOf(raw.attributes),
    victory: (raw.victory ?? [{ type: 'eliminate' }]).map((v) => v.type ?? v.fn).join(', '),
    errors: book.check(raw),
  };
}

/** Every editable spec of every game, as the Browser lists them. */
export function listSpecs(games) {
  return Object.entries(specGames(games)).flatMap(([name, game]) =>
    game.specBook.ids().map((id) => specRecord(name, game.specBook, id)));
}

/** A spec's text: its file as written, or (a spec with no file) its JSON. */
export async function readSpec(games, gameName, id) {
  const book = bookOf(games, gameName);
  if (!book.get(id)) throw new Error(`${gameName} has no spec "${id}"`);
  let text;
  try { text = await readFile(fileOf(book, id), 'utf8'); } catch { text = JSON.stringify(book.get(id), null, 2) + '\n'; }
  return { text, errors: book.check(book.get(id)) };
}

/** What is wrong with a spec's text as the game would play it, saving nothing. */
export function checkSpecText(games, gameName, text) {
  const book = bookOf(games, gameName);
  try { return { errors: book.check(parseSpec(text)) }; } catch (e) { return { errors: [e.message] }; }
}

function playable(book, id, text) {
  const raw = parseSpec(text);
  if (raw.id !== id) throw new Error(`The spec's "id" is "${raw.id}", and its file is ${id}.json: they must be the same`);
  const errors = book.check(raw);
  if (errors.length) throw new Error(`It can't be played yet:\n${errors.join('\n')}`);
  return raw;
}

const withNewline = (text) => (text.endsWith('\n') ? text : text + '\n');

/** Saves an existing spec, and plays it from the next session on. */
export async function writeSpec(games, gameName, id, text) {
  const book = bookOf(games, gameName);
  if (!book.get(id)) throw new Error(`${gameName} has no spec "${id}"`);
  const raw = playable(book, id, text);
  await writeFile(fileOf(book, id), withNewline(text));
  book.put(id, raw);
  return specRecord(gameName, book, id);
}

// What a new spec starts as when it copies nothing: two small armies on open
// ground, which play as they are and show where everything else goes.
const STARTER = (id, name) => ({
  id,
  name,
  description: '',
  unitTypes: {
    soldier: { name: 'Soldier', glyph: 'S', hp: 10, attack: 4, defense: 4, range: 1, speed: 3, rate: 1, vision: 5 },
    archer: { name: 'Archer', glyph: 'A', hp: 8, attack: 4, defense: 2, range: 4, speed: 3, rate: 1, vision: 6 },
  },
  board: { topology: 'square', width: 12, height: 8 },
  armies: [['soldier', 'soldier', 'archer']],
  victory: [{ type: 'eliminate' }],
});

/**
 * A new spec `id`, named `name`: a copy of the game's spec `from`, or the
 * starter. A copy keeps the original's layout, with its id and name changed.
 */
export async function createSpec(games, gameName, { id, name, from } = {}) {
  const book = bookOf(games, gameName);
  const file = fileOf(book, id);
  if (book.get(id)) throw new Error(`${gameName} already has a spec "${id}"`);
  let text;
  if (from) {
    const source = book.get(from);
    if (!source) throw new Error(`${gameName} has no spec "${from}" to copy`);
    const title = name || `${source.name ?? from} (copy)`;
    text = (await readSpec(games, gameName, from)).text
      .replace(/("id"\s*:\s*)"[^"]*"/, (_, key) => `${key}${JSON.stringify(id)}`)
      .replace(/("name"\s*:\s*)"(?:[^"\\]|\\.)*"/, (_, key) => `${key}${JSON.stringify(title)}`);
    // The first "id" and "name" are the spec's own in every spec laid out as
    // they are here; where they weren't, write it out afresh instead.
    const copy = parseSpec(text);
    if (copy.id !== id || copy.name !== title) text = JSON.stringify({ ...source, id, name: title }, null, 2);
  } else {
    text = JSON.stringify(STARTER(id, name || id), null, 2);
  }
  const raw = playable(book, id, text);
  await writeFile(file, withNewline(text));
  book.put(id, raw);
  return specRecord(gameName, book, id);
}

/** Deletes a spec: its file, and its scenario from the next listing on. */
export async function deleteSpec(games, gameName, id) {
  const book = bookOf(games, gameName);
  if (!book.get(id)) throw new Error(`${gameName} has no spec "${id}"`);
  await rm(fileOf(book, id), { force: true });
  book.drop(id);
  return { id: `${gameName}/${id}` };
}
