# Replace "grid vs non-grid" with "discrete vs continuous" locations

## Problem

Doom, CS, and Combat Mission author organic terrain (round rooms, ovals, pits — see
`games/terrainShapes.js`) but still moved units by hopping between integer tile
cells, one BFS/Dijkstra step at a time. On screen this looked exactly like what it
was: a grid-locked hop, stair-stepping axis-by-axis, even though the terrain itself
is drawn as smooth continuous shapes. The user wants real click-to-exact-point
movement on these maps — "where you click is where you move to," gated only by the
unit's move budget, not snapped to any cell — with coordinates precise to at least
1000x finer than the 1-unit tile grid.

A prior session (this one) started retrofitting this as a special case of the
existing grid model — floats stuffed into `unit.position.x/y`, detected client-side
via the `field.shapes?.length` heuristic (a rendering signal, not a real type) — and
hit a wall: **the client's entire unit-rendering pipeline locates a unit by exact
match against an integer cell-grid loop index** (see "Current state" below). Floats
also raise correctness questions (equality for server-side action validation,
precision drift) that a grid-based model never had to answer. Rather than keep
patching floats into a system built for integers, formalize the split explicitly:
every game's locations are either **discrete** (today's integer grid, unchanged) or
**continuous** (arbitrary-precision real coordinates, new). This plan is for a fresh
session to implement that cleanly, informed by what the retrofit attempt surfaced.

## Current state (relevant facts)

### What already changed this session (uncommitted, `git status`/`git diff` in the repo)

`git diff --stat` at hand-off touches: `apps/design/Battlefield.vue`,
`apps/design/SchematicLayer.vue`, `engine/ActionValidator.js`, `engine/GameEngine.js`,
`games/combatmission/{CombatMissionGame,grid,los,map}.js`, `games/cs/{CsGame,map}.js`,
`games/doom/{DoomGame,map}.js`, and a new `games/continuousMove.js`. Decide per-item
below whether to keep, adapt, or discard once the discrete/continuous split lands —
none of it is committed, so it's all freely revisable.

**Worth keeping (real bugs the float retrofit surfaced, independent of float vs
BigNumber — a continuous coordinate of any representation hits the same issues):**
- `hasLOS` in `games/doom/map.js`, `games/cs/map.js`, `games/combatmission/los.js` is
  a Bresenham DDA (`while (cx !== x1 || cy !== y1) { cx += sx; ... }`) that only
  terminates for **integer** endpoints. A continuous position fed straight in
  infinite-loops the server. Fixed this session by flooring both endpoints on entry —
  keep this (or the BigNumber equivalent, e.g. `.integerValue(BigNumber.ROUND_FLOOR)`)
  regardless of what representation continuous coordinates end up using.
- `getReachable` in `games/doom/map.js`, `games/cs/map.js`, `games/combatmission/grid.js`
  builds the AI's discrete move-candidate set (BFS/Dijkstra over the tile grid) by
  keying occupancy/origin off the unit's raw position. A non-integer origin produces
  keys like `"5.37,3.82"` that never collide with any integer BFS-visited key — every
  unit that has ever made a continuous move silently gets **zero** legal moves
  forever after. Fixed by flooring the origin and all units' occupancy keys to their
  containing tile before running BFS/Dijkstra. Keep this fix (or its BigNumber
  equivalent) — it's what keeps "AI gets a discretized candidate set" (see below)
  actually working once any unit has a continuous position.
- CS's defuse legality (`games/cs/CsGame.js`, was `u.position.x === bomb.plantedAt.x`
  exact equality) — changed to a proximity check (`euclidean(...) < 0.5`). Exact
  float/BigNumber equality between two independently-computed positions is fragile;
  keep the proximity-based check.

**Superseded by this plan (built on the wrong signal, replace rather than extend):**
- The `field.shapes?.length` checks in `apps/design/{App,Battlefield,SchematicLayer}.vue`
  (gates the straight-line slide animation, the moveRange circle, and the
  exact-click-point move-submission path) — this conflates "renders via SVG shapes"
  with "has continuous positions." Replace with an explicit type (see Design §3).
- `isWalkableContinuous`/`getTileContinuous`/etc. added to each game's `map.js`, and
  the `isMoveLegal` exports added to each `Game.js` — the logic/shape is right
  (geometric check against the authored shape geometry instead of the rasterized
  tile grid) but the arithmetic is plain JS float `Math.hypot`/`pointInShape`. Revisit
  once the coordinate representation (§2) is decided — likely most of this logic is
  reusable, just re-typed.
- `games/continuousMove.js` (`hasClearLine`, `lineCost`, `isClearOfUnits`) — same:
  logic is right, arithmetic needs to match whatever representation §2 lands on.
- `engine/ActionValidator.js`'s `validate()` — added a fallback: for `'move'` actions
  not found via the existing exact-structural-match against `legalActions`, call
  `game.isMoveLegal(state, playerId, action)` if the game exports one. This pattern
  (AI still gets a fully-enumerated discrete candidate set from `getLegalActions`;
  humans can submit any continuous point, validated geometrically instead of by
  set membership) is sound and should carry forward — but the canonicalKey
  structural-equality check other action types still rely on needs an audit once
  continuous coordinates have a real (possibly non-JSON-primitive) type (see §4).

### The blocking discovery: client rendering has no concept of a non-grid-cell position

`toGrid()` in every game (not just these three) returns `{ cells: [...] }` — a flat
array built by looping `y` then `x` over the board's integer dimensions. A unit only
appears in this array if its position happens to **exactly match** one of those
integer loop indices:
```js
// games/doom/DoomGame.js:357-358 (same pattern in cs/CsGame.js, combatmission/CombatMissionGame.js)
const posMap = {};
for (const u of units) if (u.alive) posMap[`${u.position.x},${u.position.y}`] = u;
// ...then for each integer (x, y) in the loop: const u = posMap[`${x},${y}`];
```
`apps/design/App.vue`'s `buildField()` then derives the client's entire `units` list
from that same array (`g.cells.filter(c => c.glyph).map(c => ({ ..., path: [[c.x +
0.5, c.y + 0.5]] }))` — line ~208). There is currently **no path** for a unit's true
position to reach the client if it isn't sitting exactly on an integer cell — it
simply has no glyph anywhere and vanishes from the board. This is why the retrofit
stopped here: making positions genuinely continuous requires a second, parallel
channel for real unit coordinates, independent of the `cells` terrain grid. The user
confirmed (over the float-snap-vs-continuous question this session) that this
channel should be added properly rather than worked around by snapping.

## Design

### 1. Terminology and the type signal

Replace every `field.shapes?.length` / `field.grid === 'square'` check used as a
proxy for "is this a shape/organic map" with an explicit field, e.g.
`field.locationType: 'discrete' | 'continuous'`, set once in `apps/design/App.vue`'s
`buildField()` from a new field each game's `toGrid()` returns (e.g. `locationType`
on the object `toGrid()` already returns alongside `width`/`height`/`cells`/`shapes`).
`field.grid === 'square'` is currently hardcoded unconditionally in `buildField`
(`apps/design/App.vue:244`) — it needs to become conditional, or `locationType`
needs to be a genuinely new/separate field so existing `field.grid === 'square'`
checks elsewhere (chess, xcom, etc. rendering logic) don't need to change at all.
Prefer adding a new field over overloading `grid`, to keep this change additive.

Only `doom`, `cs`, `combatmission` become `'continuous'`. Every other game
(chess, xcom, ffta, civ1/2, risk, axisallies, aow, kdice, warofdots, ...) stays
`'discrete'` and this plan should not touch their code paths at all.

### 2. Coordinate representation

Introduce a small shared module, e.g. `games/coord.js`, wrapping `bignumber.js` for
server-side authoritative math on continuous positions. Decisions to make explicit
up front (don't improvise mid-implementation):

- **Where does BigNumber precision actually matter?** Recommend: only for (a) the
  persisted `unit.position` on continuous-game units, and (b) comparisons that gate
  legality (distance vs. move budget, proximity checks). The authored terrain shapes
  (`MAP_ROOMS`, CS/CombatMission `terrain` arrays) are small, static, author-controlled
  numbers — plain float64 already has vastly more precision than a human ever
  authors a room boundary with, so `pointInShape`/`terrainShapes.js` geometry math
  can very likely stay plain JS numbers. Convert BigNumber → `Number` at the
  boundary right before calling into that geometry code. This avoids rewriting
  `terrainShapes.js` and `games/continuousMove.js`'s line-sampling math in BigNumber,
  which would be slow (BigNumber ops are ~100x+ slower than float ops, and
  `hasClearLine`/`lineCost` already sample a line 12x per unit distance).
- **Wire format.** JSON has no arbitrary-precision number type. Recommend
  transmitting continuous coordinates as decimal strings (`BigNumber.toString()` /
  `new BigNumber(str)`), both server → client (state payloads) and client → server
  (submitted move actions), so a coordinate never round-trips through a lossy JS
  `Number` on the wire. The server is the only place that needs `bignumber.js`.
- **Does the client need bignumber.js at all?** Recommend no. Pixel rendering and
  mouse-click precision are already bounded by float64 (and by actual screen
  resolution, far coarser still) — the client can parse an incoming decimal string
  straight to `Number` for rendering/hit-testing, and send a click's `Number`
  coordinate back as a JSON number (or `.toString()`'d, doesn't matter) for the
  server to parse into a `BigNumber`. This keeps the "no build steps" constraint for
  `apps/design` (see `feedback_no_build_steps` in this user's saved preferences — no
  new client dependency needed) and keeps `bignumber.js` a server-only dependency.
- **Precision policy.** Pick a fixed `BigNumber.set({ DECIMAL_PLACES: N, ... })`
  (e.g. `N = 20`) once, globally, in `games/coord.js` — "arbitrary precision" in
  practice still needs a concrete rounding policy for division/sqrt-like ops
  (distance calculations use `.sqrt()`), otherwise behavior is non-deterministic
  across BigNumber versions/configs.
- **First dependency.** `package.json` currently has `"dependencies": {}` — this
  would be the project's first real dependency (server-side only, per above).
  Flag this to the user before `npm install bignumber.js`, matching the existing
  precedent in `plans/websocket-migration.md` (`ws` was flagged the same way for
  the same reason).

### 3. Server-side per-game changes (doom, cs, combatmission)

For each: `unit.position` becomes `{ x: BigNumber, y: BigNumber }`.
- `createInitialState`/spawn code: construct positions via `games/coord.js` helpers
  instead of plain integers.
- `applyActions`' `move` handler already blindly stores `action.to` (verified this
  session) — just needs the incoming `action.to.x/y` (decimal strings from the
  wire) parsed into `BigNumber` before storing, not stored as raw strings/numbers.
- `getReachable`/`hasLOS` (AI's discrete candidate set + LOS): keep operating in
  integer tile space — floor the BigNumber position via `.integerValue(FLOOR)` to
  get plain integers, then everything downstream (BFS/Dijkstra, Bresenham) is
  unchanged from today's discrete-game logic. This is exactly what this session's
  float-based floor-fixes already do; just swap `Math.floor` for the BigNumber
  equivalent at the same call sites listed in "Current state" above.
- `isMoveLegal` (new, per game — the human continuous-click validation path): convert
  `unit.position`/`action.to` to plain `Number` at the top (via `.toNumber()`) and
  reuse `games/continuousMove.js`'s float-based `hasClearLine`/`lineCost` and each
  game's `pointInShape`-based `isWalkableContinuous`/`getTileContinuous` — per §2,
  this geometry doesn't need BigNumber precision, only the range-budget comparison
  does (do that comparison in BigNumber before/after the float geometry check, or
  just accept float precision there too since a move-budget comparison isn't the
  kind of value that needs 1000x-finer-than-a-tile precision — the *click point*
  does, the *budget number* doesn't).
- Every other position comparison in these three games needs an audit for
  float-style exact-equality assumptions that silently break once positions aren't
  guaranteed-integer (the CS defuse fix above is one instance already found — search
  for other `.position.x ===`/`.position.y ===` patterns, and for tile-key-building
  via string interpolation of a position, e.g. `` `${u.position.x},${u.position.y}` ``
  used in each game's `toGrid()` — see §4 below where this pattern needs to be
  removed anyway).

### 4. Engine glue (`engine/ActionValidator.js`, `engine/GameEngine.js`)

This session's change — `validate()` falls back to `game.isMoveLegal(state,
playerId, action)` for `'move'` actions that miss the exact-match check against
`legalActions` — should carry forward as-is; it's representation-agnostic. Audit
needed: does any *other* action type in these three games carry a continuous
coordinate that would need the same non-exact-match treatment (e.g. CS's grenade
`throw` — check whether throw targets should also become continuous, or intentionally
stay grid-snapped since a thrown grenade's landing tile is a coarser-grained concept
than a walked-to position; this is a product decision, not just an engineering one —
ask the user rather than assuming).

### 5. Client changes (`apps/design/`)

- `toGrid()` for the three continuous games: stop relying on `cells[]` to carry
  per-unit info at all (drop the `posMap`-by-exact-match pattern — see §3's note
  that this pattern needs removing). Add a new parallel array, e.g. `units: [{ id,
  x, y, glyph, unitName, owner, hp, maxHp, job, moveRange, ... }]`, with `x`/`y` as
  decimal strings (§2), built directly from `state.units` — no cell-grid indexing
  involved, so a unit's true (possibly non-integer) position always reaches the
  client. `cells[]` keeps only terrain fields for these games (color/terrain/bgImage)
  — drop glyph/unitId/hp/etc from it since nothing reads unit data from cells once
  `units` exists.
- `apps/design/App.vue`'s `buildField()`: branch on `g.locationType`. `'discrete'`
  keeps today's `g.cells.filter(c => c.glyph).map(...)` path completely unchanged.
  `'continuous'` builds the `units` array directly from `g.units` (parse decimal
  strings to `Number`, set `path: [[x, y]]` directly instead of `[[c.x+0.5,
  c.y+0.5]]` — no cell-center offset, since a continuous position already is the
  exact point, not a cell index needing a +0.5 nudge to its center).
- The move/hop animation watcher (`apps/design/App.vue`, `watch(liveState, ...)`,
  ~line 107-170) and its `fxSquare` combat-flash-position helper: currently diff
  `newState.grid.cells` by `unitId` to build the animation's `from`/`to`. Needs a
  `locationType === 'continuous'` branch that diffs `newState.grid.units` instead
  (already has `id`/`x`/`y` directly, no cell lookup needed). This session's
  straight-line-slide change (`steps: slide ? [from, to] : buildHopPath(...)`) stays,
  just re-gate `slide`/`fxSquare`'s source on `locationType` instead of
  `field.shapes?.length`.
- `apps/design/SchematicLayer.vue` / `apps/design/Battlefield.vue`: this session's
  click handling changes are close to correct and should mostly carry forward,
  re-gated on `locationType` instead of `field.shapes?.length`:
  - `SchematicLayer.vue`'s `handleBoardClick`/`_onDragEnd` already emit the exact
    continuous click point (`x, y`, un-floored) alongside `col, row` — keep this,
    it's representation-agnostic (still plain `Number` from pixel math; decimal-string
    conversion for the wire happens in `Battlefield.vue`'s `submitAction`, not here).
  - `legalMoveCircle`'s radius already prefers `u.moveRange` (added this session) —
    keep; this needs `moveRange` to keep flowing through `toGrid()`'s new `units`
    array (§ above already includes it).
  - `Battlefield.vue`'s `handleSqClick`: keep the "distance to selected unit ≤
    moveRange → submit `{type:'move', unitId, to:{x,y}}` directly; else deselect"
    logic — this is exactly what the user asked for (no snapping, click outside
    radius deselects). Just re-gate on `locationType` and convert `x`/`y` to
    whatever wire format §2 settles on before calling `submitAction`.

### 6. Verification

- Reuse this session's Playwright check (spin up a throwaway `api-server.js` on a
  non-3333 port per `reference_browser_testing` memory, route `localhost:3333/**` to
  it, don't touch the live session on 3333) — confirm: clicking anywhere within a
  Doom unit's move circle moves it to exactly that point (not the nearest cell),
  clicking outside the circle deselects with no request sent, and the token slides
  directly (single straight-line CSS transition, not a stepped hop).
  - Once the continuous `units` channel exists, additionally confirm a unit's
    position after such a move is a genuinely non-integer point in the returned
    session state (this is the check the retrofit couldn't pass before — a unit's
    position vanishing from `grid.cells` was the symptom of the blocking gap).
- Run a `demo/*.js` script for each of doom/cs/combatmission to completion (e.g.
  `npm run demo:combatmission:auto`) as a fast regression guard against
  reintroducing the `hasLOS` Bresenham infinite loop — an AI-only playthrough
  exercises `getLegalActions`/`hasLOS` heavily with no human continuous clicks
  involved, so it should be unaffected by this whole change and is a cheap way to
  catch a regression before it ever reaches a human session.
- Confirm chess (a `'discrete'` game, no `locationType` change) still animates with
  the old stepped hop and is otherwise completely unaffected — nothing in §3/§5
  should touch any file specific to a discrete game.
