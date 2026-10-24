# aow: capability checklist

What `aow` (AncientArtOfWar) can do on 2026-10-24, before it moves to a repo of its own
(plans/generic-core-and-game-repos.md, phase 0 step 3). Phase 3 step 5 checks the
extracted game against it: its tests, its golden replays (`games/aow/golden.json`),
and every box below in the real UI. Generated from the game definition, its
README, its tests and its `toGrid`, then annotated by hand under **Notes**.

## Registry

- [ ] Seats 2–4; default table: `p1` (Player 1), `p2` (Player 2)
- [ ] Game module: `games/aow/index.js`, export `AowGame`

## Setup options

| | Option | Type | Default | Values |
|---|---|---|---|---|
| [ ] | `mapZoom` Zoom & pan controls | boolean | `true` |  |
| [ ] | `fogOfWar` Fog of War | boolean | `false` |  |

## Scenarios

| | Scenario | Name | Config |
|---|---|---|---|
| [ ] | `race` | Race for the Flags | — |
| [ ] | `epic` | War in the Mountains | `{"width":34,"height":20}` |

## Modes

- [ ] Space: continuous (native)
- [ ] Time: discrete (native)
- [ ] Turns: sequential and we-go offered (the engine's switch), default sequential. Random play, 30 steps from the default setup:
  sequential 30 plies in 30 steps, turn 4; we-go 295 plies in 30 steps, turn 31
- [ ] Fog: switchable, default off; `getVisibleState`, belief sampling (`sampleWorlds`)

## AIs

- [ ] Built in for every game: random, greedy (on its own `evaluateState`), obscuro, generic

## Engine hooks it implements

`getVisibleState`, `sampleWorlds`, `evaluateState`, `createSetupUnit`, `foreignUnits`, `getActionDuration`, `isActionLegal`, `toGrid`

## UI

- [ ] `ui` flags: `aimedActionTypes`, `hideGridLines`, `showFacing`
- [ ] `toGrid` fields: `cells`, `height`, `locationType`, `shapes`, `ui`, `units`, `width`
- Plugins to move out of the play UI: none found

## Demos and benches

- [ ] `demo/aow-demo.js`
- [ ] `npm run demo:aow` (`node demo/aow-demo.js`)
- [ ] `npm run demo:aow:auto` (`node demo/aow-demo.js --auto`)
- [ ] `npm run demo:aow:greedy` (`node demo/aow-demo.js --auto --greedy`)

## Tests

- [ ] `golden.test.js`: 4 golden replays (default, scenario:race, scenario:epic, fog-on)
- [ ] `index.test.js`: 17 tests
- [ ] Also covered from outside its folder: `games/startingSetup.test.js`, `games/foreignUnits.test.js` and, where listed, `agents/greedy.test.js`, `agents/rollout.test.js`

## README

What [its README](../../games/aow/README.md) documents, each still true after the move:

- [ ] Players
- [ ] Squads
- [ ] Soldiers (rock-paper-scissors)
- [ ] Terrain
- [ ] Map features
- [ ] Actions
- [ ] Combat
- [ ] Win conditions
- [ ] Options & scenarios
- [ ] Run

## Art and other assets

- [ ] `images/`: 5 files, 24 KB

## What it uses from outside its folder

Each becomes a `#core/…` import in phase 1, or moves with the game.

- `agents/learned/leafEval.js`
- `engine/foreignUnits.js`
- `games/continuousMove.js`
- `games/coord.js`
- `games/renderOptions.js`
- `games/terrainShapes.js`

## Notes

None yet.
