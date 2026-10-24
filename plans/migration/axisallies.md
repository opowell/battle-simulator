# axisallies: capability checklist

What `axisallies` (AxisAllies) can do on 2026-10-24, before it moves to a repo of its own
(plans/generic-core-and-game-repos.md, phase 0 step 3). Phase 3 step 5 checks the
extracted game against it: its tests, its golden replays (`games/axisallies/golden.json`),
and every box below in the real UI. Generated from the game definition, its
README, its tests and its `toGrid`, then annotated by hand under **Notes**.

## Registry

- [ ] Seats 2–5; default table: `allies` (Allies), `axis` (Axis)
- [ ] Game module: `games/axisallies/index.js`, export `AxisAlliesGame`

## Setup options

| | Option | Type | Default | Values |
|---|---|---|---|---|
| [ ] | `mapZoom` Zoom & pan controls | boolean | `true` |  |
| [ ] | `fogOfWar` Fog of War | boolean | `false` |  |

## Scenarios

| | Scenario | Name | Config |
|---|---|---|---|
| [ ] | `wwii-1942` | WWII 1942 | — |

## Modes

- [ ] Space: continuous (native)
- [ ] Time: discrete (native)
- [ ] Turns: sequential and we-go offered (the engine's switch), default sequential. Random play, 30 steps from the default setup:
  sequential 30 plies in 30 steps, turn 1; we-go 411 plies in 3 steps, turn 1, ended (captured-moscow)
- [ ] Fog: switchable, default off; `getVisibleState`, belief sampling (`sampleWorlds`)

## AIs

- [ ] Built in for every game: random, greedy (on its own `evaluateState`), obscuro, generic

## Engine hooks it implements

`getVisibleState`, `sampleWorlds`, `evaluateState`, `createSetupUnit`, `foreignUnits`, `toGrid`

## UI

- [ ] `ui` flags: `hideGridLines`
- [ ] `toGrid` fields: `cells`, `height`, `locationType`, `shapes`, `ui`, `units`, `width`
- Plugins to move out of the play UI: none found

## Demos and benches

- [ ] `demo/axisallies-demo.js`
- [ ] `npm run demo:axisallies` (`node demo/axisallies-demo.js`)
- [ ] `npm run demo:axisallies:auto` (`node demo/axisallies-demo.js --auto`)

## Tests

- [ ] `fog.test.js`: 5 tests
- [ ] `golden.test.js`: 3 golden replays (default, scenario:wwii-1942, fog-on)
- [ ] `index.test.js`: 9 tests
- [ ] Also covered from outside its folder: `games/startingSetup.test.js`, `games/foreignUnits.test.js` and, where listed, `agents/greedy.test.js`, `agents/rollout.test.js`

## README

What [its README](../../games/axisallies/README.md) documents, each still true after the move:

- [ ] Players
- [ ] Units
- [ ] Phases
- [ ] Actions
- [ ] Special mechanics
- [ ] Capitals
- [ ] Territories
- [ ] Win conditions
- [ ] Run

## Art and other assets

- [ ] `images/`: 12 files, 175 KB

## What it uses from outside its folder

Each becomes a `#core/…` import in phase 1, or moves with the game.

- `engine/foreignUnits.js`
- `games/evalHelpers.js`
- `games/renderOptions.js`

## Notes

None yet.
