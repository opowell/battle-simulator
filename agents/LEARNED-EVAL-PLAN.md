# Learned leaf evaluation for non-chess games — plan

Standalone working doc. Written 2026-07-17. Safe to read cold in a new session.
Companion to `vendor/obscuro-chess/docs/FOG-AI-FIX-PLAN.md` (the chess/Obscuro history); this
executes the paper's closing suggestion (Zhang & Sandholm 2026, §5): *"merging
our techniques with deep reinforcement learning to learn the evaluation
function, instead of using a perfect-information-game evaluation function."*

## Why

The generic ObscuroAgent runs the full paper machinery (exact-ish belief, KLUSS
gadget, one-sided GT-CFR, PCFR+, purification) for EVERY game, but only chess
plugs a strong evaluator (Stockfish) into the leaves. The other ~15 games ride
hand-written `evaluateState` heuristics (typically material-count one-liners,
e.g. `games/tactical/TacticalGame.js:240`). The paper's ablation shows the
evaluation function is a major strength lever (Obscuro beat simple-eval Obscuro
81.9%) — a learned value function is the biggest remaining strength win for the
non-chess games, and unlike chess there is no off-the-shelf engine to borrow.

## Shape of the solution

A small value network per game, trained by self-play outcome regression,
plugged in through hooks that ALREADY exist — no search changes needed:

- `game.evaluateLeaves(state, mover, actions, {childStates})` → batched leaf
  values (the search prefers it over per-child `evaluateState`; see
  `vendor/obscuro/src/search.js` makeHooks).
- `game.winValue` → the terminal scale. Learned nets output tanh ∈ (−1, +1),
  so `winValue = 1` reproduces the paper's u: Z → [−1,+1] exactly — cleaner
  than chess's cp-scale compromise.
- The hand-written `evaluateState` stays as (a) the fallback when no model
  file exists or fails its gate, and (b) the gadget's ṽ(h) bootstrap during
  early training iterations.

Everything runs in plain Node (repo constraint: no Python/GPU pipeline, no new
heavy deps). The nets are deliberately tiny — a few-thousand-parameter MLP is
(i) trainable in JS in minutes, (ii) fast enough for leaf batches inside a ~1s
search budget (one batched matmul for ~30 children ≈ tens of µs), and
(iii) plenty for boards with ≤ a few dozen units.

## Architecture

### Generic encoder (deep-sets over units) — one implementation for all games

Nearly every game's state is `state.units` with a shared shape
(`{ownerId, type, position{x,y}, hp, maxHp, alive}`). Encode:

- per-unit feature vector: [ownerSign (±1 from the evaluating player's view),
  x/W, y/H, hp/maxHp, alive, typeHash-k one-hot (type string hashed into k=8
  buckets — game-agnostic, no per-game vocab)];
- permutation-invariant pooling: concat(mean, max, sum/N) over own units and
  enemy units separately → fixed-size vector (~2×3×13 dims);
- globals: turnNumber/maxTurns, unit-count ratio, plus an optional per-game
  `encodeExtras(state, playerId) → number[]` hook for resources/objectives
  (civ money, risk reinforcements, cardbattle hand — the ONLY per-game code,
  and optional).

MLP head: input → 64 → 32 → 1 (tanh), ~5k params. Zero-sum symmetry is
enforced structurally: `v(state, p) := (f(φ(state, p)) − f(φ(state, opp))) / 2`
so the sign-flip invariant (which the aow rollout test checks!) holds by
construction.

### Training

Plain self-play outcome regression (Monte-Carlo value targets, the simplest
thing that works; TD(λ) is a later refinement):

1. Generate G games headlessly via the existing `GameEngine`
   (`agents/rollout.test.js` shows the pattern) with mixed opponents:
   Obscuro-with-current-eval vs {RandomAgent, Obscuro} at low search budget,
   ε-random opening moves for diversity.
2. Record every (visibleState, playerToMove) along the trajectory; label all
   of them with the final outcome z ∈ {+1, 0, −1} from that player's view.
   Games truncated by maxTurns get z from the sign of the FINAL heuristic
   margin, discounted (weight 0.3) — this keeps sparse-reward games learnable
   without trusting the heuristic too much.
3. Train the MLP by SGD/Adam (JS, Float32Array weights, hand-rolled
   forward/backward — ~150 lines, no deps), MSE on tanh output, ~20k–100k
   samples, minutes per iteration.
4. Iterate 2–4 generations (fresh self-play with the improved eval), keeping
   the replay buffer across generations.

Fog note: training positions are the players' VISIBLE states, and at play time
the net evaluates belief-world states (full boards sampled from P) — same
regime as chess-Stockfish evaluating sampled worlds. Both state kinds appear
in training data (the mover's own view is a full world under perfect info;
under fog we additionally record the TRUE state labeled for each player) so
the net sees the distribution it will be queried on.

### Inference integration

New module `agents/learned/` (game-agnostic):
- `mlp.js` — forward/backward, Adam, serialization (weights as JSON:
  `games/<game>/model.json`, few tens of KB, committed like sprite assets).
- `encoder.js` — the deep-sets featurizer + `encodeExtras` hook plumbing.
- `train.mjs` — CLI: `node agents/learned/train.mjs --game tactical
  --games 500 --gens 3` (headless self-play → model.json + a training report).
- `leafEval.js` — `installLearnedEval(game)`: if `games/<g>/model.json`
  exists, attaches `game.evaluateLeaves` (batched) + `game.winValue = 1` +
  rescales `evaluateState` (kept for gadget ṽ and fallbacks) at module load;
  otherwise no-op. Wired in each game's `index.js` with one line.

## Phases

### Phase 0 — infra (small, ~half day)
`agents/learned/` skeleton: MLP + encoder + serialization + unit tests
(gradient check vs finite differences; encoder permutation invariance;
sign-flip symmetry). No game wiring yet.

### Phase 1 — pilot on `tactical` (small game, 325-line definition, fast engine)
Data gen + training loop end to end. **Gate (must pass before generalizing):**
learned-eval Obscuro beats static-eval Obscuro ≥ 55% over 200 headless games
(power ~50, both fog on and off), AND the rollout test still passes. If the
gate fails, iterate on targets/features here — do NOT proceed to Phase 2.

### Phase 2 — generalize (mechanical, per-game)
Run the same pipeline over the roster in order of engine speed / game length:
ffta, doom, xcom, cardbattle, mudandblood, sc1, sc2, cs, combatmission, aow,
tactical done. Defer: risk, kdice (>2 players in default configs — the
zero-sum symmetry head and outcome labels assume 2 players; scope them to
2-player configs or skip), civ1/civ2 (very long games — truncated-outcome
labels dominate; try last, expect the weakest gains). Each game ships ONLY if
it passes its own ≥55% gate; otherwise no model.json is committed and the
static eval remains (zero regression risk by construction).

### Phase 3 — hardening
- Per-move latency check at power 100 (leaf batch must stay ≪ Stockfish cost).
- A `learned-eval.test.js` smoke suite: model loads, symmetry holds, rollout
  passes for every game with a committed model.
- The difficulty dial is untouched (net strength is constant; the dial keeps
  scaling search budget/worlds, exactly like chess).

### Phase 4 — refinements (optional, only if Phase 2 gains are marginal)
- TD(λ) targets instead of pure Monte-Carlo (less variance in long games).
- Larger nets / board-plane encoders for the grid-heavy games (civ, sc).
- The paper's other mitigation — continuation strategies (Brown & Sandholm
  2019) for the game-theoretic issues of node-based evals under imperfect
  info — is noted but out of scope.

## Status (2026-07-17)

Phase 0 is BUILT and tested (`agents/learned/`: mlp.js, encoder.js, leafEval.js,
train.mjs; 6/6 unit tests — gradient check, permutation invariance, antisymmetry,
serialization). All 15 roster games are wired with `installLearnedEval` (a no-op
without a gate-passing model.json — regenerate any time with
`node agents/learned/train.mjs --game <name>` or `--all`; deferred games need
`--include-deferred`).

**Pilot finding 1 (important for all attrition games):** the first tactical gate
came out at exactly 50.0% because searcher-vs-searcher games NEVER finished —
under a material-only eval, mutual avoidance is the equilibrium (measured: 5/5
Obscuro-vs-Obscuro games truncated with all units alive, margin 0), so every
gate game was adjudicated at the neutral 0.5. Random-involved games DO finish,
so training labels were real. Fix: the gate now gives BOTH sides the same small
ε (0.05) of random moves — symmetric noise forces skirmishes, and converting
them better is exactly what a stronger evaluator should demonstrate. Defaults
were also retuned (games 200, gens 2, gate 100, agent-ms 60, max-plies 120)
after the first pilot's 3.1-hour runtime (now ~2–15 min per game).

**Pilot finding 2 — Phase 1 gate result: NOT passed (no models shipped).**
- tactical: 53.8% (100 games), then 52.7% over 300 games with 2.5× training —
  a real but small edge (~+19 Elo) that plateaued; the hp-sum heuristic is
  near-optimal for this game, as the risks section predicted.
- xcom: 51.5% (100 games) despite very low training loss (0.026) — the net
  PREDICTS outcomes well but that doesn't convert to stronger play than the
  hand heuristic.
Diagnosis: the deep-sets pooled encoding cannot represent relative-position /
threat structure ("who can shoot whom", cover, contested ground) — exactly the
information a value function would need to beat material-plus-tweaks
heuristics. The infrastructure works end to end and the gates correctly
refused to ship marginal models; the next lever is FEATURES, not more data:
pairwise-distance summaries (own↔enemy nearest-distance histograms, threat
counts per unit, attackable-target counts), plus TD(λ) targets (Phase 4).
Everything is re-runnable standalone: `node agents/learned/train.mjs --all`.

## Risks / open questions

- **Heuristics may be hard to beat** in material-dominated games (tactical's
  hp-sum is nearly optimal there). The per-game gate makes this safe: no win,
  no ship. Expected biggest wins: games where position/tempo/economy matter
  beyond material (xcom cover, cs objectives, sc economy, cardbattle tempo).
- **Truncated games** (maxTurns) weaken outcome labels — mitigated by
  discounted heuristic-margin labels, properly fixed by TD(λ) in Phase 4.
- **Multiplayer games** (risk, kdice) break the 2-player zero-sum head —
  explicitly deferred.
- **Model/asset drift**: model.json is tied to the encoder version; embed an
  encoder-version field and refuse to load mismatches (fall back to static).
- **Engine nondeterminism** (chance in applyActions) is fine for value
  regression — it just adds label noise the MC averaging handles.

## Key files (planned)
- `agents/learned/mlp.js`, `encoder.js`, `leafEval.js`, `train.mjs`, tests.
- `games/<game>/model.json` (committed weights, per shipped game).
- One-line `installLearnedEval(Game)` in each shipped game's `index.js`.
- Touchpoints that must NOT change: `vendor/obscuro/src/search.js` (consumes
  `evaluateLeaves`), `agents/ObscuroAgent.js` (`_winValue` reads
  `game.winValue`).
