# doom: capability checklist

What `doom` (Doom) can do on 2026-10-24, before it moves to a repo of its own
(plans/generic-core-and-game-repos.md, phase 0 step 3). Phase 3 step 5 checks the
extracted game against it: its tests, its golden replays (`games/doom/golden.json`),
and every box below in the real UI. Generated from the game definition, its
README, its tests and its `toGrid`, then annotated by hand under **Notes**.

## Registry

- [ ] Seats 2–2; default table: `marine` (Marine), `demons` (Demons)
- [ ] Game module: `games/doom/index.js`, export `DoomGame`

## Setup options

| | Option | Type | Default | Values |
|---|---|---|---|---|
| [ ] | `mapZoom` Zoom & pan controls | boolean | `true` |  |
| [ ] | `fogOfWar` Fog of War | boolean | `true` |  |

## Scenarios

| | Scenario | Name | Config |
|---|---|---|---|
| [ ] | `e1m1` | Hangar (E1M1) | — |

## Modes

- [ ] Space: continuous (native)
- [ ] Time: discrete (native)
- [ ] Turns: sequential and we-go offered (the engine's switch), default sequential. Random play, 30 steps from the default setup:
  sequential 30 plies in 30 steps, turn 1; we-go 958 plies in 30 steps, turn 31
- [ ] Fog: switchable, default on; `getVisibleState`, belief sampling (`sampleWorlds`)

## AIs

- [ ] Built in for every game: random, greedy (on its own `evaluateState`), obscuro, generic

## Engine hooks it implements

`getVisibleState`, `sampleWorlds`, `evaluateState`, `actionKey`, `createSetupUnit`, `foreignUnits`, `isActionLegal`, `getSearchActions`, `toGrid`

## UI

- [ ] `ui` flags: `aimedActionTypes`, `fovDegrees`, `hideGridLines`, `visionRange`
- [ ] `toGrid` fields: `cells`, `height`, `locationType`, `los`, `shapes`, `ui`, `units`, `width`
- Plugins to move out of the play UI: none found

## Demos and benches

- [ ] `demo/doom-demo.js`
- [ ] `npm run demo:doom` (`node demo/doom-demo.js`)
- [ ] `npm run demo:doom:auto` (`node demo/doom-demo.js --auto`)

## Tests

- [ ] `fog.test.js`: 8 tests
- [ ] `golden.test.js`: 3 golden replays (default, scenario:e1m1, fog-off)
- [ ] `index.test.js`: 14 tests
- [ ] `map.test.js`: 3 tests
- [ ] Also covered from outside its folder: `games/startingSetup.test.js`, `games/foreignUnits.test.js` and, where listed, `agents/greedy.test.js`, `agents/rollout.test.js`

## README

What [its README](../../games/doom/README.md) documents, each still true after the move:

- [ ] Players
- [ ] Units
- [ ] Marine
- [ ] Demons
- [ ] Weapons
- [ ] Actions
- [ ] Special mechanics
- [ ] Map layout
- [ ] Win conditions
- [ ] Run

## Art and other assets

- [ ] `images/`: 9 files, 141 KB

## What it uses from outside its folder

Each becomes a `#core/…` import in phase 1, or moves with the game.

- `agents/learned/leafEval.js`
- `engine/foreignUnits.js`
- `games/continuousMove.js`
- `games/coord.js` (4 imports)
- `games/evalHelpers.js`
- `games/renderOptions.js`
- `games/terrainShapes.js`
- `games/vision.js` (2 imports)

## Notes

None yet.
