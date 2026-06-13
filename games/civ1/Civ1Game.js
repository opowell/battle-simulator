import { TERRAIN } from './terrain.js';
import { UNITS } from './units.js';
import { resolveCombat } from './combat.js';
import { mulberry32, generateMap, findStartPos, findAdjacentFree, getReachableTiles, renderMap } from './map.js';

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
  };
}

// ── City production ───────────────────────────────────────────────────────────

const CITY_SHIELDS_PER_TURN = size => size * 2 + 1;

function processCityProduction(state, playerId, nextId) {
  let { units, cities } = state;
  let idCounter = nextId;

  const updatedCities = cities.map(city => {
    if (city.ownerId !== playerId) return city;

    const gained = CITY_SHIELDS_PER_TURN(city.size);
    const newShields = city.shields + gained;
    const item = city.production;
    const itemCost = UNITS[item]?.cost ?? 10;

    if (newShields >= itemCost) {
      const spawnPos = findAdjacentFree(city.position, state.board, units);
      if (spawnPos) {
        const newUnit = makeUnit(`u${idCounter++}`, city.ownerId, item, spawnPos.x, spawnPos.y, 0);
        units = [...units, newUnit];
      }
      return { ...city, shields: newShields - itemCost };
    }
    return { ...city, shields: newShields };
  });

  return { cities: updatedCities, units, nextId: idCounter };
}

// ── Legal actions ─────────────────────────────────────────────────────────────

function getLegalActions(state, playerId) {
  const { units, cities, board } = state;
  const myUnits = units.filter(u => u.alive && u.ownerId === playerId && u.movesLeft > 0);
  const actions = [];

  for (const unit of myUnits) {
    const stats = UNITS[unit.type];

    // Movement
    const reachable = getReachableTiles(unit, board, units, playerId);
    for (const to of reachable) {
      actions.push({ type: 'move', unitId: unit.id, from: unit.position, to });
    }

    // Attack: enemies in adjacent squares (Chebyshev distance ≤ 1)
    if (stats.attack > 0) {
      for (const enemy of units.filter(u => u.alive && u.ownerId !== playerId)) {
        const dx = Math.abs(enemy.position.x - unit.position.x);
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

    // Build road (settlers on non-ocean land without a road)
    if (stats.special.includes('build-road')) {
      const k = `${unit.position.x},${unit.position.y}`;
      const tile = board.tiles[k];
      if (tile && tile.terrain !== 'ocean' && !tile.hasRoad) {
        actions.push({ type: 'build-road', unitId: unit.id });
      }
    }

    actions.push({ type: 'skip-unit', unitId: unit.id });
  }

  actions.push({ type: 'end-turn', unitId: '__player__' });
  return actions;
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
    const prod = processCityProduction({ ...state, units, cities }, playerId, nextId);
    units = prod.units;
    cities = prod.cities;
    nextId = prod.nextId;

    const nextIdx = (currentIdx + 1) % playerIds.length;
    const nextPlayerId = playerIds[nextIdx];
    const newTurn = nextIdx === 0 ? state.turnNumber + 1 : state.turnNumber;

    units = units.map(u => {
      if (u.ownerId === nextPlayerId) {
        return { ...u, movesLeft: UNITS[u.type].moves };
      }
      return u;
    });

    return {
      ...state,
      units,
      cities,
      activePlayers: [nextPlayerId],
      turnNumber: newTurn,
      lastActions: playerActions,
      gameSpecific: { ...state.gameSpecific, nextId },
    };
  }

  // ── move ──────────────────────────────────────────────────────────────────
  if (action.type === 'move') {
    const unit = units.find(u => u.id === action.unitId);
    const tile = board.tiles[`${action.to.x},${action.to.y}`];
    const td = tile ? TERRAIN[tile.terrain] : null;

    let cost;
    if (UNITS[unit.type].domain === 'air') {
      cost = 1;
    } else if (tile?.hasRoad) {
      cost = 1 / 3;
    } else {
      cost = td?.moveCost ?? 1;
    }

    const newMovesLeft = Math.max(0, unit.movesLeft - cost);
    units = units.map(u =>
      u.id === action.unitId ? { ...u, position: action.to, movesLeft: newMovesLeft } : u
    );
    return { ...state, units, lastActions: playerActions };
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

  // ── found-city ────────────────────────────────────────────────────────────
  if (action.type === 'found-city') {
    const unit = units.find(u => u.id === action.unitId);
    const name = getNextCityName(cities, playerId);
    const newCity = {
      id: `city-${nextId++}`,
      name,
      ownerId: playerId,
      position: { ...unit.position },
      size: 1,
      shields: 0,
      food: 0,
      production: 'militia',
    };
    cities = [...cities, newCity];
    units = units.filter(u => u.id !== action.unitId);
    return {
      ...state, units, cities, lastActions: playerActions,
      gameSpecific: { ...state.gameSpecific, nextId },
    };
  }

  // ── build-road ────────────────────────────────────────────────────────────
  if (action.type === 'build-road') {
    const unit = units.find(u => u.id === action.unitId);
    const k = `${unit.position.x},${unit.position.y}`;
    const newTiles = { ...board.tiles, [k]: { ...board.tiles[k], hasRoad: true } };
    units = units.map(u => u.id === action.unitId ? { ...u, movesLeft: 0 } : u);
    return { ...state, units, board: { ...board, tiles: newTiles }, lastActions: playerActions };
  }

  // ── skip-unit ─────────────────────────────────────────────────────────────
  if (action.type === 'skip-unit') {
    units = units.map(u => u.id === action.unitId ? { ...u, movesLeft: 0 } : u);
    return { ...state, units, lastActions: playerActions };
  }

  return state;
}

// ── Win condition ─────────────────────────────────────────────────────────────

function getResult(state) {
  const playerIds = state.players.map(p => p.id);
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
    const unitStr = alive.map(u => `${u.type}(${u.hp}hp)`).join(', ') || '—';
    return `${pid}: cities=${ownCities.map(c => c.name).join(',')||'none'} | units: ${unitStr}`;
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

// ── createInitialState ────────────────────────────────────────────────────────

function createInitialState(players, config = {}) {
  const width  = config.width  ?? 20;
  const height = config.height ?? 14;
  const seed   = config.seed   ?? 12345;

  const rng = mulberry32(seed);
  const tiles = generateMap(width, height, rng);
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
    gameSpecific: { nextId: idCtr },
  };
}

// ── Fog of war ────────────────────────────────────────────────────────────────

function getVisibleState(state, playerId) {
  const VISION = 2;
  const myUnits  = state.units.filter(u => u.alive && u.ownerId === playerId);
  const myCities = state.cities.filter(c => c.ownerId === playerId);
  const canSee = pos =>
    myUnits.some(m  => Math.max(Math.abs(m.position.x - pos.x), Math.abs(m.position.y - pos.y)) <= VISION) ||
    myCities.some(c => Math.max(Math.abs(c.position.x - pos.x), Math.abs(c.position.y - pos.y)) <= VISION);
  return {
    ...state,
    units:  state.units.filter(u  => u.ownerId  === playerId || canSee(u.position)),
    cities: state.cities.filter(c => c.ownerId  === playerId || canSee(c.position)),
  };
}

// ── Export ────────────────────────────────────────────────────────────────────

export const Civ1Game = {
  name: 'Civ1',
  createInitialState,
  getLegalActions,
  applyActions,
  getResult,
  renderState,
  getVisibleState,
};
