# civ2: capability checklist

What `civ2` (Civ2) can do on 2026-10-24, before it moves to a repo of its own
(plans/generic-core-and-game-repos.md, phase 0 step 3). Phase 3 step 5 checks the
extracted game against it: its tests, its golden replays (`games/civ2/golden.json`),
and every box below in the real UI. Generated from the game definition, its
README, its tests and its `toGrid`, then annotated by hand under **Notes**.

## Registry

- [ ] Seats 2–4; default table: `p1` (Player 1), `p2` (Player 2)
- [ ] Game module: `games/civ2/index.js`, export `Civ2Game`

## Setup options

| | Option | Type | Default | Values |
|---|---|---|---|---|
| [ ] | `fogOfWar` Fog of War | boolean | `true` |  |
| [ ] | `width` Map width | range | `50` | 20–100 |
| [ ] | `height` Map height | range | `30` | 10–60 |
| [ ] | `seed` Map seed | integer | — |  |

## Scenarios

| | Scenario | Name | Config |
|---|---|---|---|
| [ ] | `standard` | Standard | — |

## Modes

- [ ] Space: discrete (native)
- [ ] Time: discrete (native)
- [ ] Turns: sequential and we-go offered (the engine's switch), default sequential. Random play, 30 steps from the default setup:
  sequential 30 plies in 30 steps, turn 5; we-go 249 plies in 30 steps, turn 31
- [ ] Fog: switchable, default on; `getVisibleState`, belief sampling (`sampleWorlds`)

## AIs

- [ ] Built in for every game: random, greedy (on its own `evaluateState`), obscuro, generic

## Engine hooks it implements

`getVisibleState`, `sampleWorlds`, `evaluateState`, `setupUnitTypes`, `createSetupUnit`, `foreignUnits`, `getActionDuration`, `toGrid`

## UI

- [ ] `ui` flags: `allowDiagonalHopsWhileMoving`, `freeSelection`, `isoTileMode`, `isoUnitStyle`, `isometric`, `teamColors`
- [ ] `toGrid` fields: `cells`, `height`, `width`
- UI plugins: none (`src/gate.test.js` keeps game ids and imports out of the play UI)

## Demos and benches

- [ ] `demo/civ2-demo.js`
- [ ] `npm run demo:civ2` (`node demo/civ2-demo.js`)
- [ ] `npm run demo:civ2:auto` (`node demo/civ2-demo.js --auto`)
- [ ] `npm run demo:civ2:greedy` (`node demo/civ2-demo.js --auto --greedy`)

## Tests

- [ ] `fog.test.js`: 5 tests
- [ ] `golden.test.js`: 3 golden replays (default, scenario:standard, fog-off)
- [ ] `index.test.js`: 14 tests
- [ ] The core's checks of it, in its `contract.test.js` since phase 1 (roster editing; the greedy and, with `SLOW_TESTS=1`, rollout agents where it has them), and its pack in `library/` (`src/library.test.js`)

## README

What [its README](../../games/civ2/README.md) documents, each still true after the move:

- [ ] Players
- [ ] Units
- [ ] Terrain Improvement, Diplomacy & Espionage
- [ ] Ancient Land
- [ ] Medieval Land
- [ ] Renaissance & Industrial Land
- [ ] Modern Land
- [ ] Air
- [ ] Sea
- [ ] Terrain
- [ ] Special resource bonuses
- [ ] Starting setup
- [ ] Map generation
- [ ] Scenarios
- [ ] Actions
- [ ] Special mechanics
- [ ] Win conditions
- [ ] Run

## Art and other assets

- [ ] `assets/`: 161 files, 218 KB
- [ ] `images/`: 2 files, 46 KB

## What it uses from outside its folder

Since phase 1 each is a `#core/…` import (or moved into the game).

- `src/agents/learned/leafEval.js`
- `src/engine/foreignUnits.js`
- `src/kit/evalHelpers.js`

## Notes

None yet.
