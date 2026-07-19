import { TERRAIN } from './terrain.js';
import { UNITS, COMBAT_TYPES } from './units.js';
import { resolveEncounter } from './combat.js';
import {
  mulberry32, generateMap, renderMap, terrainAt, isPassablePoint, forageAt,
  marchAlong,
} from './map.js';
import {
  makeSquad, resetSquadIds, totalMen, combatMen, squadSpeed, squadStrength,
  dominantType, hasSpy, clamp, MAX_MEN,
} from './squad.js';
import { castleShapes, villageShapes, flagShapes } from './decor.js';
import { movePointLattice } from '../continuousMove.js';
import { posToWire } from '../coord.js';
import { MAP_ZOOM_OPTION } from '../renderOptions.js';

// ── Tunables ────────────────────────────────────────────────────────────────
const CONTACT = 0.9;   // squads this close trigger an encounter
const CAPTURE = 0.7;   // a squad this close to a feature captures/controls it
const SUPPLY_NEAR = 2.0; // range at which a controlled village/fort supplies a squad

// Starting armies: a handful of squads per side, each a mix of the four men types.
const START_SQUADS = [
  { men: { knight: 6, archer: 4 },              d: { x: 0,  y: 0 } },
  { men: { barbarian: 8, spy: 1 },              d: { x: 1,  y: -2 } },
  { men: { archer: 7, knight: 3 },              d: { x: 1,  y: 2 } },
  { men: { knight: 5, barbarian: 5, spy: 1 },   d: { x: 2,  y: 0 } },
];

function num(v) { return typeof v === 'string' ? Number(v) : v; }

// ── createInitialState ────────────────────────────────────────────────────────

function createInitialState(players, config = {}) {
  const width  = config.width  ?? 24;
  const height = config.height ?? 14;
  const seed   = config.seed   ?? 42;

  resetSquadIds();
  const cy     = Math.floor((height - 1) / 2);
  const home1  = { x: 3,         y: cy };
  const home2  = { x: width - 4, y: cy };

  const rng = mulberry32(seed);
  const { tiles, shapes, decor, features, homes } = generateMap(width, height, rng, [home1, home2], seed);
  const board = { width, height, tiles, shapes, decor, features };

  const [p1, p2] = players;

  function deploy(home, ownerId, xSign) {
    return START_SQUADS.map(({ men, d }) => {
      let x = home.x + d.x * xSign;
      let y = home.y + d.y;
      // Nudge onto a passable tile near the intended slot.
      if (!isPassablePoint(board, x, y)) { x = home.x; y = home.y; }
      return makeSquad(ownerId, men, x + 0.5, y + 0.5);
    });
  }

  const squads = [...deploy(homes.p1, p1.id, +1), ...deploy(homes.p2, p2.id, -1)];

  return {
    gameName: 'AncientArtOfWar',
    turnNumber: 1,
    activePlayers: [p1.id],
    currentPhase: 'action',
    players,
    board,
    squads,
    lastActions: null,
    gameSpecific: {
      fogOfWar: config.fogOfWar ?? false,
      log: [],
      startRoster: squads.map(s => ({ id: s.id, ownerId: s.ownerId, men: { ...s.men }, position: { ...s.position } })),
    },
  };
}

// ── Legal actions ─────────────────────────────────────────────────────────────

function actableSquads(state, playerId) {
  return state.squads.filter(s => s.alive && s.ownerId === playerId && !s.acted);
}

function getLegalActions(state, playerId) {
  const actions = [];
  for (const sq of actableSquads(state, playerId)) {
    const range = squadSpeed(sq);
    const pts = movePointLattice(
      sq.position.x, sq.position.y, range,
      (x, y) => isPassablePoint(state.board, x, y), 2, 8,
    );
    for (const to of pts) actions.push({ type: 'move', unitId: sq.id, to });
    actions.push({ type: 'skip-unit', unitId: sq.id });
  }
  actions.push({ type: 'end-turn', unitId: '__player__' });
  return actions;
}

// Continuous move validation: any passable point within a generous reach of the squad
// (the actual march is clamped to the squad's speed by marchAlong, so a far click just
// advances partway). See engine/ActionValidator.js.
function isActionLegal(state, playerId, action) {
  if (action.type !== 'move') return false;
  const sq = state.squads.find(s => s.id === action.unitId);
  if (!sq || !sq.alive || sq.ownerId !== playerId || sq.acted) return false;
  const to = { x: num(action.to.x), y: num(action.to.y) };
  if (!isPassablePoint(state.board, to.x, to.y)) return false;
  return true;
}

// ── Apply actions ─────────────────────────────────────────────────────────────

// Which side, if any, controls a feature — a squad within CAPTURE of it owns it; ties/none
// leave it as-is. Used for supply (villages/forts) and win checks (flags).
function featureControllerAt(squads, fx, fy) {
  let best = null, bestD = CAPTURE;
  for (const s of squads) {
    if (!s.alive) continue;
    const d = Math.hypot(s.position.x - fx, s.position.y - fy);
    if (d <= bestD) { best = s.ownerId; bestD = d; }
  }
  return best;
}

function log(gs, msg) {
  return { ...gs, log: [...(gs.log ?? []).slice(-20), msg] };
}

function applyActions(state, playerActions, rng = Math.random) {
  const { playerId, action } = playerActions[0];
  const playerIds  = state.players.map(p => p.id);
  const currentIdx = playerIds.indexOf(playerId);
  let squads = state.squads.map(s => ({ ...s, men: { ...s.men }, position: { ...s.position } }));
  let board  = { ...state.board, features: state.board.features.map(f => ({ ...f })) };
  let gs     = state.gameSpecific;

  // ── end-turn: upkeep for the acting side, then hand over ────────────────────
  if (action.type === 'end-turn') {
    ({ squads, board, gs } = runUpkeep(squads, board, gs, playerId, state.players));
    const nextIdx      = (currentIdx + 1) % playerIds.length;
    const nextPlayerId = playerIds[nextIdx];
    const newTurn      = nextIdx === 0 ? state.turnNumber + 1 : state.turnNumber;
    squads = squads.map(s => s.ownerId === nextPlayerId ? { ...s, acted: false } : s);
    return { ...state, squads, board, gameSpecific: gs, activePlayers: [nextPlayerId], turnNumber: newTurn, lastActions: playerActions };
  }

  const sq = squads.find(s => s.id === action.unitId);

  // ── skip-unit ───────────────────────────────────────────────────────────────
  if (action.type === 'skip-unit') {
    if (sq) sq.acted = true;
    return { ...state, squads, board, gameSpecific: gs, lastActions: playerActions };
  }

  // ── move (continuous march, possibly into an encounter) ─────────────────────
  if (action.type === 'move' && sq) {
    const to = { x: num(action.to.x), y: num(action.to.y) };
    const budget = squadSpeed(sq);
    const end = marchAlong(board, sq.position.x, sq.position.y, to.x, to.y, budget);
    sq.position = end;
    sq.acted = true;
    // Marching tires men — a little supply/morale spent on the road.
    sq.supply = clamp(sq.supply - 1);

    // Encounter: nearest enemy squad within contact of the new position.
    const enemy = nearestEnemy(squads, sq);
    if (enemy && Math.hypot(enemy.position.x - sq.position.x, enemy.position.y - sq.position.y) <= CONTACT) {
      gs = resolveContact(squads, board, gs, sq, enemy, rng, state.players);
      squads = squads.filter(s => s.alive);
    }

    // Feature capture at the resting place.
    captureFeatures(board, sq);

    return { ...state, squads, board, gameSpecific: gs, lastActions: playerActions };
  }

  return { ...state, squads, board, gameSpecific: gs, lastActions: playerActions };
}

function nearestEnemy(squads, sq) {
  let best = null, bestD = Infinity;
  for (const e of squads) {
    if (!e.alive || e.ownerId === sq.ownerId) continue;
    const d = Math.hypot(e.position.x - sq.position.x, e.position.y - sq.position.y);
    if (d < bestD) { best = e; bestD = d; }
  }
  return best;
}

// Resolve a fight between mover `a` and defender `b`, mutating them in `squads`.
function resolveContact(squads, board, gs, a, b, rng, players) {
  const r = resolveEncounter(a, b, board, rng);
  a.men = r.aMen; b.men = r.bMen;
  a.alive = combatMen(a) > 0; b.alive = combatMen(b) > 0;

  const name = pid => (players.find(p => p.id === pid)?.name) ?? pid;
  if (r.winner === 'a') {
    a.morale = clamp(a.morale + 12);
    if (r.bWiped) { b.alive = false; gs = log(gs, `${name(a.ownerId)} captured a ${name(b.ownerId)} squad`); }
    else { b.morale = clamp(b.morale - 30); retreat(b, a, board); gs = log(gs, `${name(b.ownerId)} squad routed`); }
  } else if (r.winner === 'b') {
    b.morale = clamp(b.morale + 12);
    if (r.aWiped) { a.alive = false; gs = log(gs, `${name(b.ownerId)} captured a ${name(a.ownerId)} squad`); }
    else { a.morale = clamp(a.morale - 30); retreat(a, b, board); gs = log(gs, `${name(a.ownerId)} squad routed`); }
  } else {
    a.morale = clamp(a.morale - 10); b.morale = clamp(b.morale - 10);
    gs = log(gs, `bloody stalemate between ${name(a.ownerId)} and ${name(b.ownerId)}`);
  }
  return gs;
}

// A routed squad flees away from its foe onto passable ground.
function retreat(loser, winner, board) {
  const dx = loser.position.x - winner.position.x;
  const dy = loser.position.y - winner.position.y;
  const d = Math.hypot(dx, dy) || 1;
  for (const dist of [2, 1.5, 1, 0.5]) {
    const nx = loser.position.x + (dx / d) * dist;
    const ny = loser.position.y + (dy / d) * dist;
    if (isPassablePoint(board, nx, ny)) { loser.position = { x: nx, y: ny }; return; }
  }
}

// Capture forts/villages/flags the squad now sits on.
function captureFeatures(board, sq) {
  for (const f of board.features) {
    if (Math.hypot(f.x - sq.position.x, f.y - sq.position.y) <= CAPTURE) {
      f.owner = sq.ownerId;
    }
  }
}

// ── Upkeep: supply (forage + villages/forts), reinforcements, morale ────────────

function runUpkeep(squads, board, gs, playerId, players) {
  // Recompute feature control from current positions.
  for (const f of board.features) {
    const ctrl = featureControllerAt(squads, f.x, f.y);
    if (ctrl) f.owner = ctrl;
  }

  for (const s of squads) {
    if (!s.alive || s.ownerId !== playerId) continue;

    // Forage from the land the squad stands on.
    let dSupply = forageAt(board, s.position.x, s.position.y);
    // A controlled village or fort within range resupplies generously.
    let supplied = false;
    for (const f of board.features) {
      if (f.type !== 'village' && f.type !== 'fort') continue;
      if (f.owner !== s.ownerId) continue;
      if (Math.hypot(f.x - s.position.x, f.y - s.position.y) <= SUPPLY_NEAR) { supplied = true; break; }
    }
    if (supplied) dSupply += 25;
    s.supply = clamp(s.supply + dSupply);

    // Reinforcements: a squad garrisoning a fort it controls trains a new man (up to 14).
    const onFort = board.features.find(
      f => f.type === 'fort' && f.owner === s.ownerId &&
           Math.hypot(f.x - s.position.x, f.y - s.position.y) <= CAPTURE,
    );
    if (onFort && totalMen(s) < MAX_MEN) {
      const t = dominantType(s) ?? 'knight';
      s.men = { ...s.men, [t]: (s.men[t] ?? 0) + 1 };
    }

    // Morale drifts toward a baseline set by supply — well-fed men steady, starving men break.
    const target = s.supply > 20 ? 60 : 15;
    s.morale = clamp(s.morale + Math.sign(target - s.morale) * 4);

    // Starvation: no food and no heart — the squad disbands.
    if (s.supply <= 0 && s.morale <= 5) {
      s.alive = false;
      gs = log(gs, `a ${players.find(p => p.id === s.ownerId)?.name ?? s.ownerId} squad starved and disbanded`);
    }
  }
  return { squads: squads.filter(s => s.alive), board, gs };
}

// ── Win condition ─────────────────────────────────────────────────────────────

function getResult(state) {
  const [p1, p2] = state.players;
  const flags = state.board.features.filter(f => f.type === 'flag');

  const enemyFlagsTaken = pid =>
    flags.filter(f => f.origOwner && f.origOwner !== pid).every(f => f.owner === pid);
  const hasEnemyFlags = pid => flags.some(f => f.origOwner && f.origOwner !== pid);

  if (hasEnemyFlags(p1.id) && enemyFlagsTaken(p1.id))
    return { outcome: 'win', winnerId: p1.id, reason: 'flags-captured' };
  if (hasEnemyFlags(p2.id) && enemyFlagsTaken(p2.id))
    return { outcome: 'win', winnerId: p2.id, reason: 'flags-captured' };

  for (const [p, opp] of [[p1, p2], [p2, p1]]) {
    if (!state.squads.some(s => s.alive && s.ownerId === p.id))
      return { outcome: 'win', winnerId: opp.id, reason: 'army-destroyed' };
  }
  return null;
}

// ── Fog of war ──────────────────────────────────────────────────────────────
// A squad sights the enemy within its vision; a spy in the squad doubles that range.
function getVisibleState(state, playerId) {
  if (!state.gameSpecific.fogOfWar) return state;
  const mine = state.squads.filter(s => s.alive && s.ownerId === playerId);
  const sees = e => mine.some(m => {
    const range = (hasSpy(m) ? 6 : 3);
    return Math.hypot(m.position.x - e.position.x, m.position.y - e.position.y) <= range;
  });
  return { ...state, squads: state.squads.filter(s => s.ownerId === playerId || sees(s)) };
}

// Fog belief is not modelled for AoW's squad layer; the ObscuroAgent falls back to the
// observation as its single world (see agents/obscuro). Kept for interface parity.
function sampleWorlds() { return []; }

// ── Render (terminal) ──────────────────────────────────────────────────────────

function renderState(state) {
  const { turnNumber, activePlayers, squads, players } = state;
  const [p1, p2] = players;
  const flags = state.board.features.filter(f => f.type === 'flag');

  const summarize = pid => {
    const mine = squads.filter(s => s.alive && s.ownerId === pid);
    if (!mine.length) return `${pid}: — defeated —`;
    const parts = mine.map(s => {
      const comp = COMBAT_TYPES.concat('spy').filter(t => s.men[t]).map(t => `${s.men[t]}${UNITS[t].symbol}`).join('');
      return `[${comp} sup${Math.round(s.supply)} mor${Math.round(s.morale)}]`;
    });
    return `${pid}: ${parts.join(' ')}`;
  };
  const flagLine = flags.map(f => `${f.id}:${f.owner ?? '—'}`).join('  ');

  return [
    `═══ Turn ${turnNumber} — ${activePlayers[0]} to move ═══`,
    renderMap(state),
    `Legend: U=your squad e=enemy squad  = your fort  # enemy fort  o neutral fort  v village`,
    `        .plains f forest n hills ~water ^mountains`,
    `Flags: ${flagLine}`,
    summarize(p1.id),
    summarize(p2.id),
    ...(state.gameSpecific.log?.length ? ['', ...state.gameSpecific.log.slice(-4)] : []),
  ].join('\n');
}

// ── Duration / eval ────────────────────────────────────────────────────────────

function getActionDuration(state, action) {
  if (action.type === 'move') return 1;
  return 0.2;
}

// Leaf value: own effective strength − enemy's, plus a big bonus for holding enemy flags.
function evaluateState(state, playerId) {
  let score = 0;
  for (const s of state.squads) {
    if (!s.alive) continue;
    score += (s.ownerId === playerId ? 1 : -1) * squadStrength(s);
  }
  for (const f of state.board.features) {
    if (f.type === 'flag' && f.origOwner && f.origOwner !== playerId && f.owner === playerId) score += 200;
    if (f.type === 'fort'  && f.owner === playerId) score += 8;
    if (f.type === 'village' && f.owner === playerId) score += 4;
  }
  return score;
}

// ── toGrid (continuous rendering) ──────────────────────────────────────────────

function ownerColor(state, ownerId) {
  const idx = state.players.findIndex(p => p.id === ownerId);
  if (idx === 0) return '#3f74c7';
  if (idx === 1) return '#c74848';
  return '#8a8a8a';
}

// Feature icons built from primitive shapes (see decor.js), owner-tinted. A subtle control
// halo under each keeps who-holds-what legible even from the map-wide view.
function featureShapes(state) {
  const out = [];
  // Draw forts/villages first, then flags on top (flags mark the win objective).
  const order = { fort: 0, village: 1, flag: 2 };
  for (const f of [...state.board.features].sort((a, b) => order[a.type] - order[b.type])) {
    const tint = ownerColor(state, f.owner);
    if (f.owner) out.push({ shape: 'oval', x: f.x - 0.6, y: f.y - 0.6, w: 1.2, h: 1.2, fill: tint, opacity: 0.16 });
    if (f.type === 'fort')    out.push(...castleShapes(f.x, f.y, tint));
    else if (f.type === 'village') out.push(...villageShapes(f.x, f.y));
    else if (f.type === 'flag')    out.push(...flagShapes(f.x, f.y, tint));
  }
  return out;
}

function toGrid(state) {
  const { board } = state;
  const { width, height, tiles, shapes, decor } = board;
  const pidIdx = {};
  (state.players ?? []).forEach((p, i) => { pidIdx[p.id] = i + 1; });

  const cells = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile = tiles[`${x},${y}`] ?? {};
      cells.push({ x, y, color: TERRAIN.plains.color, terrain: terrainInfo(tile.terrain) });
    }
  }

  const unitList = state.squads.filter(s => s.alive).map(s => {
    const p = posToWire(s.position);
    const dom = dominantType(s) ?? (s.men.spy ? 'spy' : 'knight');
    const comp = COMBAT_TYPES.concat('spy').filter(t => s.men[t]).map(t => `${s.men[t]}${UNITS[t].symbol}`).join(' ');
    return {
      id: s.id, x: p.x, y: p.y,
      glyph: String(totalMen(s)),
      type: dom,
      unitName: `${comp || 'empty'}`,
      owner: pidIdx[s.ownerId] ?? 0,
      hp: totalMen(s), maxHp: MAX_MEN,
      moveRange: squadSpeed(s),
      statusEffects: [
        ...(s.supply < 20 ? ['starving'] : []),
        ...(s.morale < 25 ? ['shaken'] : []),
        ...(hasSpy(s) ? ['scout'] : []),
      ],
      // Surfaced in the side panel via the generic detail view.
      supply: Math.round(s.supply), morale: Math.round(s.morale),
    };
  });

  return {
    width, height, locationType: 'continuous',
    cells,
    units: unitList,
    shapes: [...(shapes ?? []), ...(decor ?? []), ...featureShapes(state)],
    // Squads are directionless circles — no facing arrow (see SchematicLayer facingActive).
    ui: { hideGridLines: true, aimedActionTypes: ['move'], showFacing: false },
  };
}

function terrainInfo(key) {
  const t = TERRAIN[key] ?? TERRAIN.plains;
  return { name: t.name, description: t.description };
}

// ── Export ──────────────────────────────────────────────────────────────────

export const AowGame = {
  name: 'AncientArtOfWar',
  evaluateState,
  scenarios: [
    { id: 'race',  name: 'Race for the Flags', description: 'Standard 24×14 campaign — take the enemy fort & flag', config: {} },
    { id: 'epic',  name: 'War in the Mountains', description: '34×20 expanded front with more forts and villages', config: { width: 34, height: 20 } },
  ],
  gameOptions: [
    MAP_ZOOM_OPTION,
    { id: 'fogOfWar', label: 'Fog of War', description: 'Each side sees only enemy squads near its own (spies see farther)', type: 'boolean', default: false },
  ],
  createInitialState,
  getLegalActions,
  isActionLegal,
  applyActions,
  getResult,
  renderState,
  getVisibleState,
  sampleWorlds,
  getActionDuration,
  toGrid,
};
