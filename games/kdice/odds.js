// Exact battle odds for KDice: the attacker throws one die per die on its stack,
// the defender likewise, and the attacker takes the territory only on a strictly
// higher total (a tie holds). Every question the AI asks about an attack — how
// likely is it to win, how likely is a neighbour to take this stack back — is a
// lookup in this table, so it is computed once, exactly, by convolving the sum
// distributions of n six-sided dice.

export const MAX_DICE = 8;

// sumDist[n][s] = P(n d6 sum to s), for n = 0..MAX_DICE.
const sumDist = [[1]];
for (let n = 1; n <= MAX_DICE; n++) {
  const prev = sumDist[n - 1];
  const next = new Array(prev.length + 6).fill(0);
  for (let s = 0; s < prev.length; s++) {
    if (!prev[s]) continue;
    for (let f = 1; f <= 6; f++) next[s + f] += prev[s] / 6;
  }
  sumDist.push(next);
}

// WIN[a][d] = P(a attacking dice beat d defending dice), a, d in 0..MAX_DICE.
const WIN = Array.from({ length: MAX_DICE + 1 }, () => new Array(MAX_DICE + 1).fill(0));
for (let a = 1; a <= MAX_DICE; a++) {
  for (let d = 1; d <= MAX_DICE; d++) {
    const A = sumDist[a], D = sumDist[d];
    // P(A > D) = sum over defender totals t of P(D = t) * P(A > t).
    const tail = new Array(A.length + 1).fill(0); // tail[t] = P(A >= t)
    for (let s = A.length - 1; s >= 0; s--) tail[s] = tail[s + 1] + A[s];
    let p = 0;
    for (let t = 0; t < D.length; t++) if (D[t]) p += D[t] * (tail[t + 1] ?? 0);
    WIN[a][d] = p;
  }
}

/** Probability that a stack of `attacker` dice takes a territory held by `defender` dice. */
export function winProbability(attacker, defender) {
  const a = Math.max(0, Math.min(MAX_DICE, attacker | 0));
  const d = Math.max(0, Math.min(MAX_DICE, defender | 0));
  if (a < 2) return 0;          // a single die cannot attack at all
  if (d === 0) return 1;
  return WIN[a][d];
}
