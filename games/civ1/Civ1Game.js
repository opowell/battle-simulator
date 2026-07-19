import { HTML_RENDERER_OPTION, MAP_ZOOM_OPTION } from '../renderOptions.js';
import { unitStrengthEval, sidesEval } from '../evalHelpers.js';
import { TERRAIN } from './terrain.js';
import { UNITS } from './units.js';
import { resolveCombat } from './combat.js';
import { mulberry32, generateMap, findStartPos, findAdjacentFree, getReachableTiles, renderMap, wrapX } from './map.js';
import { getCiv1Belief } from './belief.js';
import { pickCoastTile } from './coastSprites.js';
import { specialAt, tileYield } from './specials.js';
import { FIXED_MAPS, parseFixedMap, getFixedMap } from './fixedMaps.js';
import { TECHS, researchableTechs } from './tech.js';
import { IMPROVEMENTS, WONDERS, SPACESHIP, SPACESHIP_MIN, wonderEffectsFor, wonderBuiltInWorld } from './improvements.js';
import { GOVERNMENTS, availableGovernments } from './governments.js';
import { foodBox } from './city.js';
import { newCivState, buildOwnerCtx, buildableForCity, buildCost, processOwnerEconomy } from './economy.js';
import { queueMoveActions, queuePopAction, enqueueWaypoint, dequeueLastWaypoint, runQueuedMoves } from '../moveQueue.js';

const BASE = '/images/civ1';

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
  const newUnits = units.map(u =>
    u.id === unit.id ? { ...u, position: to, movesLeft: newMovesLeft } : u);

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

    const nextIdx = (currentIdx + 1) % playerIds.length;
    const nextPlayerId = playerIds[nextIdx];
    const newTurn = nextIdx === 0 ? state.turnNumber + 1 : state.turnNumber;

    // Refresh the next player's units. Magellan's Expedition grants +2 movement to
    // their ships.
    const nextEffects = wonderEffectsFor(cities, nextPlayerId);
    const navalBonus = nextEffects.has('naval-move') ? 2 : 0;
    units = units.map(u => {
      if (u.ownerId === nextPlayerId) {
        const base = UNITS[u.type].moves + (UNITS[u.type].domain === 'sea' ? navalBonus : 0);
        return { ...u, movesLeft: base };
      }
      return u;
    });
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
  if (action.type === 'queue-move') {
    units = enqueueWaypoint(units, action.unitId, action.to);
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
        if (result.attackerSurvived) return { ...u, hp: result.attackerHpLeft, movesLeft: 0 };
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
    units = units.map(u => u.id === action.unitId ? { ...u, movesLeft: 0 } : u);
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
  if (action.type === 'skip-unit') {
    units = units.map(u => u.id === action.unitId ? { ...u, movesLeft: 0 } : u);
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

  for (const pid of playerIds) {
    const hasCities = state.cities.some(c => c.ownerId === pid);
    const hasUnits  = state.units.some(u => u.alive && u.ownerId === pid);
    if (!hasCities && !hasUnits) {
      const winner = playerIds.find(id => id !== pid);
      return { outcome: 'win', winnerId: winner, reason: 'civilization-destroyed' };
    }
  }
  return null;
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderState(state) {
  const { turnNumber, activePlayers, units, cities, players } = state;
  const p1 = players[0], p2 = players[1];

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
    summarize(p1.id),
    summarize(p2.id),
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
      fogOfWar: config.fogOfWar ?? true,
      civ: Object.fromEntries(players.map(p => [p.id, newCivState()])),
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

  const pos1 = findStartPos(tiles, width, height, [1, Math.floor(width * 0.45)], rng);
  const pos2 = findStartPos(tiles, width, height, [Math.floor(width * 0.55), width - 1], rng);

  const [p1, p2] = players;

  let idCtr = 0;
  const units = [
    makeUnit(`u${idCtr++}`, p1.id, 'settlers', pos1.x,     pos1.y,     UNITS.settlers.moves),
    makeUnit(`u${idCtr++}`, p1.id, 'militia',  pos1.x + 1, pos1.y,     UNITS.militia.moves),
    makeUnit(`u${idCtr++}`, p2.id, 'settlers', pos2.x,     pos2.y,     UNITS.settlers.moves),
    makeUnit(`u${idCtr++}`, p2.id, 'militia',  pos2.x - 1, pos2.y,     UNITS.militia.moves),
  ].filter(u => {
    const k = `${u.position.x},${u.position.y}`;
    const t = tiles[k];
    return t && t.terrain !== 'ocean' && u.position.x >= 0 && u.position.x < width && u.position.y >= 0 && u.position.y < height;
  });

  return {
    gameName: 'Civ1',
    turnNumber: 1,
    activePlayers: [p1.id],
    currentPhase: 'action',
    players,
    board,
    units,
    cities: [],
    lastActions: null,
    gameSpecific: {
      nextId: idCtr,
      fogOfWar: config.fogOfWar ?? true,
      civ: Object.fromEntries(players.map(p => [p.id, newCivState()])),
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
  // Most units see only their 8 neighbours, as in the original; cities (bigger,
  // garrisoned, elevated) see a little further.
  const UNIT_VISION = 1;
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
  if (effects.has('reveal-map')) return state;
  const embassy = effects.has('embassy-all');

  return {
    ...state,
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

function getActionDuration(state, action) {
  if (action.type === 'move') {
    const unit = state.units.find(u => u.id === action.unitId);
    if (!unit) return 1;
    const from = action.from ?? unit.position;
    const dist = chebyshevWrapped(action.to, from, state.board.width);
    return dist / (UNITS[unit.type]?.moves ?? 1);
  }
  if (action.type === 'attack') return 1;
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
  // defaultTileSize: the map runs to 100x60 tiles, far more than fits legibly on the stage
  // at once — start at the original game's rough tile scale and let the player pan/zoom.
  // moveQueue: the goto-queue mechanic (games/moveQueue.js) — on by default for every game,
  // stated here explicitly since civ1 is the one that actually wires it up (queue-move/
  // queue-pop, see getLegalActions/applyActions above).
  ui: {
    hideGridLines: true, freeSelection: true, dragToMove: true, showFacing: false,
    blinkActiveUnit: true, allowDiagonalHopsWhileMoving: true, recolorTeamSprites: true,
    defaultTileSize: 40, moveQueue: true,
    // Health bars read as clutter on a strategy map at this zoom — off by default,
    // toggleable from the menu's settings overlay (see games/civ1/gameOptions).
    showHpBars: false,
    // Matches the server's UNIT_VISION (see getVisibleState) — without this the
    // client's default sight radius is 30% of the board's larger side, which both
    // misrepresents what's actually fogged and, when a unit is selected, paints a
    // huge lattice of per-tile borders that reads as a stray grid.
    visionRange: 1,
    // Coordinates aren't part of the original game's UI; hidden by default, toggle
    // from the menu ("Show ruler").
    showRuler: false,
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
    HTML_RENDERER_OPTION,
    MAP_ZOOM_OPTION,
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
          imagePath: u ? (UNIT_IMAGES[u.type] ?? null) : null,
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
        });
      }
    }
    // wrap: true tells the client the map is a horizontal cylinder (see wrapX above) —
    // Battlefield's click-to-pan centres on any column instead of clamping near the
    // east/west seam, and HtmlLayer draws duplicate columns there so panning stays seamless.
    return { width, height, cells, wrap: true };
  },
};
