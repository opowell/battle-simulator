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
- Plugins to move out of the play UI: none found

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
- [ ] Also covered from outside its folder: `games/startingSetup.test.js`, `games/foreignUnits.test.js` and, where listed, `agents/greedy.test.js`, `agents/rollout.test.js`

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

Each becomes a `#core/…` import in phase 1, or moves with the game.

- `agents/learned/leafEval.js`
- `engine/foreignUnits.js`
- `games/evalHelpers.js`
- `games/mapTypes/starcraftMap.js`
- `games/starcraftSprite.js`

## Notes

Shares `games/starcraftSprite.js` and `games/mapTypes/starcraftMap.js` with sc1
(see the plan's open decision 2).
