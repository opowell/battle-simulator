// ---------------------------------------------------------------------------
// ObscuroAgent — a unified, equilibrium-based chess AI that handles every
// information level, with complete information (fog of war off) as a special
// case. Inspired by Zhang & Sandholm's *Obscuro*, the first superhuman agent
// for Fog-of-War chess.
//
// The key idea from that work is to treat decision-making game-theoretically
// over an *information set* (the set of positions consistent with what we have
// observed) and solve for an equilibrium, rather than committing to a single
// "most likely" world. Perfect information is then simply the case where the
// information set — and every opponent information set — has size one.
//
//   • Perfect information: the opponent is a full-information minimiser, so the
//     equilibrium of our (singleton) information set is exactly the classical
//     minimax move. We reuse the repo's existing alpha-beta as the depth-limited
//     evaluator, so strength is comparable to ChessAgent. (No randomisation —
//     correct, since there is nothing to hide.)
//
//   • Imperfect information (fog): we sample a cloud of plausible worlds from
//     the Belief tracker, build a small two-step zero-sum *subgame* over them,
//     and solve it with CFR+ (see cfr.js). The opponent must commit to a reply
//     without being able to pin down which world is real, so moves that are
//     refuted in *every* world are avoided while moves refuted in only *some*
//     worlds remain playable — yielding the paper's signature mixed strategies,
//     smart randomisation and bluffing. We then "purify" the equilibrium
//     (à la Obscuro) to a single move.
//
// Scope (proof of concept): this is a normal-form (one matrix per move) cut of
// the paper's extensive-form KLUSS/GT-CFR/PCFR+ machinery, with a pluggable
// perfect-information leaf evaluator (the repo's eval / alpha-beta; Stockfish
// could be dropped in here). The fog opponent model is a first-cut
// approximation — it models the opponent as uncertain over our whole sampled
// information set rather than maintaining the opponent's own (second-order)
// belief about our hidden pieces. That refinement is the natural next step and
// is exactly where the paper's KLUSS earns its keep.
// ---------------------------------------------------------------------------

import { ObscuroAgent as GenericObscuroAgent } from '../../agents/ObscuroAgent.js';
import { getAllLegalMoves } from './moves.js';
import { applyMoveToBoard, isAttackedBy, getVisibleSquares } from './board.js';
import { getBelief } from './belief.js';
import {
  evaluate, advanceGs, scoreMoveInParticle, alphaBeta, FULL_INFO_CFG, clearTT,
} from './ChessAgent.js';
import { solveMatrixGame } from './cfr.js';
import { toFEN, uciToAction } from './fen.js';
import { stockfishBestAction, sfOptsForDifficulty, difficultyToNumber, available as stockfishAvailable, multiPV } from './stockfish.js';

const otherColor = c => (c === 'white' ? 'black' : 'white');

// Canonical key for an action, so the same opponent reply across different
// sampled worlds maps to the same matrix column.
function actionKey(a) {
  if (a.type === 'castle') return 'O' + a.side;
  const promo = a.payload?.promote ? '=' + a.payload.promote[0] : '';
  return a.from + a.to + promo;
}

// Difficulty is a single 0–100 dial; every search knob is derived from it so the
// design UI can expose it as one slider. The mapping is continuous (not a few
// fixed tiers) so each notch is a little stronger and a little slower.
//
//   depth/useQuiesce  perfect-information minimax fallback when fog is off
//   fog               imperfect-information subgame: sampled worlds (particles),
//                     candidate moves (rows) / opponent replies (cols), Stockfish
//                     search depth at each leaf (sfDepth — the dominant strength
//                     dial), CFR+ iterations, and how many moves we mix between
//                     after purification.
//
// Play uses the level-1 Stockfish CFR subgame (fogStockfishStrategy): ~rows ×
// particles MultiPV calls per move, fast enough to stay responsive. At the top
// of the scale we additionally refine the best few candidates with the
// opponent's own subgame (refineTopK — a bounded, "selective" slice of the full
// second-order belief model fogStockfishLevel2Strategy, which on its own costs
// rows × particles nested solves and is far too slow to run on every move).
const lerp = (a, b, t) => a + (b - a) * t;
const ri = (a, b, t) => Math.round(lerp(a, b, t));

function configForDifficulty(difficulty) {
  const t = difficultyToNumber(difficulty) / 100;
  return {
    depth: ri(2, 5, t),
    useQuiesce: t >= 0.2,
    fog: {
      // The matrix costs ~rows × particles MultiPV calls, so sfDepth is capped
      // (deep MultiPV is expensive per call); top-end strength comes instead from
      // more sampled worlds, a wider matrix, and the selective refinement below.
      particles: ri(2, 12, t),
      rows: ri(4, 10, t),
      cols: ri(4, 10, t),
      leafDepth: 2,
      iters: ri(120, 600, t),
      sfDepth: Math.max(1, ri(1, 8, t)),
      purifyMax: t < 0.3 ? 3 : 2,
      subgameDepth: 1,
      // Selective second-order refinement: how many top moves to re-score with
      // the opponent's level-1 subgame (0 = off). Only worth it near the top of
      // the dial, with small inner matrices to stay affordable.
      refineTopK: t >= 0.7 ? 3 : 0,
      innerRows: 3,
      innerCols: 3,
    },
  };
}

// Per-world leaf scores are clamped so an imagined king capture from phantom
// hidden pieces can't swamp a concrete material decision.
const LEAF_CLAMP = 1500;
const clip = v => (v > LEAF_CLAMP ? LEAF_CLAMP : v < -LEAF_CLAMP ? -LEAF_CLAMP : v);

// ---------------------------------------------------------------------------
// Perfect information: the opponent sees everything, so our singleton infoset's
// equilibrium is the minimax move. Reuse the existing depth-limited alpha-beta.
// ---------------------------------------------------------------------------
function perfectInfoStrategy(board, gs, us, cfg, legalActions) {
  const dist = new Array(legalActions.length).fill(0);
  let best = 0, bestScore = -Infinity;
  for (let i = 0; i < legalActions.length; i++) {
    const s = scoreMoveInParticle(board, gs, us, legalActions[i], cfg.depth, cfg.useQuiesce);
    if (s > bestScore) { bestScore = s; best = i; }
  }
  dist[best] = 1; // a pure strategy
  return { mode: 'minimax', rows: legalActions, dist, action: legalActions[best], value: bestScore, cols: 0 };
}

// ---------------------------------------------------------------------------
// Imperfect information: build and solve the matrix subgame over sampled worlds.
// ---------------------------------------------------------------------------
function fogStrategy(board, gs, us, particles, fcfg, rng, candidateMoves) {
  const them = otherColor(us);
  const rep = particles[0];
  const candidates = candidateMoves ?? getAllLegalMoves(board, us, gs);

  // Candidate moves (rows). Rank optimistically by the position straight after
  // our move (so aggressive / bluff candidates survive — the subgame decides
  // whether they actually pay off), and always include the single safest move
  // (a shallow minimax best response) as a solid anchor to mix around.
  const ranked = candidates
    .map(a => ({ a, s: evaluate(applyMoveToBoard(rep, a), us) }))
    .sort((x, y) => y.s - x.s);
  const rows = ranked.slice(0, fcfg.rows).map(x => x.a);
  const safeBest = bestSafeMove(rep, gs, us, ranked.slice(0, fcfg.rows * 3).map(x => x.a));
  if (safeBest && !rows.some(a => actionKey(a) === actionKey(safeBest))) rows.push(safeBest);

  // For each (world, row): the post-move board / state and the opponent's legal
  // replies in that world, keyed canonically. Also pool the opponent's replies,
  // scoring each by how strongly it can refute us anywhere (lower = better for
  // the opponent), to choose the matrix columns.
  const perCell = rows.map(() => particles.map(() => null));
  const colScore = new Map();
  for (let i = 0; i < rows.length; i++) {
    for (let p = 0; p < particles.length; p++) {
      const h = particles[p];
      const h1 = applyMoveToBoard(h, rows[i]);
      const gs1 = advanceGs(gs, h, rows[i], us);
      const byKey = new Map();
      for (const b of getAllLegalMoves(h1, them, gs1)) {
        const k = actionKey(b);
        if (!byKey.has(k)) {
          byKey.set(k, b);
          const v = evaluate(applyMoveToBoard(h1, b), us);
          const cur = colScore.get(k);
          if (cur === undefined || v < cur) colScore.set(k, v);
        }
      }
      perCell[i][p] = { h1, gs1, byKey };
    }
  }
  const cols = [...colScore.entries()].sort((a, b) => a[1] - b[1]).slice(0, fcfg.cols).map(e => e[0]);

  // Leaf value of (cell, opponent reply key): play the reply (or pass if it is
  // illegal in this world), then a depth-limited perfect-information evaluation.
  const leaf = (cell, k) => {
    const b = k != null ? cell.byKey.get(k) : undefined;
    const board2 = b ? applyMoveToBoard(cell.h1, b) : cell.h1;
    const gs2    = b ? advanceGs(cell.gs1, cell.h1, b, them) : cell.gs1;
    return clip(fcfg.leafDepth > 0
      ? alphaBeta(board2, gs2, us, us, fcfg.leafDepth, -Infinity, Infinity, FULL_INFO_CFG, !!fcfg.useQuiesce)
      : evaluate(board2, us));
  };

  // No opponent reply anywhere (e.g. we capture the last enemy piece): pick the
  // row with the best mean unopposed value.
  if (cols.length === 0) {
    const dist = new Array(rows.length).fill(0);
    let best = 0, bestScore = -Infinity;
    for (let i = 0; i < rows.length; i++) {
      let s = 0;
      for (let p = 0; p < particles.length; p++) s += leaf(perCell[i][p], null);
      if (s > bestScore) { bestScore = s; best = i; }
    }
    dist[best] = 1;
    return { mode: 'cfr', rows, dist, action: rows[best], value: bestScore / particles.length, cols: 0 };
  }

  // Payoff matrix: M[row][col] = mean over worlds of the leaf value.
  const M = rows.map((_, i) => cols.map(k => {
    let sum = 0;
    for (let p = 0; p < particles.length; p++) sum += leaf(perCell[i][p], k);
    return sum / particles.length;
  }));

  const { row, value } = solveMatrixGame(M, fcfg.iters);
  const action = purify(row, rows, fcfg.purifyMax, rng);
  return { mode: 'cfr', rows, dist: row, action, value, cols: cols.length };
}

// Shallow minimax best move within a single world — a safe anchor for the mix.
function bestSafeMove(world, gs, us, candidates) {
  let best = null, bestScore = -Infinity;
  for (const a of candidates) {
    const s = scoreMoveInParticle(world, gs, us, a, 2, false);
    if (s > bestScore) { bestScore = s; best = a; }
  }
  return best;
}

// Purify the equilibrium strategy: when one move is dominant just play it,
// otherwise sample among the top few "stable" moves (à la Obscuro's purify).
function purify(dist, actions, maxSupport, rng = Math.random) {
  const ranked = actions.map((a, i) => ({ a, p: dist[i] ?? 0 })).sort((x, y) => y.p - x.p);
  const support = ranked[0].p >= 0.9 ? 1 : Math.max(1, maxSupport);
  const kept = ranked.slice(0, support).filter(k => k.p > 1e-6);
  if (kept.length === 0) return ranked[0].a;
  let tot = 0; for (const k of kept) tot += k.p;
  let pick = rng() * tot;
  for (const k of kept) { pick -= k.p; if (pick <= 0) return k.a; }
  return kept[kept.length - 1].a;
}

// Find a colour's king square on a board, or null.
function findKingSquare(board, color) {
  for (const sq of Object.keys(board)) {
    const p = board[sq];
    if (p && p.ownerId === color && p.type === 'king') return sq;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Imperfect-information subgame, scored by Stockfish (the paper's batched
// node heuristic). For each (our move, sampled world) we ask Stockfish in a
// single MultiPV call to evaluate every opponent reply to the resulting
// position. Fog-of-war terminals — capturing the enemy king, or leaving our own
// king capturable — are handled here, since Stockfish plays standard chess and
// never captures a king. Returns the same shape as fogStrategy, or null to
// signal "fall back to the JS evaluation".
// ---------------------------------------------------------------------------
export async function fogStockfishStrategy(board, gs, us, particles, fcfg, candidateMoves) {
  const them = otherColor(us);
  const oppSide = them === 'white' ? 'w' : 'b';
  const rep = particles[0];
  const candidates = candidateMoves ?? getAllLegalMoves(board, us, gs);

  // Rank candidate moves by summing Stockfish scores across all sampled worlds.
  // Using a shallower depth here (ranking only needs rough ordering); the full
  // sfDepth is reserved for the matrix leaf evaluations below. Moves that
  // Stockfish doesn't surface in a given world score 0 for that world, so moves
  // robust across many worlds naturally outscore moves only good in a few.
  const usSide = us === 'white' ? 'w' : 'b';
  const rankDepth = Math.max(1, fcfg.sfDepth - 1);
  const scoreSum = new Map();
  for (const h of particles) {
    const pv = await multiPV(toFEN(h, gs, usSide, 1), { multipv: fcfg.rows, depth: rankDepth });
    for (const { move, cp } of (pv ?? [])) scoreSum.set(move, (scoreSum.get(move) ?? 0) + cp);
  }
  let rows;
  if (scoreSum.size > 0) {
    const ranked = [...scoreSum.entries()].sort((a, b) => b[1] - a[1]);
    const mapped = ranked.map(([move]) => uciToAction(move, candidates)).filter(Boolean);
    const usedKeys = new Set(mapped.map(actionKey));
    const rest = candidates
      .filter(a => !usedKeys.has(actionKey(a)))
      .map(a => ({ a, s: evaluate(applyMoveToBoard(rep, a), us) }))
      .sort((x, y) => y.s - x.s)
      .map(x => x.a);
    rows = [...mapped, ...rest].slice(0, fcfg.rows);
  } else {
    rows = candidates
      .map(a => ({ a, s: evaluate(applyMoveToBoard(rep, a), us) }))
      .sort((x, y) => y.s - x.s)
      .slice(0, fcfg.rows)
      .map(x => x.a);
  }

  // Per cell: a forced terminal value applying to every column, or a map of
  // opponent-reply (UCI) -> value-to-us plus a fallback (value if the opponent
  // instead plays its best reply, used for worlds where a committed reply is
  // illegal).
  const cell = rows.map(() => particles.map(() => null));
  const colFreq = new Map();
  for (let i = 0; i < rows.length; i++) {
    for (let p = 0; p < particles.length; p++) {
      const h = particles[p];
      const target = h[rows[i].to];
      if (target && target.ownerId === them && target.type === 'king') { cell[i][p] = { forced: LEAF_CLAMP }; continue; } // we win
      const h1 = applyMoveToBoard(h, rows[i]);
      const ourKing = findKingSquare(h1, us);
      if (!ourKing || isAttackedBy(h1, ourKing, them)) { cell[i][p] = { forced: -LEAF_CLAMP }; continue; } // we hung our king
      const gs1 = advanceGs(gs, h, rows[i], us);
      const pv = await multiPV(toFEN(h1, gs1, oppSide, 1), { multipv: fcfg.cols, depth: fcfg.sfDepth });
      const map = new Map();
      let worstUs = Infinity;
      if (pv && pv.length) {
        for (const { move, cp } of pv) { const usv = clip(-cp); map.set(move, usv); if (usv < worstUs) worstUs = usv; }
      } else {
        worstUs = clip(evaluate(h1, us)); // engine returned nothing — static eval
      }
      cell[i][p] = { map, fallback: worstUs, h1, gs1 };
      for (const k of map.keys()) colFreq.set(k, (colFreq.get(k) ?? 0) + 1);
    }
  }

  // Every cell forced (or engine silent): pick the best row by mean value.
  if (colFreq.size === 0) {
    let best = 0, bestScore = -Infinity;
    for (let i = 0; i < rows.length; i++) {
      let s = 0;
      for (let p = 0; p < particles.length; p++) s += cell[i][p]?.forced ?? cell[i][p]?.fallback ?? 0;
      if (s > bestScore) { bestScore = s; best = i; }
    }
    return { mode: 'cfr-sf', rows, dist: rows.map((_, i) => (i === best ? 1 : 0)), action: rows[best], value: bestScore / particles.length, cols: 0 };
  }

  const cols = [...colFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, fcfg.cols).map(e => e[0]);

  // Build the payoff matrix. For subgameDepth > 1 we recurse: the leaf value
  // for (rows[i], opp_k) is itself a one-ply subgame solved over the cloud of
  // worlds shifted forward by both moves.
  const M = [];
  for (let i = 0; i < rows.length; i++) {
    const Mrow = [];
    for (const k of cols) {
      let sum = 0;
      if (fcfg.subgameDepth > 1) {
        const subParticles = [];
        let repH2 = null, repGs2 = null;
        for (let p = 0; p < particles.length; p++) {
          const c = cell[i][p];
          if (c.forced !== undefined) { sum += c.forced; continue; }
          // Derive the opponent action once from the first non-forced world.
          if (!repH2) {
            const oppLegal = getAllLegalMoves(c.h1, them, c.gs1);
            const oppAction = uciToAction(k, oppLegal);
            repH2 = oppAction ? applyMoveToBoard(c.h1, oppAction) : c.h1;
            repGs2 = oppAction ? advanceGs(c.gs1, c.h1, oppAction, them) : c.gs1;
          }
          // Apply the same action to each particle (same from/to squares, safe simplification).
          const oppLegalP = getAllLegalMoves(c.h1, them, c.gs1);
          const oppActionP = uciToAction(k, oppLegalP);
          subParticles.push(oppActionP ? applyMoveToBoard(c.h1, oppActionP) : c.h1);
        }
        if (subParticles.length > 0 && repH2) {
          const sgv = await subgameValue(repH2, repGs2, us, subParticles, fcfg);
          sum += sgv * subParticles.length;
        }
      } else {
        for (let p = 0; p < particles.length; p++) {
          const c = cell[i][p];
          sum += c.forced !== undefined ? c.forced : (c.map.has(k) ? c.map.get(k) : c.fallback);
        }
      }
      Mrow.push(sum / particles.length);
    }
    M.push(Mrow);
  }

  const { row, value } = solveMatrixGame(M, fcfg.iters);
  return { mode: 'cfr-sf', rows, dist: row, action: purify(row, rows, fcfg.purifyMax), value, cols: cols.length };
}

// Returns the CFR equilibrium value of a position to `us`, using a depth-1
// normal-form subgame over the given cloud of particles. Used as the leaf
// evaluator when subgameDepth > 1.
async function subgameValue(board, gs, us, particles, fcfg) {
  const innerFcfg = {
    ...fcfg,
    subgameDepth: 1,
    rows: fcfg.innerRows ?? 4,
    cols: fcfg.innerCols ?? 4,
  };
  const r = await fogStockfishStrategy(board, gs, us, particles, innerFcfg, null);
  return r ? r.value : clip(evaluate(board, us));
}

// Build the opponent's particle cloud from a specific position h1.
// The opponent knows: their own pieces (always) + our pieces on squares they
// can see. They are uncertain about our pieces on squares hidden from them.
// We construct their cloud by fixing the "known" part from h1 and substituting
// our hidden-piece placements from each of the shifted particles.
function buildOppParticles(h1, them, us, allParticles_h1) {
  const oppVisible = getVisibleSquares(h1, them);
  // Fixed base: opponent pieces + our visible pieces.
  const oppBase = {};
  for (const sq of Object.keys(h1)) {
    const pc = h1[sq];
    if (pc && (pc.ownerId === them || oppVisible.has(sq))) oppBase[sq] = pc;
  }
  // For each shifted particle add our hidden pieces (those in squares the
  // opponent cannot see), skipping any square already occupied in oppBase.
  return allParticles_h1.map(ph1 => {
    const particle = { ...oppBase };
    for (const sq of Object.keys(ph1)) {
      const pc = ph1[sq];
      if (pc && pc.ownerId === us && !oppVisible.has(sq) && !particle[sq]) {
        particle[sq] = pc;
      }
    }
    return particle;
  });
}

// ---------------------------------------------------------------------------
// Level-2 (and level-k) belief: instead of treating the opponent as omniscient
// within each sampled world, model them as a level-1 agent uncertain about our
// hidden pieces, and solve our outer move game against the replies they would
// actually choose.
//
// The game is sequential — the opponent observes (part of) our move and updates
// their belief before replying. A pure best response would therefore leak
// information: always answering ...Rxe5 reveals we have a rook on the e-file.
// So we do *not* collapse to argmax. For each candidate move we solve the
// opponent's level-1 subgame to learn their realistic reply distribution, pool
// those replies into matrix columns weighted by the opponent's equilibrium
// probability, value each (our move, their reply) world-by-world, and run CFR+
// over the matrix (the paper's "PCFR+ outer loop"). The result is a *mixed*
// strategy that hides our hidden state by spreading mass over moves that look
// similar to the opponent — restoring the paper's smart-randomisation behaviour.
//
// Two depth axes are wired through `fcfg`:
//   • beliefDepth (level-k): the opponent's inner subgame is itself a
//     level-(k-1) belief solve when beliefDepth > 2, recursing down to the
//     omniscient level-1 model. Inner matrix sizes shrink each level so cost
//     stays bounded (the paper finds k=3 already near-convergent).
//   • oppSubgameDepth (combined game-tree + belief depth): the opponent's inner
//     subgame may look one ply deeper at our follow-up. Opt-in (off by default)
//     since cost is rows × particles × inner-rows × inner-cols × innermost SF
//     calls — usable only with very small inner matrices.
//
// The opponent's belief is reconstructed with buildOppParticles: fix what they
// observe (their pieces + our visible pieces), vary only our hidden pieces.
// ---------------------------------------------------------------------------
export async function fogStockfishLevel2Strategy(board, gs, us, particles, fcfg, candidateMoves, rng = Math.random) {
  const them = otherColor(us);
  const usSide = us === 'white' ? 'w' : 'b';
  const rep = particles[0];
  const candidates = candidateMoves ?? getAllLegalMoves(board, us, gs);

  // Rank our candidate moves (rows) the same way as the level-1 strategy.
  const rankDepth = Math.max(1, fcfg.sfDepth - 1);
  const scoreSum = new Map();
  for (const h of particles) {
    const pv = await multiPV(toFEN(h, gs, usSide, 1), { multipv: fcfg.rows, depth: rankDepth });
    for (const { move, cp } of (pv ?? [])) scoreSum.set(move, (scoreSum.get(move) ?? 0) + cp);
  }
  let rows;
  if (scoreSum.size > 0) {
    const ranked = [...scoreSum.entries()].sort((a, b) => b[1] - a[1]);
    const mapped = ranked.map(([move]) => uciToAction(move, candidates)).filter(Boolean);
    const usedKeys = new Set(mapped.map(actionKey));
    const rest = candidates.filter(a => !usedKeys.has(actionKey(a)))
      .map(a => ({ a, s: evaluate(applyMoveToBoard(rep, a), us) }))
      .sort((x, y) => y.s - x.s).map(x => x.a);
    rows = [...mapped, ...rest].slice(0, fcfg.rows);
  } else {
    rows = candidates
      .map(a => ({ a, s: evaluate(applyMoveToBoard(rep, a), us) }))
      .sort((x, y) => y.s - x.s).slice(0, fcfg.rows).map(x => x.a);
  }
  if (rows.length === 0) return null;

  // Config for the opponent's inner subgame. One belief level shallower, smaller
  // matrices (shrinking further each recursion), and — unless opted in via
  // oppSubgameDepth — depth-1 so the opponent does not also recurse on our reply.
  const innerSize = Math.max(2, fcfg.innerRows ?? 4);
  const innerColSize = Math.max(2, fcfg.innerCols ?? 4);
  const oppBeliefDepth = (fcfg.beliefDepth ?? 2) - 1;
  const oppFcfg = {
    ...fcfg,
    subgameDepth: fcfg.oppSubgameDepth ?? 1,
    beliefDepth: oppBeliefDepth,
    rows: innerSize,
    cols: innerColSize,
    innerRows: Math.max(2, innerSize - 1),
    innerCols: Math.max(2, innerColSize - 1),
  };
  // Level-k recursion: a level-1 opponent is omniscient (fogStockfishStrategy);
  // a deeper opponent reasons about our hidden pieces too (recurse).
  const innerSolve = oppBeliefDepth >= 2 ? fogStockfishLevel2Strategy : fogStockfishStrategy;

  // For each (our move, world): forced terminal value, or the opponent's
  // equilibrium replies valued to us, plus an equilibrium-weighted fallback for
  // worlds where a pooled column reply happens to be illegal.
  const cell = rows.map(() => particles.map(() => null));
  const colWeight = new Map(); // opp reply key -> accumulated equilibrium probability
  for (let i = 0; i < rows.length; i++) {
    // Shift the whole particle cloud by our move once; reused for every p.
    const allH1 = particles.map(ph => applyMoveToBoard(ph, rows[i]));
    for (let p = 0; p < particles.length; p++) {
      const h = particles[p];
      const target = h[rows[i].to];
      if (target && target.ownerId === them && target.type === 'king') { cell[i][p] = { forced: LEAF_CLAMP }; continue; } // we win
      const h1 = allH1[p];
      const ourKing = findKingSquare(h1, us);
      if (!ourKing || isAttackedBy(h1, ourKing, them)) { cell[i][p] = { forced: -LEAF_CLAMP }; continue; } // we hung our king
      const gs1 = advanceGs(gs, h, rows[i], us);

      // Solve the opponent's subgame to learn which replies they would actually
      // play, and how likely each is. r.rows are their replies, r.dist their
      // equilibrium probabilities, r.value the value to them.
      const oppParticles = buildOppParticles(h1, them, us, allH1);
      const r = await innerSolve(h1, gs1, them, oppParticles, oppFcfg, null, rng);

      const map = new Map();
      let wSum = 0, fallback = 0;
      if (r && r.rows && r.rows.length) {
        for (let t = 0; t < r.rows.length; t++) {
          const prob = r.dist?.[t] ?? 0;
          if (prob <= 1e-6) continue;
          const k = actionKey(r.rows[t]);
          // Value this specific reply against *our actual world* h1 (so a reply
          // that blunders into — or snaps off — one of our hidden pieces is
          // scored correctly; this is the level-2 nuance).
          const usv = clip(evaluate(applyMoveToBoard(h1, r.rows[t]), us));
          if (!map.has(k)) map.set(k, usv);
          colWeight.set(k, (colWeight.get(k) ?? 0) + prob);
          fallback += prob * usv; wSum += prob;
        }
      }
      // Fallback = value to us if the opponent plays its full equilibrium mix.
      fallback = wSum > 0 ? fallback / wSum : (r ? clip(-r.value) : clip(evaluate(h1, us)));
      cell[i][p] = { map, fallback };
    }
  }

  // No opponent replies anywhere (every world forced / engine silent): pick the
  // best row by mean value.
  if (colWeight.size === 0) {
    let best = 0, bestScore = -Infinity;
    for (let i = 0; i < rows.length; i++) {
      let s = 0;
      for (let p = 0; p < particles.length; p++) s += cell[i][p]?.forced ?? cell[i][p]?.fallback ?? 0;
      if (s > bestScore) { bestScore = s; best = i; }
    }
    return { mode: 'cfr-sf-l2', rows, dist: rows.map((_, i) => (i === best ? 1 : 0)), action: rows[best], value: bestScore / particles.length, cols: 0 };
  }

  // Columns: the replies the opponent is most likely to play, by equilibrium
  // probability pooled across our moves and worlds.
  const cols = [...colWeight.entries()].sort((a, b) => b[1] - a[1]).slice(0, fcfg.cols).map(e => e[0]);

  // Payoff matrix: M[i][j] = mean over worlds of value to us when we play move i
  // and the opponent answers with column cols[j] (its equilibrium-weighted reply
  // where that column is illegal in a given world). CFR+ then mixes our rows.
  const M = rows.map((_, i) => cols.map(k => {
    let sum = 0;
    for (let p = 0; p < particles.length; p++) {
      const c = cell[i][p];
      sum += c.forced !== undefined ? c.forced : (c.map.has(k) ? c.map.get(k) : c.fallback);
    }
    return sum / particles.length;
  }));

  const { row, value } = solveMatrixGame(M, fcfg.iters);
  return { mode: 'cfr-sf-l2', rows, dist: row, action: purify(row, rows, fcfg.purifyMax, rng), value, cols: cols.length };
}

// ---------------------------------------------------------------------------
// Selective second-order refinement: run the fast level-1 solve, then re-score
// only its top `refineTopK` moves with the opponent's own subgame. This captures
// most of the anti-blunder benefit of the full level-2 model (which models the
// opponent as a level-1 reasoner) at a tiny fraction of its cost, since only a
// handful of moves — over a capped subset of worlds and a shallower engine
// search — get the expensive treatment. Used at the top of the difficulty dial.
// ---------------------------------------------------------------------------
async function fogStockfishRefined(board, gs, us, particles, fcfg, candidateMoves) {
  const base = await fogStockfishStrategy(board, gs, us, particles, fcfg, candidateMoves);
  const K = Math.min(fcfg.refineTopK ?? 0, base?.rows?.length ?? 0);
  if (!base || K <= 1) return base;

  const them = otherColor(us);
  const top = base.rows
    .map((a, i) => ({ a, p: base.dist[i] ?? 0 }))
    .sort((x, y) => y.p - x.p)
    .slice(0, K)
    .filter(x => x.p > 1e-4);
  if (top.length <= 1) return base;

  // Bound cost: refine over a subset of worlds with a shallower opponent search.
  const rp = particles.slice(0, Math.min(particles.length, 4));
  const oppFcfg = {
    ...fcfg, subgameDepth: 1, beliefDepth: 1, refineTopK: 0,
    rows: Math.max(2, fcfg.innerRows ?? 3), cols: Math.max(2, fcfg.innerCols ?? 3),
    sfDepth: Math.min(fcfg.sfDepth, 6),
  };

  let best = top[0].a, bestV = -Infinity;
  for (const { a } of top) {
    const allH1 = rp.map(ph => applyMoveToBoard(ph, a));
    let sum = 0;
    for (let p = 0; p < rp.length; p++) {
      const target = rp[p][a.to];
      if (target && target.ownerId === them && target.type === 'king') { sum += LEAF_CLAMP; continue; }
      const h1 = allH1[p];
      const ourKing = findKingSquare(h1, us);
      if (!ourKing || isAttackedBy(h1, ourKing, them)) { sum -= LEAF_CLAMP; continue; }
      const gs1 = advanceGs(gs, rp[p], a, us);
      const oppParticles = buildOppParticles(h1, them, us, allH1);
      const r = await fogStockfishStrategy(h1, gs1, them, oppParticles, oppFcfg, null);
      sum += r ? -r.value : clip(evaluate(h1, us)); // r.value is the opponent's, so negate
    }
    const v = sum / rp.length;
    if (v > bestV) { bestV = v; best = a; }
  }
  return { ...base, mode: 'cfr-sf-refined', action: best, value: bestV };
}

/**
 * Compute Obscuro's strategy for a position (exposed for tests/inspection).
 * Returns the candidate moves, the strategy distribution over them, the chosen
 * action, the solve mode ('minimax' for perfect info, 'cfr' for fog) and the
 * number of sampled worlds.
 */
export function obscuroStrategy(state, legalActions, rng = Math.random) {
  const us = state.activePlayers[0];
  const { board, gameSpecific } = state;
  const cfg = configForDifficulty(gameSpecific.difficulty);
  clearTT();

  if (!gameSpecific.fogOfWar) {
    return { ...perfectInfoStrategy(board, gameSpecific, us, cfg, legalActions), particles: 1 };
  }

  const belief = getBelief(state, us);
  belief.beginTurn(board);
  let particles = belief.sample(board, cfg.fog.particles);
  if (particles.length === 0) particles = [board];

  const res = fogStrategy(board, gameSpecific, us, particles, cfg.fog, rng, legalActions);
  return { ...res, particles: particles.length };
}

// ---------------------------------------------------------------------------
// ChessObscuroAgent — chess-specific subclass of the generic ObscuroAgent.
// Overrides the two strategy entry-points to use Stockfish evaluation and the
// multi-tier fog solver (level-1 / level-2 / refined), while the generic base
// class owns the agent identity, RNG, and the difficulty-0 random-play path.
//
// Circular-import note: ChessGame.js imports this file, so we cannot import
// ChessGame here. We pass an empty stub as the game arg to super() — it is
// never accessed because both _chooseWithoutFog and _chooseWithFog are
// overridden and chooseAction is overridden to handle chess particle sampling
// and belief commitment directly.
// ---------------------------------------------------------------------------
export class ChessObscuroAgent extends GenericObscuroAgent {
  constructor(opts = {}) {
    super({}, { id: 'obscuro', name: 'Obscuro (CFR)', ...opts });
  }

  async chooseAction(state, legalActions) {
    if (!legalActions.length) return null;
    if (legalActions.length === 1) return legalActions[0];

    await new Promise(r => setImmediate(r));

    const us = state.activePlayers[0];
    const { board, gameSpecific } = state;

    if (!gameSpecific.fogOfWar) {
      return this._chooseWithoutFog(state, legalActions, null, us);
    }

    const cfg = configForDifficulty(gameSpecific.difficulty);
    const belief = getBelief(state, us);
    belief.beginTurn(board);
    let particles = belief.sample(board, cfg.fog.particles);
    if (!particles.length) particles = [board];

    const action = await this._chooseWithFog(state, legalActions, cfg, us, particles);
    belief.commitOurMove(action, board);
    return action;
  }

  async _chooseWithoutFog(state, legalActions) {
    const sf = await stockfishBestAction(state, legalActions, sfOptsForDifficulty(state.gameSpecific.difficulty));
    return sf ?? obscuroStrategy(state, legalActions).action;
  }

  async _chooseWithFog(state, legalActions, cfg, us, particles) {
    const { board, gameSpecific } = state;
    const fcfg = (cfg ?? configForDifficulty(gameSpecific.difficulty)).fog;
    if (await stockfishAvailable()) {
      try {
        const sfStrategy = (fcfg.beliefDepth ?? 1) >= 2 ? fogStockfishLevel2Strategy
          : (fcfg.refineTopK ?? 0) > 0 ? fogStockfishRefined
          : fogStockfishStrategy;
        const r = await sfStrategy(board, gameSpecific, us, particles, fcfg, legalActions);
        if (r) return r.action;
      } catch { /* fall through to the JS evaluation */ }
    }
    return fogStrategy(board, gameSpecific, us, particles, fcfg, this._rng, legalActions).action;
  }
}

export const ObscuroAgent = new ChessObscuroAgent();
