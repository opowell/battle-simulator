import { unitStrengthEval } from '../evalHelpers.js';
import { UNIT_DEFS, createUnit } from './units.js';
import { createMap, createMapFromShapes, renderMap, TERRAIN, isPassableContinuous, getMoveCostContinuous } from './map.js';
import { resolveSpaceTime } from '../spacetime.js';
import {
  getLegalActions, getSearchActions, isActionLegal, applyActions, getActionDuration,
  getProjectileSpeed, actionKey, freshPerTurn, reachLeft, spaceTimeOf, sees,
  ticksLeft, apLeft, TICKS_PER_SECOND,
} from './rules.js';
import { getCombatMissionBelief } from './belief.js';
import { SHAPE_SCENARIOS } from './scenarios.js';
import { terrainArt, unitArt } from './art.js';
import { tilesToShapes } from '../terrainShapes.js';
import { num, posToWire } from '../coord.js';
import { MAP_ZOOM_OPTION } from '../renderOptions.js';
import { tableUnits, whole } from '../../engine/foreignUnits.js';

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

  const lc = gameSpecific?.lastCombat;
  const combatLine = !lc ? ''
    : lc.area
      ? `Last fire: area fire at (${lc.at.x}, ${lc.at.y}) — ` +
        (lc.hits.length ? lc.hits.map(h => `${h.targetId} ${h.hit ? `HIT dmg=${h.damage}` : 'MISS'}`).join(', ') : 'nobody there')
      : `Last fire: ${lc.hit ? 'HIT' : 'MISS'} ` +
        `(roll ${lc.roll}/${lc.hitChance}% needed) ` +
        `dmg=${lc.damage}`;

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
  // The time axis (discrete AP vs a continuous minute — see rules.js) comes from the
  // session's `time` option over the game's default; sequential vs we-go play is the
  // engine's own switch (simultaneousTurns), read here so the rules agree with it.
  const st = { ...resolveSpaceTime(CombatMissionGame, config),
    play: (config.play === 'simultaneous' || config.simultaneousTurns) ? 'simultaneous' : 'sequential' };
  const units = (config.units ?? scenUnits).map(u => ({ ...u, perTurn: freshPerTurn(st, UNIT_DEFS[u.type]) }));
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
      spacetime: st,
      // Sides that have ended the current turn (it closes when all have — rules.js).
      turnEnded: [],
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
  const myUnits = state.units.filter(u => u.alive && u.ownerId === playerId);
  return {
    ...state,
    units: state.units.filter(u => u.ownerId === playerId || myUnits.some(m => sees(state.board, m, u))),
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
  [TERRAIN.WALL]:  { kind: 'building', fill: '#5a5045', stroke: '#6b5f50', name: 'Building', description: 'Impassable, blocks line of sight.' },
  [TERRAIN.TREE]:  { kind: 'woods', fill: '#2f5c2f', stroke: '#3f6f3f', name: 'Woods',    description: 'Passable but slow; blocks LOS, +20% cover.' },
  [TERRAIN.HEDGE]: { kind: 'hedge', fill: '#4d6b3a', stroke: '#5f7d48', name: 'Hedgerow', description: 'Passable but slow; +30% cover, does not block LOS.' },
  [TERRAIN.ROAD]:  { kind: 'road', fill: '#9c8f6b', name: 'Road', description: 'Passable, no cover.' },
  [TERRAIN.WATER]: { kind: 'water', fill: '#35617a', opacity: 0.9, name: 'Water', description: 'Impassable, but does not block line of sight.' },
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
  const st = spaceTimeOf(state);
  const unitList = (units ?? []).filter(u => u.alive).map(u => {
    const p = posToWire(u.position);
    const art = unitArt(u.type, unitHeading(state, u));
    const def = UNIT_DEFS[u.type];
    return {
      // Top-down silhouette (tank hull + turret, a squad's men…) — see art.js.
      ...(art ?? {}),
      id: u.id, x: p.x, y: p.y,
      glyph:     u.attrs.symbol,
      owner:     pidIdx[u.ownerId] ?? 0,
      hp:        u.hp,
      maxHp:     u.maxHp,
      unitName:  UNIT_DEFS[u.type].label,
      // How far ONE move may still go this turn (the move circle, a group's formation
      // reach) — 0 once the unit's budget is spent.
      moveRange: reachLeft(st, u),
      // What is left of the turn's budget: seconds of the minute, or action points.
      stats: st.time === 'continuous'
        ? { time: `${ticksLeft(u) / TICKS_PER_SECOND}s`, range: def.range }
        : { AP: `${apLeft(u)}/${def.ap}`, range: def.range },
      portraitPath: UNIT_PORTRAITS.has(u.type) ? `/images/combatmission/units/${u.type}` : undefined,
    };
  });

  // The terrain, drawn as the features it is (roofs, hedges, tree crowns, crop rows…) —
  // see art.js. Facing arrows are off: a unit's silhouette already shows which way it
  // points, and CM has no facing rule for an arrow to report.
  const shapes = boardArt(board);

  return { width, height, locationType: 'continuous', cells, units: unitList, shapes, ui: { hideGridLines: true, showFacing: false } };
}

// The drawn terrain for a board, built once per board object (a board never changes
// during a game). Shape scenarios dress their authored shapes; the classic tile map has
// its tiles merged into rectangles first (the border ring left out — art.js frames it).
const boardArtCache = new WeakMap();
function boardArt(board) {
  let shapes = boardArtCache.get(board);
  if (shapes) return shapes;
  const { width, height, tiles } = board;
  const terrain = board.shapes
    ?? tilesToShapes((x, y) => (x === 0 || y === 0 || x === width - 1 || y === height - 1) ? null : tiles[y][x],
                     width, height, CM_TILE_SHAPE_STYLES);
  shapes = terrainArt(terrain, board);
  boardArtCache.set(board, shapes);
  return shapes;
}

// Which way a unit's silhouette points, in radians (0 = east, +y = south). CM has no
// facing rule, so this is presentation only: a unit that has moved off its start faces
// the way it went from there; one that hasn't faces the enemy's side of the map
// (players[0] deploys north, so faces south). Read only from the unit's own position and
// the public start roster, so it gives nothing away about anyone hidden.
function unitHeading(state, u) {
  // Having fired since it last moved, a unit faces what it fired at (rules.js `aimAt`).
  if (u.aimAt) {
    const dx = u.aimAt.x - num(u.position.x), dy = u.aimAt.y - num(u.position.y);
    if (dx || dy) return Math.atan2(dy, dx);
  }
  const start = state.gameSpecific?.startRoster?.find(r => r.id === u.id);
  if (start) {
    const dx = num(u.position.x) - num(start.position.x), dy = num(u.position.y) - num(start.position.y);
    if (Math.hypot(dx, dy) > 0.75) return Math.atan2(dy, dx);
  }
  return u.ownerId === state.players?.[0]?.id ? Math.PI / 2 : -Math.PI / 2;
}

// ── Export ────────────────────────────────────────────────────────────────────

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
  // Combat Mission is fought under fog, both sides plotting at once, with each unit's
  // minute spent in continuous time (rules.js). `spacetime` is the time axis for any
  // session that doesn't name one. Simultaneous turns is an engine option: defaultConfig
  // turns it on for an API-made session and is also what the setup form starts that
  // option at (api-server's handleGames).
  spacetime: { space: 'continuous', time: 'continuous' },
  defaultConfig: { simultaneousTurns: true },
  gameOptions: [
    MAP_ZOOM_OPTION,
    { id: 'fogOfWar', label: 'Fog of War', description: 'Each side sees only enemies within sight and line of sight', type: 'boolean', default: true },
    { id: 'time', label: 'Time', description: 'Continuous (each unit spends a minute of real time per turn — moving takes as long as the walk) or discrete (two action points a turn)', type: 'select', default: 'continuous',
      options: [{ value: 'continuous', label: 'Continuous (a minute per turn)' }, { value: 'discrete', label: 'Discrete (2 AP per turn)' }] },
  ],
  // boxSelect: drag a box over your units to take them all; a click then moves the group
  // (keeping its shape) or fires every member that can at the enemy clicked.
  // Fire is aimed on the map (targetAim): an enemy token fires at that unit, anywhere
  // else is area fire at that spot.
  ui: {
    boxSelect: true,
    aimedActionTypes: ['fire'],
    targetAim: { fire: { button: 'Fire…', hint: 'Click an enemy to fire at it, or the ground to area-fire there' } },
  },
  createInitialState,
  createSetupUnit(state, { id, ownerId, type, position }) {
    if (!UNIT_DEFS[type] || !position) return null;
    return { ...createUnit(id, type, ownerId, position), perTurn: freshPerTurn(spaceTimeOf(state), UNIT_DEFS[type]) };
  },
  // Units from other games (engine/foreignUnits.js). The conversion factor is the
  // rifle squad: 10 hp, 5 attack, range 5, 2 moves; armour is read one higher than
  // it is, so a squad's 0 is one point of defence and a Tiger's 7 is eight.
  foreignUnits: tableUnits({
    table: UNIT_DEFS,
    scale: { hp: 10, attack: 5, defense: 1, range: 5, move: 2 },
    read: (e) => ({ hp: e.hp, attack: e.attack, defense: (e.armor ?? 0) + 1, range: e.range, move: e.moveRange, domain: 'land' }),
    write: (e, s) => ({
      ...e, hp: whole(s.hp), attack: whole(s.attack), armor: whole(s.defense - 1, 0),
      range: whole(s.range), moveRange: whole(s.move),
    }),
    art: (type) => ({
      imagePath: UNIT_PORTRAITS.has(type) ? `/images/combatmission/units/${type}` : null,
      glyph: UNIT_DEFS[type]?.symbol, name: UNIT_DEFS[type]?.label ?? type,
    }),
  }),
  getLegalActions,
  isActionLegal,
  getSearchActions,
  applyActions,
  getResult,
  renderState,
  getVisibleState,
  getActionDuration,
  getProjectileSpeed,
  actionKey,
  // A move names only its destination; in a we-go round it glides from where the unit
  // stands (engine/KineticResolver.js).
  movesFromBody: true,
  // The board, stamped with the session's time axis (the UI's time scrub reads it).
  toGrid: (state) => ({ ...toGrid(state), spaceType: 'continuous', timeType: spaceTimeOf(state).time }),

  sampleWorlds(observation, playerId, n, rng = Math.random) {
    if (!observation.gameSpecific.fogOfWar) return [];
    const belief = getCombatMissionBelief(observation, playerId);
    belief.beginTurn(observation);
    return belief.sample(observation, n, rng,
      (id, ownerId, type, x, y) => createUnit(id, type, ownerId, { x, y }));
  },
};
