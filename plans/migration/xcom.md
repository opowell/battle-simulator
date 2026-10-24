# xcom: capability checklist

What `xcom` (X-Com Tactical) can do on 2026-10-24, before it moves to a repo of its own
(plans/generic-core-and-game-repos.md, phase 0 step 3). Phase 3 step 5 checks the
extracted game against it: its tests, its golden replays (`games/xcom/golden.json`),
and every box below in the real UI. Generated from the game definition, its
README, its tests and its `toGrid`, then annotated by hand under **Notes**.

## Registry

- [ ] Seats 2–2; default table: `xcom` (XCOM), `aliens` (Aliens)
- [ ] Game module: `games/xcom/index.js`, export `XComGame`

## Setup options

| | Option | Type | Default | Values |
|---|---|---|---|---|
| [ ] | `fogOfWar` Fog of War | boolean | `false` |  |

## Scenarios

| | Scenario | Name | Config |
|---|---|---|---|
| [ ] | `ufo-crash` | UFO Crash Site | — |

## Modes

- [ ] Space: discrete (native)
- [ ] Time: discrete (native)
- [ ] Turns: sequential and we-go offered (the engine's switch), default sequential. Random play, 30 steps from the default setup:
  sequential 30 plies in 30 steps, turn 3; we-go 367 plies in 30 steps, turn 31
- [ ] Fog: switchable, default off; `getVisibleState`, belief sampling (`sampleWorlds`)

## AIs

- [ ] Built in for every game: random, greedy (on its own `evaluateState`), obscuro, generic

## Engine hooks it implements

`getVisibleState`, `sampleWorlds`, `evaluateState`, `createSetupUnit`, `foreignUnits`, `getActionDuration`, `toGrid`

## UI

- [ ] `ui` flags: `isometric`, `showFacing`
- [ ] `toGrid` fields: `cells`, `height`, `width`
- Plugins to move out of the play UI: none found

## Demos and benches

- [ ] `demo/xcom-demo.js`
- [ ] `npm run demo:xcom` (`node demo/xcom-demo.js`)
- [ ] `npm run demo:xcom:auto` (`node demo/xcom-demo.js --auto`)
- [ ] `npm run demo:xcom:greedy` (`node demo/xcom-demo.js --auto --greedy`)

## Tests

- [ ] `fog.test.js`: 6 tests
- [ ] `golden.test.js`: 3 golden replays (default, scenario:ufo-crash, fog-on)
- [ ] `index.test.js`: 13 tests
- [ ] Also covered from outside its folder: `games/startingSetup.test.js`, `games/foreignUnits.test.js` and, where listed, `agents/greedy.test.js`, `agents/rollout.test.js`

## README

What [its README](../../games/xcom/README.md) documents, each still true after the move:

- [ ] Players
- [ ] Units
- [ ] XCOM squad
- [ ] Aliens
- [ ] Actions
- [ ] Special mechanics
- [ ] Map
- [ ] Win conditions
- [ ] Run

## Art and other assets

- [ ] `images/`: 9 files, 239 KB

## What it uses from outside its folder

Each becomes a `#core/…` import in phase 1, or moves with the game.

- `agents/learned/leafEval.js`
- `engine/foreignUnits.js`
- `games/evalHelpers.js`

## Notes

None yet.
