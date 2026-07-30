# Obscuro belief: a move prior, so the posterior over P stops being flat — plan doc

Standalone working doc. Written 2026-07-30. Safe to read cold in a new session.
Companion to [OBSCURO-UNLIMITED-BELIEF-PLAN.md](OBSCURO-UNLIMITED-BELIEF-PLAN.md)
(the batched belief walk), [OBSCURO-ANALYSIS-DEPTH-PLAN.md](OBSCURO-ANALYSIS-DEPTH-PLAN.md)
(the depth ladder over that walk), and [FOG-AI-FIX-PLAN.md](FOG-AI-FIX-PLAN.md)
(search-side king safety — already fixed, unrelated).

## Status: LANDED 2026-07-30 — steps 1–5 shipped, step 6 deliberately NOT

Both gates passed. Production default is **τ = 200**, set in
[exactBelief.js](exactBelief.js)'s `defaultPrior`.

### Calibration — the deliverable

Mean log-loss of the TRUE position over **30 recorded chess fog games, both seats,
1028 turns** (`node games/chess/calibrate-belief.mjs`). Δ is nats better than a
flat posterior over the same set (`log|P|` = 5.107); higher is better.

| π | log-loss | Δ vs flat | med. rank | top-1 |
|---|---|---|---|---|
| flat posterior (before this work) | 5.107 | 0 | — | — |
| uniform π (step 1, mechanism only) | 5.056 | **+0.051** | 38 | 23.4% |
| τ=800 | 5.020 | +0.088 | 36 | 17.2% |
| τ=400 | 4.984 | +0.124 | 32 | 17.4% |
| τ=300 | 4.960 | +0.147 | 31 | 17.8% |
| **τ=200 (shipped)** | **4.919** | **+0.188** | 28 | 18.3% |
| τ=150 (optimum) | 4.895 | +0.212 | 24 | 18.9% |
| τ=100 | 4.909 | +0.198 | 22 | 19.9% |
| τ=60 | 5.195 | **−0.088** | 20 | 21.3% |
| τ=35 | 6.142 | **−1.035** | 18 | 22.5% |
| τ=20 | 8.564 | **−3.457** | 19 | 22.8% |

- **Gate 1 (step 1 beats log|P|): passed, but only just** — +0.051 nats. The
  mechanism alone is real and worth having, and it is nearly free, but it is not
  where the value is. Anyone expecting the "first change is free" framing to
  deliver most of the win should read this row again.
- **Gate 2 (step 2 beats step 1): passed clearly** — +0.188 vs +0.051, ~3.7×.
- **The ablations say the signal is NOT mostly captures.** At τ=300,
  capture-term-only scores +0.058 (barely above uniform π) while
  PST-term-only scores +0.145 — i.e. essentially the whole gain. The plan called
  capture value "the dominant term"; **that was wrong**. Plausible reading: our
  opponents' captures are mostly already visible (a capture on a square we can see
  is pruned by the observation filter anyway), so the capture term re-prices
  what we already knew, while the PST delta discriminates among the genuinely
  hidden quiet moves. Worth a real look before adding more material terms.
- **Over-sharpening is catastrophic, and the cliff is close.** By τ=60 the belief
  is already worse than assuming nothing; by τ=20, 3.5 nats worse. Note that
  median RANK keeps *improving* right through the collapse (24 → 18): the ordering
  sharpens while the probabilities go wild. That is why log-loss is the gate here
  and rank is not — and it is the third instance of the failure mode
  [belief.js](belief.js)'s header already records twice. τ=200 was chosen over the
  τ=150 optimum on purpose: it gives up ~10% of the available Δ for a 3.3×
  margin to the cliff instead of 2.5×.
- **Invariant held everywhere**: `notInP = 0` across all 1028 turns × every prior.
  Give-ups (16 of 60 seat-replays) are identical under every prior, so the prior
  does not cause them.

### Cost

- Per-turn `beginTurn` worst case **~1.0 s on an idle machine** against
  `TIME_GUARD_MS = 4000` — the same before and after, since π is O(1) per move and
  the sweep was always dominated by `consistent()`. **But it is wall-clock against a
  wall-clock guard: the same replay under heavy concurrent load measured 2.7 s.**
  Still inside the budget, with less margin than the idle number suggests, and the
  consequence of blowing it is `_giveUp()` — the belief drops to the heuristic
  particle fallback for the rest of the game. Worth remembering before adding
  anything else to the per-successor path.
- Whole-harness wall time 25.0 s (uniform π) → 27.8 s (τ=200): **~11%** for the
  prior, and the Set→Map change is inside the noise.
- **No underflow.** Zero weights never occurred (`w=0` column) over 1028 turns of
  full games, so linear weights are sufficient and the log-weight contingency in
  step 1 is not needed. `_setWeights` still falls back to uniform on a zero total
  rather than propagating NaN.

### Strength — NO DETECTABLE EFFECT, and the harness cannot currently detect one

`node games/chess/strength-belief.mjs --arm {null,prior} --pairs N --max-turns 70`,
ChessObscuroAgent vs itself under fog, seat-swapped pairs, `difficulty: 'easy'`:

| arm | result | games |
|---|---|---|
| `null` (both seats identical — the CONTROL) | seat-A 5 – seat-B 7 | 12 |
| `prior` (τ=200 belief vs uniform-π belief) | prior 9 – uniform π 7 | 16 |
| `alpha` (same belief; draw ∝ posterior vs uniform) | **α=1 4 – α=0 11** (+1 draw) | 16 |

**The prior itself is a tie at 9–7** — it neither helped nor hurt measurably. Two
things make that the end of the story rather than the start of one:

- **White wins ~15 of every 16 games regardless of arm**, and the same in the `null`
  arm where the seats are identical. First-move advantage under fog dwarfs anything
  the belief contributes. The seat swap cancels it — which is the entire reason the
  numbers mean anything — but it also means a balanced pair contributes 1-1 and the
  residual signal lives only in the rare games the black seat wins. **This harness is
  far less sensitive than its game count suggests; a 16-game run resolves almost
  nothing.** Anyone wanting a real answer needs either many hundreds of games or a
  lower-variance measure than win/loss (per-move agreement with a deep reference
  search, or material swing over the fog phase).
- **The prior reaches play through exactly ONE channel** — which worlds
  `samplePositions` hands the search. A better-calibrated belief being
  strength-neutral there is entirely consistent, not paradoxical: the search draws
  ~16 worlds out of a set whose median true-position rank is ~28, so the draw is
  small relative to the uncertainty either way.

**The `alpha` arm is the one result that leans, and it leans AGAINST weighting the
search's draw.** `sampleAlpha` (`exactBelief.js`) controls that channel — draw ∝ w^α —
and two measurements disagree about it:

- **Sample coverage mildly favours α=1.** `calibrate-belief.mjs --sample-n 16` over
  558 turns × 24 trials: a 16-world draw contains the TRUE position 39.3% of the time
  at α=1 vs 36.1% at α=0. So weighting does not spend the sample inside a confident
  slice that excludes reality.
- **Play favours α=0**, 11–4 over 15 decisive games, and 3–0 on the informative
  subset (games the black seat won — the ones not swamped by white's advantage).

**Shipped α = 0.** Coverage is a proxy; win/loss is the target, and when they
disagree, follow the target and prefer the option that changes nothing: α=0 is
exactly the uniform world sampling the AI had before this work, so the new weights
cannot regress play. Every other consumer of the weights — calibration, the panel's
posterior, the mass-weighted aggregates — is independent of α and keeps the full
posterior. Raising α needs a higher-powered strength measurement, not an argument.

Note this is the *second* time on this change that the principled-sounding option
measured worse than doing nothing, the first being τ<60. Both are the belief.js
pattern: confidence is not free.

**Read this before quoting a strength number from this subsystem.** The first run of
this measurement returned a clean 0/16 against the prior and was completely
fictional — two harness bugs (`result.winner` where the field is `winnerId`, so every
decisive game was credited to one arm; and reuse of the exported *singleton* agent,
whose `_carry` search-tree map is never reset between games, making results
order-dependent). Both produced tidy sweeps, and a plausible causal story was
already written down for the first one before the `null` arm exposed it. The control
arm exists because of this; **run it, and disbelieve any lopsided result until it
comes back mixed.**

### What was NOT done

- **Step 6 (weighted tail pruning at `CAP`) was not attempted**, per its own
  warning. It trades the subsystem's central invariant for a better `CAP` failure
  mode, and the calibration above shows exactly why that trade is bad here: the
  worlds a prior wants to prune are the surprising ones, and the τ=60 row shows how
  confidently wrong a prior can be about which those are.
- **"Gives check"** stayed out of the prior. It is not O(1) on the typed
  representation, and given that the PST term (not material) is carrying the
  signal, there is no evidence it would pay for itself.

### Where it lives

- [movePrior.js](movePrior.js) — the model. `makeMovePrior({ temperature, … })`,
  `UNIFORM_PRIOR`, `scoreMove`. Tests: [move-prior.test.js](move-prior.test.js).
- [pieceTables.js](pieceTables.js) — NEW. `PIECE_VALUE` + `PST` extracted out of
  [ChessAgent.js](ChessAgent.js) so the prior can share the evaluator's tables
  without dragging its whole dependency chain into the belief's hot loop.
- [exactBelief.js](exactBelief.js) — `this.weights`, `_setWeights`, the Map-based
  accumulating dedupe in `_advanceOpponent`/`commitOurMove`, weighted
  `samplePositions` (Efraimidis–Spirakis), `rankByLikelihood` (**renamed** from
  `rankByPlausibility`; the marginal machinery and `_rankCache` are gone),
  `setDefaultMovePrior` / `setMovePriorForSeat`.
- [beliefCalibration.js](beliefCalibration.js) — the replay walk, shared by
  [exact-belief.test.js](exact-belief.test.js) (which asserts the invariant) and
  [calibrate-belief.mjs](calibrate-belief.mjs) (which reports the numbers).
- [strength-belief.mjs](strength-belief.mjs) — seat-swapped A/B match runner.
- [ChessGame.js](ChessGame.js) — `enumerateWorlds` now emits `beliefWeight` per
  world; `sampleWorlds` deliberately does NOT (the weight is already in the draw).
- [ObscuroAgent.js](ObscuroAgent.js) — `cpSumsOverWorlds` returns
  `{ sums, wsum, n }` and every aggregate is mass-weighted; the walk order is
  descending weight (`weightOrder`) instead of a shuffle.

**Everything below this line is the original pre-implementation plan, preserved as
written.** It still describes the design accurately, with two exceptions already
flagged inline: `rankByPlausibility` is now `rankByLikelihood`, and π's signature
is the per-parent batch form. Line references point at the pre-change file.

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

- **capture value** — `pos[m.t]`'s piece value. *(This was predicted to be "the
  dominant term; real players take material". The ablation in the status section
  above says otherwise: at τ=300 the capture term alone buys +0.058 nats and the
  PST term alone +0.145. Kept anyway — it costs one array read — but it is not
  where the signal is.)*
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
uniform baseline stays testable. **As built, the signature is the per-parent BATCH
form rather than the per-move one sketched here:**

```js
// Fills out[0..moves.length-1] with π(m | pos), NORMALIZED (Σ = 1).
movePrior(pos, moves, sign, out) -> void
```

Two reasons the batch form won: normalizing per parent is not optional (without it
high-branching positions hand out more total mass and mass is not conserved), and
owning the softmax lets the prior subtract the per-parent max, so `temperature` can
be small without overflowing. `out` is a scratch buffer reused across parents, so
the whole sweep allocates nothing per position.

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

## Comments and docs that become WRONG and must be updated — ALL DONE

The "posterior over P is uniform" reasoning is currently written down as settled
fact in several places, because it was. Fix all of them or the next reader will be
misled in the opposite direction. Each now explains that the posterior USED to be
flat and why, so the history is still readable:

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
  **NOT DONE — the one item left unverified.** Everything above is covered by
  automated tests and the harnesses; this is the only check that needs a browser.
  Worth doing before trusting the panel's numbers to a user, and note that a real
  posterior over a ~200k population is genuinely tiny per world, which is why the
  stepper now formats percentages with value-dependent precision rather than a
  fixed decimal (`fmtPct` in BeliefWorldStepper.vue) — "0.0%" everywhere would be a
  formatting bug, not a flat belief.
- Per repo root [CLAUDE.md](../../CLAUDE.md): do this in its own git worktree, and
  rebase onto **local** `main` first — `EnterWorktree` branches from `origin/main`,
  which this repo does not push to, so a new worktree starts stale.
