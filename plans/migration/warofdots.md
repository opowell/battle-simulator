# warofdots: capability checklist

What `warofdots` (War of Dots) can do on 2026-10-24, before it moves to a repo of its own
(plans/generic-core-and-game-repos.md, phase 0 step 3). Phase 3 step 5 checks the
extracted game against it: its tests, its golden replays (`games/warofdots/golden.json`),
and every box below in the real UI. Generated from the game definition, its
README, its tests and its `toGrid`, then annotated by hand under **Notes**.

## Registry

- [ ] Seats 2–2; default table: `player` (You), `ai` (AI)
- [ ] Game module: `games/warofdots/index.js`, export `WarodDotsGame`

## Setup options

None of its own (the engine options only).

## Scenarios

| | Scenario | Name | Config |
|---|---|---|---|
| [ ] | `standard` | Standard | — |
| [ ] | `lakelands` | Lakelands | `{"scenario":"lakelands"}` |
| [ ] | `divide` | The Divide | `{"scenario":"divide"}` |

## Modes

- [ ] Space: discrete (native)
- [ ] Time: discrete (native)
- [ ] Turns: sequential and we-go offered (the engine's switch), default sequential. Random play, 30 steps from the default setup:
  sequential 30 plies in 30 steps, turn 1; we-go 4488 plies in 22 steps, turn 23, ended (capital-captured)
- [ ] Fog: no switch; `getVisibleState`, belief sampling (`sampleWorlds`)

## AIs

- [ ] Built in for every game: random, greedy (on its own `evaluateState`), obscuro, generic

## Engine hooks it implements

`getVisibleState`, `sampleWorlds`, `evaluateState`, `createSetupUnit`, `foreignUnits`, `toGrid`

## UI

- [ ] `ui` flags: `help`, `hideGridLines`
- [ ] `toGrid` fields: `cells`, `height`, `shapes`, `ui`, `width`
- Plugins to move out of the play UI: none found

## Demos and benches

None.

## Tests

- [ ] `fog.test.js`: 6 tests
- [ ] `golden.test.js`: 4 golden replays (default, scenario:standard, scenario:lakelands, scenario:divide)
- [ ] `index.test.js`: 30 tests
- [ ] Also covered from outside its folder: `games/startingSetup.test.js`, `games/foreignUnits.test.js` and, where listed, `agents/greedy.test.js`, `agents/rollout.test.js`

## README

No README.

## Art and other assets

- [ ] `images/`: 2 files, 42 KB

## What it uses from outside its folder

Each becomes a `#core/…` import in phase 1, or moves with the game.

- `engine/foreignUnits.js`
- `games/terrainShapes.js`

## Notes

None yet.
