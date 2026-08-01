// ---------------------------------------------------------------------------
// Generic Obscuro parameter defaults — the ONE place every game-agnostic
// tunable knob's default value lives, so "what does this number do and where
// do I change it" has a single answer instead of a hunt through
// agents/ObscuroAgent.js, agents/obscuro/search.js, gtcfr.js, purify.js and
// kluss.js. See games/chess/obscuro-settings.js for the fog-chess-specific
// counterpart (leaf-eval depth, belief sampling, Stockfish knobs).
//
// This module is the SOURCE OF TRUTH for the numbers below — the files that
// use them import from here rather than declaring their own literals, so
// there is nowhere else a default can silently drift out of sync with what
// this file (and OBSCURO-PARAMETERS.md) documents.
//
// DIAL is ObscuroAgent's difficulty scaling (see ObscuroAgent._config): every
// non-time knob is one of two ramp shapes evaluated at t ∈ [0,1] (POWER mode:
// t = difficulty/100; TIME mode: t = min(1, aiTimeMs/60000)):
//   • convex (rc)  — round(min + (max-min) * t^1.5): stays cheap through the
//     low/mid dial and only reaches `max` at the very top. Used for the
//     knobs that dominate cost (belief worlds, time budget, tree/solve size).
//   • linear (ri)  — round(lerp(min, max, t)). Used for the cheaper knobs.
// A bare number (not {min,max}) is a constant: the dial does not move it.
// ---------------------------------------------------------------------------

export const DIAL = {
  // POWER mode — gameSpecific.difficulty, 0-100 (see ObscuroAgent._config).
  power: {
    worlds:         { min: 1,   max: 48,  curve: 'convex' },  // belief particles searched
    timeBudgetMs:   { min: 30,  max: 2000, curve: 'convex' }, // wall-clock budget per move
    maxRounds:      { min: 6,   max: 100, curve: 'convex' },  // expand+solve rounds
    maxInfosets:    { min: 400, max: 6000, curve: 'convex' }, // tree size cap
    finalCfr:       { min: 15,  max: 100, curve: 'convex' },  // extra CFR iterations after the round loop
    expandPerRound: { min: 6,   max: 24,  curve: 'linear' },  // GT-CFR expansion steps per round
    cfrPerRound:    { min: 3,   max: 10,  curve: 'linear' },  // CFR iterations per round
    moveRings:      { min: 1,   max: 3,   curve: 'linear' },  // continuous-action resolution (games/coord.js)
    moveSpokes:     { min: 4,   max: 12,  curve: 'linear' },
    purifyMax: 3, // move-selection support cap (see purify.js MAX_SUPPORT)
  },
  // TIME mode — gameSpecific.aiTimeMs, a per-move wall-clock limit in ms
  // (0 = random, up to 600000 = 10 min). timeBudgetMs itself is NOT a ramp
  // here — the user's limit IS the budget; only the knobs the budget can't
  // directly bound (belief width, tree cap) scale with it.
  time: {
    worlds:         { min: 4,    max: 48,   curve: 'linear', floor: 2 }, // floor never actually binds (min is already 4)
    maxInfosets:    { min: 1000, max: 25000, curve: 'linear' },
    moveRings:      { min: 1, max: 3, curve: 'linear' },
    moveSpokes:     { min: 6, max: 12, curve: 'linear' },
    maxRounds: 100000,      // effectively unbounded; timeBudgetMs is the real limiter
    expandPerRound: 24,
    cfrPerRound: 10,
    finalCfr: 200,
    purifyMax: 3,
  },
};

// Exponent of the convex ramp (see rc() in ObscuroAgent.js): 1.5 keeps the
// low end of the dial cheap while still reaching the paper-scale budget at
// the top. Documented here so it isn't re-derived by staring at rc()'s call
// sites; the actual math still lives next to rc() itself.
export const DIAL_CONVEX_EXPONENT = 1.5;

// agents/obscuro/search.js — runObscuroSearch's own fallback defaults, used
// when a caller (e.g. ChessObscuroAgent.obscuroStrategy, or a test) invokes
// the search directly instead of through ObscuroAgent (which always supplies
// DIAL-derived values explicitly).
export const SEARCH_DEFAULTS = {
  win: 1e6,            // terminal win/loss magnitude when a game declares no winValue
  expandPerRound: 8,
  cfrPerRound: 4,
  maxRounds: 200,
  finalCfr: 40,
  // The final solve is allowed to run finalCfrDeadlineFactor× the round-loop
  // budget past it, so a large tree's equilibrium can settle (paper: solver
  // threads keep going after expanders stop).
  finalCfrDeadlineFactor: 1.35,
  finalCfrChunkCap: 10,       // CFR iterations run per finalCfr deadline check
  // "Stable since T½" purification window (see purify.js): an action must
  // hold nonzero mass in every last-iterate snapshot since half the rounds.
  stableSnapshotEps: 1e-3,
  // Safety switch (App. C.8): mixing is allowed only when the opponent has
  // (almost) no incentive to enter the Resolve gadget.
  safePmaxThreshold: 0.05,
  // Root-carryover bookkeeping (see harvestCarried / rootWorlds in search.js).
  carriedRootWidthFloor: 16, // minimum root width kept even with few belief worlds
};

// agents/obscuro/gtcfr.js — expandRoot's guaranteed floor of expanded root
// worlds, so a cold engine cache can't silently degrade the search to a
// near-single-world one before the deadline is even checked.
export const MIN_EXPANDED_ROOT_WORLDS = 8;

// agents/obscuro/kluss.js — the Resolve prior's blend between the blueprint
// opponent distribution and uniform (buildGadget): alpha(J) = BLEND * (y/ySum) + (1-BLEND)/m.
export const RESOLVE_PRIOR_UNIFORM_BLEND = 0.5;

// agents/obscuro/purify.js — MAX_SUPPORT is exported from purify.js itself
// (the module that actually uses it); re-exported here so this file remains
// the one place that lists every generic knob.
export { MAX_SUPPORT as PURIFY_MAX_SUPPORT, MIN_SUPPORT_PROB } from './purify.js';
