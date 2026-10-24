#!/usr/bin/env node
// Lifts a game out of this repo into a repo of its own (phase 3 of
// plans/generic-core-and-game-repos.md), laid out like /Users/op/repos/fog-chess:
//
//   node scripts/extract-game.mjs <game> --to <dir> [--core <commit>] [--port N]
//
// The new repo keeps the game's history (git filter-repo over games/<game>/, its
// demos and benches, and its capability checklist), and on top of it one commit
// that makes it stand alone:
//
//   apps/<game>/games/<game>/   what games/<game>/ is here
//   apps/<game>/games/games.json, registry.js
//                               its registry: this one game
//   apps/<game>/demo/           its demos and benches
//   apps/<game>/server.js       createBattleServer on this game, as JAS mounts it
//   vendor/battle-simulator     submodule: the core, pinned to --core (this HEAD)
//   vendor/jas                  submodule: the server that runs apps/
//   node_modules/bignumber.js   the core's one npm dependency, committed
//   start.sh, start.cmd, .githooks/, scripts/test.mjs, test/server.test.js
//
// It does not touch this repo: deleting games/<game>/ here, and moving the game's
// foreignUnits into its pack.js there, are separate steps (see the plan).
//
// Submodules are cloned from the local copies where there are some (this repo's,
// and fog-chess's JAS), then pointed at their GitHub URLs, so nothing is fetched.
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const JAS_LOCAL = '/Users/op/repos/fog-chess/.git/modules/vendor/jas';
const JAS_COMMIT = '705d54d31e1f74062c5be1b8eb0bdcdf8a50f81d';
const CORE_URL = 'https://github.com/opowell/battle-simulator.git';
const JAS_URL = 'https://github.com/opowell/jas.git';

// Each game's port, so that any two can run side by side (fog-chess is 4510).
const PORTS = {
  xcom: 4521, aow: 4522, memoir44: 4523, doom: 4524, surviv: 4525, mudandblood: 4526,
  warofdots: 4527, combatmission: 4528, cs: 4529, risk: 4530, kdice: 4531, axisallies: 4532,
  ffta: 4533, sc1: 4534, sc2: 4535, civ1: 4536, civ2: 4537, chess: 4538, rogue: 4539, simcity: 4540,
};

// rogue and simcity were never in this repo's registry; in their own they are,
// seated as their tests seat them.
const UNREGISTERED = {
  rogue:   { module: './rogue/index.js', export: 'RogueGame', minPlayers: 1, maxPlayers: 1, defaultPlayers: [{ id: 'p1', name: 'Rogue' }] },
  simcity: { module: './simcity/index.js', export: 'SimCityGame', minPlayers: 1, maxPlayers: 1, defaultPlayers: [{ id: 'mayor', name: 'Mayor' }] },
};

function parseArgs(argv) {
  const o = { game: null, to: null, core: null, port: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--to') o.to = path.resolve(argv[++i]);
    else if (argv[i] === '--core') o.core = argv[++i];
    else if (argv[i] === '--port') o.port = Number(argv[++i]);
    else o.game = argv[i];
  }
  if (!o.game || !o.to) { console.error('usage: extract-game.mjs <game> --to <dir> [--core <commit>] [--port N]'); process.exit(1); }
  return o;
}

// git-filter-repo, where `pip3 install --user git-filter-repo` puts it on a Mac,
// if it isn't on the PATH already.
const env = { ...process.env, PATH: `${process.env.PATH}:${homedir()}/Library/Python/3.9/bin` };
const run = (cwd, cmd, ...args) => execFileSync(cmd, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const git = (cwd, ...args) => run(cwd, 'git', '-c', 'protocol.file.allow=always', ...args);
const write = (file, text, mode) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  if (mode) chmodSync(file, mode);
};

/**
 * Initialise `repo`'s submodules from the local clones under `modulesDir` (a
 * .git/modules folder) where they exist, recursively, then point them all back
 * at the URLs .gitmodules names.
 */
function initSubmodules(repo, modulesDir) {
  if (!existsSync(path.join(repo, '.gitmodules'))) return;
  const names = git(repo, 'config', '-f', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$')
    .split('\n').filter(Boolean).map(l => l.split(' ')[0].replace(/^submodule\.|\.path$/g, ''));
  git(repo, 'submodule', 'init');
  for (const name of names) {
    const local = path.join(modulesDir, 'modules', name);
    if (existsSync(local)) git(repo, 'config', `submodule.${name}.url`, local);
  }
  git(repo, 'submodule', 'update');
  for (const name of names) {
    const sub = path.join(repo, git(repo, 'config', '-f', '.gitmodules', `submodule.${name}.path`));
    initSubmodules(sub, path.join(modulesDir, 'modules', name));
  }
  git(repo, 'submodule', 'sync');
}

function main() {
  const { game, to, core, port: portArg } = parseArgs(process.argv);
  const registry = JSON.parse(readFileSync(path.join(ROOT, 'games', 'games.json'), 'utf8'));
  const entry = registry[game] ?? UNREGISTERED[game];
  if (!entry || !existsSync(path.join(ROOT, 'games', game))) { console.error(`no game ${game} in games/`); process.exit(1); }
  if (existsSync(to)) { console.error(`${to} already exists`); process.exit(1); }
  const port = portArg ?? PORTS[game] ?? 4590;
  const coreCommit = git(ROOT, 'rev-parse', core ?? 'HEAD');
  const coreGitDir = path.resolve(ROOT, git(ROOT, 'rev-parse', '--git-common-dir'));
  const coreRepo = path.dirname(coreGitDir);

  // 1. The game's history, alone, moved into place.
  console.log(`${game}: history from ${coreCommit.slice(0, 7)}`);
  git(path.dirname(to), 'clone', '--quiet', '--no-checkout', coreRepo, to);
  git(to, 'checkout', '--quiet', '-B', 'main', coreCommit);
  for (const ref of git(to, 'for-each-ref', '--format=%(refname)').split('\n')) {
    if (ref && ref !== 'refs/heads/main') git(to, 'update-ref', '-d', ref);
  }
  git(to, 'remote', 'remove', 'origin');
  const demos = readdirSync(path.join(ROOT, 'demo')).filter(f => f.startsWith(`${game}-`));
  run(to, 'git-filter-repo', '--force', '--quiet',
    '--path', `games/${game}/`,
    ...demos.flatMap(f => ['--path', `demo/${f}`]),
    '--path', `plans/migration/${game}.md`,
    '--path-rename', `games/${game}/:apps/${game}/games/${game}/`,
    '--path-rename', 'demo/:apps/' + game + '/demo/',
    '--path-rename', `plans/migration/${game}.md:plans/capabilities.md`);
  git(to, 'remote', 'add', 'origin', `https://github.com/opowell/battle-${game}.git`);

  // 2. The two submodules, from local clones, pointed at GitHub.
  const jasSource = existsSync(JAS_LOCAL) ? JAS_LOCAL : JAS_URL;
  git(to, 'submodule', 'add', '--quiet', jasSource, 'vendor/jas');
  git(path.join(to, 'vendor/jas'), 'checkout', '--quiet', JAS_COMMIT);
  git(to, 'submodule', 'add', '--quiet', coreRepo, 'vendor/battle-simulator');
  const coreDir = path.join(to, 'vendor/battle-simulator');
  git(coreDir, 'checkout', '--quiet', coreCommit);
  initSubmodules(coreDir, coreGitDir);
  git(to, 'config', '-f', '.gitmodules', 'submodule.vendor/jas.url', JAS_URL);
  git(to, 'config', '-f', '.gitmodules', 'submodule.vendor/battle-simulator.url', CORE_URL);
  for (const name of ['vendor/jas', 'vendor/battle-simulator']) git(to, 'config', '-f', '.gitmodules', `submodule.${name}.ignore`, 'untracked');
  git(to, 'submodule', 'sync', '--recursive');
  git(to, 'add', '.gitmodules', 'vendor/jas', 'vendor/battle-simulator');

  // 3. What makes it stand alone.
  const gameDir = path.join(to, 'apps', game, 'games', game);
  const title = gameTitle(gameDir, game);
  const files = scaffold({ game, title, port, entry, demos });
  for (const [rel, [text, mode]] of Object.entries(files)) write(path.join(to, rel), text, mode);
  cpSync(path.join(ROOT, 'node_modules', 'bignumber.js'), path.join(to, 'node_modules', 'bignumber.js'), { recursive: true });
  git(to, 'config', 'core.hooksPath', '.githooks');
  git(to, 'add', '-A');
  git(to, 'commit', '--quiet', '-m', `Stand alone: ${title} on the battle-simulator core

${title} left opowell/battle-simulator for a repo of its own (that repo's
plans/generic-core-and-game-repos.md, phase 3). Its history above is
games/${game}/ there, moved to apps/${game}/games/${game}/.

The core is vendor/battle-simulator, pinned to ${coreCommit.slice(0, 7)}; JAS runs apps/ on port ${port}.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`);
  console.log(`${game}: ${to} (port ${port})`);
}

/** The game's display name, from its README's first heading. */
function gameTitle(dir, game) {
  try {
    const h = readFileSync(path.join(dir, 'README.md'), 'utf8').match(/^#\s+(.+)$/m);
    if (h) return h[1].trim();
  } catch {}
  return game;
}

function scaffold({ game, title, port, entry, demos }) {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  // Its demo scripts, at their new paths.
  const scripts = Object.fromEntries(Object.entries(pkg.scripts)
    .filter(([, cmd]) => demos.some(d => cmd.includes(`demo/${d}`)))
    .map(([k, cmd]) => [k, cmd.replace(/demo\//g, `apps/${game}/demo/`)]));
  const json = (o) => JSON.stringify(o, null, 2) + '\n';
  const { note, ...registryEntry } = entry;
  const demoList = demos.length ? demos.map(d => `- \`apps/${game}/demo/${d}\``).join('\n') : '- none';
  return {
    'package.json': [json({
      name: `battle-${game}`,
      version: '0.1.0',
      description: `${title}, a standalone game on the battle-simulator core.`,
      author: 'opowell <opowell@gmail.com>',
      private: true,
      type: 'module',
      engines: { node: '>=22' },
      imports: {
        '#core/*': './vendor/battle-simulator/src/*',
        '#obscuro/*': './vendor/battle-simulator/vendor/obscuro/src/*',
        '#obscuro-chess/*': './vendor/battle-simulator/vendor/obscuro-chess/src/*',
        '#browser/*': './vendor/battle-simulator/apps/browser/*',
      },
      scripts: {
        start: 'sh start.sh',
        test: 'node scripts/test.mjs',
        golden: `node vendor/battle-simulator/scripts/golden.mjs ${game} --registry apps/${game}/games/games.json`,
        'export-pack': `node vendor/battle-simulator/scripts/export-pack.mjs apps/${game}/games/${game}`,
        ...scripts,
      },
      dependencies: { 'bignumber.js': pkg.dependencies['bignumber.js'] },
    })],
    [`apps/${game}/settings.json`]: [json({ clients: [], static: false, servers: './server.js' })],
    [`apps/${game}/games/games.json`]: [`{\n  ${JSON.stringify(game)}: ${JSON.stringify(registryEntry)}\n}\n`],
    [`apps/${game}/games/registry.js`]: [`// The games this app serves: games.json, every game in it imported. The game
// editor rewrites games.json, so a change here takes a server restart.
import { fileURLToPath } from 'node:url';
import { loadRegistry } from '#core/server/registry.js';

export const REGISTRY_FILE = fileURLToPath(new URL('./games.json', import.meta.url));
export const GAMES = await loadRegistry(REGISTRY_FILE);
`],
    [`apps/${game}/server.js`]: [`/**
 * The ${title} app: the battle core's server (vendor/battle-simulator) playing
 * the one game in games/games.json.
 *
 * JAS mounts it (settings.json's "servers" names this file; the default export is
 * its embedded-mode contract). Run it on its own with
 * \`node apps/${game}/server.js [--port N]\`.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBattleServer, resolvePort } from '#core/server/battleServer.js';
import { GAMES, REGISTRY_FILE } from './games/registry.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export const server = createBattleServer({
  games: GAMES,
  root: ROOT,
  gamesDir: fileURLToPath(new URL('./games', import.meta.url)),
  registryFile: REGISTRY_FILE,
  sessionsDir: process.env.BATTLE_SIM_SESSIONS_DIR ?? resolve(ROOT, 'sessions'),
});

export default server.mount;

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) server.listen(resolvePort(ROOT));
`],
    'scripts/test.mjs': [`#!/usr/bin/env node
// Every test in this repo: the game's own (apps/${game}/games/${game}/), and test/,
// which checks the app serves it. Slow checks run only with SLOW_TESTS=1.
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function testsIn(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') out.push(...testsIn(p)); }
    else if (name.endsWith('.test.js')) out.push(path.relative(ROOT, p));
  }
  return out;
}

const files = [...testsIn(path.join(ROOT, 'apps')), ...testsIn(path.join(ROOT, 'test'))];
const run = spawnSync(process.execPath, ['--test', ...files], { cwd: ROOT, stdio: 'inherit' });
process.exit(run.status ?? 1);
`],
    'test/server.test.js': [`// The app serves its game: the server starts on the vendored core, lists the
// game, and plays a session of it against the random AI.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sessions = mkdtempSync(join(tmpdir(), 'battle-${game}-sessions-'));
process.env.BATTLE_SIM_SESSIONS_DIR = sessions;
const { server } = await import('../apps/${game}/server.js');
const http = server.listen(0);
await new Promise(r => http.once('listening', r));
const base = \`http://127.0.0.1:\${http.address().port}\`;
after(() => { http.close(); http.closeAllConnections?.(); rmSync(sessions, { recursive: true, force: true }); });

test('the app lists ${game}', async () => {
  const games = await (await fetch(base + '/games')).json();
  const list = Array.isArray(games) ? games : games.games ?? Object.values(games);
  assert.ok(list.some(g => g.name === ${JSON.stringify(game)} || g.id === ${JSON.stringify(game)}), JSON.stringify(list).slice(0, 300));
});

test('the Browser is served', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<base href=/);
});
`],
    'start.sh': [`#!/bin/sh
# ${title} launcher for macOS and Linux: runs the bundled JAS server (vendor/jas)
# on this repo's apps/ folder, on its own port so it can sit beside an everyday
# JAS on 4500.
set -e

script=$0
while [ -L "$script" ]; do
  link=$(readlink "$script")
  case $link in
    /*) script=$link ;;
    *) script=$(dirname "$script")/$link ;;
  esac
done
DIR=$(cd "$(dirname "$script")" && pwd)

# An empty submodule directory is the usual way a fresh clone breaks: the
# server then dies on a module-not-found that says nothing about submodules.
if [ ! -f "$DIR/vendor/jas/jas.sh" ] || [ ! -f "$DIR/vendor/battle-simulator/vendor/obscuro/package.json" ]; then
  echo 'battle-${game}: submodules missing, running git submodule update --init --recursive'
  git -C "$DIR" submodule update --init --recursive
fi

export JAS_APPS="$DIR/apps"
export JAS_DEFAULT_APP=${game}
export PORT="\${PORT:-${port}}"
echo "${title}: http://localhost:$PORT"
exec sh "$DIR/vendor/jas/jas.sh" "$@"
`, 0o755],
    'start.cmd': [`@echo off
REM ${title} launcher for Windows: runs the bundled JAS server (vendor\\jas)
REM on this repo's apps\\ folder, on its own port so it can sit beside an
REM everyday JAS on 4500.
setlocal
set "DIR=%~dp0"
if "%DIR:~-1%"=="\\" set "DIR=%DIR:~0,-1%"

if not exist "%DIR%\\vendor\\jas\\jas.cmd" goto submodules
if not exist "%DIR%\\vendor\\battle-simulator\\vendor\\obscuro\\package.json" goto submodules
goto run

:submodules
echo battle-${game}: submodules missing, running git submodule update --init --recursive
git -C "%DIR%" submodule update --init --recursive || exit /b 1

:run
set "JAS_APPS=%DIR%\\apps"
set "JAS_DEFAULT_APP=${game}"
if not defined PORT set "PORT=${port}"
echo ${title}: http://localhost:%PORT%
call "%DIR%\\vendor\\jas\\jas.cmd" %*
`],
    '.githooks/post-merge': [`#!/bin/sh
# Populate any submodule the incoming commits added or moved.
#
# The two halves of this repo that aren't the game live in submodules: vendor/jas
# (the server) and vendor/battle-simulator (the core, which carries obscuro-ai and
# appfr inside it). A plain pull that bumps a pin leaves the old checkout in
# place, and a fresh one leaves an empty directory; either way the server fails
# with a module-not-found that looks nothing like its cause.
exec git submodule update --init --recursive
`, 0o755],
    '.githooks/post-checkout': [`#!/bin/sh
# See .githooks/post-merge for why this exists.
#
# $3 is 1 for a branch checkout and 0 for a file checkout (\`git checkout -- x\`).
# Only the former can introduce a submodule, so skip the rest rather than shell
# out on every single file restore.
[ "$3" = "1" ] || exit 0
exec git submodule update --init --recursive
`, 0o755],
    '.githooks/post-rewrite': [`#!/bin/sh
# See .githooks/post-merge for why this exists. This one covers \`git rebase\`.
exec git submodule update --init --recursive
`, 0o755],
    '.gitignore': [`.DS_Store
# Recordings of played sessions.
/sessions/
# The one dependency (bignumber.js, which the core imports) is committed, so a
# clone needs no install; anything else npm puts here is not.
/node_modules/*
!/node_modules/bignumber.js/
`],
    'README.md': [`# ${title}

${title}, playable in your browser against the battle simulator's AIs. It runs
on [battle-simulator](https://github.com/opowell/battle-simulator), the generic
battle core, which this repo vendors. The game itself, its rules, scenarios and
art, is in [apps/${game}/games/${game}/](apps/${game}/games/${game}/README.md).

## Play

You need [Node.js](https://nodejs.org) 22 or later and git.

\`\`\`sh
git clone --recurse-submodules https://github.com/opowell/battle-${game}.git
cd battle-${game}
git config core.hooksPath .githooks
./start.sh          # macOS, Linux
start.cmd           REM Windows
\`\`\`

Open http://localhost:${port}. Nothing needs installing: every dependency is
committed or vendored. Set \`PORT\` to use a different port. If you cloned
without \`--recurse-submodules\`, the launcher fetches the submodules itself the
first time it runs.

## Layout

| Path | What |
|---|---|
| \`apps/${game}/games/${game}/\` | the game: its \`GameDefinition\`, art, scenarios and tests |
| \`apps/${game}/games/games.json\` | the registry: this one game, how many seats, who sits where |
| \`apps/${game}/server.js\` | the core's server (\`createBattleServer\`) on this game; JAS mounts it |
| \`apps/${game}/demo/\` | demos and benches, run from the terminal |
| \`plans/capabilities.md\` | what the game could do when it left the core, checked after the move |
| \`vendor/battle-simulator\` | the core (engine, AIs, server, the Browser UI), a submodule |
| \`vendor/jas\` | the server that runs \`apps/\`, a submodule |

Demos:

${demoList}

## Test

\`\`\`sh
npm test
\`\`\`

runs the game's tests, its golden replays among them, and checks the app serves
it. \`SLOW_TESTS=1 npm test\` adds the rollouts.

## Working on it

- **Golden replays** (\`golden.json\`) pin down exactly what the game does. A
  change that is meant to alter play re-records them with \`npm run golden\`.
- **The core** is changed upstream, in battle-simulator, never under \`vendor/\`.
  Then bump the pin here: \`git submodule update --remote vendor/battle-simulator\`,
  run the tests, commit.
- **The library**: battle-simulator keeps this game's units, terrain and maps as
  data, so its own battles can field them. \`apps/${game}/games/${game}/pack.js\`
  says how the units read there; after changing it, re-export with
  \`npm run export-pack -- --out <battle-simulator>/library\` and commit the pack
  in battle-simulator.
`],
    'CLAUDE.md': [`# Project conventions

${title} as a standalone game on the battle-simulator core (see README.md).

- Don't edit files under \`vendor/\`. A change to the core (engine, AIs, server,
  the Browser UI) belongs upstream in opowell/battle-simulator, with its tests;
  then bump \`vendor/battle-simulator\` here. The core carries obscuro-ai and appfr
  inside it; never vendor those separately here.
- The game imports the core as \`#core/*\` (and the play UI as \`#browser/*\`),
  mapped in package.json, never by a relative path into \`vendor/\`.
- Keep \`npm test\` green. The golden replays fail on any change to what the game
  does; re-record them (\`npm run golden\`) only for a rules change you meant.
- After a fresh clone: \`git config core.hooksPath .githooks\`, so submodules
  follow every checkout, merge and rebase.
`],
  };
}

main();
