// Unit tests for the learned-eval infrastructure (agents/LEARNED-EVAL-PLAN.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MLP } from './mlp.js';
import { encodeState, opponentOf, INPUT_SIZE } from './encoder.js';
import { wireNet } from './leafEval.js';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('mlp: pair-loss gradients match finite differences', () => {
  const rng = mulberry32(3);
  const net = new MLP([5, 8, 1], 11);
  const xa = Float64Array.from({ length: 5 }, () => rng() * 2 - 1);
  const xb = Float64Array.from({ length: 5 }, () => rng() * 2 - 1);
  const z = 0.7;
  const loss = () => { const v = Math.tanh(net.f(xa) - net.f(xb)); return (v - z) ** 2; };

  // Analytic gradient via the training path (capture by zero-lr trick: run the
  // backward manually).
  const gW = net.W.map(w => new Float64Array(w.length));
  const gB = net.b.map(b => new Float64Array(b.length));
  const fa = net.forward(xa), fb = net.forward(xb);
  const v = Math.tanh(fa.out - fb.out);
  const g = 2 * (v - z) * (1 - v * v);
  net._backward(fa.acts, g, gW, gB);
  net._backward(fb.acts, -g, gW, gB);

  const EPS = 1e-6;
  let checked = 0;
  for (const [l, k] of [[0, 3], [0, 17], [1, 2]]) {
    const orig = net.W[l][k];
    net.W[l][k] = orig + EPS; const up = loss();
    net.W[l][k] = orig - EPS; const dn = loss();
    net.W[l][k] = orig;
    const numeric = (up - dn) / (2 * EPS);
    assert.ok(Math.abs(numeric - gW[l][k]) < 1e-5,
      `grad mismatch W[${l}][${k}]: numeric ${numeric} vs analytic ${gW[l][k]}`);
    checked++;
  }
  assert.equal(checked, 3);
});

test('mlp: training reduces loss on a learnable pair task', () => {
  const rng = mulberry32(9);
  const net = new MLP([4, 16, 1], 5);
  // Target: z = tanh(xa[0] − xb[0]).
  const batch = () => Array.from({ length: 64 }, () => {
    const xa = Float64Array.from({ length: 4 }, () => rng() * 2 - 1);
    const xb = Float64Array.from({ length: 4 }, () => rng() * 2 - 1);
    return { xa, xb, z: Math.tanh(xa[0] - xb[0]) };
  });
  const first = net.trainPairs(batch(), 1e-2);
  let last = first;
  for (let i = 0; i < 300; i++) last = net.trainPairs(batch(), 1e-2);
  assert.ok(last < first / 3, `loss should drop: first ${first}, last ${last}`);
});

test('mlp: JSON round-trip preserves outputs', () => {
  const net = new MLP([6, 8, 1], 21);
  const x = Float64Array.from({ length: 6 }, (_, i) => i / 6 - 0.4);
  const clone = MLP.fromJSON(JSON.parse(JSON.stringify(net.toJSON())));
  assert.ok(Math.abs(net.f(x) - clone.f(x)) < 1e-4);
});

const mkState = (units, turn = 5) => ({
  turnNumber: turn,
  players: [{ id: 'p1' }, { id: 'p2' }],
  activePlayers: ['p1'],
  units,
});
const mkUnit = (ownerId, type, x, y, hp = 10, maxHp = 10) =>
  ({ id: `${ownerId}-${type}-${x}${y}`, ownerId, type, position: { x, y }, hp, maxHp, alive: true });

test('encoder: permutation invariance over units', () => {
  const units = [
    mkUnit('p1', 'soldier', 1, 2), mkUnit('p1', 'sniper', 3, 4, 5),
    mkUnit('p2', 'soldier', 6, 6), mkUnit('p2', 'tank', 2, 5, 20, 20),
  ];
  const a = encodeState(null, mkState(units), 'p1');
  const b = encodeState(null, mkState([...units].reverse()), 'p1');
  assert.deepEqual(Array.from(a), Array.from(b));
  assert.equal(a.length, INPUT_SIZE);
});

test('wireNet: evaluateState flips sign between the two sides', () => {
  const net = new MLP([INPUT_SIZE, 8, 1], 33);
  const game = wireNet({ evaluateState: () => 0 }, net);
  const state = mkState([
    mkUnit('p1', 'soldier', 1, 1), mkUnit('p2', 'soldier', 4, 4, 3),
    mkUnit('p2', 'archer', 5, 2),
  ]);
  const v1 = game.evaluateState(state, 'p1');
  const v2 = game.evaluateState(state, 'p2');
  assert.ok(Math.abs(v1 + v2) < 1e-12, `antisymmetry: ${v1} vs ${v2}`);
  assert.ok(v1 >= -1 && v1 <= 1);
  assert.equal(game.winValue, 1);
  assert.equal(opponentOf(state, 'p1'), 'p2');
});

test('wireNet: evaluateLeaves batches child states on the same scale', () => {
  const net = new MLP([INPUT_SIZE, 8, 1], 34);
  const game = wireNet({ evaluateState: () => 0 }, net);
  const s1 = mkState([mkUnit('p1', 'a', 1, 1), mkUnit('p2', 'a', 2, 2)]);
  const s2 = mkState([mkUnit('p1', 'a', 1, 1)]);
  const vals = game.evaluateLeaves(s1, 'p1', [null, null], { childStates: [s1, s2] });
  assert.equal(vals.length, 2);
  for (const v of vals) assert.ok(v >= -1 && v <= 1);
  assert.ok(Math.abs(vals[0] - game.evaluateState(s1, 'p1')) < 1e-12);
});
