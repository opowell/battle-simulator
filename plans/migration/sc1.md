# sc1: capability checklist

What `sc1` (SC1) can do on 2026-10-24, before it moves to a repo of its own
(plans/generic-core-and-game-repos.md, phase 0 step 3). Phase 3 step 5 checks the
extracted game against it: its tests, its golden replays (`games/sc1/golden.json`),
and every box below in the real UI. Generated from the game definition, its
README, its tests and its `toGrid`, then annotated by hand under **Notes**.

## Registry

- [ ] Seats 2–4; default table: `p1` (Player 1), `p2` (Player 2)
- [ ] Game module: `games/sc1/index.js`, export `Sc1Game`
- [ ] Engine defaults it declares (`defaultConfig`): `{"simultaneousTurns":true}`

## Setup options

| | Option | Type | Default | Values |
|---|---|---|---|---|
| [ ] | `mapZoom` Zoom & pan controls | boolean | `true` |  |
| [ ] | `spriteSet` Unit art | select | `"original"` | original, remastered |

## Scenarios

| | Scenario | Name | Config |
|---|---|---|---|
| [ ] | `tvz` | Terran vs Zerg | `{"race1":"terran","race2":"zerg"}` |
| [ ] | `pvt` | Protoss vs Terran | `{"race1":"protoss","race2":"terran"}` |
| [ ] | `zvp` | Zerg vs Protoss | `{"race1":"zerg","race2":"protoss"}` |

## Modes

- [ ] Space: continuous (native)
- [ ] Time: discrete (native)
- [ ] Turns: sequential and we-go offered (the engine's switch), default we-go. Random play, 30 steps from the default setup:
  sequential 30 plies in 30 steps, turn 2; we-go 915 plies in 30 steps, turn 31
- [ ] Fog: no switch; `getVisibleState`, belief sampling (`sampleWorlds`)

## AIs

- [ ] Built in for every game: random, greedy (on its own `evaluateState`), obscuro, generic

## Engine hooks it implements

`getVisibleState`, `sampleWorlds`, `evaluateState`, `applyStartingUnits`, `createSetupUnit`, `foreignUnits`, `beginTurn`, `getActionDuration`, `isActionLegal`, `toGrid`

## UI

- [ ] `ui` flags: `boxSelect`, `help`, `hideGridLines`, `recolorTeamSprites`, `showFacing`, `showRightSidebar`
- [ ] `toGrid` fields: `cells`, `height`, `locationType`, `shapes`, `units`, `width`
- UI plugins: none (`src/gate.test.js` keeps game ids and imports out of the play UI)

## Demos and benches

- [ ] `demo/sc1-demo.js`

## Tests

- [ ] `fog.test.js`: 6 tests
- [ ] `golden.test.js`: 4 golden replays (default, scenario:tvz, scenario:pvt, scenario:zvp)
- [ ] `index.test.js`: 14 tests
- [ ] `noop-actions.test.js`: 4 tests
- [ ] `placement.test.js`: 7 tests
- [ ] `sprites.test.js`: 4 tests
- [ ] The core's checks of it, in its `contract.test.js` since phase 1 (roster editing; the greedy and, with `SLOW_TESTS=1`, rollout agents where it has them), and its pack in `library/` (`src/library.test.js`)

## README

What [its README](../../games/sc1/README.md) documents, each still true after the move:

- [ ] Players
- [ ] Races
- [ ] Terran
- [ ] Zerg
- [ ] Protoss
- [ ] Buildings
- [ ] Terran
- [ ] Zerg
- [ ] Protoss
- [ ] Actions
- [ ] Special mechanics
- [ ] Terrain
- [ ] Win conditions
- [ ] Run

## Art and other assets

- [ ] `images/`: 141 files, 3.1 MB

## What it uses from outside its folder

Since phase 1 each is a `#core/…` import (or moved into the game).

- `src/agents/learned/leafEval.js`
- `src/engine/foreignUnits.js`
- `src/kit/continuousMove.js`
- `src/kit/coord.js` (5 imports)
- `src/kit/evalHelpers.js`
- `src/kit/renderOptions.js`

## Notes

Owns the StarCraft code sc2 shares since phase 1: `starcraftSprite.js` and
`starcraftMap.js` had nothing generic in them, so they moved here from
`games/`, and sc2 imports them from this folder (the plan's open decision 2
recommends vendoring sc1 into sc2).
