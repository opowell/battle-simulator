// ---------------------------------------------------------------------------
// Extensive-form game tree with shared information sets — the data structure the
// Obscuro search grows and solves (Zhang & Sandholm 2026, §3 / App. B–C).
//
// Unlike the old normal-form matrix, this is the paper's actual object: a tree of
// concrete game states (histories), where nodes indistinguishable to the acting
// player are grouped into a single INFOSET carrying one strategy. That grouping
// is what encodes imperfect information — at the root, every sampled world shares
// the searcher's observation and so lives in one infoset (the belief), while the
// opponent's nodes partition by *their* observation. A player picks one mixed
// action per infoset, applied to all member worlds at once, which is exactly what
// forces bluffing / mixed play under fog.
//
// This module owns the structures (Node, Infoset) and the CFR value-propagation
// pass (runCFR). Tree GROWTH lives in gtcfr.js; subgame CONSTRUCTION in kluss.js.
// The per-infoset local solver is the predictive CFR+ minimizer from pcfr.js.
// ---------------------------------------------------------------------------

import { RegretMinimizer } from './pcfr.js';

// A stable, order-independent serialization of a player's observation, used as
// the infoset key: two states with the same key are indistinguishable to that
// player (the Markov sufficient-statistic stand-in for the full observation
// sequence — sound for games, like FoW chess, whose current observation
// determines legal moves). Falls back to the whole state when a game has no
// getVisibleState (perfect information → every node is its own singleton).
//
// The key is scoped by (player, turnNumber): the same visible board reached at
// different plies is NOT the same information state (different history length
// is itself observable), and merging across plies let far-apart tree layers
// share one strategy. turnNumber is absolute game time, so blueprint keys stay
// stable across successive searches (KLUSS warm-start still matches). Merging
// different HISTORIES that produce the same observation at the same ply remains
// a deliberate abstraction.
export function observationKey(game, state, player) {
  const obs = game.getVisibleState ? game.getVisibleState(state, player) : state;
  return player + '|' + (state?.turnNumber ?? '') + '|' + canonicalBoardSig(obs?.board ?? obs);
}

// Identity-free serialization of a board-like object: an observation is what
// the player SEES (owner + type per square), never which physical piece it is —
// belief samplers may synthesize piece ids, and two boards that differ only in
// ids are the same information state. Non-board values fall back to a full
// stable stringify.
export function canonicalBoardSig(board) {
  if (!board || typeof board !== 'object' || Array.isArray(board)) return stableStringify(board);
  const parts = [];
  for (const sq of Object.keys(board).sort()) {
    const p = board[sq];
    if (p == null) continue;
    if (typeof p === 'object' && (p.ownerId != null || p.type != null)) {
      parts.push(sq + ':' + (p.ownerId ?? '') + ':' + (p.type ?? ''));
    } else {
      parts.push(sq + ':' + stableStringify(p));
    }
  }
  return parts.join(',');
}

// Chain hash for observation-sequence infoset keys (cyrb53-style, 64-bit-ish):
// seq(child) = chainHash(seq(parent), step). Collision odds are negligible at
// tree scale, and hashing keeps per-node keys O(1) instead of O(path).
export function chainHash(prev, step) {
  const s = prev + '' + step;
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

// One tree node = one concrete game state (history). A leaf (unexpanded or
// terminal) carries `leafValue` (to the max player). An internal node belongs to
// an `infoset` for its acting player and has `children` aligned to that infoset's
// action list (null where an action is illegal in this particular world).
export class Node {
  constructor(state, player, leafValue, terminal) {
    this.state = state;
    this.player = player;       // acting player id, or null if terminal
    this.leafValue = leafValue; // value to the max player (heuristic or terminal)
    this.terminal = !!terminal;
    this.expanded = false;
    this.fresh = true;          // just created; CFR has not iterated on it yet
    this.infoset = null;
    this.children = null;       // Node[] aligned to infoset.actions
  }
}

// An information set: the group of nodes one player cannot tell apart, plus the
// single regret minimizer that plays them and the running statistics one-sided
// GT-CFR uses to decide what to expand (visit counts, action-value estimates).
export class Infoset {
  constructor(key, player, actions, actionKeys) {
    this.key = key;
    this.player = player;
    this.actions = actions;        // canonical A(I): Action[]
    this.actionKeys = actionKeys;  // parallel string keys
    this.rm = new RegretMinimizer(actions.length);
    this.nodes = [];               // member Node[]
    this.strat = this.rm.strategy();
    this.iterUtil = new Float64Array(actions.length); // CFR accumulator (per iter)
    // Conditional action-value estimate u(x,y|I,a), reach-weighted (per iter).
    this.qNum = new Float64Array(actions.length);
    this.visitReach = 0;
    this.uCond = new Float64Array(actions.length);
    // GT-CFR / PUCT expansion statistics (App. C.4). Visit counts N(I), N(I,a),
    // and a Welford running variance of u(x,y|I,a) seeded with two prior samples
    // −1 and +1 (so it is never zero), exactly as the paper prescribes.
    const n = actions.length;
    this.N = 0;                       // times this infoset was visited during expansion
    this.Na = new Float64Array(n);    // times each action was chosen
    this.vCount = new Float64Array(n); // variance: sample count (seeded to 2)
    this.vMean = new Float64Array(n);  // variance: running mean (seeded to 0)
    this.vM2 = new Float64Array(n);    // variance: running Σ(x-mean)² (seeded to 2)
    for (let i = 0; i < n; i++) { this.vCount[i] = 2; this.vMean[i] = 0; this.vM2[i] = 2; }
  }

  // Welford update: fold one observed action value into the variance estimate.
  addValueSample(k, x) {
    this.vCount[k] += 1;
    const d = x - this.vMean[k];
    this.vMean[k] += d / this.vCount[k];
    this.vM2[k] += d * (x - this.vMean[k]);
  }

  stddev(k) { return Math.sqrt(this.vM2[k] / this.vCount[k]); }

  indexOfKey(k) { return this.actionKeys.indexOf(k); }
}

// Freeze every infoset's current strategy and reset its per-iteration CFR
// accumulators. Call once at the start of each CFR iteration, before descending.
export function freezeStrategies(infosets) {
  for (const I of infosets) {
    I.strat = I.rm.strategy();
    I.iterUtil.fill(0);
    I.qNum.fill(0);
    I.visitReach = 0;
  }
}

// Hand each infoset the utilities its descent accumulated and let its predictive
// RM+ minimizer update; refresh the conditional action-value estimate uCond.
export function observeAll(infosets) {
  for (const I of infosets) {
    I.rm.observe(I.iterUtil);
    if (I.visitReach > 0) for (let k = 0; k < I.uCond.length; k++) I.uCond[k] = I.qNum[k] / I.visitReach;
    I.nodes.forEach(n => { n.fresh = false; });
  }
}

// One CFR iteration over the whole tree: freeze each infoset's current strategy,
// propagate counterfactual values from the leaves, then hand each infoset its
// action utilities so its predictive-RM+ minimizer can update. Values are always
// expressed for the max player `me`; the opponent's minimizer maximises `-value`.
// (Flat-root form: worlds are a uniform-ish chance node. The KLUSS gadget in
// kluss.js drives the root layer itself and calls the primitives directly.)
export function runCFR(tree, iterations) {
  const infosets = [...tree.infosets.values()];
  const me = tree.me;
  for (let t = 0; t < iterations; t++) {
    freezeStrategies(infosets);
    for (const w of tree.worlds) cfrDescend(w.node, me, 1, w.prob);
    observeAll(infosets);
  }
}

// Pure value to `me` at `node` under the frozen strategies — no regret
// accumulation. Used by the gadget to price each opponent-infoset root (enter vs
// exit) before it decides the reach with which to accumulate.
export function evalNode(node, me) {
  if (node.chance) {
    let v = 0;
    for (const oc of node.chanceChildren) v += oc.prob * evalNode(oc.node, me);
    return v;
  }
  if (!node.expanded || node.terminal) return node.leafValue;
  const I = node.infoset;
  const s = I.strat;
  let v = 0;
  for (let k = 0; k < I.actions.length; k++) {
    const c = node.children[k];
    v += s[k] * (c ? evalNode(c, me) : node.leafValue);
  }
  return v;
}

// Recursive counterfactual-value pass. Returns the value to `me` at `node` under
// the frozen strategies. reachMe / reachOpp are the players' contributions to
// reaching this node (chance folded into reachOpp).
export function cfrDescend(node, me, reachMe, reachOpp) {
  // Chance node (an optional getChanceOutcomes transition): value is the
  // probability-weighted average of its outcomes; chance reach folds into
  // reachOpp. No regret is accumulated at a chance node.
  if (node.chance) {
    let v = 0;
    for (const oc of node.chanceChildren) v += oc.prob * cfrDescend(oc.node, me, reachMe, reachOpp * oc.prob);
    return v;
  }
  if (!node.expanded || node.terminal) return node.leafValue;
  const I = node.infoset;
  const sigma = I.strat;
  const p = node.player;
  const K = I.actions.length;
  const childVals = new Float64Array(K);
  let nodeVal = 0;
  for (let k = 0; k < K; k++) {
    const child = node.children[k];
    let cv;
    if (child == null) {
      cv = node.leafValue; // action illegal in this world — treat as neutral pass
    } else {
      const rMe = p === me ? reachMe * sigma[k] : reachMe;
      const rOpp = p === me ? reachOpp : reachOpp * sigma[k];
      cv = cfrDescend(child, me, rMe, rOpp);
    }
    childVals[k] = cv;
    nodeVal += sigma[k] * cv;
  }
  // Counterfactual reach = product of everyone-but-the-acting-player.
  const cfReach = p === me ? reachOpp : reachMe;
  const sign = p === me ? 1 : -1;                // acting player's utility sign
  // Full reach π(h): the weight of THIS node inside its infoset. uCond must be
  // the paper's conditional value u(x,y|I,a) (App. B.1) — the expectation over
  // the infoset's nodes weighted by the probability of actually reaching each
  // one, INCLUDING the opponent's (and the KLUSS gadget's) reach. Weighting by
  // the acting player's own reach alone made every belief world count equally
  // at the root, so a catastrophic world the gadget's opponent steers into was
  // averaged away by optimistic ones — the exact king-safety leak.
  const wReach = reachMe * reachOpp;
  for (let k = 0; k < K; k++) {
    I.iterUtil[k] += cfReach * sign * childVals[k];
    I.qNum[k] += wReach * sign * childVals[k];
  }
  I.visitReach += wReach;
  return nodeVal;
}
