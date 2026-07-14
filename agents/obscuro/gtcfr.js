// ---------------------------------------------------------------------------
// One-sided GT-CFR — the tree-growth half of Obscuro (Zhang & Sandholm 2026,
// §3.3 / App. C.4), the companion to the PCFR+ solver in infoset.js.
//
// Growing-tree CFR interleaves two jobs: SOLVE the current tree (runCFR) and
// EXPAND it toward the parts that matter. The paper's variant is *one-sided*:
// only one (alternating) "exploring" player perturbs its strategy; the other
// plays its current CFR strategy. Nodes neither player reaches are never
// expanded — which is what keeps the tree small without common-knowledge
// enumeration. Expansion descends by a PUCT-balanced strategy, then evaluates a
// leaf's children in one batched `evalChildren` call (chess = one Stockfish
// MultiPV call) and seeds the new infoset's minimizer to the best child.
//
// This module also builds the tree: makeLeaf / expandNode / expandRoot.
// ---------------------------------------------------------------------------

import { Node, Infoset } from './infoset.js';

// Wrap a concrete state as a leaf node: terminal (with its result value) or a
// heuristic-valued frontier node awaiting expansion.
export function makeLeaf(hooks, state) {
  const tv = hooks.terminalValue(state);
  if (tv !== null) return new Node(state, null, tv, true);
  const player = state.activePlayers?.[0] ?? null;
  return new Node(state, player, hooks.heuristicFor(state, hooks.me), false);
}

// A chance node over a transition's stochastic outcomes: its children are
// frontier leaves (each expandable), its own value the prob-weighted average.
function makeChanceNode(hooks, state, outcomes) {
  const cn = new Node(state, null, 0, false);
  cn.chance = true;
  cn.expanded = true;
  cn.chanceChildren = outcomes.map(o => ({ node: makeLeaf(hooks, o.state), prob: o.prob }));
  let v = 0; for (const oc of cn.chanceChildren) v += oc.prob * oc.node.leafValue;
  cn.leafValue = v;
  return cn;
}

function getOrCreateInfoset(tree, hooks, node) {
  const p = node.player;
  const key = hooks.obsKey(node.state, p);
  let I = tree.infosets.get(key);
  if (!I) {
    const acts = hooks.legal(node.state, p);
    I = new Infoset(key, p, acts, acts.map(hooks.key));
    tree.infosets.set(key, I);
    warmStartInfoset(tree, I);
  }
  return I;
}

// KLUSS blueprint reuse (Zhang & Sandholm 2026, §3.1 / App. C.6): the previous
// move's solved strategy is the blueprint. When a new infoset matches one the
// blueprint already solved (same observation → same key, same action set), we
// warm-start its predictive-CFR+ minimizer from the blueprint's regrets and
// value estimates instead of from scratch. PCFR+'s guarantees are init-agnostic
// (App. C.5), so this is safe and, on continued lines, dramatically faster —
// which is exactly the "carry the partial tree Γ̂ across moves" idea.
export function warmStartInfoset(tree, I) {
  const bp = tree.blueprint?.get(I.key);
  if (!bp || bp.actions.length !== I.actions.length) return;
  for (let k = 0; k < I.actions.length; k++) if (bp.actionKeys[k] !== I.actionKeys[k]) return;
  I.rm.q.set(bp.rm.q);
  I.rm.pred.set(bp.rm.pred);
  I.rm.avg.set(bp.rm.avg);
  I.rm.iters = bp.rm.iters;
  I.uCond.set(bp.uCond);
  I._seeded = true; // don't re-seed to a pure best child; keep the blueprint
  tree.blueprintHits = (tree.blueprintHits ?? 0) + 1;
}

// Expand a frontier node: create its children, evaluate them (batched), attach it
// to its infoset, and initialise a brand-new infoset's minimizer to the best
// child (App. C.5, avoids the max→average value lurch when an infoset is born).
//
// `forceInfoset` overrides the observation-derived infoset. The root worlds are
// BY CONSTRUCTION in the searcher's one true infoset, but recomputing the
// observation inside a sampled world can differ from the real observation
// (imagined hidden pieces change blocking/visibility), which used to scatter
// the root worlds across singleton infosets — the search then purified a root
// strategy supported by only the world(s) whose recomputed key happened to
// match, i.e. it was effectively a single-world search.
export async function expandNode(tree, hooks, node, forceInfoset = null) {
  if (node.expanded || node.terminal) return;
  const p = node.player;
  const myLegal = hooks.legal(node.state, p);
  // A node with no legal moves is a leaf: keep its heuristic value rather than
  // expanding into an empty infoset (whose value would collapse to 0).
  if (!myLegal || myLegal.length === 0) { node.terminal = true; return; }
  const I = forceInfoset ?? getOrCreateInfoset(tree, hooks, node);
  const K = I.actions.length;
  const myKeys = new Set(myLegal.map(hooks.key));

  const children = new Array(K).fill(null);
  const childStates = new Array(K).fill(null);
  const evalIdx = [];
  for (let k = 0; k < K; k++) {
    if (!myKeys.has(I.actionKeys[k])) continue;      // action illegal in this world
    const cs = hooks.apply(node.state, p, I.actions[k]);
    if (cs == null) continue;
    // Optional chance node: if the game exposes stochastic outcomes for this
    // transition, the child is a chance node over them (inert for the games —
    // like FoW chess — that don't provide getChanceOutcomes).
    const outcomes = hooks.chanceOutcomes ? hooks.chanceOutcomes(node.state, p, I.actions[k]) : null;
    if (outcomes && outcomes.length > 1) {
      children[k] = makeChanceNode(hooks, cs, outcomes);
      continue;
    }
    childStates[k] = cs;
    const tv = hooks.terminalValue(cs);
    if (tv !== null) children[k] = new Node(cs, null, tv, true); // terminal child
    else evalIdx.push(k);
  }

  if (evalIdx.length) {
    // Batched node heuristic: value to the mover `p` of each non-terminal child.
    const vals = await hooks.evalChildren(
      node.state, p, evalIdx.map(k => I.actions[k]), evalIdx.map(k => childStates[k]),
    );
    for (let j = 0; j < evalIdx.length; j++) {
      const k = evalIdx[j];
      const vMover = vals?.[j];
      const vMe = p === hooks.me ? vMover : -vMover; // convert to the max player's view
      const cs = childStates[k];
      children[k] = new Node(cs, cs.activePlayers?.[0] ?? null,
        Number.isFinite(vMe) ? vMe : hooks.heuristicFor(cs, hooks.me), false);
    }
  }

  node.children = children;
  node.infoset = I;
  node.expanded = true;
  node.fresh = true;
  I.nodes.push(node);

  if (!I._seeded) {
    // Seed the minimizer to the mover's best child.
    let best = -1, bestV = -Infinity;
    for (let k = 0; k < K; k++) {
      const c = children[k];
      if (!c) continue;
      const pv = p === hooks.me ? c.leafValue : -c.leafValue;
      if (pv > bestV) { bestV = pv; best = k; }
    }
    if (best >= 0) I.rm.seed(best);
    I._seeded = true;
  }
}

// Expand every sampled root world (they share the searcher's root infoset) so
// there is a strategy to decide at from the very first CFR iteration.
//
// This loop runs BEFORE the round loop's time budget kicks in, so on games with
// a huge root action set (e.g. a continuous-lattice game like CS, where a single
// infoset can hold hundreds of move/throw points per unit) expanding every one
// of up to ~48 belief worlds here can itself run long past the intended budget.
// `deadline` (a Date.now()-comparable timestamp) bounds that: once it passes,
// remaining worlds are left unexpanded and fall back to their heuristic leaf
// value everywhere they're read (evalNode/cfrDescend both do this already).
// The FIRST world always gets expanded regardless, since it seeds the shared
// root infoset that every other world (and the rest of the search) needs.
export async function expandRoot(tree, hooks, opts = {}) {
  const deadline = opts.deadline ?? Infinity;
  if (!tree.worlds.length) { tree.rootInfoset = null; return; }
  // Every root world shares the searcher's ONE real infoset (they were sampled
  // from it), so they are forced into a single shared infoset rather than
  // re-keyed per world (see expandNode). Prefer the infoset pinned by the
  // caller (runObscuroSearch pins the true legal action set); otherwise create
  // it from the first world.
  let rootI = tree.infosets.get(hooks.obsKey(tree.worlds[0].node.state, hooks.me)) ?? null;
  // Guarantee a floor of expanded root worlds even past the deadline: a root
  // world that misses expansion contributes NOTHING this move (cfrDescend skips
  // unexpanded nodes), and on a cold engine cache the per-world leaf evaluation
  // can eat the whole budget after only a world or two — silently degrading the
  // search to a near-single-world one. Eight worlds bounds the overrun to a few
  // engine calls while keeping the belief genuinely multi-world.
  const minWorlds = Math.min(opts.minWorlds ?? 8, tree.worlds.length);
  for (let i = 0; i < tree.worlds.length; i++) {
    if (i >= minWorlds && Date.now() > deadline) break;
    const node = tree.worlds[i].node;
    await expandNode(tree, hooks, node, rootI);
    if (!rootI) rootI = node.infoset; // first world created it
  }
  tree.rootInfoset = rootI;
}

// The exploring player's perturbed strategy at I: ½ uniform-over-support (xMax)
// + ½ PUCT-argmax, exactly as App. C.4.
function expansionStrategy(I) {
  const K = I.actions.length;
  const strat = I.strat;
  const out = new Float64Array(K);
  let ns = 0;
  for (let k = 0; k < K; k++) if (strat[k] > 0) ns++;
  const supP = ns > 0 ? 0.5 / ns : 0.5 / K;
  let best = 0, bestQ = -Infinity;
  const sqrtN = Math.sqrt(Math.max(1, I.N));
  for (let k = 0; k < K; k++) {
    const q = I.uCond[k] + I.stddev(k) * sqrtN / (1 + I.Na[k]); // Q̄, C = 1
    if (q > bestQ) { bestQ = q; best = k; }
  }
  for (let k = 0; k < K; k++) out[k] = (ns > 0 ? (strat[k] > 0 ? supP : 0) : supP);
  out[best] += 0.5;
  return out;
}

// Root sampling for an expansion descent (paper Fig. 12 lines 7/14–18): the
// descent starts at the GADGET root, where the opponent selects the infoset
// class J — with its current gadget reach π_▼(J) when it is the non-exploring
// player, or an exploration mix (½ uniform over classes + ½ ∝ π_▼) when it is
// the exploring player — and chance then picks a world within J ∝ its weight.
// Without this the expander sampled worlds by prior belief mass, so the tree
// never grew toward the classes the gadget's opponent actually plays into.
function sampleWorld(tree, rng, exploringIsOpp) {
  const g = tree.gadget;
  if (g && g.J.length) {
    const J = g.J;
    let tot = 0;
    const wts = new Array(J.length);
    for (let i = 0; i < J.length; i++) {
      const piv = J[i].piv ?? J[i].mass;
      wts[i] = exploringIsOpp ? 0.5 / J.length + 0.5 * piv : piv;
      tot += wts[i];
    }
    if (tot > 0) {
      let r = rng() * tot, cls = J[J.length - 1];
      for (let i = 0; i < J.length; i++) { r -= wts[i]; if (r <= 0) { cls = J[i]; break; } }
      let cw = 0; for (const w of cls.worlds) cw += w.cw;
      let rr = rng() * (cw || 1);
      for (const w of cls.worlds) { rr -= w.cw; if (rr <= 0) return w.node; }
      return cls.worlds[cls.worlds.length - 1].node;
    }
  }
  let tot = 0; for (const w of tree.worlds) tot += w.prob;
  let r = rng() * tot;
  for (const w of tree.worlds) { r -= w.prob; if (r <= 0) return w.node; }
  return tree.worlds[tree.worlds.length - 1].node;
}

// Pick an action index whose child exists, ∝ the given expansion probabilities.
function sampleAvailable(node, pi, rng) {
  const K = pi.length;
  let tot = 0;
  for (let k = 0; k < K; k++) if (node.children[k]) tot += pi[k];
  if (tot <= 0) {
    const avail = [];
    for (let k = 0; k < K; k++) if (node.children[k]) avail.push(k);
    return avail.length ? avail[Math.floor(rng() * avail.length)] : -1;
  }
  let r = rng() * tot;
  for (let k = 0; k < K; k++) { if (!node.children[k]) continue; r -= pi[k]; if (r <= 0) return k; }
  for (let k = K - 1; k >= 0; k--) if (node.children[k]) return k;
  return -1;
}

// One GT-CFR expansion step for the given exploring player: descend from a
// sampled world to a frontier leaf and expand it.
export async function doExpansionStep(tree, hooks, exploringPlayer, rng) {
  if (!tree.worlds.length) return;
  let node = sampleWorld(tree, rng, exploringPlayer !== hooks.me);
  while (node.expanded) {
    if (node.chance) { // descend through a chance node by sampling an outcome
      let r = rng(), acc = 0, picked = node.chanceChildren[0].node;
      for (const oc of node.chanceChildren) { acc += oc.prob; if (r <= acc) { picked = oc.node; break; } }
      node = picked;
      continue;
    }
    if (node.terminal || node.fresh) return; // nothing to expand along this line yet
    const I = node.infoset;
    const exploring = node.player === exploringPlayer;
    const pi = exploring ? expansionStrategy(I) : I.strat;
    const k = sampleAvailable(node, pi, rng);
    if (k < 0) return;
    if (exploring) { I.N++; I.Na[k]++; I.addValueSample(k, I.uCond[k]); }
    node = node.children[k];
    if (node == null) return;
  }
  if (node.terminal) return;
  // A root world expanded lazily (past the expandRoot deadline floor) must still
  // join the shared root infoset, not re-derive a fragmented per-world key.
  await expandNode(tree, hooks, node, node.rootWorld ? tree.rootInfoset : null);
}