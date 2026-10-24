/**
 * The Battle Simulator app: the core's server (src/server/battleServer.js) with
 * every game in games/registry.js.
 *
 * Run standalone with `node api-server.js [--port N]`, or let JAS mount it
 * (settings.json's "servers" names this file; the default export is its
 * embedded-mode contract).
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBattleServer, resolvePort } from './src/server/battleServer.js';
import { GAMES, REGISTRY_FILE } from './games/registry.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

const server = createBattleServer({
  games: GAMES,
  root: ROOT,
  gamesDir: resolve(ROOT, 'games'),
  registryFile: REGISTRY_FILE,
  // Overridable so a test run (see api-server.test.js) keeps its recordings out
  // of the real directory.
  sessionsDir: process.env.BATTLE_SIM_SESSIONS_DIR ?? resolve(ROOT, 'sessions'),
});

// Every registered game, as the server plays them.
export { GAMES };

export default server.mount;

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) server.listen(resolvePort(ROOT));
