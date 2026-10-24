# mudandblood: capability checklist

What `mudandblood` (Mud and Blood 2) can do on 2026-10-24, before it moves to a repo of its own
(plans/generic-core-and-game-repos.md, phase 0 step 3). Phase 3 step 5 checks the
extracted game against it: its tests, its golden replays (`games/mudandblood/golden.json`),
and every box below in the real UI. Generated from the game definition, its
README, its tests and its `toGrid`, then annotated by hand under **Notes**.

## Registry

- [ ] Seats 2–2; default table: `allies` (Allies), `axis` (Axis)
- [ ] Game module: `games/mudandblood/index.js`, export `MudAndBloodGame`

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
  sequential 30 plies in 30 steps, turn 3; we-go 406 plies in 20 steps, turn 20, ended (trench-breached)
- [ ] Fog: switchable, default off; `getVisibleState`, belief sampling (`sampleWorlds`)

## AIs

- [ ] Built in for every game: random, greedy (on its own `evaluateState`), obscuro, generic

## Engine hooks it implements

`getVisibleState`, `sampleWorlds`, `evaluateState`, `createSetupUnit`, `foreignUnits`, `getActionDuration`, `toGrid`

## UI

- [ ] `ui` flags: none
- [ ] `toGrid` fields: `cells`, `height`, `width`
- UI plugins: none (`src/gate.test.js` keeps game ids and imports out of the play UI)

## Demos and benches

- [ ] `demo/mudandblood-demo.js`

## Tests

- [ ] `fog.test.js`: 7 tests
- [ ] `golden.test.js`: 2 golden replays (default, fog-on)
- [ ] `index.test.js`: 18 tests
- [ ] The core's checks of it, in its `contract.test.js` since phase 1 (roster editing; the greedy and, with `SLOW_TESTS=1`, rollout agents where it has them), and its pack in `library/` (`src/library.test.js`)

## README

No README.

## Art and other assets

- [ ] `images/`: 9 files, 26 KB

## What it uses from outside its folder

Since phase 1 each is a `#core/…` import (or moved into the game).

- `src/agents/learned/leafEval.js`
- `src/engine/foreignUnits.js`
- `src/kit/evalHelpers.js`

## Notes

None yet.

## Moved (2026-10-24)

To [opowell/battle-mudandblood](https://github.com/opowell/battle-mudandblood),
built by `scripts/extract-game.mjs` and pinned to the core at the commit it left
from. Checked there: `npm test` (the game's 30 tests, its 2 golden replays among
them, plus the app's own 4; the rollout check skipped unless `SLOW_TESTS=1`, as
here) passes; in the Browser, driven headless, the default setup draws the
trench board with every unit's portrait served from its `images/`, a turn ends
and the AI takes its own, with no console error or failed request. Its pack (7
units with their art, 6 terrain types and the one map, "No Man's Land", opening
with the first wave and won by the Axis on the trench) was exported into
`library/mudandblood/` first. It has no scenarios, so only the default setup was
opened.
