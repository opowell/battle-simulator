// The tech tree as a *system*: that every advance reaches something, that nothing can
// be built without the advance that gates it, and that the advances whose effect is a
// rule rather than a buildable (Philosophy, Bridge Building, Railroad, Future Tech)
// actually fire.
//
// economy.test.js already covers the prerequisite graph itself (roots, isResearchable,
// rising cost) — this file is about the tree having consequences.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Civ1Game } from './index.js';
import { ALL_TECH_IDS, PURE_PREREQ, TECHS, techCost } from './tech.js';
import { UNITS } from './units.js';
import { IMPROVEMENTS, WONDERS, SPACESHIP } from './improvements.js';
import { GOVERNMENTS } from './governments.js';
import { buildOwnerCtx, buildableForCity, canProduce, newCivState, processOwnerEconomy } from './economy.js';
import { workedTileYield } from './city.js';

// ── Fixtures ────────────────────────────────────────────────────────────────────

function miniState({ techs = [], techs2 = [], government = 'despotism', production = 'militia', tiles: tilePatch = {}, units = [], cities = null } = {}) {
  const width = 10, height = 10;
  const tiles = {};
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) tiles[`${x},${y}`] = { terrain: 'grassland' };
  for (const [k, v] of Object.entries(tilePatch)) tiles[k] = { ...tiles[k], ...v };
  return {
    gameName: 'Civ1', turnNumber: 1, activePlayers: ['p1'],
    players: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }],
    board: { width, height, tiles },
    units,
    cities: cities ?? [{
      id: 'c1', name: 'Rome', ownerId: 'p1', position: { x: 5, y: 5 },
      size: 1, food: 0, shields: 0, production, buildings: ['palace'],
    }],
    lastActions: null,
    gameSpecific: {
      nextId: 0, fogOfWar: false,
      civ: { p1: { ...newCivState(), government, techs }, p2: { ...newCivState(), techs: techs2 } },
    },
  };
}

const unit = (id, type, x, y, ownerId = 'p1') => ({
  id, ownerId, type, position: { x, y }, alive: true,
  hp: UNITS[type].hp, maxHp: UNITS[type].hp, movesLeft: UNITS[type].moves, attrs: {}, queue: [],
});

// ── Every advance reaches something ─────────────────────────────────────────────

test('tech: every advance either unlocks something or is a declared pure prerequisite', () => {
  // What each advance gates, gathered from the things that carry a `tech` field.
  const unlocks = new Map(ALL_TECH_IDS.map(id => [id, []]));
  const note = (tech, what) => { if (tech) unlocks.get(tech)?.push(what); };
  for (const [k, v] of Object.entries(UNITS)) note(v.tech, `unit:${k}`);
  for (const [k, v] of Object.entries(IMPROVEMENTS)) note(v.tech, `improvement:${k}`);
  for (const [k, v] of Object.entries(WONDERS)) note(v.tech, `wonder:${k}`);
  for (const [k, v] of Object.entries(SPACESHIP)) note(v.tech, `spaceship:${k}`);
  for (const [k, v] of Object.entries(GOVERNMENTS)) note(v.tech, `government:${k}`);
  // The four whose effect is an engine rule rather than a buildable. Each has its own
  // test below; listing them here is what keeps this assertion honest.
  for (const t of ['philosophy', 'bridge-building', 'railroad', 'future-tech']) note(t, 'rule');

  const dead = ALL_TECH_IDS.filter(id => !PURE_PREREQ.has(id) && unlocks.get(id).length === 0);
  assert.deepEqual(dead, [], `advances that unlock nothing and are not declared pure prerequisites: ${dead.join(', ')}`);
});

test('tech: every declared pure prerequisite really is one — it leads somewhere', () => {
  // A connector that nothing depends on would be dead weight, not a connector.
  for (const id of PURE_PREREQ) {
    assert.ok(TECHS[id], `${id} is not an advance`);
    const dependents = ALL_TECH_IDS.filter(t => TECHS[t].prereqs.includes(id));
    assert.ok(dependents.length > 0, `${id} is listed as a pure prerequisite but nothing requires it`);
  }
});

// ── Buildability is gated by advances ───────────────────────────────────────────

test('build: a city offers only what its owner\'s advances allow', () => {
  const state = miniState();
  const offered = new Set(buildableForCity(state, state.cities[0], buildOwnerCtx(state, 'p1')));
  assert.ok(offered.has('militia'), 'militia needs no advance');
  assert.ok(!offered.has('battleship'), 'battleship needs Steel');
  assert.ok(!offered.has('caravan'), 'caravan needs Trade');
  assert.ok(!offered.has('library'), 'library needs Writing');
});

test('build: set-production refuses an item the owner has not researched', () => {
  const state = miniState();
  const after = Civ1Game.applyActions(state, [{
    playerId: 'p1', action: { type: 'set-production', cityId: 'c1', item: 'battleship', unitId: '__player__' },
  }]);
  assert.equal(after.cities[0].production, 'militia', 'an unresearched item must not stick');
});

test('build: set-production accepts an item the owner HAS researched', () => {
  const state = miniState({ techs: ['bronze-working'] });
  const after = Civ1Game.applyActions(state, [{
    playerId: 'p1', action: { type: 'set-production', cityId: 'c1', item: 'phalanx', unitId: '__player__' },
  }]);
  assert.equal(after.cities[0].production, 'phalanx');
});

test('build: a captured city stops building what its new owner cannot', () => {
  // p2 knows Steel and was building a battleship; p1 takes the city knowing nothing.
  const state = miniState({ production: 'battleship' });
  state.cities[0].ownerId = 'p1';           // already captured — p1 owns it now
  state.gameSpecific.civ.p1.techs = [];     // …and has never heard of Steel
  const eco = processOwnerEconomy(state, 'p1', 0, () => { throw new Error('should not build'); });
  assert.equal(eco.cities[0].production, 'militia', 'production must fall back to something legal');
});

test('build: Trade unlocks the Caravan', () => {
  const state = miniState({ techs: ['bronze-working', 'currency', 'alphabet', 'code-of-laws', 'trade'] });
  assert.ok(canProduce(state, state.cities[0], 'caravan', buildOwnerCtx(state, 'p1')));
});

test('build: the spaceship parts are gated by Space Flight, Plastics and Superconductor', () => {
  assert.equal(SPACESHIP['ss-structural'].tech, 'space-flight');
  assert.equal(SPACESHIP['ss-component'].tech, 'plastics');
  assert.equal(SPACESHIP['ss-module'].tech, 'superconductor');
});

// ── Advances whose effect is a rule ─────────────────────────────────────────────

test('bridge-building: a river square cannot be roaded without it', () => {
  const river = { '5,4': { hasRiver: true } };
  const settler = unit('u1', 'settlers', 5, 4);

  const without = miniState({ tiles: river, units: [settler] });
  const noRoad = Civ1Game.getLegalActions(without, 'p1').filter(a => a.type === 'build-road');
  assert.equal(noRoad.length, 0, 'no bridging without the advance');

  const with_ = miniState({ techs: ['bronze-working', 'iron-working', 'alphabet', 'bridge-building'], tiles: river, units: [settler] });
  const road = Civ1Game.getLegalActions(with_, 'p1').filter(a => a.type === 'build-road');
  assert.equal(road.length, 1, 'Bridge Building lets the river be roaded');
});

test('bridge-building: dry land never needed it', () => {
  const settler = unit('u1', 'settlers', 5, 4);
  const state = miniState({ units: [settler] });
  assert.equal(Civ1Game.getLegalActions(state, 'p1').filter(a => a.type === 'build-road').length, 1);
});

test('railroad: laying track needs the advance and an existing road', () => {
  const settler = unit('u1', 'settlers', 5, 4);
  const roaded = { '5,4': { hasRoad: true } };

  const noTech = miniState({ tiles: roaded, units: [settler] });
  assert.equal(Civ1Game.getLegalActions(noTech, 'p1').filter(a => a.type === 'build-railroad').length, 0);

  const noRoad = miniState({ techs: ['railroad'], units: [settler] });
  assert.equal(Civ1Game.getLegalActions(noRoad, 'p1').filter(a => a.type === 'build-railroad').length, 0,
    'railroads go on top of roads, not bare ground');

  const ok = miniState({ techs: ['railroad'], tiles: roaded, units: [settler] });
  const acts = Civ1Game.getLegalActions(ok, 'p1').filter(a => a.type === 'build-railroad');
  assert.equal(acts.length, 1);

  const after = Civ1Game.applyActions(ok, [{ playerId: 'p1', action: acts[0] }]);
  assert.equal(after.board.tiles['5,4'].hasRail, true);
});

test('railroad: a unit crosses a whole rail line in one turn', () => {
  // A line of track running west to east across row 5. Mountains under it, so without
  // the railroad the unit could manage one tile at most (moveCost 3 against 1 move).
  const rail = {};
  for (let x = 2; x <= 8; x++) rail[`${x},5`] = { terrain: 'mountains', hasRoad: true, hasRail: true };
  const state = miniState({ techs: ['railroad'], tiles: rail, units: [unit('u1', 'militia', 2, 5)] });

  const dests = Civ1Game.getLegalActions(state, 'p1')
    .filter(a => a.type === 'move' && a.unitId === 'u1')
    .map(a => `${a.to.x},${a.to.y}`);
  assert.ok(dests.includes('8,5'), 'the far end of the line is reachable in one turn');

  const far = Civ1Game.getLegalActions(state, 'p1').find(a => a.type === 'move' && a.to.x === 8 && a.to.y === 5);
  const after = Civ1Game.applyActions(state, [{ playerId: 'p1', action: far }]);
  const moved = after.units.find(u => u.id === 'u1');
  assert.deepEqual(moved.position, { x: 8, y: 5 });
  assert.equal(moved.movesLeft, UNITS.militia.moves, 'travelling by rail costs nothing');
});

test('railroad: without track the same mountains stop the unit dead', () => {
  const rock = {};
  for (let x = 2; x <= 8; x++) rock[`${x},5`] = { terrain: 'mountains' };
  const state = miniState({ tiles: rock, units: [unit('u1', 'militia', 2, 5)] });
  const dests = Civ1Game.getLegalActions(state, 'p1')
    .filter(a => a.type === 'move' && a.unitId === 'u1')
    .map(a => `${a.to.x},${a.to.y}`);
  assert.ok(!dests.includes('8,5'));
});

test('build: a city whose owner keeps no ledger (the barbarians) is handled, not crashed', () => {
  // Barbarians own cities but have no entry in gameSpecific.civ — canProduce has to
  // read that as "knows nothing", not throw on the way to the tech check.
  const state = miniState();
  state.cities[0].ownerId = 'barbarians';
  assert.equal(canProduce(state, state.cities[0], 'battleship', null), false);
  assert.equal(canProduce(state, state.cities[0], 'militia', null), true);
});

test('railroad: track adds half again to a square\'s shields', () => {
  // Monarchy, not the default Despotism: the Despotism penalty docks 1 from any yield
  // of 3+, which would eat the railroad's third shield off a forest and hide the bonus.
  const state = miniState({ techs: ['railroad'], government: 'monarchy' });
  const ctx = buildOwnerCtx(state, 'p1');
  const forest = { terrain: 'forest' };
  const plain = workedTileYield(forest, 1, 1, ctx).shields;
  const railed = workedTileYield({ ...forest, hasRail: true }, 1, 1, ctx).shields;
  assert.equal(railed, plain + Math.floor(plain / 2));
  assert.ok(railed > plain, 'a forest has shields to multiply');

  // …and nothing where there were no shields to begin with.
  const tundra = { terrain: 'tundra' };
  assert.equal(workedTileYield({ ...tundra, hasRail: true }, 1, 1, ctx).shields,
    workedTileYield(tundra, 1, 1, ctx).shields);
});

test('philosophy: the first civ to discover it gets a free advance, and only the first', () => {
  // Both civs are one bulb-load away from Philosophy. p1 gets there first.
  const prereqs = ['alphabet', 'ceremonial-burial', 'mysticism', 'writing', 'code-of-laws', 'literacy'];
  const state = miniState({ techs: prereqs, techs2: prereqs });
  for (const pid of ['p1', 'p2']) {
    state.gameSpecific.civ[pid].research = 'philosophy';
    state.gameSpecific.civ[pid].bulbs = techCost(prereqs.length) + 1000;
  }

  const first = processOwnerEconomy(state, 'p1', 0, () => null);
  assert.ok(first.civ.techs.includes('philosophy'));
  assert.equal(first.civ.techs.length, prereqs.length + 2, 'Philosophy plus one free advance');
  assert.deepEqual(first.worldPatch, { philosophyClaimedBy: 'p1' });

  // p2 now researches it into a world where the bonus is already taken.
  const claimed = { ...state, gameSpecific: { ...state.gameSpecific, philosophyClaimedBy: 'p1' } };
  const second = processOwnerEconomy(claimed, 'p2', 0, () => null);
  assert.ok(second.civ.techs.includes('philosophy'));
  assert.equal(second.civ.techs.length, prereqs.length + 1, 'no second free advance');
  assert.equal(second.worldPatch, null);
});

test('future-tech: repeats, and each repeat costs more than the last', () => {
  const all = ALL_TECH_IDS.filter(id => id !== 'future-tech');
  const state = miniState({ techs: all });
  state.gameSpecific.civ.p1.research = 'future-tech';
  state.gameSpecific.civ.p1.bulbs = 100000;

  const once = processOwnerEconomy(state, 'p1', 0, () => null);
  assert.equal(once.civ.futureTechs, 1);
  assert.equal(once.civ.techs.length, all.length, 'Future Tech never joins the known set');
  assert.equal(once.civ.research, 'future-tech', 'and stays researchable');

  // Feed the result back in: the second one must cost more, or a finished civ buys
  // Future Techs forever at one frozen price.
  const next = { ...state, gameSpecific: { ...state.gameSpecific, civ: { ...state.gameSpecific.civ, p1: once.civ } } };
  const twice = processOwnerEconomy(next, 'p1', 0, () => null);
  assert.equal(twice.civ.futureTechs, 2);
  assert.ok(techCost(all.length + 1) > techCost(all.length));
});

// ── Caravan ─────────────────────────────────────────────────────────────────────

test('caravan: pours its shields into a Wonder and is spent', () => {
  const techs = ['bronze-working', 'currency', 'alphabet', 'code-of-laws', 'trade'];
  const state = miniState({ techs, production: 'marco-polo', units: [unit('u1', 'caravan', 5, 5)] });
  const acts = Civ1Game.getLegalActions(state, 'p1').filter(a => a.type === 'help-build-wonder');
  assert.equal(acts.length, 1);

  const after = Civ1Game.applyActions(state, [{ playerId: 'p1', action: acts[0] }]);
  assert.equal(after.cities[0].shields, UNITS.caravan.cost);
  assert.equal(after.units.find(u => u.id === 'u1'), undefined, 'the caravan is consumed');
});

test('caravan: offers nothing when the city is not building a Wonder', () => {
  const techs = ['bronze-working', 'currency', 'alphabet', 'code-of-laws', 'trade'];
  const state = miniState({ techs, production: 'militia', units: [unit('u1', 'caravan', 5, 5)] });
  assert.equal(Civ1Game.getLegalActions(state, 'p1').filter(a => a.type === 'help-build-wonder').length, 0);
});
