// Barbarians — the original Civilization's raiders, as a faction that owns units
// but never a seat.
//
// Civ1's setup screen asks for a "Barbarian activity" level before the world is
// generated; the same four settings are a game option here (see Civ1Game's
// gameOptions). What they switch on is deliberately NOT a third civilization:
// barbarians are dealt no seat, no agent is ever asked for their orders, they
// research nothing, build nothing, own no treasury, and getResult never counts them
// among the surviving civilizations — a world where only barbarians are left standing
// is still a world where the last real civ has won. They exist only as units owned by
// BARBARIAN_ID, rising up on their own schedule and taking their moves in a phase the
// game runs for them at the top of each turn (barbarianPhase, called from Civ1Game's
// 'end-turn' handler).
//
// The one part of the original that has no counterpart here is the hut: Civ1's lowest
// setting is "Villages Only", meaning barbarians emerge from tribal huts and from
// nowhere else. This engine has no huts, so that setting means no barbarians at all.

import { UNITS } from './units.js';
import { mintId, takenIds } from './ids.js';
import { TERRAIN } from './terrain.js';
import { wrapX, makeZoneOfControl } from './map.js';

// The owner id barbarian pieces carry. Never a member of state.players — every
// `ownerId !== playerId` test in the game already treats them as hostile to everyone,
// which is exactly right: barbarians have no allies.
export const BARBARIAN_ID = 'barbarian';

// How the client draws them (Civ1Game's toGrid hands this over as `extraTeams`, and
// apps/design/App.vue appends it after the seat teams).
//
// Violet, and the choice is constrained rather than decorative. civ1 sets
// ui.recolorTeamSprites, so a unit's team colour reaches the screen through
// apps/design/teamSprite.js, which repaints the sprite's green-ramp flag with the
// team colour's HUE and SATURATION only — and clamps saturation up to at least 0.75
// to keep teams vivid. Two consequences bite anyone picking a fifth colour here:
//   • A near-grey is impossible. Charcoal #43434c is hue 240° at saturation 0.06;
//     clamped to 0.75 it comes out a vivid blue all but identical to seat 1's, while
//     the city plaque (which uses the literal hex) stayed charcoal — the units and
//     the cities disagreed about who owned them.
//   • Only hue separates factions. Brick #8f4b2e is hue 20°, close enough to seat 2's
//     coral (hue 3°) that raiders read as that civ's units on a green map.
// Seat hues are 213 (blue), 3 (coral), 158 (green), 40 (amber); violet's 273 is the
// middle of the one wide gap left.
export const BARBARIAN_TEAM = { id: BARBARIAN_ID, name: 'Barbarians', color: '#9d4edd', raw: '#9d4edd' };

// The original's four settings, in its own order and under its own names.
//   firstTurn — no uprising before this turn (higher activity starts sooner)
//   interval  — turns between uprisings
//   band      — units per uprising
//   maxUnits  — barbarians alive worldwide before uprisings pause. Not one of the
//               original's numbers: it is what stops a band stranded on an island
//               nobody visits from accumulating into permanent map litter, since
//               nothing else ever removes a barbarian that finds no one to fight.
// The turn numbers are calibrated to THIS engine's clock, not the original's. A civ1
// game here runs on the order of a hundred turns, and a civ is still one small city
// with one militia in it at turn 20 — so the original's "nothing before 1000 BC"
// lands proportionally around turn 30 even at the most violent setting. Raiding
// earlier does not read as a barbarian menace, it reads as the game not letting you
// start: measured over greedy-vs-greedy games, a band of 4 arriving at turn 20 ended
// every single one within two turns, before either civ had a second city to lose.
export const BARBARIAN_LEVELS = {
  'villages-only':   { name: 'Villages only',   firstTurn: 0,  interval: 0,  band: 0, maxUnits: 0 },
  'roving-bands':    { name: 'Roving bands',    firstTurn: 50, interval: 25, band: 2, maxUnits: 6 },
  'restless-tribes': { name: 'Restless tribes', firstTurn: 38, interval: 18, band: 3, maxUnits: 12 },
  'raging-hordes':   { name: 'Raging hordes',   firstTurn: 28, interval: 12, band: 4, maxUnits: 20 },
};

export const BARBARIAN_LEVEL_IDS = Object.keys(BARBARIAN_LEVELS);

// Default: off. The original makes you pick on the setup screen, but leaving raiders
// out of every game by default keeps the agent measurements (which replay civ1 with
// nothing but the two seats) reading what they have always read — turning them on is
// one menu choice away.
export const DEFAULT_BARBARIAN_LEVEL = 'villages-only';

export function resolveBarbarianLevel(config = {}) {
  return BARBARIAN_LEVELS[config.barbarians] ? config.barbarians : DEFAULT_BARBARIAN_LEVEL;
}

// An uprising's units are era-appropriate: barbarians raid with what the civ they are
// raiding could field. Best (highest attack) type on this ladder whose advance the
// target already knows — militia needs none, so there is always an answer.
const RAIDER_LADDER = ['militia', 'legion', 'chariot', 'knights', 'crusaders', 'cav-modern', 'armor'];

// Uprisings appear this far from the city they are coming for: far enough that the
// defender gets a turn's warning, close enough to be a threat and not a wanderer.
const SPAWN_MIN = 2;
const SPAWN_MAX = 4;

const DIRS = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];

const key = p => `${p.x},${p.y}`;

// Cylindrical (east/west-wrapping) distances — the same geometry the rest of the game
// uses, kept local so this module has no import back into Civ1Game.js.
function wrapDX(ax, bx, width) {
  const d = Math.abs(wrapX(ax, width) - wrapX(bx, width));
  return Math.min(d, width - d);
}
function dist(a, b, width) {
  return Math.max(wrapDX(a.x, b.x, width), Math.abs(a.y - b.y));
}

function isLandTile(tile) {
  return !!tile && !!TERRAIN[tile.terrain]?.passable.land;
}

/**
 * The barbarians' whole turn: any uprising due this turn, then a move for every
 * raider on the map. Called once per game turn from the 'end-turn' handler, with a
 * `state` whose units/cities/turnNumber are already the new turn's.
 *
 * `deps` carries the three things that live in Civ1Game.js and would otherwise make
 * this an import cycle: makeUnit(id, ownerId, type, x, y, movesLeft),
 * applyMove(units, cities, board, playerId, unit, to) and
 * resolveAttack(state, units, cities, attackerId, targetId, rng).
 *
 * Returns { units, cities, nextId } — the caller assembles the state.
 */
export function barbarianPhase(state, rng, deps) {
  const spec = BARBARIAN_LEVELS[state.gameSpecific?.barbarians];
  let units = state.units;
  let cities = state.cities;
  let nextId = state.gameSpecific.nextId;
  if (!spec || spec.band === 0) return { units, cities, nextId };

  if (isUprisingTurn(spec, state.turnNumber) && countBarbarians(units) < spec.maxUnits) {
    const risen = uprising({ ...state, units, cities }, spec, rng, deps.makeUnit, nextId);
    units = risen.units;
    nextId = risen.nextId;
  }

  ({ units, cities } = raid({ ...state, units, cities }, rng, deps));
  return { units, cities, nextId };
}

function isUprisingTurn(spec, turnNumber) {
  return turnNumber >= spec.firstTurn && (turnNumber - spec.firstTurn) % spec.interval === 0;
}

function countBarbarians(units) {
  return units.filter(u => u.alive && u.ownerId === BARBARIAN_ID).length;
}

// ── Uprisings ─────────────────────────────────────────────────────────────────

// A band rises up near one of the world's cities. Bigger cities are likelier targets,
// so raids land on whoever is doing well — the original's habit of visiting the
// leading civ, without needing a score to read.
function uprising(state, spec, rng, makeUnit, nextId) {
  let units = state.units;

  const seatIds = new Set(state.players.map(p => p.id));
  const targets = state.cities.filter(c => seatIds.has(c.ownerId));
  // Nobody has founded anything yet: there is nothing out there to raid, and a band
  // spawned in empty wilderness would only wander. Wait for the next uprising.
  if (!targets.length) return { units, nextId };

  const target = pickWeighted(targets, c => Math.max(1, c.size), rng);
  const type = raiderType(state, target.ownerId);

  const spots = spawnSpots(state, target.position);
  const count = Math.min(spec.band, spots.length);
  const taken = takenIds(state.units, state.cities);
  for (let i = 0; i < count; i++) {
    const spot = spots.splice(Math.floor(rng() * spots.length), 1)[0];
    const minted = mintId('u', nextId, taken);
    nextId = minted.next; taken.add(minted.id);
    units = [...units, makeUnit(minted.id, BARBARIAN_ID, type, spot.x, spot.y, UNITS[type].moves)];
  }
  return { units, nextId };
}

function pickWeighted(items, weightOf, rng) {
  const total = items.reduce((s, it) => s + weightOf(it), 0);
  let r = rng() * total;
  for (const it of items) {
    r -= weightOf(it);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

function raiderType(state, targetOwnerId) {
  const techs = new Set(state.gameSpecific?.civ?.[targetOwnerId]?.techs ?? []);
  let best = 'militia';
  for (const t of RAIDER_LADDER) {
    const req = UNITS[t].tech;
    if (req && !techs.has(req)) continue;
    if (UNITS[t].attack > UNITS[best].attack) best = t;
  }
  return best;
}

// Empty, walkable, city-free land in the ring SPAWN_MIN..SPAWN_MAX around a city.
function spawnSpots(state, center) {
  const { board } = state;
  const W = board.width, H = board.height;
  const occupied = new Set(state.units.filter(u => u.alive).map(u => key(u.position)));
  const cityTiles = new Set(state.cities.map(c => key(c.position)));

  const spots = [];
  for (let dy = -SPAWN_MAX; dy <= SPAWN_MAX; dy++) {
    const y = center.y + dy;
    if (y < 0 || y >= H) continue;
    for (let dx = -SPAWN_MAX; dx <= SPAWN_MAX; dx++) {
      const ring = Math.max(Math.abs(dx), Math.abs(dy));
      if (ring < SPAWN_MIN || ring > SPAWN_MAX) continue;
      const x = wrapX(center.x + dx, W);
      const k = `${x},${y}`;
      if (!isLandTile(board.tiles[k]) || occupied.has(k) || cityTiles.has(k)) continue;
      spots.push({ x, y });
    }
  }
  return spots;
}

// ── The raid ──────────────────────────────────────────────────────────────────

// Every living raider takes its turn, in id order so the same rng replays the same
// raid. Barbarians want a city: they attack whatever is adjacent, walk into one left
// undefended, and otherwise march at the nearest one (falling back to the nearest
// unit when there is no city left to march on).
function raid(state, rng, deps) {
  const { board } = state;
  let units = state.units;
  let cities = state.cities;

  const ids = units
    .filter(u => u.alive && u.ownerId === BARBARIAN_ID)
    .map(u => u.id)
    .sort();

  for (const id of ids) {
    // Fresh moves for the barbarian turn — the equivalent of the per-player refresh
    // the 'end-turn' handler does for the seat about to play.
    units = units.map(u => u.id === id ? { ...u, movesLeft: UNITS[u.type].moves } : u);

    // One action per iteration; bounded because every branch either spends movement
    // or breaks out. The cap is above any unit's move allowance (armor's 3, and a
    // road can stretch that to 9 third-of-a-point steps).
    for (let guard = 0; guard < 12; guard++) {
      const unit = units.find(u => u.id === id);
      if (!unit || !unit.alive || unit.movesLeft <= 0) break;

      const victim = adjacentVictim(unit, units, cities, board.width);
      if (victim) {
        ({ units, cities } = deps.resolveAttack({ ...state, units, cities }, units, cities, id, victim.id, rng));
        break; // an attack spends the whole turn, win or lose
      }

      const step = nextStep(unit, units, cities, board);
      if (!step) break;
      ({ units, cities } = deps.applyMove(units, cities, board, BARBARIAN_ID, unit, step));
    }
  }

  return { units, cities };
}

// The neighbouring unit this raider goes for: whoever is holding a city first (that is
// what the band came for), then the softest target. "Adjacent" is the same wrapped
// Chebyshev ≤ 1 that getLegalActions uses for a player's own attacks.
function adjacentVictim(unit, units, cities, width) {
  const cityTiles = new Set(cities.map(c => key(c.position)));
  const candidates = units.filter(u =>
    u.alive && u.ownerId !== BARBARIAN_ID && dist(unit.position, u.position, width) === 1);
  if (!candidates.length) return null;

  const rank = t => (cityTiles.has(key(t.position)) ? 0 : 100) + UNITS[t.type].defense;
  return candidates.reduce((best, u) => (rank(u) < rank(best) ? u : best));
}

// One tile toward the goal. Greedy on wrapped Chebyshev distance rather than a real
// path search: raiders are supposed to be crude, and a band that walks into a mountain
// range and mills about there is behaving like the original's.
function nextStep(unit, units, cities, board) {
  const W = board.width;
  const goal = raidGoal(unit, units, cities, W);
  if (!goal) return null;

  // Raiders are bound by zones of control like anyone else, so a line of defenders
  // turns them aside instead of letting them stroll through. They are never sealed
  // in by it: the raid attacks whatever is adjacent before it considers a step
  // (barbarianPhase above), and a blockade is by definition standing next to them.
  const zocBlocks = makeZoneOfControl(board, units, cities, BARBARIAN_ID);

  let best = null, bestD = dist(unit.position, goal, W);
  for (const [dx, dy] of DIRS) {
    const y = unit.position.y + dy;
    if (y < 0 || y >= board.height) continue;
    const to = { x: wrapX(unit.position.x + dx, W), y };
    if (!canEnter(to, units, board)) continue;
    if (zocBlocks(unit, unit.position, to)) continue;
    const d = dist(to, goal, W);
    if (d < bestD) { bestD = d; best = to; }
  }
  return best;
}

// Nearest enemy city, or failing that the nearest enemy unit. A city the barbarians
// have already taken is not a goal — they have it.
function raidGoal(unit, units, cities, width) {
  const nearest = (list, posOf) => list.reduce((best, it) => {
    const d = dist(unit.position, posOf(it), width);
    return !best || d < best.d ? { d, pos: posOf(it) } : best;
  }, null);

  const city = nearest(cities.filter(c => c.ownerId !== BARBARIAN_ID), c => c.position);
  if (city) return city.pos;
  const enemy = nearest(units.filter(u => u.alive && u.ownerId !== BARBARIAN_ID), u => u.position);
  return enemy?.pos ?? null;
}

// Same rule a player's land move obeys: walkable land, no unit already standing there.
// A city square with nobody in it is enterable — and applyMove hands it over, which is
// how an undefended city falls to barbarians without a fight.
function canEnter(to, units, board) {
  const k = key(to);
  if (!isLandTile(board.tiles[k])) return false;
  return !units.some(u => u.alive && key(u.position) === k);
}
