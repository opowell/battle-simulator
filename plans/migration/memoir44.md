# memoir44: capability checklist

What `memoir44` (Memoir 44) can do on 2026-10-24, before it moves to a repo of its own
(plans/generic-core-and-game-repos.md, phase 0 step 3). Phase 3 step 5 checks the
extracted game against it: its tests, its golden replays (`games/memoir44/golden.json`),
and every box below in the real UI. Generated from the game definition, its
README, its tests and its `toGrid`, then annotated by hand under **Notes**.

## Registry

- [ ] Seats 2–2; default table: `allies` (Allies), `axis` (Axis)
- [ ] Game module: `games/memoir44/index.js`, export `Memoir44Game`

## Setup options

| | Option | Type | Default | Values |
|---|---|---|---|---|
| [ ] | `mapZoom` Zoom & pan controls | boolean | `true` |  |

## Scenarios

| | Scenario | Name | Config |
|---|---|---|---|
| [ ] | `encounter` | Encounter | `{"scenario":"encounter"}` |
| [ ] | `pegasus-bridge` | Pegasus Bridge | `{"scenario":"pegasus-bridge"}` |

## Modes

- [ ] Space: discrete (native); board `hexagon`
- [ ] Time: discrete (native)
- [ ] Turns: sequential and we-go offered (the engine's switch), default sequential. Random play, 30 steps from the default setup:
  sequential 30 plies in 30 steps, turn 4; we-go 137 plies in 30 steps, turn 14
- [ ] Fog: no switch; no `getVisibleState`

## AIs

- [ ] Built in for every game: random, greedy (on its own `evaluateState`), obscuro, generic

## Engine hooks it implements

`evaluateState`, `createSetupUnit`, `foreignUnits`, `getActionDuration`, `toGrid`

## UI

- [ ] `ui` flags: `showFacing`, `showHpBars`, `showRoster`
- [ ] `toGrid` fields: `cells`, `grid`, `height`, `hexSize`, `width`
- UI plugins: none (`src/gate.test.js` keeps game ids and imports out of the play UI)

## Demos and benches

- [ ] `demo/memoir44-demo.js`

## Tests

- [ ] `golden.test.js`: 3 golden replays (default, scenario:encounter, scenario:pegasus-bridge)
- [ ] `index.test.js`: 21 tests
- [ ] The core's checks of it, in its `contract.test.js` since phase 1 (roster editing; the greedy and, with `SLOW_TESTS=1`, rollout agents where it has them), and its pack in `library/` (`src/library.test.js`)

## README

What [its README](../../games/memoir44/README.md) documents, each still true after the move:

- [ ] Board & sections
- [ ] A turn
- [ ] Units ([units.js](units.js))
- [ ] Battle dice ([combat.js](combat.js))
- [ ] Take Ground & Armor Overrun
- [ ] Terrain ([terrain.js](terrain.js))
- [ ] Scenarios ([scenarios.js](scenarios.js))
- [ ] Victory
- [ ] Scope
- [ ] Run it

## Art and other assets

None in its folder.

## What it uses from outside its folder

Since phase 1 each is a `#core/…` import (or moved into the game).

- `src/agents/learned/leafEval.js`
- `src/engine/foreignUnits.js`
- `src/kit/hexagon.js`
- `src/kit/renderOptions.js`

## Notes

None yet.
