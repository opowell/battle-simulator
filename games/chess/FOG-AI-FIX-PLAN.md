# Fog-of-war chess AI — king-safety fix plan

Standalone working doc. Written 2026-07-13, substantially executed later the same day.
Safe to read cold in a new session.

## Status: root causes found and fixed (Phases 0–3 done; Phase 4 partially)

The search-side king-safety bug is fixed and regression-tested. Measured on the
`febb71bf` blunder position (power 80, 8 seeds, replayed belief):

| | king-hangs | Kf7 in top candidates | value hallucinations (+1500 in a lost position) |
|---|---|---|---|
| before | 1/8 played (guard rescued 2 more; search ranked Kf7 top in 3/8) | 3/8 | 2/8 |
| after  | **0/8** | **0/8** | **0/8** |

After all fixes the search converges near-deterministically to Ne7/Qe7 (sound
defensive moves) with stable values (−715…−1065). On the `befd4820` bishop position it
now plays Stockfish's best move (fxe6) in 5/6 seeds and SF's #4 (Nf6) in the sixth.

Regression harness: `games/chess/fog-blunders.test.js` (replays both recorded
blunder sessions with the real belief lifecycle and seeded RNG).

## Symptom (historical)

The fog-of-war chess AI (`ChessObscuroAgent`, the Obscuro/CFR equilibrium search) played
bad moves at high power levels — most visibly it **walked its own king onto a square an
unseen enemy pawn attacks** (hanging the king), and **thought it was winning a lost
position** (search value `+1500`) while ignoring a hanging bishop.

Repro sessions (recordings under `sessions/`):
- `2026-07-12T23-27-55-befd4820.json` — power 86, played `b6→b5` with the d7 bishop hanging.
- `2026-07-13T12-59-56-febb71bf.json` — power 80, played `e8→f7` (king) into White's e6 pawn.

## Root causes (as actually found — several differed from the original hypotheses)

0. **Root-infoset fragmentation (the deepest one).** Infoset keys are the acting
   player's observation *recomputed inside the sampled world* — but imagined hidden
   pieces change blocking/visibility, so each belief world recomputed a slightly
   different observation and landed in its OWN singleton root infoset. The strategy the
   agent purified was supported by only the world(s) whose key happened to match world
   0: the fog search had effectively been a **single-world search** all along (measured:
   root visitReach 1/42). Fixed in `gtcfr.js`: `expandRoot` forces every root world into
   the one shared root infoset (they are by construction in the searcher's real
   infoset); `expandNode` takes a `forceInfoset` override. After this fix the root
   values equal the belief-weighted mean and the chosen move matched Stockfish's best
   on the befd position across seeds.

1. **Check-filtered in-tree action sets violated the infoset invariant (THE big one).**
   `getSearchLegalActions` (an earlier fix for a phantom-win bug) gave the tree
   check-filtered moves. But check depends on *hidden* pieces, so the "legal set"
   differed across belief worlds sharing one observation — breaking the rule that every
   node in an infoset has the same action set. Concretely: in exactly the worlds where
   `Kf7` walks into the unseen e6 pawn, `Kf7` vanished from that world's move set, so
   `cfrDescend` scored it as a **neutral pass at material value** instead of −WIN. The
   dangerous worlds never voted. Fix: the tree now uses the REAL fog action set
   (pseudo-legal — observation-determined, as FoW chess rules guarantee), and self-check
   is punished by VALUE: such children evaluate to −SEARCH_WIN for the mover, new
   infosets are seeded to the best child, and CFR keeps suicide out of both players'
   strategies (which also re-fixes the original phantom-win bug, properly this time).

2. **uCond was not the paper's conditional value.** `infoset.js` weighted an infoset's
   nodes by the acting player's own reach only, so root values averaged belief worlds
   uniformly no matter how the KLUSS gadget's opponent concentrated on dangerous
   classes. Now weighted by full reach π(h) = reachMe·reachOpp (paper App. B.1), so
   values, PUCT expansion, and the analysis panel all see the gadget's worst-case
   pressure.

3. **Unbounded terminal values.** In-tree terminals were ±10⁶ while leaf material was
   clamped to ±1500, so one phantom world where the enemy king looked capturable
   swamped everything. The paper bounds utilities to [−1,+1]. Now games can set the
   scale (`ObscuroAgent._winValue` / `game.winValue`); chess uses SEARCH_WIN = 8000,
   and "hung own king" = −SEARCH_WIN exactly (a certain loss, not "down 80 pawns").

4. **Belief inconsistency** (`games/chess/belief.js`):
   - The forced-capture-square inference (piece of ours just captured on a now-unseen
     square) back-filled a phantom piece of random/queen type while also scattering the
     real candidates elsewhere. It now places a REAL unseen piece there first, weighted
     by proximity AND inverse piece value (recaptures use the least valuable piece):
     measured on `febb71bf`, e6 = pawn in 39/50 worlds (truth: pawn), up from 26/50,
     with queens/rooks/kings on e6 down from 14/50 to 3/50. This mattered because a
     wrongly-imagined ROOK/QUEEN on e6 gives *check*, and worlds that start in check
     make every quiet move price like death — pushing king walks to the top.
   - Phantom self-checks (in-check worlds with no capture evidence) are rejected during
     sampling (with an escape hatch when non-check worlds are scarce). In-check worlds:
     12/50 → 3/50.
   - `Belief.beginTurn` is now idempotent per turn (keyed by turnNumber): the king-safety
     guard's re-sample used to advance the belief an extra phantom opponent ply per move.

5. **Expansion ignored the gadget.** One-sided GT-CFR sampled root worlds by prior
   belief mass; per the paper (Fig. 12) the descent starts at the gadget root where the
   opponent selects the class J with its current reach π_▼(J). Fixed in `gtcfr.js`
   (`sampleWorld` now reads `tree.gadget`).

6. **Gadget alternate-value miscalibration → class tunnel vision.** With per-world
   singleton classes, alt values on a different scale from the resolved enter values
   made enter/exit go one-hot: measured, the opponent exited 41/42 classes (piv sum
   0.043) and the whole strategy optimised against 1–2 junk worlds. Two changes in
   `kluss.js`: (a) alt = min{ṽ(h), v*} with ṽ(h) the world's engine-informed
   best-child value (the paper's "Stockfish's evaluation of h"), not a static
   heuristic; (b) the opponent's root reach is FLOORED at half its prior α — a
   deliberate deviation from the pure gadget so every belief world keeps voting and
   the gadget tilts emphasis instead of silencing classes (our alts are estimates,
   not real blueprint values; the paper itself notes safety semantics are strained
   here, App. B.2 fn. 12).

Also fixed while in there (paper fidelity, not king-safety):
- **Purification** now shifts ALL excluded probability onto a\* (paper App. C.8) instead
  of renormalising across the kept support.
- **Perfect-info power 100** now collapses to pure (deterministic) Stockfish best-move
  play; below 100 the proportional-sampling dial is unchanged. Time mode already played
  pure best.

## Follow-up round (same day): open items executed

- **Exact position set P** (`games/chess/exactBelief.js`, the paper's belief): all
  positions consistent with the full observation history, advanced one opponent ply
  per turn (fog-pseudo-legal, minus king-captures-us successors), filtered inline
  against the current observation (own pieces exact, visible squares exact, exact
  visibility-set reproduction), deduped as STATES (fn. 21), capped at 30k with a 3s
  time guard. Sampling is uniform (paper §3). On give-up (mid-game attach, cap,
  time, contradiction) play falls back seamlessly to the heuristic particle belief,
  which is kept in lockstep every turn. While |P|=1 the agent literally knows the
  board. Invariant test: `games/chess/exact-belief.test.js` (true position ∈ P at
  every turn of both replayed blunder sessions). Live measurement at power 80: exact
  held ~27/40 opening plies, avg |P| ≈ 2.3k, max ≈ 15k.
- **Guard-vs-belief commit bug**: the generic agent committed its chosen action to
  the belief trackers before `_kingSafetyGuard` could swap it, silently corrupting
  the belief (fatal for exact P). Selection adjustment is now a subclass hook
  (`_adjustChosenAction`) that runs BEFORE `onActionCommitted`; overrides are flagged
  in `lastAnalysis.adjusted`.
- **Turn-scoped infoset keys** (`infoset.js observationKey`): keys now include
  (player, turnNumber), so identical visible boards at different plies no longer
  merge into one strategy; absolute turn numbers keep blueprint warm-starts valid.
- **Minimum root-world expansion** (`gtcfr.js expandRoot`): at least 8 root worlds
  expand even past the deadline, so a cold engine cache can't silently degrade the
  search to near-single-world. Root worlds expanded lazily later also join the
  shared root infoset (rootWorld tag).
- **Leaf depth recalibrated** (`games/chess/ObscuroAgent.js _leafEval`): 2..7 by
  dial (was 2..10). The paper uses depth-1 leaves with ~10⁶-node trees; our trees
  are far smaller so leaves must price short tactics — depth 6–7 is where Stockfish
  folds "quiet move → loses the attacked piece" into parent MultiPV scores — but
  depth 9+ made cold root expansion so slow it reintroduced few-world search.
  Search budget top raised to ~2s (power 100).
- **Alternate values, resolved structurally**: because worlds are re-sampled fresh
  each move (only regrets/values warm-start), every root class is a "newly sampled"
  state in the paper's terms, and the paper's own formula for those — min{ṽ(h), v*},
  perfectly-informed opponent — is exactly what the code does. The carried-tree
  branch u(x,y|J) − ĝ(J) (Fig. 9 l. 8) only becomes meaningful with node-level tree
  carryover (future work below).

## Phase 4 validation (instrumented self-play, one agent instance per side)

4 games at power 50 and 80, 4 at power 100 (two chunks), fog on, seeded:

| power | plies | king-hangs w/ safe move | mixed CFR moves | guard fires | avg latency | exact-P plies |
|---|---|---|---|---|---|---|
| 50  | 234 | 4 (1.7%) | 129/212 (61%) | 1 | 774ms | 130/234 (56%), avg P 793 |
| 80  | 373 | 3 (0.8%) | 186/334 (56%) | 2 | 1508ms | 314/373 (84%), avg P 1008 |
| 100 | 391 | 3 (0.8%) | 187/360 (52%) | 1 | 2060ms | 358/391 (92%), avg P ~920 |

- King-hang rate meets the Phase-0 target (<2%) at every power; the few remaining
  hangs are plausibly calculated risks in lost positions (paper App. E.7), not bugs.
- **Mixing confirmed in live play** (open item resolved): with v* carryover the agent
  plays genuinely mixed strategies on half its CFR moves; fresh-agent single-position
  probes sit in Resolve (pure) because v* = ∞ there — expected, not a defect.
- `_kingSafetyGuard` fired 3 times in ~750 plies (0.4%): play is equilibrium-driven;
  the guard is KEPT as a cheap tail-risk backstop (it only breaks ≤2.5-pawn near-ties
  toward safety, so its interference with deliberate risk-taking is negligible).

## Future work (nothing blocking; strength/fidelity upside)

- **Node-level tree carryover**: keep the previous move's tree nodes (not just
  infoset regrets) so the paper's carried-infoset alternate values u(x,y|J) − ĝ(J)
  (Fig. 9 l. 8) and non-acting-player infosets become implementable, and Γ̂ reuse
  matches the paper fully.
- **Sequence-scoped deeper infosets**: deeper nodes still key by (player, turn,
  visible board); keying by observation SEQUENCE would remove the path-independence
  abstraction (finer infosets, truer bluff coherence, bigger trees).
- **Exact-belief longevity**: P held exact for 56–92% of self-play plies (cap 30k,
  3s guard). A compact board encoding + incremental visibility could raise the cap;
  re-acquiring exactness after a fallback (when information collapses) is also
  possible in principle.
- The recorded `b6-b5`-class inaccuracy (~330cp in a lost position) still appears in
  ≲1/6 seeded runs at power 86 — acceptable for the dial, and the fog-blunders
  oracle (400cp) is calibrated to catch only the gross class.

## Key files
- `games/chess/ObscuroAgent.js` — chess leaf eval (`makeChessLeafEval`, `LEAF_CLAMP`,
  `SEARCH_WIN`/`KING_HANG`), `_winValue`, `_kingSafetyGuard` (via
  `_adjustChosenAction`), difficulty scaling, perfect-info Stockfish path (pure at
  power 100).
- `agents/ObscuroAgent.js` — generic agent, `_config` difficulty knobs, `_winValue` +
  `_adjustChosenAction` hooks, `lastAnalysis` (`.adjusted` flags a guard override).
- `agents/obscuro/search.js` — `makeHooks` (action-set hook caveats), `runObscuroSearch`.
- `agents/obscuro/kluss.js` — Resolve/Maxmargin gadget; engine-informed alternate
  values; opponent reach floored at ½·prior.
- `agents/obscuro/gtcfr.js` — tree growth; gadget-driven root sampling; shared root
  infoset (`forceInfoset` / `rootWorld`); minimum-root-worlds floor.
- `agents/obscuro/infoset.js` — CFR value propagation; `uCond` full-reach weighting;
  turn-scoped `observationKey`.
- `agents/obscuro/purify.js` — excluded mass → a*.
- `games/chess/exactBelief.js` — exact position set P (+ `exact-belief.test.js`).
- `games/chess/belief.js` — heuristic fallback: recapture inference, phantom-check
  rejection, idempotent `beginTurn`; `games/chess/ChessGame.js` prefers exact P and
  keeps both trackers in lockstep.
- `games/chess/fog-blunders.test.js` — Phase 0 regression harness (SEEDS env scales).

## Repro / measurement recipe
Replay a recording to a decision point and run the agent (Node ESM, Stockfish auto-loads):
see `games/chess/fog-blunders.test.js` (`replaySession` drives the belief lifecycle:
`sampleWorlds` → `onActionCommitted` per AI move, then `applyActions`). King-hang check:
apply the candidate on the TRUE state and `isAttackedBy(kingSq, enemy)`.
Belief probe: `ChessGame.sampleWorlds(view, "black", N, rng)`, inspect `world.board.e6`
and `isAttackedBy(world.board, "f7", "white")`.
Note: the live game shares ONE agent instance across moves (KLUSS blueprint/prevValue
carryover); a fresh agent per call does not. Belief is per (players-array, colour) and
now advances at most once per turnNumber regardless of how often sampleWorlds is called.
