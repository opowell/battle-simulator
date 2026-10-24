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
- Plugins to move out of the play UI: none found

## Demos and benches

- [ ] `demo/sc1-demo.js`

## Tests

- [ ] `fog.test.js`: 6 tests
- [ ] `golden.test.js`: 4 golden replays (default, scenario:tvz, scenario:pvt, scenario:zvp)
- [ ] `index.test.js`: 14 tests
- [ ] `noop-actions.test.js`: 4 tests
- [ ] `placement.test.js`: 7 tests
- [ ] `sprites.test.js`: 4 tests
- [ ] Also covered from outside its folder: `games/startingSetup.test.js`, `games/foreignUnits.test.js` and, where listed, `agents/greedy.test.js`, `agents/rollout.test.js`

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

Each becomes a `#core/…` import in phase 1, or moves with the game.

- `agents/learned/leafEval.js`
- `engine/foreignUnits.js`
- `games/continuousMove.js`
- `games/coord.js` (5 imports)
- `games/evalHelpers.js`
- `games/mapTypes/starcraftMap.js`
- `games/renderOptions.js`
- `games/starcraftSprite.js` (2 imports)

## Notes

Shares `games/starcraftSprite.js` and `games/mapTypes/starcraftMap.js` with sc2
(see the plan's open decision 2).
