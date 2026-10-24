# surviv: capability checklist

What `surviv` (Surviv) can do on 2026-10-24, before it moves to a repo of its own
(plans/generic-core-and-game-repos.md, phase 0 step 3). Phase 3 step 5 checks the
extracted game against it: its tests, its golden replays (`games/surviv/golden.json`),
and every box below in the real UI. Generated from the game definition, its
README, its tests and its `toGrid`, then annotated by hand under **Notes**.

## Registry

- [ ] Seats 2–2; default table: `blue` (Blue), `red` (Red)
- [ ] Game module: `games/surviv/index.js`, export `SurvivGame`

## Setup options

| | Option | Type | Default | Values |
|---|---|---|---|---|
| [ ] | `mapZoom` Zoom & pan controls | boolean | `true` |  |
| [ ] | `fogOfWar` Fog of War | boolean | `true` |  |

## Scenarios

| | Scenario | Name | Config |
|---|---|---|---|
| [ ] | `sandbar_island` | Sandbar Island | `{"mapId":"sandbar_island"}` |

## Modes

- [ ] Space: continuous (native)
- [ ] Time: discrete (native)
- [ ] Turns: sequential and we-go offered (the engine's switch), default sequential. Random play, 30 steps from the default setup:
  sequential 30 plies in 30 steps, turn 1; we-go 2691 plies in 30 steps, turn 31
- [ ] Fog: switchable, default on; `getVisibleState`, belief sampling (`sampleWorlds`)

## AIs

- [ ] Built in for every game: random, greedy (on its own `evaluateState`), obscuro, generic

## Engine hooks it implements

`getVisibleState`, `sampleWorlds`, `evaluateState`, `actionKey`, `createSetupUnit`, `foreignUnits`, `getActionDuration`, `isActionLegal`, `getSearchActions`, `toGrid`

## UI

- [ ] `ui` flags: `aimedActionTypes`, `fovDegrees`, `hideGridLines`, `recolorTeamSprites`, `showHpBars`, `visionRange`
- [ ] `toGrid` fields: `cells`, `height`, `locationType`, `los`, `shapes`, `ui`, `units`, `width`
- Plugins to move out of the play UI: none found

## Demos and benches

None.

## Tests

- [ ] `fog.test.js`: 7 tests
- [ ] `golden.test.js`: 3 golden replays (default, scenario:sandbar_island, fog-off)
- [ ] `index.test.js`: 16 tests
- [ ] Also covered from outside its folder: `games/startingSetup.test.js`, `games/foreignUnits.test.js` and, where listed, `agents/greedy.test.js`, `agents/rollout.test.js`

## README

No README.

## Art and other assets

- [ ] `images/`: 24 files, 151 KB

## What it uses from outside its folder

Each becomes a `#core/…` import in phase 1, or moves with the game.

- `engine/foreignUnits.js`
- `games/continuousMove.js`
- `games/coord.js` (3 imports)
- `games/evalHelpers.js`
- `games/renderOptions.js`
- `games/terrainShapes.js` (3 imports)
- `games/vision.js` (2 imports)

## Notes

None yet.
