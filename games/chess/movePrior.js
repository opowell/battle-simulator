// ---------------------------------------------------------------------------
// π(move | position) — the opponent-model that makes the belief a DISTRIBUTION
// instead of a set. See OBSCURO-MOVE-PRIOR-PLAN.md.
//
// exactBelief.js advances P one opponent ply by expanding every position by
// every fog-legal opponent move. Without a model of how the opponent chooses,
// every resulting state is equally consistent with what we observed and the
// posterior over P is flat. This module supplies the missing conditional: a
// softmax over a cheap per-move score, so "the opponent probably took the free
// queen" becomes a number the belief can carry.
//
// THE HARD CONSTRAINT IS COST. |P| averages ~17k and fog branching is ~30, so
// one sweep scores ~500k moves inside exactBelief's 4s guard. Calling the
// search's static `evaluate(board, color)` per successor — an object-board
// conversion plus a 64-square walk each — is two orders of magnitude too
// expensive. So the score here is computed INCREMENTALLY FROM THE MOVE ITSELF,
// in constant time, on exactBelief's Int8Array(66) representation: everything it
// needs is in the move record plus one array read for the captured piece.
//
//   capture   the victim's material value — the dominant term; real players take
//             material, and this is what makes "they saw my hanging rook and
//             took it" more likely than "they shuffled a pawn"
//   promotion the value gained over the pawn
//   PST delta PST[type][to] − PST[type][from], sharing the evaluator's own
//             tables (pieceTables.js) — captures development/centralisation
//
// Deliberately NOT included: "gives check". It needs an attack test against our
// king square, which is not O(1) on this representation, and the plan calls for
// measuring before paying for it.
//
// TWO APPROXIMATIONS, both known and both load-bearing:
//
//  1. FOG ASYMMETRY. π conditions on the full position p, but the opponent chose
//     their move under their OWN fog and could not see p. A principled prior
//     would score from their information set — another belief computation per
//     node, hopeless at this budget. belief.js makes the same approximation.
//     The visible consequence is `kingCaptureValue` below.
//  2. LEVEL-1 ONLY. The opponent is a fixed static-eval softmax player. They do
//     not model us modelling them. Do not start down the recursive road here.
//
// SCAR TISSUE — read before sharpening anything. belief.js's header records two
// separate incidents where an over-sharp belief prior made the AI WORSE:
// THREAT_BIAS is deliberately modest and MAX_LURKERS exists because
// over-weighting phantom attackers "hallucinates coordinated mating attacks and
// the AI huddles instead of saving real material". A confident wrong belief is
// worse than an honest vague one, so the defaults here are near-uniform and are
// only justified by the log-loss numbers in OBSCURO-MOVE-PRIOR-PLAN.md — not by
// how reasonable they look.
// ---------------------------------------------------------------------------

import { PIECE_VALUE, PST } from './pieceTables.js';

// Material value by exactBelief piece code (1..6 = P N B R Q K).
//
// The king is 1000, not PIECE_VALUE.king (20000), and that is the whole fog
// asymmetry in one number. A move that captures OUR king is always pruned by
// exactBelief (the game did not end, so no such move was played), which means
// its π mass is removed as evidence — "you could have taken my king and didn't,
// so this world is unlikely". That inference is only valid if the opponent could
// SEE our king, and under fog they very often could not. At 20000 the softmax
// would put essentially all of a parent's mass on the king capture and annihilate
// any world in which one was available, including true ones. 1000 keeps the
// evidence real but bounded: a parent that could have taken our king loses most
// but not all of its weight.
const VALUE = [0, PIECE_VALUE.pawn, PIECE_VALUE.knight, PIECE_VALUE.bishop,
  PIECE_VALUE.rook, PIECE_VALUE.queen, 1000];

// PST flattened onto exactBelief's square indexing (i = rank*8 + file, rank 0 =
// rank 1) for both colours, since the tables are written from the mover's
// perspective. ChessAgent's pstIndex(sq, color) is (8−r)*8+f for white and
// (r−1)*8+f for black; in index terms that is a rank flip for white and the
// identity for black. Int16Array: values fit in ±50 and the lookup is on the hot
// path.
const PST_BY_SIGN = (() => {
  const CODE_TYPE = [null, 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
  const white = new Int16Array(7 * 64);
  const black = new Int16Array(7 * 64);
  for (let t = 1; t <= 6; t++) {
    const table = PST[CODE_TYPE[t]];
    if (!table) continue;
    for (let i = 0; i < 64; i++) {
      const r = i >> 3, f = i & 7;
      white[t * 64 + i] = table[(7 - r) * 8 + f];
      black[t * 64 + i] = table[r * 8 + f];
    }
  }
  return { white, black };
})();

/**
 * Score one fog-legal move in centipawn-ish units, O(1).
 *
 * `pos` is exactBelief's Int8Array(66) BEFORE the move; `m` is a move record
 * from genFogMoves ({ f, t, promo, dbl, ep, castle }); `sign` is +1 for white,
 * −1 for black. Exported so the calibration harness (and tests) can inspect the
 * model separately from the softmax that turns it into a distribution.
 */
export function scoreMove(pos, m, sign, w = {}) {
  const captureWeight = w.captureWeight ?? 1;
  const pstWeight = w.pstWeight ?? 1;
  const promoWeight = w.promoWeight ?? 1;
  const castleBonus = w.castleBonus ?? 0;
  const pstTab = sign > 0 ? PST_BY_SIGN.white : PST_BY_SIGN.black;

  if (m.castle) {
    // Both king and rook move; the king's own PST delta is the dominant part and
    // castling is generically good, so add a flat bonus rather than pretending
    // to price the rook's repositioning.
    return castleBonus + pstWeight * (pstTab[6 * 64 + m.t] - pstTab[6 * 64 + m.f]);
  }

  const mover = pos[m.f];
  const type = mover > 0 ? mover : -mover;
  let s = 0;

  // Capture. En passant takes a pawn that is NOT on the destination square, so
  // read the victim from m.ep when it is set.
  const victim = m.ep >= 0 ? pos[m.ep] : pos[m.t];
  if (victim) s += captureWeight * VALUE[victim > 0 ? victim : -victim];

  // Promotion: the material actually gained.
  if (m.promo) s += promoWeight * (VALUE[m.promo] - VALUE[1]);

  // Piece-square delta. The piece that ARRIVES is the promoted type, so the two
  // ends of the delta can come from different tables.
  const arriving = m.promo ? m.promo : type;
  s += pstWeight * (pstTab[arriving * 64 + m.t] - pstTab[type * 64 + m.f]);

  return s;
}

/**
 * Build a prior. The returned function fills `out[0..moves.length-1]` with
 * π(m | pos), NORMALIZED so Σ_m π = 1.
 *
 *   prior(pos, moves, sign, out) -> void
 *
 * The batch shape (rather than one call per move returning an unnormalized
 * number) is deliberate: normalizing per parent is not optional — without it a
 * high-branching position hands out more total mass than a cramped one and mass
 * is not conserved — and doing the softmax here means it can subtract the
 * per-parent max, which keeps `temperature` free to be small without overflowing.
 *
 * `temperature` is in the same centipawn-ish units as scoreMove, so τ = 300 makes
 * a pawn capture ~1.4× as likely as a quiet move and a queen capture ~20×.
 * Higher is vaguer; Infinity is exactly UNIFORM_PRIOR.
 */
export function makeMovePrior({ temperature = 300, ...weights } = {}) {
  if (!(temperature > 0)) throw new Error('movePrior: temperature must be > 0');
  if (temperature === Infinity) return UNIFORM_PRIOR;
  const invT = 1 / temperature;
  return function prior(pos, moves, sign, out) {
    const n = moves.length;
    let max = -Infinity;
    for (let j = 0; j < n; j++) {
      const s = scoreMove(pos, moves[j], sign, weights) * invT;
      out[j] = s;
      if (s > max) max = s;
    }
    let sum = 0;
    for (let j = 0; j < n; j++) { const e = Math.exp(out[j] - max); out[j] = e; sum += e; }
    const inv = 1 / sum;
    for (let j = 0; j < n; j++) out[j] *= inv;
  };
}

/**
 * The baseline: every fog-legal move equally likely. Note that this is NOT the
 * same thing as a flat posterior over P — see exactBelief's weight bookkeeping.
 * A state reachable from several parents accumulates their mass, and a parent
 * with fewer legal moves passes more mass to each child, so uniform π already
 * yields a genuinely non-uniform distribution over states with no model at all.
 */
export const UNIFORM_PRIOR = function uniformPrior(pos, moves, sign, out) {
  const p = 1 / moves.length;
  for (let j = 0; j < moves.length; j++) out[j] = p;
};
