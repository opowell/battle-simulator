# Obscuro AI parameters

This is the reference for every tunable number in the Obscuro AI: the
game-agnostic equilibrium search (`agents/ObscuroAgent.js`, `agents/obscuro/`)
and the fog-chess specialisation that plugs Stockfish and a real belief
tracker into it (`games/chess/ObscuroAgent.js`, `belief.js`, `exactBelief.js`,
`movePrior.js`, `stockfish.js`).

**Where the numbers actually live.** Two modules aggregate every default by
re-exporting the named constant each file already declares, so this document
and the code can't drift apart silently:

- [`agents/obscuro/settings.js`](obscuro/settings.js) — generic search defaults
- [`games/chess/obscuro-settings.js`](../games/chess/obscuro-settings.js) — fog-chess defaults

Both are read-only aggregates, not the source of truth for the *values* — each
constant is still defined next to the code it tunes, with the comment
explaining *why* that number and not another (several have "scar tissue"
history: a value that looked reasonable and measurably made play worse). If
you're changing a default, edit it at its declaration (linked below), not in
the aggregate.

---

## 1. Generic Obscuro search (any game)

Implements Zhang & Sandholm's *Obscuro* search: a growing extensive-form game
tree (`agents/obscuro/infoset.js`) with shared information sets, solved by
Predictive CFR+ played on the last iterate (`pcfr.js`), grown by one-sided
GT-CFR (`gtcfr.js`), made safe by the KLUSS Resolve/Maxmargin gadget
(`kluss.js`), with the move chosen by purification (`purify.js`) — all
orchestrated by `search.js`'s `runObscuroSearch`. `ObscuroAgent.js` is the
per-move entry point: it turns a single 0–100 **difficulty dial** (or a
per-move **time limit**) into every knob below.

### 1.1 The difficulty dial (`ObscuroAgent._config`, `DIAL` in `settings.js`)

There is one algorithm at every difficulty level — the dial only slides
continuous knobs (never branches behaviour). Each knob is evaluated at a dial
position `t ∈ [0,1]`:

- **POWER mode** (`gameSpecific.difficulty`, 0–100): `t = difficulty / 100`.
- **TIME mode** (`gameSpecific.aiTimeMs`, a per-move wall-clock limit up to
  600000 ms): `t = min(1, aiTimeMs / 60000)`. `aiTimeMs = 0` (POWER `difficulty
  = 0` too) means **random play** — the search is skipped entirely.

Two ramp shapes plug into `t`:

- **convex** (`rc(min, max, t) = round(min + (max-min) · t^1.5)`) — stays
  cheap through the low/mid dial, reaches `max` only at the very top. Used for
  the knobs that dominate cost.
- **linear** (`ri(min, max, t) = round(lerp(min, max, t))`) — used for the
  cheaper knobs.

| Parameter | POWER range | TIME range | Curve | Meaning |
|---|---|---|---|---|
| `worlds` | 1 – 48 | 4 – 48 (floor 2) | convex / linear | belief particles sampled and searched |
| `timeBudgetMs` | 30 – 2000 | *(= `aiTimeMs` directly)* | convex | wall-clock budget for the whole move |
| `maxRounds` | 6 – 100 | 100000 (constant) | convex | expand+solve rounds in the main loop |
| `maxInfosets` | 400 – 6000 | 1000 – 25000 | convex / linear | tree size cap (stops growth, not the solve) |
| `expandPerRound` | 6 – 24 | 24 (constant) | linear | GT-CFR expansion steps per round |
| `cfrPerRound` | 3 – 10 | 10 (constant) | linear | CFR iterations per round |
| `finalCfr` | 15 – 100 | 200 (constant) | convex | extra CFR iterations after the round loop, so the equilibrium settles on the frozen tree |
| `purifyMax` | 3 (constant) | 3 (constant) | — | move-selection mixed-support cap |
| `moveRings` | 1 – 3 | 1 – 3 | linear | continuous-action resolution (rings), games with `getSearchActions` only |
| `moveSpokes` | 4 – 12 | 6 – 12 | linear | continuous-action resolution (spokes) |

All of the above (including the `1.5` convex exponent) live in
`DIAL`/`DIAL_CONVEX_EXPONENT` in [`settings.js`](obscuro/settings.js); the
ramp math itself (`rc`/`ri`) stays in `ObscuroAgent.js` next to `_config`. Any
field can be overridden per-instance via the agent constructor's `opts`
(`new ObscuroAgent(game, { particles: 32, timeBudgetMs: 500, ... })`), which
also lets a caller bypass the dial for tests.

### 1.2 `runObscuroSearch` fallback defaults (`SEARCH_DEFAULTS`, `agents/obscuro/search.js`)

Used when a caller invokes the search directly instead of through
`ObscuroAgent` (e.g. `ChessObscuroAgent.obscuroStrategy`, or a test) and
doesn't supply every field explicitly.

| Parameter | Default | Meaning |
|---|---|---|
| `win` | `1e6` | terminal win/loss magnitude, used when a game declares no `winValue` (fog chess overrides this — see §2.1's `SEARCH_WIN`) |
| `expandPerRound` | 8 | |
| `cfrPerRound` | 4 | |
| `maxRounds` | 200 | |
| `finalCfr` | 40 | |
| `finalCfrDeadlineFactor` | 1.35 | the final solve may run this × the round-loop budget past it, so a large tree's equilibrium can settle |
| `finalCfrChunkCap` | 10 | CFR iterations run per deadline check during the final solve |
| `stableSnapshotEps` | 1e-3 | "stable since T½" purification window — an action must hold ≥ this mass in every last-iterate snapshot since half the rounds |
| `safePmaxThreshold` | 0.05 | mixing (vs. pure top-move play) is allowed only when the KLUSS gadget's `pmax` (opponent's incentive to enter Resolve) is below this |
| `carriedRootWidthFloor` | 16 | minimum root width kept when grafting carried worlds from the previous move's tree, even with few fresh belief worlds |

### 1.3 Tree growth (`agents/obscuro/gtcfr.js`)

| Parameter | Default | Meaning |
|---|---|---|
| `MIN_EXPANDED_ROOT_WORLDS` | 8 | `expandRoot` guarantees at least this many root worlds get expanded even past the wall-clock deadline, so a cold engine cache can't silently degrade the search to a near-single-world one |

### 1.4 Safety gadget (`agents/obscuro/kluss.js`)

| Parameter | Default | Meaning |
|---|---|---|
| `RESOLVE_PRIOR_UNIFORM_BLEND` | 0.5 | blend between the blueprint opponent distribution and uniform when building the Resolve prior `α(J)`: `α(J) = BLEND·(y/Σy) + (1-BLEND)/m` |

### 1.5 Move selection / purification (`agents/obscuro/purify.js`)

| Parameter | Default | Meaning |
|---|---|---|
| `MAX_SUPPORT` | 3 | cap on the mixed support after purification (same as `purifyMax` in the dial) |
| `MIN_SUPPORT_PROB` | 1e-3 | a runner-up must clear this probability floor to be considered at all |

---

## 2. Fog-chess specifics (`games/chess/`)

Chess adds exactly two things on top of the generic search (see the header of
`games/chess/ObscuroAgent.js`): a **Stockfish leaf evaluator**, and the
**perfect-information shortcut** (nothing hidden ⇒ play Stockfish directly,
skip the fog subgame). Everything else — belief sampling, difficulty scaling,
move selection — is inherited from §1.

### 2.1 Terminal values and clamps (`games/chess/ObscuroAgent.js`)

| Parameter | Default | Meaning |
|---|---|---|
| `LEAF_CLAMP` | 1500 (cp) | material/eval scores are clamped to this so an imagined king capture from phantom hidden pieces can't swamp a real material decision |
| `SEARCH_WIN` | 8000 (cp) | the search's terminal win/loss magnitude — chess's override of the generic `1e6`, deliberately bounded (~5.3× `LEAF_CLAMP`) because fog terminal values are *averaged* across belief worlds; unbounded win lets one phantom world dominate |
| `MAX_SF_DEPTH` | 30 | ceiling of the iterative-deepening ladder (a ceiling to climb toward, not a depth usually reached — see `makeIterativeChessLeafEval`) |

`KING_HANG` (= `SEARCH_WIN`) is the value assigned when a move leaves the
mover's own king capturable — deliberately asymmetric with the `+LEAF_CLAMP`
cap on *capturing the enemy* king at a leaf (see the file's own comment: an
imagined capture is phantom-prone, but exposing our own king is a real,
self-inflicted loss).

### 2.2 The chess difficulty dial (`CHESS_DIAL`, `games/chess/ObscuroAgent.js`)

Layered on top of §1.1 — same `t`, chess's own leaf-eval and sampling knobs.

**`_leafEval` (POWER mode)** — one fixed Stockfish depth/breadth for every
node in the tree:

| Field | Range | Formula |
|---|---|---|
| `leafEval.sfDepth` | 2 – 4 | `round(2 + t·2)` — **measured, not guessed**: `move-quality.mjs --grid` found depth 7 is *dominated* (it buys tactical leaves at the cost of tree size, and the tree was worth more at this search's scale, ~100× smaller than the paper's). Revisit only after the tree grows by an order of magnitude. |
| `leafEval.cols` | 5 – 14 | `round(5 + t·9)` — MultiPV lines requested per node |

**`_leafEval` (TIME mode)** — full breadth always, iterative deepening bounded
by a per-call slice of the move budget:

| Field | Default | Meaning |
|---|---|---|
| `timeModeEvalsPerWorldReserve` | 8 | root expansion (one eval per belief world, before the round loop starts) is budgeted `timeMs / (worlds × 8)` per call — an eighth of the budget, leaving the rest for tree growth |
| `timeModeMinPerCallMs` | 30 | floor on the per-call slice above |

**`_proportionalPick`** (perfect information, POWER mode: score every legal
move at full Stockfish strength, then sample proportional to win probability
sharpened by `β`):

| Field | Range/Value | Formula |
|---|---|---|
| `proportionalPick.multipvCap` | 20 | `min(legalActions.length, 20)` |
| `proportionalPick.depth` | 10 – 16 | `round(10 + t·6)` |
| `proportionalPick.betaAtHalf` | 1 | `β` at `t = 0.5` — probability exactly ∝ win-probability |
| `proportionalPick.betaMax` | 12 | `β` at `t = 1` — collapses toward near-best play (t ≥ 0.999 is exactly pure Stockfish) |

Two more full-strength constants live inline (not dial-scaled, so not in
`CHESS_DIAL`): `chooseAction`'s perfect-info **TIME mode** plays
`stockfishBestAction` with `skill: 20` (no handicap) and `movetime` clamped to
`[1, 600000]`; `_captureStockfishAnalysis` (analysis-only, doesn't affect play)
always asks for `multipv: 8, depth: 12`.

### 2.3 Analysis-panel search sizes (`ANALYSIS_DEFAULTS`, `games/chess/ObscuroAgent.js`)

`obscuroStrategy` (the inspection helper used by tests and the analysis panel)
and `analyzeObscuroProgressive` (the panel's belief-population walk) have
their own search-size defaults, independent of a real move's difficulty
setting:

| Parameter | Default | Meaning |
|---|---|---|
| `strategy.particles` | 8 | belief worlds sampled when the caller doesn't supply `opts.worlds` |
| `strategy.maxRounds` / `.expandPerRound` / `.cfrPerRound` / `.purifyMax` | 30 / 8 / 4 / 3 | `obscuroStrategy`'s own search-size fallback |
| `batchMixing.maxRounds` / `.expandPerRound` / `.cfrPerRound` | 100 / 16 / 8 | the mixing solve run once per batch inside the progressive walk — bigger than `strategy`'s defaults since it only runs once per batch, not once per candidate |
| `maxTotalMs` | 5 min | safety net for a missed disconnect, **not** a quality cap |
| `batchSize` | 16 | belief worlds enumerated/sampled per batch |
| `sweepBatches` | 4 | generative-fallback only: batches per ladder rung before climbing depth |
| `likelyWorldsCap` | 32 | size of the "most likely boards" overlay |
| `scoredWorldsCap` | 96 | cap on the per-world cp view |

### 2.4 Belief tracking

Two trackers, always kept in lockstep (`ChessGame.sampleWorlds`): the **exact**
position-set tracker `P` (`exactBelief.js`) is preferred and, while it holds,
*is* the paper's belief; the **heuristic particle** tracker (`belief.js`) is
the fallback once exactness is lost (P outgrew its cap, a time guard tripped,
or the tracker was attached mid-game).

**Exact belief (`games/chess/exactBelief.js`)**

| Parameter | Default | Meaning |
|---|---|---|
| `CAP` | 200,000 | max `\|P\|` before exactness is abandoned (paper: usually ≤ 10⁶ in C++; this tracker averages ~17k) |
| `TIME_GUARD_MS` | 4000 | per-turn update budget; exceeding it also abandons exactness |
| `REACQUIRE_BOUND` | 60,000 | max cross-product size `tryReacquire` will search when trying to rebuild a lost `P` from the heuristic belief |
| `SAMPLE_ALPHA_DEFAULT` | 0 | exponent applied to the posterior when *sampling* search worlds (`draw ∝ w^α`). **Ships at 0 (uniform over P), deliberately ignoring the posterior** — see the long comment on `setBeliefSampleAlpha`: α=1 measured *better* sample coverage (39.3% vs 36.1% chance of including the true position) but *worse* actual play (4–11 in seat-swapped self-play). When a proxy and the target disagree, this repo follows the target. |

**Heuristic particle belief (`games/chess/belief.js`)** — used once exact
tracking is lost:

| Parameter | Default | Meaning |
|---|---|---|
| `MAX_POSSIBLE` | 48 | cap on a single piece's possible-square set |
| `THREAT_BIAS` | 3 | how strongly to over-sample placements that attack our pieces. **Kept deliberately modest** — a past incident: over-weighting phantom attackers made the AI huddle instead of saving real material. |
| `MAX_LURKERS` | 2 | max invisible pieces per particle allowed to threaten our pieces at once — without this cap, threat-biased sampling hallucinates coordinated mating attacks |
| `RECAPTURE_TYPE_WEIGHT` | `{pawn:9, knight:3, bishop:3, rook:1.5, queen:1, king:0.5}` | relative likelihood a piece of each type made a forced (known) capture — recaptures strongly favour the least valuable capturer |
| `MAX_ATTEMPTS_PER_PARTICLE` | 6 | resample attempts per requested particle before giving up |
| `PHANTOM_CHECK_REJECT_WINDOW` | 4 (× n) | how long `sample()` keeps rejecting particles with a phantom self-check before accepting anything |

### 2.5 Move prior — π(move | position) (`games/chess/movePrior.js`)

The opponent model that turns the exact belief `P` from a set into a
distribution: a softmax over a cheap, O(1)-per-move score (capture value,
promotion value, piece-square-table delta, a castling bonus).

**`FITTED_WEIGHTS`** — the production model, **fitted by conditional-logit MLE
on 37 recorded fog games (`fit-move-prior.mjs --write`), not hand-tuned**:

| Field | Value | Note |
|---|---|---|
| `temperature` | 100 | fixes the unit only (logits per centipawn × 100) — sharpness now lives per-term in `pstWeight`, not in one global knob |
| `floor` | 0.03 | mixes in the uniform prior: `π = (1-floor)·softmax + floor/\|M\|`; bounds how much damage one confidently-wrong parent can do |
| `captureWeight` | 0.791 | |
| `promoWeight` | 0.651 | |
| `pstWeight` | `[–, 4.252(P), 2.652(N), 4.115(B), 9.523(R), 2.064(Q), –0.853(K)]` | per-piece PST-delta weight. **King weight is negative on purpose** — under fog, players walk kings toward the centre, not the corner a normal midgame table rewards. |
| `castleBonus` | 202.5 | the single biggest term in the fitted model |

Do not hand-tune these — read the file's header (esp. the "SCAR TISSUE"
section) before changing any of them. `belief.js`'s `THREAT_BIAS`/`MAX_LURKERS`
document two earlier times an over-sharp belief made the AI measurably worse;
this model's `floor` exists for the same reason.

### 2.6 Stockfish backend (`games/chess/stockfish.js`)

| Parameter | Default | Meaning |
|---|---|---|
| `RECYCLE_AFTER` | 400 (calls) | the engine worker is torn down and respawned after this many searches, proactively, before the vendored WASM's heap growth aborts it |
| `CACHE_MAX` | 20,000 (entries) | LRU cap on the disk-backed MultiPV cache (SQLite when `node:sqlite` is available, else append-only NDJSON) |
| `STOP_POLL_MS` | 100 | how often an in-flight search re-checks the caller's `isCancelled` and can send UCI `stop` |
| `LEGACY_DIFFICULTY` | `{easy:10, medium:35, hard:65, expert:90}` | maps old string difficulty tiers onto the 0–100 scale, for saved sessions |
| `SF_DIFFICULTY_RAMP` | `movetimeMs: 50–1000, skill: 0–20` | perfect-information difficulty → `(movetime, Skill Level)`, used by `sfOptsForDifficulty` (the legacy/non-Obscuro chess agent path) |

---

## 3. Adding or changing a parameter

1. Declare the constant where it's used, with a comment explaining *why* that
   value (not just what it does) — this repo has been burned more than once by
   a plausible-looking value that measured worse in actual play (see §2.4,
   §2.5). If there's a measurement backing the number, cite it.
2. Export it, and add it to the relevant aggregate
   (`agents/obscuro/settings.js` or `games/chess/obscuro-settings.js`).
3. Add a row to this document.
4. If it affects play strength, measure before and after — `move-quality.mjs`
   (chess) and `strength-belief.mjs` are the existing harnesses for exactly
   this.
