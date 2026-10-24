# civ1: capability checklist

What `civ1` (Civ1) can do on 2026-10-24, before it moves to a repo of its own
(plans/generic-core-and-game-repos.md, phase 0 step 3). Phase 3 step 5 checks the
extracted game against it: its tests, its golden replays (`games/civ1/golden.json`),
and every box below in the real UI. Generated from the game definition, its
README, its tests and its `toGrid`, then annotated by hand under **Notes**.

## Registry

- [ ] Seats 2–6; default table: `p1` (Player 1), `p2` (Player 2)
- [ ] Game module: `games/civ1/index.js`, export `Civ1Game`

## Setup options

| | Option | Type | Default | Values |
|---|---|---|---|---|
| [ ] | `civ` Your civilization | select | `"random"` | random, romans, babylonians, germans, egyptians, americans, greeks, indians, russians, zulus, french, aztecs, chinese, english, mongols |
| [ ] | `difficulty` Difficulty | select | `"prince"` | chieftain, warlord, prince, king, emperor, deity |
| [ ] | `contentBaseline` Content citizens (override) | integer | — |  |
| [ ] | `fogOfWar` Fog of War | boolean | `true` |  |
| [ ] | `barbarians` Barbarian activity | select | `"villages-only"` | villages-only, roving-bands, restless-tribes, raging-hordes |
| [ ] | `autoEndTurn` Auto-advance turn if action made | boolean | `true` |  |
| [ ] | `width` Map width | range | `50` | 20–100 |
| [ ] | `height` Map height | range | `30` | 10–60 |
| [ ] | `land` Land mass | select | `1` | 0, 1, 2 |
| [ ] | `temp` Temperature | select | `1` | 0, 1, 2 |
| [ ] | `climate` Climate | select | `1` | 0, 1, 2 |
| [ ] | `age` Age | select | `1` | 0, 1, 2 |
| [ ] | `seed` Map seed | integer | — |  |

## Scenarios

| | Scenario | Name | Config |
|---|---|---|---|
| [ ] | `desert-raiders` | Desert Raiders | `{"players":[{"name":"You"},{"name":"Raiders","agent":"civ1-heuristic"}],"fogOfWar":true}` |
| [ ] | `outpost` | Outpost | `{"players":[{"name":"You"},{"name":"Raiders","agent":"civ1-heuristic"}],"fogOfWar":true}` |
| [ ] | `mountain-pass` | Mountain Pass | `{"players":[{"name":"You"},{"name":"Defender","agent":"civ1-heuristic"}],"fogOfWar":true}` |
| [ ] | `caravan` | Caravan | `{"players":[{"name":"You"},{"name":"Defender","agent":"civ1-heuristic"}],"fogOfWar":true}` |
| [ ] | `two-rivers` | Two Rivers | `{"players":[{"name":"You"},{"name":"Defender","agent":"civ1-heuristic"}],"fogOfWar":true}` |
| [ ] | `siege` | Siege | `{"players":[{"name":"You"},{"name":"Defender","agent":"civ1-heuristic"}],"fogOfWar":true}` |
| [ ] | `standard` | Standard | `{"players":[{"name":"You"},{"name":"Greedy 1","agent":"greedy"},{"name":"Obscuro 1","agen…` |
| [ ] | `island-test` | Tiny Island | — |
| [ ] | `octagon-lake` | Octagon Lake | — |
| [ ] | `earth` | Earth | — |
| [ ] | `large-ai-exhibition` | Large AI Exhibition | `{"players":[{"name":"Obscuro 1","agent":"obscuro"},{"name":"Greedy 1","agent":"greedy"},{…` |
| [ ] | `small-ai-exhibition` | Small AI Exhibition | `{"players":[{"name":"Obscuro","agent":"obscuro"},{"name":"Greedy","agent":"greedy"}],"all…` |

## Modes

- [ ] Space: discrete (native)
- [ ] Time: discrete (native)
- [ ] Turns: sequential and we-go offered (the engine's switch), default sequential. Random play, 30 steps from the default setup:
  sequential 30 plies in 30 steps, turn 6; we-go 225 plies in 30 steps, turn 31
- [ ] Fog: switchable, default on; `getVisibleState`, belief sampling (`sampleWorlds`)

## AIs

- [ ] `obscuro` Obscuro (CFR)
- [ ] `civ1-heuristic` Heuristic
- [ ] Built in for every game: random, greedy (on its own `evaluateState`), obscuro, generic

## Engine hooks it implements

`getVisibleState`, `sampleWorlds`, `evaluateState`, `actionKey`, `applyStartingUnits`, `setupUnitTypes`, `createSetupUnit`, `foreignUnits`, `getActionDuration`, `isActionLegal`, `getSearchActions`, `toGrid`, `replayPaceMultiplier`

## UI

- [ ] `ui` flags: `allowDiagonalHopsWhileMoving`, `autoAdvanceUnit`, `autoEndTurn`, `battleAnimation`, `blinkActiveUnit`, `defaultTileSize`, `dragToMove`, `freeSelection`, `hideGridLines`, `hideMoveTargets`, `hideSelectedVision`, `keys`, `mapZoom`, `moveAnimation`, `moveQueue`, `persistentFog`, `recolorTeamSprites`, `showFacing`, `showHpBars`, `showRightSidebar`, `showRuler`, `teamColors`, `unitStacks`, `visionRange`
- [ ] `toGrid` fields: `arrivals`, `battles`, `cells`, `cities`, `civ`, `extraTeams`, `height`, `military`, `statusChips`, `turnLabel`, `ui`, `width`, `wrap`, `zones`
- UI plugins, moved out of the play UI in phase 1 (`uiPlugins`, `games/civ1/ui/`):
  - [ ] `CitiesOverlay`, `MilitaryOverlay`, `RatesOverlay`, `ScienceOverlay` (slot `overview`), reading `cities`, `military` and `civ` off its `toGrid`
  - [ ] `CityInspectorOverlay` with `city/*` (slot `city-screen`), opened by a city in `cities`
  - [ ] `ui.ownScreenActions` (rates, research and production are set on those screens) and `ui.actionLabels`

## Demos and benches

- [ ] `demo/civ1-bench.mjs`
- [ ] `demo/civ1-demo.js`
- [ ] `demo/civ1-siege-bench.mjs`
- [ ] `npm run demo:civ1` (`node demo/civ1-demo.js`)
- [ ] `npm run demo:civ1:auto` (`node demo/civ1-demo.js --auto`)
- [ ] `npm run demo:civ1:greedy` (`node demo/civ1-demo.js --auto --greedy`)
- [ ] `npm run demo:civ1:obscuro` (`node demo/civ1-demo.js --auto --obscuro`)

## Tests

- [ ] `ai.test.js`: 4 tests
- [ ] `attack.test.js`: 15 tests
- [ ] `barbarians.test.js`: 21 tests
- [ ] `battles.test.js`: 13 tests
- [ ] `civs.test.js`: 16 tests
- [ ] `difficulty.test.js`: 7 tests
- [ ] `economy.test.js`: 20 tests
- [ ] `fixedMaps.test.js`: 3 tests
- [ ] `fog.test.js`: 16 tests
- [ ] `fortress.test.js`: 6 tests
- [ ] `golden.test.js`: 14 golden replays (default, scenario:desert-raiders, scenario:outpost, scenario:mountain-pass, scenario:caravan, scenario:two-rivers, scenario:siege, scenario:standard, scenario:island-test, scenario:octagon-lake, scenario:earth, scenario:large-ai-exhibition, scenario:small-ai-exhibition, fog-off)
- [ ] `identity.test.js`: 9 tests
- [ ] `ids.test.js`: 4 tests
- [ ] `index.test.js`: 20 tests
- [ ] `multiplayer.test.js`: 19 tests
- [ ] `production.test.js`: 25 tests
- [ ] `remembered.test.js`: 7 tests
- [ ] `roads.test.js`: 5 tests
- [ ] `scenarios.test.js`: 12 tests
- [ ] `searchActions.test.js`: 9 tests
- [ ] `siege.test.js`: 23 tests
- [ ] `spacenuke.test.js`: 9 tests
- [ ] `stack.test.js`: 17 tests
- [ ] `tech.test.js`: 19 tests
- [ ] `units.test.js`: 4 tests
- [ ] `wonders.test.js`: 7 tests
- [ ] `zoc.test.js`: 18 tests
- [ ] The core's checks of it, in its `contract.test.js` since phase 1 (roster editing; the greedy and, with `SLOW_TESTS=1`, rollout agents where it has them), and its pack in `library/` (`src/library.test.js`)

## README

What [its README](../../games/civ1/README.md) documents, each still true after the move:

- [ ] Players
- [ ] Civilizations
- [ ] Units
- [ ] Terrain Improvement, Diplomacy & Trade
- [ ] Ancient Land
- [ ] Medieval Land
- [ ] Renaissance & Industrial Land
- [ ] Modern Land
- [ ] Missile & Air
- [ ] Sea
- [ ] Terrain Improvement & Diplomacy
- [ ] Ancient Land
- [ ] Medieval Land
- [ ] Renaissance & Industrial Land
- [ ] Modern Land
- [ ] Missile & Air
- [ ] Sea
- [ ] Terrain
- [ ] Zones of control
- [ ] Actions
- [ ] Economy & growth systems
- [ ] Barbarians
- [ ] Difficulty (game modes)
- [ ] Win conditions
- [ ] Scenarios
- [ ] Run

## Art and other assets

- [ ] `images/`: 345 files, 3.4 MB

## What it uses from outside its folder

Since phase 1 each is a `#core/…` import (or moved into the game).

- `src/agents/learned/leafEval.js`
- `src/agents/ObscuroAgent.js`
- `src/engine/foreignUnits.js`
- `src/kit/evalHelpers.js`
- `src/kit/moveQueue.js`
- `src/kit/spacetime.js`

## Notes

None yet.
