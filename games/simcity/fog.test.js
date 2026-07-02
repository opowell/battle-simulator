import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SimCityGame } from './index.js';
import { GameEngine } from '../../engine/index.js';
import { RandomAgent } from '../../agents/index.js';
import { ObscuroAgent } from '../../agents/ObscuroAgent.js';

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
// gameOptions
// ---------------------------------------------------------------------------

test('simcity fog: gameOptions exposes a fogOfWar boolean toggle, default off', () => {
  const opt = (SimCityGame.gameOptions ?? []).find(o => o.id === 'fogOfWar');
  assert.ok(opt, 'fogOfWar option declared');
  assert.equal(opt.type, 'boolean');
  assert.equal(opt.default, false);
});

test('simcity fog: gameSpecific.fogOfWar defaults to false and reflects config', () => {
  const off = SimCityGame.createInitialState(players());
  assert.equal(off.gameSpecific.fogOfWar, false);
  const on = SimCityGame.createInitialState(players(), { fogOfWar: true });
  assert.equal(on.gameSpecific.fogOfWar, true);
});

// ---------------------------------------------------------------------------
// getVisibleState
// ---------------------------------------------------------------------------

test('simcity fog: getVisibleState is a no-op when fog is off', () => {
  const state = SimCityGame.createInitialState(players(), { width: 20, height: 14 });
  const view = SimCityGame.getVisibleState(state, 'mayor');
  assert.equal(view, state, 'returns the same state reference untouched');
});

test('simcity fog: getVisibleState reveals tiles near built structures and hides far tiles', () => {
  let state = SimCityGame.createInitialState(players(), { width: 20, height: 14, fogOfWar: true });
  // Build a road near the top-left corner.
  state = apply(state, { type: 'build-road', x: 1, y: 1 });

  const view = SimCityGame.getVisibleState(state, 'mayor');

  // The built tile itself and its near neighborhood should be revealed.
  assert.equal(view.board.tiles['1,1'].type, 'road');
  assert.equal(view.board.tiles['0,0'].type, 'empty', 'within reveal radius, still empty but known');
  assert.equal(view.board.tiles['2,2'].type, 'empty', 'within reveal radius');

  // A tile far away (bottom-right corner) should be unrevealed.
  assert.equal(view.board.tiles['19,13'].type, 'unknown', 'far tile is unsurveyed');
});

test('simcity fog: getVisibleState does not mutate the original state', () => {
  let state = SimCityGame.createInitialState(players(), { width: 20, height: 14, fogOfWar: true });
  state = apply(state, { type: 'build-road', x: 1, y: 1 });
  const before = state.board.tiles['19,13'].type;
  SimCityGame.getVisibleState(state, 'mayor');
  assert.equal(state.board.tiles['19,13'].type, before, 'original state tiles untouched');
});

test('simcity fog: getVisibleState with no built structures leaves everything unrevealed except within radius of nothing', () => {
  const state = SimCityGame.createInitialState(players(), { width: 20, height: 14, fogOfWar: true });
  const view = SimCityGame.getVisibleState(state, 'mayor');
  const types = new Set(Object.values(view.board.tiles).map(t => t.type));
  assert.deepEqual(types, new Set(['unknown']), 'nothing built yet, whole map unsurveyed');
});

// ---------------------------------------------------------------------------
// evaluateState
// ---------------------------------------------------------------------------

test('simcity fog: evaluateState returns a finite number for the initial state', () => {
  const state = SimCityGame.createInitialState(players());
  const v = SimCityGame.evaluateState(state, 'mayor');
  assert.equal(typeof v, 'number');
  assert.ok(Number.isFinite(v));
});

test('simcity fog: evaluateState increases as funds grow', () => {
  const state = SimCityGame.createInitialState(players());
  const richer = { ...state, budget: { ...state.budget, funds: state.budget.funds + 5000 } };
  assert.ok(
    SimCityGame.evaluateState(richer, 'mayor') > SimCityGame.evaluateState(state, 'mayor'),
    'more funds should score higher'
  );
});

test('simcity fog: evaluateState increases as population grows', () => {
  const state = SimCityGame.createInitialState(players());
  const bigger = { ...state, population: state.population + 1000 };
  assert.ok(
    SimCityGame.evaluateState(bigger, 'mayor') > SimCityGame.evaluateState(state, 'mayor'),
    'more population should score higher'
  );
});

test('simcity fog: evaluateState prefers a city with positive net income over one with negative, at equal funds/population', () => {
  const state = SimCityGame.createInitialState(players());
  const thriving = { ...state, budget: { ...state.budget, lastIncome: 500, lastExpenses: 100 } };
  const struggling = { ...state, budget: { ...state.budget, lastIncome: 100, lastExpenses: 500 } };
  assert.ok(
    SimCityGame.evaluateState(thriving, 'mayor') > SimCityGame.evaluateState(struggling, 'mayor'),
    'positive net income should score higher than negative net income'
  );
});

test('simcity fog: evaluateState rewards a city that has grown population and income over several years', () => {
  // A longer horizon lets the zone's income/population growth outweigh the
  // upfront infrastructure cost that dominates in the very first tick.
  const state = SimCityGame.createInitialState(players(), { width: 10, height: 10 });
  let s = apply(state, { type: 'build-power-plant', x: 5, y: 5 });
  s = apply(s, { type: 'build-water-pump', x: 4, y: 5 });
  s = apply(s, { type: 'build-road', x: 3, y: 3 });
  s = apply(s, { type: 'zone', x: 4, y: 3, zoneType: 'R' });
  for (let i = 0; i < 15; i++) s = endTurn(s);

  assert.ok(s.population > 0, 'sanity: the zone actually grew');
  assert.ok(
    SimCityGame.evaluateState(s, 'mayor') > SimCityGame.evaluateState(state, 'mayor'),
    'a mature, populated city should score higher than an empty one once growth outpaces the initial build cost'
  );
});

// ---------------------------------------------------------------------------
// Self-play with ObscuroAgent (regression check — no adversary, single world)
// ---------------------------------------------------------------------------

// A tiny board keeps SimCity's per-turn branching factor (which scales with
// width*height) small enough for ObscuroAgent to rank all legal actions
// quickly. The point of these tests is only to confirm the generic,
// no-sampleWorlds ObscuroAgent (single-world minimax-lite over its own legal
// actions each turn, since SimCity is strictly single-player) drives the
// game via GameEngine for many steps without throwing.
//
// Note on 'end-turn': on an empty/undeveloped city, evaluateState scores
// 'end-turn' no better (often slightly worse, once anything has been built,
// since simulateTick immediately charges maintenance) than a free no-op like
// re-setting the tax rate — nothing is actually simulated until 'end-turn'
// runs. A purely greedy 1-ply agent therefore has no incentive to ever
// voluntarily end the turn on this game; that's an inherent property of
// one-ply search on a delayed-reward sandbox, not a bug in evaluateState or
// getVisibleState. So this regression check asserts the run completes
// (either by reaching max-turns or exhausting the step budget) without
// crashing, rather than asserting it reaches 'max-turns' specifically.
function tinyMayor() {
  return [{
    id: 'mayor', name: 'Mayor',
    agent: new ObscuroAgent(SimCityGame, { particles: 1, rows: 100, cols: 4, iters: 40 }),
  }];
}

test('simcity fog: ObscuroAgent (no sampleWorlds, single-world minimax-lite) runs without crashing', async () => {
  const engine = new GameEngine(SimCityGame, tinyMayor(), {
    maxTurns: 3, stepLimit: 300, width: 4, height: 4,
  });
  const { result } = await engine.run();
  assert.ok(['max-turns', 'step-limit'].includes(result.reason), `unexpected reason: ${result.reason}`);
  assert.equal(result.outcome, 'draw');
});

test('simcity fog: ObscuroAgent runs under fogOfWar engine config without crashing', async () => {
  const engine = new GameEngine(SimCityGame, tinyMayor(), {
    maxTurns: 3, stepLimit: 300, width: 4, height: 4, fogOfWar: true,
  });
  const { result } = await engine.run();
  assert.ok(['max-turns', 'step-limit'].includes(result.reason), `unexpected reason: ${result.reason}`);
  assert.equal(result.outcome, 'draw');
});

test('simcity fog: RandomAgent self-play with fogOfWar enabled runs several years without crashing', async () => {
  const engine = new GameEngine(SimCityGame, players(), { maxTurns: 10, stepLimit: 10000, fogOfWar: true });
  const { result, finalState } = await engine.run();
  assert.equal(result.outcome, 'draw');
  assert.equal(result.reason, 'max-turns');
  assert.equal(finalState.gameSpecific.fogOfWar, true);
});
