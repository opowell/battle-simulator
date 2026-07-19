import { unitStrengthEval } from '../evalHelpers.js';
import { UNIT_DEFS, createUnit } from './units.js';
import { createMap, createMapFromShapes, renderMap, TERRAIN, isPassableContinuous, getMoveCostContinuous } from './map.js';
import { getReachable } from './grid.js';
import { hasLOS } from './los.js';
import { resolveFire } from './combat.js';
import { getCombatMissionBelief } from './belief.js';
import { SHAPE_SCENARIOS } from './scenarios.js';
import { tilesToShapes } from '../terrainShapes.js';
import { lineCost, isClearOfUnits, latticeActions } from '../continuousMove.js';
import { parsePos, num, posToWire } from '../coord.js';
import { MAP_ZOOM_OPTION } from '../renderOptions.js';

// ── Scenario ──────────────────────────────────────────────────────────────────

function createScenario(players) {
  const [allied, axis] = players;
  let n = 0;
  const id = () => `u${n++}`;
  return [
    // Allies (US) — deploy in northern half (y 1–6)
    createUnit(id(), 'rifle-squad',  allied.id, { x:  1, y:  2 }),
    createUnit(id(), 'rifle-squad',  allied.id, { x:  8, y:  1 }),
    createUnit(id(), 'mg-team',      allied.id, { x:  1, y:  4 }),
    createUnit(id(), 'sniper',       allied.id, { x:  5, y:  1 }),
    createUnit(id(), 'bazooka-team', allied.id, { x:  3, y:  3 }),
    createUnit(id(), 'mortar-team',  allied.id, { x:  2, y:  6 }),
    createUnit(id(), 'sherman',      allied.id, { x:  9, y:  5 }),
    createUnit(id(), 'stuart',       allied.id, { x: 14, y:  4 }),
    // Axis (German) — deploy in southern half (y 8–14)
    createUnit(id(), 'volks-squad',   axis.id,  { x:  1, y: 14 }),
    createUnit(id(), 'volks-squad',   axis.id,  { x: 11, y: 14 }),
    createUnit(id(), 'mg42-team',     axis.id,  { x: 18, y: 10 }),
    createUnit(id(), 'german-sniper', axis.id,  { x: 14, y: 14 }),
    createUnit(id(), 'panzerschreck', axis.id,  { x: 16, y: 11 }),
    createUnit(id(), 'mortar-ger',    axis.id,  { x: 17, y: 13 }),
    createUnit(id(), 'panzer-iv',     axis.id,  { x:  5, y: 12 }),
    createUnit(id(), 'tiger',         axis.id,  { x: 11, y:  9 }),
  ];
}

// Build a units array from a shape scenario's `deploy` table: { allied: [[type,x,y]…],
// axis: [[type,x,y]…] }. players[0] = allied side, players[1] = axis side.
function deployScenario(scen, players) {
  const [allied, axis] = players;
  let n = 0;
  const id = () => `u${n++}`;
  const side = (list, ownerId) => list.map(([type, x, y]) => createUnit(id(), type, ownerId, { x, y }));
  return [
    ...side(scen.deploy.allied, allied.id),
    ...side(scen.deploy.axis,   axis.id),
  ];
}

// Resolve a scenario id → { board, units(players) }. The DEFAULT (no/unknown scenario) is
// the dense shape-based Bocage map; 'ambush' selects the original hand-laid grid map; the
// rest are the other shape-based (non-grid terrain) maps.
function resolveScenario(scenId, players) {
  if (scenId === 'ambush') return { board: createMap(), units: createScenario(players) };
  const scen = (scenId && SHAPE_SCENARIOS[scenId]) || SHAPE_SCENARIOS.bocage;
  return { board: createMapFromShapes(scen), units: deployScenario(scen, players) };
}

// ── Legal actions ─────────────────────────────────────────────────────────────

function getLegalActions(state, playerId) {
  const { units, board } = state;
  const myUnits = units.filter(u => u.alive && u.ownerId === playerId && u.perTurn.ap > 0);
  const actions = [];

  for (const unit of myUnits) {
    const def = UNIT_DEFS[unit.type];

    // Move (1 AP)
    const reachable = getReachable(board, unit.position, def.moveRange, units);
    for (const to of reachable) {
      actions.push({ type: 'move', unitId: unit.id, to });
    }

    // Fire (1 AP) — target must be in range and have LOS
    const enemies = units.filter(u => u.alive && u.ownerId !== playerId);
    for (const enemy of enemies) {
      const dist = Math.sqrt(
        (num(enemy.position.x) - num(unit.position.x)) ** 2 +
        (num(enemy.position.y) - num(unit.position.y)) ** 2
      );
      if (dist <= def.range && hasLOS(board, unit.position, enemy.position)) {
        actions.push({ type: 'fire', unitId: unit.id, targetId: enemy.id });
      }
    }

    actions.push({ type: 'skip-unit', unitId: unit.id });
  }

  actions.push({ type: 'end-turn', unitId: '__player__' });
  return actions;
}

// ── isMoveLegal ───────────────────────────────────────────────────────────────
// Geometric fallback for the human UI's continuous click-to-move (see the doom
// equivalent in DoomGame.js and engine/ActionValidator.js): getLegalActions above
// still enumerates a discrete candidate set for AI search (grid.js's weighted
// Dijkstra), but a player's move can target any point their click resolves to —
// legality here is a straight-line movement-cost/wall/occupancy check (still
// respecting woods/hedgerow slowdown via getMoveCostContinuous) instead of exact
// membership in that candidate set.
function isMoveLegal(state, playerId, action) {
  const { units, board } = state;
  const unit = units.find(u => u.id === action.unitId);
  if (!unit || !unit.alive || unit.ownerId !== playerId || unit.perTurn.ap <= 0) return false;
  const def = UNIT_DEFS[unit.type];
  // Continuous geometry runs in float64; convert the authoritative BigNumber position
  // and the incoming wire coordinate to Number here (see games/coord.js §2).
  const px = num(unit.position.x), py = num(unit.position.y);
  const x = num(action.to.x), y = num(action.to.y);
  if (!isPassableContinuous(board, x, y)) return false;
  const cost = lineCost(px, py, x, y,
    (qx, qy) => isPassableContinuous(board, qx, qy) ? getMoveCostContinuous(board, qx, qy) : Infinity);
  if (cost > def.moveRange) return false;
  if (!isClearOfUnits(x, y, units, unit.id)) return false;
  return true;
}

// Dispatcher for the engine's continuous-action fallback (engine/ActionValidator.js):
// only 'move' carries a continuous, not-pre-enumerated destination in Combat Mission.
function isActionLegal(state, playerId, action) {
  return action.type === 'move' ? isMoveLegal(state, playerId, action) : false;
}

// Continuous action set for the ObscuroAgent's tree search: each mover's discrete tile
// moves are replaced by a lattice of exact reachable points (see games/continuousMove.js),
// so the AI positions freely like a human. Fire/skip/end-turn pass through unchanged.
function getSearchActions(state, playerId, res) {
  const units = state.units;
  return latticeActions(getLegalActions(state, playerId), {
    type: 'move', point: 'to',
    origin: a => { const u = units.find(x => x.id === a.unitId); return u ? { x: num(u.position.x), y: num(u.position.y), range: UNIT_DEFS[u.type].moveRange } : null; },
    isLegal: (a, x, y) => isMoveLegal(state, playerId, { unitId: a.unitId, to: { x, y } }),
  }, res);
}

// ── Apply actions ─────────────────────────────────────────────────────────────

function applyActions(state, playerActions, rng = Math.random) {
  const { playerId, action } = playerActions[0];
  let { units } = state;
  const playerIds = state.players.map(p => p.id);
  const currentIdx = playerIds.indexOf(playerId);

  if (action.type === 'end-turn') {
    const nextIdx = (currentIdx + 1) % playerIds.length;
    const nextPlayerId = playerIds[nextIdx];
    const newTurn = nextIdx === 0 ? state.turnNumber + 1 : state.turnNumber;

    // Restore AP and decay suppression for the player who is about to move
    units = units.map(u => {
      if (u.ownerId !== nextPlayerId) return u;
      return {
        ...u,
        perTurn: { ap: UNIT_DEFS[u.type].ap },
        suppression: Math.max(0, u.suppression - 1),
      };
    });

    return {
      ...state, units,
      activePlayers: [nextPlayerId],
      turnNumber: newTurn,
      lastActions: playerActions,
    };
  }

  if (action.type === 'move') {
    // action.to: decimal strings (human continuous click) or integer tile (AI); store
    // as the authoritative BigNumber position (see games/coord.js).
    const to = parsePos(action.to);
    units = units.map(u =>
      u.id === action.unitId
        ? { ...u, position: to, perTurn: { ...u.perTurn, ap: u.perTurn.ap - 1 } }
        : u
    );
    return { ...state, units, lastActions: playerActions };
  }

  if (action.type === 'fire') {
    const shooter = units.find(u => u.id === action.unitId);
    const target  = units.find(u => u.id === action.targetId);
    if (!shooter || !target) return state;

    const result = resolveFire(shooter, target, state.board, rng);

    units = units.map(u => {
      if (u.id === action.unitId) {
        return { ...u, perTurn: { ...u.perTurn, ap: u.perTurn.ap - 1 } };
      }
      if (u.id === action.targetId) {
        const newHp = Math.max(0, u.hp - result.damage);
        return { ...u, hp: newHp, alive: newHp > 0, suppression: u.suppression + result.targetSuppression };
      }
      return u;
    });

    return {
      ...state, units, lastActions: playerActions,
      gameSpecific: { ...state.gameSpecific, lastCombat: result },
    };
  }

  if (action.type === 'skip-unit') {
    units = units.map(u =>
      u.id === action.unitId ? { ...u, perTurn: { ...u.perTurn, ap: 0 } } : u
    );
    return { ...state, units, lastActions: playerActions };
  }

  return state;
}

// ── Win condition ─────────────────────────────────────────────────────────────

function getResult(state) {
  for (const pid of state.players.map(p => p.id)) {
    if (!state.units.some(u => u.ownerId === pid && u.alive)) {
      const winner = state.players.find(p => p.id !== pid).id;
      return { outcome: 'win', winnerId: winner, reason: 'all-units-eliminated' };
    }
  }
  return null;
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderState(state) {
  const { turnNumber, activePlayers, units, players, gameSpecific } = state;

  const summarize = pid => {
    const name = players.find(p => p.id === pid).name;
    const alive = units.filter(u => u.ownerId === pid && u.alive);
    if (!alive.length) return `${name}: (eliminated)`;
    return `${name}: ` + alive.map(u => {
      const sup = u.suppression > 0 ? ` sup:${u.suppression}` : '';
      return `${UNIT_DEFS[u.type].label}(${u.hp}hp${sup})`;
    }).join(', ');
  };

  const combatLine = gameSpecific?.lastCombat
    ? `Last fire: ${gameSpecific.lastCombat.hit ? 'HIT' : 'MISS'} ` +
      `(roll ${gameSpecific.lastCombat.roll}/${gameSpecific.lastCombat.hitChance}% needed) ` +
      `dmg=${gameSpecific.lastCombat.damage}`
    : '';

  return [
    `═══ Turn ${turnNumber} — ${activePlayers[0]} ═══`,
    renderMap(state.board, units),
    `Legend: R=Rifle G=MG N=Sniper Z=Bazooka O=Mortar S=Sherman U=Stuart  |  V=Volks M=MG42 X=GSniper P=Pzschreck Q=GMortar F=PanzerIV K=Tiger  |  w=hedge T=trees r=road #=building`,
    '',
    summarize(players[0].id),
    summarize(players[1].id),
    combatLine,
  ].filter(Boolean).join('\n');
}

// ── createInitialState ────────────────────────────────────────────────────────

function createInitialState(players, config = {}) {
  const { board, units: scenUnits } = resolveScenario(config.scenario, players);
  const units = config.units ?? scenUnits;
  return {
    gameName: 'CombatMission',
    turnNumber: 1,
    activePlayers: [players[0].id],
    currentPhase: 'action',
    players,
    board,
    units,
    lastActions: null,
    gameSpecific: {
      lastCombat: null,
      fogOfWar: config.fogOfWar ?? false,
      startRoster: units.map(u => ({
        id: u.id, ownerId: u.ownerId, type: u.type, position: { ...u.position },
        hp: u.hp,
        moveRange: UNIT_DEFS[u.type].moveRange,
        maxAP: UNIT_DEFS[u.type].ap,
      })),
    },
  };
}

// ── Fog of war ────────────────────────────────────────────────────────────────

function getVisibleState(state, playerId) {
  const VISION = 5;
  const myUnits = state.units.filter(u => u.alive && u.ownerId === playerId);
  return {
    ...state,
    units: state.units.filter(u =>
      u.ownerId === playerId ||
      myUnits.some(m =>
        Math.max(Math.abs(num(m.position.x) - num(u.position.x)), Math.abs(num(m.position.y) - num(u.position.y))) <= VISION &&
        hasLOS(state.board, m.position, u.position)
      )
    ),
  };
}

// ── Design UI grid ───────────────────────────────────────────────────────────

const TERRAIN_INFO = {
  [TERRAIN.FLOOR]: { name: 'Open Ground', description: 'No cover, no movement penalty.' },
  [TERRAIN.WALL]:  { name: 'Building',    description: 'Impassable, blocks line of sight.' },
  [TERRAIN.HEDGE]: { name: 'Hedgerow',    description: 'Passable, +30% cover, does not block LOS.' },
  [TERRAIN.TREE]:  { name: 'Trees',       description: 'Passable, blocks LOS, +20% cover.' },
  [TERRAIN.ROAD]:  { name: 'Road',        description: 'Passable, no cover.' },
  [TERRAIN.WATER]: { name: 'Water',       description: 'Impassable, but does not block line of sight.' },
};

const TERRAIN_COLORS = {
  [TERRAIN.FLOOR]: '#7d8f5c',
  [TERRAIN.WALL]:  '#5a5045',
  [TERRAIN.HEDGE]: '#4d6b3a',
  [TERRAIN.TREE]:  '#2f5c2f',
  [TERRAIN.ROAD]:  '#9c8f6b',
  [TERRAIN.WATER]: '#35617a',
};

// Ground colour under the map — terrain is drawn by the SVG shapes, so the tile layer
// stays a uniform open-ground backdrop.
const SHAPE_GROUND = '#7d8f5c';

// Styles for turning the classic tile map into merged rectangle shapes so it renders as
// layered SVGs too. Open ground (FLOOR) is left as background.
const CM_TILE_SHAPE_STYLES = {
  [TERRAIN.WALL]:  { fill: '#5a5045', stroke: '#6b5f50', name: 'Building', description: 'Impassable, blocks line of sight.' },
  [TERRAIN.TREE]:  { fill: '#2f5c2f', stroke: '#3f6f3f', name: 'Woods',    description: 'Passable but slow; blocks LOS, +20% cover.' },
  [TERRAIN.HEDGE]: { fill: '#4d6b3a', stroke: '#5f7d48', name: 'Hedgerow', description: 'Passable but slow; +30% cover, does not block LOS.' },
  [TERRAIN.ROAD]:  { fill: '#9c8f6b', name: 'Road', description: 'Passable, no cover.' },
  [TERRAIN.WATER]: { fill: '#35617a', opacity: 0.9, name: 'Water', description: 'Impassable, but does not block line of sight.' },
};

// Side-panel portraits (single image each, sourced from Wikimedia Commons — vehicle
// line-art/photos for the tanks, weapon product photos for the infantry teams).
// german-sniper has no clean distinct source (only generic combat-scene archive photos
// of K98k-with-scope were found) so it's left without a portrait.
const UNIT_PORTRAITS = new Set([
  'rifle-squad', 'mg-team', 'sniper', 'bazooka-team', 'mortar-team', 'sherman', 'stuart',
  'volks-squad', 'mg42-team', 'panzerschreck', 'mortar-ger', 'panzer-iv', 'tiger',
]);

function toGrid(state) {
  const { board, units } = state;
  const { width, height, tiles } = board;
  const pidIdx = {};
  (state.players ?? []).forEach((p, i) => { pidIdx[p.id] = i + 1; });

  // Terrain-only cells (terrain conveyed by the shapes below). Unit positions travel in
  // the continuous `units` channel, not by exact-match into this integer grid.
  const cells = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = tiles[y][x];
      cells.push({
        x, y,
        color: SHAPE_GROUND,
        terrain: TERRAIN_INFO[t] ?? TERRAIN_INFO[TERRAIN.FLOOR],
      });
    }
  }

  // Continuous unit channel: real (possibly non-integer) positions as decimal strings
  // (see games/coord.js), built directly from state.units.
  const unitList = (units ?? []).filter(u => u.alive).map(u => {
    const p = posToWire(u.position);
    return {
      id: u.id, x: p.x, y: p.y,
      glyph:     u.attrs.symbol,
      owner:     pidIdx[u.ownerId] ?? 0,
      hp:        u.hp,
      maxHp:     u.maxHp,
      unitName:  UNIT_DEFS[u.type].label,
      moveRange: UNIT_DEFS[u.type].moveRange,
      portraitPath: UNIT_PORTRAITS.has(u.type) ? `/images/combatmission/units/${u.type}` : undefined,
    };
  });

  // Shape scenarios supply authored shapes (ovals + rects); the classic map has its tiles
  // merged into rectangles. Either way CS/CM/War of Dots all render as layered SVGs.
  const shapes = board.shapes
    ?? tilesToShapes((x, y) => tiles[y][x], width, height, CM_TILE_SHAPE_STYLES);

  return { width, height, locationType: 'continuous', cells, units: unitList, shapes, ui: { hideGridLines: true } };
}

// ── Export ────────────────────────────────────────────────────────────────────

function getActionDuration(state, action) {
  if (action.type === 'move') {
    const unit = state.units.find(u => u.id === action.unitId);
    if (!unit) return 1;
    const from = unit.position;
    const dist = Math.max(Math.abs(num(action.to.x) - num(from.x)), Math.abs(num(action.to.y) - num(from.y)));
    return dist / (UNIT_DEFS[unit.type]?.moveRange ?? 2);
  }
  if (action.type === 'fire') {
    const unit   = state.units.find(u => u.id === action.unitId);
    const target = state.units.find(u => u.id === action.targetId);
    if (!unit || !target) return 1;
    const dx = num(target.position.x) - num(unit.position.x);
    const dy = num(target.position.y) - num(unit.position.y);
    const dist = Math.sqrt(dx * dx + dy * dy);
    return dist / 15;  // bullet travel at 15 tiles/sec
  }
  return 1;
}

export const CombatMissionGame = {
  // Heuristic leaf value for the generic ObscuroAgent: own surviving strength
  // minus the enemy's. See games/evalHelpers.js.
  evaluateState: (state, playerId) => unitStrengthEval(state, playerId),
  name: 'CombatMission',
  scenarios: [
    { id: 'bocage',      name: 'Bocage',        description: 'Normandy hedgerow country — a dense patchwork of walled fields, sunken lanes, orchards and a farm hamlet', config: {} },
    { id: 'river_line',  name: 'River Line',    description: 'Shape terrain — a single bridge crosses an impassable river', config: { scenario: 'river_line' } },
    { id: 'hill_woods',  name: 'Hill & Woods',  description: 'Shape terrain — scattered oval woods over open hills', config: { scenario: 'hill_woods' } },
    { id: 'ambush',      name: 'Ambush',        description: 'Platoon-level infantry ambush on the original mixed-terrain grid', config: { scenario: 'ambush' } },
  ],
  gameOptions: [
    MAP_ZOOM_OPTION,
    { id: 'fogOfWar', label: 'Fog of War', description: 'Each side sees only enemies within sight and line of sight', type: 'boolean', default: false },
  ],
  createInitialState,
  getLegalActions,
  isActionLegal,
  getSearchActions,
  applyActions,
  getResult,
  renderState,
  getVisibleState,
  getActionDuration,
  toGrid,

  sampleWorlds(observation, playerId, n, rng = Math.random) {
    if (!observation.gameSpecific.fogOfWar) return [];
    const belief = getCombatMissionBelief(observation, playerId);
    belief.beginTurn(observation);
    return belief.sample(observation, n, rng,
      (id, ownerId, type, x, y) => createUnit(id, type, ownerId, { x, y }));
  },
};
