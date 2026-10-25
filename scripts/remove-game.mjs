#!/usr/bin/env node
// This repo's half of a game leaving for a repo of its own (phase 3, step 6 of
// plans/generic-core-and-game-repos.md), once scripts/extract-game.mjs has made
// that repo and its checks pass there:
//
//   node scripts/remove-game.mjs <game> --repo <owner/name>
//
// Removes games/<game>/, its demos and benches, its registry entry and its npm
// scripts; moves its row in README.md's games table to the table of games built
// on the core; and records the repo in plans/migration/, where it has a
// checklist there. Its pack stays in
// library/. Then it lists every other mention of the game, for a person to read:
// most are comments, which may stay.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRegistry, removeRegistryEntry } from '../src/server/gameEditor.js';

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

// The registry, as the game editor writes it.
edit('games/games.json', (s) => (parseRegistry(s)[game] ? removeRegistryEntry(s, game) : s));

edit('package.json', (s) => {
  const pkg = JSON.parse(s);
  pkg.scripts = Object.fromEntries(Object.entries(pkg.scripts).filter(([, cmd]) => !demos.some(d => cmd.includes(d))));
  return JSON.stringify(pkg, null, 2) + '\n';
});

// README: out of the sandbox's table, into the table of games built on the core.
edit('README.md', (s) => {
  const row = `| \`${game}\` | ${title} | [${repo}](${url}) |`;
  s = s.replace(new RegExp(`^\\| \`${game}\` \\|.*\\n`, 'm'), '');
  s = s.replace(/(## Games built on the core[\s\S]*?\|---\|---\|---\|\n(?:\|.*\|\n)*)/, `$1${row}\n`);
  return s.replace(new RegExp(`(All demos are in \`demo/\`: .*?)(\`${game}\`, |, \`${game}\`(?=\\.))`), '$1');
});

if (existsSync(path.join(ROOT, 'plans/migration/README.md'))) {
  edit('plans/migration/README.md', (s) => s.replace(
    new RegExp(`^(\\| \\[${game}\\]\\(${game}\\.md\\) \\| )[^|]*\\|`, 'm'), `$1[${repo}](${url}) |`));
}

let left = [];
try {
  left = git('grep', '-n', '-w', game, '--', '.', ':!library', ':!plans', ':!sessions', ':!scripts/export').split('\n').filter(Boolean);
} catch { /* no mention left: git grep exits 1 */ }
console.log(`${game}: removed games/${game}/${demos.length ? ', ' + demos.join(', ') : ''}; ${left.length} mention(s) left:`);
for (const l of left) console.log('  ' + l.slice(0, 160));
