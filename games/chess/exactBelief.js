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
// REPRESENTATION (the capacity tier): positions are Int8Array(66) — 64 signed
// piece codes (+1..+6 white P N B R Q K, negative for black), castling bits at
// [64], en-passant index+1 at [65]. Move generation, application, and the
// visibility test all run on the typed array; visibility is a 2×32-bit mask
// compared with two integer equality checks; dedupe uses a 53-bit Zobrist
// hash. This is ~10× faster and ~15× smaller than the previous object-board
// version, which is what pays for the larger CAP. The typed encodings MUST
// mirror games/chess/moves.js (fog pseudo-legal, castle quirks, promotions,
// en passant) and board.js getVisibleSquares (pawn-block rule, blocker-included
// rays) exactly — the invariant test replays real recorded games and asserts
// the true position stays in P.
//
// Exactness is abandoned (for this game) if P would exceed CAP positions, a
// single update runs past a time guard, an update empties P, or the tracker is
// first attached mid-game — the caller then falls back to the heuristic
// particle belief (belief.js), and tryReacquire() below can later restore a
// tight SUPERSET of P once few pieces remain hidden. While |P| = 1 the agent
// literally knows the true position.
// ---------------------------------------------------------------------------

const CAP = 200000;          // paper: |P| usually ≤ 10⁶ (C++); avg ~17k
const TIME_GUARD_MS = 4000;  // per-turn update budget
const REACQUIRE_BOUND = 60000;

// --- encoding ---------------------------------------------------------------

const PIECE_CODE = { pawn: 1, knight: 2, bishop: 3, rook: 4, queen: 5, king: 6 };
const CODE_TYPE = [null, 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
const FILES = 'abcdefgh';

const sqToIdx = sq => (sq.charCodeAt(1) - 49) * 8 + (sq.charCodeAt(0) - 97);
const idxToSq = i => FILES[i & 7] + (((i >> 3) | 0) + 1);

// cr bits at [64]
const WK = 1, WQ = 2, BK = 4, BQ = 8;

function signOf(color) { return color === 'white' ? 1 : -1; }

// Convert an engine board object into a compact position.
export function fromBoardObject(board, cr, ep) {
  const p = new Int8Array(66);
  for (const sq of Object.keys(board)) {
    const pc = board[sq];
    if (!pc) continue;
    p[sqToIdx(sq)] = PIECE_CODE[pc.type] * signOf(pc.ownerId);
  }
  p[64] = (cr?.white?.kingSide ? WK : 0) | (cr?.white?.queenSide ? WQ : 0)
        | (cr?.black?.kingSide ? BK : 0) | (cr?.black?.queenSide ? BQ : 0);
  p[65] = ep ? sqToIdx(ep) + 1 : 0;
  return p;
}

// Convert a compact position back to the engine's board-object shape (with
// synthesised piece ids — P is a set of states, identity is not tracked).
export function toBoardObject(pos) {
  const board = {};
  const counts = {};
  for (let i = 0; i < 64; i++) {
    const c = pos[i];
    if (!c) continue;
    const color = c > 0 ? 'white' : 'black';
    const type = CODE_TYPE[Math.abs(c)];
    const key = color[0] + type;
    const n = counts[key] = (counts[key] ?? 0) + 1;
    const sq = idxToSq(i);
    board[sq] = { id: color[0] + type.toUpperCase()[0] + '_' + n, ownerId: color, type, position: sq, alive: true };
  }
  return board;
}

export function crObjectOf(pos) {
  const b = pos[64];
  return {
    white: { kingSide: !!(b & WK), queenSide: !!(b & WQ) },
    black: { kingSide: !!(b & BK), queenSide: !!(b & BQ) },
  };
}

export function epOf(pos) { return pos[65] ? idxToSq(pos[65] - 1) : null; }

// --- Zobrist hashing (dedupe key; 53-bit, fixed-seeded, deterministic) ------

const ZOB = (() => {
  let s = 0x9e3779b9 | 0;
  const next = () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) | 0;
  };
  const sq1 = new Int32Array(64 * 13), sq2 = new Int32Array(64 * 13);
  for (let i = 0; i < sq1.length; i++) { sq1[i] = next(); sq2[i] = next(); }
  const cr1 = new Int32Array(16), cr2 = new Int32Array(16);
  for (let i = 0; i < 16; i++) { cr1[i] = next(); cr2[i] = next(); }
  const ep1 = new Int32Array(65), ep2 = new Int32Array(65);
  for (let i = 0; i < 65; i++) { ep1[i] = next(); ep2[i] = next(); }
  return { sq1, sq2, cr1, cr2, ep1, ep2 };
})();

function hashPos(p) {
  let h1 = 0, h2 = 0;
  for (let i = 0; i < 64; i++) {
    const c = p[i];
    if (!c) continue;
    const k = i * 13 + (c + 6);
    h1 ^= ZOB.sq1[k]; h2 ^= ZOB.sq2[k];
  }
  h1 ^= ZOB.cr1[p[64]]; h2 ^= ZOB.cr2[p[64]];
  h1 ^= ZOB.ep1[p[65]]; h2 ^= ZOB.ep2[p[65]];
  return (h1 >>> 11) * 4294967296 + (h2 >>> 0); // 21 + 32 = 53 bits
}

// --- visibility mask (mirrors board.js getVisibleSquares exactly) -----------

const KNIGHT_D = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING_D = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const ROOK_D = [[0, 1], [0, -1], [1, 0], [-1, 0]];
const BISHOP_D = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const QUEEN_D = [...ROOK_D, ...BISHOP_D];

// Returns visibility for `sign`'s pieces as a 2×32-bit mask [lo, hi].
function visibilityMask(p, sign) {
  let lo = 0, hi = 0;
  const add = (i) => { if (i < 32) lo |= (1 << i); else hi |= (1 << (i - 32)); };
  for (let i = 0; i < 64; i++) {
    const c = p[i];
    if (!c || (c > 0) !== (sign > 0)) continue;
    add(i);
    const f = i & 7, r = i >> 3;
    const t = c > 0 ? c : -c;
    if (t === 1) { // pawn: pushes only when unblocked; diagonals always
      const dr = sign > 0 ? 1 : -1;
      const r1 = r + dr;
      if (r1 >= 0 && r1 < 8) {
        const push = r1 * 8 + f;
        if (!p[push]) {
          add(push);
          if (r === (sign > 0 ? 1 : 6)) {
            const push2 = (r + 2 * dr) * 8 + f;
            if (!p[push2]) add(push2);
          }
        }
        if (f > 0) add(r1 * 8 + f - 1);
        if (f < 7) add(r1 * 8 + f + 1);
      }
    } else if (t === 2) {
      for (const [df, dr] of KNIGHT_D) {
        const nf = f + df, nr = r + dr;
        if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) add(nr * 8 + nf);
      }
    } else if (t === 6) {
      for (const [df, dr] of KING_D) {
        const nf = f + df, nr = r + dr;
        if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) add(nr * 8 + nf);
      }
    } else { // sliders: ray includes the first blocker
      const dirs = t === 4 ? ROOK_D : t === 3 ? BISHOP_D : QUEEN_D;
      for (const [df, dr] of dirs) {
        let nf = f + df, nr = r + dr;
        while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
          const j = nr * 8 + nf;
          add(j);
          if (p[j]) break;
          nf += df; nr += dr;
        }
      }
    }
  }
  return [lo | 0, hi | 0];
}

// --- fog pseudo-legal move generation (mirrors moves.js getAllFogMoves) -----
// Moves are {f, t, promo (code 0|2..5), dbl, ep (captured idx | -1), castle
// (0 none, 1 kingside, 2 queenside)}.

function genFogMoves(p, sign) {
  const out = [];
  const push = (f, t, promo = 0, dbl = false, ep = -1, castle = 0) =>
    out.push({ f, t, promo, dbl, ep, castle });
  const epIdx = p[65] - 1; // -1 when none
  for (let i = 0; i < 64; i++) {
    const c = p[i];
    if (!c || (c > 0) !== (sign > 0)) continue;
    const f = i & 7, r = i >> 3;
    const t = c > 0 ? c : -c;
    if (t === 1) { // pawn
      const dr = sign > 0 ? 1 : -1;
      const startR = sign > 0 ? 1 : 6;
      const promoR = sign > 0 ? 7 : 0;
      const r1 = r + dr;
      if (r1 >= 0 && r1 < 8) {
        const one = r1 * 8 + f;
        if (!p[one]) {
          if (r1 === promoR) { for (const pc of [5, 4, 3, 2]) push(i, one, pc); }
          else {
            push(i, one);
            if (r === startR) {
              const two = (r + 2 * dr) * 8 + f;
              if (!p[two]) push(i, two, 0, true);
            }
          }
        }
        for (const df of [-1, 1]) {
          const nf = f + df;
          if (nf < 0 || nf > 7) continue;
          const cap = r1 * 8 + nf;
          if (cap === epIdx) {
            const victim = r * 8 + nf; // the double-pushed pawn
            if (p[victim] === -sign) push(i, cap, 0, false, victim);
          }
          const occ = p[cap];
          if (occ && (occ > 0) !== (sign > 0)) {
            if (r1 === promoR) { for (const pc of [5, 4, 3, 2]) push(i, cap, pc); }
            else push(i, cap);
          }
        }
      }
    } else if (t === 2 || t === 6) {
      for (const [df, dr] of (t === 2 ? KNIGHT_D : KING_D)) {
        const nf = f + df, nr = r + dr;
        if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
        const j = nr * 8 + nf;
        const occ = p[j];
        if (occ && (occ > 0) === (sign > 0)) continue;
        push(i, j);
      }
      if (t === 6) {
        // Castling under fog: rights bit + king on its home square + empty path
        // + SOMETHING on the rook corner (mirrors moves.js, quirks included:
        // no attack checks, and the corner occupant's identity is trusted).
        const home = sign > 0 ? 4 : 60; // e1 / e8
        if (i === home) {
          const base = sign > 0 ? 0 : 56;
          const rights = p[64];
          const ks = sign > 0 ? (rights & WK) : (rights & BK);
          const qs = sign > 0 ? (rights & WQ) : (rights & BQ);
          if (ks && !p[base + 5] && !p[base + 6] && p[base + 7]) push(i, base + 6, 0, false, -1, 1);
          if (qs && !p[base + 1] && !p[base + 2] && !p[base + 3] && p[base]) push(i, base + 2, 0, false, -1, 2);
        }
      }
    } else {
      const dirs = t === 4 ? ROOK_D : t === 3 ? BISHOP_D : QUEEN_D;
      for (const [df, dr] of dirs) {
        let nf = f + df, nr = r + dr;
        while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
          const j = nr * 8 + nf;
          const occ = p[j];
          if (occ) { if ((occ > 0) !== (sign > 0)) push(i, j); break; }
          push(i, j);
          nf += df; nr += dr;
        }
      }
    }
  }
  return out;
}

// Castling-rights corners: clearing masks by square index.
const CR_CLEAR = new Int8Array(64).fill(0xF);
CR_CLEAR[0] &= ~WQ; CR_CLEAR[7] &= ~WK; CR_CLEAR[56] &= ~BQ; CR_CLEAR[63] &= ~BK;

function applyMove(p, m, sign) {
  const n = p.slice();
  let cr = n[64];
  if (m.castle) {
    const base = sign > 0 ? 0 : 56;
    n[m.t] = n[m.f]; n[m.f] = 0;
    if (m.castle === 1) { n[base + 5] = n[base + 7]; n[base + 7] = 0; }
    else { n[base + 3] = n[base]; n[base] = 0; }
    cr &= sign > 0 ? ~(WK | WQ) : ~(BK | BQ);
  } else {
    const mover = n[m.f];
    const t = mover > 0 ? mover : -mover;
    n[m.t] = m.promo ? m.promo * sign : mover;
    n[m.f] = 0;
    if (m.ep >= 0) n[m.ep] = 0;
    if (t === 6) cr &= sign > 0 ? ~(WK | WQ) : ~(BK | BQ);
    cr &= CR_CLEAR[m.f]; // a rook leaving its corner loses that right…
    cr &= CR_CLEAR[m.t]; // …as does a rook captured on its corner
  }
  n[64] = cr;
  n[65] = m.dbl ? (((m.f + m.t) >> 1) + 1) : 0;
  return n;
}

// --- the tracker -------------------------------------------------------------

const other = c => (c === 'white' ? 'black' : 'white');

function initialPosition() {
  const p = new Int8Array(66);
  const back = [4, 2, 3, 5, 6, 3, 2, 4];
  for (let f = 0; f < 8; f++) {
    p[f] = back[f]; p[8 + f] = 1;          // white
    p[56 + f] = -back[f]; p[48 + f] = -1;  // black
  }
  p[64] = WK | WQ | BK | BQ;
  return p;
}

// Precompute the per-turn observation context used by every consistency check.
function obsContext(observation, mySign) {
  const obsArr = new Int8Array(64);
  for (const sq of Object.keys(observation.board)) {
    const pc = observation.board[sq];
    if (pc) obsArr[sqToIdx(sq)] = PIECE_CODE[pc.type] * signOf(pc.ownerId);
  }
  let visLo = 0, visHi = 0;
  for (const sq of observation.visibleSquares ?? []) {
    const i = sqToIdx(sq);
    if (i < 32) visLo |= (1 << i); else visHi |= (1 << (i - 32));
  }
  visLo |= 0; visHi |= 0;
  return { obsArr, visLo, visHi, mySign };
}

// Candidate consistency: (a) every visible square shows exactly the observed
// content, (b) our pieces match exactly everywhere (the observation always
// includes ALL our pieces, visible-square or not), (c) the candidate
// reproduces our exact visibility mask (blocking + pawn rule).
function consistent(ctx, cand) {
  const { obsArr, visLo, visHi, mySign } = ctx;
  for (let i = 0; i < 64; i++) {
    const vis = i < 32 ? (visLo >>> i) & 1 : (visHi >>> (i - 32)) & 1;
    const c = cand[i], o = obsArr[i];
    if (vis) { if (c !== o) return false; }
    else if ((c > 0) === (mySign > 0) && c !== 0) { if (c !== o) return false; }
    else if ((o > 0) === (mySign > 0) && o !== 0) { return false; }
  }
  const [lo, hi] = visibilityMask(cand, mySign);
  return lo === visLo && hi === visHi;
}

export class ExactBelief {
  constructor(aiColor) {
    this.aiColor = aiColor;
    this.oppColor = other(aiColor);
    this.mySign = signOf(aiColor);
    this.exact = null;      // null = not initialised; true/false afterwards
    this.approx = false;    // true when P was re-acquired (tight superset)
    this.positions = null;  // Int8Array(66)[]
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
    const ctx = obsContext(observation, this.mySign);
    if (!this.firstTurnDone) {
      this.firstTurnDone = true;
      // Exactness needs the full history: only attach at the game's first turn.
      if ((observation.turnNumber ?? 1) !== 1) { this._giveUp(); return; }
      this.positions = [initialPosition()];
      this.exact = true;
      if (this.aiColor === 'black') {
        this._advanceOpponent(ctx, t0); // white has already made one ply
      } else {
        this.positions = this.positions.filter(p => consistent(ctx, p));
      }
    } else {
      this._advanceOpponent(ctx, t0);
    }
    if (this.exact && (!this.positions || this.positions.length === 0)) this._giveUp();
  }

  /** Apply our chosen move (an engine action) to every position in P. */
  commitOurMove(action) {
    if (!this.exact || !this.positions || !action?.from) return;
    const m = {
      f: sqToIdx(action.from),
      t: sqToIdx(action.to),
      promo: action.payload?.promote ? PIECE_CODE[action.payload.promote] : 0,
      dbl: !!action.isDoublePush,
      ep: action.isEnPassant && action.capturedSquare ? sqToIdx(action.capturedSquare) : -1,
      castle: action.type === 'castle' ? (action.side === 'kingside' ? 1 : 2) : 0,
    };
    const next = [];
    const seen = new Set();
    for (const pos of this.positions) {
      const mover = pos[m.f];
      if (!mover || (mover > 0) !== (this.mySign > 0)) continue; // inconsistent
      const np = applyMove(pos, m, this.mySign);
      const h = hashPos(np);
      if (!seen.has(h)) { seen.add(h); next.push(np); }
    }
    this.positions = next;
    if (next.length === 0) this._giveUp();
  }

  // One opponent ply: successors of every position under every fog-legal
  // opponent move, minus impossibilities (king captured / no move available),
  // filtered INLINE against the current observation.
  _advanceOpponent(ctx, t0) {
    const oppSign = -this.mySign;
    const myKing = 6 * this.mySign;
    const { obsArr, visLo, visHi } = ctx;
    const next = [];
    const seen = new Set();
    for (const pos of this.positions) {
      if (Date.now() - t0 > TIME_GUARD_MS) { this._giveUp(); return; }
      const moves = genFogMoves(pos, oppSign);
      if (moves.length === 0) continue; // the opponent DID move
      for (const m of moves) {
        // Capturing our king ends the game — it didn't, so prune.
        if (pos[m.t] === myKing) continue;
        // Cheap pre-filter: a visible destination must show the moved piece.
        const vis = m.t < 32 ? (visLo >>> m.t) & 1 : (visHi >>> (m.t - 32)) & 1;
        if (vis && !m.castle) {
          const after = m.promo ? m.promo * oppSign : pos[m.f];
          if (obsArr[m.t] !== after) continue;
        }
        const np = applyMove(pos, m, oppSign);
        if (!consistent(ctx, np)) continue;
        const h = hashPos(np);
        if (seen.has(h)) continue;
        seen.add(h);
        next.push(np);
        if (next.length > CAP) { this._giveUp(); return; }
      }
    }
    this.positions = next;
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
    const ctx = obsContext(observation, this.mySign);
    const obsBoard = observation.board;
    const seenIds = new Set();
    for (const sq of Object.keys(obsBoard)) {
      const pc = obsBoard[sq];
      if (pc && pc.ownerId === this.oppColor) seenIds.add(pc.id);
    }
    const visSet = new Set(observation.visibleSquares ?? []);
    const hidden = [];
    for (const pc of belief.pieces.values()) {
      if (!pc.alive || seenIds.has(pc.id)) continue;
      if (pc.truncated) return; // set may exclude the truth — cannot re-acquire
      const cands = [...pc.possible].filter(sq => !visSet.has(sq) && !obsBoard[sq]).map(sqToIdx);
      if (cands.length === 0) return; // contradiction — leave it to the particles
      hidden.push({ code: PIECE_CODE[pc.type] * -this.mySign, cands });
    }
    let bound = 1;
    for (const h of hidden) { bound *= h.cands.length; if (bound > REACQUIRE_BOUND) return; }

    // Base array: the observed board (all our pieces + visible enemies), with
    // OUR castling rights from the observation; the opponent's rights are
    // granted per placement when king+rook stand on their home squares
    // (necessary condition; over-granting is the safe direction).
    const base = new Int8Array(66);
    base.set(ctx.obsArr.subarray(0, 64));
    const myCr = observation.gameSpecific?.castlingRights?.[this.aiColor];
    const myBits = this.aiColor === 'white'
      ? ((myCr?.kingSide ? WK : 0) | (myCr?.queenSide ? WQ : 0))
      : ((myCr?.kingSide ? BK : 0) | (myCr?.queenSide ? BQ : 0));
    const forced = [...(belief.forcedEnemy ?? new Set())].map(sqToIdx);
    const oppSign = -this.mySign;
    const homeR = this.mySign > 0 ? 56 : 0; // opponent's back-rank base index
    const out = [];
    const seen = new Set();
    const t0 = Date.now();
    const place = (i, arr) => {
      if (out.length > CAP || Date.now() - t0 > TIME_GUARD_MS) return false;
      if (i === hidden.length) {
        for (const fi of forced) { // a piece of ours was just captured there
          const f = arr[fi];
          if (!f || (f > 0) === (this.mySign > 0)) return true; // inconsistent, skip
        }
        const np = arr.slice();
        const kingHome = np[homeR + 4] === 6 * oppSign;
        let oppBits = 0;
        if (kingHome && np[homeR + 7] === 4 * oppSign) oppBits |= this.mySign > 0 ? BK : WK;
        if (kingHome && np[homeR] === 4 * oppSign) oppBits |= this.mySign > 0 ? BQ : WQ;
        np[64] = myBits | oppBits;
        np[65] = 0;
        if (consistent(ctx, np)) {
          const h = hashPos(np);
          if (!seen.has(h)) { seen.add(h); out.push(np); }
        }
        return true;
      }
      const { code, cands } = hidden[i];
      for (const idx of cands) {
        if (arr[idx]) continue;
        arr[idx] = code;
        const ok = place(i + 1, arr);
        arr[idx] = 0;
        if (!ok) return false;
      }
      return true;
    };
    if (!place(0, base)) return; // bailed on cap/time
    if (out.length === 0 || out.length > CAP) return;
    this.positions = out;
    this.exact = true;
    this.approx = true;              // superset, not the literal history-exact P
    this._lastTurnKey = turnKey;     // this turn is done; advance resumes next turn
  }

  /**
   * Uniform sample of up to n positions from P, without replacement, in the
   * engine's object shape: { board, cr, ep }.
   */
  samplePositions(n, rng = Math.random) {
    if (!this.exact || !this.positions?.length) return null;
    const P = this.positions;
    const picks = [];
    if (P.length <= n) picks.push(...P);
    else {
      const idx = P.map((_, i) => i);
      for (let i = 0; i < n; i++) {
        const j = i + Math.floor(rng() * (idx.length - i));
        [idx[i], idx[j]] = [idx[j], idx[i]];
        picks.push(P[idx[i]]);
      }
    }
    return picks.map(p => ({ board: toBoardObject(p), cr: crObjectOf(p), ep: epOf(p) }));
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
