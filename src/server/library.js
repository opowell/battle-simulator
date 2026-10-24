/**
 * library.js — the units of every game, kept here as data: library/<game>/,
 * written by scripts/export-pack.mjs (see plans/generic-core-and-game-repos.md,
 * "The library"). Only the core's own rulesets field them (foreignUnits.js).
 *
 * Server-side only: the engine itself stays free of node:fs, since the browser's
 * analysis worker imports it too.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerSources, sourceFromPack } from '../engine/foreignUnits.js';

/** Every pack in `dir`, by game: its units.json and pack.json. */
export function readLibrary(dir) {
  const packs = {};
  if (!existsSync(dir)) return packs;
  for (const name of readdirSync(dir).sort()) {
    const units = join(dir, name, 'units.json');
    if (!existsSync(units)) continue;
    packs[name] = {
      units: JSON.parse(readFileSync(units, 'utf8')),
      pack: existsSync(join(dir, name, 'pack.json')) ? JSON.parse(readFileSync(join(dir, name, 'pack.json'), 'utf8')) : null,
    };
  }
  return packs;
}

/** Make every pack in `dir` a source of units for the core's rulesets. */
export function loadLibrary(dir) {
  const packs = readLibrary(dir);
  registerSources(Object.fromEntries(Object.entries(packs).map(([name, p]) => [name, sourceFromPack(p.units)])));
  return packs;
}
