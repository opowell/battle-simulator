# sc2: capability checklist

What `sc2` (SC2) can do on 2026-10-24, before it moves to a repo of its own
(plans/generic-core-and-game-repos.md, phase 0 step 3). Phase 3 step 5 checks the
extracted game against it: its tests, its golden replays (`games/sc2/golden.json`),
and every box below in the real UI. Generated from the game definition, its
README, its tests and its `toGrid`, then annotated by hand under **Notes**.

## Registry

- [ ] Seats 2–4; default table: `p1` (Player 1), `p2` (Player 2)
- [ ] Game module: `games/sc2/index.js`, export `Sc2Game`

## Setup options

None of its own (the engine options only).

## Scenarios

| | Scenario | Name | Config |
|---|---|---|---|
| [ ] | `tvz` | Terran vs Zerg | `{"race1":"terran","race2":"zerg"}` |
| [ ] | `pvt` | Protoss vs Terran | `{"race1":"protoss","race2":"terran"}` |
| [ ] | `zvp` | Zerg vs Protoss | `{"race1":"zerg","race2":"protoss"}` |

## Modes

- [ ] Space: discrete (native)
- [ ] Time: discrete (native)
- [ ] Turns: sequential and we-go offered (the engine's switch), default sequential. Random play, 30 steps from the default setup:
  sequential 30 plies in 30 steps, turn 1; we-go 1129 plies in 30 steps, turn 31
- [ ] Fog: no switch; `getVisibleState`, belief sampling (`sampleWorlds`)

## AIs

- [ ] Built in for every game: random, greedy (on its own `evaluateState`), obscuro, generic

## Engine hooks it implements

`getVisibleState`, `sampleWorlds`, `evaluateState`, `createSetupUnit`, `foreignUnits`, `getActionDuration`, `toGrid`

## UI

- [ ] `ui` flags: none
- [ ] `toGrid` fields: `cells`, `height`, `shapes`, `width`
- UI plugins: none (`src/gate.test.js` keeps game ids and imports out of the play UI)

## Demos and benches

- [ ] `demo/sc2-demo.js`
- [ ] `npm run demo:sc2` (`node demo/sc2-demo.js`)
- [ ] `npm run demo:sc2:auto` (`node demo/sc2-demo.js --auto`)
- [ ] `npm run demo:sc2:greedy` (`node demo/sc2-demo.js --auto --greedy`)

## Tests

- [ ] `fog.test.js`: 6 tests
- [ ] `golden.test.js`: 4 golden replays (default, scenario:tvz, scenario:pvt, scenario:zvp)
- [ ] `index.test.js`: 15 tests
- [ ] `noop-actions.test.js`: 4 tests
- [ ] The core's checks of it, in its `contract.test.js` since phase 1 (roster editing; the greedy and, with `SLOW_TESTS=1`, rollout agents where it has them), and its pack in `library/` (`src/library.test.js`)

## README

What [its README](../../games/sc2/README.md) documents, each still true after the move:

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
- [ ] Unit abilities
- [ ] Special mechanics
- [ ] Terrain
- [ ] Win conditions
- [ ] Run

## Art and other assets

- [ ] `images/`: 44 files, 14.7 MB

## What it uses from outside its folder

Since phase 1 each is a `#core/…` import (or moved into the game).

- `src/agents/learned/leafEval.js`
- `src/engine/foreignUnits.js`
- `src/kit/evalHelpers.js`
- `games/sc1/starcraftMap.js`
- `games/sc1/starcraftSprite.js`

## Notes

Shares the StarCraft code with sc1. It had nothing generic in it (team colours
come from the board's `fill: 'team'`, not from the sprite code), so phase 1 moved
both files into sc1 (`games/sc1/starcraftSprite.js`, `games/sc1/starcraftMap.js`)
and sc2 imports them from there: the one cross-game import left, which the plan's
open decision 2 recommends turning into sc1 vendored into sc2.
