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

// ṽ(h): the engine-informed value of a world to `me` — the acting player's best
// child as evaluated at root expansion (= the engine's eval of the position).
// Falls back to the node's own leaf heuristic when the world never expanded.
function bestChildValue(node, me) {
  if (!node.expanded || !node.children || !node.infoset) return node.leafValue;
  const maximising = node.infoset.player === me; // child leafValue is always to `me`
  let best = null;
  for (const c of node.children) {
    if (!c) continue;
    if (best === null || (maximising ? c.leafValue > best : c.leafValue < best)) best = c.leafValue;
  }
  return best ?? node.leafValue;
}

// Partition the belief worlds by opponent observation and build the gadget:
// per-class enter/exit minimizers (Resolve), a Maxmargin selector, a non-uniform
// prior α(J), and the alternate value for each class.
export function buildGadget(tree, hooks, cfg = {}) {
  const me = tree.me;
  const opp = cfg.opp ?? null;
  const vStar = cfg.prevValue ?? Infinity; // previous search value v*; no clamp on move 1

  // Class identity (the opponent's root infoset J), per the paper (Fig. 9):
  //   • a CARRIED world knows its true opponent infoset — the previous move's
  //     opponent decision infoset J′ plus the reply b that led here (w.clsKey,
  //     set at harvest) — so opponent knowledge is never coarsened;
  //   • a freshly SAMPLED world is a singleton class J = {s}: the opponent is
  //     assumed perfectly informed there (Fig. 9 line 13).
  const groups = new Map();
  tree.worlds.forEach((w, i) => {
    const key = w.clsKey ?? 'J' + i;
    let g = groups.get(key);
    if (!g) { g = { key, worlds: [], mass: 0 }; groups.set(key, g); }
    g.worlds.push(w);
    g.mass += w.prob;
  });
  void opp;

  const J = [...groups.values()];
  const m = J.length;
  let ySum = 0;
  for (const g of J) {
    // Within-class chance weights: h ∈ J chosen ∝ our reach π_{-▼}(h) (≈ belief mass).
    for (const w of g.worlds) w.cw = w.prob / (g.mass || 1);
    // Alternate value to me if ▼ exits at J.
    //   Fresh world (Fig. 9 line 14): min{ṽ(h), v*}, where ṽ(h) is the value
    //   of the MOVER's best child as scored at root expansion (paper:
    //   "Stockfish's evaluation"). Measuring alt from our seeded play, or from
    //   a cruder static heuristic, put the alternate values on a different
    //   scale from the resolved enter values, so enter/exit went one-hot and
    //   the subgame tunnel-visioned onto one or two belief worlds.
    //   Carried world (Fig. 9 line 8): u(x,y|J) − ĝ(J), precomputed at harvest
    //   from the carried strategies and the opponent's reach-gift
    //   (w.altOverride).
    let alt = 0;
    for (const w of g.worlds) {
      alt += w.cw * (w.altOverride != null ? w.altOverride : Math.min(bestChildValue(w.node, me), vStar));
    }
    g.altMe = alt;
    g.R = new RegretMinimizer(2); // [enter, exit]
    g.y = g.mass;                  // blueprint opponent reach to J (≈ belief mass)
    g.piv = g.mass;                // root reach before the first CFR iteration prices it
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

    // Blend Resolve and Maxmargin into the opponent's root reach (Fig. 10 l.12),
    // then FLOOR it with the prior α: every class keeps half its prior reach.
    // (Σ π_▼ need not equal 1 when Resolve is entering — that is expected.)
    //
    // The floor is a deliberate deviation from the pure gadget. With singleton
    // per-world classes and approximate alternate values, the pure blend
    // routinely drove the reach of most classes to ~0 (all-exit, or one junk
    // class capturing pmax), so the strategy was optimised against one or two
    // belief worlds and swung wildly between runs. The paper can afford exact
    // exit semantics because its alternate values come from a real blueprint;
    // ours are engine estimates, so we keep every world voting and let the
    // gadget TILT emphasis rather than silence classes outright. (The paper
    // itself notes — App. B.2 fn. 12 — that safety semantics are already
    // strained in this setting.)
    for (let i = 0; i < J.length; i++) {
      const g = J[i];
      g.piv = 0.5 * g.alpha + 0.5 * (pmax * g.alpha * g.pEnter + (1 - pmax) * smm[i]);
    }

    // Accumulate tree regrets with reachOpp = π_▼(J) · (within-class chance).
    for (const g of J) for (const w of g.worlds) cfrDescend(w.node, me, 1, g.piv * w.cw);

    observeAll(infosets);
    gadget.pmax = pmax;
  }
}
