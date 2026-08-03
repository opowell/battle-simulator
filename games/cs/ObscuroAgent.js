// ---------------------------------------------------------------------------
// CsObscuroAgent — the CS specialisation of the generic ObscuroAgent.
//
// Same division of labour as the chess specialisation (see
// games/chess/ObscuroAgent.js): the search itself is entirely generic and lives
// in vendor/obscuro/src/ — a growing game tree with shared information sets, solved
// with PCFR+, grown by one-sided GT-CFR, the move chosen by purification. This
// file adds only what is genuinely CS-specific:
//
//   1. The LEAF EVALUATOR (`_leafEval`) — where chess plugs in Stockfish, CS
//      plugs in eval.js's csEvaluate (round outcome, bomb objective, material,
//      angles), plus the one thing a symmetric position score cannot express:
//      the asymmetric cost of a move that walks your OWN unit into a duel it
//      loses. See EXPOSURE below.
//
//   2. The bounded terminal magnitude (`_winValue`) — CS_SEARCH_WIN, on the same
//      cs-point scale as the leaves.
//
// Belief sampling, difficulty scaling, tree carryover and move selection are all
// inherited unchanged from the generic agent. CS needs no perfect-information
// shortcut of the kind chess takes (there is no external engine to defer to);
// with fog off, sampleWorlds returns [] and the generic search runs on the single
// known world, which is exactly the right behaviour.
// ---------------------------------------------------------------------------

import { ObscuroAgent as GenericObscuroAgent } from '../../agents/ObscuroAgent.js';
import { makeHooks, runObscuroSearch } from '../../vendor/obscuro/src/search.js';
import { csScore, unitValue, CS_SEARCH_WIN, ROUND_WIN } from './eval.js';

// EXPOSURE — the CS analogue of chess's KING_HANG.
//
// csEvaluate already scores angles symmetrically: I gain for the shot I hold, I
// lose for the shot held on me. That is the right price for a position I merely
// find myself in. It is the WRONG price for a position I just chose to step into,
// for the same reason the chess agent scores hanging its own king as a loss
// rather than as "down some material": under fog these values are averaged across
// belief worlds, so a move that walks into a losing duel in half the worlds gets
// averaged against ordinary material in the other half and comes out looking
// playable. That is precisely how an AI ends up strolling into a held angle.
//
// So a unit that is under more incoming fire than it can answer is priced as
// PARTLY ALREADY DEAD, in proportion to how much of its life the enemy can take
// before it shoots back. The asymmetry is deliberate and mirrors chess exactly:
// the downside (my unit in someone's crosshair) is a real, self-inflicted cost
// and is taken at full weight, while the upside (a shot I imagine I have on an
// enemy I have not actually seen) is phantom-prone and stays bounded by the
// ordinary angle term.
const LOSS_SHARE = 0.6;

// Optimism cap. A leaf may not be scored better than a decided round, however
// many phantom enemies a belief world happens to have placed in the open. Same
// role as chess's LEAF_CLAMP: it stops one lucky sample from dominating the
// average over belief worlds.
const LEAF_CLAMP = ROUND_WIN;
const clip = v => (v > LEAF_CLAMP ? LEAF_CLAMP : v < -LEAF_CLAMP ? -LEAF_CLAMP : v);

/**
 * Exposure cost for one side, read off the duel table csScore already built: for
 * each living unit, how much of its value the enemy can take off it before it
 * answers. `units`/`out`/`inc` come straight from duelTerms, so this adds no
 * line-of-sight work of its own.
 */
function exposureCost(units, out, inc) {
  let cost = 0;
  for (const u of units) {
    // Only the part of the incoming fire the unit cannot answer counts as a
    // losing trade — an even duel is a normal part of CS and is already priced
    // by the symmetric angle term.
    const unanswered = (inc.get(u.id) ?? 0) - (out.get(u.id) ?? 0);
    if (unanswered <= 0) continue;
    const lethality = Math.min(1, unanswered / Math.max(1, u.hp ?? 100));
    cost += LOSS_SHARE * unitValue(u) * lethality;
  }
  return cost;
}

/**
 * The batched CS node heuristic. Signature matches the generic search's
 * expectation (see vendor/obscuro/src/search.js's makeHooks): given a node `state`
 * where `mover` is to play and the `actions` leading to its children (with the
 * already-applied `childStates`), return the value TO THE MOVER of each child.
 *
 * Unlike chess's, this evaluator is pure CPU with no engine round-trip, so there
 * is nothing to batch across children — the batched shape exists only because the
 * hook requires it. Each child is scored by csScore, which computes the position
 * value and the duel table together in one pass of line-of-sight work; the
 * exposure terms below then read that table rather than recomputing it.
 */
export function csLeafEval(state, mover, actions, childStates) {
  // The search identifies the mover by PLAYER id ('p1'/'p2') — it takes it
  // straight off state.activePlayers — while everything in eval.js reasons in
  // TEAM ids ('T'/'CT'), because that is what unit.ownerId holds. Confusing the
  // two returns the exact NEGATION of the truth rather than erroring, so it is
  // normalised in both places: csScore does it too, and this is the belt to its
  // braces.
  const team = state.gameSpecific.teamMap?.[mover] ?? mover;
  return childStates.map((cs) => {
    if (!cs) return -ROUND_WIN; // an inapplicable action; never worth choosing
    const { value, decided, duels } = csScore(cs, team);
    // A decided round is already terminal — don't discount it for exposure.
    if (decided) return clip(value);
    return clip(value
      - exposureCost(duels.mine,   duels.myOut,    duels.myInc)
      + exposureCost(duels.theirs, duels.theirOut, duels.theirInc));
  });
}

export class CsObscuroAgent extends GenericObscuroAgent {
  constructor(opts = {}) {
    // The generic base needs a truthy game; the real CsGame is attached lazily on
    // first use to avoid a circular import (CsGame imports us to declare `agents`).
    super({}, { id: 'obscuro', name: 'AI (Obscuro/CFR)', ...opts });
    this._csGame = null;
  }

  async _game() {
    if (!this._csGame) this._csGame = (await import('./CsGame.js')).CsGame;
    this.game = this._csGame;
    return this._csGame;
  }

  // Bounded MATCH terminal, on the cs-point scale (see eval.js).
  _winValue() { return CS_SEARCH_WIN; }

  // CS's node heuristic (it does its own player-id → team-id translation; see
  // csLeafEval, which the search calls with a raw player id).
  _leafEval() { return csLeafEval; }

  async chooseAction(state, legalActions) {
    if (!legalActions?.length) return null;
    if (legalActions.length === 1) return legalActions[0];
    await this._game();
    return super.chooseAction(state, legalActions);
  }
}

export const ObscuroAgent = new CsObscuroAgent();

// ---------------------------------------------------------------------------
// Read-only position analysis for the UI's "suggest a move" panel (the CS
// counterpart of chess's analyzeObscuro). Runs the same search real play does —
// belief-sampled worlds, the CS leaf evaluator, PCFR+ on the growing tree — and
// reshapes the result into ranked candidates, without ever committing a move.
//
// Deliberately NOT the chess file's progressive/exhaustive belief walk: CS's
// belief (belief.js) is generative — a per-enemy possible-tile set sampled from,
// with no enumerable population — so there is nothing to walk to exhaustion. It
// is the same "heuristic fallback" regime chess drops into when exact tracking is
// lost, so this samples a fresh cloud and reports one solve, with live round
// ticks over the SSE progress channel.
// ---------------------------------------------------------------------------

// Rank by equilibrium mass, ties broken by counterfactual value. `cp` carries the
// per-move value in cs-points so AnalysisCandidateList renders an eval column
// alongside the mixing probabilities — the two answer different questions ("how
// good does this look" vs "how much would I actually mix it in").
function rankCandidates(rows, dist, uCond) {
  return (rows ?? [])
    .map((move, i) => ({ move, prob: dist?.[i] ?? 0, cp: uCond ? Math.round(uCond[i]) : null }))
    .sort((a, b) => (b.prob - a.prob) || ((b.cp ?? -Infinity) - (a.cp ?? -Infinity)));
}

export async function analyzeCsObscuro(state, legalActions, opts = {}) {
  if (!legalActions?.length) return { engine: 'obscuro', mode: 'none', candidates: [] };
  const game = (await import('./CsGame.js')).CsGame;
  const rng = opts.rng ?? Math.random;

  // Analyze the REQUESTING side, even mid-way through the opponent's turn (see
  // api-server.js's resolveAnalysisContext). The tree derives whose move a node
  // is from activePlayers at every level, so a root that still claims the other
  // side is to move would desync the search — patch it to match, exactly as
  // chess's obscuroStrategy does.
  const me = opts.color ?? state.activePlayers[0];
  if (me !== state.activePlayers[0]) state = { ...state, activePlayers: [me] };

  const fog = !!state.gameSpecific.fogOfWar;
  let worlds = fog ? game.sampleWorlds(state, me, opts.particles ?? 16, rng) : null;
  if (!worlds || worlds.length === 0) worlds = [state];

  // Analysis is an on-demand request, not something blocking the game clock, so
  // it can afford a finer action lattice than a real timed move.
  const searchRes = { rings: opts.rings ?? 2, spokes: opts.spokes ?? 8 };
  const hooks = makeHooks(game, me, { rng, leafEval: csLeafEval, searchRes, win: CS_SEARCH_WIN });
  const opp = (state.players ?? []).find(p => p.id !== me)?.id ?? null;
  const onRound = opts.onProgress
    ? (round, maxRounds, info) => opts.onProgress({
        kind: 'round', round, maxRounds, candidates: rankCandidates(info.rows, info.dist, null),
      })
    : undefined;

  const res = await runObscuroSearch(hooks, worlds, {
    opp,
    rootActions: game.getSearchActions(state, me, searchRes),
    rng,
    timeBudgetMs: opts.timeBudgetMs ?? 4000,
    maxRounds: opts.maxRounds ?? 60,
    expandPerRound: opts.expandPerRound ?? 16,
    cfrPerRound: opts.cfrPerRound ?? 8,
    purifyMax: opts.purifyMax ?? 3,
    onRound,
    isCancelled: opts.isCancelled,
  });

  return {
    engine: 'obscuro',
    mode: worlds.length > 1 ? 'equilibrium (CFR)' : 'minimax',
    value: Math.round(res.value),
    particles: worlds.length,
    candidates: rankCandidates(res.rows, res.rawDist ?? res.dist, res.uCond),
  };
}
