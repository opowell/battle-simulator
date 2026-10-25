# surviv: capability checklist

What `surviv` (Surviv) can do on 2026-10-24, before it moves to a repo of its own
(plans/generic-core-and-game-repos.md, phase 0 step 3). Phase 3 step 5 checks the
extracted game against it: its tests, its golden replays (`games/surviv/golden.json`),
and every box below in the real UI. Generated from the game definition, its
README, its tests and its `toGrid`, then annotated by hand under **Notes**.

## Registry

- [ ] Seats 2–2; default table: `blue` (Blue), `red` (Red)
- [ ] Game module: `games/surviv/index.js`, export `SurvivGame`

## Setup options

| | Option | Type | Default | Values |
|---|---|---|---|---|
| [ ] | `mapZoom` Zoom & pan controls | boolean | `true` |  |
| [ ] | `fogOfWar` Fog of War | boolean | `true` |  |

## Scenarios

| | Scenario | Name | Config |
|---|---|---|---|
| [ ] | `sandbar_island` | Sandbar Island | `{"mapId":"sandbar_island"}` |

## Modes

- [ ] Space: continuous (native)
- [ ] Time: discrete (native)
- [ ] Turns: sequential and we-go offered (the engine's switch), default sequential. Random play, 30 steps from the default setup:
  sequential 30 plies in 30 steps, turn 1; we-go 2691 plies in 30 steps, turn 31
- [ ] Fog: switchable, default on; `getVisibleState`, belief sampling (`sampleWorlds`)

## AIs

- [ ] Built in for every game: random, greedy (on its own `evaluateState`), obscuro, generic

## Engine hooks it implements

`getVisibleState`, `sampleWorlds`, `evaluateState`, `actionKey`, `createSetupUnit`, `foreignUnits`, `getActionDuration`, `isActionLegal`, `getSearchActions`, `toGrid`

## UI

- [ ] `ui` flags: `aimedActionTypes`, `fovDegrees`, `hideGridLines`, `recolorTeamSprites`, `showHpBars`, `visionRange`
- [ ] `toGrid` fields: `cells`, `height`, `locationType`, `los`, `shapes`, `ui`, `units`, `width`
- UI plugins: none (`src/gate.test.js` keeps game ids and imports out of the play UI)

## Demos and benches

None.

## Tests

- [ ] `fog.test.js`: 7 tests
- [ ] `golden.test.js`: 3 golden replays (default, scenario:sandbar_island, fog-off)
- [ ] `index.test.js`: 16 tests
- [ ] The core's checks of it, in its `contract.test.js` since phase 1 (roster editing; the greedy and, with `SLOW_TESTS=1`, rollout agents where it has them), and its pack in `library/` (`src/library.test.js`)

## README

No README.

## Art and other assets

- [ ] `images/`: 24 files, 151 KB

## What it uses from outside its folder

Since phase 1 each is a `#core/…` import (or moved into the game).

- `src/engine/foreignUnits.js`
- `src/kit/continuousMove.js`
- `src/kit/coord.js` (3 imports)
- `src/kit/evalHelpers.js`
- `src/kit/renderOptions.js`
- `src/kit/terrainShapes.js` (3 imports)
- `src/kit/vision.js` (2 imports)

## Notes

None yet.

## Moved (2026-10-24)

To [opowell/battle-surviv](https://github.com/opowell/battle-surviv), built by
`scripts/extract-game.mjs` and pinned to the core at the commit it left from.
Checked there: `npm test` (the game's 28 tests, its 3 golden replays among them,
plus the app's own 4) passes; in the Browser, driven headless, the default setup
and `sandbar_island` draw the island with both squads, vision cones and hp bars,
and turns end and come back (Escape, then End Turn: ten turns, red's moves
hidden). Its pack (6 units, 10 terrain types and the `sandbar_island` map, from
the new `scripts/export/surviv.mjs`) was re-exported into `library/surviv/`
first; its units did not change.

The map is grass with the game's shapes on it in its own order; bushes conceal
(the core's `concealment`, at the game's spotting range of 1.6). Sampled against
the game, walkability differs on 0.7% of points (the rims of the ovals, 16-sided
polygons here) and sight on 8 lines in 9,000 between open points; a unit
standing in a bush on a forest's rim is blind in surviv and not here. Loot is
kept as map features, and crates and barrels don't break.

Pre-existing, the same in the core today: every page asks for
`/images/surviv/weapons/fists`, which does not exist (404), for the fists a
player starts with.
