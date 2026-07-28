# Obscuro analysis: merge the perfect-info/fog branches + iterative deepening — plan doc

Standalone working doc. Written 2026-07-28. Safe to read cold in a new
session. Companion to [OBSCURO-UNLIMITED-BELIEF-PLAN.md](OBSCURO-UNLIMITED-BELIEF-PLAN.md)
(the belief-population batched-walk machinery this plan builds on top of) and
[FOG-AI-FIX-PLAN.md](FOG-AI-FIX-PLAN.md) (search-side king-safety — already
fixed, unrelated to this doc).

## Status: NOT STARTED

This is a plan only — nothing below has been implemented yet.

## The ask

In `apps/design/battlefield/AnalysisPanel.vue`, the "Analysis" panel's
progress line stops at "All 1 worlds evaluated" on a fresh chess position and
never keeps refining, unlike lichess/chess.com's engine bar which keeps
ticking "Depth 21… 22… 23…" indefinitely. Investigated why, then user asked
for a plan to fix it: **combine the two branches of `analyzeObscuro` (perfect
info vs. fog) into a single branch that does BOTH belief-population averaging
AND iterative deepening, with the Stockfish search depth going up to 30.**

## The current state (two disconnected branches)

`games/chess/ObscuroAgent.js`'s `analyzeObscuro` currently forks:

1. **Perfect info** (`fogOfWar` off, [ObscuroAgent.js:384-401](ObscuroAgent.js#L384-L401)):
   calls Stockfish's `multiPV` directly on the one real position, depth 14,
   with live "Depth N/14" progress ticks (via `multiPV`'s `onInfo`) — this is
   the branch that looks like lichess.
2. **Fog** (`fogOfWar` on, [ObscuroAgent.js:403-411](ObscuroAgent.js#L403-L411)):
   either `analyzeObscuroProgressive` (when `opts.isCancelled` is supplied —
   the streaming/worker callers) or the one-shot `analyzeObscuroOnce`
   fallback. `analyzeObscuroProgressive` walks the belief population (the set
   of positions consistent with what's hidden) in batches, folding each
   batch's CFR mixing + a **fixed depth-7** Stockfish leaf eval
   (`cpSumsOverWorlds` → `makeChessLeafEval(7, cols)`,
   [ObscuroAgent.js:475-476](ObscuroAgent.js#L475-L476)) into a running
   weighted average, until the whole population is covered ("exhaustive") or
   the viewer cancels/pauses. It never gets deeper — just wider (more worlds).

This is an artificial split. A fully-known position gets deep iterative
search but no "average over what's uncertain" framing; a fog position gets
belief-averaging but a shallow, fixed-depth eval that never gets more
accurate over time.

## The key insight (confirmed with the user)

**Perfect information is just the degenerate case of belief-population size
1.** `games/chess/ChessGame.js`'s `beliefPopulation` currently special-cases
`!fogOfWar` as `{ exact: false, total: 0 }` (no belief machinery engaged at
all) rather than `{ exact: true, total: 1 }` (exactly one possible world:
the real position, since nothing is hidden). Fixing that lets ONE code path
— the existing batched-walk machinery — handle both cases, with no separate
shortcut branch needed.

Separately, Stockfish's `multiPV` already does iterative deepening **within
one call** — `go depth N` internally sweeps depth 1..N, and `onInfo` already
fires once per completed depth ([stockfish.js:348-381](stockfish.js#L348-L381)).
So "iterative deepening" doesn't need a new outer JS loop — it needs the
existing per-world leaf eval to target depth 30 instead of the current fixed
7 (fog path) / 14 (perfect-info shortcut), and to forward `onInfo` instead of
dropping it.

**Scope boundary:** this only touches the read-only analysis panel
(`analyzeObscuro` and friends). Real move selection during actual play
(`ChessObscuroAgent.chooseAction`, its difficulty-scaled depth-2..7
`_leafEval` used for real AI turns) is untouched — that's a different,
latency-budgeted concern.

## Plan

### 1. Make "perfect info" a population of exactly 1 — `games/chess/ChessGame.js`

- `beliefPopulation` ([ChessGame.js:558](ChessGame.js#L558)): when
  `!fogOfWar`, return `{ exact: true, total: 1 }` instead of
  `{ exact: false, total: 0 }`.
- `enumerateWorlds` ([ChessGame.js:577](ChessGame.js#L577)): when
  `!fogOfWar`, short-circuit to `[observation]` for any non-empty index
  request, instead of routing through the exact-belief tracker (never
  engaged when fog is off).
- `sampleWorlds` needs no change — it already returns `[]` when fog is off,
  and `obscuroStrategy` already turns an empty worlds list into `[state]`
  ([ObscuroAgent.js:326](ObscuroAgent.js#L326)).

### 2. Delete the branch fork; always run the progressive walker — `games/chess/ObscuroAgent.js`

- `analyzeObscuro` ([ObscuroAgent.js:372-412](ObscuroAgent.js#L372-L412)):
  remove the `!fogOfWar` Stockfish-shortcut block and the
  `fog && opts.isCancelled` conditional. It becomes a thin pass-through to
  `analyzeObscuroProgressive` unconditionally — `opts.isCancelled` becomes
  optional (treated as never-cancelled if absent), not a fork selector.
- Delete `analyzeObscuroOnce` ([ObscuroAgent.js:414-466](ObscuroAgent.js#L414-L466)) —
  fully subsumed once population-of-1 is a first-class case of the batched
  walk.
- `analyzeObscuroProgressive`'s batch/cursor/exhaustion logic
  ([ObscuroAgent.js:532-665](ObscuroAgent.js#L532-L665)) needs **no
  structural change** — with `pop.total === 1` it naturally runs one batch,
  one CFR solve, one leaf eval, then reports `exhaustive: true` and stops, on
  the existing code path. No wraparound/re-pass logic is needed since each
  world's leaf eval now targets depth 30 directly in one `multiPV` call
  (see below) rather than needing multiple shallow-then-deep passes.

### 3. Iterative deepening: raise the leaf-eval depth to 30, threaded live

- `cpSumsOverWorlds` ([ObscuroAgent.js:475](ObscuroAgent.js#L475)): replace
  the hardcoded `makeChessLeafEval(7, cols)` with
  `makeChessLeafEval(opts.sfDepth ?? 30, cols, onInfo)`.
- `makeChessLeafEval` ([ObscuroAgent.js:80](ObscuroAgent.js#L80)): accept and
  forward an `onInfo` callback into its `multiPV` call.
- `analyzeObscuroProgressive`: pass an `onInfo` down through
  `cpEval`/`cpSumsOverWorlds` that merges depth ticks into the existing
  `{ kind: 'batch', batch, evaluated, total, exhaustive, candidates }`
  progress frames as added `depth`/`maxDepth` fields (`maxDepth` = 30).
  `sfDepth` becomes an `opts` passthrough (default 30) so tests/tuning can
  override it without waiting out real depth-30 searches.

Net effect: a population of 1 (today's "perfect info") gets exactly the old
UX — live "Depth N/30" ticks on the one real position — for free, because
that's just a batch of size 1 going through the same code. A larger fog
population still walks worlds in batches, now each scored at depth 30
instead of 7 — deeper and more expensive per world, but the existing
pause/cancel/resume and `maxTotalMs` safety net
([ObscuroAgent.js:533](ObscuroAgent.js#L533)) already handle "this may take
a while."

### 4. Let cancellation actually interrupt a deep search — `games/chess/stockfish.js`

Today `request()`/`multiPV()` ([stockfish.js:273-381](stockfish.js#L273-L381))
have no way to stop an in-flight engine call early — cancellation only takes
effect *between* calls. That was fine at depth ≤14 (sub-second calls); at
depth 30 a single world's search could take multiple seconds, so
Pause/position-changed would otherwise feel laggy. Add an optional
`isCancelled` to `multiPV`/`request`: when it flips true, send the UCI `stop`
command, which makes the engine emit its current-best `bestmove` immediately
(the existing line-handler already resolves on that line — no new resolution
path needed). Wire `analyzeObscuroProgressive`'s `isCancelled` through to the
`cpSumsOverWorlds` → `multiPV` calls.

Also re-check the per-call timeout formula (`depth * 400 + 5000` ms,
[stockfish.js:377](stockfish.js#L377)) empirically once depth-30 calls are
running for real middlegame positions — bump the multiplier if calls are
getting truncated before Stockfish would naturally finish (Stockfish 11
single-threaded WASM, no NNUE — depth 30 may genuinely take several seconds
in complex positions; this needs real measurement, not a guess).

### 5. Bound the non-streaming single-shot caller — `api-server.js`

`handleAnalyze` ([api-server.js:1222-1240](../../api-server.js#L1222-L1240))
calls `analyze()` with no `onProgress`/`isCancelled` at all — previously this
hit the fast `analyzeObscuroOnce` fallback; after this change it would hit
the same walk-until-exhaustive-or-`maxTotalMs` (5 min default) path as
streaming callers, with no way to stream partial progress back over a single
HTTP response. Pass a short `maxTotalMs` (e.g. 15s) at this call site so a
one-shot request degrades to "best answer within budget" instead of hanging.
(The SSE/worker paths keep the 5-minute default since they already stream
progress and support user cancellation.)

### 6. Surface depth in the panel — `apps/design/battlefield/AnalysisPanel.vue`

`progressLabel` ([AnalysisPanel.vue:69-85](../../apps/design/battlefield/AnalysisPanel.vue#L69-L85))
currently branches on `kind` (`'depth'` | `'round'` | `'batch'`/exhaustive).
Since the shortcut's `'depth'` kind goes away, extend the `'batch'`
rendering to include depth when present, e.g.
`Depth 22/30 · 480/1,200 worlds` (or just `Depth 22/30` when `total === 1`,
matching today's perfect-info look exactly).

### 7. Tests — `games/chess/analysis.test.js`

- `'analyzeObscuro: perfect info ranks the free-queen capture first'`
  ([analysis.test.js:39-50](analysis.test.js#L39-L50)): the mode assertion
  changes from `'stockfish'` to `'minimax'` (population-of-1 still routes
  through `obscuroStrategy`, which sets `mode: fog ? 'cfr' : 'minimax'`).
  The `cp > 500` and top-move assertions should still hold.
- Existing resume/exhaustion tests ([analysis.test.js:153-272](analysis.test.js#L153-L272))
  already pass `cpEval: () => null` or don't check `cp`, so they're
  unaffected by the depth bump — no Stockfish calls happen in those.
- Add/pass an explicit small `sfDepth` in the free-queen test (or confirm
  depth-30 on that trivial 4-piece position is still fast — likely is, since
  it's not compute-bound by search width) so the suite doesn't slow down
  unnecessarily.

## Verification

- `node --test games/chess/analysis.test.js` — update and re-run.
- `node --test games/chess/*.test.js` broadly (belief/exact-belief/fog
  tests untouched in behavior, but confirm no regressions).
- Manual: start the design server, open a chess session with fog **off**,
  confirm the panel still shows live "Depth N/30" ticks the way it showed
  "Depth N/14" before, converging on the same best move for simple
  positions.
- Manual: start a fog game, confirm the panel shows batch/world-coverage
  progress with depth folded in, that Pause/Resume still works (existing
  resume-state tests cover the accumulator logic; this is about the UI
  round-trip), and that cancelling (switching position) feels responsive
  even mid a deep per-world search.
- Per project convention (see repo root `CLAUDE.md`), do the implementation
  in its own git worktree since this is a shared alpha-stage repo with other
  agents potentially active concurrently.