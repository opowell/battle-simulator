// ---------------------------------------------------------------------------
// CS-mini — a deliberately tiny Counter-Strike.
//
// Two teams (CT blue, T red), two units each, on one small map: an 8×6 grid
// with a 2×2 impassable block in the middle. The whole game is built from four
// numbers in the brief, treated as one shared "seconds" budget per unit turn:
//
//   • A turn is 5 "seconds"  → each unit gets a 5-second budget when its team
//                              activates. Every action spends 1 second (a move
//                              step, a shot, a reload, a turn-in-place), so a
//                              unit does up to 5 things per turn.
//   • Move range 3           → at most 3 of those seconds may be movement (a
//                              separate moveLeft budget), 1 square per step.
//   • Reload takes 1 second  → the gun holds a single round; after firing a unit
//                              must spend a second reloading before it can fire
//                              again. Loaded/unloaded persists between turns.
//   • Vision 1 square/second,→ a 5-second turn sees 5 squares out, in a 90° cone
//     90° in front             pointed where the unit faces. Fog hides enemies
//                              outside every one of your units' cones (and
//                              behind the wall). Facing follows movement and
//                              snaps onto whatever you shoot.
//
// Shooting is a straight ray from the shooter to a visible enemy; unlimited
// range, stops at the first thing it hits, 1 damage. Units have 5 HP. Wipe the
// other team to win.
//
// The turn model fits the engine's discrete one-action-per-step loop: a team
// stays active, spending its units' seconds one action at a time, until it runs
// out (or plays end-turn), then the other team activates. `evaluateState` gives
// the generic greedy agent (agents/GreedyAgent.js) enough to beat random — it
// shoots what it sees, reloads when empty, and pushes toward the enemy.
// ---------------------------------------------------------------------------

import { seesPoint, filterVisibleUnits, euclidean } from '../vision.js';

// ── Constants ───────────────────────────────────────────────────────────────
const WIDTH = 8, HEIGHT = 6;
const MAX_HP = 5;
const MOVE_RANGE = 3;      // squares of movement allowed per turn
const TIME_BUDGET = 5;     // "seconds" of action allowed per turn
const VISION_RANGE = 5;    // 1 square/second × 5-second turn
const FOV_DEGREES = 90;    // cone width, centred on facing
const SHOT_DAMAGE = 1;

// The central 2×2 impassable block (columns 3–4, rows 2–3 of the 8×6 grid).
const WALLS = [[3, 2], [4, 2], [3, 3], [4, 3]];
const WALL_SET = new Set(WALLS.map(([x, y]) => `${x},${y}`));

// Eight-connected steps, each mapped to a screen-space facing angle
// (atan2(dy, dx), +y pointing down — the convention games/vision.js expects).
const DIRS8 = [
  { dx: 1, dy: 0 }, { dx: 1, dy: 1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 1 },
  { dx: -1, dy: 0 }, { dx: -1, dy: -1 }, { dx: 0, dy: -1 }, { dx: 1, dy: -1 },
];
const facingOf = (dx, dy) => Math.atan2(dy, dx);
const EAST = facingOf(1, 0);
const WEST = facingOf(-1, 0);

const inBounds = (x, y) => x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT;
const isWall = (x, y) => WALL_SET.has(`${x},${y}`);
const isPassable = (x, y) => inBounds(x, y) && !isWall(x, y);

// ── Line of sight / ballistics ──────────────────────────────────────────────

// Bresenham cells from a→b inclusive (both endpoints).
function lineCells(ax, ay, bx, by) {
  const cells = [];
  const dx = Math.abs(bx - ax), dy = -Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1;
  let err = dx + dy, x = ax, y = ay;
  for (;;) {
    cells.push([x, y]);
    if (x === bx && y === by) return cells;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

// Sight is clear if no wall sits strictly between the two cells.
function losClear(ax, ay, bx, by) {
  const cells = lineCells(ax, ay, bx, by);
  for (let i = 1; i < cells.length - 1; i++) {
    if (isWall(cells[i][0], cells[i][1])) return false;
  }
  return true;
}

// Walk the ray from shooter→target; return the first live unit hit (or null if
// a wall or nothing intervenes first). This is the "stops at first contact" rule.
function firstUnitAlongRay(from, to, units) {
  const cells = lineCells(from.x, from.y, to.x, to.y);
  for (let i = 1; i < cells.length; i++) {
    const [cx, cy] = cells[i];
    if (isWall(cx, cy)) return null;
    const u = units.find(u => u.alive && u.position.x === cx && u.position.y === cy);
    if (u) return u;
  }
  return null;
}

// Shared field-of-vision config (games/vision.js): a 90° cone, 5 squares,
// Euclidean, blocked by the wall.
const VISION_CFG = {
  range: VISION_RANGE,
  fovDegrees: FOV_DEGREES,
  metric: euclidean,
  hasLOS: losClear,
};

const viewerOf = (u) => ({ x: u.position.x, y: u.position.y, facing: u.facing });
const numXY = (pos) => [pos.x, pos.y];

// Does `unit` see the point (tx,ty) — inside its cone, in range, LOS clear?
const unitSees = (unit, tx, ty) => seesPoint(viewerOf(unit), tx, ty, VISION_CFG);

// ── Setup ───────────────────────────────────────────────────────────────────

function makeUnit(id, ownerId, num, x, y, facing) {
  return {
    id, ownerId, num,
    position: { x, y },
    facing,
    hp: MAX_HP, maxHp: MAX_HP,
    alive: true,
    loaded: true,                                  // one round chambered
    perTurn: { time: TIME_BUDGET, moveLeft: MOVE_RANGE },
  };
}

export function createInitialState(players, config = {}) {
  const [ct, t] = players;
  // Slot 0 renders blue, slot 1 red in the design UI — so CT is player 0, T is 1.
  const units = [
    makeUnit('CT-1', ct.id, 1, 0, 1, EAST),
    makeUnit('CT-2', ct.id, 2, 0, 4, EAST),
    makeUnit('T-1', t.id, 1, 7, 1, WEST),
    makeUnit('T-2', t.id, 2, 7, 4, WEST),
  ];
  return {
    gameName: 'CS-mini',
    turnNumber: 1,
    activePlayers: [ct.id],
    currentPhase: 'ct-turn',
    players,
    board: { width: WIDTH, height: HEIGHT },
    units,
    lastAction: null,
    gameSpecific: {
      fogOfWar: config.fogOfWar ?? true,
      walls: WALLS,
      // Where each team pushes when it has no enemy in sight (the far spawn),
      // so fog-blind units still advance instead of milling around.
      enemyGoal: { [ct.id]: { x: 7, y: 2.5 }, [t.id]: { x: 0, y: 2.5 } },
      // Common-knowledge survivor counts. getResult reads THESE, not the units
      // array — because getVisibleState strips hidden enemies out of `units`, and
      // a naive count would then read a fogged-out enemy team as "eliminated" and
      // hand the game (and the greedy agent's terminal value) a phantom win.
      alive: { [ct.id]: 2, [t.id]: 2 },
    },
  };
}

// ── Legal actions ─────────────────────────────────────────────────────────────
// Actions belong to whichever team is active; each is tagged with its unitId.
// end-turn always exists, so the list is never empty while a team has a unit.

export function getLegalActions(state, playerId) {
  const actions = [];
  const myUnits = state.units.filter(u => u.alive && u.ownerId === playerId);
  const enemies = state.units.filter(u => u.alive && u.ownerId !== playerId);

  for (const unit of myUnits) {
    if (unit.perTurn.time <= 0) continue;
    const { x, y } = unit.position;

    // Move: one step into an open, unoccupied neighbour (costs a second and a
    // square of the move budget).
    if (unit.perTurn.moveLeft > 0) {
      for (const { dx, dy } of DIRS8) {
        const nx = x + dx, ny = y + dy;
        if (!isPassable(nx, ny)) continue;
        if (state.units.some(u => u.alive && u.position.x === nx && u.position.y === ny)) continue;
        actions.push({ type: 'move', unitId: unit.id, from: { x, y }, to: { x: nx, y: ny } });
      }
    }

    // Rotate in place: face any of the eight directions you don't already face.
    for (const { dx, dy } of DIRS8) {
      const facing = facingOf(dx, dy);
      if (Math.abs(facing - unit.facing) < 1e-9) continue;
      actions.push({ type: 'rotate', unitId: unit.id, facing });
    }

    // Reload (only worth it when the chamber is empty).
    if (!unit.loaded) actions.push({ type: 'reload', unitId: unit.id });

    // Shoot: a visible enemy with a clear ray (no unit blocking the shot).
    if (unit.loaded) {
      for (const e of enemies) {
        if (!unitSees(unit, e.position.x, e.position.y)) continue;
        if (firstUnitAlongRay(unit.position, e.position, state.units) !== e) continue;
        actions.push({ type: 'shoot', unitId: unit.id, targetId: e.id });
      }
    }
  }

  actions.push({ type: 'end-turn', unitId: '__team__' });
  return actions;
}

// ── Applying actions ──────────────────────────────────────────────────────────

export function applyActions(state, playerActions) {
  const { playerId, action } = playerActions[0];

  if (action.type === 'end-turn') {
    const idx = state.players.findIndex(p => p.id === playerId);
    const nextIdx = (idx + 1) % state.players.length;
    const nextId = state.players[nextIdx].id;
    // Refresh the team that's about to play (loaded/unloaded carries over).
    const units = state.units.map(u =>
      u.ownerId === nextId
        ? { ...u, perTurn: { time: TIME_BUDGET, moveLeft: MOVE_RANGE } }
        : u,
    );
    return {
      ...state,
      units,
      activePlayers: [nextId],
      currentPhase: nextIdx === 0 ? 'ct-turn' : 't-turn',
      turnNumber: nextIdx === 0 ? state.turnNumber + 1 : state.turnNumber,
      lastAction: { playerId, ...action },
    };
  }

  if (action.type === 'move') {
    const units = state.units.map(u => {
      if (u.id !== action.unitId) return u;
      const dx = action.to.x - u.position.x, dy = action.to.y - u.position.y;
      return {
        ...u,
        position: { x: action.to.x, y: action.to.y },
        facing: facingOf(dx, dy),
        perTurn: { time: u.perTurn.time - 1, moveLeft: u.perTurn.moveLeft - 1 },
      };
    });
    return { ...state, units, lastAction: { playerId, ...action } };
  }

  if (action.type === 'rotate') {
    const units = state.units.map(u =>
      u.id === action.unitId
        ? { ...u, facing: action.facing, perTurn: { ...u.perTurn, time: u.perTurn.time - 1 } }
        : u,
    );
    return { ...state, units, lastAction: { playerId, ...action } };
  }

  if (action.type === 'reload') {
    const units = state.units.map(u =>
      u.id === action.unitId
        ? { ...u, loaded: true, perTurn: { ...u.perTurn, time: u.perTurn.time - 1 } }
        : u,
    );
    return { ...state, units, lastAction: { playerId, ...action } };
  }

  if (action.type === 'shoot') {
    const shooter = state.units.find(u => u.id === action.unitId);
    const target = state.units.find(u => u.id === action.targetId);
    const dx = target.position.x - shooter.position.x;
    const dy = target.position.y - shooter.position.y;
    let killed = false;
    const units = state.units.map(u => {
      if (u.id === action.unitId) {
        return { ...u, loaded: false, facing: facingOf(dx, dy), perTurn: { ...u.perTurn, time: u.perTurn.time - 1 } };
      }
      if (u.id === action.targetId) {
        const hp = Math.max(0, u.hp - SHOT_DAMAGE);
        killed = u.alive && hp <= 0;
        return { ...u, hp, alive: hp > 0 };
      }
      return u;
    });
    const gameSpecific = killed
      ? { ...state.gameSpecific, alive: { ...state.gameSpecific.alive, [target.ownerId]: state.gameSpecific.alive[target.ownerId] - 1 } }
      : state.gameSpecific;
    return { ...state, units, gameSpecific, lastAction: { playerId, ...action, damage: SHOT_DAMAGE, killed } };
  }

  return state;
}

// ── Result ────────────────────────────────────────────────────────────────────

export function getResult(state) {
  const [ct, t] = state.players;
  // Read the common-knowledge survivor counts (see gameSpecific.alive), never the
  // units array — under fog the latter has the enemy team stripped out.
  const alive = state.gameSpecific.alive;
  const ctAlive = alive[ct.id] > 0;
  const tAlive = alive[t.id] > 0;
  if (!ctAlive && !tAlive) return { outcome: 'draw', winnerId: null, reason: 'mutual-elimination' };
  if (!tAlive) return { outcome: 'win', winnerId: ct.id, reason: 't-eliminated' };
  if (!ctAlive) return { outcome: 'win', winnerId: t.id, reason: 'ct-eliminated' };
  return null;
}

// ── Heuristic evaluation (for the generic greedy agent) ─────────────────────────
// Value to the mover. Killing dominates (alive bonus ≫ hp), then keeping HP,
// then being loaded, then closing on the enemy — enough to beat random play.
// Under fog the passed state only holds enemies the mover can see; with none in
// sight units push toward the far spawn so a blind team still advances.

export function evaluateState(state, playerId) {
  const enemyId = state.players.find(p => p.id !== playerId)?.id;
  const goal = state.gameSpecific.enemyGoal?.[playerId];
  const mine = state.units.filter(u => u.alive && u.ownerId === playerId);
  const foes = state.units.filter(u => u.alive && u.ownerId === enemyId);

  let score = 0;
  for (const u of mine) score += 5 + 2 * u.hp + (u.loaded ? 1 : 0);
  for (const e of foes) score -= 5 + 2 * e.hp;

  for (const u of mine) {
    if (foes.length) {
      const d = Math.min(...foes.map(e => euclidean(u.position.x, u.position.y, e.position.x, e.position.y)));
      score -= 0.15 * d;
      if (foes.some(e => unitSees(u, e.position.x, e.position.y))) score += 0.5;
    } else if (goal) {
      score -= 0.1 * euclidean(u.position.x, u.position.y, goal.x, goal.y);
    }
  }
  return score;
}

// ── Fog of war ──────────────────────────────────────────────────────────────

export function getVisibleState(state, playerId) {
  return {
    ...state,
    units: filterVisibleUnits(state.units, playerId, VISION_CFG, numXY),
  };
}

// ── Rendering ───────────────────────────────────────────────────────────────

const COMPASS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
const compassOf = (facing) => {
  let a = ((facing % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return COMPASS[Math.round(a / (Math.PI / 4)) % 8];
};

// ASCII board for the terminal demo. CT units show as "C1"/"C2", T as "T1"/"T2",
// walls as "##", floor as " ·".
export function renderState(state) {
  const [ct, t] = state.players;
  const at = {};
  for (const u of state.units) if (u.alive) at[`${u.position.x},${u.position.y}`] = u;

  const rows = [];
  for (let y = 0; y < HEIGHT; y++) {
    let row = '';
    for (let x = 0; x < WIDTH; x++) {
      const u = at[`${x},${y}`];
      if (u) row += (u.ownerId === ct.id ? 'C' : 'T') + u.num;
      else if (isWall(x, y)) row += '##';
      else row += ' ·';
    }
    rows.push(`${y} ${row}`);
  }
  const header = '  ' + Array.from({ length: WIDTH }, (_, x) => ` ${x}`).join('');

  const line = (u) => `${u.id} (${u.position.x},${u.position.y}) face ${compassOf(u.facing)} ` +
    `${u.hp}hp ${u.loaded ? 'loaded' : 'EMPTY'}` + (u.alive ? '' : ' DEAD');
  const team = (p, label) => `${label} [${p.name}]: ` +
    state.units.filter(u => u.ownerId === p.id).map(line).join('  |  ');

  const active = state.activePlayers[0] === ct.id ? 'CT' : 'T';
  let last = '';
  if (state.lastAction?.type === 'shoot') {
    last = `>> ${state.lastAction.unitId} shot ${state.lastAction.targetId} for ${state.lastAction.damage}`;
  }

  return [
    `Turn ${state.turnNumber} — ${active} to act`,
    header,
    ...rows,
    '',
    team(ct, 'CT'),
    team(t, 'T'),
    last,
  ].filter(Boolean).join('\n');
}

// ── toGrid (design web UI) ────────────────────────────────────────────────────
// Numbered, team-coloured circle markers with facing cones, plus the wall as a
// blocked-cell occluder and the vision range/cone for the fog veil.

const FLOOR_COLOR = '#c8c0a8';
const WALL_COLOR = '#4a4640';

function spriteLayers(u) {
  return [
    { shape: 'circle', dx: 0, dy: 0, rFrac: 0.95, fill: 'team', stroke: '#111', strokeWidth: 2 },
    { shape: 'text', dx: 0, dy: 0, rFrac: 1.1, text: String(u.num), fill: '#fff', stroke: '#000', strokeWidth: 0.6 },
  ];
}

export function toGrid(state) {
  const pidIdx = {};
  (state.players ?? []).forEach((p, i) => { pidIdx[p.id] = i + 1; });

  const cells = [];
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const wall = isWall(x, y);
      cells.push({
        x, y,
        color: wall ? WALL_COLOR : FLOOR_COLOR,
        terrain: wall
          ? { name: 'Wall', description: 'Impassable; blocks sight and bullets.' }
          : { name: 'Floor', description: 'Open ground.' },
      });
    }
  }

  const units = state.units.filter(u => u.alive).map(u => ({
    id: u.id,
    x: u.position.x, y: u.position.y,
    facing: u.facing,
    owner: pidIdx[u.ownerId] ?? 0,
    hp: u.hp, maxHp: u.maxHp,
    glyph: String(u.num),
    unitName: `${u.ownerId === state.players[0].id ? 'CT' : 'T'}-${u.num}`,
    type: 'player',
    moveRange: u.perTurn?.moveLeft ?? 0,
    spriteLayers: spriteLayers(u),
    statusEffects: u.loaded ? [] : ['reloading'],
  }));

  return {
    width: WIDTH, height: HEIGHT,
    locationType: 'continuous',
    cells,
    units,
    los: { blocked: WALLS.map(([x, y]) => `${x},${y}`) },
    ui: {
      visionRange: VISION_RANGE,
      fovDegrees: FOV_DEGREES,
      showFacing: true,
      aimedActionTypes: ['move', 'shoot', 'rotate'],
    },
  };
}

// Canonical order-matching key (used by the engine in simultaneous mode).
export function actionKey(a) {
  return JSON.stringify([a.type, a.unitId ?? null, a.to ?? null, a.targetId ?? null, a.facing ?? null]);
}

export function getActionDuration(state, action) {
  return action.type === 'end-turn' ? 0 : 1;
}

export const CsMiniGame = {
  name: 'CS-mini',
  evaluateState,
  gameOptions: [
    { id: 'fogOfWar', label: 'Fog of War', description: 'Each team sees only enemies inside a unit’s 90° vision cone', type: 'boolean', default: true },
  ],
  ui: { showFacing: true },
  createInitialState,
  getLegalActions,
  applyActions,
  getResult,
  getVisibleState,
  renderState,
  toGrid,
  actionKey,
  getActionDuration,
};
