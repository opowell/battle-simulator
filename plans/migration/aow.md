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
- UI plugins: none (`src/gate.test.js` keeps game ids and imports out of the play UI)

## Demos and benches

- [ ] `demo/aow-demo.js`
- [ ] `npm run demo:aow` (`node demo/aow-demo.js`)
- [ ] `npm run demo:aow:auto` (`node demo/aow-demo.js --auto`)
- [ ] `npm run demo:aow:greedy` (`node demo/aow-demo.js --auto --greedy`)

## Tests

- [ ] `golden.test.js`: 4 golden replays (default, scenario:race, scenario:epic, fog-on)
- [ ] `index.test.js`: 17 tests
- [ ] The core's checks of it, in its `contract.test.js` since phase 1 (roster editing; the greedy and, with `SLOW_TESTS=1`, rollout agents where it has them), and its pack in `library/` (`src/library.test.js`)

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

Since phase 1 each is a `#core/…` import (or moved into the game).

- `src/agents/learned/leafEval.js`
- `src/engine/foreignUnits.js`
- `src/kit/continuousMove.js`
- `src/kit/coord.js`
- `src/kit/renderOptions.js`
- `src/kit/terrainShapes.js`

## Notes

None yet.

## Moved (2026-10-24)

To [opowell/battle-aow](https://github.com/opowell/battle-aow), built by
`scripts/extract-game.mjs` and pinned to the core at the commit it left from.
Checked there: `npm test` (the game's 24 tests, its 4 golden replays among them,
plus the app's own 2; the rollout check skipped unless `SLOW_TESTS=1`, as here)
passes; in the Browser, driven headless, the default setup, `race` and `epic`
draw the continuous map with its terrain shapes, forts, villages and flags, the
Orders and Minimap panels open, and a squad's order goes through, with no
console error or failed request. Its pack (4 units, 6 terrain types, and the
`race` and `epic` worlds at the game's own seed) was re-exported into
`library/aow/` first.

Pre-existing, the same in the core today: the Orders panel lists no End Turn
while a squad still has orders (after Skip Unit it reads "No actions"), so the
headless check could not end a turn by its button.
