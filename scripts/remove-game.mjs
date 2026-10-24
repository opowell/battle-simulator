#!/usr/bin/env node
// This repo's half of a game leaving for a repo of its own (phase 3, step 6 of
// plans/generic-core-and-game-repos.md), once scripts/extract-game.mjs has made
// that repo and its checks pass there:
//
//   node scripts/remove-game.mjs <game> --repo <owner/name>
//
// Removes games/<game>/, its demos and benches, its registry entry and its npm
// scripts; moves its row in README.md's games table to the table of games in
// repos of their own; and records the repo in plans/migration/. Its pack stays in
// library/. Then it lists every other mention of the game, for a person to read:
// most are comments, which may stay.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const repoAt = args.indexOf('--repo');
const repo = repoAt >= 0 ? args.splice(repoAt, 2)[1] : null;
const [game] = args;
if (!game || !repo) { console.error('usage: remove-game.mjs <game> --repo <owner/name>'); process.exit(1); }
if (!existsSync(path.join(ROOT, 'games', game))) { console.error(`no games/${game}/`); process.exit(1); }
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
const edit = (rel, fn) => {
  const file = path.join(ROOT, rel);
  const before = readFileSync(file, 'utf8');
  const after = fn(before);
  if (after !== before) writeFileSync(file, after);
};
const url = `https://github.com/${repo}`;

// Its title, from its README, before the folder goes.
const readme = path.join(ROOT, 'games', game, 'README.md');
const title = existsSync(readme) ? readFileSync(readme, 'utf8').match(/^#\s+(.+)$/m)?.[1].trim() ?? game : game;

// Its demos and benches: named after it, or not (as extract-game.mjs's MORE_DEMOS).
const MORE_DEMOS = { chess: ['obscuro-demo.js'] };
const demos = readdirSync(path.join(ROOT, 'demo'))
  .filter(f => f.startsWith(`${game}-`) || MORE_DEMOS[game]?.includes(f)).map(f => `demo/${f}`);
git('rm', '-r', '-q', `games/${game}`, ...demos);

// The registry: one line per game.
edit('games/games.json', (s) => {
  const lines = s.split('\n').filter(l => !l.startsWith(`  ${JSON.stringify(game)}:`));
  const last = lines.findLastIndex(l => l.startsWith('  "'));
  lines[last] = lines[last].replace(/,\s*$/, '');
  return lines.join('\n');
});

edit('package.json', (s) => {
  const pkg = JSON.parse(s);
  pkg.scripts = Object.fromEntries(Object.entries(pkg.scripts).filter(([, cmd]) => !demos.some(d => cmd.includes(d))));
  return JSON.stringify(pkg, null, 2) + '\n';
});

// README: out of the games table, into the table of games in their own repos.
edit('README.md', (s) => {
  const row = `| \`${game}\` | ${title} | [${repo}](${url}) |`;
  s = s.replace(new RegExp(`^\\| \`${game}\` \\|.*\\n`, 'm'), '');
  if (!s.includes('## Games in repos of their own')) {
    s = s.replace(/\n## Quick start/, `
## Games in repos of their own

Each plays on this core, vendored as \`vendor/battle-simulator\`, and keeps its
units, terrain and maps in [the library](#library) here.

| Key | Game | Repo |
|---|---|---|
${row}

## Quick start`);
  } else {
    s = s.replace(/(## Games in repos of their own[\s\S]*?\|---\|---\|---\|\n(?:\|.*\|\n)*)/, `$1${row}\n`);
  }
  return s.replace(new RegExp(`(All demos are in \`demo/\`: .*?)\`${game}\`, `), '$1');
});

edit('plans/migration/README.md', (s) => s.replace(
  new RegExp(`^(\\| \\[${game}\\]\\(${game}\\.md\\) \\| )[^|]*\\|`, 'm'), `$1[${repo}](${url}) |`));

let left = [];
try {
  left = git('grep', '-n', '-w', game, '--', '.', ':!library', ':!plans', ':!sessions', ':!scripts/export').split('\n').filter(Boolean);
} catch { /* no mention left: git grep exits 1 */ }
console.log(`${game}: removed games/${game}/${demos.length ? ', ' + demos.join(', ') : ''}; ${left.length} mention(s) left:`);
for (const l of left) console.log('  ' + l.slice(0, 160));
