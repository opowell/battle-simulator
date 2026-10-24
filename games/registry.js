// The games this repo serves: games.json, every game in it imported. The game
// editor rewrites games.json, so a change here takes a server restart.
import { fileURLToPath } from 'node:url';
import { loadRegistry } from '#core/server/registry.js';

export const REGISTRY_FILE = fileURLToPath(new URL('./games.json', import.meta.url));
export const GAMES = await loadRegistry(REGISTRY_FILE);
