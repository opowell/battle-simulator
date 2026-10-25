// ---------------------------------------------------------------------------
// victory.js — how a battle is won, beyond wiping the other side out.
//
// `spec.victory` lists objectives; the first to be met decides the battle:
//
//   { type: 'eliminate' }                         the last side standing wins (always
//                                                 true in the end: a side with nothing
//                                                 left is out, whatever else is listed)
//   { type: 'royal', tag: 'royal' }               a side whose royal units are all
//                                                 dead is out (chess's king, a VIP);
//                                                 `check: true` adds the check rule
//                                                 (patterns.js: mate and stalemate)
//   { type: 'hold', cells: [[x, y]…] | regions: [id…], windows: 3, side }
//                                                 a side (or only `side`, a seat
//                                                 number) that alone stands on every
//                                                 one of them at the end of `windows`
//                                                 windows in a row wins
//   { type: 'reach', cells | regions, side, tag } a unit of `side` (with `tag`)
//                                                 standing on one of them wins
//   { type: 'survive', side, windows }            `side` still standing after
//                                                 `windows` windows wins
//   { type: 'points', windows, hold: { cells, per } }
//                                                 after `windows` windows the side
//                                                 with the most points wins: each
//                                                 surviving unit's type's `points`
//                                                 (default 1), plus `per` for each
//                                                 held cell at the end of each window
//   { fn: 'name' }                                hooks.name(state) → a result or null
//
// A window is a turn in discrete time and one unit of the clock in continuous
// time. The verdict is worked out on the full state as actions are applied and
// kept in gameSpecific (`out`, `holds`, `points`, `verdict`), all common
// knowledge — so getResult never reads `units`, which fog strips.
// ---------------------------------------------------------------------------

import { rulesOf, seatIds, boardIn, hasTag, callHook } from './world.js';

const cellsOf = (state, v) => {
  if (v.regions) { const B = boardIn(state); return v.regions.map(id => B.anchorOf?.(id)).filter(Boolean); }
  return (v.cells ?? []).map(([x, y]) => ({ x, y }));
};

// Who stands on cell c: the set of owners of live units whose (discrete) spot is c.
function ownersAt(state, c) {
  const out = new Set();
  for (const u of state.units) if (u.alive && Math.floor(u.position.x) === c.x && Math.floor(u.position.y) === c.y) out.add(u.ownerId);
  return out;
}

/** The one seat alone on every cell of `cells`, or null. */
function holder(state, cells) {
  let who = null;
  for (const c of cells) {
    const o = ownersAt(state, c);
    if (o.size !== 1) return null;
    const [p] = o;
    if (who && who !== p) return null;
    who = p;
  }
  return who;
}

const seatAt = (state, i) => (i == null ? null : seatIds(state)[i] ?? null);
const win = (winnerId, reason) => ({ outcome: 'win', winnerId, reason });

/** Does this ruleset keep a verdict of its own (more than elimination)? */
export const keepsVerdict = (state) => rulesOf(state).victory.some(v => v.fn != null || v.type !== 'eliminate');

/**
 * The state with its verdict brought up to date after actions were applied:
 * sides that lost their royals are out, and a reach (or a hook) may decide it.
 */
export function judgeNow(state) {
  if (!keepsVerdict(state)) return state;
  let gs = state.gameSpecific;
  if (gs.verdict) return state;
  const r = rulesOf(state);
  let out = gs.out ?? [];
  let verdict = null;
  for (const v of r.victory) {
    if (v.fn != null) { verdict = verdict ?? callHook(r.hooks, v, state) ?? null; continue; }
    if (v.type === 'royal') {
      const tag = v.tag ?? 'royal';
      for (const pid of seatIds(state)) {
        if (out.includes(pid)) continue;
        const royals = state.units.filter(u => u.ownerId === pid && hasTag(state, u, tag));
        if (royals.length && royals.every(u => !u.alive)) out = [...out, pid];
      }
    } else if (v.type === 'reach' && !verdict) {
      const cells = cellsOf(state, v);
      const side = seatAt(state, v.side);
      for (const u of state.units) {
        if (!u.alive || (side && u.ownerId !== side) || (v.tag && !hasTag(state, u, v.tag))) continue;
        if (cells.some(c => Math.floor(u.position.x) === c.x && Math.floor(u.position.y) === c.y)) { verdict = win(u.ownerId, 'reached'); break; }
      }
    }
  }
  if (out !== (gs.out ?? []) || verdict) {
    // A side that is out leaves the field.
    const units = out.length ? state.units.map(u => (u.alive && out.includes(u.ownerId) ? { ...u, hp: 0, alive: false, task: null } : u)) : state.units;
    const alive = Object.fromEntries(seatIds(state).map(id => [id, units.filter(u => u.alive && u.ownerId === id).length]));
    gs = { ...gs, alive, ...(out.length ? { out } : {}), ...(verdict ? { verdict } : {}) };
    state = { ...state, units, gameSpecific: gs };
  }
  return state;
}

/** The objectives counted in windows, at the end of window `n` (1, 2, …). */
export function judgeWindow(state, n) {
  if (!keepsVerdict(state)) return state;
  let gs = state.gameSpecific;
  if (gs.verdict) return state;
  const r = rulesOf(state);
  let verdict = null;
  const holds = { ...(gs.holds ?? {}) };
  let points = gs.points ? { ...gs.points } : null;
  r.victory.forEach((v, i) => {
    if (verdict) return;
    if (v.type === 'hold') {
      const who = holder(state, cellsOf(state, v));
      const side = seatAt(state, v.side);
      const prev = holds[i];
      holds[i] = who && (!side || who === side) ? { seat: who, windows: prev?.seat === who ? prev.windows + 1 : 1 } : null;
      if (holds[i] && holds[i].windows >= (v.windows ?? 1)) verdict = win(who, 'held');
    } else if (v.type === 'survive') {
      const side = seatAt(state, v.side);
      if (n >= (v.windows ?? 1) && side && (gs.alive?.[side] ?? 0) > 0 && !(gs.out ?? []).includes(side)) verdict = win(side, 'survived');
    } else if (v.type === 'points') {
      points = points ?? Object.fromEntries(seatIds(state).map(id => [id, 0]));
      if (v.hold) {
        for (const c of cellsOf(state, v.hold)) {
          const o = ownersAt(state, c);
          if (o.size === 1) { const [p] = o; points[p] = (points[p] ?? 0) + (v.hold.per ?? 1); }
        }
      }
      if (n >= (v.windows ?? 1)) {
        const score = { ...points };
        for (const u of state.units) if (u.alive) score[u.ownerId] = (score[u.ownerId] ?? 0) + (rulesOf(state).types[u.type]?.points ?? 1);
        const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
        verdict = ranked.length > 1 && ranked[0][1] === ranked[1][1]
          ? { outcome: 'draw', winnerId: null, reason: 'points', score }
          : { ...win(ranked[0][0], 'points'), score };
      }
    }
  });
  gs = { ...gs, holds, ...(points ? { points } : {}), ...(verdict ? { verdict } : {}) };
  return { ...state, gameSpecific: gs };
}

/** The result, from common knowledge only. */
export function resultOf(state) {
  const gs = state.gameSpecific;
  if (gs.verdict) return gs.verdict;
  const alive = gs.alive;
  const out = gs.out ?? [];
  const standing = seatIds(state).filter(id => (alive[id] ?? 0) > 0 && !out.includes(id));
  if (standing.length === 1) return { outcome: 'win', winnerId: standing[0], reason: out.length ? 'royal-lost' : 'elimination' };
  if (standing.length === 0) return { outcome: 'draw', winnerId: null, reason: 'mutual-destruction' };
  if (gs.rt?.standoff) return { outcome: 'draw', winnerId: null, reason: 'standoff' };
  return null;
}
