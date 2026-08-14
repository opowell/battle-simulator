import { unitStrengthEval, sidesEval } from '../evalHelpers.js';
import { TERRAIN } from './terrain.js';
import { UNITS } from './units.js';
import { resolveCombat } from './combat.js';
import { mulberry32, generateMap, findStartPos, findAdjacentFree, getReachableTiles, renderMap, wrapX } from './map.js';
import { getCiv1Belief } from './belief.js';
import { pickCoastTile } from './coastSprites.js';
import { specialAt, tileYield } from './specials.js';
import { FIXED_MAPS, parseFixedMap, getFixedMap } from './fixedMaps.js';
import { TECHS, researchableTechs, techCost } from './tech.js';
import { IMPROVEMENTS, WONDERS, SPACESHIP, SPACESHIP_MIN, wonderEffectsFor, wonderBuiltInWorld } from './improvements.js';
import { GOVERNMENTS, availableGovernments } from './governments.js';
import { foodBox, computeCity, FAT_CROSS, workedTileYield } from './city.js';
import { newCivState, buildOwnerCtx, buildableForCity, buildCost, processOwnerEconomy } from './economy.js';
import { DIFFICULTIES, DIFFICULTY_IDS, DEFAULT_DIFFICULTY, resolveRules } from './difficulty.js';
import { queueMoveActions, queuePopAction, enqueueWaypoint, dequeueLastWaypoint, runQueuedMoves } from '../moveQueue.js';
import * as ST from '../spacetime.js';

const BASE = '/images/civ1';

// ── The single movement spec (games/spacetime.js) ─────────────────────────────
// civ1's one movement fact is a unit's `moves` (units.js). The framework turns it
// into the per-turn budget (discrete time — what the turn refresh below hands out)
// and the per-move cooldown (continuous time — getActionDuration). civ1 keeps its
// own richer discrete enumerator (getReachableTiles: terrain cost, roads, zones of
// control, cylindrical wrap), so it supplies `speed`/`vision`/transforms here but
// not the generic `neighbors` hook — a game with a bespoke mover uses its own.
const kinematics = {
  turnDuration: 1,                       // one turn window == one unit of sim-time
  speed: (u) => UNITS[u.type]?.moves ?? 1,
  vision: () => ({ range: Math.SQRT2 + 0.01 }), // 8-neighbour disc (see vision-js-euclidean-gotcha)
};

const CIV1_SPACETIME = { space: 'discrete', time: 'discrete', play: 'sequential' };

// Shortest horizontal distance between two columns on a map that wraps east/west.
export function wrapDX(ax, bx, width) {
  const d = Math.abs(ax - bx);
  return width ? Math.min(d, width - d) : d;
}

// Turns-apart distance between two squares: units step to any of the 8 neighbours,
// so a diagonal step costs the same as an orthogonal one, and the map wraps east/west.
export function chebyshevWrapped(a, b, width) {
  return Math.max(wrapDX(a.x, b.x, width), Math.abs(a.y - b.y));
}

// Most units see only their 8 neighbours, as in the original (see getVisibleState's
// fog-of-war `canSee`). Shared with wakeSentryUnits below — a sentried unit stands
// down until an enemy comes within the same radius it would otherwise be fogged behind.
const UNIT_VISION = 1;

// Wakes any of `playerId`'s sentried units that now have an enemy within sight —
// classic "sentry: enemy sighted" behaviour. Called when a player's turn starts
// (after their units' moves refresh), so a woken unit shows up needing orders right
// away instead of silently sitting out the turn it was supposed to interrupt.
function wakeSentryUnits(units, playerId, boardWidth) {
  const enemies = units.filter(u => u.alive && u.ownerId !== playerId);
  if (!enemies.length) return units;
  return units.map(u => {
    if (!u.alive || u.ownerId !== playerId || !u.attrs?.sentry) return u;
    const sighted = enemies.some(e => chebyshevWrapped(u.position, e.position, boardWidth) <= UNIT_VISION);
    return sighted ? { ...u, attrs: { ...u.attrs, sentry: false } } : u;
  });
}

const UNIT_IMAGES = {
  settlers:      `${BASE}/units/settlers`,
  diplomat:      `${BASE}/units/diplomat`,
  militia:       `${BASE}/units/warrior`,
  phalanx:       `${BASE}/units/spearman`,
  archers:       `${BASE}/units/swordman`,
  legion:        `${BASE}/units/swordman`,
  catapult:      `${BASE}/units/catapult`,
  cavalry:       `${BASE}/units/horseman`,
  chariot:       `${BASE}/units/chariot`,
  knights:       `${BASE}/units/knight`,
  crusaders:     `${BASE}/units/knight`,
  musketeers:    `${BASE}/units/musketman`,
  cannon:        `${BASE}/units/cannon`,
  riflemen:      `${BASE}/units/rifleman`,
  'cav-modern':  `${BASE}/units/horseman`,
  artillery:     `${BASE}/units/artillery`,
  infantry:      `${BASE}/units/combat_1`,
  armor:         `${BASE}/units/tank`,
  'mech-inf':    `${BASE}/units/mechanizedinfantry`,
  paratroopers:  `${BASE}/units/combat_3`,
  marines:       `${BASE}/units/combat_2`,
  fighter:       `${BASE}/units/fighter`,
  bomber:        `${BASE}/units/bomber`,
  helicopter:    `${BASE}/units/combat_5`,
  nuclear:       `${BASE}/units/nuclear`,
  trireme:       `${BASE}/units/trireme`,
  sail:          `${BASE}/units/sail`,
  frigate:       `${BASE}/units/frigate`,
  ironclad:      `${BASE}/units/ironclad`,
  destroyer:     `${BASE}/units/combat_4`,
  submarine:     `${BASE}/units/submarine`,
  transport:     `${BASE}/units/transport`,
  cruiser:       `${BASE}/units/cruiser`,
  battleship:    `${BASE}/units/battleship`,
  carrier:       `${BASE}/units/carrier`,
};

// ── City name pools ───────────────────────────────────────────────────────────

const CITY_NAMES_P1 = [
  'Rome','Athens','Carthage','Alexandria','Babylon','Sparta','Troy',
  'Corinth','Thebes','Syracuse','Sardis','Memphis','Persepolis','Nineveh',
  'Ur','Tyre','Sidon','Antioch','Ephesus','Miletus',
];
const CITY_NAMES_P2 = [
  'London','Paris','Berlin','Vienna','Madrid','Lisbon','Amsterdam',
  'Brussels','Prague','Warsaw','Krakow','Stockholm','Oslo','Copenhagen',
  'Dublin','Edinburgh','Geneva','Lyon','Marseille','Cologne',
];

function getNextCityName(cities, playerId) {
  const pool = playerId.includes('2') ? CITY_NAMES_P2 : CITY_NAMES_P1;
  const used = new Set(cities.map(c => c.name));
  return pool.find(n => !used.has(n)) ?? `City${cities.length + 1}`;
}

// ── Unit factory ──────────────────────────────────────────────────────────────

function makeUnit(id, ownerId, type, x, y, movesLeft) {
  const stats = UNITS[type];
  return {
    id,
    ownerId,
    type,
    position: { x, y },
    alive: true,
    hp: stats.hp,
    maxHp: stats.hp,
    movesLeft: movesLeft ?? stats.moves,
    attrs: {},
    // Waypoints ({x,y}) queued while the unit has no moves left this turn — consumed
    // automatically, oldest first, as the unit's moves refresh on each of its future
    // turns (see runQueuedMoves, called from the 'end-turn' handler below).
    queue: [],
  };
}

// ── City production ───────────────────────────────────────────────────────────

// What a city may be told to build. There is no tech tree yet, so this is capped
// at the ancient units the era actually offers — exposing every unit in units.js
// would just mean everyone builds Armor from turn 1. Settlers are the important
// entry: without them there is no expansion and no way to win.
export const BUILDABLE = ['settlers', 'militia', 'phalanx', 'archers', 'legion', 'cavalry', 'chariot', 'catapult'];

// ── Legal actions ─────────────────────────────────────────────────────────────

function getLegalActions(state, playerId) {
  const { units, cities, board } = state;
  const myUnits = units.filter(u => u.alive && u.ownerId === playerId);
  const actions = [];

  for (const unit of myUnits) {
    const stats = UNITS[unit.type];

    if (unit.movesLeft > 0) {
      // Movement
      const reachable = getReachableTiles(unit, board, units, playerId);
      for (const to of reachable) {
        actions.push({ type: 'move', unitId: unit.id, from: unit.position, to });
      }

      // Attack: enemies in adjacent squares (Chebyshev distance ≤ 1)
      if (stats.attack > 0) {
        for (const enemy of units.filter(u => u.alive && u.ownerId !== playerId)) {
          const dx = wrapDX(enemy.position.x, unit.position.x, board.width);
          const dy = Math.abs(enemy.position.y - unit.position.y);
          if (dx <= 1 && dy <= 1 && (dx + dy) > 0) {
            actions.push({ type: 'attack', unitId: unit.id, targetId: enemy.id });
          }
        }
      }

      // Found city (settlers)
      if (stats.special.includes('found-city')) {
        const k = `${unit.position.x},${unit.position.y}`;
        const tile = board.tiles[k];
        const hasCity = cities.some(c => c.position.x === unit.position.x && c.position.y === unit.position.y);
        if (tile && tile.terrain !== 'ocean' && !hasCity) {
          actions.push({ type: 'found-city', unitId: unit.id });
        }
      }

      // Terrain improvements (settlers): road, irrigation, mine, clear forest/jungle.
      const k = `${unit.position.x},${unit.position.y}`;
      const tile = board.tiles[k];
      const isLand = tile && tile.terrain !== 'ocean';
      if (stats.special.includes('build-road') && isLand && !tile.hasRoad) {
        actions.push({ type: 'build-road', unitId: unit.id });
      }
      if (stats.special.includes('irrigate') && isLand && !tile.irrigated && IRRIGABLE_TERRAIN.has(tile.terrain)) {
        actions.push({ type: 'irrigate', unitId: unit.id });
      }
      if (stats.special.includes('mine') && isLand && !tile.mined && MINEABLE_TERRAIN.has(tile.terrain)) {
        actions.push({ type: 'build-mine', unitId: unit.id });
      }
      if (stats.special.includes('irrigate') && isLand && (tile.terrain === 'forest' || tile.terrain === 'jungle' || tile.terrain === 'swamp')) {
        actions.push({ type: 'clear-terrain', unitId: unit.id });
      }

      actions.push({ type: 'skip-unit', unitId: unit.id });

      // Fortify (defensive bonus while stationary — land/sea only, matching the
      // original) and sentry (stand down until an enemy comes into view — see
      // wakeSentryUnits below). Both are standing orders: they end this unit's turn
      // now and every future one too, without asking, until something gives it a
      // fresh order (see the attrs-clearing in applyMove/attack/build*/queue-move
      // below) — that's also what lets the auto-advance-to-next-unit UI feature
      // skip past them (see Civ1Game's `needsOrders` in toGrid).
      if (stats.domain !== 'air' && !unit.attrs?.fortified) {
        actions.push({ type: 'fortify', unitId: unit.id });
      }
      if (!unit.attrs?.sentry) {
        actions.push({ type: 'sentry', unitId: unit.id });
      }
    } else {
      // No moves left this turn: further clicks plan a route instead of acting right
      // away (see games/moveQueue.js) — one queued waypoint per future turn, consumed
      // by runQueuedMoves in the 'end-turn' handling below.
      actions.push(...queueMoveActions(unit, playerId, stats.moves,
        (virtualUnit, pid) => getReachableTiles(virtualUnit, board, units, pid)));
    }

    const popAction = queuePopAction(unit);
    if (popAction) actions.push(popAction);
  }

  // Production: at most one change per city per turn. The cap matters — without it
  // an agent can sit in a set-production loop and never end its turn.
  const ctx = state.gameSpecific.civ ? buildOwnerCtx(state, playerId) : null;
  for (const city of cities) {
    if (city.ownerId !== playerId) continue;
    if (city.productionSetTurn === state.turnNumber) continue;
    for (const item of buildableForCity(state, city, ctx)) {
      if (item === city.production) continue;
      actions.push({ type: 'set-production', cityId: city.id, item, unitId: '__player__' });
    }
  }

  // Empire-wide choices (once per turn each): research target, tax rate, government.
  const civ = state.gameSpecific.civ?.[playerId];
  if (civ) {
    const known = new Set(civ.techs);
    if (civ.researchSetTurn !== state.turnNumber) {
      for (const t of researchableTechs(known)) {
        if (t !== civ.research) actions.push({ type: 'set-research', tech: t, unitId: '__player__' });
      }
    }
    const max = GOVERNMENTS[civ.government].taxMax;
    if (civ.taxSetTurn !== state.turnNumber) {
      for (let tax = 0; tax <= max && tax + civ.luxRate <= 100; tax += 10) {
        if (tax !== civ.taxRate) actions.push({ type: 'set-tax', taxRate: tax, unitId: '__player__' });
      }
    }
    if (civ.luxSetTurn !== state.turnNumber) {
      for (let lux = 0; lux <= max && lux + civ.taxRate <= 100; lux += 10) {
        if (lux !== civ.luxRate) actions.push({ type: 'set-luxury', luxRate: lux, unitId: '__player__' });
      }
    }
    if (!civ.anarchyTurns) {
      for (const g of availableGovernments(known)) {
        if (g !== civ.government) actions.push({ type: 'change-government', government: g, unitId: '__player__' });
      }
    }
    // Launch the spaceship once it has the minimum parts and hasn't already flown.
    const ship = civ.spaceship;
    if (ship && !ship.launched && spaceshipReady(ship)) {
      actions.push({ type: 'launch-spaceship', unitId: '__player__' });
    }
  }

  actions.push({ type: 'end-turn', unitId: '__player__' });
  return actions;
}

// Terrain sets the settler's terraforming actions apply to.
const IRRIGABLE_TERRAIN = new Set(['desert', 'grassland', 'plains', 'hills', 'swamp', 'tundra']);
const MINEABLE_TERRAIN = new Set(['hills', 'mountains']);

// A spaceship has enough of every part to launch.
function spaceshipReady(ship) {
  return ship.structural >= SPACESHIP_MIN.structural
    && ship.component >= SPACESHIP_MIN.component
    && ship.module >= SPACESHIP_MIN.module;
}

// Turns the ship takes to reach Alpha Centauri — faster with more propulsion
// (components) and life support (modules) beyond the minimum.
function spaceshipTravelTime(ship) {
  const extra = (ship.component - SPACESHIP_MIN.component) + (ship.module - SPACESHIP_MIN.module);
  return Math.max(5, 15 - extra);
}

// ── Movement (shared by the 'move' action and queued-waypoint execution) ──────

// Single-tile step cost: air is flat, roads are cheap, otherwise the destination
// tile's terrain cost. Matches the original: a jump onto a far reachable tile
// (getReachableTiles floods multiple tiles per turn) is still only charged for
// the tile actually landed on, not the accumulated path.
function moveCost(unit, tile) {
  if (UNITS[unit.type].domain === 'air') return 1;
  if (tile?.hasRoad) return 1 / 3;
  return (tile ? TERRAIN[tile.terrain]?.moveCost : null) ?? 1;
}

// Moves `unit` onto `to`, deducting its cost and handling the "walking into an
// undefended enemy city takes it" rule. Movement onto tiles held by enemy *units*
// is blocked earlier (map.js getReachableTiles / isMoveTargetLegal below), so
// reaching an enemy city tile at all means nothing was left standing on it.
function applyMove(units, cities, board, playerId, unit, to) {
  const tile = board.tiles[`${to.x},${to.y}`];
  const newMovesLeft = Math.max(0, unit.movesLeft - moveCost(unit, tile));
  // Moving is a fresh order: drop any standing fortify/sentry (matches queued
  // waypoints too — this runs for those the same way it does for a direct 'move').
  const newUnits = units.map(u =>
    u.id === unit.id ? { ...u, position: to, movesLeft: newMovesLeft, attrs: { ...u.attrs, fortified: false, sentry: false } } : u);

  const enemyCity = cities.find(c => c.ownerId !== playerId && c.position.x === to.x && c.position.y === to.y);
  const newCities = enemyCity
    ? cities.map(c => c.id === enemyCity.id ? { ...c, ownerId: playerId, shields: 0 } : c)
    : cities;

  return { units: newUnits, cities: newCities };
}

// Re-validates a queued waypoint at execution time (occupancy may have changed
// since it was planned): still on the board, still passable for this unit's
// domain, and not currently blocked by a friendly unit or (for land units) an
// enemy one.
function isMoveTargetLegal(to, board, units, playerId, domain) {
  const tile = board.tiles[`${to.x},${to.y}`];
  if (!tile) return false;
  const td = TERRAIN[tile.terrain];
  if (!td) return false;
  if (domain === 'land' && !td.passable.land) return false;
  if (domain === 'sea' && !td.passable.sea) return false;
  const atTarget = u => u.alive && u.position.x === to.x && u.position.y === to.y;
  if (domain === 'land' && units.some(u => u.ownerId !== playerId && atTarget(u))) return false;
  if (units.some(u => u.ownerId === playerId && atTarget(u))) return false;
  return true;
}

// ── Apply actions ─────────────────────────────────────────────────────────────

function applyActions(state, playerActions, rng = Math.random) {
  const { playerId, action } = playerActions[0];
  let { units, cities, board } = state;
  let { nextId } = state.gameSpecific;
  const playerIds = state.players.map(p => p.id);
  const currentIdx = playerIds.indexOf(playerId);

  // ── end-turn ──────────────────────────────────────────────────────────────
  if (action.type === 'end-turn') {
    // Run the ending player's whole economy: cities work, grow, build, earn gold and
    // science, pay upkeep, and advance research (see economy.js).
    const eco = processOwnerEconomy({ ...state, units, cities }, playerId, nextId, makeUnit);
    units = eco.units;
    cities = eco.cities;
    nextId = eco.nextId;
    const civ = { ...state.gameSpecific.civ, [playerId]: eco.civ };

    // Hand over to the next civ that still exists. An eliminated one is skipped
    // rather than being asked for orders it has no pieces to give; the turn counter
    // still advances whenever the rotation passes seat 0, so wrapping past a dead
    // leading seat does not stall the clock.
    const isAlive = pid =>
      cities.some(c => c.ownerId === pid) || units.some(u => u.alive && u.ownerId === pid);
    let nextIdx = (currentIdx + 1) % playerIds.length;
    let newTurn = nextIdx === 0 ? state.turnNumber + 1 : state.turnNumber;
    for (let hops = 0; hops < playerIds.length - 1 && !isAlive(playerIds[nextIdx]); hops++) {
      nextIdx = (nextIdx + 1) % playerIds.length;
      if (nextIdx === 0) newTurn = state.turnNumber + 1;
    }
    const nextPlayerId = playerIds[nextIdx];

    // Refresh the next player's units. Magellan's Expedition grants +2 movement to
    // their ships.
    const nextEffects = wonderEffectsFor(cities, nextPlayerId);
    const navalBonus = nextEffects.has('naval-move') ? 2 : 0;
    units = units.map(u => {
      if (u.ownerId === nextPlayerId) {
        // Discrete-time per-turn budget = the spec's speed (spacetime.moveBudget),
        // plus Magellan's naval bonus. Same number as before — now sourced from
        // the one spec so discrete-time budget and continuous-time cooldown agree.
        const base = ST.moveBudget(kinematics, u, state)
          + (UNITS[u.type].domain === 'sea' ? navalBonus : 0);
        return { ...u, movesLeft: base };
      }
      return u;
    });
    units = wakeSentryUnits(units, nextPlayerId, board.width);
    units = runQueuedMoves(units, nextPlayerId,
      (to, unit, pid, curUnits) => isMoveTargetLegal(to, board, curUnits, pid, UNITS[unit.type].domain),
      (curUnits, pid, unit, to) => {
        const applied = applyMove(curUnits, cities, board, pid, unit, to);
        cities = applied.cities;
        return applied.units;
      });

    return {
      ...state,
      units,
      cities,
      activePlayers: [nextPlayerId],
      turnNumber: newTurn,
      lastActions: playerActions,
      gameSpecific: { ...state.gameSpecific, nextId, civ },
    };
  }

  // ── move ──────────────────────────────────────────────────────────────────
  if (action.type === 'move') {
    const unit = units.find(u => u.id === action.unitId);
    const applied = applyMove(units, cities, board, playerId, unit, action.to);
    return { ...state, units: applied.units, cities: applied.cities, lastActions: playerActions };
  }

  // ── queue-move ────────────────────────────────────────────────────────────
  // The unit has no moves left this turn; remember the destination and run it
  // automatically once moves refresh (see runQueuedMoves, called on 'end-turn').
  // Queuing a move is a fresh order, same as moving right now — drop any standing
  // fortify/sentry so the unit doesn't look parked while it's actually got a plan.
  if (action.type === 'queue-move') {
    units = enqueueWaypoint(units, action.unitId, action.to);
    units = units.map(u => u.id === action.unitId ? { ...u, attrs: { ...u.attrs, fortified: false, sentry: false } } : u);
    return { ...state, units, lastActions: playerActions };
  }

  // ── queue-pop ─────────────────────────────────────────────────────────────
  // Backspace / "undo last queued move": drops the most recently queued waypoint.
  if (action.type === 'queue-pop') {
    units = dequeueLastWaypoint(units, action.unitId);
    return { ...state, units, lastActions: playerActions };
  }

  // ── nuclear strike ──────────────────────────────────────────────────────────
  // A Nuclear missile detonates over its target: everything on that tile and the
  // eight around it is destroyed and any city there loses half its population. The
  // missile is consumed. SDI Defense in (or adjacent to) the blast intercepts it —
  // the warhead is wasted with no damage.
  if (action.type === 'attack' && UNITS[units.find(u => u.id === action.unitId)?.type]?.special.includes('nuclear')) {
    const attacker = units.find(u => u.id === action.unitId);
    const defender = units.find(u => u.id === action.targetId);
    if (!attacker || !defender) return state;
    const center = defender.position;
    const inBlast = pos => wrapDX(pos.x, center.x, board.width) <= 1 && Math.abs(pos.y - center.y) <= 1;

    const intercepted = cities.some(c => inBlast(c.position) && (c.buildings ?? []).includes('sdi-defense'));
    if (intercepted) {
      units = units.map(u => u.id === attacker.id ? { ...u, alive: false, hp: 0, movesLeft: 0 } : u);
      return { ...state, units, lastActions: playerActions };
    }

    units = units.map(u => {
      if (u.id === attacker.id) return { ...u, alive: false, hp: 0, movesLeft: 0 };
      if (u.alive && inBlast(u.position)) return { ...u, alive: false, hp: 0 };
      return u;
    });
    cities = cities.map(c => inBlast(c.position) ? { ...c, size: Math.max(1, Math.floor(c.size / 2)) } : c);
    return { ...state, units, cities, lastActions: playerActions };
  }

  // ── attack ────────────────────────────────────────────────────────────────
  if (action.type === 'attack') {
    const attacker = units.find(u => u.id === action.unitId);
    const defender = units.find(u => u.id === action.targetId);
    if (!attacker || !defender) return state;

    const result = resolveCombat(attacker, defender, state, rng);

    units = units.map(u => {
      if (u.id === action.unitId) {
        if (result.attackerSurvived) return { ...u, hp: result.attackerHpLeft, movesLeft: 0, attrs: { ...u.attrs, fortified: false, sentry: false } };
        return { ...u, alive: false, hp: 0, movesLeft: 0 };
      }
      if (u.id === action.targetId) {
        if (!result.attackerSurvived) return { ...u, hp: result.defenderHpLeft };
        return { ...u, alive: false, hp: 0 };
      }
      return u;
    });

    if (result.attackerSurvived) {
      const defPos = defender.position;
      const capturedCity = cities.find(c => c.position.x === defPos.x && c.position.y === defPos.y);
      if (capturedCity) {
        cities = cities.map(c => c.id === capturedCity.id ? { ...c, ownerId: playerId } : c);
      }
      const occupiedAfter = new Set(units.filter(u => u.alive && u.id !== action.unitId).map(u => `${u.position.x},${u.position.y}`));
      if (!occupiedAfter.has(`${defPos.x},${defPos.y}`)) {
        units = units.map(u => u.id === action.unitId ? { ...u, position: defPos, movesLeft: 0 } : u);
      }
    }

    return { ...state, units, cities, lastActions: playerActions };
  }

  // ── set-production ────────────────────────────────────────────────────────
  if (action.type === 'set-production') {
    cities = cities.map(c =>
      c.id === action.cityId && c.ownerId === playerId
        ? { ...c, production: action.item, productionSetTurn: state.turnNumber }
        : c
    );
    return { ...state, cities, lastActions: playerActions };
  }

  // ── found-city ────────────────────────────────────────────────────────────
  if (action.type === 'found-city') {
    const unit = units.find(u => u.id === action.unitId);
    const name = getNextCityName(cities, playerId);
    // The owner's first city is the capital and comes with the Palace.
    const isFirst = !cities.some(c => c.ownerId === playerId);
    const newCity = {
      id: `city-${nextId++}`,
      name,
      ownerId: playerId,
      position: { ...unit.position },
      size: 1,
      shields: 0,
      food: 0,
      production: 'militia',
      buildings: isFirst ? ['palace'] : [],
    };
    cities = [...cities, newCity];
    units = units.filter(u => u.id !== action.unitId);
    return {
      ...state, units, cities, lastActions: playerActions,
      gameSpecific: { ...state.gameSpecific, nextId },
    };
  }

  // ── terrain improvements (settlers) ─────────────────────────────────────────
  if (action.type === 'build-road' || action.type === 'irrigate' || action.type === 'build-mine' || action.type === 'clear-terrain') {
    const unit = units.find(u => u.id === action.unitId);
    const k = `${unit.position.x},${unit.position.y}`;
    const tile = board.tiles[k];
    let patch;
    if (action.type === 'build-road') patch = { hasRoad: true };
    else if (action.type === 'irrigate') patch = { irrigated: true, mined: false };
    else if (action.type === 'build-mine') patch = { mined: true, irrigated: false };
    else patch = { terrain: CLEARS_TO[tile.terrain] ?? 'plains', irrigated: false, mined: false };
    const newTiles = { ...board.tiles, [k]: { ...tile, ...patch } };
    units = units.map(u => u.id === action.unitId ? { ...u, movesLeft: 0, attrs: { ...u.attrs, fortified: false, sentry: false } } : u);
    return { ...state, units, board: { ...board, tiles: newTiles }, lastActions: playerActions };
  }

  // ── set-research ────────────────────────────────────────────────────────────
  if (action.type === 'set-research') {
    const civ = { ...state.gameSpecific.civ[playerId], research: action.tech, researchSetTurn: state.turnNumber };
    return { ...state, lastActions: playerActions, gameSpecific: { ...state.gameSpecific, civ: { ...state.gameSpecific.civ, [playerId]: civ } } };
  }

  // ── set-tax / set-luxury (science gets whatever the two leave) ──────────────
  if (action.type === 'set-tax') {
    const cur = state.gameSpecific.civ[playerId];
    const civ = { ...cur, taxRate: action.taxRate, luxRate: Math.min(cur.luxRate, 100 - action.taxRate), taxSetTurn: state.turnNumber };
    return { ...state, lastActions: playerActions, gameSpecific: { ...state.gameSpecific, civ: { ...state.gameSpecific.civ, [playerId]: civ } } };
  }
  if (action.type === 'set-luxury') {
    const cur = state.gameSpecific.civ[playerId];
    const civ = { ...cur, luxRate: action.luxRate, taxRate: Math.min(cur.taxRate, 100 - action.luxRate), luxSetTurn: state.turnNumber };
    return { ...state, lastActions: playerActions, gameSpecific: { ...state.gameSpecific, civ: { ...state.gameSpecific.civ, [playerId]: civ } } };
  }

  // ── launch-spaceship ────────────────────────────────────────────────────────
  if (action.type === 'launch-spaceship') {
    const cur = state.gameSpecific.civ[playerId];
    if (!cur.spaceship || cur.spaceship.launched || !spaceshipReady(cur.spaceship)) return state;
    const spaceship = { ...cur.spaceship, launched: true, arrivesTurn: state.turnNumber + spaceshipTravelTime(cur.spaceship) };
    const civ = { ...cur, spaceship };
    return { ...state, lastActions: playerActions, gameSpecific: { ...state.gameSpecific, civ: { ...state.gameSpecific.civ, [playerId]: civ } } };
  }

  // ── change-government (triggers a 2-turn revolution / Anarchy) ───────────────
  if (action.type === 'change-government') {
    const cur = state.gameSpecific.civ[playerId];
    const taxMax = GOVERNMENTS[action.government].taxMax;
    const civ = {
      ...cur,
      government: 'anarchy',
      pendingGovernment: action.government,
      anarchyTurns: 2,
      taxRate: Math.min(cur.taxRate, taxMax),
    };
    return { ...state, lastActions: playerActions, gameSpecific: { ...state.gameSpecific, civ: { ...state.gameSpecific.civ, [playerId]: civ } } };
  }

  // ── skip-unit ─────────────────────────────────────────────────────────────
  // Deliberately leaves attrs.fortified/attrs.sentry untouched — "wait" on an
  // already-fortified/sentried unit isn't a new order, same as the original.
  if (action.type === 'skip-unit') {
    units = units.map(u => u.id === action.unitId ? { ...u, movesLeft: 0 } : u);
    return { ...state, units, lastActions: playerActions };
  }

  // ── fortify / sentry (standing orders) ──────────────────────────────────────
  if (action.type === 'fortify') {
    units = units.map(u => u.id === action.unitId
      ? { ...u, movesLeft: 0, attrs: { ...u.attrs, fortified: true, sentry: false } }
      : u);
    return { ...state, units, lastActions: playerActions };
  }
  if (action.type === 'sentry') {
    units = units.map(u => u.id === action.unitId
      ? { ...u, movesLeft: 0, attrs: { ...u.attrs, fortified: false, sentry: true } }
      : u);
    return { ...state, units, lastActions: playerActions };
  }

  return state;
}

// What a cleared forest/jungle/swamp becomes when a settler clears it.
const CLEARS_TO = { forest: 'plains', jungle: 'grassland', swamp: 'grassland' };

// ── Win condition ─────────────────────────────────────────────────────────────

function getResult(state) {
  const playerIds = state.players.map(p => p.id);

  // Space race: a launched spaceship that has reached Alpha Centauri wins — provided
  // its owner still holds a capital (losing the capital destroys the ship).
  for (const pid of playerIds) {
    const ship = state.gameSpecific?.civ?.[pid]?.spaceship;
    if (ship?.launched && state.turnNumber >= ship.arrivesTurn) {
      const hasCapital = state.cities.some(c => c.ownerId === pid && (c.buildings ?? []).includes('palace'));
      if (hasCapital) return { outcome: 'win', winnerId: pid, reason: 'space-race' };
    }
  }

  // Conquest. A civ with neither a city nor a living unit is eliminated, but that
  // only ENDS the game once a single civ is left standing — with three or more
  // players the first elimination used to hand the win to whichever rival happened
  // to come first in the player list, while the others were still fighting over it.
  const alive = playerIds.filter(pid =>
    state.cities.some(c => c.ownerId === pid) ||
    state.units.some(u => u.alive && u.ownerId === pid));

  if (alive.length === 1) return { outcome: 'win', winnerId: alive[0], reason: 'civilization-destroyed' };
  // Everyone wiped out on the same turn (mutual destruction) — nobody wins.
  if (alive.length === 0) return { outcome: 'draw', winnerId: null, reason: 'civilization-destroyed' };
  return null;
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderState(state) {
  const { turnNumber, activePlayers, units, cities, players } = state;

  const summarize = pid => {
    const alive = units.filter(u => u.alive && u.ownerId === pid);
    const ownCities = cities.filter(c => c.ownerId === pid);
    const civ = state.gameSpecific?.civ?.[pid];
    const cityStr = ownCities.map(c => `${c.name}(${c.size})`).join(',') || 'none';
    const unitStr = alive.map(u => `${u.type}(${u.hp}hp)`).join(', ') || '—';
    const econ = civ ? ` | ${GOVERNMENTS[civ.government].name} gold=${civ.gold} techs=${civ.techs.length} researching=${civ.research ? (TECHS[civ.research]?.name ?? civ.research) : '—'}` : '';
    const ship = civ?.spaceship;
    const shipStr = ship && (ship.launched || ship.structural + ship.component + ship.module > 0)
      ? ` | spaceship ${ship.structural}S/${ship.component}C/${ship.module}M${ship.launched ? ` LAUNCHED→arrives T${ship.arrivesTurn}` : ''}`
      : '';
    return `${pid}: cities=${cityStr}${econ}${shipStr}\n    units: ${unitStr}`;
  };

  return [
    `═══ Turn ${turnNumber} — ${activePlayers[0]} to move ═══`,
    renderMap(state),
    `Legend: 1/2=city  Uppercase=P1  lowercase=P2  ~=ocean ^=arctic t=tundra d=desert`,
    `        .=plains  ,=grass  f=forest  n=hills  A=mtns  s=swamp  j=jungle`,
    '',
    ...players.map(p => summarize(p.id)),
  ].join('\n');
}

// ── Fixed scenarios ──────────────────────────────────────────────────────────
//
// Hand-built boards (ASCII art + unit placements) authored in fixedMaps.js.
// Build a full initial state from one of those map definitions.
function createFixedMapState(map, players, config) {
  const { width, height, tiles } = parseFixedMap(map);
  const board = { width, height, tiles };
  const sides = [players[0], players[1]];

  let idCtr = 0;
  const units = map.units.map(u =>
    makeUnit(`u${idCtr++}`, sides[u.side - 1].id, u.type, u.x, u.y, UNITS[u.type].moves));

  return {
    gameName: 'Civ1',
    turnNumber: 1,
    activePlayers: [players[0].id],
    currentPhase: 'action',
    players,
    board,
    units,
    cities: [],
    lastActions: null,
    gameSpecific: {
      nextId: idCtr,
      // Resolved (space × time × play) quadrant. civ1 is natively discrete/discrete/
      // sequential; engine `timeType: 'continuous'` reads getActionDuration's
      // dist/speed cooldown from this same spec. See games/spacetime.js.
      spacetime: ST.resolveSpaceTime(Civ1Game, config),
      fogOfWar: config.fogOfWar ?? true,
      civ: Object.fromEntries(players.map(p => [p.id, newCivState()])),
      rules: resolveRules(config),
      startRoster: {
        units: units.map(u => ({ id: u.id, ownerId: u.ownerId, type: u.type, position: { ...u.position }, hp: u.hp })),
        cities: [],
      },
    },
  };
}

// ── createInitialState ────────────────────────────────────────────────────────

function createInitialState(players, config = {}) {
  const fixed = getFixedMap(config.scenario);
  if (fixed) return createFixedMapState(fixed, players, config);

  const width  = config.width  ?? 50;
  const height = config.height ?? 30;
  // A blank or non-numeric seed means "surprise me" — roll a fresh random one.
  const parsedSeed = Number.parseInt(config.seed, 10);
  const seed = Number.isFinite(parsedSeed) && parsedSeed > 0
    ? (parsedSeed >>> 0)
    : (Math.floor(Math.random() * 0xffffffff) >>> 0);

  // Original-Civ1 map knobs (0..2 each); see generateMap in map.js.
  const clampParam = (v, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(2, Math.round(n))) : d; };
  const mapOpts = {
    land:    clampParam(config.land, 1),
    temp:    clampParam(config.temp, 1),
    climate: clampParam(config.climate, 1),
    age:     clampParam(config.age, 1),
  };

  const rng = mulberry32(seed);
  const tiles = generateMap(width, height, rng, mapOpts);
  const board = { width, height, tiles };

  // One start band per civ, spread evenly across the map with a gap between them.
  // Previously this seeded exactly two players, so a 3- or 4-player game (which
  // api-server.js advertises) began with seats 3 and 4 owning nothing at all and
  // getResult ended it on turn 0.
  const n = players.length;
  const bandWidth = width / n;
  const positions = players.map((_, i) => {
    const lo = Math.max(1, Math.floor(i * bandWidth + bandWidth * 0.1));
    const hi = Math.min(width - 1, Math.ceil((i + 1) * bandWidth - bandWidth * 0.1));
    return findStartPos(tiles, width, height, [lo, Math.max(lo, hi)], rng);
  });

  let idCtr = 0;
  const units = players.map((p, i) =>
    makeUnit(`u${idCtr++}`, p.id, 'settlers', positions[i].x, positions[i].y, UNITS.settlers.moves));
  players.forEach((p, i) => {
    const militiaPos = findAdjacentFree(positions[i], board, units) ?? positions[i];
    units.push(makeUnit(`u${idCtr++}`, p.id, 'militia', militiaPos.x, militiaPos.y, UNITS.militia.moves));
  });

  return {
    gameName: 'Civ1',
    turnNumber: 1,
    activePlayers: [players[0].id],
    currentPhase: 'action',
    players,
    board,
    units,
    cities: [],
    lastActions: null,
    gameSpecific: {
      nextId: idCtr,
      // Resolved (space × time × play) quadrant. civ1 is natively discrete/discrete/
      // sequential; engine `timeType: 'continuous'` reads getActionDuration's
      // dist/speed cooldown from this same spec. See games/spacetime.js.
      spacetime: ST.resolveSpaceTime(Civ1Game, config),
      fogOfWar: config.fogOfWar ?? true,
      civ: Object.fromEntries(players.map(p => [p.id, newCivState()])),
      rules: resolveRules(config),
      // Common-knowledge starting deployment: cities are founded later so this
      // only seeds units; the belief tracker (belief.js) learns enemy cities
      // the first time it sees them.
      startRoster: {
        units: units.map(u => ({ id: u.id, ownerId: u.ownerId, type: u.type, position: { ...u.position }, hp: u.hp })),
        cities: [],
      },
    },
  };
}

// ── Fog of war ────────────────────────────────────────────────────────────────

function getVisibleState(state, playerId) {
  // Cities (bigger, garrisoned, elevated) see a little further than the module-level
  // UNIT_VISION units use (also shared with wakeSentryUnits above).
  const CITY_VISION = 2;
  const myUnits  = state.units.filter(u => u.alive && u.ownerId === playerId);
  const myCities = state.cities.filter(c => c.ownerId === playerId);
  const W = state.board.width;
  const canSee = pos =>
    myUnits.some(m  => chebyshevWrapped(m.position, pos, W) <= UNIT_VISION) ||
    myCities.some(c => chebyshevWrapped(c.position, pos, W) <= CITY_VISION);

  // Wonder effects on vision: the Apollo Program lifts the fog entirely (the whole
  // map is known); Marco Polo's Embassy gives an embassy with every rival, so all
  // their cities are visible even in the dark.
  const effects = wonderEffectsFor(state.cities, playerId);
  const embassy = effects.has('embassy-all');

  // Anti-cheat: never expose a rival's private ledger (advances, treasury, research,
  // spaceship) to the agent choosing this player's move. Their civ record is replaced
  // with an empty one; only this player sees their own. This holds even for the
  // reveal-map case below, so map vision and intelligence stay separate.
  const civ = {};
  for (const [pid, c] of Object.entries(state.gameSpecific.civ ?? {})) {
    civ[pid] = pid === playerId ? c : { ...newCivState(), government: c.government };
  }
  const redacted = { ...state, gameSpecific: { ...state.gameSpecific, civ } };

  // The Apollo Program reveals the whole map (terrain + positions) but not the ledger.
  if (effects.has('reveal-map')) return redacted;

  return {
    ...redacted,
    units:  state.units.filter(u  => u.ownerId  === playerId || canSee(u.position)),
    cities: state.cities.filter(c => c.ownerId  === playerId || embassy || canSee(c.position)),
  };
}

// Fog belief sampler for the generic ObscuroAgent: plausible full worlds with
// the unseen enemies (and known-but-hidden enemy cities) placed from the
// stateful Civ1Belief (belief.js). Returns [] when fog is off.
function sampleWorlds(observation, playerId, n, rng = Math.random) {
  if (!observation.gameSpecific.fogOfWar) return [];
  const belief = getCiv1Belief(observation, playerId);
  belief.beginTurn(observation);
  return belief.sample(observation, n, rng, makeUnit);
}

// ── Export ────────────────────────────────────────────────────────────────────

// Continuous-time cost of an action (engine `timeType: 'continuous'`). A move's
// cooldown/travel-time is the framework's dist/speed (spacetime.travelTime with
// civ1's turnDuration 1) over the cylindrical Chebyshev distance — double `moves`
// → half the cooldown. Everything else is one tick.
function getActionDuration(state, action) {
  if (action.type === 'move') {
    const unit = state.units.find(u => u.id === action.unitId);
    if (!unit) return 1;
    const from = action.from ?? unit.position;
    const dist = chebyshevWrapped(action.to, from, state.board.width);
    const st = state.gameSpecific.spacetime ?? { turnDuration: 1 };
    return ST.travelTime(kinematics, unit, state, st, dist);
  }
  return 1;
}

// `special` is this square's resource (see specials.js), if any: it renames the tile
// the way the original does ("Gold" rather than "Mountains") and adds its yield.
function terrainInfo(tile, x = null, y = null) {
  const key = typeof tile === 'string' ? tile : tile?.terrain;
  const t = TERRAIN[key] ?? TERRAIN.plains;
  const special = (x != null && key) ? specialAt(x, y, key) : null;
  const y3 = (x != null && key) ? tileYield(t, key, x, y) : t;
  const name = special ? special.name : (key ? key[0].toUpperCase() + key.slice(1) : 'Plains');
  const parts = [`Food ${y3.food}`, `Shields ${y3.shields}`, `Trade ${y3.trade}`];
  if (!t.passable.land) parts.push('impassable to land units');
  else parts.push(`move cost ${t.moveCost}`);
  if (t.defBonus) parts.push(`+${Math.round(t.defBonus * 100)}% defense`);
  if (tile?.irrigated) parts.push('irrigated');
  if (tile?.mined) parts.push('mine');
  if (tile?.hasRoad) parts.push('road');
  if (tile?.hasRiver) parts.push('river');
  return { name, description: parts.join(' · ') };
}

// Inspector text for a city tile: name, size, what it is building, and its buildings.
function cityInfo(city, tile, x, y) {
  const built = (city.buildings ?? [])
    .map(id => IMPROVEMENTS[id]?.name ?? WONDERS[id]?.name ?? id)
    .join(', ') || 'none';
  const prod = UNITS[city.production] ? city.production
    : (IMPROVEMENTS[city.production]?.name ?? WONDERS[city.production]?.name ?? SPACESHIP[city.production]?.name ?? city.production);
  const parts = [
    `Size ${city.size}`,
    `building ${prod} (${city.shields}/${buildCost(city.production)}▪)`,
    `food ${city.food}/${foodBox(city.size)}`,
    `improvements: ${built}`,
    `on ${terrainInfo(tile, x, y).name}`,
  ];
  return { name: `${city.name}`, description: parts.join(' · ') };
}

export const Civ1Game = {
  // Units, plus cities weighted heavily (losing your last city loses the game),
  // plus the economy the new systems create: bigger cities, more advances, and a
  // treasury are all progress the search should value. Heuristic leaf for the
  // generic ObscuroAgent; see games/evalHelpers.js.
  evaluateState: (state, playerId) => {
    let score = unitStrengthEval(state, playerId)
      + sidesEval(state.cities, playerId, c => 100 + (c.size ?? 1) * 20 + (c.buildings?.length ?? 0) * 8);
    const civ = state.gameSpecific?.civ?.[playerId];
    if (civ) score += civ.techs.length * 15 + civ.gold * 0.2;
    return score;
  },
  name: 'Civ1',
  // The single movement spec + its default quadrant (games/spacetime.js). civ1's
  // discrete-time per-turn budget and continuous-time cooldown both derive from
  // `kinematics.speed` (a unit's `moves`).
  spacetime: CIV1_SPACETIME,
  kinematics,
  // mapZoom/defaultTileSize: the map runs to 100x60 tiles, far more than fits legibly on
  // the stage at once, so the zoom & pan controls are always on here (not a configurable
  // option) and the view starts at the original game's rough tile scale.
  // moveQueue: the goto-queue mechanic (games/moveQueue.js) — on by default for every game,
  // stated here explicitly since civ1 is the one that actually wires it up (queue-move/
  // queue-pop, see getLegalActions/applyActions above).
  ui: {
    hideGridLines: true, freeSelection: true, dragToMove: true, showFacing: false,
    blinkActiveUnit: true, allowDiagonalHopsWhileMoving: true, recolorTeamSprites: true,
    mapZoom: true, defaultTileSize: 40, moveQueue: true,
    // Once the selected unit runs out of orders (moves used up, or it's been given a
    // standing fortify/sentry order — see toGrid's `needsOrders`), jump selection to
    // another of the player's units that still wants orders (see Battlefield.vue).
    autoAdvanceUnit: true,
    // Health bars read as clutter on a strategy map at this zoom — off by default,
    // toggleable from the menu's settings overlay (see games/civ1/gameOptions).
    showHpBars: false,
    // No right-hand column at all. A per-unit roster card is the wrong shape for an
    // empire of dozens of units — the Military advisor (F2) counts them by type, and
    // the map is where you find any one of them. The move log goes with it (the
    // original game has no such log, and the map wants the width); an observer's
    // perspective switcher is still in the menu overlay, which is where it moved to.
    showRightSidebar: false,
    // Matches the server's UNIT_VISION (see getVisibleState) — without this the
    // client's default sight radius is 30% of the board's larger side, which both
    // misrepresents what's actually fogged and, when a unit is selected, paints a
    // huge lattice of per-tile borders that reads as a stray grid.
    // vision.js measures range as a Euclidean radius (Math.hypot), not Chebyshev —
    // a range of exactly 1 clips the 4 diagonal neighbours (distance √2) as if water
    // or terrain were blocking them, when nothing is; units see all 8 neighbours
    // equally. Math.SQRT2 + a hair covers the diagonal without reaching the next
    // ring out (distance 2 orthogonally, √5 as a knight's move).
    visionRange: Math.SQRT2 + 0.01,
    // Coordinates aren't part of the original game's UI; hidden by default, toggle
    // from the menu ("Show ruler").
    showRuler: false,
    // The original Civ1 never re-fogs terrain once a unit has seen it — only units and
    // city details out of CURRENT sight hide again (already handled server-side by
    // getVisibleState). See Battlefield.vue's exploredTileSet / SchematicLayer &
    // HtmlLayer's terrainFogged for the client-side terrain memory this enables.
    persistentFog: true,
    // Keyboard play, taken from the original game's own control bindings
    // (civilization.fandom.com/wiki/Control_bindings_(Civ1)). The UI executes these
    // generically — a key is a legal action's type, a named UI command, or an overview
    // overlay to open, and getLegalActions still decides whether anything happens (see
    // apps/design/keyBindings.js for the format, Battlefield.vue for the handlers).
    // Only bindings this engine has something to do are listed: the original's H (home
    // city), U (unload), P/Shift+P (pollution, pillage), Shift+D (disband) and G (goto,
    // which here is the click-driven move queue) have no action to fire, so they are
    // deliberately absent rather than bound to nothing. Enter for end-turn is the one
    // key the original never needed — it ended the turn once nothing wanted orders.
    keys: {
      directionMove: true,
      directionPan: true,
      bindings: [
        { key: 'b', action: 'found-city',                  label: 'Found new city',                     group: 'Unit orders' },
        { key: 'r', action: 'build-road',                  label: 'Build road',                         group: 'Unit orders' },
        // I is the original's one "agricultural improvement" key: irrigate where that's
        // possible, otherwise clear the forest/jungle/swamp standing on the square.
        { key: 'i', action: ['irrigate', 'clear-terrain'], label: 'Irrigate, or clear forest / swamp',  group: 'Unit orders' },
        { key: 'm', action: 'build-mine',                  label: 'Build mine',                         group: 'Unit orders' },
        { key: 'f', action: 'fortify',                     label: 'Fortify',                            group: 'Unit orders' },
        { key: 's', action: 'sentry',                      label: 'Sentry (wake when an enemy shows)',  group: 'Unit orders' },
        { key: ' ', action: 'skip-unit',                   label: 'No orders — this unit is done',      group: 'Unit orders' },
        { key: 'w', command: 'next-unit',                  label: 'Wait — go to the next unit',         group: 'Unit orders' },
        { key: 'Backspace', action: 'queue-pop',           label: 'Undo the last queued move',          group: 'Unit orders' },
        { key: 'Enter', action: 'end-turn',                label: 'End turn',                           group: 'Unit orders' },
        { key: 'c', command: 'center',                     label: 'Centre the map on the active unit',  group: 'Map & view' },
        // The original reached the city screen by clicking the city; with no cursor to
        // click with, stepping through your own cities is the keyboard's way in. N is
        // this engine's own key — the original has none, and Tab (its keyboard-only
        // map-cursor toggle) is left alone so it still moves browser focus.
        { key: 'n', command: 'next-city',                  label: 'Step through your cities',           group: 'Cities' },
        { key: '?', command: 'help',                       label: 'This key list',                      group: 'Map & view' },
        { key: 'F1', panel: 'cities',                      label: 'City status',                        group: 'Advisors' },
        { key: 'F2', panel: 'military',                    label: 'Military advisor',                   group: 'Advisors' },
        // The original's Trade advisor screen is where tax and luxury are set, which is
        // exactly what the Rates overlay holds — so its F-key and both rate keys open it.
        { key: 'F5', panel: 'rates',                       label: 'Trade advisor — tax / luxury rates', group: 'Advisors' },
        { key: '=', panel: 'rates',                        label: 'Trade advisor — tax / luxury rates', group: 'Advisors' },
        { key: '-', panel: 'rates',                        label: 'Trade advisor — tax / luxury rates', group: 'Advisors' },
        { key: 'F6', panel: 'science',                     label: 'Science advisor',                    group: 'Advisors' },
      ],
      // Documentation-only rows for behaviour that isn't one key (the direction keys
      // and Escape, handled by the board itself).
      notes: [
        { keys: '↑ ↓ ← → / 1–9', label: 'Move the selected unit one square — into an enemy to attack it', group: 'Unit orders' },
        { keys: 'Shift + ↑ ↓ ← →', label: 'Scroll the map', group: 'Map & view' },
        { keys: 'Esc', label: 'Leave the current screen, or open the menu', group: 'Map & view' },
        // The city screen's own keys, handled there (CityInspectorOverlay.vue) because
        // they only exist while it is open.
        { keys: 'C', label: 'On the city screen: change production', group: 'Cities' },
        { keys: '1–9', label: 'On the city screen: pick what to build', group: 'Cities' },
      ],
    },
  },
  scenarios: [
    { id: 'standard', name: 'Standard', description: 'Random world map — set size below', config: {} },
    // Hand-built fixed maps (see fixedMaps.js).
    ...FIXED_MAPS.map(m => ({ id: m.id, name: m.name, description: m.description, config: {} })),
  ],
  // Water is the authentic Civ1 palette sampled from images/terrain (deep ocean
  // #5448a0 matches ocean.png exactly; coast is the shallow-blue ramp). The
  // coastline dither in toGrid stipples between them and greens the shore.
  // Recovered from the real game's art: Civ1 paints one green base under EVERY
  // land terrain (the terrain sprite supplies all the distinguishing texture), so
  // every land colour here is that same green; ocean matches the real water tile.
  colors: { ocean: '#5046a0', coast: '#5046a0', plains: '#719230', grassland: '#719230', forest: '#719230', hills: '#719230', mountains: '#719230', desert: '#719230', tundra: '#719230', arctic: '#719230', jungle: '#719230', swamp: '#719230' },
  gameOptions: [
    // Difficulty is a preset applied equally to BOTH civilizations (it never buffs the
    // AI — the AI only gets stronger or weaker from how much it is allowed to think).
    // Higher levels leave fewer citizens content, so cities fall into disorder sooner.
    { id: 'difficulty', label: 'Difficulty', description: 'Preset world rules for every civ — harder levels make citizens harder to keep content', type: 'select', default: DEFAULT_DIFFICULTY,
      options: DIFFICULTY_IDS.map(id => ({ value: id, label: `${DIFFICULTIES[id].name} (content ${DIFFICULTIES[id].contentBaseline})` })) },
    { id: 'contentBaseline', label: 'Content citizens (override)', description: 'Citizens content before the rest turn unhappy — blank uses the difficulty preset', type: 'integer', placeholder: 'from difficulty' },
    { id: 'fogOfWar', label: 'Fog of War', description: 'Each side sees only units and cities near its own', type: 'boolean', default: true },
    { id: 'width',  label: 'Map width',  description: 'Number of tiles across', type: 'range', min: 20, max: 100, step: 5, default: 50 },
    { id: 'height', label: 'Map height', description: 'Number of tiles down',   type: 'range', min: 10, max: 60,  step: 5, default: 30 },
    { id: 'land',    label: 'Land mass',   description: 'How much of the world is land', type: 'select', default: 1, options: [
      { value: 0, label: 'Small (islands)' }, { value: 1, label: 'Normal' }, { value: 2, label: 'Large (pangaea)' } ] },
    { id: 'temp',    label: 'Temperature', description: 'How far deserts spread from the equator', type: 'select', default: 1, options: [
      { value: 0, label: 'Cool' }, { value: 1, label: 'Temperate' }, { value: 2, label: 'Warm' } ] },
    { id: 'climate', label: 'Climate',     description: 'How wet the world is (grassland, jungle, swamp)', type: 'select', default: 1, options: [
      { value: 0, label: 'Arid' }, { value: 1, label: 'Normal' }, { value: 2, label: 'Wet' } ] },
    { id: 'age',     label: 'Age',         description: 'Erosion: older worlds have more hills and mountains', type: 'select', default: 1, options: [
      { value: 0, label: '3 billion years' }, { value: 1, label: '4 billion years' }, { value: 2, label: '5 billion years' } ] },
    { id: 'seed',   label: 'Map seed',   description: 'Positive integer for a repeatable map — leave blank for a random one', type: 'integer', placeholder: 'random' },
  ],
  createInitialState,
  getLegalActions,
  applyActions,
  getResult,
  renderState,
  getVisibleState,
  sampleWorlds,
  getActionDuration,

  toGrid(state) {
    const { board, units = [], cities = [] } = state;
    const { width, height, tiles } = board;
    const pidIdx = {};
    (state.players ?? []).forEach((p, i) => { pidIdx[p.id] = i + 1; });
    const umap = {}, cmap = {};
    for (const u of units) if (u.alive) umap[`${u.position.x},${u.position.y}`] = u;
    for (const c of cities) cmap[`${c.position.x},${c.position.y}`] = c;

    // River overlay: pick a directional sprite (river_<nesw>) from which screen
    // neighbours also carry a river or are ocean, so segments join up and reach
    // the sea. Order n,e,s,w matches the sprite filenames (e.g. river_nes.png).
    // Neighbour lookups wrap horizontally so the east/west seam renders seamlessly.
    const isLand = (x, y) => {
      const t = tiles[`${wrapX(x, width)},${y}`];
      return !!t && t.terrain !== 'ocean';
    };
    // Land terrain blends with its like neighbours exactly as the original does: each
    // terrain has 16 variants picked by which cardinal neighbours share the terrain
    // (n,e,s,w in the filename, e.g. forest_nes.png). Bit order N,E,S,W was recovered
    // from the real game's own art the same way as the coast — see coastSprites.js.
    const terrainSprite = (x, y, terrain) => {
      const same = (nx, ny) => tiles[`${wrapX(nx, width)},${ny}`]?.terrain === terrain;
      let d = '';
      if (same(x, y - 1)) d += 'n';
      if (same(x + 1, y)) d += 'e';
      if (same(x, y + 1)) d += 's';
      if (same(x - 1, y)) d += 'w';
      return `${BASE}/terrain/${terrain}${d ? `_${d}` : ''}`;
    };
    const riverOrSea = (x, y) => {
      const t = tiles[`${wrapX(x, width)},${y}`];
      return !!t && (t.hasRiver || t.terrain === 'ocean');
    };
    const riverSprite = (x, y) => {
      let d = '';
      if (riverOrSea(x, y - 1)) d += 'n';
      if (riverOrSea(x + 1, y)) d += 'e';
      if (riverOrSea(x, y + 1)) d += 's';
      if (riverOrSea(x - 1, y)) d += 'w';
      return `${BASE}/terrain/${d ? `river_${d}` : 'river'}`;
    };
    // Roads are drawn the way the original does: not one tile per pattern, but a
    // short segment from the tile centre out to each neighbour that also has a road,
    // stacked. Eight directional sprites (road_n .. road_nw, lifted from SP257.PIC);
    // an unconnected road draws nothing, as in the game.
    const ROAD_DIRS = [['n',0,-1],['ne',1,-1],['e',1,0],['se',1,1],['s',0,1],['sw',-1,1],['w',-1,0],['nw',-1,-1]];
    const hasRoad = (x, y) => !!tiles[`${wrapX(x, width)},${y}`]?.hasRoad;
    const roadSprites = (x, y) => {
      if (!hasRoad(x, y)) return [];
      return ROAD_DIRS
        .filter(([, dx, dy]) => hasRoad(x + dx, y + dy))
        .map(([d]) => `${BASE}/terrain/road_${d}`);
    };

    const isOcean = (x, y) => tiles[`${wrapX(x, width)},${y}`]?.terrain === 'ocean';

    // Coastline: the real Civ1 ocean tile for this square — one of 16, picked by
    // which of the four cardinal neighbours are land (see coastSprites.js). The
    // tiles are the game's own art, so the shore matches the original exactly.
    const coastSprite = (x, y) => {
      if (!isOcean(x, y)) return null;
      const pick = pickCoastTile({
        N: isLand(x, y - 1), S: isLand(x, y + 1), E: isLand(x + 1, y), W: isLand(x - 1, y),
      });
      return { image: `${BASE}/terrain/${pick.image}` };
    };

    const cells = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tile = tiles[`${x},${y}`] ?? {};
        const u = umap[`${x},${y}`];
        const city = cmap[`${x},${y}`];
        cells.push({
          x, y,
          glyph: u ? u.type[0].toUpperCase() : city ? '★' : '',
          unitId: u?.id ?? null,
          // City tiles ride the same glyph→pseudo-unit pipeline as real units (see
          // App.vue's buildField): a real sprite (map/city.png) plus the size as the
          // token's badge, which the HTML renderer draws as an owner-coloured plaque
          // carrying that size and the badgeLabel below it (HtmlBadgeToken.vue) — the
          // original game's city square.
          // The city wins the square over anything garrisoned in it, exactly as in the
          // original: a city with a militia inside is drawn as a CITY, not as the
          // militia. The unit is still what the square selects (unitId above) and what
          // the side panel, roster and HP/MP fields describe — only the art is the
          // city's, so unitName stays the unit's and the city's name rides badgeLabel.
          // For real units, `glyph` alone is ambiguous (militia/musketeers/mech-inf/
          // marines all start with 'm') — unitName carries the real type so the side
          // panel and roster show e.g. "militia" instead of a bare "M".
          unitName: u ? u.type : city ? city.name : undefined,
          imagePath: city ? `${BASE}/map/city` : (u ? (UNIT_IMAGES[u.type] ?? null) : null),
          // …but the panels that describe the *unit* (roster, selected-unit detail) keep
          // showing the unit: portraitPath wins over imagePath there, so a militia sitting
          // in a city is still a militia everywhere except on the map square itself.
          portraitPath: (city && u) ? (UNIT_IMAGES[u.type] ?? null) : undefined,
          badge: city ? city.size : null,
          badgeLabel: city ? city.name : undefined,
          // Ocean draws no terrain sprite — coastSprite (below) supplies the real
          // ocean tile. Land draws its authentic tile, blended with like neighbours.
          bgImage: tile.terrain === 'ocean' ? null : (tile.terrain ? terrainSprite(x, y, tile.terrain) : null),
          coastSprite: tile.terrain === 'ocean' ? coastSprite(x, y) : null,
          // Rivers first, then any road segments, painted in order over the terrain.
          // Rivers, then road segments, then this square's special resource (if any) —
          // painted in order over the terrain.
          overlayImage: [
            ...(tile.hasRiver ? [riverSprite(x, y)] : []),
            ...roadSprites(x, y),
            ...(specialAt(x, y, tile.terrain) ? [`${BASE}/terrain/${specialAt(x, y, tile.terrain).icon}`] : []),
          ],
          owner: u ? (pidIdx[u.ownerId] ?? 0) : city ? (pidIdx[city.ownerId] ?? 0) : 0,
          // All ocean tiles paint deep flat colour — coastSprite (above) draws the
          // land-facing shoreline art from coast_*.png on top, so shorelines
          // curve instead of snapping to whole lighter tiles.
          color: this.colors[tile.terrain] ?? this.colors.plains ?? '#808070',
          // "Coast" is purely a rendering distinction (shallow-water shading); the
          // engine terrain is always 'ocean', so inspection reports it as Ocean.
          // On a city tile the inspector shows the city (name, size, buildings) instead.
          terrain: city ? cityInfo(city, tile, x, y) : terrainInfo(tile, x, y),
          hp: u?.hp, maxHp: u?.maxHp,
          // Moves left this turn (drives the MP bar) and any queued future waypoints
          // (drives the goto-path overlay drawn for every unit — see App.vue/HtmlLayer).
          mp: u?.movesLeft, maxMp: u ? UNITS[u.type].moves : undefined,
          queue: u?.queue?.length ? u.queue : null,
          // Standing-order tags shown in the side panel (generic apps/design display
          // channel — see SelectedUnitDetail.vue's statusEffects tags).
          statusEffects: u ? [...(u.attrs?.fortified ? ['fortified'] : []), ...(u.attrs?.sentry ? ['sentry'] : [])] : undefined,
          // Whether this unit still wants orders this turn: has moves left and isn't
          // parked on a standing order. Drives the generic auto-advance-to-next-unit
          // UI feature (ui.autoAdvanceUnit below, see Battlefield.vue) — most games
          // don't have a persistent per-unit order state, so this is undefined for them.
          needsOrders: u ? (u.movesLeft > 0 && !u.attrs?.fortified && !u.attrs?.sentry) : undefined,
        });
      }
    }
    // Per-owner economy snapshot the client can't otherwise see (taxRate/luxRate are
    // never in a legal action's own fields except as the *target* of a set-tax/
    // set-luxury button — there's nowhere else to read the *current* rate from). Keyed
    // by player id so the UI can look up "my" civ via the pending player.
    const civ = Object.fromEntries(
      Object.entries(state.gameSpecific.civ ?? {}).map(([pid, c]) => [pid, {
        government: c.government, gold: c.gold, techCount: c.techs.length, research: c.research,
        // Tech names, not ids — the client (apps/design) has no access to tech.js, so
        // the Science overlay needs these pre-resolved rather than looking them up itself.
        researchName: c.research ? (TECHS[c.research]?.name ?? c.research) : null,
        researchedNames: c.techs.map(id => TECHS[id]?.name ?? id),
        bulbs: c.bulbs, researchCost: c.research ? techCost(c.techs.length) : null,
        taxRate: c.taxRate, luxRate: c.luxRate, taxMax: GOVERNMENTS[c.government].taxMax,
        anarchyTurns: c.anarchyTurns,
      }]));

    // Every city this player can currently see (own + any fogged-in enemy ones,
    // matching what state.cities already carries) — the Cities overlay lists just
    // its own, filtering client-side by ownerId the same way `civ` is looked up by pid.
    // Full per-city breakdown (production ETA, trade split, happiness) — the same
    // computeCity() the end-of-turn economy runs, called here read-only for the City
    // Inspector overlay. ctx is stateful across one owner's cities in board order
    // (assignWorkers must not let two cities claim the same tile) — mirrors
    // processOwnerEconomy's loop in economy.js exactly, minus the state mutation.
    const cityDetail = {};
    for (const ownerId of Object.keys(state.gameSpecific.civ ?? {})) {
      const ctx = buildOwnerCtx(state, ownerId);
      for (const c of state.cities) {
        if (c.ownerId !== ownerId) continue;
        const out = computeCity(c, ctx);
        const workedKeys = new Set(out.worked.map(w => w.key));

        // The full 21-square "fat cross" (see city.js's FAT_CROSS), not just the
        // worked subset — the City Inspector's radius map needs every square's
        // terrain/yield/status to render, worked or not. claimedByOther reflects only
        // cities already processed earlier in this loop (this owner's cities in board
        // order); a same-owner city later in `state.cities` that also wants one of
        // these squares won't show as a conflict here — an inherent snapshot
        // limitation of the sequential takenTiles bookkeeping, not worth a second pass
        // just for display.
        const radius = FAT_CROSS.map(([dx, dy]) => {
          const ry = c.position.y + dy;
          if (ry < 0 || ry >= height) return { dx, dy, offBoard: true };
          const rx = wrapX(c.position.x + dx, width);
          const key = `${rx},${ry}`;
          const tile = tiles[key];
          if (!tile) return { dx, dy, offBoard: true };
          const center = dx === 0 && dy === 0;
          const y3 = workedTileYield(tile, rx, ry, ctx);
          return {
            x: rx, y: ry, dx, dy, center,
            terrain: tile.terrain,
            sprite: tile.terrain === 'ocean' ? null : terrainSprite(rx, ry, tile.terrain),
            worked: workedKeys.has(key),
            claimedByOther: !center && !workedKeys.has(key) && ctx.takenTiles.has(key),
            yield: y3,
          };
        });
        for (const w of out.worked) ctx.takenTiles.add(`${w.x},${w.y}`);

        cityDetail[c.id] = {
          foodSurplus: out.foodSurplus,
          growthTurns: out.foodSurplus > 0 ? Math.ceil((foodBox(c.size) - c.food) / out.foodSurplus) : null,
          shieldsPerTurn: out.shields,
          buildTurnsLeft: out.shields > 0 ? Math.ceil((buildCost(c.production) - c.shields) / out.shields) : null,
          trade: out.trade, luxury: out.luxury, gold: out.gold, science: out.science,
          happy: out.happiness.happy, content: out.happiness.content, unhappy: out.happiness.unhappy,
          disorder: out.happiness.disorder,
          radius,
        };
      }
    }

    const citiesOut = state.cities.map(c => {
      const prod = UNITS[c.production] ? c.production
        : (IMPROVEMENTS[c.production]?.name ?? WONDERS[c.production]?.name ?? c.production);
      return {
        id: c.id, name: c.name, owner: c.ownerId, x: c.position.x, y: c.position.y,
        size: c.size, food: c.food, foodBox: foodBox(c.size),
        production: c.production, productionName: prod,
        shields: c.shields, buildCost: buildCost(c.production),
        buildings: (c.buildings ?? []).map(id => IMPROVEMENTS[id]?.name ?? WONDERS[id]?.name ?? id),
        ...cityDetail[c.id],
      };
    });

    // Per-owner military roster, grouped by unit type — the client only ever sees a
    // single ambiguous glyph letter per unit (see the `glyph` field above, which
    // collides: militia/musketeers/mech-inf/marines all start with 'm'), so counts and
    // attack/defense totals have to be computed here where UNITS is available.
    const military = {};
    for (const u of state.units) {
      if (!u.alive) continue;
      const stats = UNITS[u.type];
      const m = military[u.ownerId] ?? (military[u.ownerId] = { total: 0, totalAttack: 0, totalDefense: 0, byType: {} });
      m.total += 1;
      m.totalAttack += stats.attack;
      m.totalDefense += stats.defense;
      m.byType[u.type] = (m.byType[u.type] ?? 0) + 1;
    }

    // Generic {icon,value,title,warn} chips for the header's optional per-player status
    // strip (apps/design/battlefield/StatusChips.vue is a domain-agnostic renderer —
    // it has no idea what "gold" or "government" mean, only this game does).
    const statusChips = Object.fromEntries(
      Object.entries(civ).map(([pid, c]) => [pid, [
        { icon: 'zap', value: c.gold, title: 'Treasury' },
        { value: c.government, title: 'Government' },
        { value: `${c.taxRate}/${c.luxRate}/${100 - c.taxRate - c.luxRate}`, title: 'Tax / Luxury / Science' },
        ...(c.researchName ? [{ value: c.researchName, title: 'Researching' }] : []),
        ...(c.anarchyTurns ? [{ value: 'Anarchy', warn: true }] : []),
      ]]));

    // wrap: true tells the client the map is a horizontal cylinder (see wrapX above) —
    // Battlefield's click-to-pan centres on any column instead of clamping near the
    // east/west seam, and HtmlLayer draws duplicate columns there so panning stays seamless.
    return { width, height, cells, wrap: true, civ, cities: citiesOut, military, statusChips };
  },
};
