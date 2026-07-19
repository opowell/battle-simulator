# Civ1 AI — design notes

Reference material for building a stronger civ1 agent than the greedy one in
[demo/civ1-demo.js](../../demo/civ1-demo.js). Sources are cited inline; where a claim is
sourced from reverse-engineering of the original game it says so, and where it is a design
proposal for *this* codebase it says that instead. Don't blur the two.

## Sourcing caveat (read first)

The authoritative Civ1 AI writeups are darkpanda's CivFanatics threads, which pull directly
from a disassembly of `CIV.EXE`. **The detailed pseudo-code they refer to lived in pastebin
links that are now dead.** What survives in the threads is structural description, not
constants or formulas. So the numbers below are ours; only the *shape* is inherited. If
someone recovers the pastebins (or reads them out of the OpenCiv1 disassembly directly),
this doc should be revisited — the real weights would be worth having.

- [Civ1 explained: AI unit movements](https://forums.civfanatics.com/threads/civ1-explained-ai-unit-movements.526708/)
  — the "unit's orders" routine, 3rd-largest in `CIV.EXE`.
- [CivOne Request: AI City building Logic](https://forums.civfanatics.com/threads/civone-request-ai-city-building-logic.648274/)
  — production selection and the personality axes.
- [Civ 1 explained: AI wonders](https://forums.civfanatics.com/threads/civ-1-explained-ai-wonders.656707/)
  — mainly a warning; see "What not to copy".
- [OpenCiv1](https://forums.civfanatics.com/threads/openciv1-project-open-source-preservation-effort-and-rewrite-of-the-iconic-1991-civilization-game.682623/)
  and [CivOne](https://github.com/Solen1985/CivOne) — disassembly and a C# reimplementation.
  CivOne's issue tracker is usually more readable than its commits.
- **[Freeciv `doc/README.AI`](https://github.com/freeciv/freeciv/blob/master/doc/README.AI)** —
  the best source here by some margin, and unlike the Civ1 threads it's complete and current.
  Use this rather than the [Freeciv wiki page](https://freeciv.fandom.com/wiki/AI_Documentation),
  which is thinner and 402s to automated fetches.

### What we took from Freeciv

- **`want` / `adv_choice`.** Every build or action decision carries a scalar "want". Scale:
  0 = don't, ≤100 = normal, >100 = critical, >200 capped. The doc admits the real code
  violates its own scale — treat it as a convention, not a law.
- **`kill_desire`** — the attack EV formula, adopted directly in [ai.js](ai.js):
  `profit = shields_destroyed × P(win) − shields_risked × P(lose)`, then amortized. Note it
  values units in **shields** (build cost), not HP. Our `UNITS[type].cost` is already that.
- **`amortize(benefit, delay) = benefit × ((MORT−1)/MORT)^delay`**, `MORT=24` (~4.3%/turn
  discount). Discounts a payoff by how many turns away it is — this is how a distant target
  loses out to a near one without a separate distance term.
- **`military_advisor_choose_build`** picks defenders first, and only shops for attackers once
  home is safe. Then `ai_choose_attacker_*` picks a prototype by a crude `attack_power × speed`,
  `find_something_to_kill` finds it a victim, and `process_attacker_want` re-refines the unit
  type against that specific victim. The two-pass shape (rough prototype → refine against the
  real target) is worth stealing if we ever get a production choice.
- **Small-pox settling**: many small coastal cities with overlapping workable radii, sites
  scored against a virtual size-20 city.
- **Stated warnings** worth heeding: city danger assessment ignores units already en route to
  defend, and cities get founded without evaluating threat at the site. Both are exactly the
  mistakes our step-3 settle scoring would make by default.

## What the original AI actually did

Confirmed by the threads, at the structural level:

- **Unit movement is a one-ply scorer over the 8 neighbours.** For each unit, the routine
  scores the desirability of each adjacent square and stores the winner in a unit byte field
  (`unknown9`) as the square to move to next turn. Score inputs: the unit's assigned **role**,
  the **contents of the target square**, and the **likelihood of winning a battle** there.
  There is no search and no lookahead.
- **Continent policy.** Each turn the AI assigns every continent one of *settle/develop*,
  *attack*, *defend*, or *transport*, based on local military balance and city capacity. This
  is the layer that gives unit roles their meaning, and it's the piece the current greedy
  agent has no analogue for.
- **Production uses diminishing returns per unit type.** As the AI accumulates militia, or
  chariots, or cavalry, its desire for more of that type falls — which is why it drifts toward
  roughly equal counts of every available land unit rather than massing the best one.
- **Personality axes.** Aggression, Development, and Militarism form a 9-value matrix biasing
  research and build priorities per civ.
- **Hard-coded quirks**, straight from the disassembly: the AI never builds Carriers; it won't
  build Militia unless the government is Despotism; nukes cap at 4 built / 2 in progress. For
  sea and air units, owning *zero* of a type spikes the desire for one to maximum.

## What not to copy

The Civ1 AI is not good. It is a one-ply heuristic that leans on cheating — most notably it
**receives Wonders for free** rather than earning them. The threads also note it produces
settlers poorly and can deadlock deterministically, endlessly pursuing a unit it can't build.
Copy the *structure* (roles, continent policy, per-neighbour scoring) because it's cheap and
it fits the engine. Take the *quality* bar from Freeciv instead.

## What this codebase can actually decide

Grounding, from [Civ1Game.js:123-171](Civ1Game.js#L123-L171) — the legal action set is:

`move`, `attack`, `found-city` (settlers, non-ocean, no city present), `build-road`
(settlers, non-ocean, no road yet), `skip-unit`, `end-turn`.

Two consequences worth being blunt about:

1. **There is no production decision to make.** Cities are created with `production: 'militia'`
   ([Civ1Game.js:282](Civ1Game.js#L282)) and `processCityProduction`
   ([Civ1Game.js:96](Civ1Game.js#L96)) just spawns that item on a timer. Nothing ever changes
   `city.production`, and no action exposes it. **All the personality-matrix and
   diminishing-returns material above is unreachable until a `set-production` action exists.**
   Adding one is a prerequisite, not part of the AI work.
2. **There is no tech, government, or diplomacy.** So the Aggression/Development/Militarism
   axes have almost nothing to bias yet. Defer them.

That leaves unit movement, attacking, and settling as the whole decision surface — which is
exactly the part the unit-movements thread covers. Good alignment.

## The current greedy agent, and why it's weak

[demo/civ1-demo.js:7](../../demo/civ1-demo.js#L7): attack if any attack is legal; else found a
city if legal; else move every unit toward the nearest enemy unit or city by Manhattan
distance; else drift toward map centre.

Its concrete failures:

- **Attacks unconditionally**, with no reference to win probability. It will throw settlers-
  escorting militia at a fortified phalanx on mountains. Combat is
  `p = att/(att+def)` per round with terrain and city multipliers already computed for us by
  `getCombatStrengths` ([combat.js:4](combat.js#L4)) — the information is right there, unused.
- **Every unit has the same goal.** No roles. Settlers path toward enemies alongside legions.
- **`found-city` fires the instant it's legal**, so cities land on whatever tile the settler
  happened to reach, with no site quality check and no spacing.
- **Distance metric is wrong.** It uses Manhattan `dist`, but movement is Chebyshev-adjacent
  (8 neighbours, [Civ1Game.js:141-146](Civ1Game.js#L141-L146)) on an x-wrapping map
  (`wrapDX`). Diagonal targets are scored as twice as far as they are, and targets across the
  seam as nearly a map-width away.

The wrap bug is worth fixing on its own, independent of any redesign.

## Proposed design

Ours, not the original's. Structure borrowed from Civ1, evaluation borrowed from Freeciv.

### 1. Roles

Assign once per unit per turn, before scoring:

| Role | Assigned to | Wants |
| --- | --- | --- |
| `settle` | settlers with no escort need | high-value unclaimed city sites |
| `defend` | best defender in/near each city | to sit on the city tile |
| `attack` | offensive units when the continent policy is *attack* | winnable fights, enemy cities |
| `explore` | spare cheap units early | unseen tiles (fog is on by default) |
| `develop` | settlers near owned cities | road tiles between cities |

### 2. Continent policy

Per continent per turn, from a flood-fill over land tiles: compare own vs. enemy unit strength
present, plus whether there's room left to settle. *settle* while good sites remain and no
enemy pressure; *defend* when outnumbered locally; *attack* when strength ratio clears a
threshold (start at 1.5×) and an enemy city is reachable. This gates role assignment.

### 3. Per-neighbour scoring

Keep the original's one-ply shape. For each unit, score each legal `move`/`attack` and take
the max. Score is role-weighted:

- **Attack candidates**: expected value, not distance. Compute `p = att/(att+def)` from
  `getCombatStrengths`, roll it forward over the HP race to a win probability `P`, then score
  `P * value(target) - (1-P) * value(self)`. Never attack below a floor (start at `P > 0.5`,
  tune it). This alone should beat the current agent decisively.
- **Movement**: `-chebyshevWrapped(to, goal)` toward the role's goal, plus a terrain defence
  term for `defend` units, plus an unseen-tile bonus for `explore`.
- **Settling**: score sites on food/shields/trade in the workable radius, fresh water, and
  distance from existing cities (penalise below ~4 tiles). Only emit `found-city` when the
  current tile is within some margin of the best site the settler knows about; otherwise move
  toward that site.

### 4. Distance

Add a shared `chebyshevWrapped(a, b, width)` helper using the existing `wrapDX`, and use it
everywhere. The current Manhattan `dist` is simply the wrong metric for this board.

## Evaluation

[agents/LEARNED-EVAL-PLAN.md:121](../../agents/LEARNED-EVAL-PLAN.md#L121) flags civ1 as
"very long games — truncated-outcome", which is the real obstacle to a learned eval here.
Two implications:

- Gate progress on **head-to-head win rate vs. the current greedy agent**, over a fixed seed
  set, at `maxTurns: 150` (as [demo/civ1-demo.js:73](../../demo/civ1-demo.js#L73) uses). A new
  agent should beat greedy well above 50% before any of this is considered done.
- `evaluateState` ([Civ1Game.js:508](Civ1Game.js#L508)) is currently
  `unitStrengthEval + 100/city`. It's a reasonable truncation heuristic and the scorer above
  can share its value terms — keep them consistent so the agent isn't optimising against a
  different objective than it's scored on.

If a learned eval is attempted later, [HUBERT](https://web.stanford.edu/class/aa228/reports/2018/final51.pdf)
(Stanford AA228, RL on Freeciv) is the closest prior art.

## Measured result: steps 1–2 did not work, and the reason is structural

Steps 1 and 2 below were implemented ([ai.js](ai.js)) and benchmarked head-to-head against the
greedy baseline, 40 seeds x 2 sides = 80 games, sides swapped to cancel map advantage.

**Outcome: 53.1% — a coin flip.** Mean `evaluateState` margin was *negative* (−10.4, favouring
greedy). Sweeping `minWinProb` across 0.0 / 0.25 / 0.5 / 0.7 moved the score between 47% and
57% non-monotonically: noise, not signal. Correct-distance + EV-gated attacking is, on current
evidence, worth nothing.

Instrumenting the agents' actual decisions ([diag output](#)) explains why, and none of it is
about the AI:

- **Each side founds exactly one city, ever.** `found-city` is chosen once per game per side.
  There is one settler, and `city.production` is hardcoded to `militia`
  ([Civ1Game.js:282](Civ1Game.js#L282)) — so no further settlers are ever built and no
  expansion is possible. There is no economy to play.
- **Contact is rare or absent.** Over ~1000–3500 decisions per game, an attack was legal on
  only ~50–70 of them. On seed 3, the two civs never met at all: zero attack opportunities in
  150 turns. An attack-quality improvement cannot matter if attacks barely happen.
- **95% of games are draws** (76/80 `max-turns`). Winning requires `getResult`
  ([Civ1Game.js:312](Civ1Game.js#L312)) to see a side with no cities *and* no units. With one
  permanent city each and no way to expand, that essentially never fires.

The gate itself works as designed — it took 22 of 53 offered attacks where greedy took all 55,
and on seed 2 it won the unit war 10–1. It just doesn't convert, because there's nothing to
convert into.

### Bug found along the way

**An undefended city cannot be captured.** Ownership only transfers inside the attack handler
([Civ1Game.js:261-266](Civ1Game.js#L261-L266)), when an attacker kills a defender standing on
the city tile. `getReachableTiles` ([map.js](map.js)) blocks movement onto enemy *units* but
not enemy *cities*, so a unit can walk onto an empty enemy city and simply stand there while it
stays enemy-owned. Any "capture the undefended city" plan silently fails today.

## Round 2: the game now resolves, and the two metrics disagree

`set-production` + settler production + capture-by-occupation are implemented (see below).
Games now resolve: decisive outcomes went from **4/80 to 18/80**. Expansion works — the
heuristic reaches 3–6 cities where it used to be stuck on 1.

But the benchmark now says two contradictory things at once, 40 seeds x 2 sides:

| metric | heuristic vs greedy |
| --- | --- |
| truncated games, ahead on `evaluateState` | **60 – 2** (mean margin **+645**) |
| decisive games (someone actually destroyed) | **2 – 16** |

The heuristic snowballs a bigger empire on every seed it survives, and gets wiped out outright
far more often than greedy does. **Do not quote the 77.5% "overall score"** — it's an artifact
of scoring truncated games by a proxy that weights cities at 100 each
([Civ1Game.js:508](Civ1Game.js#L508)) while the actual win condition is annihilation.

Sweeping `cityTarget` (1/2/3/6) shows the material lead is entirely an expansion effect
(5% → 43% → 70% → 72% overall) — but the decisive record stays bad at *every* setting
(1–10, 3–7, 2–9, 0–13). **The fragility is not caused by over-expansion.** Even with expansion
effectively off, the heuristic loses decisive games ~10:1.

Leading suspects, untested:

- **Militia spam is genuinely strong in this ruleset.** Militia costs 10 and is 1/1; the
  heuristic's `attack*speed/cost` pick lands on cavalry (2/1, cost 20) — twice the price, and
  *defense 1*. Greedy fields ~2x the bodies, and with attack≈defense across ancient units,
  numbers decide.
- **One garrison per city is too thin** against a 46-militia swarm, now that capture works.
- The EV gate may make it decline defensive fights it needs to take.

### The long-game run settles it: greedy is actually better

Running to `maxTurns: 600` so most games resolve (12/30 decisive) removes the proxy and gives
the verdict directly:

- decisive games: heuristic **2 – 10** greedy
- truncated (still 18/30): heuristic ahead 12 – 5, margin +231

So the disagreement resolves in greedy's favour: **when games actually finish, the "smarter"
agent loses roughly 1:5.** The empire-building is real but it does not translate into winning,
and against militia-spam it loses the war. The margin metric was measuring the wrong thing.

Blunt conclusion: cheap-unit spam is a strong strategy in this ruleset (ancient units are
near-symmetric in attack/defense, so bodies win), and a one-garrison-per-city posture with
20-shield cavalry can't hold against 10-shield militia in quantity. Beating greedy for real
needs either matching its unit economics or a defensive stance that actually holds cities —
not more expansion.

### The evaluation problem is now the blocker

`evaluateState` and the win condition disagree strongly enough that tuning against the margin
actively misleads (that's how cityTarget=6 looks best while going 0–13). Before more agent
work: either weight the eval to reflect that annihilation is what wins, or run long enough
games that decisive outcomes carry the signal. This is the civ1 half of the "truncated-outcome"
problem in [LEARNED-EVAL-PLAN.md:121](../../agents/LEARNED-EVAL-PLAN.md#L121), and it is no
longer deferrable.

## Revised order

The original plan had `set-production` last, as an unlock for the personality material. That
was wrong. It is the **prerequisite for the game resolving at all**, and therefore for any AI
work being measurable. Nothing downstream can be evaluated until games have outcomes.

1. **`set-production` action + settler production.** Without expansion there is one city per
   side, no economy, and no win condition. This is the blocker.
2. **Fix undefended-city capture** (move onto an empty enemy city should take it). Without it
   the win condition stays nearly unreachable.
3. Re-run the benchmark. Only once a decent share of games resolve does a win rate mean
   anything — and only then is it worth re-testing whether the EV attack gate helps.
4. Roles + settle-site scoring.
5. Continent policy.

`chebyshevWrapped` (step 1 below) was a genuine bug fix and is worth keeping regardless — it's
now used by fog-of-war vision and action duration too. The EV attack machinery in
[ai.js](ai.js) is sound and sourced; it's parked until there's a game for it to win.

## Original order (superseded)

1. Fix the distance metric (`chebyshevWrapped`). Standalone bug. — **done**
2. Win-probability-gated attacking. — **done, no measurable effect; see above**
3. Roles + settle-site scoring.
4. Continent policy.
5. Only then: a `set-production` action, which unlocks the production material above.
