# simcity: capability checklist

What `simcity` (SimCity) can do on 2026-10-24, before it moves to a repo of its own
(plans/generic-core-and-game-repos.md, phase 0 step 3). Phase 3 step 5 checks the
extracted game against it: its tests, its golden replays (`games/simcity/golden.json`),
and every box below in the real UI. Generated from the game definition, its
README, its tests and its `toGrid`, then annotated by hand under **Notes**.

## Registry

- Not in the server's registry (see the plan's open decision 4). Its golden replays seat `mayor`.
- [ ] Game module: `games/simcity/index.js`, export `SimCityGame`

## Setup options

| | Option | Type | Default | Values |
|---|---|---|---|---|
| [ ] | `fogOfWar` Fog of War | boolean | `false` |  |

## Scenarios

None: one setup, from its options.

## Modes

- [ ] Space: discrete (native)
- [ ] Time: discrete (native)
- [ ] Turns: sequential and we-go offered (the engine's switch), default sequential. Random play, 30 steps from the default setup:
  sequential 30 plies in 30 steps, turn 1; we-go 1579 plies in 30 steps, turn 31
- [ ] Fog: switchable, default off; `getVisibleState`

## AIs

- [ ] Built in for every game: random, greedy (on its own `evaluateState`), obscuro, generic

## Engine hooks it implements

`getVisibleState`, `evaluateState`

## UI

- [ ] `ui` flags: none
- [ ] `toGrid` fields: 
- Plugins to move out of the play UI: none found

## Demos and benches

None.

## Tests

- [ ] `fog.test.js`: 14 tests
- [ ] `golden.test.js`: 2 golden replays (default, fog-on)
- [ ] `index.test.js`: 22 tests
- [ ] Also covered from outside its folder: `games/startingSetup.test.js`, `games/foreignUnits.test.js` and, where listed, `agents/greedy.test.js`, `agents/rollout.test.js`

## README

No README.

## Art and other assets

None in its folder.

## What it uses from outside its folder

Each becomes a `#core/…` import in phase 1, or moves with the game.

Nothing.

## Notes

Not registered in the server, single-seat, and not a battle. Kept until the
plan's open decision 4 is made: the recommendation is to extract it as it is.
