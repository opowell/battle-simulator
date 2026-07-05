// ---------------------------------------------------------------------------
// KLUSS gadget — knowledge-limited unfrozen subgame solving with the
// Resolve/Maxmargin safety gadget (Zhang & Sandholm 2026, §3.1 / App. B.2, C.1–3;
// Fig. 9–10). This is the safety machinery that sits above the growing tree.
//
// The belief worlds are partitioned by the OPPONENT's observation into infoset
// classes J — the order-2 knowledge set (each world is order-1 for us, and the
// opponent's view of it is one step of knowledge further). This partition IS the
// knowledge-limited subgame root: instead of a flat uniform chance node over
// worlds, the opponent (▼) first chooses, at the gadget root, which J it is in
// (Maxmargin) or whether to enter/exit each J for a fixed ALTERNATE VALUE
// (Resolve). The alternate value bounds how much we may exploit the opponent at
// J to what a blueprint-following opponent could already have conceded, so the
// solved strategy cannot become much more exploitable than the blueprint —
// exactly the point of safe subgame solving.
//
// Signs: every value is to the max player `me`; ▼ minimises it (maximises −value).
// Because each J is a *root* choice with no preceding opponent action, the
// reach-gift ĝ(J) is legitimately zero here (gifts come from opponent mistakes in
// *reaching* J), so the alternate value is exactly Σ cw·min(ṽ, v*).
// ---------------------------------------------------------------------------

import { RegretMinimizer } from './pcfr.js';
import { freezeStrategies, observeAll, cfrDescend, evalNode } from './infoset.js';

// Partition the belief worlds by opponent observation and build the gadget:
// per-class enter/exit minimizers (Resolve), a Maxmargin selector, a non-uniform
// prior α(J), and the alternate value for each class.
export function buildGadget(tree, hooks, cfg = {}) {
  const me = tree.me;
  const opp = cfg.opp ?? null;
  const vStar = cfg.prevValue ?? Infinity; // previous search value v*; no clamp on move 1

  const groups = new Map();
  tree.worlds.forEach((w, i) => {
    const key = opp != null ? hooks.obsKey(w.node.state, opp) : 'J' + i;
    let g = groups.get(key);
    if (!g) { g = { key, worlds: [], mass: 0 }; groups.set(key, g); }
    g.worlds.push(w);
    g.mass += w.prob;
  });

  const J = [...groups.values()];
  const m = J.length;
  let ySum = 0;
  for (const g of J) {
    // Within-class chance weights: h ∈ J chosen ∝ our reach π_{-▼}(h) (≈ belief mass).
    for (const w of g.worlds) w.cw = w.prob / (g.mass || 1);
    // Alternate value to me if ▼ exits at J: don't assume better than the leaf
    // heuristic ṽ(s) or the previous search value v* (Fig. 9 line 14).
    let alt = 0;
    for (const w of g.worlds) alt += w.cw * Math.min(hooks.heuristicFor(w.node.state, me), vStar);
    g.altMe = alt;
    g.R = new RegretMinimizer(2); // [enter, exit]
    g.y = g.mass;                  // blueprint opponent reach to J (≈ belief mass)
    ySum += g.y;
  }
  // Non-uniform Resolve prior: even mix of the blueprint opponent distribution
  // and uniform, so likely worlds get more weight but all keep positive weight.
  for (const g of J) g.alpha = 0.5 * (g.y / (ySum || 1) + 1 / m);

  return { J, m, opp, maxmargin: new RegretMinimizer(m), pmax: 0 };
}

// One gadget-aware CFR iteration: price each J (enter vs exit), update the
// Resolve enter/exit minimizers and the Maxmargin selector, blend them into the
// opponent's root reach π_▼(J) (Fig. 10 line 12), then accumulate the tree's
// regrets with that reach.
export function runGadgetCFR(tree, hooks, gadget, iterations) {
  const infosets = [...tree.infosets.values()];
  const me = tree.me;
  const { J, maxmargin } = gadget;
  for (let t = 0; t < iterations; t++) {
    freezeStrategies(infosets);

    // Price each opponent-infoset class under the current tree strategies.
    for (const g of J) {
      let e = 0;
      for (const w of g.worlds) e += w.cw * evalNode(w.node, me);
      g.enterMe = e;
    }

    // Resolve: each class independently decides enter vs exit. ▼ maximises −me.
    let pmax = 0;
    for (const g of J) {
      const s = g.R.strategy();
      g.pEnter = s[0];
      g.R.observe([-g.enterMe, -g.altMe]); // [enter, exit] utilities to ▼
      if (g.pEnter > pmax) pmax = g.pEnter;
    }

    // Maxmargin: ▼ picks the class with the smallest margin (worst for me).
    const smm = maxmargin.strategy().slice();
    maxmargin.observe(J.map(g => g.altMe - g.enterMe)); // utility to ▼ = −margin

    // Blend Resolve and Maxmargin into the opponent's root reach (Fig. 10 l.12).
    // (Σ π_▼ need not equal 1 when Resolve is entering — that is expected.)
    for (let i = 0; i < J.length; i++) {
      const g = J[i];
      g.piv = pmax * g.alpha * g.pEnter + (1 - pmax) * smm[i];
    }

    // Accumulate tree regrets with reachOpp = π_▼(J) · (within-class chance).
    for (const g of J) for (const w of g.worlds) cfrDescend(w.node, me, 1, g.piv * w.cw);

    observeAll(infosets);
    gadget.pmax = pmax;
  }
}
