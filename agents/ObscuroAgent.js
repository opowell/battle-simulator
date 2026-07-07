// ---------------------------------------------------------------------------
// ObscuroAgent (generic) — a unified, equilibrium-based AI that runs for ANY
// game implementing the engine's GameDefinition interface, at every information
// level, with perfect information as a special case.
//
// This is a faithful, game-agnostic implementation of the search in Zhang &
// Sandholm's *Obscuro* (the first superhuman Fog-of-War chess AI). Unlike the
// earlier normal-form (one-matrix-per-move) approximation, it runs the paper's
// actual extensive-form machinery, living under agents/obscuro/:
//
//   • a growing game TREE with shared information sets (infoset.js)
//   • solved with PREDICTIVE CFR+ / PCFR+, played on the LAST iterate (pcfr.js)
//   • grown by ONE-SIDED GT-CFR with PUCT-balanced expansion (gtcfr.js)
//   • the move chosen by PURIFICATION of the last iterate (purify.js)
//   • all orchestrated by the Move() loop in search.js
//
// Every game-specific judgement is delegated to GameDefinition hooks (see
// games/types.js): sampleWorlds (belief), evaluateState / evaluateLeaves (leaf
// value), actionKey, getVisibleState (infoset identity), onActionCommitted. The
// search itself contains no game knowledge — matching the paper, in which only
// the evaluation function is game-specific (chess plugs in Stockfish via a
// subclass; every other game rides evaluateState through the default leaf hook).
//
// Graceful degradation (no game changes required):
//   • no hooks                  → minimax-lite over the observed state.
//   • + evaluateState           → meaningfully strong best-response play.
//   • + sampleWorlds            → full mixed-strategy equilibrium under fog.
// ---------------------------------------------------------------------------

import { makeHooks, runObscuroSearch } from './obscuro/search.js';

const lerp = (a, b, t) => a + (b - a) * t;
const ri = (a, b, t) => Math.round(lerp(a, b, t));
// Convex ramp for the expensive knobs: low/mid difficulty stays cheap (fast for
// the test suite and weak-but-quick play) while only the top of the dial reaches
// the paper-scale budget. t^2.2 keeps the mid-range near the old linear values
// and back-loads the whole bump into the high end.
const rc = (a, b, t) => Math.round(a + (b - a) * Math.pow(t, 2.2));

function defaultActionKey(a) {
  return JSON.stringify([a.type ?? null, a.unitId ?? null, a.from ?? null, a.to ?? null, a.targetId ?? null, a.side ?? null, a.payload ?? null]);
}

export class ObscuroAgent {
  /**
   * @param {import('../games/types.js').GameDefinition} game
   * @param {object} [opts]  id, name, rng, and search overrides (particles,
   *   timeBudgetMs, maxRounds, maxInfosets, expandPerRound, cfrPerRound,
   *   purifyMax). Anything omitted is derived from gameSpecific.difficulty (0–100).
   */
  constructor(game, opts = {}) {
    if (!game) throw new Error('ObscuroAgent requires a game definition');
    this.game = game;
    this.opts = opts;
    this.id = opts.id ?? 'obscuro';
    this.name = opts.name ?? 'Obscuro (CFR)';
    this._rng = opts.rng ?? Math.random;
    // KLUSS blueprint: the previous move's solved tree, kept per side (an agent
    // instance may be shared between both players) so each perspective warm-starts
    // from its own last computation. Alongside it, the previous search value v*
    // (per side) bounds the gadget's alternate values.
    this._blueprints = new Map();
    this._prevValues = new Map();
  }

  _key(a) { return this.game.actionKey ? this.game.actionKey(a) : defaultActionKey(a); }

  _oppId(observation, me) {
    const other = (observation.players ?? []).find(p => p.id !== me);
    return other ? other.id : null;
  }

  // Per-move search sizes, scaled by a single 0–100 difficulty dial. There is ONE
  // algorithm at every level; the dial only slides continuous knobs — the time /
  // tree budget, the number of belief worlds, and the solver depth. Nothing is
  // branched per level (repo constraint: difficulty = one scaled algorithm).
  _config(observation) {
    const o = this.opts;
    const gs = observation.gameSpecific ?? {};

    // TIME mode: a per-move wall-clock limit (0 = random … up to 10 min) instead
    // of a power level. The budget IS the limit; the rest of the search is scaled
    // generously (saturating near a minute) and left for the budget to bound.
    const timeMs = gs.aiTimeMs;
    if (typeof timeMs === 'number') {
      if (timeMs <= 0) return { random: true, purifyMax: 3 };
      const u = Math.min(1, timeMs / 60000);
      return {
        timeMode: true,
        worlds:         o.particles     ?? Math.max(2, Math.round(4 + u * 44)),
        timeBudgetMs:   o.timeBudgetMs  ?? timeMs,
        maxRounds:      o.maxRounds     ?? 100000,
        maxInfosets:    o.maxInfosets   ?? Math.round(1000 + u * 24000),
        expandPerRound: o.expandPerRound ?? 24,
        cfrPerRound:    o.cfrPerRound   ?? 10,
        finalCfr:       o.finalCfr      ?? 200,
        purifyMax:      o.purifyMax     ?? 3,
        // Continuous action resolution (games with getSearchActions): rings×spokes of
        // exact move points per unit. More budget → finer positioning.
        moveRings:      o.moveRings     ?? ri(1, 3, u),
        moveSpokes:     o.moveSpokes    ?? ri(6, 12, u),
      };
    }

    // POWER mode: the 0–100 dial.
    const d = gs.difficulty;
    const t = (typeof d === 'number' ? Math.max(0, Math.min(100, d)) : 50) / 100;
    // Scaled toward the paper's regime at the top of the dial (it samples
    // hundreds of worlds and grows ~10^6-node trees at seconds/move). The wall-
    // clock timeBudgetMs is the real limiter, so the round/infoset caps can be
    // generous without runaway; the belief-world count is the dominant per-
    // iteration cost, so it is raised but kept JS-affordable.
    // Tops chosen so the convex ramp keeps the mid-range at/below the previous
    // linear scaling (fast tests, quick weak play) while the top of the dial
    // reaches roughly the paper's per-move budget.
    return {
      difficulty: d,
      worlds:         o.particles     ?? Math.max(1, rc(1, 48, t)),
      timeBudgetMs:   o.timeBudgetMs  ?? rc(30, 1200, t),
      maxRounds:      o.maxRounds     ?? rc(6, 100, t),
      maxInfosets:    o.maxInfosets   ?? rc(400, 6000, t),
      expandPerRound: o.expandPerRound ?? ri(6, 24, t),
      cfrPerRound:    o.cfrPerRound   ?? ri(3, 10, t),
      finalCfr:       o.finalCfr      ?? rc(15, 100, t),
      purifyMax:      o.purifyMax     ?? 3,
      // Continuous action resolution (games with getSearchActions): rings×spokes of
      // exact move points per unit, from coarse (weak/fast) to fine at the top of the dial.
      moveRings:      o.moveRings     ?? ri(1, 3, t),
      moveSpokes:     o.moveSpokes    ?? ri(4, 12, t),
    };
  }

  // Subclass hook: return a batched leaf evaluator `(state, mover, actions,
  // childStates) => number[]` (value to the mover of each child) to override the
  // default per-child evaluateState. The chess subclass returns a Stockfish
  // evaluator here. Returning null uses the game's evaluateLeaves hook, or the
  // per-child evaluateState default.
  _leafEval(/* observation, me */) { return null; }

  async chooseAction(observation, legalActions) {
    if (!legalActions || legalActions.length === 0) return null;
    if (legalActions.length === 1) return legalActions[0];

    // Yield so the event loop stays live before the (mostly synchronous) solve.
    await new Promise(r => setImmediate(r));

    const game = this.game;
    const rng = this._rng;
    const me = observation.activePlayers[0];
    const cfg = this._config(observation);

    // Difficulty 0 (power mode) or a 0 ms time limit means random play.
    if (cfg.difficulty === 0 || cfg.random) return legalActions[Math.floor(rng() * legalActions.length)];

    // Sample the information set. With no belief sampler (or nothing hidden) the
    // observation itself is the single world (perfect information).
    let worlds = game.sampleWorlds ? game.sampleWorlds(observation, me, cfg.worlds, rng) : null;
    if (!worlds || worlds.length === 0) worlds = [observation];

    // Continuous-location games reason over exact points: the search action set (root
    // and every tree node) is the difficulty-scaled continuous lattice, not the discrete
    // getLegalActions tiles. searchRes must be deterministic so the tree stays consistent.
    const searchRes = { rings: cfg.moveRings, spokes: cfg.moveSpokes };
    const rootActions = game.getSearchActions
      ? game.getSearchActions(observation, me, searchRes)
      : legalActions;

    const hooks = makeHooks(game, me, { rng, leafEval: this._leafEval(observation, me), searchRes });
    const res = await runObscuroSearch(hooks, worlds, {
      opp: this._oppId(observation, me),
      rootActions,
      blueprint: this._blueprints.get(me),
      prevValue: this._prevValues.get(me),
      rng,
      timeBudgetMs: cfg.timeBudgetMs,
      maxRounds: cfg.maxRounds,
      maxInfosets: cfg.maxInfosets,
      expandPerRound: cfg.expandPerRound,
      cfrPerRound: cfg.cfrPerRound,
      finalCfr: cfg.finalCfr,
      purifyMax: cfg.purifyMax,
    });
    // Save the solved tree as this side's blueprint, and its value as v*, for the
    // next move's KLUSS reuse and gadget alternate-value bound.
    this._blueprints.set(me, res.tree?.infosets ?? null);
    this._prevValues.set(me, res.value);

    // Map the chosen action back onto the caller's own legalActions array so the
    // returned object is reference-identical, and so an action that is somehow
    // illegal in the true position can never escape (falls back to a legal move).
    // Continuous games choose an exact point that is deliberately NOT in the discrete
    // legalActions set, so accept it directly when the game validates it geometrically
    // (engine/ActionValidator.js accepts it the same way); still fall back to a real
    // legal action if it somehow fails.
    let action = this._matchLegal(res.action, legalActions);
    if (!action && res.action && game.isActionLegal?.(observation, me, res.action)) action = res.action;
    action = action ?? legalActions[0];
    if (game.onActionCommitted) game.onActionCommitted(observation, me, action);
    return action;
  }

  _matchLegal(action, legalActions) {
    if (!action) return null;
    const k = this._key(action);
    for (const a of legalActions) if (this._key(a) === k) return a;
    return null;
  }
}
