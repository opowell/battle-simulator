// ---------------------------------------------------------------------------
// Tiny dependency-free MLP for learned leaf evaluation (agents/LEARNED-EVAL-PLAN.md).
//
// f: R^n → R with ReLU hidden layers and a LINEAR scalar output. The value of a
// state is the ANTISYMMETRIC pair head
//
//     v(state, me) = tanh( f(φ(state, me)) − f(φ(state, opp)) )
//
// so zero-sum symmetry (v(state, opp) === −v(state, me)) holds by construction
// — the rollout tests assert exactly this invariant. Training regresses v
// toward the game outcome z ∈ [−1, +1] with MSE, optimized by Adam. Weights
// serialize to plain JSON (games/<game>/model.json).
//
// Sizes are deliberately tiny (default 62→64→32→1 ≈ 6k params): trainable in
// JS in minutes, and a batched leaf evaluation costs tens of microseconds.
// ---------------------------------------------------------------------------

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MLP {
  /** @param {number[]} sizes e.g. [62, 64, 32, 1] (last must be 1) */
  constructor(sizes, seed = 42) {
    this.sizes = sizes.slice();
    const rng = mulberry32(seed);
    this.W = []; this.b = [];
    for (let l = 0; l < sizes.length - 1; l++) {
      const nIn = sizes[l], nOut = sizes[l + 1];
      const w = new Float64Array(nIn * nOut);
      const scale = Math.sqrt(2 / nIn); // He init for ReLU
      for (let i = 0; i < w.length; i++) w[i] = (rng() * 2 - 1) * scale;
      this.W.push(w);
      this.b.push(new Float64Array(nOut));
    }
    this._initAdam();
  }

  _initAdam() {
    this.mW = this.W.map(w => new Float64Array(w.length));
    this.vW = this.W.map(w => new Float64Array(w.length));
    this.mB = this.b.map(b => new Float64Array(b.length));
    this.vB = this.b.map(b => new Float64Array(b.length));
    this.adamT = 0;
  }

  /** Forward pass; returns { out, acts } where acts[l] is layer l's activation. */
  forward(x) {
    const acts = [Float64Array.from(x)];
    let a = acts[0];
    for (let l = 0; l < this.W.length; l++) {
      const nIn = this.sizes[l], nOut = this.sizes[l + 1];
      const W = this.W[l], b = this.b[l];
      const z = new Float64Array(nOut);
      for (let j = 0; j < nOut; j++) {
        let s = b[j];
        const base = j * nIn;
        for (let i = 0; i < nIn; i++) s += W[base + i] * a[i];
        z[j] = l < this.W.length - 1 ? (s > 0 ? s : 0) : s; // ReLU hidden, linear out
      }
      acts.push(z);
      a = z;
    }
    return { out: a[0], acts };
  }

  f(x) { return this.forward(x).out; }

  // Backprop dLoss/dOut through one recorded forward pass, ACCUMULATING
  // gradients into gW/gB (same shapes as W/b).
  _backward(acts, dOut, gW, gB) {
    let delta = new Float64Array([dOut]);
    for (let l = this.W.length - 1; l >= 0; l--) {
      const nIn = this.sizes[l], nOut = this.sizes[l + 1];
      const a = acts[l], z = acts[l + 1], W = this.W[l];
      const gw = gW[l], gb = gB[l];
      const prev = new Float64Array(nIn);
      for (let j = 0; j < nOut; j++) {
        const d = delta[j];
        if (d === 0) continue;
        gb[j] += d;
        const base = j * nIn;
        for (let i = 0; i < nIn; i++) {
          gw[base + i] += d * a[i];
          prev[i] += d * W[base + i];
        }
      }
      if (l > 0) {
        const zPrev = acts[l];
        for (let i = 0; i < nIn; i++) if (zPrev[i] <= 0) prev[i] = 0; // ReLU'
      }
      delta = prev;
    }
  }

  /**
   * One Adam step on a minibatch of antisymmetric pairs:
   * batch = [{ xa, xb, z }] with v = tanh(f(xa) − f(xb)) regressed to z.
   * Returns the mean squared error over the batch.
   */
  trainPairs(batch, lr = 1e-3) {
    const gW = this.W.map(w => new Float64Array(w.length));
    const gB = this.b.map(b => new Float64Array(b.length));
    let loss = 0;
    for (const { xa, xb, z } of batch) {
      const fa = this.forward(xa), fb = this.forward(xb);
      const v = Math.tanh(fa.out - fb.out);
      const err = v - z;
      loss += err * err;
      // dL/df = 2·err·(1 − v²), opposite signs for the two towers.
      const g = (2 * err * (1 - v * v)) / batch.length;
      this._backward(fa.acts, g, gW, gB);
      this._backward(fb.acts, -g, gW, gB);
    }
    this._adamStep(gW, gB, lr);
    return loss / batch.length;
  }

  _adamStep(gW, gB, lr, b1 = 0.9, b2 = 0.999, eps = 1e-8) {
    this.adamT++;
    const c1 = 1 - Math.pow(b1, this.adamT), c2 = 1 - Math.pow(b2, this.adamT);
    for (let l = 0; l < this.W.length; l++) {
      const w = this.W[l], g = gW[l], m = this.mW[l], v = this.vW[l];
      for (let i = 0; i < w.length; i++) {
        m[i] = b1 * m[i] + (1 - b1) * g[i];
        v[i] = b2 * v[i] + (1 - b2) * g[i] * g[i];
        w[i] -= lr * (m[i] / c1) / (Math.sqrt(v[i] / c2) + eps);
      }
      const b = this.b[l], gb = gB[l], mb = this.mB[l], vb = this.vB[l];
      for (let i = 0; i < b.length; i++) {
        mb[i] = b1 * mb[i] + (1 - b1) * gb[i];
        vb[i] = b2 * vb[i] + (1 - b2) * gb[i] * gb[i];
        b[i] -= lr * (mb[i] / c1) / (Math.sqrt(vb[i] / c2) + eps);
      }
    }
  }

  toJSON() {
    return {
      sizes: this.sizes,
      W: this.W.map(w => Array.from(w, x => Math.round(x * 1e6) / 1e6)),
      b: this.b.map(b => Array.from(b, x => Math.round(x * 1e6) / 1e6)),
    };
  }

  static fromJSON(j) {
    const net = new MLP(j.sizes, 0);
    j.W.forEach((w, l) => net.W[l].set(w));
    j.b.forEach((b, l) => net.b[l].set(b));
    net._initAdam();
    return net;
  }
}
