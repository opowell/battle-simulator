// Tests for the generic player-level move queue (games/planQueue.js), driven by a
// toy game rather than chess, so what is being tested is the mechanic and not any
// one game's move rules. (Chess's own wiring is games/chess/plan.test.js.)

import { test } from 'node:test';
import assert from 'node:assert';

import { planPosition, planFrontier, buildPlan, afterMove, pruneForTurn, MAX_PLAN } from './planQueue.js';

// A one-dimensional game: each player has a token on a numbered line and may step
// it one place either way, but never onto the other player's token.
const startState = (a = 0, b = 5) => ({ pos: { p1: a, p2: b } });
const other = (p) => (p === 'p1' ? 'p2' : 'p1');

const ADAPTER = {
  baseActions(state, playerId) {
    return [-1, 1]
      .map((d) => ({ from: state.pos[playerId], to: state.pos[playerId] + d }))
      .filter((m) => m.to >= 0 && m.to <= 9 && m.to !== state.pos[other(playerId)]);
  },
  applyOne(state, playerId, action) {
    return { pos: { ...state.pos, [playerId]: action.to } };
  },
  sameMove: (a, b) => a.from === b.from && a.to === b.to,
};

const step = (from, to) => ({ from, to });

test('a plan is folded onto the position with the opponent standing still', () => {
  const s = startState(0, 9);
  const plan = buildPlan(s, 'p1', [step(0, 1), step(1, 2)], ADAPTER);
  assert.deepEqual(plan.map((m) => m.to), [1, 2]);
  const at = planPosition(s, 'p1', plan, ADAPTER);
  assert.deepEqual(at.pos, { p1: 2, p2: 9 }, 'the planner moved twice; nobody else moved at all');
});

test('the frontier is the legal moves of the position the plan leaves behind', () => {
  const s = startState(0, 9);
  assert.deepEqual(planFrontier(s, 'p1', [], ADAPTER).map((m) => m.to), [1]);   // 0 → can only go up
  const plan = buildPlan(s, 'p1', [step(0, 1)], ADAPTER);
  assert.deepEqual(planFrontier(s, 'p1', plan, ADAPTER).map((m) => m.to), [0, 2]);
});

test('a plan is validated whole, and a bad move takes the whole thing down with it', () => {
  const s = startState(0, 9);
  assert.throws(
    () => buildPlan(s, 'p1', [step(0, 1), step(1, 5)], ADAPTER),
    /not legal at that point in the plan/,
  );
  // …including one that would be legal NOW but not once the plan has run.
  assert.throws(() => buildPlan(s, 'p1', [step(0, 1), step(0, 1)], ADAPTER), /not legal/);
});

test('a plan is capped', () => {
  const s = startState(0, 9);
  const long = Array.from({ length: MAX_PLAN + 1 }, (_, i) => step(i, i + 1));
  assert.throws(() => buildPlan(s, 'p1', long, ADAPTER), /at most/);
  assert.deepEqual(planFrontier(s, 'p1', long.slice(0, MAX_PLAN), ADAPTER), [],
    'a full plan has no frontier left');
});

test('playing the head advances the plan; playing anything else abandons it', () => {
  const plan = [step(0, 1), step(1, 2)];
  assert.deepEqual(afterMove(plan, step(0, 1), ADAPTER.sameMove).map((m) => m.to), [2]);
  assert.deepEqual(afterMove(plan, step(0, -1), ADAPTER.sameMove), [],
    'everything behind the head was reasoned from a position the player just declined');
  assert.deepEqual(afterMove([], step(0, 1), ADAPTER.sameMove), []);
});

test('a plan survives the turn only while its head is still legal', () => {
  const plan = [step(4, 5)];
  assert.deepEqual(pruneForTurn(startState(4, 9), 'p1', plan, ADAPTER), plan);
  // The opponent has stepped onto the square the plan needs.
  assert.deepEqual(pruneForTurn(startState(4, 5), 'p1', plan, ADAPTER), []);
});

test('a plan that has gone stale has no position and no frontier', () => {
  const plan = [step(4, 5)];
  assert.equal(planPosition(startState(4, 5), 'p1', plan, ADAPTER), null);
  assert.deepEqual(planFrontier(startState(4, 5), 'p1', plan, ADAPTER), []);
});
