// ---------------------------------------------------------------------------
// The generic AI's picture of a battle: any game's state, read as a set of
// units that are nothing but numbers — owner, a point on a plane, hit points,
// and attack / defense / range / speed / rate / vision.
//
// Where those numbers come from, most specific first:
//
//   1. game.unitAttributes(state, unit)   the generic unit contract
//                                         (games/types.js) — a game that
//                                         implements it says exactly what
//                                         each unit is.
//   2. unit.stats, unit.attrs, and the unit's own fields under the usual names
//      (attack/atk/damage, defense/armor, range/attackRange, speed/move/moves…)
//   3. the game's per-type table: game.unitStats() or the foreign-units
//      profiles every registered game declares (engine/foreignUnits.js) —
//      { hp, attack, defense, range, move } for each unit type.
//   4. neutral defaults (1s), so a game that says nothing still reads as a
//      battle of equal pieces.
//
// Positions: game.unitPoint(state, unit) if the game has it, else a numeric
// {x, y} (BigNumber-tolerant), {col, row}, or an algebraic square ("e4").
// A unit with no readable position still counts as material.
//
// Commitments: where time is continuous an order takes time to carry out, so
// the state right after an order still shows the unit where it was and the
// target unhurt. unitAttributes may say what a unit is in the middle of —
// `heading` (the point a move order is taking it to) and `striking` (the id of
// the unit a strike in progress will land on) — and the unit is then judged
// where it is going, with its strike as good as landed.
// ---------------------------------------------------------------------------

const tables = new WeakMap();

function typeTable(game) {
  if (!game || typeof game !== 'object') return {};
  if (tables.has(game)) return tables.get(game);
  let t = {};
  try { t = game.unitStats?.() ?? game.foreignUnits?.profiles?.() ?? {}; } catch { t = {}; }
  tables.set(game, t ?? {});
  return t ?? {};
}

const num = (v) => (v != null && typeof v === 'object' && typeof v.toNumber === 'function' ? v.toNumber() : Number(v));
const finite = (v) => v != null && v !== '' && typeof v !== 'boolean' && Number.isFinite(num(v));

/** The plane point a unit stands on, or null when it has none we can read. */
export function pointOf(game, state, u) {
  if (game?.unitPoint) return game.unitPoint(state, u);
  const p = u.position ?? u.pos ?? u.cell;
  if (p && typeof p === 'object') {
    const x = num(p.x ?? p.col), y = num(p.y ?? p.row);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  }
  if (typeof p === 'string') {
    const m = /^([a-z])(\d+)$/i.exec(p);
    if (m) return { x: m[1].toLowerCase().charCodeAt(0) - 97, y: Number(m[2]) - 1 };
  }
  return null;
}

const STAT_NAMES = {
  attack: ['attack', 'atk', 'damage', 'power', 'strength'],
  defense: ['defense', 'defence', 'def', 'armor', 'armour'],
  range: ['range', 'attackRange', 'reach'],
  speed: ['speed', 'move', 'moveRange', 'moves', 'movement'],
  rate: ['rate', 'attacksPerTurn'],
  vision: ['vision', 'visionRange', 'sight'],
};

/** One unit as the generic AI sees it. */
export function unitView(game, state, u) {
  const hook = game?.unitAttributes?.(state, u) ?? {};
  const own = { ...u, ...(u.attrs ?? {}), ...(u.stats ?? {}) };
  const table = typeTable(game)[u.type] ?? {};
  const read = (names) => {
    for (const src of [hook, own, table]) for (const k of names) if (finite(src[k])) return num(src[k]);
    return undefined;
  };
  const hpRaw = [hook.hp, u.hp, own.hp].find(finite);
  const maxRaw = [hook.maxHp, u.maxHp, own.maxHp, table.maxHp, table.hp, hpRaw].find(finite);
  const maxHp = maxRaw != null ? Math.max(num(maxRaw), 1e-9) : 1;
  const hp = hpRaw != null ? num(hpRaw) : maxHp;
  const range = read(STAT_NAMES.range) ?? 1;
  const speed = read(STAT_NAMES.speed) ?? 1;
  const at = pointOf(game, state, u);
  const heading = hook.heading && finite(hook.heading.x) && finite(hook.heading.y)
    ? { x: num(hook.heading.x), y: num(hook.heading.y) } : null;
  return {
    id: u.id,
    owner: u.ownerId ?? u.owner ?? u.playerId ?? null,
    type: u.type ?? null,
    alive: u.alive !== false && !(hpRaw != null && hp <= 0),
    point: heading ?? at,
    at,
    striking: hook.striking ?? null,
    hp, maxHp,
    attack: read(STAT_NAMES.attack) ?? 1,
    defense: read(STAT_NAMES.defense) ?? 1,
    range: Math.max(range, 0),
    speed: Math.max(speed, 0),
    rate: Math.max(read(STAT_NAMES.rate) ?? 1, 0),
    vision: read(STAT_NAMES.vision) ?? range + speed,
  };
}

/** Which quadrant + play mode a state is in, as far as it says. */
export function modeOf(game, state, override = {}) {
  const gs = state?.gameSpecific?.spacetime ?? state?.gameSpecific?.rt ?? {};
  const d = game?.spacetime ?? {};
  return {
    space: override.space ?? gs.space ?? d.space ?? 'discrete',
    time: override.time ?? gs.time ?? d.time ?? 'discrete',
    play: override.play ?? gs.play ?? d.play ?? 'sequential',
  };
}

/**
 * The battle: every unit in the state as a unitView, plus the reference scales
 * (mean stats over all units, dead ones included so the scale stays put as the
 * battle thins out) that make the evaluation independent of a game's numbers.
 */
export function readBattle(game, state, opts = {}) {
  const units = (state?.units ?? []).filter(u => u && typeof u === 'object').map(u => unitView(game, state, u));
  const mode = modeOf(game, state, opts.mode);
  const pts = units.map(u => u.point).filter(Boolean);
  const fractional = pts.some(p => !Number.isInteger(p.x) || !Number.isInteger(p.y));
  const metric = mode.space === 'continuous' || fractional ? 'euclid' : 'chebyshev';
  return { units, mode, metric, scale: scalesOf(units) };
}

function scalesOf(units) {
  const mean = (k, floor) => {
    const vs = units.map(u => u[k]).filter(v => Number.isFinite(v) && v > 0);
    return vs.length ? Math.max(vs.reduce((s, v) => s + v, 0) / vs.length, floor) : 1;
  };
  return { hp: mean('maxHp', 1e-9), attack: mean('attack', 1e-9), defense: mean('defense', 1e-9), range: mean('range', 1e-9), speed: mean('speed', 1e-9) };
}

export const distance = (metric, a, b) =>
  metric === 'euclid' ? Math.hypot(a.x - b.x, a.y - b.y) : Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
