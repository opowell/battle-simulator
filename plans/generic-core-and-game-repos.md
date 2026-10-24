# A generic battle core, and every game in its own repo

## Goal

This repo becomes **the core**: a generic engine for battles, and the UI to play
them. A battle is defined along six axes, and the core supports every
combination of them:

| Axis | Values |
|---|---|
| **Units** | attack, defense, hit points, speed, vision, orientation, plus any number of attributes a game declares (mana, energy, shields, ammo, statuses, tags) |
| **Actions** | move, and act on another unit: attack, or any ability a game defines |
| **Board** | discrete (cells: square, hex, irregular regions) or continuous (exact points on a plane), with terrain types that change movement, cover and sight |
| **Time** | discrete (turns) or continuous (one clock; actions take time) |
| **Turns** | sequential or simultaneous |
| **Fog of war** | off or on |

Every game in `games/` today moves out to a **standalone JAS app in a repo of
its own**, keeping everything it can do now. There are three exceptions:

- **Arena** becomes the core's own ruleset.
- **csmini** is dropped. It is the less complete of the two Counter-Strikes
  (2 v 2, one map, one weapon, ~700 lines), and cs has everything it has and
  more: weapons, an economy, rounds, maps, an Obscuro AI and sound.
- **tactical** is dropped. FFTA covers it: a grid skirmish of classes and
  abilities, with more of everything. The template is `/Users/op/repos/fog-chess`: JAS as a
submodule, the app under `apps/<name>/`, `start.sh`/`start.cmd` on a port of its
own, `.githooks/` for the submodules, `npm test`.

What stays here is only what the six axes need: the engine, the generic ruleset,
the generic AIs, the server, and the Browser and play UI.

## Where things stand (2026-10-24)

A lot of the core already exists. The work is mostly separation, not invention.

- **Arena** (`games/arena/`) is already the generic battle: units that are only
  numbers (`hp attack defense range speed rate vision`), a terrain table, all
  eight (space × time × play) modes, fog. It has no orientation, no abilities, no
  open-ended attributes, one board topology (square cells) and one victory
  condition (elimination).
- **The generic AI** (`agents/generic/`) plays any game from unit numbers alone,
  in every mode, under fog.
- **The engine** (`engine/`) is already game-agnostic: sequential and we-go
  turns (`KineticResolver`), continuous time, fog via `getVisibleState`,
  mid-game reconfiguration, customised starting rosters, history diffs.
- **Shared helpers** in `games/*.js` are mostly generic too: `spacetime.js`,
  `coord.js`, `vision.js`, `continuousMove.js`, `terrainShapes.js`,
  `moveQueue.js`, `planQueue.js`, `mapTypes/hexagon.js`.

What ties the games to this repo:

1. **`api-server.js` imports all 22 games** and hard-codes the `GAMES` registry.
   `gameEditor.js` edits that registry's *source text*, and `catalog.js` reads
   `games/<name>/` from disk.
2. **The play UI is not game-agnostic yet**, despite `apps/README.md`. It has
   game-only components (`CitiesOverlay`, `CityInspectorOverlay`,
   `city/CityProductionBox`, `ScienceOverlay`, `RatesOverlay`, `MilitaryOverlay`,
   `DiceRollOverlay`, `DatabasePanel`, `DatabaseMoveList`, `BeliefWorldStepper`,
   chess's analysis worker, `cs-sound.js`, `chess-sound.js`) and branches keyed on
   game names (civ1, chess, risk and kdice show up most in `SessionView.vue`,
   `Battlefield.vue`, `HtmlLayer.vue` and `ActionsPanel.vue`). Many of those
   mentions are comments, but not all of them.
3. **Foreign units**: `registerGames(GAMES)` (`engine/foreignUnits.js`) lets
   every game field every other game's units. That needs every game imported
   into one process.
4. **Imports by relative path**: games reach into `../../engine/index.js`,
   `../../agents/...` and `../coord.js` (about 270 such imports), so they only
   work at this exact place in this tree.
5. **Shared non-generic code**: `starcraftSprite.js` and
   `mapTypes/starcraftMap.js` (sc1 and sc2), `vendor/obscuro-chess` and the
   Stockfish cache (chess only).
6. **Tests and demos**: `npm test` finds `games/**/*.test.js`, and
   `games/foreignUnits.test.js` and `games/startingSetup.test.js` import every
   game. `demo/` is per game.

There are no cross-game imports between game folders, which makes the split
much easier than it could have been.

## The core model

The core's ruleset is **Arena, generalised into `BattleGame`**: one
`GameDefinition` driven by a *battle spec*, which is data (JSON-serialisable, so
the Browser can edit it), plus optional JS hooks for what data can't say. A
scenario is a spec. A game repo can then be any of three things:

| Kind | What the repo supplies | Fits |
|---|---|---|
| **Spec** | unit types, terrain, abilities, scenarios, art | xcom, aow: battles the model can express |
| **Spec + hooks** | the above, plus JS for the rules data can't say (an ability's effect, a move shape, a victory test) | ffta, sc1/sc2 combat, chess's move shapes, memoir44 |
| **Custom game** | its own `GameDefinition` on the core SDK, as today | civ1/civ2 (economy), risk/kdice/axisallies (armies as counts), rogue, simcity |

The engine runs all three the same way, because all three are a
`GameDefinition` (`games/types.js` stays the contract). Migration does not
require moving a game *down* this table. That is optional later work
(phase 5).

### Units

**Core attributes**, which the engine, the generic AI and the UI understand
without being told:

| Attribute | Meaning |
|---|---|
| `hp`, `maxHp` | damage it takes to kill |
| `attack`, `defense` | how hard it hits, how well it resists |
| `range`, `rate` | how far it strikes, strikes per turn window |
| `speed` | movement points per turn window (`spacetime.js` derives every quadrant from it) |
| `vision` | how far it sees (a Euclidean radius, see the vision gotcha in memory) |
| `facing` | **new**: orientation as an angle. Optional: `fov` (a vision cone, as cs has), `arcs` (defense modifiers for front, flank and rear, as FFTA and XCOM have), `turnCost` (what turning costs in movement or time) |
| `domain` | how it moves: `ground`, `air`, `naval`, or a game's own movement class. Terrain prices are per class |

**Open-ended attributes: yes, it can be entirely open-ended.** But only
attributes the core is *told the meaning of* can take part in rules, the AI and
the UI without game code. So a unit's extra attributes are declared once per
ruleset, by kind:

| Kind | Example | What the core does with it |
|---|---|---|
| `number` | `armor` (sc1's flat damage reduction), `evasion` | carried, shown, readable in formulas |
| `pool` | `mp` (FFTA), `energy` and `shields` (StarCraft), `ammo` (cs) | current / max / regeneration per window; can be spent as a cost; a pool marked `absorbs` takes damage before `hp` (shields) |
| `tag` | `flying`, `mechanical`, `cloaked`, `detector`, `royal` | for target filters and rules: "ground units only", "a royal unit's loss loses the game" |
| `status` | `haste`, `blind`, `poison`, `stop` | timed (turns, or clock time), stacking rule, modifiers while active, an optional effect per tick |

**Abilities are data.** `attack` is just the default ability:

```js
{ id: 'fira', cost: { mp: 12 }, cooldown: 0, range: 4, area: { radius: 1 },
  targets: 'enemy', filter: { not: 'flying' }, los: true,
  windup: 0.5,                 // continuous time: how long before it lands
  effects: [{ damage: { power: 1.1, type: 'fire' } }, { status: 'blind', turns: 2 }] }
```

The **effect vocabulary** is small and closed: `damage`, `heal`, `modify`
(an attribute, by an amount, for a time), `status`, `cleanse`, `move` (knockback,
pull, teleport), `spawn`, `transform` (siege mode, burrow), `reveal`/`conceal`
(cloak and detection, which feed fog). `ffta/abilities.js` is already nearly
this shape (`power`, `mpCost`, `effect: 'damage+status'`, `knockback`). That is
the evidence the vocabulary is about right.

**Formulas** (damage, hit chance) are expressions over attributes, such as
`max(1, floor(attack^2 / (attack + defense * (1 + cover))))`, which is Arena's
strike. They are evaluated exactly (BigNumber, integers in, integers out) per
the *exact quantities* rule. A ruleset names its own formula; Arena's is the
default.

**The escape hatch** is what makes it truly open-ended. An effect, a formula, a
move rule or a victory test may name a function exported by the game's module
(`{ fn: 'psionicStorm' }`). The data stays serialisable, and anything at all is
possible.

**How the generic AI copes with attributes it has never seen:** it already plans
by simulation. The beam search applies real actions through `applyActions` and
judges what results. An ability's value therefore shows up as what it does to
the position, with no special knowledge needed. Two additions make the
evaluation see the rest: a pool is worth what it can still buy (its abilities'
simulated value at the margin), and a declaration may carry an explicit `value`
weight. What the AI will *not* see is an effect hidden behind `fn` that only
pays off beyond its search depth. That is the honest cost of the escape hatch,
and it is the same limitation the generic AI README reports today for cs-mini, the game phase 2's close-quarters scenario replaces.

### Board

Discrete space is **a graph of cells**, and continuous space is **a plane
with regions**:

| | Discrete | Continuous |
|---|---|---|
| Positions | cell ids | exact points (BigNumber) |
| Topologies | `square` (4- or 8-neighbour), `hex`, `regions` (irregular territories with an adjacency list: risk, kdice, axisallies) | one plane |
| Terrain | a type per cell | convex polygons, plus walls and windows (block movement, not sight). Convex only, so that events and sight stay exactly calculable (see the cs shape-map memory) |
| Options | `wrap` (civ's cylinder), `elevation` per cell (FFTA, XCOM) | `elevation` per region |
| Stacking | `one` / `stack` (civ1's best defender plus stack death) / `count` (armies as a number) | bodies with a radius (Arena's `UNIT_R`) |

**Terrain types** are data, a table like Arena's but per movement class:

```js
forest: { cost: { ground: 2, air: 1 }, passable: { naval: false },
          cover: 50, blocksSight: false, concealment: 2, elevation: 0 }
```

Everything that measures crosses terrain exactly, as `arena/geometry.js` does
today: the length a path spends in each cell, not a sample.

### Time, turns, fog

These exist already and move into `BattleGame` as they are in Arena:
`spacetime.js` for the four quadrants, the engine's we-go path for simultaneous
discrete time, `nativelySimultaneous` for a game that runs its own clock. Fog
gains the inputs the new unit model brings: the vision cone (`facing`, `fov`),
`concealment`, and `cloaked`/`detector` tags. It also gains one option the games
already have between them: `fog: 'off' | 'on' | 'remembered'`, where
`remembered` shows fogged ground as last seen (civ1's remembered ground).

### Victory

Elimination alone is not enough for the games that will be built on the spec.
The core gets a small objective set: `eliminate`, `lose-if-royal-dies` (chess's
king, an escort's VIP), `hold` cells or regions for N windows, `reach` a cell,
`survive` N windows, and points at the turn limit. A custom test is again a
`fn`. civ1's battle ladder already has objective types like these. Lift them
from there.

## The core as an SDK

Game repos depend on the core the way fog-chess depends on obscuro-chess: as a
submodule at `vendor/battle-simulator`.

### One import surface

Every game imports the core through **Node subpath imports**, never a relative
path out of its own folder:

```json
// core's package.json                      // a game repo's package.json
"imports": { "#core/*": "./src/*" }          "imports": { "#core/*": "./vendor/battle-simulator/src/*" }
```

```js
import { GameEngine, BattleGame } from '#core/engine/index.js';
```

This works without `node_modules`, which matters because both repos commit
their dependencies. The browser gets the same mapping from an import map, as the
Browser already does for appfr. Inside this repo, phase 1 rewrites the games to
`#core/...` while they still live here. That is the step that makes the move
mechanical.

### A server you construct

`api-server.js` becomes a factory:

```js
createBattleServer({ games: { civ1: { game: Civ1Game, minPlayers: 2, ... } },
                     agents, uiPlugins, sessionsDir, cacheDir })
```

Its JAS mount (the embedded-mode default export) and its standalone
`node api-server.js` both call it. In this repo `games` is the core ruleset's
scenarios; in a game repo it is that one game. Two traps to fix on the way:

- `httpServer.__battleSimulatorUpgradeAttached` is a **process-wide** flag. Two
  battle apps inside one JAS would share it, and the second one's WebSockets
  would never attach. Key it by route prefix.
- `gameEditor.js` rewrites the `GAMES` object in `api-server.js` *as source
  text*. With an injected registry that has to become a registry file (JSON) or
  go. Recommendation: each game repo has a `games.json` the editor writes, and
  the server reads it at startup.

### UI plugins

The play UI keeps its generic vocabulary: `toGrid` and the ~50 `ui.*` flags
(`ui.persistentFog`, `ui.unitStacks`, `ui.targetAim`, …) cover most of what
games need. For the rest, a game ships **plugins**: Vue components (panels,
overlays, inspectors), sounds and workers, listed in a manifest the server hands
the client:

```js
uiPlugins: [{ id: 'civ1-cities', kind: 'overlay', src: '/civ1/ui/CitiesOverlay.vue', when: 'ui.empirePanels' },
            { id: 'chess-sound',  kind: 'sound',   src: '/chess/ui/chess-sound.js' }]
```

The play UI mounts them through named slots (sidebar panel, board overlay,
unit inspector, action-panel section, sound, analysis worker). This is generic
UI infrastructure, so per the *generic features in appfr* rule, check first
whether appfr's panel registry already covers it, and add it upstream if it
doesn't.

**A gate test** keeps the core honest. It fails if any file under `engine/`,
`agents/`, `apps/` or `src/` imports from a game, or contains a game id as a
string literal. Comments are exempt; they may keep using civ1 as an example.

### The library: units, terrain and maps from every game, here only

Mixing games is a **core** feature: units, terrain types and whole maps. The
standalone games don't mix. A civ1 game in its own repo fields civ1 units on
civ1 maps and nothing else. Here, a `BattleGame` scenario can put a marine, a
knight and a chess rook on de_dust2, or on civ1's world.

`registerGames(GAMES)` can't stay as it is, because the games will no longer be
here to import. What the core needs from each game is data, so it keeps it as
data, in a **library**:

```
library/<game>/
  units.json      each unit type in core attributes, plus the game's scale and factor
  terrain.json    each terrain type in the core terrain format
  maps/<id>.json  each map as a core board, plus how the original draws it
  art/            unit sprites, terrain tiles, map art, each stored once per game
  pack.json       what was exported, from which game commit, and what was left out
```

**Units** are exported from what every game declares today:
`foreignUnits.profiles()`, `art()`, `scale`, `factor`, `fold`.

**Terrain** has no shared declaration to read. Each game keeps its own table in
its own shape. About 11 games have one (civ1, civ2, sc1, sc2, aow, memoir44,
combatmission, xcom, mudandblood, warofdots, Arena), cs, doom and surviv build
terrain from drawn shapes, and chess and kdice have none. So each game gets a
small mapping in the exporter (`scripts/export/<game>.mjs`) into the core
format: cost per movement class, passable, cover, blocks sight, concealment,
elevation. Unit domains are mapped onto the same movement classes, so a civ1
trireme and a StarCraft dropship price the same terrain the same way.

**Maps** are exported in two halves:

- *Rules*: the board in the core format. For discrete boards that is the
  topology (square, hex, regions), the terrain id and elevation of each cell,
  adjacency for regions, and wrap. For continuous boards it is the bounds and
  the convex shapes, walls and windows, each with a terrain id. It also carries
  `starts` (where each side deploys in the original) and `features`, named
  markers (cities, bomb sites, bases, flags) that a scenario may turn into
  `hold` or `reach` objectives.
- *Drawing*: the static part of the game's own `toGrid` output (cells, `shapes`,
  `los`). The generic play UI already draws every game's board from `toGrid`, so
  the library map looks like the original without any game code.

Which maps to export:

| The game's maps are | Games | Exported |
|---|---|---|
| fixed boards | ffta, xcom, sc1, sc2, memoir44, mudandblood, chess, warofdots | every scenario's board |
| shape maps | cs, doom, surviv, combatmission | every scenario's board, shapes and all |
| generated | civ1, civ2, kdice, rogue, aow (in part) | every fixed scenario's board, plus a few seeded worlds; the generator stays with the game |
| territories | risk, axisallies, kdice | each map as a `regions` board |

**Scale.** A map comes with its source game's `scale`, and the map plays the
role the host game plays today: `engine/foreignUnits.js` converts every unit
into the map's game's numbers (hp, attack and defense by `scale` and `factor`,
range and move by board distance). A marine on civ1's world moves and shoots
in civ1 squares.

**What a pack can't carry.** Rules the core can't express are dropped and
listed in `pack.json`'s `omitted`, for example civ1's river trade, sc1's creep
and cs's smoke. A library map plays as its terrain, not as its game.

How the library is maintained:

- `scripts/export-pack.mjs <game-dir>` writes a game's pack. It runs once for
  each game, *before* that game is extracted, while it is still importable
  here. A later change in a game reaches the library only when the export is
  re-run against the game's repo (it takes a path).
- `engine/foreignUnits.js` stays in the core and converts into `BattleGame`
  only. It no longer converts into other games, so the hosting half of the
  `foreignUnits` contract (`table` + `write`, `adopt`, `realize`, `absorb`)
  goes. `games/foreignUnits.test.js` becomes a test that every pack in
  `library/` meets the core schemas, every map loads, and every unit can stand
  on every map.
- On extraction, a game drops its `foreignUnits` declaration and the hosting
  code behind it. Its starting-units editor offers only its own types.

This repo is **public**, and the packs carry original game art: StarCraft
sprites, civ1 tiles, de_dust2. That is no worse than today, since all of that
art is already here, but it is the one place where commercial art would stay
public after the game repos go private (see open decisions).

## What stays and what goes

| Path | Fate |
|---|---|
| `engine/`, `agents/` (Random, Greedy, Generic, Obscuro adapter, `cfr.js`, `learned/`), `vendor/obscuro`, `vendor/appfr`, `vendor/ws` | stays (into `src/`) |
| `games/arena/` | stays, becomes `BattleGame` and its scenarios |
| `engine/foreignUnits.js` | stays, converting only into `BattleGame` |
| `library/` (new) | every game's units, terrain types and maps, with their art, exported before the game leaves |
| `games/tactical/`, `games/csmini/`, `demo/tactical-demo.js`, `demo/csmini-demo.js` | deleted, along with their registry entries and UI branches |
| `games/spacetime.js`, `coord.js`, `vision.js`, `continuousMove.js`, `terrainShapes.js`, `moveQueue.js`, `planQueue.js`, `formatAction.js`, `renderOptions.js`, `evalHelpers.js`, `types.js`, `mapTypes/hexagon.js` | stays: these are the board, time and turn machinery |
| `games/starcraftSprite.js` | audit: team-colour recolouring is generic (`ui.recolorTeamSprites`) and moves into the core; the sprite-sheet layout goes to the StarCraft repos |
| `games/mapTypes/starcraftMap.js` | StarCraft repos |
| `api-server.js`, `catalog.js`, `gameEditor.js` | stay, refactored around an injected registry |
| `apps/browser`, `apps/game-editor` | stay, minus the game components, which become plugins in their games' repos |
| `vendor/obscuro-chess`, `games/chess/vendor/sf-cache.*` | chess repo |
| every other `games/<name>/` | its own repo |
| `demo/<game>-*.js`, the benches | each with its game; `generic-ai-bench.mjs` stays |
| `sessions/` (git-ignored recordings) | each game's recordings are copied to its repo's `sessions/`; nothing to commit |

## The game repos

One repo per game, made from the fog-chess layout:

```
battle-<game>/
  apps/<game>/server.js       createBattleServer({ games: { <game>: … } }) on the app's route
  apps/<game>/game/           what is games/<game>/ today (rules, art, scenarios, tests)
  apps/<game>/ui/             its plugins
  apps/<game>/settings.json   route, servers
  vendor/jas                  submodule
  vendor/battle-simulator     submodule (the core; carries obscuro-ai and appfr inside)
  start.sh, start.cmd         JAS on this repo's apps/, on its own port
  .githooks/                  submodule update --init --recursive after merge/checkout/rebase
  test/
```

Each repo keeps its history, extracted with `git filter-repo --path games/<game>
--path demo/<game>-demo.js ...` and then moved into place.

The repos holding original game art (sc1, sc2, civ1, civ2, cs, ffta, doom, xcom,
memoir44 and others, whatever the audit finds) are **private**, as fog-chess is.

## Phases

### Phase 0: pin down "current capabilities"

"Migrated with their current capabilities" needs a definition we can check
against, per game, before anything moves. The steps are in the order to do
them:

1. **Golden replays**: for each game and scenario, a seeded run (`rng` config,
   RandomAgent, a fixed turn count) hashing the final state and the log. Commit
   the hashes. A migrated game must reproduce them exactly, which catches every
   silent rules change the move causes.
   They come first because they are the safety net for everything after,
   including step 2: dropping two games must leave every other game's replays
   unchanged.
2. **Drop tactical and csmini**, after moving what the core leans on them for.
   They are its test fixtures, so they can't simply be deleted:

   | Uses | Replace with |
   |---|---|
   | `agents/generic/generic.test.js` (reading units, playing a game) | Arena scenarios |
   | `agents/obscuro.test.js` (Obscuro runs on a non-chess game) | Arena |
   | `agents/greedy.test.js`, `agents/rollout.test.js` (every game in a list) | drop the two entries now; the lists go with phase 1's per-game tests |
   | `gameEditor.test.js` (edits tactical's registry entry) | arena's entry |
   | `agents/learned/train.mjs` (tactical in its game table) | drop the entry |
   | `demo/generic-ai-bench.mjs`: *Tactical vs Greedy on Tactical's evaluator* | FFTA vs Greedy on FFTA's evaluator, the same comparison against a hand-written evaluator, on the game that replaces tactical |
   | `demo/generic-ai-bench.mjs`: *CS-mini*, the measured weakness (facing, vision cones, reloading) | cs, until phase 2's facing scenario exists in the core (see phase 2, step 8) |
   | `apps/browser/play/gameDefaults.js`, `SessionView.vue`, `HtmlLayer.vue`, `Battlefield.vue`, `HtmlUnit.vue`, `source.js` | remove the csmini/tactical branches; keep whatever they made generic |
   | `agents/generic/README.md`'s *Measured* table, the README games table and demo list | re-measured with the new bench, and the two rows removed |

   Before deleting either, check that nothing it does is missing from its
   replacement. Most importantly, every csmini mode (all four space × time
   quadrants, sequential and we-go) must have a counterpart in cs or Arena.
   Where one is missing, note it in `plans/migration/cs.md`, which starts cs's
   checklist (step 3), rather than keep csmini.
3. **A capability checklist per game** (`plans/migration/<game>.md`): its
   scenarios, setup options, which space/time/turn/fog modes it supports, its
   AIs, its plugins (from the UI audit above), the `ui.*` flags it sets, its
   demos and benches. Drawn from its README, its tests and its `toGrid`.

What happens to the unregistered `rogue` and `simcity` is a decision, not a
step (see open decisions). Until it is made they get replays and checklists
like every other game.

### Phase 1: decouple inside this repo

This is most of the work, and it is all testable in one tree. At the end, every
game is *ready to lift out* but nothing has left.

1. Move the core into `src/` (engine, agents, shared helpers, server), add the
   `#core/*` import mapping, and rewrite every game's imports to it.
2. `createBattleServer({ games, … })`. The `GAMES` registry moves out of
   `api-server.js` into `games/registry.js`, which still imports all of them for
   now. Fix the WebSocket-attach flag and the game editor.
3. The play UI plugin mechanism. Move every game-only component, sound and
   branch out of `apps/browser` into `games/<game>/ui/`, then turn on the gate
   test. The branches are the slow part: each one becomes either an existing
   `ui.*` flag, a new generic flag (when two or more games want it), or a plugin.
4. The library replaces `registerGames`. Write `scripts/export-pack.mjs` and
   each game's terrain mapping, export every game's pack into `library/`, and
   point `engine/foreignUnits.js` at the library, converting into `BattleGame`
   only. Then remove the cross-game hosting from the games, and turn
   `games/foreignUnits.test.js` into the library's test. Terrain and maps need
   phase 2's topologies and terrain format first (steps 1 and 5), so the
   units can go first and the rest follows.
   `games/startingSetup.test.js` becomes per-game tests.
5. Split `npm test` per game, so that each game's tests pass from its folder
   alone.

Golden replays and `npm test` stay green after every step.

### Phase 2: the generic model (in parallel with phase 1)

Grow Arena into `BattleGame`, one axis at a time, each step with tests in all
eight modes:

1. The spec format and a loader. Arena's presets and terrain become its first
   spec.
2. Orientation: `facing`, `fov`, defense arcs, turn cost. This includes the
   continuous-time `face` task and vision cones in fog.
3. Declared attributes: `number`, `pool` (with `absorbs`), `tag`, `status`.
4. Abilities and the effect vocabulary, exact formulas, the `fn` escape hatch.
5. Board topologies: hex, regions, elevation, per-class terrain costs, stacking
   modes.
6. Victory objectives.
7. The generic AI: abilities through its existing simulation, pool and status
   valuation, facing. Measure as the README does, in seat-swapped pairs.
8. Reference scenarios that use each feature, with no names or art from other
   games: a magic skirmish (mp, statuses, area spells), a sci-fi one (energy,
   shields, cloak and detection, air and ground), a hex one, a regions one, and
   a **close-quarters** one (vision cones, facing, an `ammo` pool with a
   reload). That last one inherits csmini's job as the generic AI's measured
   weak spot, and moves into the bench in place of cs.
9. **Mixed** scenarios: units from several games on library maps (a square
   grid, a hex board, a regions board and a shape map at least), so the library
   is tested in play and not only by its schema test. The scenario picker
   offers every library map, and the units editor every library unit.

### Phase 3: extract the games, one by one

Least coupled first, so the template gets proven on easy cases:

| Wave | Games | Why this order |
|---|---|---|
| 1 | xcom, aow, memoir44 | small, few or no plugins |
| 2 | doom, surviv, mudandblood, warofdots, combatmission, cs | continuous space, shape maps, sounds |
| 3 | risk, kdice, axisallies | regions topology, dice overlay, armies as counts |
| 4 | ffta, sc1, sc2 | big art, abilities, the StarCraft shared code |
| 5 | civ1, civ2 | the largest plugin set (cities, science, rates, military) |
| 6 | chess | obscuro-chess, Stockfish cache, the client-side analysis worker and its browser-safety traps |

For each game:

1. Re-export its pack into `library/` and check that the pack is complete:
   every unit, every terrain type and every map, and an `omitted` list that
   covers everything the core can't carry. After this step the game can no
   longer be imported here to export it.
2. Create the repo from the template and extract its history with
   `filter-repo`.
3. Add `vendor/battle-simulator` pinned to the current core commit.
4. Write `server.js` around `createBattleServer`, move in its plugins, and
   remove its `foreignUnits` declaration and hosting code.
5. Check: its tests pass, its golden replays match, and its capability
   checklist holds in the real UI, driven headlessly with Playwright per the
   *prefer headless testing* feedback (a screen lock is needed only for the
   final real-browser check). Mixing in foreign units is not on the checklist,
   because it stays here.
6. In the same change on this side, delete `games/<game>/` and its registry
   entry, plugins, demos and benches. Record the repo in the README's games
   table. Its pack stays in `library/`.

Up to three games can be extracted at once by sub-agents, each in its own
worktree (the *max three sub-agents* feedback).

### Phase 4: clean up the core

1. Drop `vendor/obscuro-chess` and anything else only a game used.
2. The core app is the battle sandbox: `BattleGame` scenarios, the spec editor
   (the game editor, retargeted from files to specs), the generic AIs, the
   Browser.
3. Rewrite README and CLAUDE.md for the core. The game list becomes a list of
   links to repos.
4. Tag a release (`v1.0.0`) so game repos pin tags, not commits.

### Phase 5 (optional, per game): rebase onto the spec

Where the model fits, replace a game's own rules with a spec plus hooks:
xcom and aow first, then ffta and sc1/sc2 combat. The golden
replays tell you whether the rebuilt game still plays the same. Each game is
smaller afterwards and gets every core feature for free.

## Living with the split

- **A core change reaches games only by a bump.** `scripts/bump-games.sh`, in
  the core, clones or updates each game repo, bumps its `vendor/battle-simulator`,
  runs its tests and reports, so that an engine change can be checked against
  every game before it is tagged.
- **Contract tests ship with the core** (`src/contract.test.js`: a
  `GameDefinition` is pure, fog leaks nothing, a roster round-trips, a state
  survives reconfigure). Every game repo runs them against its own game.
- **Version skew**: like the two `obscuro-ai` pins today, a game repo carries the
  core, and the core carries obscuro-ai and appfr. A game must never vendor
  those separately.
- Traps that carry over: new worktrees start from origin/main, not local main;
  `git worktree remove` fails on submodules; JAS loads `server.js` only at
  startup; the Browser runs Vue 3.5 while the old apps run 3.4; a worktree has
  no `sessions/`.

## Decided (2026-10-24)

- **cs stays and csmini goes**: csmini is the less complete of the two.
- **tactical goes**: FFTA covers it.
- **Mixing is core-only**: units, terrain types and maps from every game are
  copied into `library/` and combined only in the core's `BattleGame`. The
  standalone games don't mix.
- **Lift and shift** (phase 3), with the rewrite onto the spec left as optional
  phase 5. Rewriting every game before it moves would put every current
  capability at risk at once.

## Open decisions

Each has a recommendation. The plan above assumes it.

1. **The library's art in a public repo.** battle-simulator is public, and
   the packs would keep sprites, tiles and map art from commercial games in it after their own
   repos go private. That is no change from today, where all of that art is
   already here. *Recommend* keeping it as it is for now. The alternatives are
   glyph-and-colour packs here, with real art only where the game repo is installed
   alongside, or a private `library-art` submodule.
2. **sc1 and sc2 share code.** *Recommend* two repos, with the generic part of
   `starcraftSprite.js` moved into the core and the rest (sprite-sheet layout,
   `starcraftMap.js`) living in sc1 and vendored into sc2 as a submodule. The
   alternative is one `battle-starcraft` repo with two apps.
3. **Chess**: a new `battle-chess` repo (*recommended*: it carries the
   simulator's chess, with its four space × time quadrants, analysis panel and
   database), or fold it into `fog-chess`. Later, fog-chess could build on
   battle-chess.
4. **`rogue` and `simcity`** aren't in the registry, and simcity isn't a battle.
   *Recommend* extracting both as they are, unregistered, so nothing is lost,
   and deciding their future there.
5. **Names and visibility**: `opowell/battle-<game>`; private wherever there is
   original game art.
6. **This repo's name**: keep `battle-simulator` (*recommended*: links, the
   submodule path and fog-chess's README already point at it) or rename it to
   `battle-core`.
