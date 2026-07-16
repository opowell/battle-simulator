// ---------------------------------------------------------------------------
// Strategy purification — Obscuro's move selection (Zhang & Sandholm 2026,
// §3.5 / App. C.8, Fig. 8 lines 13–21).
//
// Instead of sampling directly from the PCFR+ last-iterate strategy, Obscuro
// *purifies*: it limits randomness to a few "stable" actions, and only allows
// mixing at all when the position is safe. This damps the transient fluctuations
// PCFR+ produces during solving from leaking into the actual move played, while
// still preserving the deliberate mixed/bluffing play that fog demands.
//
// Rules (from the paper):
//   • Always keep the top action a*.
//   • Mixing (support > 1) is allowed only when `safe` (Maxmargin regime — all
//     margins ≥ 0). Under Resolve (unsafe / novel danger) play a* purely.
//   • Among the rest, keep only "stable" actions: those continuously in the
//     support of the last-iterate strategy since the half-time iteration T½.
//   • Cap the support at MaxSupport (= 3), then shift all excluded probability
//     mass onto a* and sample from what remains.
// ---------------------------------------------------------------------------

const MAX_SUPPORT = 3;

/**
 * @param {number[]} dist        last-iterate probability over `actions`
 * @param {Action[]} actions     candidate actions (rows), aligned to `dist`
 * @param {object} [opts]
 *   maxSupport  cap on the mixed support (default 3)
 *   rng         () => number in [0,1)
 *   safe        whether mixing is allowed (Maxmargin regime); default: allow
 *   infoset     the root Infoset — used to read per-action "stable since T½"
 *               flags when available; falls back to a probability threshold.
 * @returns {{ action: Action, dist: number[] }} the sampled action and the
 *   *played* (purified) distribution over `actions` — one-hot when the play is
 *   pure, otherwise the normalised mass over the kept support.
 */
export function purify(dist, actions, opts = {}) {
  const rng = opts.rng ?? Math.random;
  const maxSupport = Math.max(1, opts.maxSupport ?? MAX_SUPPORT);
  const safe = opts.safe !== false; // default: mixing allowed unless told unsafe
  const I = opts.infoset;

  const played = new Array(actions.length).fill(0);
  const ranked = actions
    .map((a, i) => ({ a, i, p: dist[i] ?? 0 }))
    .sort((x, y) => y.p - x.p);
  if (ranked.length === 0) return { action: null, dist: played };
  const top = ranked[0];
  const pure = () => { played[top.i] = 1; return { action: top.a, dist: played }; };

  // Resolve regime (unsafe / perfect information) → a* pure. (An earlier
  // version also forced pure play whenever a* held ≥0.9 mass — a shortcut the
  // paper doesn't have; App. C.8 allows mixing among stable actions whenever
  // the position is safe, however lopsided the mass.)
  if (!safe) return pure();

  // Keep a* plus the stable, non-negligible runners-up, capped at maxSupport.
  const stable = (idx) => (I?.stableSince != null ? I.stableSince[idx] : true);
  const kept = [top];
  for (let r = 1; r < ranked.length && kept.length < maxSupport; r++) {
    const cand = ranked[r];
    if (cand.p > 1e-3 && stable(cand.i)) kept.push(cand);
  }
  if (kept.length === 1) return pure();

  // The played distribution: every kept action retains its own probability and
  // ALL excluded mass is shifted onto a* (paper Fig. 8 lines 18–20) — not
  // renormalised across the support, which would over-play the runners-up.
  let totAll = 0; for (const r of ranked) totAll += r.p;
  if (totAll <= 0) return pure();
  let keptMass = 0; for (const k of kept) keptMass += k.p;
  for (const k of kept) played[k.i] = k.p / totAll;
  played[top.i] += (totAll - keptMass) / totAll;

  let pick = rng();
  let action = top.a;
  for (const k of kept) { pick -= played[k.i]; if (pick <= 0) { action = k.a; break; } }
  return { action, dist: played };
}
