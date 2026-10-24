#!/usr/bin/env node
// The tests, by owner: the core's (src/, apps/ and this app's own *.test.js at
// the root) and each game's, which are its folder's alone.
//
//   node scripts/test.mjs              everything (npm test)
//   node scripts/test.mjs core         the core's
//   node scripts/test.mjs civ1 cs      those games' (npm test -- civ1 cs)
//
// Slow checks (rollouts of the generic Obscuro agent, minutes per game) run only
// with SLOW_TESTS=1.
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SKIP_DIRS = new Set(['node_modules', 'vendor', 'sessions']);

function testsIn(dir, deep = true) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) { if (deep && !SKIP_DIRS.has(name)) out.push(...testsIn(p)); }
    else if (name.endsWith('.test.js')) out.push(path.relative(ROOT, p));
  }
  return out;
}

const gamesDir = path.join(ROOT, 'games');
const games = readdirSync(gamesDir).filter(n => statSync(path.join(gamesDir, n)).isDirectory()).sort();
const core = () => [...testsIn(path.join(ROOT, 'src')), ...testsIn(path.join(ROOT, 'apps')), ...testsIn(ROOT, false)];

const asked = process.argv.slice(2);
const unknown = asked.filter(a => a !== 'core' && !games.includes(a));
if (unknown.length) {
  console.error(`no such game: ${unknown.join(', ')} (games: ${games.join(', ')})`);
  process.exit(2);
}
const files = asked.length
  ? asked.flatMap(a => (a === 'core' ? core() : testsIn(path.join(gamesDir, a))))
  : [...core(), ...games.flatMap(g => testsIn(path.join(gamesDir, g)))];

const run = spawnSync(process.execPath, ['--test', ...files], { cwd: ROOT, stdio: 'inherit' });
process.exit(run.status ?? 1);
