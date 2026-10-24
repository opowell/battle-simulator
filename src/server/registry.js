/**
 * registry.js — a JSON registry of games, loaded into what createBattleServer
 * takes.
 *
 * The registry is data, so the game editor (gameEditor.js) can rewrite it:
 *
 *   { "<name>": { "module": "./<name>/index.js", "export": "<Name>Game",
 *                 "minPlayers": 2, "maxPlayers": 4,
 *                 "defaultPlayers": [{ "id": "p1", "name": "Player 1" }, …],
 *                 "note": "why an entry is the way it is (optional)" }, … }
 *
 * `module` is relative to the registry file.
 */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/** Every entry of the registry at `file`, its game imported. */
export async function loadRegistry(file) {
  const entries = JSON.parse(await readFile(file, 'utf8'));
  const base = pathToFileURL(file);
  const games = {};
  for (const [name, e] of Object.entries(entries)) {
    const mod = await import(new URL(e.module, base).href);
    const game = mod[e.export];
    if (!game) throw new Error(`${file}: ${e.module} has no export ${e.export} (game ${name})`);
    games[name] = { game, minPlayers: e.minPlayers, maxPlayers: e.maxPlayers, defaultPlayers: e.defaultPlayers };
  }
  return games;
}
