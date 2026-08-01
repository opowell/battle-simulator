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
import { DIAL, DIAL_CONVEX_EXPONENT } from './obscuro/settings.js';

const lerp = (a, b, t) => a + (b - a) * t;
const ri = (a, b, t) => Math.round(lerp(a, b, t));
// Convex ramp for the expensive knobs: the low end of the dial stays cheap (fast
// for the test suite and weak-but-quick play) while the top reaches the paper-
// scale budget. The exponent is a gentle 1.5 — enough curvature to keep 0–20
// genuinely light (0.1^1.5 ≈ 0.03) but not so much that the MIDDLE of the dial
// collapses to near-nothing. At 1.5, power 50 is ~0.35 of full budget (a real
// medium opponent) instead of ~0.22 under the old 2.2, which made "50" play like
// a beginner: too few belief worlds and too short a search to grow a usable tree.
// The min/max endpoints themselves live in obscuro/settings.js's DIAL — this is
// just the curve shape they're plugged into.
const rc = (a, b, t) => Math.round(a + (b - a) * Math.pow(t, DIAL_CONVEX_EXPONENT));
// Evaluate one DIAL entry at dial position t ∈ [0,1]: a bare number is a
// constant the dial doesn't move, {min,max,curve} picks the matching ramp.
const ramp = (spec, t) => (typeof spec === 'number' ? spec : (spec.curve === 'convex' ? rc : ri)(spec.min, spec.max, t));

function defaultActionKey(a) {
  return JSON.stringify([a.type ?? null, a.unitId ?? null, a.from ?? null, a.to ?? null, a.targetId ?? null, a.side ?? null, a.payload ?? null]);
}

// A small, serialisable projection of an action for the AI-analysis panel — just
// enough for the UI to render "from → to" and flag captures, without shipping the
// whole (possibly large) action object over the wire.
export function compactAction(a) {
  if (!a || typeof a !== 'object') return { type: String(a) };
  const c = { type: a.type ?? null };
  if (a.unitId != null) c.unitId = a.unitId;
  if (a.from != null) c.from = a.from;
  if (a.to != null) c.to = a.to;
  if (a.targetId != null) c.targetId = a.targetId;
  if (a.isCapture) c.isCapture = true;
  if (a.side != null) c.side = a.side;
  return c;
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
    // KLUSS carryover, kept per side (an agent instance may be shared between
    // both players): the previous move's ENTIRE solved tree plus the action we
    // actually played — the paper's Γ̂. The next search grafts the consistent
    // subtrees in as root worlds (node-level carryover) and additionally
    // warm-starts any re-derived infoset from the old tree's infoset map.
    // Alongside it, the previous search value v* (per side) bounds the fresh
    // classes' alternate values.
    this._carry = new Map();
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
    // Endpoints: DIAL.time in obscuro/settings.js.
    const timeMs = gs.aiTimeMs;
    if (typeof timeMs === 'number') {
      const D = DIAL.time;
      if (timeMs <= 0) return { random: true, purifyMax: D.purifyMax };
      const u = Math.min(1, timeMs / 60000);
      return {
        timeMode: true,
        worlds:         o.particles     ?? Math.max(D.worlds.floor, ramp(D.worlds, u)),
        timeBudgetMs:   o.timeBudgetMs  ?? timeMs,
        maxRounds:      o.maxRounds     ?? D.maxRounds,
        maxInfosets:    o.maxInfosets   ?? ramp(D.maxInfosets, u),
        expandPerRound: o.expandPerRound ?? D.expandPerRound,
        cfrPerRound:    o.cfrPerRound   ?? D.cfrPerRound,
        finalCfr:       o.finalCfr      ?? D.finalCfr,
        purifyMax:      o.purifyMax     ?? D.purifyMax,
        // Continuous action resolution (games with getSearchActions): rings×spokes of
        // exact move points per unit. More budget → finer positioning.
        moveRings:      o.moveRings     ?? ramp(D.moveRings, u),
        moveSpokes:     o.moveSpokes    ?? ramp(D.moveSpokes, u),
      };
    }

    // POWER mode: the 0–100 dial. Endpoints: DIAL.power in obscuro/settings.js.
    const d = gs.difficulty;
    const t = (typeof d === 'number' ? Math.max(0, Math.min(100, d)) : 50) / 100;
    const D = DIAL.power;
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
      worlds:         o.particles     ?? Math.max(1, ramp(D.worlds, t)),
      timeBudgetMs:   o.timeBudgetMs  ?? ramp(D.timeBudgetMs, t),
      maxRounds:      o.maxRounds     ?? ramp(D.maxRounds, t),
      maxInfosets:    o.maxInfosets   ?? ramp(D.maxInfosets, t),
      expandPerRound: o.expandPerRound ?? ramp(D.expandPerRound, t),
      cfrPerRound:    o.cfrPerRound   ?? ramp(D.cfrPerRound, t),
      finalCfr:       o.finalCfr      ?? ramp(D.finalCfr, t),
      purifyMax:      o.purifyMax     ?? D.purifyMax,
      // Continuous action resolution (games with getSearchActions): rings×spokes of
      // exact move points per unit, from coarse (weak/fast) to fine at the top of the dial.
      moveRings:      o.moveRings     ?? ramp(D.moveRings, t),
      moveSpokes:     o.moveSpokes    ?? ramp(D.moveSpokes, t),
    };
  }

  // Subclass hook: return a batched leaf evaluator `(state, mover, actions,
  // childStates) => number[]` (value to the mover of each child) to override the
  // default per-child evaluateState. The chess subclass returns a Stockfish
  // evaluator here. Returning null uses the game's evaluateLeaves hook, or the
  // per-child evaluateState default.
  _leafEval(/* observation, me */) { return null; }

  // Subclass hook: the terminal win/loss magnitude the search should use, on the
  // same scale as the game's leaf evaluations. The paper bounds utilities to
  // [−1,+1] — a certain win is worth the eval clamp, not orders of magnitude
  // more — because under fog terminal values are AVERAGED across belief worlds:
  // an unbounded win lets a single phantom world (e.g. an imagined capturable
  // king) swamp every real consideration. Games may also declare `winValue` on
  // the definition. Null keeps the generic default (large; fine for the
  // perfect-information games that ride evaluateState).
  _winValue(/* observation */) { return this.game.winValue ?? null; }

  async chooseAction(observation, legalActions) {
    if (!legalActions || legalActions.length === 0) return null;
    if (legalActions.length === 1) return legalActions[0];

    // Yield so the event loop stays live before the (mostly synchronous) solve.
    // setTimeout fallback keeps this working in the browser analysis worker too.
    await new Promise(r => (typeof setImmediate === 'function' ? setImmediate(r) : setTimeout(r, 0)));

    const game = this.game;
    const rng = this._rng;
    const me = observation.activePlayers[0];
    const cfg = this._config(observation);

    // Difficulty 0 (power mode) or a 0 ms time limit means random play.
    if (cfg.difficulty === 0 || cfg.random) {
      const pick = legalActions[Math.floor(rng() * legalActions.length)];
      this.lastAnalysis = {
        ts: Date.now(), player: me, engine: 'obscuro', mode: 'random',
        difficulty: cfg.difficulty ?? null, worlds: 0, value: null,
        candidates: [{ key: this._key(pick), move: compactAction(pick), prob: 1, value: null, chosen: true }],
        totalCandidates: legalActions.length,
      };
      return pick;
    }

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

    const hooks = makeHooks(game, me, {
      rng, leafEval: this._leafEval(observation, me), searchRes,
      win: this._winValue(observation) ?? undefined,
    });
    const carry = this._carry.get(me);
    const res = await runObscuroSearch(hooks, worlds, {
      opp: this._oppId(observation, me),
      rootActions,
      carry,
      blueprint: carry?.tree?.infosets ?? null,
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
    this.lastAnalysis = this._buildAnalysis(me, cfg, worlds.length, res, action);
    // Let a subclass veto/adjust the selection (e.g. chess's king-safety
    // backstop) BEFORE the game hook records the move: onActionCommitted feeds
    // the belief trackers, and committing an action other than the one actually
    // played silently corrupts the belief (fatally so for the exact tracker).
    const adjusted = this._adjustChosenAction(observation, action, legalActions);
    if (adjusted) {
      const swapped = this._matchLegal(adjusted, legalActions) ?? action;
      if (swapped !== action) {
        action = swapped;
        this.lastAnalysis.adjusted = true; // selection was overridden by the subclass backstop
        const k = this._key(action);
        for (const c of this.lastAnalysis.candidates ?? []) c.chosen = c.key === k;
      }
    }
    // Carry the solved tree + the action ACTUALLY played (post-adjustment) so
    // the next move can graft the consistent subtrees in (paper's Γ̂ reuse).
    this._carry.set(me, { tree: res.tree, actionKey: this._key(action) });
    if (game.onActionCommitted) game.onActionCommitted(observation, me, action);
    return action;
  }

  // Subclass hook: adjust/veto the chosen action just before it is committed.
  // Return a replacement action (must be legal) or null to keep the choice.
  _adjustChosenAction(/* observation, action, legalActions */) { return null; }

  // Assemble the human-inspectable record of this decision (candidate moves, the
  // equilibrium mixed strategy over them, per-move values) for the AI-analysis
  // panel. Called after the search resolves; read back off `this.lastAnalysis`.
  _buildAnalysis(me, cfg, nWorlds, res, chosen) {
    const rows = res.rows ?? [];
    const dist = res.rawDist ?? res.dist ?? [];
    const uCond = res.uCond ?? null;
    const chosenKey = this._key(chosen);
    const cands = rows.map((a, k) => ({
      key: this._key(a),
      move: compactAction(a),
      prob: dist[k] ?? 0,
      value: uCond ? uCond[k] : null,
      chosen: this._key(a) === chosenKey,
    }));
    // Rank by the equilibrium probability mass, then by counterfactual value.
    cands.sort((x, y) => (y.prob - x.prob) || ((y.value ?? -Infinity) - (x.value ?? -Infinity)));
    const round3 = v => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);
    return {
      ts: Date.now(),
      player: me,
      engine: 'obscuro',
      mode: nWorlds > 1 ? 'equilibrium (CFR)' : 'minimax',
      difficulty: cfg.difficulty ?? null,
      timeBudgetMs: cfg.timeBudgetMs ?? null,
      worlds: nWorlds,
      carried: res.tree?.carriedWorlds ?? 0,
      value: round3(res.value),
      pmax: typeof res.pmax === 'number' ? round3(res.pmax) : null,
      candidates: cands.slice(0, 12),
      totalCandidates: rows.length,
    };
  }

  _matchLegal(action, legalActions) {
    if (!action) return null;
    const k = this._key(action);
    for (const a of legalActions) if (this._key(a) === k) return a;
    return null;
  }
}
