// library.test.js — every pack in library/ (scripts/export-pack.mjs) is whole, and
// every unit in it can be fielded by the core's own ruleset: Arena takes it in,
// draws it as itself, and plays a few turns with it.
//
// Terrain types and maps join the packs with the core's board format (phase 2 of
// plans/generic-core-and-game-repos.md); until then pack.json says they are left out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readLibrary, loadLibrary } from './server/library.js';
import { STATS, foreignCatalog, dressGrid, originOf } from './engine/foreignUnits.js';
import { setupPreview, rosterFromState, cellMapper } from './engine/startingSetup.js';
import { GameEngine } from './engine/GameEngine.js';
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
