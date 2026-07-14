// ---------------------------------------------------------------------------
// Exact fog-of-war belief: the paper's position set P (Zhang & Sandholm 2026).
//
// Obscuro "maintains the full set P of possible positions given the
// observations it has seen so far" and samples its search worlds uniformly
// from it. This module implements that exactly for FoW chess:
//
//   • P starts as {the standard initial position} (common knowledge).
//   • Before each of our moves, P advances one opponent ply: for every
//     position, every pseudo-legal fog move the opponent could have made
//     (minus moves that would have captured our king — the game would have
//     ended) yields a successor.
//   • Each successor is filtered against our CURRENT observation: our own
//     pieces must match exactly, every square we can see must show exactly
//     what we observe, and the position must reproduce our exact visibility
//     set (so hidden pieces sit only where they wouldn't change what we see —
//     including the pawn-block rule).
//   • Our own chosen move is applied to every position after we commit it.
//   • Positions are deduplicated by placement + castling rights + en passant
//     (P is a set of STATES, not histories — the paper does the same, fn. 21).
//
// Exactness is abandoned (permanently, for this game) if P would exceed CAP
// positions, a single update runs past a time guard, an update empties P
// (shouldn't happen; belt and braces), or the tracker is first attached
// mid-game — the caller then falls back to the heuristic particle belief
// (belief.js). While |P| = 1 the agent literally knows the true position and
// the fog search degenerates to (near) perfect play, which is correct.
// ---------------------------------------------------------------------------

import { FILES } from './board.js';
import { getAllFogMoves } from './moves.js';
import { applyMoveToBoard, getVisibleSquares } from './board.js';

const ALL_SQUARES = [];
for (const f of FILES) for (let r = 1; r <= 8; r++) ALL_SQUARES.push(f + r);

// Give up on exactness above this many positions (paper: |P| usually ≤ 10⁶ in
// C++; the average is ~17k. This cap keeps a JS turn update affordable —
// self-play at power 80–100 saw max |P| ≈ 26k, so 50k covers most middlegames).
const CAP = 50000;
// ... or when a single update exceeds this much wall clock.
const TIME_GUARD_MS = 4000;
// Re-acquisition (below): only attempt to re-enumerate a lost P when the
// pre-filter cross-product bound is at most this many placements.
const REACQUIRE_BOUND = 60000;

const other = c => (c === 'white' ? 'black' : 'white');

// The standard initial position, with piece ids following ChessGame's naming.
function initialPositions() {
  const board = {};
  const place = (color) => {
    const br = color === 'white' ? 1 : 8;
    const pr = color === 'white' ? 2 : 7;
    const p = color === 'white' ? 'w' : 'b';
    const back = [
      ['R', 'rook', 'a', ''], ['N', 'knight', 'b', ''], ['B', 'bishop', 'c', ''],
      ['Q', 'queen', 'd', ''], ['K', 'king', 'e', ''], ['B', 'bishop', 'f', '2'],
      ['N', 'knight', 'g', '2'], ['R', 'rook', 'h', '2'],
    ];
    for (const [sym, type, file, suf] of back) {
      board[file + br] = { id: p + sym + suf, ownerId: color, type, position: file + br, alive: true };
    }
    for (const f of FILES) {
      board[f + pr] = { id: p + 'P' + f, ownerId: color, type: 'pawn', position: f + pr, alive: true };
    }
  };
  place('white'); place('black');
  const cr = {
    white: { kingSide: true, queenSide: true },
    black: { kingSide: true, queenSide: true },
  };
  return [{ board, cr, ep: null }];
}

// Same castling-rights transition as ChessGame.applyActions.
function updateRights(rights, unit, square) {
  let { white, black } = rights;
  if (unit.type === 'king') {
    if (unit.ownerId === 'white') white = { kingSide: false, queenSide: false };
    else black = { kingSide: false, queenSide: false };
  }
  if (unit.type === 'rook') {
    if (square === 'a1') white = { ...white, queenSide: false };
    if (square === 'h1') white = { ...white, kingSide: false };
    if (square === 'a8') black = { ...black, queenSide: false };
    if (square === 'h8') black = { ...black, kingSide: false };
  }
  return { white, black };
}

// Apply one move to a tracked position, mirroring ChessGame.applyActions
// (board, castling rights, en passant target).
function applyToPosition(pos, action) {
  const mover = pos.board[action.from];
  const target = action.to ? pos.board[action.to] : undefined;
  const board = applyMoveToBoard(pos.board, action);
  let cr = updateRights(pos.cr, mover, action.from);
  if (target) cr = updateRights(cr, target, action.to);
  let ep = null;
  if (action.isDoublePush) {
    const fromRank = parseInt(action.from[1], 10);
    const toRank = parseInt(action.to[1], 10);
    ep = action.from[0] + ((fromRank + toRank) / 2);
  }
  return { board, cr, ep };
}

function signature(pos) {
  let s = '';
  for (const sq of ALL_SQUARES) {
    const p = pos.board[sq];
    if (!p) { s += '.'; continue; }
    const c = p.type === 'knight' ? 'n' : p.type[0];
    s += p.ownerId === 'white' ? c.toUpperCase() : c;
  }
  const f = b => (b.kingSide ? 'k' : '') + (b.queenSide ? 'q' : '');
  return s + '|' + f(pos.cr.white) + f(pos.cr.black) + '|' + (pos.ep ?? '-');
}

export class ExactBelief {
  constructor(aiColor) {
    this.aiColor = aiColor;
    this.oppColor = other(aiColor);
    this.exact = null;      // null = not initialised; true/false afterwards
    this.positions = null;  // [{ board, cr, ep }]
    this.firstTurnDone = false;
    this._lastTurnKey = null;
  }

  _giveUp() { this.exact = false; this.positions = null; }

  /**
   * Advance + filter P for this turn. Idempotent per `turnKey` (the agent may
   * sample worlds more than once per decision). Must be called on EVERY one of
   * our turns from the very first, or the tracker gives up (it cannot
   * reconstruct a missed history).
   */
  beginTurn(observation, turnKey = null) {
    if (turnKey != null) {
      if (this._lastTurnKey === turnKey) return;
      this._lastTurnKey = turnKey;
    }
    if (this.exact === false) return;
    const t0 = Date.now();
    const filter = this._makeFilter(observation);
    if (!this.firstTurnDone) {
      this.firstTurnDone = true;
      // Exactness needs the full history: only attach at the game's first turn.
      if ((observation.turnNumber ?? 1) !== 1) { this._giveUp(); return; }
      this.positions = initialPositions();
      this.exact = true;
      if (this.aiColor === 'black') {
        // White has already made one ply.
        this._advanceOpponent(observation, filter, t0);
      } else {
        this.positions = this.positions.filter(filter);
      }
    } else {
      this._advanceOpponent(observation, filter, t0);
    }
    if (this.exact && (!this.positions || this.positions.length === 0)) this._giveUp();
  }

  /** Apply our chosen move to every position in P. */
  commitOurMove(action) {
    if (!this.exact || !this.positions || !action?.from) return;
    const next = [];
    const seen = new Set();
    for (const pos of this.positions) {
      const mover = pos.board[action.from];
      if (!mover || mover.ownerId !== this.aiColor) continue; // inconsistent (shouldn't happen)
      try {
        const np = applyToPosition(pos, action);
        const sig = signature(np);
        if (!seen.has(sig)) { seen.add(sig); next.push(np); }
      } catch { /* drop inconsistent position */ }
    }
    this.positions = next;
    if (next.length === 0) this._giveUp();
  }

  // One opponent ply: successors of every position under every fog-legal
  // opponent move, minus impossibilities (king captured / no move available),
  // filtered INLINE against the current observation — the cap and dedupe apply
  // to consistent positions only, so a bushy expansion that the observation
  // mostly rules out doesn't trip the cap.
  _advanceOpponent(observation, filter, t0) {
    const visSet = new Set(observation.visibleSquares ?? []);
    const obsBoard = observation.board;
    const next = [];
    const seen = new Set();
    for (const pos of this.positions) {
      if (Date.now() - t0 > TIME_GUARD_MS) { this._giveUp(); return; }
      const moves = getAllFogMoves(pos.board, this.oppColor, { castlingRights: pos.cr, enPassantTarget: pos.ep });
      if (moves.length === 0) continue; // the opponent DID move, so this position is impossible
      for (const m of moves) {
        const target = m.to ? pos.board[m.to] : undefined;
        // Capturing our king ends the game — it didn't, so prune.
        if (target && target.type === 'king' && target.ownerId === this.aiColor) continue;
        // Cheap pre-filter: if the destination is a square we can now see, our
        // observation must show exactly the moved piece there.
        if (m.to && visSet.has(m.to)) {
          const o = obsBoard[m.to];
          const newType = m.payload?.promote ?? pos.board[m.from].type;
          if (!o || o.ownerId !== this.oppColor || o.type !== newType) continue;
        }
        const np = applyToPosition(pos, m);
        if (!filter(np)) continue;
        const sig = signature(np);
        if (seen.has(sig)) continue;
        seen.add(sig);
        next.push(np);
        if (next.length > CAP) { this._giveUp(); return; }
      }
    }
    this.positions = next;
  }

  // Build the per-position observation-consistency predicate for this turn:
  // (a) our own pieces match exactly, (b) every square we can see shows exactly
  // what we observe, (c) the position reproduces our exact visibility set
  // (hidden pieces may not change what we can see — this encodes blocking and
  // the pawn rule). (c) is the expensive check and runs last.
  _makeFilter(observation) {
    const visSet = new Set(observation.visibleSquares ?? []);
    const obsBoard = observation.board;
    const ours = new Map();
    for (const sq of Object.keys(obsBoard)) {
      const p = obsBoard[sq];
      if (p && p.ownerId === this.aiColor) ours.set(sq, p.type);
    }
    const me = this.aiColor;
    return (pos) => {
      let mine = 0;
      for (const sq of Object.keys(pos.board)) {
        const p = pos.board[sq];
        if (!p || p.ownerId !== me) continue;
        mine++;
        if (ours.get(sq) !== p.type) return false;
      }
      if (mine !== ours.size) return false;
      for (const sq of visSet) {
        const o = obsBoard[sq], c = pos.board[sq];
        if (!o !== !c) return false;
        if (o && (o.type !== c.type || o.ownerId !== c.ownerId)) return false;
      }
      const vis = getVisibleSquares(pos.board, me);
      if (vis.size !== visSet.size) return false;
      for (const s of vis) if (!visSet.has(s)) return false;
      return true;
    };
  }

  /**
   * Try to RE-ACQUIRE a lost position set from the heuristic belief's
   * per-piece possible-square sets. Only possible when every hidden piece's
   * set is still a guaranteed superset of the truth (never truncated, no
   * possible promotion) and the cross-product of placements is small — in
   * practice late-game positions with few hidden pieces. The result is a
   * TIGHT SUPERSET of the true P (per-piece sets can't encode inter-piece
   * move-history correlations), marked `approx`; from here on it is advanced
   * exactly again, so it stays a superset — strictly better than particles.
   */
  tryReacquire(observation, belief, turnKey = null) {
    if (this.exact || !belief) return;
    if (turnKey != null) {
      if (this._lastReacqKey === turnKey) return;
      this._lastReacqKey = turnKey;
    }
    const obsBoard = observation.board;
    const seen = new Set();
    for (const sq of Object.keys(obsBoard)) {
      const p = obsBoard[sq];
      if (p && p.ownerId === this.oppColor) seen.add(p.id);
    }
    const visSet = new Set(observation.visibleSquares ?? []);
    const hidden = [];
    for (const pc of belief.pieces.values()) {
      if (!pc.alive || seen.has(pc.id)) continue;
      if (pc.truncated) return; // set may exclude the truth — cannot re-acquire
      const cands = [...pc.possible].filter(sq => !visSet.has(sq) && !obsBoard[sq]);
      if (cands.length === 0) return; // contradiction — leave it to the particles
      hidden.push({ pc, cands });
    }
    let bound = 1;
    for (const h of hidden) { bound *= h.cands.length; if (bound > REACQUIRE_BOUND) return; }

    // Enumerate every collision-free placement of the hidden pieces onto the
    // observed board, then keep the ones consistent with the observation.
    const filter = this._makeFilter(observation);
    const forced = belief.forcedEnemy ?? new Set();
    const out = [];
    const t0 = Date.now();
    const homeRank = this.oppColor === 'white' ? '1' : '8';
    const place = (i, board) => {
      if (out.length > CAP || Date.now() - t0 > TIME_GUARD_MS) return false;
      if (i === hidden.length) {
        for (const fsq of forced) { // a piece of ours was just captured there
          const f = board[fsq];
          if (!f || f.ownerId !== this.oppColor) return true; // inconsistent placement, skip
        }
        // Castling rights for the opponent: grant when king+rook stand on their
        // home squares (necessary condition; over-granting is the safe
        // direction — it credits the opponent with more options).
        const k = board['e' + homeRank];
        const kingHome = k && k.ownerId === this.oppColor && k.type === 'king';
        const rookAt = f => { const r = board[f + homeRank]; return kingHome && r && r.ownerId === this.oppColor && r.type === 'rook'; };
        const oppCr = { kingSide: rookAt('h'), queenSide: rookAt('a') };
        const cr = this.aiColor === 'white'
          ? { white: observation.gameSpecific?.castlingRights?.white ?? { kingSide: false, queenSide: false }, black: oppCr }
          : { white: oppCr, black: observation.gameSpecific?.castlingRights?.black ?? { kingSide: false, queenSide: false } };
        const pos = { board, cr, ep: null };
        if (filter(pos)) out.push(pos);
        return true;
      }
      const { pc, cands } = hidden[i];
      for (const sq of cands) {
        if (board[sq]) continue;
        const nb = { ...board };
        nb[sq] = { id: pc.id, ownerId: this.oppColor, type: pc.type, position: sq, alive: true };
        if (!place(i + 1, nb)) return false;
      }
      return true;
    };
    if (!place(0, { ...obsBoard })) return; // bailed on cap/time
    if (out.length === 0 || out.length > CAP) return;
    // Dedupe as states and resume exact tracking from here.
    const seenSig = new Set();
    this.positions = out.filter(p => { const s = signature(p); if (seenSig.has(s)) return false; seenSig.add(s); return true; });
    this.exact = true;
    this.approx = true;              // superset, not the literal history-exact P
    this._lastTurnKey = turnKey;     // this turn is done; advance resumes next turn
  }

  /** Uniform sample of up to n positions from P, without replacement. */
  samplePositions(n, rng = Math.random) {
    if (!this.exact || !this.positions?.length) return null;
    const P = this.positions;
    if (P.length <= n) return [...P];
    // Partial Fisher–Yates over an index array.
    const idx = P.map((_, i) => i);
    const out = [];
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(rng() * (idx.length - i));
      [idx[i], idx[j]] = [idx[j], idx[i]];
      out.push(P[idx[i]]);
    }
    return out;
  }
}

// Per-game store, same pattern as belief.js: keyed by the players array
// identity, then by colour.
const store = new WeakMap();

export function getExactBelief(state, aiColor) {
  let byColor = store.get(state.players);
  if (!byColor) { byColor = new Map(); store.set(state.players, byColor); }
  let b = byColor.get(aiColor);
  if (!b) { b = new ExactBelief(aiColor); byColor.set(aiColor, b); }
  return b;
}
