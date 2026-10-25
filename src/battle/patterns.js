// ---------------------------------------------------------------------------
// patterns.js — units that move as a board game's pieces do: by patterns of
// steps rather than a budget of movement points, taking an enemy by moving onto
// it rather than striking it from where they stand.
//
// A unit type with `moves` is such a piece:
//
//   moves: [{ steps: [[across, ahead], …],   // one step of the pattern, in the
//                                           // piece's own frame (ahead = its
//                                           // side's forward, `spec.forward`)
//             symmetric: true | 'mirror' | false,  // every rotation and
//                                           // reflection (default), only left
//                                           // and right, or exactly as written
//             slides: false,                // repeat the step until something
//                                           // is in the way (a rider), else jump
//                                           // straight to it (a leaper)
//             range,                        // most repeats of a slide (default:
//                                           // the board)
//             capture: true | false | 'only',  // may end on an enemy (taking it),
//                                           // never, or only there
//             unmoved: false,               // only while the piece has not moved
//             enPassant: false }]           // may also take an enemy that just
//                                           // slid over the square it moves to
//   promote: { to: [types] }                // becomes one of these on reaching
//                                           // the far edge
//   castle:  { with: type, steps: 2 }       // while neither has moved: moves
//                                           // `steps` along its edge toward an
//                                           // own `with` piece, which lands on
//                                           // the square it crossed
//
// Patterns are how such a piece plays in discrete space and discrete time on a
// board of cells. Anywhere else (on a clock, or on a plane) it moves by its
// speed and strikes by its stats like any unit.
//
// The check rule (victory `{ type: 'royal', check: true }`) is here too: a side
// may not leave one of its royal units where an enemy piece could take it, and a
// side left with no move at all has lost if one is, and has drawn if not. Only
// pieces that take by moving threaten: a unit that strikes from where it stands
// is not part of check.
// ---------------------------------------------------------------------------

import { rulesOf, boardIn, typeOf, domainOf, seatIds, hasTag, passableFor, st } from './world.js';

/** A side's forward, by name: the way its pieces advance, in board cells. */
export const FORWARD = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
// Arena's seats deploy along the left, right, top and bottom edges and face in.
const SEAT_FORWARD = ['right', 'left', 'down', 'up'];

/** Do pieces play by their patterns in this state's (space × time) and board? */
export function patternsActive(state) {
  const s = st(state);
  return s.space === 'discrete' && s.time === 'discrete' && ['square', 'shapes'].includes(boardIn(state).topology ?? 'square');
}

/** The unit's move patterns, when it is a piece that plays by them here. */
export function patternsOf(state, u) {
  const m = typeOf(state, u).moves;
  return m?.length && patternsActive(state) ? m : null;
}

/** Does this ruleset have any pieces at all? */
export const hasPieces = (state) => Object.values(rulesOf(state).types).some(t => t.moves?.length);

/** The check rule's royal tag, or null when the ruleset has no check rule. */
export function checkTag(state) {
  const v = rulesOf(state).victory.find(x => x.type === 'royal' && x.check);
  return v ? v.tag ?? 'royal' : null;
}

/** `pid`'s forward, as a board vector. */
export function forwardOf(state, pid) {
  const seat = Math.max(0, seatIds(state).indexOf(pid));
  const name = rulesOf(state).spec.forward?.[seat] ?? SEAT_FORWARD[seat % 4];
  return FORWARD[name] ?? FORWARD.up;
}

// A pattern's steps as board vectors for a side facing `f`: ahead along f, across
// along its right hand.
const expanded = new WeakMap();
function vectorsOf(pattern, f) {
  let byF = expanded.get(pattern);
  if (!byF) { byF = new Map(); expanded.set(pattern, byF); }
  const key = f.join(',');
  if (byF.has(key)) return byF.get(key);
  const sym = pattern.symmetric ?? true;
  const own = new Set();
  for (const [a, b] of pattern.steps ?? []) {
    const variants = sym === true ? [[a, b], [-a, b], [a, -b], [-a, -b], [b, a], [-b, a], [b, -a], [-b, -a]]
      : sym === 'mirror' ? [[a, b], [-a, b]] : [[a, b]];
    for (const v of variants) own.add(v.join(','));
  }
  const r = [-f[1], f[0]];
  const out = [...own].map(s => s.split(',').map(Number)).map(([a, b]) => [a * r[0] + b * f[0], a * r[1] + b * f[1]]);
  byF.set(key, out);
  return out;
}

/** Where every live unit stands: 'x,y' → unit. */
export function occupancy(state) {
  const occ = new Map();
  for (const u of state.units) if (u.alive) occ.set(`${u.position.x},${u.position.y}`, u);
  return occ;
}

const keyOf = (c) => `${c.x},${c.y}`;

/**
 * Every square `u` could move to by its patterns, on board `occ` (default: as the
 * units stand): [{ to, path, captured (unit or null), pattern, promote?, castle? }].
 * Check is not looked at here; see legalPieceMoves.
 */
export function pieceTargets(state, u, occ = occupancy(state)) {
  const pats = patternsOf(state, u);
  if (!pats) return [];
  const B = boardIn(state);
  const f = forwardOf(state, u.ownerId);
  const domain = domainOf(state, u);
  const passing = state.gameSpecific.passing;
  const out = [];
  for (const p of pats) {
    if (p.unmoved && u.moved) continue;
    const limit = p.slides ? p.range ?? Infinity : 1;
    for (const [dx, dy] of vectorsOf(p, f)) {
      const path = [{ x: u.position.x, y: u.position.y }];
      for (let k = 1; k <= limit; k++) {
        const c = { x: u.position.x + dx * k, y: u.position.y + dy * k };
        if (!B.inBounds(c.x, c.y) || !passableFor(B.terrainAt(c.x, c.y), domain)) break;
        path.push(c);
        const o = occ.get(keyOf(c));
        if (o) {
          if (o.ownerId !== u.ownerId && p.capture !== false) out.push({ to: c, path: [...path], captured: o, pattern: p });
          break;
        }
        if (p.capture !== 'only') out.push({ to: c, path: [...path], captured: null, pattern: p });
        else if (p.enPassant && passing && passing.ownerId !== u.ownerId && passing.cells.some(([x, y]) => x === c.x && y === c.y)) {
          const victim = [...occ.values()].find(v => v.id === passing.unitId);
          if (victim) out.push({ to: c, path: [...path], captured: victim, pattern: p });
        }
      }
    }
  }
  // Two patterns reaching one square (a single step, and a first move's slide
  // that may stop after one) are one move: the first pattern's.
  const seen = new Set();
  const once = out.filter(t => { const k = `${t.to.x},${t.to.y}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return withPromotions(state, u, once);
}

// A move that reaches the far edge, by a piece that promotes there, is one move
// per piece it may become (the first listed first: a plain click takes that one).
function withPromotions(state, u, targets) {
  const to = typeOf(state, u).promote?.to;
  if (!to?.length) return targets;
  const f = forwardOf(state, u.ownerId);
  const B = boardIn(state);
  const far = (c) => (f[0] ? (f[0] > 0 ? c.x === B.width - 1 : c.x === 0) : (f[1] > 0 ? c.y === B.height - 1 : c.y === 0));
  return targets.flatMap(t => (far(t.to) ? to.map(type => ({ ...t, promote: type })) : [t]));
}

/**
 * The squares `u` threatens on board `occ`: every square it could take an enemy
 * on, whether or not one stands there (a pawn threatens its diagonals, never the
 * square ahead of it).
 */
function threatened(state, u, occ, f) {
  const B = boardIn(state);
  const domain = domainOf(state, u);
  const out = [];
  for (const p of typeOf(state, u).moves) {
    if (p.capture === false || (p.unmoved && u.moved)) continue;
    const limit = p.slides ? p.range ?? Infinity : 1;
    for (const [dx, dy] of vectorsOf(p, f)) {
      for (let k = 1; k <= limit; k++) {
        const c = { x: u.position.x + dx * k, y: u.position.y + dy * k };
        if (!B.inBounds(c.x, c.y) || !passableFor(B.terrainAt(c.x, c.y), domain)) break;
        out.push(keyOf(c));
        if (occ.has(keyOf(c))) break;
      }
    }
  }
  return out;
}

/** Is cell `c` threatened by a piece of any side but `pid`, on board `occ`? */
export function attackedBy(state, occ, c, pid) {
  if (!patternsActive(state)) return false;
  const key = keyOf(c);
  for (const o of occ.values()) {
    if (o.ownerId === pid || !typeOf(state, o).moves?.length) continue;
    if (threatened(state, o, occ, forwardOf(state, o.ownerId)).includes(key)) return true;
  }
  return false;
}

/** Is one of `pid`'s royal units threatened on board `occ`? */
export function inCheck(state, pid, occ = occupancy(state)) {
  const tag = checkTag(state);
  if (!tag) return false;
  for (const u of occ.values()) {
    if (u.ownerId === pid && hasTag(state, u, tag) && attackedBy(state, occ, u.position, pid)) return true;
  }
  return false;
}

/** Board `occ` after `u` moves to `to`, taking `captured` and, castling, moving `partner` too. */
export function occAfter(occ, u, to, captured = null, partner = null) {
  const next = new Map(occ);
  next.delete(keyOf(u.position));
  if (captured) next.delete(keyOf(captured.position));
  if (partner) {
    next.delete(keyOf(partner.unit.position));
    next.set(keyOf(partner.to), { ...partner.unit, position: partner.to });
  }
  next.set(keyOf(to), { ...u, position: to });
  return next;
}

// The castling moves of `u`: toward each own unmoved partner along its edge, over
// empty squares, and — under the check rule — never out of, through or into check.
function castles(state, u, occ) {
  const c = typeOf(state, u).castle;
  if (!c || u.moved) return [];
  const steps = c.steps ?? 2;
  const f = forwardOf(state, u.ownerId);
  const across = [-f[1], f[0]];
  const checked = !!checkTag(state);
  if (checked && inCheck(state, u.ownerId, occ)) return [];
  const out = [];
  for (const dir of [across, [-across[0], -across[1]]]) {
    let partner = null;
    const between = [];
    for (let k = 1; ; k++) {
      const p = { x: u.position.x + dir[0] * k, y: u.position.y + dir[1] * k };
      if (!boardIn(state).inBounds(p.x, p.y)) break;
      const o = occ.get(keyOf(p));
      if (o) { if (o.ownerId === u.ownerId && o.type === c.with && !o.moved) partner = o; break; }
      between.push(p);
    }
    if (!partner || between.length < steps) continue;
    const crossed = between.slice(0, steps);
    if (checked && crossed.some(p => attackedBy(state, occ, p, u.ownerId))) continue;
    const to = crossed[steps - 1];
    out.push({ to, path: [{ ...u.position }, ...crossed], captured: null, castle: { unit: partner, to: crossed[steps - 2] ?? crossed[0] } });
  }
  return out;
}

/**
 * Every move `u` may make by its patterns, castling included, leaving out (under
 * the check rule) any that would leave its side's royal units threatened.
 */
export function legalPieceMoves(state, u, occ = occupancy(state)) {
  const all = [...pieceTargets(state, u, occ), ...castles(state, u, occ)];
  if (!checkTag(state)) return all;
  return all.filter(t => !inCheck(state, u.ownerId, occAfter(occ, u, t.to, t.captured, t.castle)));
}

/** The move action for one of legalPieceMoves' targets. */
export function pieceAction(u, t) {
  return {
    type: 'move', unitId: u.id, from: { ...u.position }, to: { ...t.to },
    ...(t.path.length > 2 ? { path: t.path } : {}),
    ...(t.captured ? { targetId: t.captured.id, capture: true } : {}),
    ...(t.promote ? { promote: t.promote } : {}),
    ...(t.castle ? { castle: t.castle.unit.id } : {}),
  };
}

/** The legal target an action names, worked out afresh (an action is never trusted). */
export function matchPieceMove(state, u, action) {
  return legalPieceMoves(state, u).find(t => t.to.x === action.to?.x && t.to.y === action.to?.y
    && (t.promote ?? null) === (action.promote ?? null) && (t.castle?.unit.id ?? null) === (action.castle ?? null)) ?? null;
}

/**
 * The cells a move slid over, which an enPassant pattern may take it on next
 * turn: only a first move that slid more than one step, in a ruleset that has
 * such a pattern at all.
 */
export function passingOf(state, u, t) {
  if (!t.pattern?.unmoved || !t.pattern.slides || t.path.length < 3) return null;
  const any = Object.values(rulesOf(state).types).some(x => x.moves?.some(p => p.enPassant));
  return any ? { unitId: u.id, ownerId: u.ownerId, cells: t.path.slice(1, -1).map(c => [c.x, c.y]) } : null;
}
