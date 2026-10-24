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
- UI plugins: none (`src/gate.test.js` keeps game ids and imports out of the play UI)

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
- [ ] The core's checks of it, in its `contract.test.js` since phase 1 (roster editing; the greedy and, with `SLOW_TESTS=1`, rollout agents where it has them), and its pack in `library/` (`src/library.test.js`)

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

Since phase 1 each is a `#core/…` import (or moved into the game).

- `src/agents/learned/leafEval.js`
- `src/engine/foreignUnits.js`
- `src/kit/continuousMove.js`
- `src/kit/coord.js` (6 imports)
- `src/kit/evalHelpers.js`
- `src/kit/renderOptions.js`
- `src/kit/spacetime.js`
- `src/kit/terrainShapes.js` (2 imports)

## Notes

None yet.
