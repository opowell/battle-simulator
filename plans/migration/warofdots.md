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
- UI plugins: none (`src/gate.test.js` keeps game ids and imports out of the play UI)

## Demos and benches

None.

## Tests

- [ ] `fog.test.js`: 6 tests
- [ ] `golden.test.js`: 4 golden replays (default, scenario:standard, scenario:lakelands, scenario:divide)
- [ ] `index.test.js`: 30 tests
- [ ] The core's checks of it, in its `contract.test.js` since phase 1 (roster editing; the greedy and, with `SLOW_TESTS=1`, rollout agents where it has them), and its pack in `library/` (`src/library.test.js`)

## README

No README.

## Art and other assets

- [ ] `images/`: 2 files, 42 KB

## What it uses from outside its folder

Since phase 1 each is a `#core/…` import (or moved into the game).

- `src/engine/foreignUnits.js`
- `src/kit/terrainShapes.js`

## Notes

None yet.
