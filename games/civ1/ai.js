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
import { TERRAIN } from './terrain.js';
import { THIRDS } from './moves.js';
import { getCombatStrengths, pickDefender } from './combat.js';
import { chebyshevWrapped, BUILDABLE } from './Civ1Game.js';
import {
  productionContext, chooseProductionAction, defenceStrength, RESEARCH_PRIORITY,
} from './production.js';
import { wrapWidth, marchDistances } from './map.js';
import {
  siegeRole, siegeAttackFloor, siegeAttackWant, waitsForFullStrength, isMounted, atSiegeCity,
  chooseSiegeProduction, holdsFort,
} from './objective.js';

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
 * What beating `defender` destroys, in shields: the defender alone in a city or a
 * fortress, but on open ground everyone standing with it — the whole stack dies with
 * its defender there (Civ1Game's resolveAttack). Counting only the defender priced a
 * blow that wipes out a siege train and its escort at the escort's value alone.
 */
export function stakeOf(defender, state) {
  const pos = defender.position;
  const sheltered = state.board.tiles[`${pos.x},${pos.y}`]?.fortress
    || state.cities.some(c => c.position.x === pos.x && c.position.y === pos.y);
  if (sheltered) return shieldValue(defender);
  let stake = 0;
  for (const u of state.units) {
    if (u.alive && u.ownerId === defender.ownerId && u.position.x === pos.x && u.position.y === pos.y) stake += shieldValue(u);
  }
  return Math.max(stake, shieldValue(defender));
}

/**
 * Freeciv's kill_desire, in shields: what we stand to destroy times our chance
 * of destroying it, less what we stand to lose times the chance we lose it.
 * `delay` is turns until the blow lands (0 for an attack available right now).
 */
export function killDesire(attacker, defender, state, delay = 0) {
  const { att, def } = getCombatStrengths(attacker, defender, state);
  const p = att / (att + def);
  const P = winProbability(p, attacker.hp, defender.hp);
  const profit = stakeOf(defender, state) * P - shieldValue(attacker) * (1 - P);
  return { want: amortize(profit, delay), P };
}

// Don't trade into a coin flip: a won fight still costs HP, and the defender is
// usually the one sitting on the terrain bonus. Tunable — see AI-DESIGN.md.
const MIN_WIN_PROB = 0.5;

// The original greedy agent, kept verbatim as the baseline to measure against:
// attack whenever legal, settle whenever legal, else close on the nearest target
// by Manhattan distance. Both of those first two are why it loses.
const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export function makeGreedyAgent({ id = 'greedy', stackPenalty = STACK_PENALTY } = {}) {
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

      // The one thing this agent is not naive about: piling onto its own units. Until
      // units could share a square the engine refused those moves, so marching everyone
      // down one corridor cost nothing; now it puts the whole column on one combat roll
      // (STACK_PENALTY below, and see Civ1Game's stack death). A baseline that throws
      // armies away for free is no baseline, so it pays the same detour the heuristic
      // agent does — its own cities excepted, which is where a stack belongs.
      const minePos = new Set(state.units.filter(u => u.alive && u.ownerId === myId)
        .map(u => `${u.position.x},${u.position.y}`));
      const myCityPos = new Set(state.cities.filter(c => c.ownerId === myId)
        .map(c => `${c.position.x},${c.position.y}`));
      const stackCost = (to) => {
        const k = `${to.x},${to.y}`;
        return (minePos.has(k) && !myCityPos.has(k)) ? stackPenalty : 0;
      };

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
            const d = manhattan(m.to, nearest) + stackCost(m.to);
            if (d < bestScore) { bestScore = d; bestMove = m; }
          }
        }
        if (bestMove) return bestMove;
      }

      if (moves.length) {
        const center = { x: state.board.width / 2, y: state.board.height / 2 };
        const inward = m => manhattan(m.to, center) + stackCost(m.to);
        return moves.reduce((best, m) => inward(m) < inward(best) ? m : best);
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

// What a step onto a square one of our own units already holds is worth, in tiles of
// detour. Friendly units may share a square (civ1 stacks them), but an open square that
// loses its defence loses EVERY unit standing on it — see Civ1Game's resolveAttack — so
// a pile in the field is several units riding on one combat roll. Priced rather than
// forbidden: a unit whose only way forward is over a friend still takes it, and a
// square inside one of our cities costs nothing, because that is a garrison and a city
// dies one unit at a time.
const STACK_PENALTY = 3;

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

// Taking a city: the attackers' staging ring, in movement points from the city (two
// squares of open ground — beyond a one-move striker inside the walls, which can only
// hit the squares beside them, and one step from the walls, so the assault reaches
// them in a single move rather than spending a turn on the way), and when the
// assault goes in: once ASSAULT_SHARE of the army stands at the ring or within
// STAGE_DEPTH behind it (the ring is only so many squares long, and the rest of the
// army queues up behind it), or with ASSAULT_TURNS left on the clock whoever is there
// goes anyway.
const STAGE_DIST = 2;
const STAGE_DEPTH = 2;
const ASSAULT_SHARE = 0.6;
const ASSAULT_TURNS = 8;

// A sortie: a horseman in the besieged city steps out to strike at something two
// squares off, which it can only reach by leaving the walls — and then it stands
// outside them, spent, for the attackers' turn. So the blow is priced like any other
// (kill_desire, with the whole stack it would wipe out — stakeOf) and then charged
// SORTIE_EXPOSURE of the rider's own value for the night outside; it rides only when
// what is left is still a profit, and only at odds of SORTIE_MIN_WIN_PROB or better.
// What it is for is a siege train caught in the open: catapults defend at 1.
const SORTIE_MIN_WIN_PROB = 0.65;
const SORTIE_EXPOSURE = 0.5;

function sortie(unit, legalActions, state, myId) {
  if (unit.moveThirds < 2 * THIRDS) return null;   // a step out and a blow
  const enemiesAt = new Map();
  for (const u of state.units) {
    if (!u.alive || u.ownerId === myId) continue;
    const k = `${u.position.x},${u.position.y}`;
    if (!enemiesAt.has(k)) enemiesAt.set(k, []);
    enemiesAt.get(k).push(u);
  }
  let best = null, bestWant = 0;
  for (const m of legalActions) {
    if (m.type !== 'move' || m.unitId !== unit.id) continue;
    // One step out, with a move still in hand to strike with. A move action can cover
    // several squares, and a rider that spends its turn getting somewhere strikes
    // nothing until the attackers have had their turn at it.
    if (Math.max(Math.abs(m.to.x - unit.position.x), Math.abs(m.to.y - unit.position.y)) !== 1) continue;
    const cost = (TERRAIN[state.board.tiles[`${m.to.x},${m.to.y}`]?.terrain]?.moveCost ?? Infinity) * THIRDS;
    if (cost >= unit.moveThirds) continue;
    const rider = { ...unit, position: m.to, moveThirds: unit.moveThirds - cost };
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const stack = enemiesAt.get(`${m.to.x + dx},${m.to.y + dy}`);
      if (!stack || (dx === 0 && dy === 0)) continue;
      const defender = pickDefender(rider, stack, state);
      const { want, P } = killDesire(rider, defender, state);
      if (P < SORTIE_MIN_WIN_PROB) continue;
      const net = want - shieldValue(unit) * SORTIE_EXPOSURE;
      if (net > bestWant) { bestWant = net; best = m; }
    }
  }
  return best;
}

export function makeCiv1Agent({ id = 'heuristic', minWinProb = MIN_WIN_PROB, cityTarget = CITY_TARGET,
                                stackPenalty = STACK_PENALTY } = {}) {
  return {
    id,
    chooseAction(state, legalActions) {
      const W = wrapWidth(state.board);
      const myId = state.activePlayers[0];
      const unitById = new Map(state.units.map(u => [u.id, u]));
      // A fixed battle's objective, if this is one (objective.js) — null in the open game.
      const siege = siegeRole(state, myId);
      const inSiegeCity = pos => atSiegeCity(siege, pos);

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
          const choice = siege?.role === 'defender' && city.id === siege.cityId
            ? chooseSiegeProduction(city, acts)
            : chooseProduction(state, myId, city, acts, cityTarget);
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
        let { want, P } = killDesire(attacker, defender, state);
        // (A winner stays where it struck from — Civ1Game's resolveAttack — so the
        // besieged city's legion and the forts' legions strike from behind their walls
        // without leaving them.)
        // Taking it: the garrison is the objective, not a trade — every blow that
        // lands is a defender the assault no longer has to get through (objective.js).
        if (siege?.role === 'attacker' && inSiegeCity(defender.position)) {
          if (P < siegeAttackFloor(siege) || waitsForFullStrength(siege, attacker)) continue;
          want = siegeAttackWant(want, P);
        } else if (P < minWinProb) continue;
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

      // Detour cost of stepping onto our own units (STACK_PENALTY above). Added to every
      // move score below, all of which are distances in tiles, so the agent walks around
      // its own army instead of piling onto it — except into its cities, which are what
      // a stack is FOR.
      const minePos = new Set(myUnits.map(u => `${u.position.x},${u.position.y}`));
      const myCityPos = new Set(myCities.map(c => `${c.position.x},${c.position.y}`));
      const stackCost = (to) => {
        const k = `${to.x},${to.y}`;
        return (minePos.has(k) && !myCityPos.has(k)) ? stackPenalty : 0;
      };

      const garrison = new Map(); // unitId -> city (or fort) position it is holding
      const claimed = new Set();
      // Holding a siege, the forts come first: whoever stands in one stays in it, dug in,
      // for as long as it lives (objective.js holdsFort). That is all a fort is for —
      // every turn the attackers spend getting past it or digging it out is a turn off
      // their clock — and it is what the next rule would otherwise undo, by calling
      // every foot soldier on the map home on turn one.
      if (siege?.role === 'defender') {
        for (const u of myUnits) {
          if (!holdsFort(state, u)) continue;
          garrison.set(u.id, u.position);
          claimed.add(u.id);
        }
      }
      for (const city of myCities) {
        // The besieged city keeps everyone else it can call in, from anywhere — the
        // horsemen too, which ride out from it (sortie, below) and come back to it.
        if (siege?.role === 'defender' && city.id === siege.cityId) {
          for (const u of myUnits) {
            if (claimed.has(u.id) || defenceStrength(u.type) <= 0) continue;
            garrison.set(u.id, city.position);
            claimed.add(u.id);
          }
          continue;
        }
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
        // A horseman in the besieged city rides out at a blow worth the ride (sortie).
        const ride = atHome && siege?.role === 'defender' && isMounted(unit.type)
          && sortie(unit, legalActions, state, myId);
        if (ride) return ride;
        if (atHome) {
          // Under siege a garrison digs in rather than just standing there.
          const dig = siege?.role === 'defender'
            && legalActions.find(a => a.type === 'fortify' && a.unitId === unitId);
          if (dig) return dig;
          const skip = legalActions.find(a => a.type === 'skip-unit' && a.unitId === unitId);
          if (skip) return skip;
          continue;
        }
        const homeward = legalActions.filter(a => a.type === 'move' && a.unitId === unitId);
        if (homeward.length) {
          const home = m => chebyshevWrapped(m.to, cityPos, W) + stackCost(m.to);
          return homeward.reduce((best, m) => home(m) < home(best) ? m : best);
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
          const outward = m => nearestOwnCity(m.to) - stackCost(m.to);
          return settlerMoves.reduce((best, m) => outward(m) > outward(best) ? m : best);
        }
        if (here && nearestOwnCity(here) > 1) return found; // boxed in; take what we can get
      }

      // Garrisoned units are spoken for; everyone else advances.
      const moves = legalActions.filter(a => a.type === 'move' && !garrison.has(a.unitId));

      // ── The siege: march on the city ──────────────────────────────────────
      // Its square is known before anyone has seen it (objective.js), and it is the only
      // place worth marching to — a fort or a picket that has to be dealt with is dealt
      // with by the attacks above, from wherever the march brings a unit alongside it.
      // The way there is found, not steered by straight-line distance (marchDistances):
      // the forts' zones of control wall off the direct road, and a column steered at
      // the city walked up to that wall and paced back and forth along it until the
      // clock ran out. A unit with no step that gets it closer stays where it is.
      if (siege?.role === 'attacker') {
        const fields = new Map();   // per unit type: ZOC applies by type (ignore-zoc)
        const field = u => {
          if (!fields.has(u.type)) {
            fields.set(u.type, marchDistances(siege.cityPos, u, state.board, state.units, myId, state.cities));
          }
          return fields.get(u.type);
        };
        // …and it goes in together. Until the assault, nobody steps inside the staging
        // ring (STAGE_DIST): anything that comes up to the walls on its own spends the
        // defenders' turn standing beside them, where everything inside that can strike
        // takes it apart a stack at a time — the knights, which outpace everyone,
        // first. The assault starts once most of the army is at the
        // ring, or when the clock leaves no time to wait for the rest.
        const mine = state.units.filter(u => u.alive && u.ownerId === myId);
        const staged = mine.filter(u => (field(u).get(`${u.position.x},${u.position.y}`) ?? Infinity) <= STAGE_DIST + STAGE_DEPTH).length;
        const assault = staged >= ASSAULT_SHARE * mine.length || siege.turnsLeft <= ASSAULT_TURNS;
        let bestMove = null, bestGain = 0;
        for (const m of moves) {
          const unit = unitById.get(m.unitId);
          const f = field(unit);
          const here = f.get(`${m.from.x},${m.from.y}`) ?? Infinity;
          const there = f.get(`${m.to.x},${m.to.y}`) ?? Infinity;
          if (there === Infinity || (!assault && there < STAGE_DIST)) continue;
          const gain = (here === Infinity ? 0 : here - there) - stackCost(m.to);
          if (gain > bestGain) { bestGain = gain; bestMove = m; }
        }
        return bestMove ?? { type: 'end-turn', unitId: '__player__' };
      }

      // ── Move: close on the nearest target, in turns rather than tiles ────
      const enemies = state.units.filter(u => u.alive && u.ownerId !== myId);
      const enemyCities = state.cities.filter(c => c.ownerId !== myId);
      const targets = [...enemies.map(u => u.position), ...enemyCities.map(c => c.position)];
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
            const d = chebyshevWrapped(m.to, goal, W) + stackCost(m.to);
            if (d < bestScore) { bestScore = d; bestMove = m; }
          }
        }
        if (bestMove) return bestMove;
      }

      if (moves.length) {
        // Nothing in sight: drift toward the middle of the world — except a besieged
        // city's horsemen, who wait by the walls for something to ride out at rather
        // than wandering off to meet the whole army in the open.
        const center = siege?.role === 'defender' ? siege.cityPos
          : { x: state.board.width / 2, y: state.board.height / 2 };
        const inward = m => chebyshevWrapped(m.to, center, W) + stackCost(m.to);
        return moves.reduce((best, m) => inward(m) < inward(best) ? m : best);
      }

      return { type: 'end-turn', unitId: '__player__' };
    },
  };
}
