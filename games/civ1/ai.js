// Civ1 heuristic agent. See AI-DESIGN.md for the sourcing and the rationale.
//
// This is the greedy agent's structure (demo/civ1-demo.js) with its two worst
// defects fixed: it measures distance with the metric the board actually uses,
// and it only attacks when the attack is worth making.
//
// Attack scoring follows Freeciv's kill_desire (doc/README.AI):
//   profit = shields_destroyed * P(win) - shields_risked * P(lose)
// valued in shields (unit build cost) and discounted for the turns spent getting
// there, via their amortize(). Civ1's own AI scored moves too, but the published
// reverse-engineering never recovered its weights, so we use Freeciv's.

import { UNITS } from './units.js';
import { getCombatStrengths } from './combat.js';
import { chebyshevWrapped, BUILDABLE } from './Civ1Game.js';
import {
  productionContext, chooseProductionAction, defenceStrength, RESEARCH_PRIORITY,
} from './production.js';

// Both priority lists and the production scorer live in production.js, shared with
// the search's pruner (searchActions.js) so the two agents cannot drift apart.
// Re-exported here because this module was their original home.
export { IMPROVEMENT_PRIORITY, RESEARCH_PRIORITY } from './production.js';

// Freeciv README.AI: amortize(benefit, delay) = benefit * ((MORT-1)/MORT)^delay,
// discounting a future payoff to its present value (MORT=24 ~ 4.3% per turn).
const MORT = 24;
export function amortize(benefit, delay) {
  return benefit * Math.pow((MORT - 1) / MORT, Math.max(0, delay));
}

/**
 * Probability the attacker wins the whole HP race, given per-round win chance
 * `p`. Civ1 combat is rounds of a Bernoulli trial; the loser of each round takes
 * 1 damage (firepower is always 1), so this is a race to zero. Exact, via the
 * recurrence f(a,d) = p*f(a,d-1) + (1-p)*f(a-1,d) — HP tops out at 30, so the
 * table is tiny.
 */
export function winProbability(p, atkHp, defHp) {
  if (atkHp <= 0) return 0;
  if (defHp <= 0) return 1;
  // prev[a] = f(a, d-1), cur[a] = f(a, d)
  let prev = new Array(atkHp + 1).fill(1);
  prev[0] = 0;
  let cur = prev;
  for (let d = 1; d <= defHp; d++) {
    cur = new Array(atkHp + 1);
    cur[0] = 0;
    for (let a = 1; a <= atkHp; a++) {
      cur[a] = p * prev[a] + (1 - p) * cur[a - 1];
    }
    prev = cur;
  }
  return cur[atkHp];
}

const shieldValue = unit => UNITS[unit.type]?.cost ?? 10;

/**
 * Freeciv's kill_desire, in shields: what we stand to destroy times our chance
 * of destroying it, less what we stand to lose times the chance we lose it.
 * `delay` is turns until the blow lands (0 for an attack available right now).
 */
export function killDesire(attacker, defender, state, delay = 0) {
  const { att, def } = getCombatStrengths(attacker, defender, state);
  const p = att / (att + def);
  const P = winProbability(p, attacker.hp, defender.hp);
  const profit = shieldValue(defender) * P - shieldValue(attacker) * (1 - P);
  return { want: amortize(profit, delay), P };
}

// Don't trade into a coin flip: a won fight still costs HP, and the defender is
// usually the one sitting on the terrain bonus. Tunable — see AI-DESIGN.md.
const MIN_WIN_PROB = 0.5;

// The original greedy agent, kept verbatim as the baseline to measure against:
// attack whenever legal, settle whenever legal, else close on the nearest target
// by Manhattan distance. Both of those first two are why it loses.
const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export function makeGreedyAgent({ id = 'greedy' } = {}) {
  return {
    id,
    chooseAction(state, legalActions) {
      const attack = legalActions.find(a => a.type === 'attack');
      if (attack) return attack;

      // A caravan sitting in a city that is building a Wonder: hand over the shields.
      // Without this the caravan is just a defenceless unit and gets marched at the
      // enemy with the rest of the army.
      const help = legalActions.find(a => a.type === 'help-build-wonder');
      if (help) return help;

      const found = legalActions.find(a => a.type === 'found-city');
      if (found) return found;

      const myId = state.activePlayers[0];
      const enemies = state.units.filter(u => u.alive && u.ownerId !== myId);
      const enemyCities = state.cities.filter(c => c.ownerId !== myId);
      const targets = [...enemies.map(u => u.position), ...enemyCities.map(c => c.position)];

      const moves = legalActions.filter(a => a.type === 'move');
      if (moves.length && targets.length) {
        const byUnit = new Map();
        for (const m of moves) {
          if (!byUnit.has(m.unitId)) byUnit.set(m.unitId, []);
          byUnit.get(m.unitId).push(m);
        }

        let bestMove = null, bestScore = Infinity;
        for (const [, unitMoves] of byUnit) {
          const from = unitMoves[0].from;
          const nearest = targets.reduce((b, t) => manhattan(from, t) < manhattan(from, b) ? t : b, targets[0]);
          for (const m of unitMoves) {
            const d = manhattan(m.to, nearest);
            if (d < bestScore) { bestScore = d; bestMove = m; }
          }
        }
        if (bestMove) return bestMove;
      }

      if (moves.length) {
        const center = { x: state.board.width / 2, y: state.board.height / 2 };
        return moves.reduce((best, m) => manhattan(m.to, center) < manhattan(best.to, center) ? m : best);
      }

      return { type: 'end-turn', unitId: '__player__' };
    },
  };
}

// How many cities to aim for before production swings from settlers to military.
// Freeciv's AI plays "small-pox" — many small cities — and expansion compounds,
// so this is deliberately not small.
const CITY_TARGET = 6;

// Minimum gap between our own cities, in turns of movement. Cities founded on the
// capital's doorstep add nothing; Civ1's workable radius is ~2 tiles either way.
const MIN_CITY_SPACING = 4;

// Most defenders any one city pins, and how far a second one may be summoned from.
// Together they stop a frightened city from recalling the whole army.
const MAX_GARRISON = 2;
const RECALL_RANGE = 4;

/**
 * Production choice for one city, delegated to the shared scorer in production.js
 * (see that module's header for the model). This used to be a fixed cascade —
 * defender, settler, first affordable improvement, best attacker per shield — and
 * each rung of it was wrong in a way the scorer fixes: the defender rung took the
 * cheapest body regardless of how good a defender it was, and the attacker rung
 * ranked by attack*moves/cost, which ties a militia with a legion.
 *
 * It also had no notion of what the city is already building. getLegalActions only
 * ever offers items OTHER than the current one, so a cascade that always returns
 * something can never leave a city alone: this agent walked its capital from
 * militia to phalanx to militia, one re-task per turn, finishing neither. The
 * shared chooseProductionAction returns null unless a candidate clears the current
 * build by SWITCH_MARGIN.
 */
function chooseProduction(state, myId, city, prodActions, cityTarget) {
  const ctx = productionContext(state, city, myId, { cityTarget });
  return chooseProductionAction(prodActions, ctx, city.production);
}

/**
 * The next advance to steer toward, or null to leave the current one alone.
 *
 * The null matters as much as the pick. getLegalActions offers every advance
 * EXCEPT the one being researched, so a chooser that always returns something can
 * never leave a target alone: this agent spent a decision every single turn
 * flipping between the top two entries of RESEARCH_PRIORITY — bronze-working on
 * odd turns, horseback-riding on even ones, for a hundred and fifty turns — which
 * is the same trap searchActions.js's empireActions guards against, and the same
 * one SWITCH_MARGIN guards against on the production side.
 */
function chooseResearch(researchActions, current) {
  if (RESEARCH_PRIORITY.includes(current)) return null;
  const byTech = new Map(researchActions.map(a => [a.tech, a]));
  for (const t of RESEARCH_PRIORITY) if (byTech.has(t)) return byTech.get(t);
  return researchActions[0] ?? null;
}

export function makeCiv1Agent({ id = 'heuristic', minWinProb = MIN_WIN_PROB, cityTarget = CITY_TARGET } = {}) {
  return {
    id,
    chooseAction(state, legalActions) {
      const W = state.board.width;
      const myId = state.activePlayers[0];
      const unitById = new Map(state.units.map(u => [u.id, u]));

      // ── Win outright if the spaceship is ready ───────────────────────────
      const launch = legalActions.find(a => a.type === 'launch-spaceship');
      if (launch) return launch;

      // ── Empire management: research target, government, tax rate ─────────
      // Each of these is offered at most once per turn (the game caps it), so
      // returning one here just spends one decision; it does not loop.
      const research = chooseResearch(
        legalActions.filter(a => a.type === 'set-research'),
        state.gameSpecific?.civ?.[myId]?.research);
      if (research) return research;

      // Move up to Monarchy (then the Republic) as soon as it is available — a big
      // jump over Despotism. Ignore the transient Anarchy while a revolution runs.
      const gov = state.gameSpecific?.civ?.[myId]?.government;
      const govActions = legalActions.filter(a => a.type === 'change-government');
      if (gov && gov !== 'anarchy' && govActions.length) {
        for (const target of ['republic', 'monarchy']) {
          if (gov === target) break; // already at or past our preferred government
          const a = govActions.find(x => x.government === target);
          if (a) return a;
        }
      }

      // Bias the treasury toward science (40% tax) once we have some gold buffer.
      const gold = state.gameSpecific?.civ?.[myId]?.gold ?? 0;
      const wantTax = gold > 80 ? 40 : 60;
      const taxAction = legalActions.find(a => a.type === 'set-tax' && a.taxRate === wantTax);
      if (taxAction) return taxAction;

      // Run 20% luxuries once any of our cities is large enough to risk disorder;
      // drop back to 0 when every city is small and content on its own.
      const biggest = Math.max(0, ...state.cities.filter(c => c.ownerId === myId).map(c => c.size));
      const wantLux = biggest >= 5 ? 20 : 0;
      const luxAction = legalActions.find(a => a.type === 'set-luxury' && a.luxRate === wantLux);
      if (luxAction) return luxAction;

      // ── Production: cheap, and only offered once per city per turn ───────
      const prodActions = legalActions.filter(a => a.type === 'set-production');
      if (prodActions.length) {
        const byCity = new Map();
        for (const a of prodActions) {
          if (!byCity.has(a.cityId)) byCity.set(a.cityId, []);
          byCity.get(a.cityId).push(a);
        }
        for (const [cityId, acts] of byCity) {
          const city = state.cities.find(c => c.id === cityId);
          if (!city) continue;
          const choice = chooseProduction(state, myId, city, acts, cityTarget);
          if (choice) return choice;
        }
      }

      // ── Attack: only when the exchange pays for itself ──────────────────
      let bestAttack = null, bestWant = 0;
      for (const a of legalActions) {
        if (a.type !== 'attack') continue;
        const attacker = unitById.get(a.unitId);
        const defender = unitById.get(a.targetId);
        if (!attacker || !defender) continue;
        const { want, P } = killDesire(attacker, defender, state);
        if (P < minWinProb) continue;
        if (want > bestWant) { bestWant = want; bestAttack = a; }
      }
      if (bestAttack) return bestAttack;

      // ── Garrison: hold each city to the strength production asks for ────
      // Production asks for a defender whenever a city is under-covered, so if every
      // unit marches on the enemy the city is permanently undefended and the build
      // queue never gets past defenders.
      //
      // The rule used to be "pin exactly one unit per city", and one unit is not what
      // the production scorer asks for — it asks for `defenceTarget` effective points
      // (production.js), which a lone militia does not meet. The two then fought each
      // other in a loop that ran for entire games: the city bought a militia, this
      // block pinned one defender and marched the new one off to the front, the city
      // found itself under-covered again and bought another. That is most of the
      // answer to "why is my empire nothing but militia" — the garrison was a sieve,
      // and the granary underneath it never finished.
      //
      // So hold to the same number the scorer uses. Capped at MAX_GARRISON, and only
      // the first defender is recalled from any distance: without that cap a
      // threatened city (whose target rises with what it can see) would summon the
      // entire field army home and the war would stop.
      const myCities = state.cities.filter(c => c.ownerId === myId);
      const myUnits = state.units.filter(u => u.alive && u.ownerId === myId);
      const garrison = new Map(); // unitId -> city position it is holding
      const claimed = new Set();
      for (const city of myCities) {
        const ctx = productionContext(state, city, myId, { cityTarget });
        const candidates = myUnits
          .filter(u => !claimed.has(u.id) && u.type !== 'settlers' && defenceStrength(u.type) > 0)
          .sort((a, b) => chebyshevWrapped(a.position, city.position, W) - chebyshevWrapped(b.position, city.position, W));
        let held = 0, pinned = 0;
        for (const u of candidates) {
          if (held >= ctx.defenceTarget || pinned >= MAX_GARRISON) break;
          const dist = chebyshevWrapped(u.position, city.position, W);
          if (pinned > 0 && dist > RECALL_RANGE) break; // don't strip the front line
          garrison.set(u.id, city.position);
          claimed.add(u.id);
          held += defenceStrength(u.type) * ctx.defenceFactor;
          pinned += 1;
        }
      }
      for (const [unitId, cityPos] of garrison) {
        const unit = unitById.get(unitId);
        if (!unit) continue;
        const atHome = unit.position.x === cityPos.x && unit.position.y === cityPos.y;
        if (atHome) {
          const skip = legalActions.find(a => a.type === 'skip-unit' && a.unitId === unitId);
          if (skip) return skip;
          continue;
        }
        const homeward = legalActions.filter(a => a.type === 'move' && a.unitId === unitId);
        if (homeward.length) {
          return homeward.reduce(
            (best, m) => chebyshevWrapped(m.to, cityPos, W) < chebyshevWrapped(best.to, cityPos, W) ? m : best,
          );
        }
      }

      // ── Caravans deliver ────────────────────────────────────────────────
      const help = legalActions.find(a => a.type === 'help-build-wonder');
      if (help) return help;

      // ── Settle, but not on top of ourselves ─────────────────────────────
      const myCityPositions = myCities.map(c => c.position);
      const nearestOwnCity = pos => myCityPositions.reduce(
        (d, c) => Math.min(d, chebyshevWrapped(pos, c, W)), Infinity,
      );
      const found = legalActions.find(a => a.type === 'found-city');
      if (found) {
        const here = unitById.get(found.unitId)?.position;
        if (here && nearestOwnCity(here) >= MIN_CITY_SPACING) return found;
        // Too close to home — walk the settler outward instead of wasting it.
        const settlerMoves = legalActions.filter(a => a.type === 'move' && a.unitId === found.unitId);
        if (settlerMoves.length) {
          return settlerMoves.reduce(
            (best, m) => nearestOwnCity(m.to) > nearestOwnCity(best.to) ? m : best,
          );
        }
        if (here && nearestOwnCity(here) > 1) return found; // boxed in; take what we can get
      }

      // ── Move: close on the nearest target, in turns rather than tiles ────
      const enemies = state.units.filter(u => u.alive && u.ownerId !== myId);
      const enemyCities = state.cities.filter(c => c.ownerId !== myId);
      const targets = [...enemies.map(u => u.position), ...enemyCities.map(c => c.position)];

      // Garrisoned units are spoken for; everyone else advances.
      const moves = legalActions.filter(a => a.type === 'move' && !garrison.has(a.unitId));
      if (moves.length && targets.length) {
        const byUnit = new Map();
        for (const m of moves) {
          if (!byUnit.has(m.unitId)) byUnit.set(m.unitId, []);
          byUnit.get(m.unitId).push(m);
        }

        let bestMove = null, bestScore = Infinity;
        for (const [, unitMoves] of byUnit) {
          const from = unitMoves[0].from;
          const goal = targets.reduce(
            (best, t) => chebyshevWrapped(from, t, W) < chebyshevWrapped(from, best, W) ? t : best,
            targets[0],
          );
          for (const m of unitMoves) {
            const d = chebyshevWrapped(m.to, goal, W);
            if (d < bestScore) { bestScore = d; bestMove = m; }
          }
        }
        if (bestMove) return bestMove;
      }

      if (moves.length) {
        const center = { x: state.board.width / 2, y: state.board.height / 2 };
        return moves.reduce(
          (best, m) => chebyshevWrapped(m.to, center, W) < chebyshevWrapped(best.to, center, W) ? m : best,
        );
      }

      return { type: 'end-turn', unitId: '__player__' };
    },
  };
}
