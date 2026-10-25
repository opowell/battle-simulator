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
- UI plugins: none (`src/gate.test.js` keeps game ids and imports out of the play UI)

## Demos and benches

- [ ] `demo/doom-demo.js`
- [ ] `npm run demo:doom` (`node demo/doom-demo.js`)
- [ ] `npm run demo:doom:auto` (`node demo/doom-demo.js --auto`)

## Tests

- [ ] `fog.test.js`: 8 tests
- [ ] `golden.test.js`: 3 golden replays (default, scenario:e1m1, fog-off)
- [ ] `index.test.js`: 14 tests
- [ ] `map.test.js`: 3 tests
- [ ] The core's checks of it, in its `contract.test.js` since phase 1 (roster editing; the greedy and, with `SLOW_TESTS=1`, rollout agents where it has them), and its pack in `library/` (`src/library.test.js`)

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

Since phase 1 each is a `#core/…` import (or moved into the game).

- `src/agents/learned/leafEval.js`
- `src/engine/foreignUnits.js`
- `src/kit/continuousMove.js`
- `src/kit/coord.js` (4 imports)
- `src/kit/evalHelpers.js`
- `src/kit/renderOptions.js`
- `src/kit/terrainShapes.js`
- `src/kit/vision.js` (2 imports)

## Notes

None yet.

## Moved (2026-10-24)

To [opowell/battle-doom](https://github.com/opowell/battle-doom), built by
`scripts/extract-game.mjs` and pinned to the core at the commit it left from.
Checked there: `npm test` (the game's 31 tests, its 3 golden replays among them,
plus the app's own 4) passes, the one skip being the `SLOW_TESTS` rollout; in
the Browser, driven headless, the default setup and `e1m1` draw the level with
the marine's portrait and vision cone, and eight turns end (Escape, then End
Turn) with the demons' hidden moves coming back, with no console error or
failed request. Doom has no sounds. Its pack (7 units, 9 terrain types and the
`e1m1` map, from the new `scripts/export/doom.mjs`) was re-exported into
`library/doom/` first; its units did not change.

The map is rock with the level's shapes on it: the wall props (crates,
terminals, columns, barrels), then the nukage pools (impassable, see-through),
then the floor, so the core reads it by the game's own rules. Sampled against
the game, walkability differs on 6 points in 20,000 (the armour platform's oval,
a 16-sided polygon here) and sight on 3 lines in 20,000 (grazed corners). The
pickups are map features; the core has no items.

Pre-existing, the same in the core today: a turn opens with the marine in hand,
so End Turn is only offered once it is put down (Escape), and the headless
check could not end a turn by its button without that.
