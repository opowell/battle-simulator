import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SimCityGame } from '../games/simcity/index.js';
import { GameEngine } from '../engine/index.js';
import { RandomAgent } from '../agents/index.js';

function players() {
  return [{ id: 'mayor', name: 'Mayor', agent: RandomAgent }];
}

function apply(state, action) {
  return SimCityGame.applyActions(state, [{ playerId: 'mayor', action }]);
}

function endTurn(state) {
  return apply(state, { type: 'end-turn' });
}

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

test('simcity: starts on turn 1, year 1900, mayor active', () => {
  const state = SimCityGame.createInitialState(players());
  assert.equal(state.turnNumber, 1);
  assert.equal(state.year, 1900);
  assert.deepEqual(state.activePlayers, ['mayor']);
});

test('simcity: starts with $20,000 and 8% tax rate', () => {
  const state = SimCityGame.createInitialState(players());
  assert.equal(state.budget.funds, 20000);
  assert.equal(state.budget.taxRate, 8);
});

test('simcity: board has correct dimensions and all empty tiles', () => {
  const state = SimCityGame.createInitialState(players(), { width: 10, height: 8 });
  assert.equal(state.board.width, 10);
  assert.equal(state.board.height, 8);
  const tiles = Object.values(state.board.tiles);
  assert.equal(tiles.length, 80);
  assert.ok(tiles.every(t => t.type === 'empty'));
});

test('simcity: population starts at zero', () => {
  const state = SimCityGame.createInitialState(players());
  assert.equal(state.population, 0);
});

// ---------------------------------------------------------------------------
// getLegalActions
// ---------------------------------------------------------------------------

test('simcity: getLegalActions always includes end-turn', () => {
  const state = SimCityGame.createInitialState(players());
  const actions = SimCityGame.getLegalActions(state, 'mayor');
  assert.ok(actions.some(a => a.type === 'end-turn'));
});

test('simcity: getLegalActions includes zone and build-road for empty tiles', () => {
  const state = SimCityGame.createInitialState(players());
  const actions = SimCityGame.getLegalActions(state, 'mayor');
  assert.ok(actions.some(a => a.type === 'zone'));
  assert.ok(actions.some(a => a.type === 'build-road'));
});

test('simcity: getLegalActions includes set-tax-rate options', () => {
  const state = SimCityGame.createInitialState(players());
  const actions = SimCityGame.getLegalActions(state, 'mayor');
  assert.ok(actions.some(a => a.type === 'set-tax-rate'));
});

test('simcity: getLegalActions excludes actions player cannot afford', () => {
  const state = SimCityGame.createInitialState(players());
  const broke = { ...state, budget: { ...state.budget, funds: 30 } };
  const actions = SimCityGame.getLegalActions(broke, 'mayor');
  assert.ok(!actions.some(a => a.type === 'zone'));
  assert.ok(!actions.some(a => a.type === 'build-road'));
  assert.ok(actions.some(a => a.type === 'end-turn'));
});

// ---------------------------------------------------------------------------
// applyActions — building
// ---------------------------------------------------------------------------

test('simcity: zone action places a zone tile and deducts cost', () => {
  const state = SimCityGame.createInitialState(players());
  const next = apply(state, { type: 'zone', x: 3, y: 3, zoneType: 'R' });
  const tile = next.board.tiles['3,3'];
  assert.equal(tile.type, 'zone');
  assert.equal(tile.zone, 'R');
  assert.equal(tile.density, 0);
  assert.equal(next.budget.funds, 20000 - 100);
});

test('simcity: build-road places a road and deducts cost', () => {
  const state = SimCityGame.createInitialState(players());
  const next = apply(state, { type: 'build-road', x: 5, y: 2 });
  assert.equal(next.board.tiles['5,2'].type, 'road');
  assert.equal(next.budget.funds, 20000 - 50);
});

test('simcity: build-power-plant places a power plant', () => {
  const state = SimCityGame.createInitialState(players());
  const next = apply(state, { type: 'build-power-plant', x: 0, y: 0 });
  assert.equal(next.board.tiles['0,0'].type, 'power-plant');
  assert.equal(next.budget.funds, 20000 - 5000);
});

test('simcity: demolish reverts tile to empty', () => {
  const state = SimCityGame.createInitialState(players());
  const s1 = apply(state, { type: 'build-road', x: 1, y: 1 });
  const s2 = apply(s1, { type: 'demolish', x: 1, y: 1 });
  assert.equal(s2.board.tiles['1,1'].type, 'empty');
});

test('simcity: set-tax-rate updates the tax rate', () => {
  const state = SimCityGame.createInitialState(players());
  const next = apply(state, { type: 'set-tax-rate', rate: 12 });
  assert.equal(next.budget.taxRate, 12);
});

// ---------------------------------------------------------------------------
// applyActions — end-turn simulation
// ---------------------------------------------------------------------------

test('simcity: end-turn advances year and turn number', () => {
  const state = SimCityGame.createInitialState(players());
  const next = endTurn(state);
  assert.equal(next.year, 1901);
  assert.equal(next.turnNumber, 2);
});

test('simcity: end-turn with no development charges only infrastructure expenses', () => {
  const state = SimCityGame.createInitialState(players());
  // No roads/power/water — expenses should be 0
  const next = endTurn(state);
  assert.equal(next.budget.lastIncome, 0);
  assert.equal(next.budget.lastExpenses, 0);
  assert.equal(next.budget.funds, 20000);
});

test('simcity: road incurs annual maintenance cost', () => {
  const state = SimCityGame.createInitialState(players());
  const s1 = apply(state, { type: 'build-road', x: 0, y: 0 });
  const s2 = endTurn(s1);
  assert.equal(s2.budget.lastExpenses, 5);
});

test('simcity: zone with full infrastructure grows density', () => {
  const state = SimCityGame.createInitialState(players(), { width: 10, height: 10 });
  // Build power plant and water pump with coverage
  let s = apply(state, { type: 'build-power-plant', x: 5, y: 5 });
  s = apply(s, { type: 'build-water-pump', x: 4, y: 5 });
  // Road adjacent to zone
  s = apply(s, { type: 'build-road', x: 3, y: 3 });
  // Zone next to road
  s = apply(s, { type: 'zone', x: 4, y: 3, zoneType: 'R' });
  // End turn — zone should grow (has road access, power, water)
  s = endTurn(s);
  assert.equal(s.board.tiles['4,3'].density, 1);
});

test('simcity: zone without road access stays at density 0', () => {
  const state = SimCityGame.createInitialState(players(), { width: 10, height: 10 });
  let s = apply(state, { type: 'build-power-plant', x: 5, y: 5 });
  s = apply(s, { type: 'build-water-pump', x: 4, y: 5 });
  // Zone isolated from roads
  s = apply(s, { type: 'zone', x: 0, y: 0, zoneType: 'R' });
  s = endTurn(s);
  assert.equal(s.board.tiles['0,0'].density, 0);
});

test('simcity: residential zone generates population and income', () => {
  const state = SimCityGame.createInitialState(players(), { width: 10, height: 10 });
  let s = apply(state, { type: 'build-power-plant', x: 5, y: 5 });
  s = apply(s, { type: 'build-water-pump', x: 4, y: 5 });
  s = apply(s, { type: 'build-road', x: 3, y: 3 });
  s = apply(s, { type: 'zone', x: 4, y: 3, zoneType: 'R' });
  s = endTurn(s); // density → 1, pop = 100
  assert.equal(s.population, 100);
  assert.ok(s.budget.lastIncome > 0);
});

// ---------------------------------------------------------------------------
// getResult
// ---------------------------------------------------------------------------

test('simcity: getResult always returns null (sandbox mode)', () => {
  const state = SimCityGame.createInitialState(players());
  assert.equal(SimCityGame.getResult(state), null);
  const next = endTurn(state);
  assert.equal(SimCityGame.getResult(next), null);
});

// ---------------------------------------------------------------------------
// renderState
// ---------------------------------------------------------------------------

test('simcity: renderState returns a non-empty string with year', () => {
  const state = SimCityGame.createInitialState(players());
  const output = SimCityGame.renderState(state);
  assert.ok(typeof output === 'string' && output.length > 0);
  assert.ok(output.includes('1900'));
});

// ---------------------------------------------------------------------------
// Self-play
// ---------------------------------------------------------------------------

test('simcity: self-play runs without errors for 20 years', async () => {
  const engine = new GameEngine(SimCityGame, players(), { maxTurns: 20, stepLimit: 10000 });
  const { result } = await engine.run();
  assert.equal(result.outcome, 'draw');
  assert.equal(result.reason, 'max-turns');
});
