# Obscuro belief: a move prior, so the posterior over P stops being flat — plan doc

Standalone working doc. Written 2026-07-30. Safe to read cold in a new session.
Companion to [OBSCURO-UNLIMITED-BELIEF-PLAN.md](OBSCURO-UNLIMITED-BELIEF-PLAN.md)
(the batched belief walk), [OBSCURO-ANALYSIS-DEPTH-PLAN.md](OBSCURO-ANALYSIS-DEPTH-PLAN.md)
(the depth ladder over that walk), and [FOG-AI-FIX-PLAN.md](FOG-AI-FIX-PLAN.md)
(search-side king safety — already fixed, unrelated).

## Status: NOT STARTED

## The ask

Today the belief set `P` is exactly that — a **set**. Every position in it is
equally consistent with everything observed, so the posterior over it is
**uniform**, and "which board is the real one?" has no answer beyond `1/|P|`.

That is not because the information isn't there. It's because the model throws it
away: it assumes nothing whatsoever about *how the opponent chooses moves*. Real
opponents don't play uniformly at random from their fog-legal move list — they
capture the free queen, they develop, they don't shuffle their king into the
open. Weighting the ply advance by a **move prior** π(move | position) makes the
posterior genuinely non-uniform, and then:

- "The most likely board" becomes a real question with a real answer, replacing
  the marginal-agreement surrogate the analysis panel currently shows (see
  `ExactBelief.rankByPlausibility`, [exactBelief.js:619](exactBelief.js#L619)).
- The AI's search samples worlds that matter more often
  (`samplePositions`, [exactBelief.js:551](exactBelief.js#L551) →
  `ChessGame.sampleWorlds`, [ChessGame.js:518](ChessGame.js#L518)), instead of
  spending equal effort on a world where the opponent played `g2-g4??` and one
  where they played the only good move.
- The `CAP` cliff gets a better failure mode than "give up": prune the tail of
  the distribution instead of abandoning exactness
  ([exactBelief.js:452](exactBelief.js#L452)). **Optional and dangerous — see
  step 6.**

## Where the flatness actually lives

One line. `_advanceOpponent` ([exactBelief.js:427](exactBelief.js#L427)) expands
every position by every fog-legal opponent move and **deduplicates by dropping
collisions**:

```js
const h = hashPos(np);
if (seen.has(h)) continue;      // ← here
seen.add(h);
next.push(np);
```

Two different histories that arrive at the same position are the same set member,
so the second is discarded and carries no extra weight. That is correct for a set
and wrong for a distribution: the paper's own framing (P is a set of STATES, not
histories — fn. 21) means colliding histories should have their probabilities
**summed**. `commitOurMove` ([exactBelief.js:401](exactBelief.js#L401)) has the
identical dedupe and needs the identical treatment (our own move is known, so its
weights just carry through, but distinct parents can still collide).

## The key insight: two separable changes, and the first is free

Do not conflate these. They land independently and the first is worth having on
its own:

1. **The mechanism** — carry a weight per position; sum on collision; normalize.
   With a *uniform* π (`1/|moves(p)|`) this **already** yields a non-uniform
   distribution over states, for two reasons: a state reachable from several
   parents accumulates their mass, and a parent with fewer legal moves passes
   more mass to each child. No heuristic, no tuning, no new knowledge — purely
   fixing "set" into "distribution". Ship and measure this alone first.

2. **The model** — replace uniform π with a real prior (captures, promotions,
   development, checks). This is where the tuning risk lives.

Also note what the filtering already is: successors that fail `consistent(...)`
are pruned, which removes mass; renormalizing afterwards **is** the Bayesian
update. Observation as evidence, for free — it just needs the weights to exist.

## Hard constraint: the prior must be O(1) per move on the typed representation

Sizing: |P| averages ~17k and fog branching is ~30, so a sweep expands ~500k
successors, inside `TIME_GUARD_MS = 4000` ([exactBelief.js:43](exactBelief.js#L43)).

So the obvious "just score it with the static evaluator" is out.
`evaluate(board, aiColor)` ([ChessAgent.js:169](ChessAgent.js#L169)) takes an
**object board** and walks all 64 squares; calling it per successor would mean
~500k `toBoardObject` conversions plus ~500k full evaluations per turn. Nowhere
near the budget.

The prior must instead be computed **incrementally from the move itself**, on the
`Int8Array(66)` representation, in constant time. Everything needed is already in
the move record `{ f, t, promo, dbl, ep, castle }` from `genFogMoves`
([exactBelief.js:197](exactBelief.js#L197)) plus one array read for the captured
piece (`pos[m.t]`):

- **capture value** — `pos[m.t]`'s piece value (the dominant term; real players
  take material)
- **promotion** — `m.promo`'s value
- **piece-square delta** — a small table indexed by `[pieceType][square]`,
  scored as `PST[t][m.t] - PST[t][m.f]` (captures development/centralisation)
- optionally **gives check** — needs an attack test against our king square,
  which is *not* O(1); measure before including it

Then π(m|p) = softmax over that position's own move list at temperature τ.
**Normalize per parent** (Σ_m π(m|p) = 1) or mass is not conserved and
high-branching positions get systematically inflated.

## Plan

### 1. Weights on the set — `games/chess/exactBelief.js`

- Add `this.weights` (a `Float64Array` parallel to `this.positions`), maintained
  by every method that rebuilds `positions`. Store **log**-weights if underflow
  shows up in testing over long games; start with linear + renormalize each
  sweep, which is simpler and probably sufficient since renormalizing every ply
  keeps the scale pinned.
- `_advanceOpponent` ([exactBelief.js:427](exactBelief.js#L427)): replace
  `seen: Set<hash>` with `seen: Map<hash, index>`; on collision **add** to
  `next`'s weight at that index instead of `continue`. Multiply the parent's
  weight by π(m|parent). Renormalize at the end of the sweep.
- `commitOurMove` ([exactBelief.js:401](exactBelief.js#L401)): same
  Set→Map+accumulate change. No π (our move is known, probability 1).
- `beginTurn` ([exactBelief.js:375](exactBelief.js#L375)): the initial
  `positions = [initialPosition()]` gets weight 1. The `aiColor === 'black'`
  first-turn branch already calls `_advanceOpponent`, so it is covered.
- `tryReacquire` ([exactBelief.js:468](exactBelief.js#L468)): a re-acquired set
  is a superset built from per-piece possible-squares with **no history
  information**, so give it uniform weights. It is already flagged `approx`
  ([exactBelief.js:543](exactBelief.js#L543)) and the panel already warns on
  that flag — keep that warning meaning "these numbers are not a posterior".
- `_giveUp` ([exactBelief.js:367](exactBelief.js#L367)): null the weights too.

Keep π behind a single injectable function so step 2 is a swap, and so the
uniform baseline stays testable:

```js
// π(m | pos), UNNORMALIZED; _advanceOpponent normalizes per parent.
// () => 1 reproduces "uniform over this position's moves".
movePrior(pos, m, oppSign) -> number
```

### 2. A real prior — new `games/chess/movePrior.js`

Keep it in its own module with its own tests; it is a model, not plumbing.

- Export `makeMovePrior({ temperature, captureWeight, pstWeight })` returning the
  O(1) scorer above, plus a `UNIFORM_PRIOR` for the baseline.
- Piece-square tables: check whether `ChessAgent.js`'s `pieceScore`/`pawnStructure`
  already carry usable tables before writing new ones.
- **Read the scar tissue in [belief.js](belief.js) first.** Its header comments
  ([belief.js:42-56](belief.js#L42-L56)) record two separate incidents where an
  over-sharp belief prior made the AI *worse*: `THREAT_BIAS = 3` is deliberately
  modest and `MAX_LURKERS = 2` exists because over-weighting phantom attackers
  "hallucinates coordinated mating attacks and the AI huddles instead of saving
  real material". A confident wrong belief is worse than an honest vague one.
  Start with a high temperature (near-uniform) and sharpen only as the
  calibration numbers in step 5 justify it.

### 3. Weighted consumers — `exactBelief.js`, `ChessGame.js`

- `samplePositions` ([exactBelief.js:551](exactBelief.js#L551)): uniform-without-
  replacement → **weighted** sampling. This is the one that changes how the AI
  plays (via `ChessGame.sampleWorlds`, [ChessGame.js:518](ChessGame.js#L518)), so
  it is the one that needs the strength measurement in step 5.
- `positionsAt` ([exactBelief.js:574](exactBelief.js#L574)): return each pick's
  weight alongside `{ board, cr, ep }` so enumerating callers can weight their
  aggregates.
- `rankByPlausibility` ([exactBelief.js:619](exactBelief.js#L619)): this whole
  function is the workaround for not having weights — it ranks by
  product-of-per-square-marginals because a flat posterior gave it nothing else.
  With real weights it collapses to "sort by weight". **Rename to
  `rankByLikelihood`** and keep the returned shape (`{ total, top, probs, approx }`)
  so `ChessGame.rankBeliefWorlds` ([ChessGame.js:621](ChessGame.js#L621)) and the
  panel payload need no change. Delete the marginal machinery and its `_rankCache`.
- `ChessGame.beliefPopulation` ([ChessGame.js:567](ChessGame.js#L567)): unchanged
  contract; the `!fogOfWar` size-1 case stays weight 1.

### 4. The analysis walk's aggregates — `games/chess/ObscuroAgent.js`

`analyzeObscuroProgressive` currently forms **count**-weighted means over worlds.
Every one becomes **mass**-weighted, or the panel's eval is an average over the
wrong measure:

- `cpSumsOverWorlds` ([ObscuroAgent.js:486](ObscuroAgent.js#L486)) returns
  `{ sums, n }` and the caller forms `Σsums / Σn`
  ([ObscuroAgent.js:772-779](ObscuroAgent.js#L772-L779)). Change to
  `{ sums, wsum }` where each world contributes `w · cp` and `wsum` accumulates
  `w`. The mean is then `Σ(w·cp) / Σw` — still exact when the walk is exhaustive,
  still an unbiased running estimate when partial.
- The CFR mixing ensemble ([ObscuroAgent.js:750](ObscuroAgent.js#L750)) weights
  each batch's equilibrium by batch **size** (`probW += w` where `w =
  worlds.length`). Weight by batch **mass** instead.
- `shuffledIndices` ([ObscuroAgent.js:515](ObscuroAgent.js#L515)): a uniform
  random walk order still gives an unbiased weighted mean, so this is optional —
  but switching to **descending weight** order makes partial results converge far
  faster (most of the mass lands in the first batches) and makes the panel's
  "top N most likely boards" fall out of the walk for free. Trade-off: partial
  coverage is then deliberately biased toward heavy worlds, which is what you
  want for an estimate but must not be described as a uniform sample.
- `settledWorlds` / `scoredWorlds` caps
  ([ObscuroAgent.js:625-626](ObscuroAgent.js#L625-L626)): with weight ordering,
  the retained worlds should be the heaviest rather than the first-seen.

### 5. Measurement — this is the deliverable, not an afterthought

**Calibration (does the belief actually get better?).** The rig already exists:
`replayWithTracker` in [exact-belief.test.js:30](exact-belief.test.js#L30) walks
recorded games, calls `beginTurn`, and locates the true position in P at every one
of the seat's turns. Extend it to also record, for the true position:

- its **weight rank** within P (1 = the belief's top pick), and
- **−log w** (log-loss), the honest scalar for "how much probability did we put
  on reality".

Then compare, over `sessions/*.json` (two games are cited in the existing tests;
use every chess fog recording available): uniform-set baseline (rank is
meaningless, log-loss = log|P|) vs. step 1's uniform-π weights vs. step 2's prior
at a few temperatures. **Gate: step 2 must beat step 1 on mean log-loss, and step
1 must beat log|P|.** If a prior can't beat uniform-π on recorded human/AI games,
it is not a better model and should not ship no matter how reasonable it looks.

**Strength (does the AI play better?).** `ChessObscuroAgent` with the prior vs.
without. Per [memory: civ1 seat-1 bias], agent comparisons in this repo **must use
seat-swapped pairs** — run each pairing as white and as black or the result is
noise about seat advantage.

**Cost.** Per-turn `beginTurn` wall time against `TIME_GUARD_MS = 4000`, and |P|
growth over a game. The Map-instead-of-Set change alone is close to free; the risk
is π's constant factor across ~500k successors.

### 6. OPTIONAL, and read the warning — weighted tail pruning at `CAP`

Today exceeding `CAP = 200000` calls `_giveUp()`
([exactBelief.js:452](exactBelief.js#L452)) and drops to the heuristic sampler.
With weights there is a tempting alternative: keep the heaviest positions covering
~99.9% of mass and carry on.

**This breaks the project's central belief invariant.** The tests at
[exact-belief.test.js:52](exact-belief.test.js#L52) assert *the true position is
always in P*, replaying real games — that is the do-not-regress guard for this
whole subsystem, and weighted pruning can legitimately discard the true position
whenever the opponent played something the prior thought unlikely. Which is
exactly when you most need it.

If attempted: put it behind a default-**off** flag, track a `truncated` flag
distinct from `approx` (`approx` = superset, `truncated` = subset — opposite
directions, and a subset is the more dangerous kind), and update the invariant
test to assert "true position in P **or** the set was truncated" while reporting
how often the escape hatch fires. If it fires often, the prior is bad.

## Explicitly out of scope

- **Recursive belief.** Modelling the opponent as a good player invites modelling
  them modelling us, and so on. Stop at level 1: they are a fixed static-eval
  softmax player. Do not start down the recursive road here.
- **The fog asymmetry in the prior.** π conditions on the full position `p`, but
  the opponent chose their move under *their own* fog and could not see `p`. A
  principled prior would score from their information set, which is another belief
  computation per node — hopeless at this budget. [belief.js](belief.js) makes the
  same approximation; note it in a comment and move on.
- **Joint-equilibrium mixing** (Design A in
  [OBSCURO-UNLIMITED-BELIEF-PLAN.md](OBSCURO-UNLIMITED-BELIEF-PLAN.md)) — still
  open, still unrelated.

## Comments and docs that become WRONG and must be updated

The "posterior over P is uniform" reasoning is currently written down as settled
fact in several places, because it was. Fix all of them or the next reader will be
misled in the opposite direction:

- `ExactBelief.rankByPlausibility`'s doc comment
  ([exactBelief.js:585-618](exactBelief.js#L585-L618)) — a long explanation of why the
  posterior is flat and why the marginal surrogate is the best available. Replaced
  wholesale by step 3.
- [BeliefWorldStepper.vue](../../apps/design/battlefield/BeliefWorldStepper.vue)'s
  header comment and the `label` computed — it deliberately says "plausibility",
  not "probability", and explains why. With a real posterior the honest word
  becomes "likely"/"probability"; update both the comment and the user-facing
  string.
- `ChessGame.rankBeliefWorlds`'s comment ([ChessGame.js:613](ChessGame.js#L613)).
- The memory note `fog-belief-world-overlay.md`, whose whole "design decision
  worth remembering" section is the uniform-posterior rationale.

## Verification checklist

- `node --test games/chess/*.test.js` — all of it, not just the new tests. The
  belief invariant replays and the fog-blunder regressions
  ([fog-blunders.test.js](fog-blunders.test.js)) are the guards that matter here.
  **Note:** those replay tests read `sessions/`, which lives at the repo root and
  is untracked — a fresh worktree does not have it. Symlink it or they fail with
  ENOENT and look like a regression.
- New unit tests: weights sum to 1 after every operation; colliding histories sum
  rather than drop (construct a small position with two move orders reaching one
  successor); uniform π reproduces today's *set* exactly (same members) while
  producing non-uniform weights.
- The calibration and seat-swapped strength numbers from step 5, written into this
  doc's status section as the record of whether it worked.
- Manual: fog game in the design app, analysis panel on, step the belief-world
  stepper — the percentages should now be a real posterior, spread much more
  unevenly than the near-flat 5.2%/4.9% the marginal surrogate produces, and the
  top board should be a position the opponent plausibly played into.
- Per repo root [CLAUDE.md](../../CLAUDE.md): do this in its own git worktree, and
  rebase onto **local** `main` first — `EnterWorktree` branches from `origin/main`,
  which this repo does not push to, so a new worktree starts stale.
