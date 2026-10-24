// library.test.js — every pack in library/ (scripts/export-pack.mjs) is whole, and
// every unit in it can be fielded by the core's own ruleset: Arena takes it in,
// draws it as itself, and plays a few turns with it.
//
// A pack may also carry its game's terrain types and maps in the core's board
// format (scripts/export/<game>.mjs): every map must load as a battle, field its
// own game's units, and play in every mode; every unit must be able to stand on
// every kind of map; and the mixed scenarios put several games' units on them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readLibrary, loadLibrary } from './server/library.js';
import { STATS, foreignCatalog, dressGrid, originOf } from './engine/foreignUnits.js';
import { setupPreview, rosterFromState, cellMapper } from './engine/startingSetup.js';
import { GameEngine } from './engine/GameEngine.js';
import { RandomAgent } from './agents/RandomAgent.js';
import { librarySpec } from './battle/library.js';
import { resolveSpec, checkSpec } from './battle/spec.js';
import { ArenaGame } from '../games/arena/index.js';

const LIBRARY = fileURLToPath(new URL('../library', import.meta.url));
const packs = readLibrary(LIBRARY);
loadLibrary(LIBRARY);

test('the library has a pack for every game that lends its units', () => {
  assert.ok(Object.keys(packs).length >= 18, `only ${Object.keys(packs).join(', ')}`);
});

for (const [name, { units: pack, pack: meta }] of Object.entries(packs)) {
  test(`${name}: its pack is whole — a conversion factor, every unit in five stats, its pictures`, () => {
    assert.equal(pack.game, name);
    for (const k of STATS) assert.ok(pack.scale?.[k] > 0, `${name}: no conversion factor for ${k}`);
    const types = Object.entries(pack.units ?? {});
    assert.ok(types.length, `${name}: no units`);
    for (const [type, u] of types) {
      for (const k of STATS) assert.ok(Number.isFinite(u[k]) && u[k] >= 0, `${name} ${type}: ${k} is ${u[k]}`);
      assert.ok(['land', 'sea', 'air'].includes(u.domain), `${name} ${type}: domain ${u.domain}`);
      assert.ok(Array.isArray(u.art) && u.art.length, `${name} ${type}: no art`);
      for (const a of u.art) {
        if (a.imagePath == null) continue;
        assert.match(a.imagePath, new RegExp(`^/library/${name}/art/`), `${name} ${type}: picture outside its pack`);
        assert.ok(existsSync(join(LIBRARY, a.imagePath.slice('/library/'.length))), `${name} ${type}: ${a.imagePath} is missing`);
      }
    }
    assert.equal(meta?.game, name);
    assert.equal(meta.units, types.length);
    assert.ok(meta.from?.commit, `${name}: no commit it was exported from`);
    assert.ok(Array.isArray(meta.omitted), `${name}: pack.json does not say what it leaves out`);
  });
}

const players = [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];

/** A seeded rng, so a failure here fails the same way every run. */
function rngFrom(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

/** Random play that orders the foreign unit about whenever it can. */
function keenOn(unitId, rng) {
  return {
    id: 'keen',
    chooseAction(_state, legal) {
      const its = legal.filter(a => a.unitId === unitId);
      const pool = its.length && rng() < 0.7 ? its : legal;
      return pool[Math.floor(rng() * pool.length)];
    },
  };
}

test('Arena offers every unit in the library', () => {
  const base = ArenaGame.createInitialState(players, {});
  const offered = new Map(foreignCatalog(ArenaGame, base).map(g => [g.game, new Set(g.units.map(u => u.type))]));
  for (const [name, { units: pack }] of Object.entries(packs)) {
    for (const type of Object.keys(pack.units)) assert.ok(offered.get(name)?.has(type), `Arena has no chassis for ${name}'s ${type}`);
  }
});

for (const [index, [name, { units: pack }]] of Object.entries(packs).entries()) {
  test(`${name}: every unit is built in Arena, drawn as itself, and plays`, async () => {
    const preview = setupPreview(ArenaGame, players, {});
    const own = rosterFromState(ArenaGame.createInitialState(players, preview.config));
    const free = (preview.board?.cells ?? []).filter(c => c.pos != null && !own.some(u => JSON.stringify(u.position) === JSON.stringify(c.pos)));
    for (const [n, type] of Object.keys(pack.units).entries()) {
      const label = `${name} ${type} in Arena`;
      const ownerId = players[n % 2].id;
      const position = free[n % free.length]?.pos ?? own[0].position;
      const rng = rngFrom(index * 1000 + n);
      let engine;
      try {
        engine = new GameEngine(ArenaGame, players.map(p => ({ ...p, agent: null })), {
          ...preview.config, startingUnits: [...own, { ownerId, type, game: name, position }], rng, maxTurns: 3, stepLimit: 12,
        });
        engine._init();
      } catch (e) { assert.fail(`${label}: not built — ${e.stack}`); }
      const unit = engine.state.units.find(u => originOf(u)?.game === name);
      assert.ok(unit, `${label}: not on the board`);

      const grid = dressGrid(ArenaGame, engine.state, ArenaGame.toGrid(engine.state), cellMapper(ArenaGame, engine.state, ArenaGame.toGrid(engine.state)).toCell);
      const drawn = [...(grid.cells ?? []), ...(grid.units ?? [])].some(c => c?.origin?.game === name && c.origin.type === type);
      assert.ok(drawn, `${label}: not drawn as itself`);

      for (const p of engine.players) p.agent = keenOn(unit.id, rng);
      try {
        for (let i = 0; i < 12; i++) if ((await engine.step()).done) break;
      } catch (e) { assert.fail(`${label}: play crashed — ${e.stack}`); }
    }
  });
}

// ── Terrain and maps ────────────────────────────────────────────────────────

const maps = Object.entries(packs).flatMap(([name, p]) => Object.keys(p.maps).map(id => [name, id, p]));

test('the library has a square, a hex, a regions and a shape map', () => {
  const kinds = new Set(maps.map(([, id, p]) => p.maps[id].board.topology));
  for (const k of ['square', 'hex', 'regions', 'shapes']) assert.ok(kinds.has(k), `no ${k} map`);
});

for (const [name, id, p] of maps) {
  test(`${name}/${id}: a whole map — its terrain known, its units its game's, and it plays in every mode`, async () => {
    const m = p.maps[id];
    assert.ok(p.terrain, `${name}: maps but no terrain.json`);
    assert.equal(p.pack.maps, Object.keys(p.maps).length);
    const spec = resolveSpec(librarySpec(`${name}/${id}`));
    assert.deepEqual(checkSpec(spec), [], `${name}/${id}`);
    for (const u of m.units ?? []) assert.ok(p.units.units[u.type], `${name}/${id}: no ${u.type} in ${name}'s pack`);
    for (const space of ['discrete', 'continuous']) for (const time of ['discrete', 'continuous']) {
      const engine = new GameEngine(ArenaGame, players.map(pl => ({ ...pl, agent: RandomAgent })), { spec: `library:${name}/${id}`, space, time, maxTurns: 3, stepLimit: 60 });
      await engine.run();
      assert.ok(engine.state.units.every(u => !u.alive || originOf(u)?.game === name), 'its own game\'s units');
      for (const pl of players) ArenaGame.toGrid(ArenaGame.getVisibleState(engine.state, pl.id));
    }
  });
}

test('every unit of every game can stand and fight on each kind of map', async () => {
  const onMap = { square: 'civ1/two-rivers', hex: 'memoir44/encounter', regions: 'risk/world', shapes: 'cs/de_dust2' };
  for (const [kind, key] of Object.entries(onMap)) {
    const lib = librarySpec(key);
    const starts = lib.units;
    for (const [name, { units: pack }] of Object.entries(packs)) {
      // The map's own opening, with every unit of `name` standing in for the first side's.
      const own = starts.filter(u => u.seat === 0);
      const units = [
        ...Object.keys(pack.units).map((type, i) => ({ game: name, type, seat: 0, at: own[i % own.length].at })),
        ...starts.filter(u => u.seat === 1),
      ];
      let s;
      try { s = ArenaGame.createInitialState(players, { spec: { map: key, units, board: { ...lib.board, stacking: 'stack' } } }); } catch (e) { assert.fail(`${name} on ${kind}: ${e.message}`); }
      assert.equal(s.units.filter(u => originOf(u)?.game === name && u.ownerId === 'p1').length, Object.keys(pack.units).length);
      assert.ok(Array.isArray(ArenaGame.getLegalActions(s, 'p1')));
    }
  }
});

test('the mixed scenarios are offered with the library, and play', async () => {
  const mixed = ArenaGame.scenarios.filter(s => s.group === 'Mixed');
  assert.equal(mixed.length, 4);
  const kinds = new Set();
  for (const sc of mixed) {
    const engine = new GameEngine(ArenaGame, players.map(pl => ({ ...pl, agent: RandomAgent })), { ...sc.config, maxTurns: 4 });
    await engine.run();
    kinds.add(engine.state.board.topology ?? 'square');
    const games = new Set(engine.state.units.map(u => originOf(u)?.game));
    assert.ok(games.size >= 2, `${sc.id}: units of one game only`);
  }
  assert.deepEqual([...kinds].sort(), ['hex', 'regions', 'shapes', 'square']);
  assert.ok(ArenaGame.scenarios.filter(s => s.id.startsWith('library:')).length === maps.length, 'every library map is a scenario');
});
