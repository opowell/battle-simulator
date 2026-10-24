# combatmission: capability checklist

What `combatmission` (CombatMission) can do on 2026-10-24, before it moves to a repo of its own
(plans/generic-core-and-game-repos.md, phase 0 step 3). Phase 3 step 5 checks the
extracted game against it: its tests, its golden replays (`games/combatmission/golden.json`),
and every box below in the real UI. Generated from the game definition, its
README, its tests and its `toGrid`, then annotated by hand under **Notes**.

## Registry

- [ ] Seats 2–2; default table: `p1` (Player 1), `p2` (Player 2)
- [ ] Game module: `games/combatmission/index.js`, export `CombatMissionGame`
- [ ] Engine defaults it declares (`defaultConfig`): `{"simultaneousTurns":true,"fogOfWar":true}`

## Setup options

| | Option | Type | Default | Values |
|---|---|---|---|---|
| [ ] | `mapZoom` Zoom & pan controls | boolean | `true` |  |
| [ ] | `fogOfWar` Fog of War | boolean | `true` |  |
| [ ] | `time` Time | select | `"continuous"` | continuous, discrete |

## Scenarios

| | Scenario | Name | Config |
|---|---|---|---|
| [ ] | `bocage` | Bocage | — |
| [ ] | `river_line` | River Line | `{"scenario":"river_line"}` |
| [ ] | `hill_woods` | Hill & Woods | `{"scenario":"hill_woods"}` |
| [ ] | `ambush` | Ambush | `{"scenario":"ambush"}` |

## Modes

- [ ] Space: continuous (native)
- [ ] Time: continuous and discrete
- [ ] Turns: sequential and we-go offered (the engine's switch), default we-go. Random play, 30 steps from the default setup:
  sequential 30 plies in 30 steps, turn 2; we-go 813 plies in 30 steps, turn 31
- [ ] Fog: switchable, default on; `getVisibleState`, belief sampling (`sampleWorlds`)

## AIs

- [ ] Built in for every game: random, greedy (on its own `evaluateState`), obscuro, generic

## Engine hooks it implements

`getVisibleState`, `sampleWorlds`, `evaluateState`, `actionKey`, `createSetupUnit`, `foreignUnits`, `getActionDuration`, `isActionLegal`, `getSearchActions`, `toGrid`

## UI

- [ ] `ui` flags: `aimedActionTypes`, `boxSelect`, `hideGridLines`, `showFacing`, `targetAim`
- [ ] `toGrid` fields: `cells`, `height`, `locationType`, `shapes`, `spaceType`, `timeType`, `ui`, `units`, `width`
- Plugins to move out of the play UI: none found

## Demos and benches

- [ ] `demo/combatmission-demo.js`
- [ ] `npm run demo:combatmission` (`node demo/combatmission-demo.js`)
- [ ] `npm run demo:combatmission:auto` (`node demo/combatmission-demo.js --auto`)

## Tests

- [ ] `art.test.js`: 4 tests
- [ ] `fog.test.js`: 6 tests
- [ ] `golden.test.js`: 10 golden replays (default, scenario:bocage, scenario:river_line, scenario:hill_woods, scenario:ambush, mode:continuous-sequential, mode:continuous-simultaneous, mode:discrete-sequential, mode:discrete-simultaneous, fog-off)
- [ ] `index.test.js`: 16 tests
- [ ] `rules.test.js`: 9 tests
- [ ] Also covered from outside its folder: `games/startingSetup.test.js`, `games/foreignUnits.test.js` and, where listed, `agents/greedy.test.js`, `agents/rollout.test.js`

## README

What [its README](../../games/combatmission/README.md) documents, each still true after the move:

- [ ] Players
- [ ] Units
- [ ] Actions
- [ ] Terrain
- [ ] How it looks
- [ ] Map layout
- [ ] Where units stand
- [ ] Special mechanics
- [ ] Win conditions
- [ ] Run

## Art and other assets

- [ ] `images/`: 15 files, 1.6 MB

## What it uses from outside its folder

Each becomes a `#core/…` import in phase 1, or moves with the game.

- `agents/learned/leafEval.js`
- `engine/foreignUnits.js`
- `games/continuousMove.js`
- `games/coord.js` (6 imports)
- `games/evalHelpers.js`
- `games/renderOptions.js`
- `games/spacetime.js`
- `games/terrainShapes.js` (2 imports)

## Notes

None yet.
