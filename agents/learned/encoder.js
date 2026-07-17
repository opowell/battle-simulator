// ---------------------------------------------------------------------------
// Generic state encoder for learned leaf evaluation (agents/LEARNED-EVAL-PLAN.md).
//
// One featurizer for every game: a permutation-invariant "deep sets" encoding
// over `state.units`, which share a common shape across the roster
// ({ownerId, type, position:{x,y}, hp, maxHp, alive}). Per unit:
//
//   [1, x, y, hp/maxHp, alive, typeBucket one-hot ×8]        (13 dims)
//
// pooled (mean and max) separately over OWN units and ENEMY units → 52 dims,
// plus globals [turn/200, own-count/16, enemy-count/16, count ratio] and an
// optional per-game `game.encodeExtras(state, playerId) → number[]` (padded /
// truncated to 8) → 64 inputs total. Coordinates are normalized by the max
// coordinate seen in the state (scale-free across board sizes); missing fields
// degrade to zeros, so the encoder never throws on an unfamiliar game.
//
// ENCODER_VERSION is stored in every model.json; leafEval.js refuses to load a
// model built by a different encoder.
// ---------------------------------------------------------------------------

export const ENCODER_VERSION = 1;
export const INPUT_SIZE = 64;

const TYPE_BUCKETS = 8;
const UNIT_DIMS = 5 + TYPE_BUCKETS; // 13

function typeBucket(type) {
  const s = String(type ?? '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % TYPE_BUCKETS;
}

function unitXY(u) {
  const p = u.position;
  if (p && typeof p === 'object') return [Number(p.x) || 0, Number(p.y) || 0];
  return [0, 0];
}

/**
 * Encode `state` from `playerId`'s perspective into a Float64Array(INPUT_SIZE).
 */
export function encodeState(game, state, playerId) {
  const x = new Float64Array(INPUT_SIZE);
  const units = (state.units ?? []).filter(u => u && u.alive !== false);

  // Scale-free coordinate normalization: divide by the largest coordinate.
  let maxC = 1;
  for (const u of units) {
    const [ux, uy] = unitXY(u);
    if (Math.abs(ux) > maxC) maxC = Math.abs(ux);
    if (Math.abs(uy) > maxC) maxC = Math.abs(uy);
  }

  // side 0 = own, side 1 = enemy; per side: mean pool then max pool.
  const mean = [new Float64Array(UNIT_DIMS), new Float64Array(UNIT_DIMS)];
  const max = [new Float64Array(UNIT_DIMS).fill(-1e9), new Float64Array(UNIT_DIMS).fill(-1e9)];
  const counts = [0, 0];
  const feat = new Float64Array(UNIT_DIMS);
  for (const u of units) {
    const side = u.ownerId === playerId ? 0 : 1;
    counts[side]++;
    const [ux, uy] = unitXY(u);
    feat.fill(0);
    feat[0] = 1;
    feat[1] = ux / maxC;
    feat[2] = uy / maxC;
    feat[3] = u.maxHp ? (u.hp ?? u.maxHp) / u.maxHp : (u.hp != null ? Math.min(1, u.hp / 100) : 1);
    feat[4] = 1; // alive (dead were filtered)
    feat[5 + typeBucket(u.type)] = 1;
    const m = mean[side], M = max[side];
    for (let i = 0; i < UNIT_DIMS; i++) {
      m[i] += feat[i];
      if (feat[i] > M[i]) M[i] = feat[i];
    }
  }
  let o = 0;
  for (let side = 0; side < 2; side++) {
    const n = counts[side] || 1;
    for (let i = 0; i < UNIT_DIMS; i++) x[o++] = mean[side][i] / n;
    for (let i = 0; i < UNIT_DIMS; i++) x[o++] = counts[side] ? max[side][i] : 0;
  }
  // globals (4)
  x[o++] = Math.min(1, (state.turnNumber ?? 0) / 200);
  x[o++] = Math.min(1, counts[0] / 16);
  x[o++] = Math.min(1, counts[1] / 16);
  x[o++] = counts[0] / (counts[0] + counts[1] || 1);
  // per-game extras, padded/truncated to 8
  if (typeof game?.encodeExtras === 'function') {
    let extras = [];
    try { extras = game.encodeExtras(state, playerId) ?? []; } catch { /* defensive */ }
    for (let i = 0; i < 8; i++) x[o + i] = Number(extras[i]) || 0;
  }
  return x;
}

/** The other player's id (2-player scope; first non-me player). */
export function opponentOf(state, playerId) {
  return (state.players ?? []).find(p => p.id !== playerId)?.id ?? null;
}
