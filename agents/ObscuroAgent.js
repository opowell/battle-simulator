// ---------------------------------------------------------------------------
// ObscuroAgent (generic) — a unified, equilibrium-based AI that runs for ANY
// game implementing the engine's GameDefinition interface, at every information
// level, with perfect information as a special case.
//
// It is the game-agnostic sibling of games/chess/ObscuroAgent.js. Where the
// chess agent hard-wires chess evaluation, Stockfish leaves and level-k belief,
// this driver delegates every game-specific judgement to four optional hooks on
// the GameDefinition (see games/types.js):
//
//   sampleWorlds      the belief / information-set sampler ("particles")
//   evaluateState     the heuristic leaf value
//   actionKey         canonical identity of an opponent reply (matrix columns)
//   onActionCommitted lets a stateful belief tracker observe our move
//
// The core idea, straight from Zhang & Sandholm's Obscuro, is to decide over an
// *information set* — the cloud of worlds consistent with what we observe — and
// solve a small zero-sum subgame for an equilibrium, rather than committing to a
// single "most likely" world. Perfect information is simply the degenerate case
// where that cloud has size one, and the equilibrium of the subgame is exactly
// the classical best-response / minimax move.
//
// Graceful degradation (no game changes required):
//   • no hooks                  → best-response/minimax-lite over the observed
//                                 state (a non-random opponent already).
//   • + evaluateState           → meaningfully strong best-response play.
//   • + sampleWorlds            → full mixed-strategy equilibrium under fog.
//
// This is, like the chess version, a normal-form (one matrix per move) cut of
// the paper's extensive-form machinery: rows = our candidate moves, columns =
// the opponent's recurring replies, payoffs = the leaf value averaged over the
// sampled worlds, solved with CFR+ and then purified to a single move.
// ---------------------------------------------------------------------------

import { solveMatrixGame } from './cfr.js';

// Terminal payoff magnitude. Large enough to dominate any heuristic leaf value
// so a winning/losing move is always preferred/avoided, but finite so several
// terminal cells in one matrix stay comparable.
const WIN = 1e6;

// Structural fallback identity for an action when the game supplies no actionKey.
function defaultActionKey(a) {
  return JSON.stringify([
    a.type ?? null, a.unitId ?? null,
    a.from ?? null, a.to ?? null, a.targetId ?? null,
    a.side ?? null, a.payload ?? null,
  ]);
}

// Purify the equilibrium strategy (à la Obscuro): play the dominant move when
// there is one, otherwise sample among the top few "stable" moves.
function purify(dist, actions, maxSupport, rng) {
  const ranked = actions.map((a, i) => ({ a, p: dist[i] ?? 0 })).sort((x, y) => y.p - x.p);
  const support = ranked[0].p >= 0.9 ? 1 : Math.max(1, maxSupport);
  const kept = ranked.slice(0, support).filter(k => k.p > 1e-6);
  if (kept.length === 0) return ranked[0].a;
  let tot = 0; for (const k of kept) tot += k.p;
  let pick = rng() * tot;
  for (const k of kept) { pick -= k.p; if (pick <= 0) return k.a; }
  return kept[kept.length - 1].a;
}

export class ObscuroAgent {
  /**
   * @param {import('../games/types.js').GameDefinition} game
   * @param {object} [opts]  id, name, rng, and search-size overrides
   *   (particles, rows, cols, iters, purifyMax). Anything omitted is derived
   *   from gameSpecific.difficulty (0–100) at decision time.
   */
  constructor(game, opts = {}) {
    if (!game) throw new Error('ObscuroAgent requires a game definition');
    this.game = game;
    this.opts = opts;
    this.id = opts.id ?? 'obscuro';
    this.name = opts.name ?? 'Obscuro (CFR)';
    this._rng = opts.rng ?? Math.random;
  }

  _key(a) { return this.game.actionKey ? this.game.actionKey(a) : defaultActionKey(a); }

  // Heuristic value of a state to player `me`: a terminal result if the game is
  // over, otherwise the game's leaf evaluation (0 if none is provided).
  _leaf(state, me) {
    const r = this.game.getResult ? this.game.getResult(state) : null;
    if (r) return r.outcome === 'draw' ? 0 : (r.winnerId === me ? WIN : -WIN);
    return this.game.evaluateState ? this.game.evaluateState(state, me) : 0;
  }

  // Per-move search sizes, scaled by an optional 0–100 difficulty dial.
  _config(observation) {
    const o = this.opts;
    const d = observation.gameSpecific?.difficulty;
    const t = (typeof d === 'number' ? Math.max(0, Math.min(100, d)) : 50) / 100;
    const ri = (a, b) => Math.round(a + (b - a) * t);
    return {
      difficulty: d,
      particles: o.particles ?? Math.max(1, ri(2, 12)),
      rows:      o.rows      ?? ri(4, 10),
      cols:      o.cols      ?? ri(4, 10),
      iters:     o.iters     ?? ri(150, 500),
      purifyMax: o.purifyMax ?? 2,
    };
  }

  // Perfect-info path (sampleWorlds returned nothing). Base: run the single-world
  // matrix — degenerate best-response. Subclasses override for stronger solvers.
  async _chooseWithoutFog(observation, legalActions, cfg, me) {
    return this._chooseWithFog(observation, legalActions, cfg, me, [observation]);
  }

  // Fog path over a non-empty particle cloud. Base: matrix-CFR over sampled worlds.
  // Subclasses override to plug in stronger leaf evaluators (e.g. Stockfish).
  async _chooseWithFog(observation, legalActions, cfg, me, particles) {
    const game = this.game;
    const rng = this._rng;
    const apply = (state, playerId, action) => game.applyActions(state, [{ playerId, action }], rng);

    // Rank candidate moves (rows) by mean leaf value across worlds; keep the strongest few.
    const ranked = legalActions.map(a => {
      let s = 0;
      for (const w of particles) s += this._leaf(apply(w, me, a), me);
      return { a, s };
    }).sort((x, y) => y.s - x.s);
    const rows = ranked.slice(0, cfg.rows).map(r => r.a);

    // For each (row, world): a forced terminal/leaf value, or the opponent's
    // replies keyed canonically plus a fallback for worlds where a pooled reply is illegal.
    const perCell = rows.map(() => particles.map(() => null));
    const colFreq = new Map();
    for (let i = 0; i < rows.length; i++) {
      for (let p = 0; p < particles.length; p++) {
        const s1 = apply(particles[p], me, rows[i]);
        const res1 = game.getResult ? game.getResult(s1) : null;
        const them = s1.activePlayers?.[0];
        if (res1 || them == null || them === me) {
          perCell[i][p] = { forced: this._leaf(s1, me) };
          continue;
        }
        const replies = game.getLegalActions(s1, them);
        if (!replies || replies.length === 0) { perCell[i][p] = { forced: this._leaf(s1, me) }; continue; }
        const byKey = new Map();
        let worst = Infinity;
        for (const b of replies) {
          const k = this._key(b);
          if (byKey.has(k)) continue;
          const v = this._leaf(apply(s1, them, b), me);
          byKey.set(k, v);
          if (v < worst) worst = v;
          colFreq.set(k, (colFreq.get(k) ?? 0) + 1);
        }
        perCell[i][p] = { byKey, fallback: worst };
      }
    }

    if (colFreq.size === 0) {
      let best = 0, bestScore = -Infinity;
      for (let i = 0; i < rows.length; i++) {
        let s = 0;
        for (let p = 0; p < particles.length; p++) s += perCell[i][p].forced ?? 0;
        if (s > bestScore) { bestScore = s; best = i; }
      }
      return rows[best];
    }

    const cols = [...colFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, cfg.cols).map(e => e[0]);
    const M = rows.map((_, i) => cols.map(k => {
      let sum = 0;
      for (let p = 0; p < particles.length; p++) {
        const c = perCell[i][p];
        sum += c.forced !== undefined ? c.forced : (c.byKey.has(k) ? c.byKey.get(k) : c.fallback);
      }
      return sum / particles.length;
    }));
    const { row } = solveMatrixGame(M, cfg.iters);
    return purify(row, rows, cfg.purifyMax, rng);
  }

  async chooseAction(observation, legalActions) {
    if (!legalActions || legalActions.length === 0) return null;
    if (legalActions.length === 1) return legalActions[0];

    // Yield before the blocking synchronous solve so the event loop stays live.
    await new Promise(r => setImmediate(r));

    const game = this.game;
    const rng = this._rng;
    const me = observation.activePlayers[0];
    const cfg = this._config(observation);

    // Difficulty 0 means random play (parity with the chess dial).
    if (cfg.difficulty === 0) return legalActions[Math.floor(rng() * legalActions.length)];

    // Sample the information set. With no belief sampler (or nothing hidden)
    // the observation itself is the single world.
    const particles = game.sampleWorlds ? game.sampleWorlds(observation, me, cfg.particles, rng) : null;

    let action;
    if (!particles || particles.length === 0) {
      action = await this._chooseWithoutFog(observation, legalActions, cfg, me);
    } else {
      action = await this._chooseWithFog(observation, legalActions, cfg, me, particles);
    }

    if (game.onActionCommitted) game.onActionCommitted(observation, me, action);
    return action;
  }
}
