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
import { registerMaps } from '../battle/library.js';

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** Every pack in `dir`, by game: its units.json and pack.json, and its terrain.json and maps/ where it has them. */
export function readLibrary(dir) {
  const packs = {};
  if (!existsSync(dir)) return packs;
  for (const name of readdirSync(dir).sort()) {
    const units = join(dir, name, 'units.json');
    if (!existsSync(units)) continue;
    const mapsDir = join(dir, name, 'maps');
    packs[name] = {
      units: readJson(units),
      pack: existsSync(join(dir, name, 'pack.json')) ? readJson(join(dir, name, 'pack.json')) : null,
      terrain: existsSync(join(dir, name, 'terrain.json')) ? readJson(join(dir, name, 'terrain.json')) : null,
      maps: existsSync(mapsDir)
        ? Object.fromEntries(readdirSync(mapsDir).filter(f => f.endsWith('.json')).sort().map(f => [f.slice(0, -5), readJson(join(mapsDir, f))]))
        : {},
    };
  }
  return packs;
}

/** Make every pack in `dir` a source of units, and its maps battles, for the core's rulesets. */
export function loadLibrary(dir) {
  const packs = readLibrary(dir);
  registerSources(Object.fromEntries(Object.entries(packs).map(([name, p]) => [name, sourceFromPack(p.units)])));
  registerMaps(Object.fromEntries(Object.entries(packs).map(([name, p]) => [name, { title: p.units.title ?? name, scale: p.units.scale, terrain: p.terrain ?? {}, maps: p.maps }])));
  return packs;
}
