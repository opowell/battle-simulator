import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RegretMinimizer } from './pcfr.js';
import { Node, Infoset, runCFR } from './infoset.js';
import { purify } from './purify.js';
import { makeHooks, runObscuroSearch } from './search.js';

// ---------------------------------------------------------------------------
// PCFR+ (predictive CFR+), last iterate
// ---------------------------------------------------------------------------

function solveMatrix(M, iters = 3000) {
  const rows = M.length, cols = M[0].length;
  const R = new RegretMinimizer(rows), C = new RegretMinimizer(cols);
  for (let t = 0; t < iters; t++) {
    const sR = R.strategy().slice(), sC = C.strategy().slice();
    const ru = new Float64Array(rows), cu = new Float64Array(cols);
    for (let i = 0; i < rows; i++) { let v = 0; for (let j = 0; j < cols; j++) v += M[i][j] * sC[j]; ru[i] = v; }
    for (let j = 0; j < cols; j++) { let v = 0; for (let i = 0; i < rows; i++) v += (-M[i][j]) * sR[i]; cu[j] = v; }
    R.observe(ru); C.observe(cu);
  }
  return [...R.lastStrategy()];
}

test('pcfr+: RPS converges to uniform on the last iterate', () => {
  const s = solveMatrix([[0, -1, 1], [1, 0, -1], [-1, 1, 0]]);
  for (const p of s) assert.ok(Math.abs(p - 1 / 3) < 0.02, `expected ~1/3, got ${p}`);
});

test('pcfr+: a dominant row is played purely (last iterate)', () => {
  const s = solveMatrix([[3, 2], [1, 0]]);
  assert.ok(s[0] > 0.99, `dominant row should be pure, got ${s[0]}`);
});

// ---------------------------------------------------------------------------
// Tree CFR with shared information sets
// ---------------------------------------------------------------------------

const leaf = v => new Node('t', null, v, true);
function internal(player, infoset, children) {
  const n = new Node('s', player, 0, false);
  n.infoset = infoset; n.children = children; n.expanded = true; infoset.nodes.push(n); return n;
}

test('tree-cfr: matching pennies (shared opponent infoset) is uniform', () => {
  const Ime = new Infoset('me', 'me', ['H', 'T'], ['H', 'T']);
  const Iopp = new Infoset('opp', 'opp', ['h', 't'], ['h', 't']);
  internal('opp', Iopp, [leaf(+1), leaf(-1)]);
  internal('opp', Iopp, [leaf(-1), leaf(+1)]);
  const root = internal('me', Ime, [Iopp.nodes[0], Iopp.nodes[1]]);
  runCFR({ me: 'me', worlds: [{ node: root, prob: 1 }], infosets: new Map([['me', Ime], ['opp', Iopp]]) }, 4000);
  for (const p of Ime.rm.lastStrategy()) assert.ok(Math.abs(p - 0.5) < 0.02, `expected 0.5, got ${p}`);
});

test('tree-cfr: perfect-info minimax picks the max-of-min branch', () => {
  const Ime = new Infoset('me', 'me', ['A', 'B'], ['A', 'B']);
  const IoppA = new Infoset('oppA', 'opp', ['a1', 'a2'], ['a1', 'a2']);
  const IoppB = new Infoset('oppB', 'opp', ['b1', 'b2'], ['b1', 'b2']);
  const nA = internal('opp', IoppA, [leaf(+3), leaf(-1)]); // min -1
  const nB = internal('opp', IoppB, [leaf(+2), leaf(+1)]); // min +1
  const root = internal('me', Ime, [nA, nB]);
  runCFR({ me: 'me', worlds: [{ node: root, prob: 1 }], infosets: new Map([['me', Ime], ['oppA', IoppA], ['oppB', IoppB]]) }, 4000);
  const s = Ime.rm.lastStrategy();
  assert.ok(s[1] > 0.98, `should pick B (min +1 > min -1), got ${[...s]}`);
});

test('tree-cfr: belief root avoids a move refuted in a minority of worlds', () => {
  const Ime = new Infoset('me', 'me', ['X', 'Y'], ['X', 'Y']);
  const mk = (v) => { const I = new Infoset('o' + Math.random(), 'opp', ['p'], ['p']); return internal('opp', I, [leaf(v)]); };
  const rootA = internal('me', Ime, [mk(0), mk(0)]);       // safe world
  const rootB = internal('me', Ime, [mk(-1), mk(0)]);      // X is refuted here
  const infs = new Map([['me', Ime]]);
  for (const w of [rootA, rootB]) for (const c of w.children) infs.set(c.infoset.key, c.infoset);
  runCFR({ me: 'me', worlds: [{ node: rootA, prob: 0.5 }, { node: rootB, prob: 0.5 }], infosets: infs }, 4000);
  const s = Ime.rm.lastStrategy();
  assert.ok(s[1] > s[0], `should lean to safe move Y, got X=${s[0].toFixed(2)} Y=${s[1].toFixed(2)}`);
});

// ---------------------------------------------------------------------------
// Full growing-tree search + purification + blueprint reuse
// ---------------------------------------------------------------------------

const numberGame = (maxPlies = 6) => ({
  getLegalActions: () => [{ type: 'add', delta: -1 }, { type: 'add', delta: 0 }, { type: 'add', delta: 1 }],
  applyActions: (s, [{ action }]) => ({ ...s, value: s.value + action.delta, turnNumber: s.turnNumber + 1, activePlayers: [s.activePlayers[0] === 'A' ? 'B' : 'A'] }),
  getResult: (s) => s.turnNumber >= maxPlies ? { outcome: s.value === 0 ? 'draw' : 'win', winnerId: s.value > 0 ? 'A' : 'B' } : null,
  evaluateState: (s, p) => (p === 'A' ? s.value : -s.value),
  actionKey: (a) => 'd' + a.delta,
});
const start = () => ({ value: 0, turnNumber: 0, activePlayers: ['A'], players: [{ id: 'A' }, { id: 'B' }] });

test('search: the maximiser plays +1 in the number game', async () => {
  const hooks = makeHooks(numberGame(), 'A');
  const res = await runObscuroSearch(hooks, [start()], { opp: 'B', maxRounds: 40, expandPerRound: 10, cfrPerRound: 5, purifyMax: 1, rng: () => 0.5 });
  assert.equal(res.action.delta, 1);
});

test('search: blueprint warm-start reuses infosets and preserves the move', async () => {
  const hooks = makeHooks(numberGame(), 'A');
  const cfg = { opp: 'B', maxRounds: 40, expandPerRound: 10, cfrPerRound: 5, purifyMax: 1, rng: () => 0.5 };
  const cold = await runObscuroSearch(hooks, [start()], cfg);
  const warm = await runObscuroSearch(hooks, [start()], { ...cfg, blueprint: cold.tree.infosets });
  assert.ok(warm.tree.blueprintHits > 5, `expected blueprint reuse, got ${warm.tree.blueprintHits} hits`);
  assert.equal(cold.action.delta, warm.action.delta);
});

// ---------------------------------------------------------------------------
// Purification: the safety gate and stability filter
// ---------------------------------------------------------------------------

test('purify: unsafe / perfect-info play is pure', () => {
  const acts = ['a', 'b', 'c'];
  const { action, dist } = purify([0.5, 0.3, 0.2], acts, { safe: false, rng: () => 0 });
  assert.equal(action, 'a');
  assert.deepEqual(dist, [1, 0, 0]);
});

test('purify: a dominant action is pure even when mixing is allowed', () => {
  const { dist } = purify([0.95, 0.03, 0.02], ['a', 'b', 'c'], { safe: true, rng: () => 0 });
  assert.deepEqual(dist, [1, 0, 0]);
});

test('purify: excludes an unstable runner-up from the mix', () => {
  const acts = ['a', 'b', 'c'];
  // b has real mass but is not stable → dropped; play stays pure on a.
  const I = { stableSince: [true, false, true] };
  const { dist } = purify([0.5, 0.4, 0.02], acts, { safe: true, infoset: I, rng: () => 0 });
  assert.ok(dist[1] === 0, 'unstable b must be excluded');
});
