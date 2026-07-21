// csmini played across every (space × time) quadrant and both play modes, all
// from the one SPEED spec. Proves the generic games/spacetime.js machinery drives
// a real game — not just the framework's own unit tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CsMiniGame } from './index.js';
import { GameEngine } from '../../engine/index.js';
import { makeGreedyAgent } from '../../agents/GreedyAgent.js';

function players() {
  return [
    { id: 'ct', name: 'CT', agent: makeGreedyAgent(CsMiniGame) },
    { id: 't', name: 'T', agent: makeGreedyAgent(CsMiniGame) },
  ];
}

const init = (config) => CsMiniGame.createInitialState(players(), config);
const legal = (s, pid) => CsMiniGame.getLegalActions(s, pid);
const apply = (s, pid, a) => CsMiniGame.applyActions(s, [{ playerId: pid, action: a }]);
const u = (s, id) => s.units.find(x => x.id === id);

const QUADRANTS = [
  { space: 'discrete', time: 'discrete' },
  { space: 'discrete', time: 'continuous' },
  { space: 'continuous', time: 'discrete' },
  { space: 'continuous', time: 'continuous' },
];

// ── Every quadrant runs a full game to a real result ────────────────────────────

for (const q of QUADRANTS) {
  for (const play of ['sequential', 'simultaneous']) {
    test(`csmini plays to completion: ${q.space} space / ${q.time} time / ${play}`, async () => {
      const engine = new GameEngine(CsMiniGame, players(), { maxTurns: 60, fogOfWar: true, ...q, play });
      const { result, finalState } = await engine.run();
      assert.ok(result, 'game produced a result');
      assert.ok(['win', 'draw'].includes(result.outcome));
      // Someone actually moved/fought — units aren't all sitting on spawn.
      assert.ok(finalState.turnNumber > 1, 'more than one turn elapsed');
    });
  }
}

// ── Quadrant-specific semantics from the SINGLE spec ─────────────────────────────

test('discrete/discrete: a step spends one second and one move square (native)', () => {
  const s = init({ space: 'discrete', time: 'discrete' });
  assert.deepEqual(u(s, 'CT-1').perTurn, { time: 5, moveLeft: 3 });
  const s2 = apply(s, 'ct', { type: 'move', unitId: 'CT-1', from: { x: 0, y: 1 }, to: { x: 1, y: 1 } });
  assert.equal(u(s2, 'CT-1').perTurn.time, 4);
  assert.equal(u(s2, 'CT-1').perTurn.moveLeft, 2);
});

test('continuous space / discrete time: one move goes multiple cells at once', () => {
  const s = init({ space: 'continuous', time: 'discrete' });
  // Move budget is the SPEED distance (3), spent as real distance in one action.
  assert.equal(u(s, 'CT-1').perTurn.moveLeft, 3);
  const moves = legal(s, 'ct').filter(a => a.type === 'move' && a.unitId === 'CT-1');
  assert.ok(moves.length > 0, 'continuous destinations enumerated');
  // Some destination is more than one cell away (a lattice point, not a neighbour).
  assert.ok(moves.some(m => Math.hypot(m.to.x - 0, m.to.y - 1) > 1.5), 'reaches beyond an adjacent cell');
  const far = moves.reduce((b, m) => Math.hypot(m.to.x, m.to.y - 1) > Math.hypot(b.to.x, b.to.y - 1) ? m : b);
  const s2 = apply(s, 'ct', far);
  const spent = Math.hypot(far.to.x - 0, far.to.y - 1);
  assert.ok(Math.abs(u(s2, 'CT-1').perTurn.moveLeft - (3 - spent)) < 1e-9, 'moveLeft spent by real distance');
});

test('discrete space / continuous time: a step costs a cooldown = 1/SPEED of the window', () => {
  const s = init({ space: 'discrete', time: 'continuous' });
  // Continuous time gives the whole turn window (turnDuration = 5) and no cell cap.
  assert.equal(u(s, 'CT-1').perTurn.time, 5);
  assert.equal(u(s, 'CT-1').perTurn.moveLeft, Infinity);
  const s2 = apply(s, 'ct', { type: 'move', unitId: 'CT-1', from: { x: 0, y: 1 }, to: { x: 1, y: 1 } });
  // A one-cell step (dist 1) at SPEED 3, window 5 → cooldown 5/3.
  assert.ok(Math.abs(u(s2, 'CT-1').perTurn.time - (5 - 5 / 3)) < 1e-9);
});

test('continuous time: double speed → half the cooldown (twice the steps)', () => {
  const base = init({ space: 'discrete', time: 'continuous' });
  const fast = { ...base, units: base.units.map(x => x.id === 'CT-1' ? { ...x, speedMul: 2 } : x) };
  const move = { type: 'move', unitId: 'CT-1', to: { x: 1, y: 1 } };
  const dSlow = CsMiniGame.getActionDuration(base, move); // SPEED 3 → 5/3
  const dFast = CsMiniGame.getActionDuration(fast, move); // SPEED 6 → 5/6
  assert.ok(Math.abs(dSlow - 5 / 3) < 1e-9);
  assert.ok(Math.abs(dFast - dSlow / 2) < 1e-9, 'double speed halves the cooldown');
});

test('continuous space / discrete time: reach scales with the move budget', () => {
  // In this quadrant the per-turn budget (moveLeft) IS the range, so a unit with
  // twice the budget (double speed → double range) reaches strictly farther.
  const base = init({ space: 'continuous', time: 'discrete' });
  const withBudget = (b) => ({ ...base, units: base.units.map(x => x.id === 'CT-1' ? { ...x, perTurn: { ...x.perTurn, moveLeft: b } } : x) });
  const reach = (s) => Math.max(...CsMiniGame.getLegalActions(s, 'ct')
    .filter(a => a.type === 'move' && a.unitId === 'CT-1')
    .map(a => Math.hypot(a.to.x - 0, a.to.y - 1)));
  assert.ok(reach(withBudget(6)) > reach(withBudget(3)) + 1, 'a bigger budget reaches farther');
});

test('discrete time: a unit gets a per-turn budget of SPEED move-cells', () => {
  // The single spec number read as a discrete-time budget (spacetime.moveBudget).
  const s = init({ space: 'discrete', time: 'discrete' });
  assert.equal(u(s, 'CT-1').perTurn.moveLeft, 3);
});

test('getActionDuration: end-turn is free, a shot is one tick', () => {
  const s = init({ time: 'continuous' });
  assert.equal(CsMiniGame.getActionDuration(s, { type: 'end-turn' }), 0);
  assert.equal(CsMiniGame.getActionDuration(s, { type: 'shoot', unitId: 'CT-1', targetId: 'T-1' }), 1);
});
