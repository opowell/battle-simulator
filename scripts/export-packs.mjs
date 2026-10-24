#!/usr/bin/env node
// Re-exports the pack of every game still in this repo that lends its units
// (scripts/export-pack.mjs, one game at a time). Arena is the core's own
// ruleset and has none.
//
//   node scripts/export-packs.mjs [--out <library-dir>]
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const gamesDir = path.join(ROOT, 'games');
for (const name of readdirSync(gamesDir).sort()) {
  const dir = path.join(gamesDir, name);
  if (!statSync(dir).isDirectory() || name === 'arena') continue;
  const mod = await import(pathToFileURL(path.join(dir, 'index.js')).href).catch(() => ({}));
  const game = Object.values(mod).find(v => v && typeof v === 'object' && typeof v.createInitialState === 'function');
  if (typeof game?.foreignUnits?.profiles !== 'function') { console.log(`${name}: lends no units — skipped`); continue; }
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'export-pack.mjs'), dir, ...process.argv.slice(2)], { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
}
