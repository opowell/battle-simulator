// ---------------------------------------------------------------------------
// Civ1ObscuroAgent — the generic Obscuro search (agents/ObscuroAgent.js) with the
// three pieces of civ1-specific judgement the paper leaves game-specific:
// an action set, a leaf evaluation, and a time budget.
//
// Everything algorithmic still comes from the shared machinery — the growing
// infoset tree, PCFR+, one-sided GT-CFR, purification, KLUSS carryover. What is
// specialised here is only what has to be:
//
//   1. BUDGET PER TURN, NOT PER ACTION. Chess asks the agent one question per
//      turn; civ1 asks it fifteen to thirty (one per unit, per city, plus the
//      empire settings). Inheriting the generic per-*decision* budget therefore
//      multiplies the intended cost by the length of the turn — the unmodified
//      agent spent ~800 ms per sub-action, i.e. most of a minute per turn, and a
//      20-turn game did not finish in nine minutes. Here a single per-turn
//      budget is divided across the decisions the turn still has to make.
//   2. A POSITIONAL LEAF EVALUATION. Civ1Game.evaluateState is a materiel count:
//      units, cities, advances, gold. At one-sub-action granularity most children
//      are materially identical (walking a unit changes nothing it measures), so
//      the search sees a flat landscape and the move choice falls to noise. The
//      leaf value here keeps that materiel backbone and adds the positional terms
//      that a single move actually moves: pressure on enemy cities, garrison
//      cover, terrain, and settler dispersal.
//   3. A BOUNDED WIN VALUE. Terminal values are averaged across belief worlds,
//      so an unbounded win lets one phantom world swamp every real consideration
//      (see agents/ObscuroAgent.js _winValue). Scaled to sit above a realistic
//      materiel swing without dwarfing it.
//
// The action set — the other half of making this tractable — lives in
// searchActions.js and is installed on the game itself, so the analysis panel and
// any other consumer of the search see the same pruned set.
// ---------------------------------------------------------------------------

import { ObscuroAgent } from '../../agents/ObscuroAgent.js';
import { UNITS } from './units.js';
import { TERRAIN } from './terrain.js';
import { siteValue } from './searchActions.js';

function chebyshev(a, b, width) {
  const dx = Math.abs(a.x - b.x);
  return Math.max(Math.min(dx, width - dx), Math.abs(a.y - b.y));
}

// Minimum gap between our own cities, in tiles (matches searchActions.js), and how
// much a settler is paid for having walked the whole way out to that gap.
const MIN_CITY_SPACING = 4;
const SETTLE_PULL = 60;

// Per-side score. The caller differences two of these, so only relative weights
// matter. Materiel terms dominate; positional terms are deliberately an order of
// magnitude smaller — they break ties between moves, they don't buy trades.
function sideScore(state, playerId, oppId) {
  const W = state.board.width;
  const units = state.units.filter(u => u.alive && u.ownerId === playerId);
  const cities = state.cities.filter(c => c.ownerId === playerId);
  const oppCities = oppId ? state.cities.filter(c => c.ownerId === oppId) : [];

  let score = 0;

  // ── Materiel ──
  for (const u of units) {
    const stats = UNITS[u.type];
    if (!stats) continue;
    score += stats.cost * (u.hp / Math.max(1, u.maxHp));
  }
  for (const c of cities) {
    // Land quality is part of a city's worth, not a detail. A city on a site that
    // nets zero food surplus never grows and never produces — scoring every city
    // at a flat 120 makes founding on dead ground look identical to founding on
    // grassland, which is precisely the mistake that leaves an agent frozen at one
    // size-1 city for a whole game. See siteValue in searchActions.js.
    score += 120 + (c.size ?? 1) * 22 + (c.buildings?.length ?? 0) * 10 + siteValue(state, c.position);
  }
  const civ = state.gameSpecific?.civ?.[playerId];
  if (civ) score += civ.techs.length * 18 + civ.gold * 0.15;

  // Unit support. A city supports `size` units free and pays a shield a turn for
  // every one beyond that (city.js shieldUpkeep), against a gross yield of about
  // five — so an army the empire cannot pay for does not merely cost its build
  // price, it shuts the economy that built it. Counting units as pure materiel,
  // as the game's own evaluateState does, is what lets every agent here grind
  // itself to a halt at two cities. Priced above a unit's build cost so the search
  // would rather grow than garrison.
  const supportCap = cities.reduce((n, c) => n + (c.size ?? 1), 0);
  score -= Math.max(0, units.length - supportCap) * 45;

  // ── Position ──

  // Garrison cover, scored PER CITY rather than per unit. Paying every unit that
  // stands on a city means a stack of six is worth six garrisons, and an earlier
  // version of this function did exactly that: the agent parked its entire army
  // on its capital for the whole game and never expanded or attacked, because
  // sitting still was the highest-scoring thing any unit could do.
  const garrisoned = new Set();
  for (const c of cities) {
    const holder = units.find(u => {
      const stats = UNITS[u.type];
      return stats && stats.defense > 0 && !(stats.special ?? []).includes('found-city') &&
        u.position.x === c.position.x && u.position.y === c.position.y && !garrisoned.has(u.id);
    });
    if (holder) { score += 25; garrisoned.add(holder.id); }
  }

  for (const u of units) {
    const stats = UNITS[u.type];
    if (!stats) continue;
    const tile = state.board.tiles[`${u.position.x},${u.position.y}`];
    const t = TERRAIN[tile?.terrain] ?? null;
    const isSettler = (stats.special ?? []).includes('found-city');
    // With no cities yet the spacing constraint is vacuously satisfied — the very
    // first settler may found anywhere, so its choice is driven purely by how good
    // the ground is. Treating that case as spacing 0 (an earlier bug) suppressed
    // the site term on the single most consequential decision in the game.
    const spacing = cities.length
      ? cities.reduce((d, c) => Math.min(d, chebyshev(u.position, c.position, W)), Infinity)
      : Infinity;

    if (isSettler) {
      // A settler is only worth its cost standing somewhere it can actually found.
      // The gradient is steep on purpose. At the depth this search reaches inside a
      // per-decision budget of tens of milliseconds, the tree does not see four
      // turns ahead to the city itself, so the walk out there has to pay its own
      // way tile by tile or the settler simply never leaves — which is exactly
      // what a gentler version of this term produced.
      score += SETTLE_PULL * Math.min(1, spacing / MIN_CITY_SPACING);
      // ...and standing somewhere actually worth founding on when it gets there.
      if (spacing >= MIN_CITY_SPACING) score += siteValue(state, u.position);
    } else if (!garrisoned.has(u.id) && stats.attack > 0) {
      if (oppCities.length) {
        // Pressure: an army closing on an enemy city is doing something, an army
        // milling around at home is not.
        const d = oppCities.reduce((m, c) => Math.min(m, chebyshev(u.position, c.position, W)), Infinity);
        score += Math.max(0, 20 - d) * 2.5;
      } else {
        // Nothing of theirs is in sight yet. Anything not needed at home is worth
        // more out looking for them than standing in the square it was built in —
        // under fog, contact is what the search needs to have anything to reason
        // about at all.
        score += Math.min(spacing, 12) * 3;
      }
    }

    // Sitting on defensible ground.
    score += (t?.defBonus ?? 0) * 8;
  }

  return score;
}

export class Civ1ObscuroAgent extends ObscuroAgent {
  constructor(game, opts = {}) {
    super(game, { name: 'Obscuro (CFR)', ...opts });
    // Wall-clock allowance for a whole turn, shared out across the decisions that
    // turn still has to make. Keyed per side so one shared instance can drive both.
    this._turnBudgetMs = opts.turnBudgetMs ?? null;
    this._turnKey = new Map();
  }

  // A turn's remaining decisions, as the pruned action set will pose them: one
  // per unit still holding moves, one per city yet to choose production, one for
  // each empire setting still open, plus the end-turn itself.
  _decisionsLeft(observation, me) {
    const units = (observation.units ?? []).filter(u => u.alive && u.ownerId === me && u.movesLeft > 0).length;
    const cities = (observation.cities ?? []).filter(c =>
      c.ownerId === me && c.productionSetTurn !== observation.turnNumber).length;
    const civ = observation.gameSpecific?.civ?.[me];
    let empire = 0;
    if (civ) {
      if (civ.researchSetTurn !== observation.turnNumber) empire++;
      if (civ.taxSetTurn !== observation.turnNumber) empire++;
      if (civ.luxSetTurn !== observation.turnNumber) empire++;
    }
    return Math.max(1, units + cities + empire + 1);
  }

  _config(observation) {
    const cfg = super._config(observation);
    if (cfg.random) return cfg;

    // Divide the turn's allowance across what the turn still has to decide, so a
    // civ with twenty units does not cost twenty times a civ with one.
    const perTurn = this._turnBudgetMs ?? (cfg.timeBudgetMs * 2);
    const share = perTurn / this._decisionsLeft(observation, observation.activePlayers[0]);
    return {
      ...cfg,
      timeBudgetMs: this.opts.timeBudgetMs ?? Math.max(12, Math.min(cfg.timeBudgetMs, share)),
      // The pruned action set is narrow (≤ 6 branches), so the tree grows deep on
      // far fewer infosets than a wide game needs.
      maxInfosets: this.opts.maxInfosets ?? Math.min(cfg.maxInfosets, 1200),
      worlds: this.opts.particles ?? Math.min(cfg.worlds, 6),
    };
  }

  // Bounded above a realistic materiel swing (a large city is ~250) without
  // dwarfing it — see the header.
  _winValue() { return 20000; }

  _leafEval(observation, me) {
    const oppId = this._oppId(observation, me);
    return (state, mover, actions, childStates) =>
      childStates.map(cs => {
        if (!cs) return 0;
        const mine = sideScore(cs, mover, mover === me ? oppId : me);
        const theirs = sideScore(cs, mover === me ? oppId : me, mover);
        return mine - theirs;
      });
  }
}
