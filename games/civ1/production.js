// ---------------------------------------------------------------------------
// Civ1 production scoring — what a city should build, in ONE place.
//
// Two callers share this module and must not drift apart, because they are the
// same judgement made at different depths:
//
//   • ai.js chooseProduction — the heuristic agent's whole answer.
//   • searchActions.js productionActions — the top-K the Obscuro search is even
//     shown, so anything scored low here is never searched at all.
//
// It replaces a scorer that asked only "does this unit have defense > 0?" and
// then ranked candidates by attack*moves per shield. Both halves of that were
// wrong in ways that showed up on the board as an empire of nothing but militia:
//
//   • The defence bonus was FLAT (+100 for any defender), so the cheapest body
//     always won: a militia outbid a phalanx 103 to 101.5, and SWITCH_MARGIN
//     then hid the phalanx entirely. Defence is not a boolean — a phalanx is
//     twice the unit for twice the shields, and in Civ1's one-on-one combat that
//     is a straight improvement, not a wash.
//   • attack*moves/cost ties militia, archers, legion and catapult at exactly
//     the same score, and ties broke on key order in UNITS (militia first).
//     Three militia lose to one legion, so shield-efficiency alone is the wrong
//     objective: concentration is what wins fights.
//
// The model here is "effective defence points", the same currency on both sides
// of the comparison:
//
//   defence a unit contributes = defence x (hp/10) x veteran/fortify x CITY FACTOR
//   defence the city wants      = a peacetime floor + the strength of what it can
//                                actually see coming
//
// The city factor (its terrain, the +50% for being a city at all, x3 for Walls —
// see combat.js) multiplies both, so a hill city behind walls correctly wants far
// less garrison than a city on grassland. And because the wanted total is measured
// against the attack strength of visible enemies, the two sides are commensurate.
//
// On top of that sits the thing that makes this a *production* decision rather
// than a shopping list: TIME. A phalanx is worth more than a militia, but it is
// worth more in twenty turns' time, and a size-1 city on one shield a turn may
// not have twenty turns. Every defensive score is therefore discounted by how
// long the build takes, and anything that lands after the visible threat arrives
// is discounted hard again — which is what finally lets a militia win the pick,
// in exactly the case where a militia is the right answer: something is coming
// and it is the only thing that can be standing there in time.
// ---------------------------------------------------------------------------

import { UNITS } from './units.js';
import { TERRAIN } from './terrain.js';
import { computeCity } from './city.js';
import { buildOwnerCtx, buildCost } from './economy.js';

// Horizontally-wrapped Chebyshev distance. Re-derived here rather than imported
// from Civ1Game.js for the same reason searchActions.js re-derives it: this module
// is pulled in by ai.js, which Civ1Game.js's own action list reaches, and importing
// back would close an import cycle.
function chebyshev(a, b, width) {
  const dx = Math.abs(a.x - b.x);
  return Math.max(Math.min(dx, width - dx), Math.abs(a.y - b.y));
}

// ── Tunables ────────────────────────────────────────────────────────────────

// Effective defence points a city wants with no enemy in sight — one phalanx
// behind a city's own +50%, or a pair of militia. Below this the city is judged
// to still want a defender; at or above it, defenders score zero and the city
// moves on to settlers and improvements.
const DEFENCE_FLOOR = 3;

// What a point of closed defensive gap is worth, against the ~40-70 an economic
// building scores and the 90 a wanted settler scores. High enough that an
// uncovered city buys a defender first, low enough that a covered one doesn't.
const DEFENCE_WEIGHT = 120;

// Turns of waiting that halve a build's score (score is divided by 1 + turns/PATIENCE,
// so PATIENCE turns costs a factor of 2). Eight is deliberately patient: a good
// defender is usually worth waiting for, and only a *visible* threat should make
// the agent panic-buy — which the lateness penalty below does instead.
const PATIENCE = 8;

// What a build is worth when it cannot possibly finish before the nearest visible
// attacker arrives. Not zero: the threat may be deterred, may be aimed elsewhere,
// and the unit is still worth having afterwards — but a defender that shows up
// after the city falls is not defence.
const LATE_ARRIVAL = 0.35;

// How far ahead a hostile unit is worth reacting to, in turns of its own movement.
// Beyond this the "threat" is really just a unit existing somewhere on the map.
const THREAT_HORIZON = 6;

// How far away one of our own units still counts as a reinforcement, in turns of
// its movement. A defender three turns out is a reason not to start a second one;
// a defender ten turns out is not.
const REINFORCE_HORIZON = 3;

// Offence: shield-efficiency still matters (shields are the scarce resource), but
// it gets a companion term in ABSOLUTE strength so that concentration wins the
// ties efficiency leaves — militia and legion are equally efficient, and the
// legion is the unit that wins the fight. Capped so that a late-game armour rush
// cannot swamp the defensive and economic terms outright.
const OFFENCE_PER_SHIELD = 120;
const OFFENCE_ABSOLUTE = 4;
const OFFENCE_CAP = 60;

// City Walls: worth shields only where there is already a garrison to triple and
// something to stop. Quartered when no threat is visible so it stays a reaction
// rather than a habit.
const WALLS_WEIGHT = 50;
const WALLS_IDLE = 0.25;

// Units past what the cities can support are worse than useless: under Despotism a
// city supports `size` units free and pays a shield a turn for each one beyond
// that, out of a gross yield of about five. Every agent in this repo used to march
// straight into that trap — six units homed on a size-2 capital left it netting one
// shield and zero food surplus, frozen at size 2 with nothing finishable, for a
// hundred turns. Settlers are exempt: they cost food, but they turn into the cities
// that raise the ceiling.
const OVER_SUPPORT_PENALTY = 70;

// How much better an alternative must be before it is worth re-tasking a city.
// Without this the choice is a forced change — getLegalActions offers every item
// EXCEPT the one being built, so "keep building what we are building" is not an
// action and cannot be chosen. Both callers used to churn: the search agent
// re-tasked its capital every single turn and finished nothing in 40 (barracks,
// settlers, barracks, ending on a wonder it had no hope of completing), and the
// heuristic agent walked its capital up the defender list — militia this turn,
// phalanx the next — for the same reason.
export const SWITCH_MARGIN = 15;

// ── Unit strength ───────────────────────────────────────────────────────────

// HP is the other half of a Civ1 unit's durability: musketeers are defence 3 with
// 20 hp, and lose to nothing an early phalanx (defence 2, 10 hp) survives. Both
// strengths are therefore measured in "militia units" — defence x hp, normalised
// so a militia is exactly 1.
export function defenceStrength(type) {
  const s = UNITS[type];
  if (!s || s.defense <= 0) return 0;
  return s.defense * (s.hp / 10);
}

// Attack strength, same currency, with movement as a mild multiplier rather than a
// linear one. Moves matter for an attacker — a 2-move unit picks its fights and
// retreats from the ones it loses — but a chariot is not twice the unit a legion
// is, which is what the old attack*moves made it.
export function attackStrength(type) {
  const s = UNITS[type];
  if (!s || s.attack <= 0) return 0;
  return s.attack * (s.hp / 10) * Math.sqrt(s.moves);
}

// A unit standing where it is now: veteran and dug-in both multiply defence by 1.5
// in combat.js, so both belong in what the city can already count on.
function standingDefence(unit) {
  let d = defenceStrength(unit.type);
  if (unit.attrs?.veteran) d *= 1.5;
  if (unit.attrs?.fortified) d *= 1.5;
  return d;
}

// Everything defending this square is multiplied by the same factors (combat.js
// getCombatStrengths): the tile's terrain bonus, +50% for being a city, and x3 for
// City Walls or the Great Wall against land attackers. Folding it in here is what
// makes "how much defence does this city want" answerable in the same units as
// "how strong is the army walking toward it".
function cityDefenceFactor(state, city, hasWalls) {
  const tile = state.board.tiles[`${city.position.x},${city.position.y}`];
  const terrain = TERRAIN[tile?.terrain];
  let f = 1 + (terrain?.defBonus ?? 0);
  f *= 1.5;
  if (hasWalls) f *= 3;
  return f;
}

// ── Context ─────────────────────────────────────────────────────────────────

/**
 * Everything scoreProduction needs about one city's situation. Built once per
 * decision (not once per candidate) because the expensive part — computeCity, for
 * the shields-per-turn that turns a cost into a number of turns — is the same for
 * every item on the list.
 *
 * `state` may be a fog-limited view (searchActions.js derives everything from
 * getVisibleState, and must: an infoset's action set has to depend only on what
 * the player can see). That is not an approximation to apologise for here — the
 * threat term SHOULD only see the enemies the player can see. Our own cities,
 * units and worked tiles are always visible, so the cover and shield terms are
 * exact either way.
 */
export function productionContext(state, city, playerId, { cityTarget = 6 } = {}) {
  const W = state.board.width;
  const myCities = state.cities.filter(c => c.ownerId === playerId);
  const otherCityKeys = new Set(
    myCities.filter(c => c.id !== city.id).map(c => `${c.position.x},${c.position.y}`));

  // Shields per turn, from the same computeCity the end-of-turn economy runs. One
  // call per decision; getVisibleState (which every search node already pays for)
  // is far dearer, so this is not the term that matters for search throughput.
  let shieldsPerTurn = 1;
  try {
    if (state.gameSpecific?.civ?.[playerId]) {
      shieldsPerTurn = computeCity(city, buildOwnerCtx(state, playerId)).shields;
    }
  } catch {
    // A partial view (a captured city mid-turn, a test fixture without a full
    // economy) must not take the whole action list down with it. One shield a turn
    // is the pessimistic floor and only makes the agent more patient.
    shieldsPerTurn = 1;
  }

  const buildings = new Set(city.buildings ?? []);
  const factor = cityDefenceFactor(state, city, buildings.has('city-walls'));

  // Cover: the defence this city can count on soon — its garrison now, plus our
  // other defenders close enough to walk back, discounted by the walk. A unit
  // already standing on another of our cities is NOT a reinforcement: pulling it
  // out just moves the hole.
  let cover = 0;
  for (const u of state.units) {
    if (!u.alive || u.ownerId !== playerId || u.type === 'settlers') continue;
    const strength = standingDefence(u);
    if (strength <= 0) continue;
    const key = `${u.position.x},${u.position.y}`;
    if (otherCityKeys.has(key)) continue;
    const dist = chebyshev(u.position, city.position, W);
    const eta = Math.ceil(dist / Math.max(1, UNITS[u.type].moves));
    if (eta > REINFORCE_HORIZON) continue;
    cover += (strength * factor) / (1 + eta / PATIENCE);
  }

  // Threat: the nearest and the strongest visible hostile attacker inside the
  // horizon. Nearest sets the deadline, strongest sets how much defence is wanted —
  // a scouting cavalry and an army of legions are not the same warning.
  let threatEta = null, threatStrength = 0;
  for (const u of state.units) {
    if (!u.alive || u.ownerId === playerId) continue;
    const strength = attackStrength(u.type);
    if (strength <= 0) continue;
    const dist = chebyshev(u.position, city.position, W);
    const eta = Math.ceil(dist / Math.max(1, UNITS[u.type].moves));
    if (eta > THREAT_HORIZON) continue;
    if (threatEta == null || eta < threatEta) threatEta = eta;
    threatStrength = Math.max(threatStrength, strength);
  }

  const settlersOut = state.units.filter(
    u => u.alive && u.ownerId === playerId && u.type === 'settlers').length;
  const supportCap = myCities.reduce((n, c) => n + (c.size ?? 1), 0);
  const myUnits = state.units.filter(u => u.alive && u.ownerId === playerId).length;

  return {
    citySize: city.size ?? 1,
    banked: city.shields ?? 0,
    shieldsPerTurn,
    defenceFactor: factor,
    hasWalls: buildings.has('city-walls'),
    cover,
    // What the city wants, in the same effective-defence points as `cover`: a
    // peacetime floor, raised by whatever it can see coming.
    defenceTarget: DEFENCE_FLOOR + threatStrength,
    threatEta,
    wantExpansion: myCities.length + settlersOut < cityTarget && (city.size ?? 1) >= 2,
    overSupported: myUnits >= supportCap,
  };
}

// Turns until this city finishes `item`, counting the shields already banked. A
// city producing nothing (disorder, or every worked tile eaten by unit upkeep)
// would divide by zero and rank everything as infinitely far away, so one shield
// a turn is the floor — optimistic, and only ever makes the agent patient.
export function turnsToBuild(item, ctx) {
  const remaining = Math.max(0, buildCost(item) - ctx.banked);
  return Math.ceil(remaining / Math.max(1, ctx.shieldsPerTurn));
}

// ── Scoring ─────────────────────────────────────────────────────────────────

// Waiting discount, shared by every timed term so they stay comparable.
const patience = turns => 1 / (1 + turns / PATIENCE);

function defenceScore(item, ctx) {
  const gap = ctx.defenceTarget - ctx.cover;
  if (gap <= 0) return 0;
  const strength = defenceStrength(item) * ctx.defenceFactor;
  if (strength <= 0) return 0;
  const turns = turnsToBuild(item, ctx);
  // No credit for overkill: the third phalanx in a quiet city is not three times
  // the first. Capping at the gap is also what lets a cheap body win the top-up —
  // once a phalanx is home, a militia closes the remaining sliver just as well and
  // does it in half the time.
  const closes = Math.min(gap, strength);
  const late = ctx.threatEta != null && turns > ctx.threatEta ? LATE_ARRIVAL : 1;
  return DEFENCE_WEIGHT * closes * late * patience(turns);
}

function offenceScore(item) {
  const strength = attackStrength(item);
  if (strength <= 0) return 0;
  const cost = Math.max(1, buildCost(item));
  return Math.min(OFFENCE_CAP, OFFENCE_PER_SHIELD * (strength / cost) + OFFENCE_ABSOLUTE * strength);
}

// A building or wonder, ranked by IMPROVEMENT_PRIORITY. Scoring every building the
// same (as this once did) leaves the choice to sort order, and the agent committed
// its size-1 capital to the Colossus for the whole game.
function buildingScore(item, ctx) {
  if (item === 'city-walls' && !ctx.hasWalls) {
    // Walls multiply the garrison rather than adding to it, so their worth is the
    // extra defence they would confer on what is already standing there — nothing
    // in an empty city, a great deal in a garrisoned one under threat.
    const turns = turnsToBuild(item, ctx);
    const gained = Math.min(ctx.cover * 2, ctx.defenceTarget);
    const urgency = ctx.threatEta != null ? 1 : WALLS_IDLE;
    return WALLS_WEIGHT * gained * urgency * patience(turns) / Math.max(1, ctx.defenceFactor);
  }
  const rank = IMPROVEMENT_PRIORITY.indexOf(item);
  // Off the priority list entirely (barracks, most wonders): a shield sink, scored
  // low enough that a real defender still outbids it. Left above zero so it remains
  // preferable to a unit the empire cannot support.
  if (rank < 0) return 5;
  return 55 - rank * 2 + Math.min(15, ctx.citySize * 3);
}

/**
 * What `item` is worth to this city right now. Higher is better; the scale is
 * shared across units, improvements and wonders, so the three compete directly.
 */
export function scoreProduction(item, ctx) {
  const stats = UNITS[item];
  if (!stats) return buildingScore(item, ctx);

  // Settlers are the expansion decision, not a military one: they have defence 1
  // but get captured rather than defending, so they never count as cover.
  if (item === 'settlers') return ctx.wantExpansion ? 90 : -20;

  let score = defenceScore(item, ctx) + offenceScore(item);
  if (ctx.overSupported) score -= OVER_SUPPORT_PENALTY;
  return score;
}

/**
 * The single production pick, applied to the actions the game is actually
 * offering. `current` is what the city is building now — absent from `actions`,
 * since getLegalActions only offers changes, so it has to be scored separately or
 * the choice becomes a forced change every turn (see SWITCH_MARGIN).
 *
 * Returns the chosen action, or null to leave the city on what it has.
 */
export function chooseProductionAction(actions, ctx, current) {
  const currentScore = current ? scoreProduction(current, ctx) : -Infinity;
  let best = null, bestScore = currentScore + SWITCH_MARGIN;
  for (const a of actions) {
    const score = scoreProduction(a.item, ctx);
    if (score > bestScore) { bestScore = score; best = a; }
  }
  return best;
}

/**
 * The same decision as a ranked list, for the search's top-K. Empty when nothing
 * beats what the city is already building — which is how the search gets to leave
 * a city alone, since "keep building this" is not an offered action.
 */
export function rankProductionActions(actions, ctx, current, k) {
  const floor = (current ? scoreProduction(current, ctx) : -Infinity) + SWITCH_MARGIN;
  return actions
    .map(a => ({ action: a, score: scoreProduction(a.item, ctx) }))
    .filter(s => s.score > floor)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(s => s.action);
}

// ── Priority lists ──────────────────────────────────────────────────────────

// Economic buildings and wonders worth queueing once expansion is under way, best
// first. Wonders are interleaved after the cheap staples: they are dear, so only a
// city with spare production and the right advance ever reaches them.
export const IMPROVEMENT_PRIORITY = [
  'temple', 'granary', 'marketplace', 'library',
  'pyramids', 'hanging-gardens', 'great-library',
  'aqueduct', 'bank', 'university', 'copernicus', 'michelangelo',
  'city-walls', 'colosseum', 'factory',
  // Endgame: race to build and stock the spaceship once Apollo is up.
  'apollo', 'ss-structural', 'ss-component', 'ss-module',
];

// Advances to steer toward, in order, shared by the heuristic agent and the
// search's research phase (which used to keep a second, silently different copy of
// this list). Anything not named here is picked only once these are exhausted.
//
// The three prerequisite-free military advances come early on purpose. Bronze
// Working is the phalanx, the early defender the whole scoring model above wants
// to be able to buy. Horseback Riding was missing from this list ENTIRELY, and
// Iron Working sat twelfth — so for the first dozen advances the only attacker any
// agent here could build was the militia, and "why is it all militia" had an
// answer in the research order as much as in the production scoring. Cavalry (the
// first unit that beats a militia per shield) and the legion are now two and four
// advances away instead of twelve.
export const RESEARCH_PRIORITY = [
  'bronze-working', 'horseback-riding', 'ceremonial-burial', 'iron-working',
  'code-of-laws', 'monarchy', 'pottery', 'currency', 'trade', 'writing',
  'literacy', 'masonry', 'construction', 'the-wheel', 'mathematics',
  'the-republic', 'philosophy', 'university', 'banking', 'the-corporation',
  'gunpowder', 'invention',
];
