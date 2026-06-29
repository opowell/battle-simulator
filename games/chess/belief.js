// ---------------------------------------------------------------------------
// Fog-of-war belief tracking ("particle" / information-set model)
//
// Under fog of war the agent is handed a board with every unseen enemy piece
// deleted, so a naive search treats hidden pieces as if they did not exist and
// happily walks into their attacks. This module instead maintains the
// *information set*: the set of board states consistent with everything the
// agent has legitimately observed (the common-knowledge starting position, its
// own moves, and what its pieces have seen each turn).
//
// We represent the belief compactly as, per still-living enemy piece, the set
// of squares it could currently occupy. Each turn we:
//   1. propagate  — every unseen enemy piece may have moved one ply through the
//                   fog, so we expand its possible squares by one move of
//                   reachability (this is what lets us realise a pawn last
//                   "known" on e2 could now be on e4 attacking f5);
//   2. collapse   — squares we can now see pin or rule out possibilities;
//   3. sample     — draw a handful of concrete full boards ("particles") from
//                   the belief for the search to evaluate against.
//
// This is a deliberately lightweight, game-specific analogue of the particle /
// knowledge-limited subgame-solving approach from Zhang & Sandholm 2021
// ("Subgame solving without common knowledge"): we keep no equilibrium
// machinery, only a calibrated cloud of plausible worlds plus pessimistic
// evaluation in the agent.
// ---------------------------------------------------------------------------

import { FILES, fileIndex, rankOf, squareAt, getVisibleSquares } from './board.js';
import { pseudoLegalForUnit } from './moves.js';

const ALL_SQUARES = [];
for (const f of FILES) for (let r = 1; r <= 8; r++) ALL_SQUARES.push(f + r);

// Empty castling rights — belief reachability never castles, but the king move
// generator dereferences castlingRights[ownerId], so supply a safe stub.
const NO_CASTLING = { white: { kingSide: false, queenSide: false }, black: { kingSide: false, queenSide: false } };

const MAX_POSSIBLE = 28; // cap a piece's possible-square set so sampling stays cheap
const THREAT_BIAS = 5;   // how strongly to over-sample placements that attack our pieces
// At most this many invisible pieces per particle may be placed on a square that
// attacks one of our pieces. Real positions rarely have the whole hidden army
// bearing down at once; without this cap, threat-biased sampling hallucinates
// coordinated mating attacks and the AI huddles instead of saving real material.
const MAX_LURKERS = 2;

function opp(color) { return color === 'white' ? 'black' : 'white'; }

// The opponent's starting line-up, with ids matching ChessGame.initialBoard so
// that sightings (which carry the real piece id) collapse the right entry.
function startingPieces(color) {
  const br = color === 'white' ? 1 : 8;
  const pr = color === 'white' ? 2 : 7;
  const p  = color === 'white' ? 'w' : 'b';
  const back = [
    ['R', 'rook',   'a', ''], ['N', 'knight', 'b', ''], ['B', 'bishop', 'c', ''],
    ['Q', 'queen',  'd', ''], ['K', 'king',   'e', ''], ['B', 'bishop', 'f', '2'],
    ['N', 'knight', 'g', '2'], ['R', 'rook',  'h', '2'],
  ];
  const list = [];
  for (const [sym, type, file, suf] of back) list.push({ id: p + sym + suf, type, position: file + br });
  for (const f of FILES) list.push({ id: p + 'P' + f, type: 'pawn', position: f + pr });
  return list;
}

// Squares this piece type could move *to and rest on* in one ply, given the
// currently-known board. `board` already has hidden squares empty (so sliders
// pass freely through the fog) and known pieces present (so they block). A
// resting square must be hidden — were the piece on a visible square we would
// simply see it. Pawns additionally treat both forward diagonals as possible
// captures into the fog.
function reachableSquares(board, type, color, sq, hidden) {
  const out = [];
  if (type === 'pawn') {
    const fi = fileIndex(sq), r = rankOf(sq);
    const dir = color === 'white' ? 1 : -1;
    const startRank = color === 'white' ? 2 : 7;
    const one = squareAt(fi, r + dir);
    if (one && !board[one]) {
      if (hidden.has(one)) out.push(one);
      if (r === startRank) {
        const two = squareAt(fi, r + 2 * dir);
        if (two && !board[two] && hidden.has(two)) out.push(two);
      }
    }
    for (const dfi of [-1, 1]) {
      const cap = squareAt(fi + dfi, r + dir);
      if (cap && hidden.has(cap)) out.push(cap); // could have captured into fog
    }
    return out;
  }
  const unit = { id: '__belief__', ownerId: color, type, position: sq };
  for (const a of pseudoLegalForUnit(board, unit, { castlingRights: NO_CASTLING, enPassantTarget: null }, true)) {
    if (a.to && hidden.has(a.to)) out.push(a.to);
  }
  return out;
}

function chebyshev(a, b) {
  return Math.max(Math.abs(fileIndex(a) - fileIndex(b)), Math.abs(rankOf(a) - rankOf(b)));
}

export class Belief {
  constructor(aiColor) {
    this.aiColor = aiColor;
    this.oppColor = opp(aiColor);
    // id -> { id, type, possible:Set<square>, anchor:square, alive:bool }
    this.pieces = new Map();
    for (const sp of startingPieces(this.oppColor)) {
      this.pieces.set(sp.id, { id: sp.id, type: sp.type, possible: new Set([sp.position]), anchor: sp.position, alive: true });
    }
    this.firstTurnDone = false;
    this.oppPlies = 0;             // number of moves the opponent has made so far
    this.ownSnapshot = null;       // id -> square of our pieces after our last move
    this.forcedEnemy = new Set();  // squares we know hold an enemy right now (just captured a piece of ours)
  }

  hiddenSquares(board) {
    const visible = getVisibleSquares(board, this.aiColor);
    return new Set(ALL_SQUARES.filter(sq => !visible.has(sq)));
  }

  // 1. Propagation: every unseen enemy piece may have advanced one ply.
  expandOnePly(board) {
    const hidden = this.hiddenSquares(board);
    for (const pc of this.pieces.values()) {
      if (!pc.alive) continue;
      const next = new Set(pc.possible); // staying put is always possible
      for (const sq of pc.possible) {
        for (const dest of reachableSquares(board, pc.type, this.oppColor, sq, hidden)) next.add(dest);
      }
      pc.possible = next.size > MAX_POSSIBLE
        ? new Set([...next].sort((a, b) => chebyshev(a, pc.anchor) - chebyshev(b, pc.anchor)).slice(0, MAX_POSSIBLE))
        : next;
    }
  }

  // Detect pieces of ours captured since our last move; the capturer must sit on
  // the victim's square at the start of this turn (opponent has moved once).
  computeForcedSquares(board) {
    this.forcedEnemy = new Set();
    if (!this.ownSnapshot) return;
    const hidden = this.hiddenSquares(board);
    const present = new Set();
    for (const sq of Object.keys(board)) {
      const pc = board[sq];
      if (pc && pc.ownerId === this.aiColor) present.add(pc.id);
    }
    for (const [id, sq] of this.ownSnapshot) {
      if (!present.has(id) && hidden.has(sq)) this.forcedEnemy.add(sq);
    }
  }

  // 2. Collapse: reconcile the belief with what we can actually see this turn.
  collapse(board) {
    const visible = getVisibleSquares(board, this.aiColor);
    const seen = new Set();
    for (const sq of Object.keys(board)) {
      const pc = board[sq];
      if (!pc || pc.ownerId !== this.oppColor) continue;
      seen.add(pc.id);
      let entry = this.pieces.get(pc.id);
      if (!entry) { entry = { id: pc.id, type: pc.type, possible: new Set(), anchor: sq, alive: true }; this.pieces.set(pc.id, entry); }
      entry.type = pc.type;          // track promotions
      entry.alive = true;
      entry.anchor = sq;
      entry.possible = new Set([sq]); // pinned: we see exactly where it is
    }
    // An unseen piece is on no visible square (else we'd see it).
    for (const pc of this.pieces.values()) {
      if (!pc.alive || seen.has(pc.id)) continue;
      for (const sq of [...pc.possible]) if (visible.has(sq)) pc.possible.delete(sq);
      if (pc.possible.size === 0) {
        // Belief contradiction (over-aggressive pruning); fall back to "somewhere hidden".
        pc.possible = new Set(ALL_SQUARES.filter(sq => !visible.has(sq)));
      }
    }
  }

  // Run the full per-turn update before the agent searches.
  beginTurn(board) {
    if (!this.firstTurnDone) {
      // Our very first move. If we are black, white has already moved once.
      if (this.aiColor === 'black') { this.expandOnePly(board); this.oppPlies = 1; }
      this.firstTurnDone = true;
    } else {
      this.expandOnePly(board); // opponent has moved exactly once since our last turn
      this.oppPlies++;
    }
    this.computeForcedSquares(board);
    this.collapse(board);
  }

  // Record the move we are about to play so next turn we can (a) drop captured
  // enemies and (b) detect our own losses.
  commitOurMove(action, board) {
    if (action) {
      if (action.isCapture && action.targetId) {
        const victim = this.pieces.get(action.targetId);
        if (victim) victim.alive = false;
      }
    }
    // Snapshot our pieces as they will stand after the move.
    const snap = new Map();
    for (const sq of Object.keys(board)) {
      const pc = board[sq];
      if (pc && pc.ownerId === this.aiColor) snap.set(pc.id, pc.position);
    }
    if (action && action.from && action.to) {
      const moved = board[action.from];
      if (moved && moved.ownerId === this.aiColor) { snap.delete(moved.id); snap.set(moved.id, action.to); }
    }
    this.ownSnapshot = snap;
  }

  /**
   * Sample up to `n` concrete full boards consistent with the current belief.
   * Each particle is the observed board plus a plausible placement of every
   * unseen, still-living enemy piece. Most-constrained pieces are placed first;
   * squares nearer a piece's anchor (last sighting / start) are favoured, but
   * far squares are still drawn so genuinely dangerous worlds appear.
   */
  sample(board, n, rng = Math.random) {
    const visible = getVisibleSquares(board, this.aiColor);
    const seen = new Set();
    for (const sq of Object.keys(board)) {
      const pc = board[sq];
      if (pc && pc.ownerId === this.oppColor) seen.add(pc.id);
    }

    // Whether a piece of a given type, placed on a given square, would attack one
    // of our pieces. Memoised since it only depends on the fixed observed board.
    const threatCache = new Map();
    const threatens = (type, sq) => {
      const key = type + sq;
      let v = threatCache.get(key);
      if (v === undefined) { v = attacksFriendly(board, type, this.oppColor, sq, this.aiColor); threatCache.set(key, v); }
      return v;
    };
    const canThreaten = pc => [...pc.possible].some(sq => !visible.has(sq) && threatens(pc.type, sq));

    const unseen = [...this.pieces.values()].filter(pc => pc.alive && !seen.has(pc.id));

    // Pieces that could move to a square attacking one of our pieces. The scarce
    // move budget is spent preferentially (but not exclusively) on these, so a
    // real lurking threat is surfaced without imagining the whole army developed.
    const threatCapable = new Set(unseen.filter(canThreaten).map(p => p.id));

    const particles = [];
    const keys = new Set();
    for (let attempt = 0; attempt < n * 4 && particles.length < n; attempt++) {
      const pb = { ...board };
      const used = new Set();
      let lurkers = 0;             // invisible attackers placed so far in this particle
      // The opponent can only have moved as many pieces as it has made moves, so
      // most of its army is still at home. Pieces placed beyond this budget are
      // forced back to their anchor (start / last-seen) square.
      let moveBudget = Math.min(this.oppPlies, unseen.length);
      // Order pieces for this particle: threat-capable ones tend to come first
      // (so they win the budget) but with jitter, so threats appear in many
      // particles rather than all — the AI stays cautious, not paralysed.
      const order = [...unseen].sort((a, b) =>
        ((threatCapable.has(a.id) ? -0.7 : 0) + rng()) - ((threatCapable.has(b.id) ? -0.7 : 0) + rng()));
      for (const pc of order) {
        const cands = [...pc.possible].filter(sq => !pb[sq] && !used.has(sq) && !visible.has(sq));
        if (cands.length === 0) continue; // leave this piece off this particle
        const anchorFree = cands.includes(pc.anchor);
        let sq;
        if (anchorFree && moveBudget <= 0) {
          sq = pc.anchor; // out of moves: this piece must still be home
        } else {
          const biasOk = lurkers < MAX_LURKERS;
          const weights = cands.map(s => {
            const w = 1 / (1 + chebyshev(s, pc.anchor));
            return biasOk && threatens(pc.type, s) ? w * THREAT_BIAS : w; // surface dangerous worlds
          });
          sq = weightedPick(cands, weights, rng);
          if (sq !== pc.anchor) moveBudget--; // spent one of the opponent's moves
        }
        if (threatens(pc.type, sq)) lurkers++;
        pb[sq] = { id: pc.id, ownerId: this.oppColor, type: pc.type, position: sq, alive: true };
        used.add(sq);
      }
      // Honour squares we know hold an enemy (recent capture of one of our pieces).
      for (const fsq of this.forcedEnemy) {
        if (!pb[fsq]) pb[fsq] = { id: '__capt__' + fsq, ownerId: this.oppColor, type: 'queen', position: fsq, alive: true };
      }
      const key = boardSignature(pb, this.oppColor);
      if (keys.has(key)) continue;
      keys.add(key);
      particles.push(pb);
    }
    return particles;
  }
}

// True if a `color` piece of `type` placed on `sq` would attack any `targetColor`
// piece on `board` (hidden squares are empty, so attack lines run through the fog).
function attacksFriendly(board, type, color, sq, targetColor) {
  const unit = { id: '__threat__', ownerId: color, type, position: sq };
  for (const a of pseudoLegalForUnit(board, unit, { castlingRights: NO_CASTLING, enPassantTarget: null }, true)) {
    const occ = a.to && board[a.to];
    if (occ && occ.ownerId === targetColor) return true;
  }
  return false;
}

function weightedPick(cands, weights, rng) {
  let total = 0;
  for (const w of weights) total += w;
  let pick = rng() * total;
  for (let i = 0; i < cands.length; i++) { pick -= weights[i]; if (pick <= 0) return cands[i]; }
  return cands[cands.length - 1];
}

function boardSignature(board, oppColor) {
  let key = '';
  for (const sq of ALL_SQUARES) {
    const p = board[sq];
    key += !p ? '.' : (p.ownerId === oppColor ? p.type[0].toUpperCase() : p.type[0]);
  }
  return key;
}
