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
- UI plugins: none (`src/gate.test.js` keeps game ids and imports out of the play UI)

## Demos and benches

None.

## Tests

- [ ] `fog.test.js`: 7 tests
- [ ] `golden.test.js`: 3 golden replays (default, scenario:sandbar_island, fog-off)
- [ ] `index.test.js`: 16 tests
- [ ] The core's checks of it, in its `contract.test.js` since phase 1 (roster editing; the greedy and, with `SLOW_TESTS=1`, rollout agents where it has them), and its pack in `library/` (`src/library.test.js`)

## README

No README.

## Art and other assets

- [ ] `images/`: 24 files, 151 KB

## What it uses from outside its folder

Since phase 1 each is a `#core/…` import (or moved into the game).

- `src/engine/foreignUnits.js`
- `src/kit/continuousMove.js`
- `src/kit/coord.js` (3 imports)
- `src/kit/evalHelpers.js`
- `src/kit/renderOptions.js`
- `src/kit/terrainShapes.js` (3 imports)
- `src/kit/vision.js` (2 imports)

## Notes

None yet.
