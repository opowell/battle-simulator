import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Civ1Game } from './index.js';
import { researchableTechs, isResearchable, techCost, TECHS } from './tech.js';
import { computeCity } from './city.js';
import { buildOwnerCtx, buildableForCity, newCivState } from './economy.js';
import { GOVERNMENTS, availableGovernments } from './governments.js';

function players() {
  return [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];
}

// A tiny hand-built state: two 1-tile owners, one city each, flat grassland board so
// yields are predictable. Fog off. Government/tech set per test.
function miniState({ government = 'despotism', techs = [], size = 1, buildings = ['palace'] } = {}) {
  const width = 10, height = 10;
  const tiles = {};
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) tiles[`${x},${y}`] = { terrain: 'grassland' };
  const civ = { p1: { ...newCivState(), government, techs }, p2: newCivState() };
  return {
    gameName: 'Civ1', turnNumber: 1, activePlayers: ['p1'], players: players(),
    board: { width, height, tiles }, units: [],
    cities: [{ id: 'c1', name: 'Rome', ownerId: 'p1', position: { x: 5, y: 5 }, size, food: 0, shields: 0, production: 'militia', buildings }],
    lastActions: null,
    gameSpecific: { nextId: 0, fogOfWar: false, civ },
  };
}

// ── Tech tree ───────────────────────────────────────────────────────────────

test('tech: seven advances need no prerequisites', () => {
  const roots = researchableTechs(new Set());
  assert.deepEqual(roots.slice().sort(), [
    'alphabet', 'bronze-working', 'ceremonial-burial', 'horseback-riding', 'masonry', 'pottery', 'the-wheel',
  ]);
});

test('tech: prerequisites are enforced', () => {
  assert.equal(isResearchable('monarchy', new Set()), false);
  assert.equal(isResearchable('monarchy', new Set(['ceremonial-burial', 'code-of-laws'])), true);
});

test('tech: cost rises with advances known', () => {
  assert.ok(techCost(10) > techCost(0));
});

test('tech: every prerequisite is itself a real advance', () => {
  for (const [, t] of Object.entries(TECHS))
    for (const p of t.prereqs) assert.ok(TECHS[p], `missing prereq ${p}`);
});

// ── Buildable gating ─────────────────────────────────────────────────────────

test('buildable: phalanx needs Bronze Working', () => {
  const s0 = miniState({ techs: [] });
  assert.ok(!buildableForCity(s0, s0.cities[0]).includes('phalanx'));
  const s1 = miniState({ techs: ['bronze-working'] });
  assert.ok(buildableForCity(s1, s1.cities[0]).includes('phalanx'));
});

test('buildable: Bank needs a Marketplace already in the city', () => {
  const s = miniState({ techs: ['currency', 'bronze-working', 'code-of-laws', 'the-republic', 'banking', 'literacy', 'writing', 'alphabet', 'trade'] });
  assert.ok(!buildableForCity(s, s.cities[0]).includes('bank'));
  s.cities[0].buildings.push('marketplace');
  assert.ok(buildableForCity(s, s.cities[0]).includes('bank'));
});

test('buildable: an already-built improvement drops off the list', () => {
  const s = miniState({ techs: ['pottery'] });
  assert.ok(buildableForCity(s, s.cities[0]).includes('granary'));
  s.cities[0].buildings.push('granary');
  assert.ok(!buildableForCity(s, s.cities[0]).includes('granary'));
});

// ── City output & government rules ───────────────────────────────────────────

test('city: despotism docks a 3+ yield, and a bigger city produces more', () => {
  const s = miniState({ size: 3 });
  const ctx = buildOwnerCtx(s, 'p1');
  const out = computeCity(s.cities[0], ctx);
  assert.ok(out.grossFood > 0 && out.grossShields > 0);
  // grassland gives 2 food; despotism penalty only bites at 3+, so food stays 2/tile.
  assert.ok(out.foodSurplus === out.grossFood - s.cities[0].size * 2);
});

test('city: Republic adds a trade arrow that Despotism lacks', () => {
  const despot = computeCity(miniState({ government: 'despotism' }).cities[0], buildOwnerCtx(miniState({ government: 'despotism' }), 'p1'));
  const repState = miniState({ government: 'republic', techs: ['the-republic', 'code-of-laws', 'literacy', 'writing', 'alphabet'] });
  const rep = computeCity(repState.cities[0], buildOwnerCtx(repState, 'p1'));
  assert.ok(rep.grossTrade >= despot.grossTrade);
});

test('city: a large city with no happiness buildings falls into disorder', () => {
  const s = miniState({ size: 8, buildings: ['palace'] });
  const out = computeCity(s.cities[0], buildOwnerCtx(s, 'p1'));
  assert.equal(out.happiness.disorder, true);
  assert.equal(out.shields, 0);
});

test('city: a temple pacifies enough to avoid disorder at size 5', () => {
  const s = miniState({ size: 5, buildings: ['palace', 'temple'] });
  const out = computeCity(s.cities[0], buildOwnerCtx(s, 'p1'));
  assert.equal(out.happiness.disorder, false);
});

// ── Governments ──────────────────────────────────────────────────────────────

test('gov: only Despotism available before any government tech', () => {
  assert.deepEqual(availableGovernments(new Set()), ['despotism']);
  assert.ok(availableGovernments(new Set(['monarchy'])).includes('monarchy'));
});

test('gov: tax cap comes from the government', () => {
  assert.equal(GOVERNMENTS.despotism.taxMax, 60);
  assert.equal(GOVERNMENTS.democracy.taxMax, 90);
});

// ── End-to-end economy ───────────────────────────────────────────────────────

test('economy: a city grows when its food box fills', () => {
  let s = miniState({ size: 1 });
  s.cities[0].food = 100; // way over the box
  s = Civ1Game.applyActions(s, [{ playerId: 'p1', action: { type: 'end-turn', unitId: '__player__' } }]);
  assert.equal(s.cities[0].size, 2);
});

test('economy: maintenance is charged and research accrues over turns', () => {
  let s = miniState({ size: 4, buildings: ['palace', 'temple', 'library'] });
  s.gameSpecific.civ.p1.gold = 5;
  const before = s.gameSpecific.civ.p1;
  // End p1 then p2 to complete a round.
  s = Civ1Game.applyActions(s, [{ playerId: 'p1', action: { type: 'end-turn', unitId: '__player__' } }]);
  const civ = s.gameSpecific.civ.p1;
  assert.ok(civ.research, 'a research target was auto-selected');
  assert.ok(Array.isArray(civ.techs));
});

// A completed improvement leaves `production` naming something the city can never
// build again. Before this was handled, the city simply built it a second time the
// next time its shields filled — and a third, and a ninth — each copy charging its
// own maintenance for no extra effect.
test('economy: a finished improvement is not built twice', () => {
  let s = miniState({ size: 4, techs: ['ceremonial-burial'], buildings: ['palace'] });
  s.cities[0].production = 'temple';
  s.cities[0].shields = 1000;             // enough to finish it many times over

  for (let i = 0; i < 5; i++) {
    s = Civ1Game.applyActions(s, [{ playerId: 'p1', action: { type: 'end-turn', unitId: '__player__' } }]);
  }

  const temples = s.cities[0].buildings.filter(b => b === 'temple').length;
  assert.equal(temples, 1, 'exactly one Temple was built');
  assert.notEqual(s.cities[0].production, 'temple', 'the city moved off what it had finished');
  assert.ok(!buildableForCity(s, s.cities[0]).includes('temple'), 'and could not choose it again');
});

test('economy: change-government enters anarchy then adopts the new government', () => {
  let s = miniState({ techs: ['monarchy', 'ceremonial-burial', 'code-of-laws'] });
  s = Civ1Game.applyActions(s, [{ playerId: 'p1', action: { type: 'change-government', government: 'monarchy', unitId: '__player__' } }]);
  assert.equal(s.gameSpecific.civ.p1.government, 'anarchy');
  // Two end-of-turns clear the revolution.
  s = Civ1Game.applyActions(s, [{ playerId: 'p1', action: { type: 'end-turn', unitId: '__player__' } }]);
  s = Civ1Game.applyActions(s, [{ playerId: 'p1', action: { type: 'end-turn', unitId: '__player__' } }]);
  assert.equal(s.gameSpecific.civ.p1.government, 'monarchy');
});

test('economy: legal actions expose research, tax, government and terraform choices', () => {
  const s = miniState({ techs: ['bronze-working'] });
  // put a settler on the map
  s.units.push({ id: 'u0', ownerId: 'p1', type: 'settlers', position: { x: 4, y: 4 }, alive: true, hp: 20, maxHp: 20, movesLeft: 1, queue: [], special: [] });
  const acts = Civ1Game.getLegalActions(s, 'p1');
  assert.ok(acts.some(a => a.type === 'set-research'));
  assert.ok(acts.some(a => a.type === 'set-tax'));
  assert.ok(acts.some(a => a.type === 'irrigate' || a.type === 'build-mine' || a.type === 'build-road'));
});
