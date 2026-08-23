// ---------------------------------------------------------------------------
// Civ1 search-action pruning — what makes the generic Obscuro search tractable
// on this game.
//
// Civ1's raw legal-action set is nothing like chess's ~30 moves. A mid-game turn
// offers a few hundred actions (every unit × every reachable tile, plus a
// production choice per city, plus research / tax / luxury / government), and a
// *turn* is a long sequence of them rather than a single ply. Handing that to
// the extensive-form search directly is hopeless twice over: the branching
// factor swamps the tree, and — worse — most of the branching is pure
// permutation noise, since ordering unit A before unit B reaches the same
// position by a different path.
//
// So the search reasons over a pruned, canonically-ordered action set:
//
//   • ONE FOCUS UNIT AT A TIME. Units are ordered by id and only the first one
//     still holding moves is offered actions. This collapses the n! orderings of
//     a turn into a single canonical sequence without removing any reachable
//     position — the same set of turn outcomes remains, along one path each.
//   • TOP-K CANDIDATES PER DECISION, scored with the domain heuristics already
//     used by the heuristic agent (ai.js kill_desire for attacks, settle spacing
//     for cities, distance-to-target for movement).
//   • QUEUED MOVES DROPPED. queue-move/queue-pop are a UI convenience for
//     routing a spent unit across future turns; inside the search they are just a
//     second, redundant encoding of movement, and the baseline generic agent
//     drowned in them.
//   • END-TURN ONLY WHEN THE TURN IS ACTUALLY DONE. Offering it alongside unit
//     orders lets a shallow search "pass" its whole army every turn, which reads
//     as a fine leaf value (nothing was risked) and plays catastrophically.
//     Passing a *unit* is still available, explicitly, as skip-unit.
//
// This hook is wired in as `getSearchActions` (index.js) because that is the one
// hook the search consults for BOTH the root action set and every interior node
// (vendor/obscuro/src/search.js makeHooks). It must therefore be deterministic in
// (state, player) and depend only on what `player` can actually see — an
// infoset's action set is fixed at creation and re-derived per world to filter,
// so an rng-dependent or fog-piercing set would desync the tree. Every candidate
// is derived from getVisibleState(state, player).
// ---------------------------------------------------------------------------

import { UNITS } from './units.js';
import { TERRAIN } from './terrain.js';
import { killDesire, IMPROVEMENT_PRIORITY } from './ai.js';

// Horizontally-wrapped Chebyshev distance. Deliberately re-derived here rather
// than imported from Civ1Game.js: this module is installed onto the game object
// from index.js, and importing back into Civ1Game.js would close an import cycle.
function chebyshev(a, b, width) {
  const dx = Math.abs(a.x - b.x);
  return Math.max(Math.min(dx, width - dx), Math.abs(a.y - b.y));
}

// How many candidates survive per category. Small on purpose: the search's value
// comes from looking *ahead* along a few plausible lines, not from breadth.
const K_MOVES = 4;
const K_ATTACKS = 2;
const K_PRODUCTION = 3;

// Mirrors ai.js: don't found cities on the capital's doorstep.
const MIN_CITY_SPACING = 4;
const CITY_TARGET = 6;

// Won't trade into a coin flip (ai.js MIN_WIN_PROB) — but the search is allowed to
// look at slightly worse odds than the heuristic agent takes, because it can see
// what the position looks like afterwards.
const MIN_WIN_PROB = 0.4;

/**
 * How good a city site is: the yield of the centre tile plus the ring of tiles a
 * small city can actually work.
 *
 * This matters far more in civ1 than its size suggests. A city's food upkeep is
 * `size * 2`, so a site whose workable tiles yield exactly that nets zero surplus
 * and NEVER GROWS — and a city that never grows never raises its shield output
 * either. Such a city is not merely weak, it is inert for the rest of the game:
 * founded on turn 2, still size 1 with nothing built on turn 150. Both baseline
 * agents in this repo found their capital on whatever square the settler happens
 * to start on, and roughly half the time that is what they get.
 *
 * Scored per site so the search can price walking two tiles to grassland against
 * settling here now.
 */
export function siteValue(state, pos) {
  const W = state.board.width;
  let v = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = ((pos.x + dx) % W + W) % W;
      const tile = state.board.tiles[`${x},${pos.y + dy}`];
      const t = TERRAIN[tile?.terrain];
      if (!t) continue;
      const weight = (dx === 0 && dy === 0) ? 2 : 1; // the centre tile is always worked
      v += weight * (t.food * 3 + t.shields * 2 + t.trade);
    }
  }
  return v;
}

const topK = (scored, k) => scored
  .sort((a, b) => b.score - a.score)
  .slice(0, k)
  .map(s => s.action);

// ── Empire-wide choices ──────────────────────────────────────────────────────

// Research targets the search is allowed to consider, best first. Offering the
// full researchable frontier would spend the whole branching budget on a
// decision whose payoff is far beyond any reachable leaf.
const RESEARCH_PRIORITY = [
  'bronze-working', 'ceremonial-burial', 'code-of-laws', 'monarchy', 'pottery',
  'currency', 'trade', 'writing', 'literacy', 'masonry', 'construction',
  'iron-working', 'mathematics', 'the-wheel', 'the-republic',
];

// The empire sliders are a fixed policy rather than a searched decision, and the
// phase is DECLINED (returns nothing) once the policy is already satisfied. That
// second half matters more than it looks: getLegalActions only ever offers rates
// *other* than the current one, so a phase that always returns something can
// never leave a setting alone — an earlier version offered both 40% and 60% tax
// every turn and simply oscillated between them for the whole game, burning a
// decision per turn to accomplish nothing. Each target below is banded with
// hysteresis for the same reason.
function empireActions(legal, obs, playerId) {
  const out = [];
  const civ = obs.gameSpecific?.civ?.[playerId];
  if (!civ) return out;

  // Research: pick a target only when the current one isn't already on the
  // priority line — switching research part-way through throws away the progress.
  const research = legal.filter(a => a.type === 'set-research');
  if (research.length && !RESEARCH_PRIORITY.includes(civ.research)) {
    const byTech = new Map(research.map(a => [a.tech, a]));
    const pick = RESEARCH_PRIORITY.map(t => byTech.get(t)).find(Boolean);
    if (pick) out.push(pick);
  }

  // Tax: bank gold when the treasury is thin, buy science when it is fat. The
  // dead band between 60 and 120 gold keeps it from flipping every turn.
  const gold = civ.gold ?? 0;
  const wantTax = gold > 120 ? 40 : gold < 60 ? 60 : civ.taxRate;
  const tax = legal.find(a => a.type === 'set-tax' && a.taxRate === wantTax);
  if (tax) out.push(tax);

  // Luxuries: only once a city is big enough to actually risk disorder.
  const biggest = Math.max(0, ...obs.cities.filter(c => c.ownerId === playerId).map(c => c.size ?? 1));
  const wantLux = biggest >= 6 ? 20 : biggest <= 4 ? 0 : civ.luxRate;
  const lux = legal.find(a => a.type === 'set-luxury' && a.luxRate === wantLux);
  if (lux) out.push(lux);

  // Government: only ever toward the two that are a clear upgrade on Despotism.
  const gov = civ.government;
  if (gov && gov !== 'anarchy') {
    for (const target of ['republic', 'monarchy']) {
      if (gov === target) break;
      const a = legal.find(x => x.type === 'change-government' && x.government === target);
      if (a) { out.push(a); break; }
    }
  }

  return out;
}

// ── Production ───────────────────────────────────────────────────────────────

// Same priorities as ai.js chooseProduction: cover the defenders first, then
// expand, then invest, and only then shop for offense.
function scoreProduction(item, ctx) {
  const stats = UNITS[item];
  if (!stats) {
    // An improvement or wonder, ranked by ai.js's IMPROVEMENT_PRIORITY — civic
    // staples first, wonders well down the list. Scoring every building the same
    // (as this did at first) leaves the choice to sort order, and the agent
    // committed its size-1 capital to the Colossus for the whole game.
    const rank = IMPROVEMENT_PRIORITY.indexOf(item);
    // Off the priority list entirely (barracks, most wonders): a shield sink, and
    // scored low enough that a real defender still outbids it. Left above zero so
    // it remains preferable to a unit the empire cannot support.
    if (rank < 0) return 5;
    return 55 - rank * 2 + Math.min(15, ctx.citySize * 3);
  }
  let score = 0;
  if (!ctx.defended && stats.defense > 0 && item !== 'settlers') score += 100;
  if (item === 'settlers') score += ctx.wantExpansion ? 90 : -20;
  if (stats.attack > 0) score += 30 * (stats.attack * stats.moves) / Math.max(1, stats.cost);
  // Units past what the cities can support are worse than useless: under Despotism
  // a city supports `size` units free and pays a shield a turn for each one beyond
  // that, out of a gross yield of about five. Every agent in this repo, this one
  // included, used to march straight into that trap — six units homed on a size-2
  // capital left it netting one shield and zero food surplus, frozen at size 2 with
  // nothing finishable, for a hundred turns. Settlers are exempt: they cost food,
  // but they turn into the cities that raise the ceiling.
  if (ctx.overSupported && item !== 'settlers') score -= 70;
  return score;
}

// How much better an alternative must be before the search is even shown it.
// Without this the phase is a forced change — getLegalActions offers every item
// EXCEPT the one being built, so "keep building what we are building" is not an
// action and cannot be chosen. The first version of this file had no margin and
// the agent re-tasked its capital every single turn, finishing nothing in 40
// turns: barracks, then settlers, then barracks again, ending on a wonder it had
// no hope of completing.
const SWITCH_MARGIN = 15;

function productionActions(legal, obs, playerId) {
  const prod = legal.filter(a => a.type === 'set-production');
  if (!prod.length) return [];

  // Canonical order: only the lowest-id city with a pending choice is decided at
  // this node, for the same permutation-collapsing reason as the focus unit.
  const cityId = prod.map(a => a.cityId).sort()[0];
  const acts = prod.filter(a => a.cityId === cityId);
  const city = obs.cities.find(c => c.id === cityId);
  if (!city) return acts.slice(0, K_PRODUCTION);

  const defended = obs.units.some(u =>
    u.alive && u.ownerId === playerId && u.type !== 'settlers' && (UNITS[u.type]?.defense ?? 0) > 0 &&
    u.position.x === city.position.x && u.position.y === city.position.y);
  const myCities = obs.cities.filter(c => c.ownerId === playerId).length;
  const settlersOut = obs.units.filter(u => u.alive && u.ownerId === playerId && u.type === 'settlers').length;
  // Free unit support across the empire is the sum of city sizes (Despotism and
  // Monarchy support `size` units per city at no cost — see city.js shieldUpkeep).
  const supportCap = obs.cities.filter(c => c.ownerId === playerId)
    .reduce((n, c) => n + (c.size ?? 1), 0);
  const myUnits = obs.units.filter(u => u.alive && u.ownerId === playerId).length;

  const ctx = {
    defended,
    citySize: city.size ?? 1,
    wantExpansion: myCities + settlersOut < CITY_TARGET && (city.size ?? 1) >= 2,
    overSupported: myUnits >= supportCap,
  };

  const current = city.production ? scoreProduction(city.production, ctx) : -Infinity;
  const scored = acts
    .map(a => ({ action: a, score: scoreProduction(a.item, ctx) }))
    .filter(s => s.score > current + SWITCH_MARGIN);
  if (!scored.length) return [];
  return topK(scored, K_PRODUCTION);
}

// ── Unit orders ──────────────────────────────────────────────────────────────

// The unit whose orders this node decides: lowest id among those still able to
// act. Queued-move-only units (no moves left) are not offered anything.
function focusUnit(obs, playerId) {
  return obs.units
    .filter(u => u.alive && u.ownerId === playerId && u.movesLeft > 0)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0] ?? null;
}

function unitActions(legal, obs, playerId, unit) {
  const W = obs.board.width;
  const mine = legal.filter(a => a.unitId === unit.id);
  const out = [];

  // Attacks, priced by ai.js's kill_desire (shields destroyed × P(win) − shields
  // risked × P(lose)). Anything the odds don't justify is left out entirely.
  const unitById = new Map(obs.units.map(u => [u.id, u]));
  const attacks = [];
  for (const a of mine) {
    if (a.type !== 'attack') continue;
    const defender = unitById.get(a.targetId);
    if (!defender) continue;
    const { want, P } = killDesire(unit, defender, obs);
    if (P < MIN_WIN_PROB) continue;
    attacks.push({ action: a, score: want });
  }
  out.push(...topK(attacks, K_ATTACKS));

  const myCities = obs.cities.filter(c => c.ownerId === playerId);
  const nearestOwnCity = pos => myCities.reduce((d, c) => Math.min(d, chebyshev(pos, c.position, W)), Infinity);

  // Founding a city, when it isn't crowding one we already hold.
  const found = mine.find(a => a.type === 'found-city');
  if (found && nearestOwnCity(unit.position) >= MIN_CITY_SPACING) out.push(found);

  // One terraforming order (the settler's alternative to walking further).
  const terraform = mine.find(a =>
    a.type === 'irrigate' || a.type === 'build-mine' || a.type === 'build-road'
    || a.type === 'build-railroad' || a.type === 'clear-terrain');
  if (terraform) out.push(terraform);

  // A caravan standing in a city that is building a Wonder has exactly one thing
  // worth doing, and it is worth 50 shields — never prune it away.
  const helpWonder = mine.find(a => a.type === 'help-build-wonder');
  if (helpWonder) out.push(helpWonder);

  // Movement. Settlers look for somewhere worth living; everyone else closes on
  // the nearest thing worth taking, or explores outward when nothing is in sight.
  const moves = mine.filter(a => a.type === 'move');
  if (moves.length) {
    const isSettler = (UNITS[unit.type]?.special ?? []).includes('found-city');
    const enemies = obs.units.filter(u => u.alive && u.ownerId !== playerId).map(u => u.position);
    const enemyCities = obs.cities.filter(c => c.ownerId !== playerId).map(c => c.position);
    const targets = [...enemies, ...enemyCities];

    const scored = moves.map(a => {
      const tile = obs.board.tiles[`${a.to.x},${a.to.y}`];
      const t = TERRAIN[tile?.terrain] ?? null;
      let score = 0;
      if (isSettler && myCities.length < CITY_TARGET) {
        // Somewhere to live: fed, and not on top of a city we already hold.
        const spacing = nearestOwnCity(a.to);
        score += siteValue(obs, a.to);
        score += spacing >= MIN_CITY_SPACING ? 20 : spacing * 2;
      } else if (targets.length) {
        const d = targets.reduce((m, p) => Math.min(m, chebyshev(a.to, p, W)), Infinity);
        score += -d * 4 + (t?.defBonus ?? 0) * 10;
      } else {
        // Nothing visible: push outward from home to uncover the map.
        score += Math.min(12, nearestOwnCity(a.to)) * 2 + (t ? t.food + t.shields : 0);
      }
      return { action: a, score };
    });
    out.push(...topK(scored, K_MOVES));
  }

  // Standing still is always on the table — that is how a garrison holds a city.
  const skip = mine.find(a => a.type === 'skip-unit');
  if (skip) out.push(skip);

  return out;
}

// ── The hook ─────────────────────────────────────────────────────────────────

/**
 * Pruned, canonically-ordered search action set for `playerId` at `state`.
 * Derived entirely from getVisibleState(state, playerId) — see the module header.
 *
 * Because the set is fog-limited it can contain a move onto a square the player
 * cannot see is occupied. That is not a bug to fix here — narrowing the set with
 * knowledge the player doesn't have is exactly what would break the infoset
 * invariant above. The game accepts such a move and resolves it as a bump into
 * what was hiding there; see Civ1Game's isActionLegal and its 'move' handler.
 *
 * @param {object} game  the Civ1Game definition (for getVisibleState/getLegalActions)
 */
export function civ1SearchActions(game, state, playerId) {
  const obs = game.getVisibleState(state, playerId);
  const legal = game.getLegalActions(obs, playerId);
  if (legal.length <= 1) return legal;

  // Winning now beats anything else the search could weigh.
  const launch = legal.find(a => a.type === 'launch-spaceship');
  if (launch) return [launch];

  // Phases, in a fixed order, so each node decides exactly one kind of thing.
  // end-turn is offered only once nothing else is left to decide — see header.
  const empire = empireActions(legal, obs, playerId);
  if (empire.length) return empire;

  const production = productionActions(legal, obs, playerId);
  if (production.length) return production;

  const unit = focusUnit(obs, playerId);
  if (unit) {
    const acts = unitActions(legal, obs, playerId, unit);
    if (acts.length) return acts;
  }

  const end = legal.find(a => a.type === 'end-turn');
  return end ? [end] : legal.slice(0, 1);
}
