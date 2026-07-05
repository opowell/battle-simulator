// ---------------------------------------------------------------------------
// PCFR+ — Predictive Counterfactual Regret Minimization (the "+" / RM+ variant),
// the equilibrium engine used by Obscuro (Zhang & Sandholm 2026, §3.2 / App. C).
//
// The paper solves its growing extensive-form subgame with *predictive* CFR+
// [Farina et al. 2021] and plays the LAST iterate rather than the average
// (App. C.7). This module provides the per-infoset local regret minimizer that
// realises that: a Regret-Matching+ accumulator with an optimistic *predictor*
// (the last observed instantaneous regret), which is what turns vanilla CFR+
// into the predictive variant and gives it fast last-iterate behaviour.
//
// A minimizer is completely game-agnostic: it only ever sees a vector of action
// utilities. The tree CFR pass (infoset.js) feeds it counterfactual values; the
// same class is reused for the Resolve gadget's enter/exit choice (kluss.js).
// ---------------------------------------------------------------------------

// One local decision — a distribution over `n` actions at a single infoset,
// updated by Regret-Matching+ with a predictor (predictive/optimistic RM+).
export class RegretMinimizer {
  constructor(n) {
    this.n = n;
    this.q = new Float64Array(n);     // RM+ regret accumulator (floored at 0)
    this.pred = new Float64Array(n);  // predictor = last instantaneous regret
    this.strat = new Float64Array(n); // strategy last handed out by strategy()
    this.avg = new Float64Array(n);   // Σ strategies (average iterate, for diagnostics)
    this.iters = 0;
    this._seed = -1;                  // pure-strategy seed for the first iterate
    if (n > 0) this.strat[0] = 1;
  }

  // Initialise the first iterate to a pure "best guess" action instead of the
  // uniform strategy (paper App. C.5: init a new infoset to the Stockfish-best
  // child so the leaf value doesn't lurch from max to average on creation).
  seed(bestIndex) { if (bestIndex >= 0 && bestIndex < this.n) this._seed = bestIndex; }

  // The predictive strategy: normalise the positive part of (regret + predictor).
  // The predictor is what makes this *predictive* CFR+ rather than plain CFR+.
  strategy() {
    const { n, q, pred, strat } = this;
    if (this.iters === 0 && this._seed >= 0) {
      strat.fill(0); strat[this._seed] = 1; return strat;
    }
    let sum = 0;
    for (let i = 0; i < n; i++) { const v = q[i] + pred[i]; strat[i] = v > 0 ? v : 0; sum += strat[i]; }
    if (sum > 0) for (let i = 0; i < n; i++) strat[i] /= sum;
    else         for (let i = 0; i < n; i++) strat[i] = 1 / n;
    return strat;
  }

  // Observe this iteration's action utilities (already counterfactually weighted)
  // against the strategy that strategy() last returned; update RM+ regret and the
  // predictor. Returns the strategy's expected value.
  observe(u) {
    const { n, q, pred, strat } = this;
    let v = 0;
    for (let i = 0; i < n; i++) v += strat[i] * u[i];
    for (let i = 0; i < n; i++) {
      const r = u[i] - v;
      const nq = q[i] + r;
      q[i] = nq > 0 ? nq : 0;
      pred[i] = r;
      this.avg[i] += strat[i];
    }
    this.iters++;
    return v;
  }

  // The last iterate (what Obscuro plays, per App. C.7).
  lastStrategy() { return this.strat; }

  // The average iterate (classic CFR convergence guarantee) — exposed for tests.
  averageStrategy() {
    const { n, avg } = this;
    const out = new Array(n);
    let tot = 0; for (let i = 0; i < n; i++) tot += avg[i];
    if (tot > 0) for (let i = 0; i < n; i++) out[i] = avg[i] / tot;
    else         for (let i = 0; i < n; i++) out[i] = 1 / n;
    return out;
  }
}
