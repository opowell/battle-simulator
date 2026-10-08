import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KDiceGame, getLargestConnectedRegion } from './index.js';
import { DEFAULT_STOCK_MAX, standings } from './KDiceGame.js';
import { winProbability } from './odds.js';

const players = (n = 2) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));

// A state with every one of p1's territories set to `dice`, and p1 holding `stock`.
function withP1(state, dice, stock) {
  const territories = {};
  for (const [id, t] of Object.entries(state.board.territories)) {
    territories[id] = t.owner === 'p1' ? { ...t, dice } : t;
  }
  return {
    ...state,
    board: { ...state.board, territories },
    gameSpecific: { ...state.gameSpecific, stock: { ...state.gameSpecific.stock, p1: stock } },
  };
}
const endTurn = (state) => KDiceGame.applyActions(state, [{ playerId: 'p1', action: { type: 'end-turn' } }], Math.random);
const p1Dice = (state) => Object.values(state.board.territories).filter(t => t.owner === 'p1').reduce((n, t) => n + t.dice, 0);
const regionOf = (state) => getLargestConnectedRegion('p1', state.board.territories, state.board.adjacency).length;

test('kdice reserve: every player starts with an empty reserve, capped at 64 by default', () => {
  const s = KDiceGame.createInitialState(players(3));
  assert.deepEqual(s.gameSpecific.stock, { p1: 0, p2: 0, p3: 0 });
  assert.equal(s.gameSpecific.stockMax, DEFAULT_STOCK_MAX);
  assert.equal(DEFAULT_STOCK_MAX, 64);
  assert.equal(KDiceGame.createInitialState(players(), { stockMax: 20 }).gameSpecific.stockMax, 20);
  assert.equal(KDiceGame.createInitialState(players(), { stockMax: '' }).gameSpecific.stockMax, 64);
});

test('kdice reserve: with every territory full, the whole income is stored', () => {
  const s = withP1(KDiceGame.createInitialState(players()), 8, 0);
  const next = endTurn(s);
  assert.equal(next.gameSpecific.stock.p1, regionOf(s));
  assert.equal(p1Dice(next), p1Dice(s), 'nothing could be placed');
});

test('kdice reserve: income that does not fit is stored; the rest is placed', () => {
  const base = KDiceGame.createInitialState(players());
  const owned = Object.values(base.board.territories).filter(t => t.owner === 'p1');
  // Every territory full but one, which has room for exactly 3 more.
  const territories = { ...base.board.territories };
  owned.forEach((t, i) => { territories[t.id] = { ...t, dice: i === 0 ? 5 : 8 }; });
  const s = { ...base, board: { ...base.board, territories } };
  const income = regionOf(s);
  const next = endTurn(s);
  const placed = Math.min(3, income);
  assert.equal(p1Dice(next) - p1Dice(s), placed);
  assert.equal(next.gameSpecific.stock.p1, income - placed);
  assert.deepEqual(next.lastActions[0].action.result.reinforced, placed ? [owned[0].id] : []);
});

test('kdice reserve: stored dice are placed in later turns, before anything is kept back', () => {
  const s = withP1(KDiceGame.createInitialState(players()), 1, 10);
  const room = Object.values(s.board.territories).filter(t => t.owner === 'p1').length * 7;
  const next = endTurn(s);
  const pool = 10 + regionOf(s);
  assert.equal(p1Dice(next) - p1Dice(s), Math.min(pool, room));
  assert.equal(next.gameSpecific.stock.p1, Math.max(0, pool - room));
  for (const t of Object.values(next.board.territories)) assert.ok(t.dice <= 8);
});

test('kdice reserve: the reserve never exceeds its cap (DICE WARS caps income + stock at 64)', () => {
  const s = withP1(KDiceGame.createInitialState(players()), 8, 60);
  assert.equal(endTurn(s).gameSpecific.stock.p1, 64);
  const capped = withP1(KDiceGame.createInitialState(players(), { stockMax: 5 }), 8, 0);
  assert.equal(endTurn(capped).gameSpecific.stock.p1, Math.min(5, regionOf(capped)));
});

test('kdice reserve: only the player ending the turn is supplied', () => {
  const s = withP1(KDiceGame.createInitialState(players()), 8, 0);
  const next = endTurn(s);
  assert.equal(next.gameSpecific.stock.p2, 0);
});

test('kdice: an attack result carries how both territories look afterwards', () => {
  const s = KDiceGame.createInitialState(players());
  const attack = KDiceGame.getLegalActions(s, 'p1').find(a => a.type === 'attack');
  if (!attack) return;
  const next = KDiceGame.applyActions(s, [{ playerId: 'p1', action: attack }], Math.random);
  const r = attack.result;
  for (const id of [attack.from, attack.to]) {
    assert.equal(r.territories[id].owner, next.board.territories[id].owner);
    assert.equal(r.territories[id].token.label, String(next.board.territories[id].dice));
  }
});

test('kdice: getChanceOutcomes splits an attack into its two outcomes at the exact odds', () => {
  const s = KDiceGame.createInitialState(players());
  const attack = KDiceGame.getLegalActions(s, 'p1').find(a => a.type === 'attack');
  if (!attack) return;
  const outcomes = KDiceGame.getChanceOutcomes(s, attack);
  const p = winProbability(s.board.territories[attack.from].dice, s.board.territories[attack.to].dice);
  assert.ok(Math.abs(outcomes.reduce((n, o) => n + o.prob, 0) - 1) < 1e-9);
  assert.ok(Math.abs(outcomes[0].prob - p) < 1e-12);
  assert.equal(outcomes[0].state.board.territories[attack.to].owner, 'p1');
  if (outcomes[1]) assert.notEqual(outcomes[1].state.board.territories[attack.to].owner, 'p1');
});

test('kdice odds: the known DICE WARS table values', () => {
  assert.ok(Math.abs(winProbability(2, 1) - 0.8380) < 1e-3);
  assert.ok(Math.abs(winProbability(8, 8) - 0.4709) < 1e-3);
  assert.equal(winProbability(1, 1), 0);
});

test('kdice leaderboard: one row per player, the leader first, the eliminated last', () => {
  const s = KDiceGame.createInitialState(players(3));
  const ts = { ...s.board.territories };
  for (const [id, t] of Object.entries(ts)) if (t.owner === 'p3') ts[id] = { ...t, owner: 'p2' };
  const st = {
    ...s, board: { ...s.board, territories: ts },
    gameSpecific: { ...s.gameSpecific, eliminatedPlayers: ['p3'], stock: { p1: 4, p2: 0, p3: 0 } },
  };
  const { rows, columns } = standings(st);
  assert.deepEqual(columns.map(c => c.key), ['territories', 'dice', 'stock', 'region']);
  assert.deepEqual(rows.map(r => r.playerId), ['p2', 'p1', 'p3']);
  assert.equal(rows[2].out, true);
  assert.equal(rows[1].values.stock, 4);
  assert.equal(rows[0].values.region, getLargestConnectedRegion('p2', ts, s.board.adjacency).length);
  assert.ok(KDiceGame.toGrid(st).standings.rows.length === 3);
});
