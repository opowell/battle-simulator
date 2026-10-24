#!/usr/bin/env node
// Writes a game's pack into the core's library: library/<game>/ holds what the
// core's own ruleset needs to field that game's units after the game itself has
// left this repo (see plans/generic-core-and-game-repos.md, "The library").
//
//   node scripts/export-pack.mjs <game-dir> [--out <library-dir>]
//
// <game-dir> is the game's folder (games/civ1 here, apps/civ1/game in its own
// repo): its index.js must export the game definition, whose foreignUnits says
// how its units read in the common vocabulary (src/engine/foreignUnits.js).
//
//   units.json  the conversion factor (scale), the general adjustment factor, and
//               every unit type in the common vocabulary, with how it looks for
//               each seat — its picture copied into art/
//   art/        those pictures, one copy each
//   terrain.json, maps/<id>.json
//               its terrain types and maps in the core's board format
//               (src/battle/spec.js, board.js), each map with the units it opens
//               with — written by the game's own mapping, scripts/export/<game>.mjs,
//               where it has one yet
//   pack.json   which commit of the game it came from, and what it leaves out
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gameImageFiles } from '../src/server/gameImages.js';
import { STATS, profilesOf } from '../src/engine/foreignUnits.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function parseArgs(argv) {
  const o = { dir: null, out: path.join(ROOT, 'library') };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--out') o.out = path.resolve(argv[++i]);
    else o.dir = path.resolve(argv[i]);
  }
  if (!o.dir) { console.error('usage: export-pack.mjs <game-dir> [--out <library-dir>]'); process.exit(1); }
  return o;
}

/** The game definition a game folder's index.js exports. */
async function gameIn(dir) {
  const mod = await import(pathToFileURL(path.join(dir, 'index.js')).href);
  const game = Object.values(mod).find(v => v && typeof v === 'object' && typeof v.createInitialState === 'function');
  if (!game) throw new Error(`${dir}/index.js exports no game definition`);
  return game;
}

/** The commit the game folder was last changed in, and whether the tree differs from it. */
function provenance(dir) {
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  try {
    const [commit, date] = git('log', '-1', '--format=%H %cI', '--', '.').split(' ');
    const dirty = git('status', '--porcelain', '--', '.') !== '';
    return { commit, date, ...(dirty ? { dirty: true } : {}) };
  } catch { return { commit: null }; }
}

// The art each seat sees, as short as it repeats: chess's pieces come in two
// colours, every other game's units look the same for everyone.
const SEATS = 8;
function period(list) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (let p = 1; p < list.length; p++) if (list.every((x, i) => same(x, list[i % p]))) return list.slice(0, p);
  return list;
}

async function main() {
  const { dir, out } = parseArgs(process.argv);
  const name = path.basename(dir);
  const game = await gameIn(dir);
  const fu = game.foreignUnits;
  if (typeof fu?.profiles !== 'function' || !fu.scale) {
    console.error(`${name}: no foreignUnits profiles and scale — nothing to export`);
    process.exit(1);
  }
  const packDir = path.join(out, name);
  rmSync(packDir, { recursive: true, force: true });
  mkdirSync(path.join(packDir, 'art'), { recursive: true });

  const copied = new Map();   // source image path → library path
  const missing = [];
  async function artPath(imagePath) {
    if (!imagePath) return null;
    if (copied.has(imagePath)) return copied.get(imagePath);
    const m = imagePath.match(/^\/images\/([^/]+)\/([^/]+)(?:\/([^/]+))?$/);
    let lib = null;
    if (m && m[1] === name) {
      const [file] = await gameImageFiles(dir, m[2], m[3]);
      if (file) {
        const into = m[3] ? path.join('art', m[2], m[3] + path.extname(file)) : path.join('art', m[2] + path.extname(file));
        mkdirSync(path.dirname(path.join(packDir, into)), { recursive: true });
        copyFileSync(file, path.join(packDir, into));
        lib = `/library/${name}/${into.split(path.sep).join('/')}`;
      }
    }
    if (!lib) missing.push(imagePath);
    copied.set(imagePath, lib);
    return lib;
  }

  const units = {};
  // profilesOf, not profiles(): a stat the game's rules fold into another one reads
  // as the standard, which is what it is worth anywhere else.
  for (const [type, p] of Object.entries(profilesOf(game))) {
    const stats = Object.fromEntries(STATS.filter(k => typeof p[k] === 'number').map(k => [k, p[k]]));
    const art = [];
    for (let seat = 0; seat < SEATS; seat++) {
      const a = fu.art?.(type, seat) ?? {};
      art.push({ imagePath: await artPath(a.imagePath), glyph: a.glyph ?? String(type)[0].toUpperCase(), name: a.name ?? type });
    }
    units[type] = { ...stats, domain: p.domain ?? 'land', art: period(art) };
  }

  const pack = {
    game: name,
    title: game.name ?? name,
    scale: fu.scale,
    ...(fu.factor != null && fu.factor !== 1 ? { factor: fu.factor } : {}),
    units,
  };
  writeFileSync(path.join(packDir, 'units.json'), JSON.stringify(pack, null, 2) + '\n');

  // Its terrain and maps, through the game's mapping into the core's board format.
  const mapping = path.join(ROOT, 'scripts', 'export', `${name}.mjs`);
  let boards = null;
  if (existsSync(mapping)) {
    boards = await (await import(pathToFileURL(mapping).href)).default(dir);
    writeFileSync(path.join(packDir, 'terrain.json'), JSON.stringify(boards.terrain, null, 2) + '\n');
    mkdirSync(path.join(packDir, 'maps'), { recursive: true });
    for (const [id, m] of Object.entries(boards.maps)) writeFileSync(path.join(packDir, 'maps', `${id}.json`), JSON.stringify(m) + '\n');
  }
  writeFileSync(path.join(packDir, 'pack.json'), JSON.stringify({
    game: name,
    from: provenance(dir),
    units: Object.keys(units).length,
    art: [...copied.values()].filter(Boolean).length,
    ...(boards ? { terrain: Object.keys(boards.terrain).length, maps: Object.keys(boards.maps).length } : {}),
    // What the core can't carry of this game, and what is not exported yet.
    omitted: [
      ...(missing.length ? [`pictures not found: ${missing.join(', ')}`] : []),
      ...(boards ? boards.omitted ?? [] : ['terrain types and maps: no mapping into the core\'s board format yet (scripts/export/<game>.mjs)']),
    ],
  }, null, 2) + '\n');
  console.log(`${name}: ${Object.keys(units).length} units, ${[...copied.values()].filter(Boolean).length} pictures${boards ? `, ${Object.keys(boards.terrain).length} terrain types, ${Object.keys(boards.maps).length} maps` : ''} → ${path.relative(process.cwd(), packDir)}`);
  if (missing.length) console.log(`  not found: ${missing.join(', ')}`);
}

await main();
