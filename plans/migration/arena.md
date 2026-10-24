# arena: capability checklist

What `arena` (Arena) can do on 2026-10-24, before it moves to a repo of its own
(plans/generic-core-and-game-repos.md, phase 0 step 3). Phase 3 step 5 checks the
extracted game against it: its tests, its golden replays (`games/arena/golden.json`),
and every box below in the real UI. Generated from the game definition, its
README, its tests and its `toGrid`, then annotated by hand under **Notes**.

## Registry

- [ ] Seats 2–4; default table: `p1` (Player 1), `p2` (Player 2)
- [ ] Game module: `games/arena/index.js`, export `ArenaGame`
- [ ] Setup-form defaults (`uiDefaults`): `{"cpuAgent":"generic"}`

## Setup options

| | Option | Type | Default | Values |
|---|---|---|---|---|
| [ ] | `fogOfWar` Fog of War | boolean | `false` |  |
| [ ] | `space` Space | select | `"discrete"` | discrete, continuous |
| [ ] | `time` Time | select | `"discrete"` | discrete, continuous |

## Scenarios

| | Scenario | Name | Config |
|---|---|---|---|
| [ ] | `skirmish` | Skirmish | — |
| [ ] | `open-field` | Open field | `{"width":12,"height":8,"map":"open"}` |
| [ ] | `real-time` | Real-time skirmish | `{"space":"continuous","time":"continuous","simultaneousTurns":true}` |

## Modes

- [ ] Space: discrete and continuous, `grid`
- [ ] Time: discrete and continuous
- [ ] Turns: sequential and we-go offered (the engine's switch), default sequential. Random play, 30 steps from the default setup:
  sequential 30 plies in 30 steps, turn 3; we-go 257 plies in 30 steps, turn 31
- [ ] Fog: switchable, default off; `getVisibleState`

## AIs

- [ ] Built in for every game: random, greedy (no `evaluateState`: greedy and Obscuro judge by terminals), obscuro, generic

## Engine hooks it implements

`getVisibleState`, `actionKey`, `applyStartingUnits`, `setupUnitTypes`, `createSetupUnit`, `foreignUnits`, `nativelySimultaneous`, `getActionDuration`, `isActionLegal`, `unitAttributes`, `unitStats`, `toGrid`

## UI

- [ ] `ui` flags: `gridDestinations`, `hideTurnTimeline`, `moveAnimation`, `showFacing`, `showHpBars`, `showUnitsLost`, `simultaneousMotion`, `timeEntry`
- [ ] `toGrid` fields: `boardType`, `cells`, `clock`, `height`, `locationType`, `los`, `spaceType`, `timeType`, `ui`, `units`, `width`
- UI plugins: none (`src/gate.test.js` keeps game ids and imports out of the play UI)

## Demos and benches

None.

## Tests

- [ ] `golden.test.js`: 13 golden replays (default, scenario:skirmish, scenario:open-field, scenario:real-time, mode:discrete-discrete-sequential, mode:discrete-discrete-simultaneous, mode:discrete-continuous-sequential, mode:discrete-continuous-simultaneous, mode:continuous-discrete-sequential, mode:continuous-discrete-simultaneous, mode:continuous-continuous-sequential, mode:continuous-continuous-simultaneous, fog-on)
- [ ] `index.test.js`: 17 tests
- [ ] The core's checks of it, in its `contract.test.js` since phase 1 (roster editing; the greedy and, with `SLOW_TESTS=1`, rollout agents where it has them), and its pack in `library/` (`src/library.test.js`)

## README

What [its README](../../games/arena/README.md) documents, each still true after the move:

- [ ] Units
- [ ] Terrain
- [ ] The eight modes
- [ ] Win conditions
- [ ] Scenarios
- [ ] Hooks it implements for the generic AI

## Art and other assets

None in its folder.

## What it uses from outside its folder

Since phase 1 each is a `#core/…` import (or moved into the game).

- `src/engine/foreignUnits.js`
- `src/kit/spacetime.js`

## Notes

Arena does not leave: it becomes the core's own ruleset (`BattleGame`, phase 2).
This checklist is what `BattleGame` must still do when it has grown out of it,
in all eight (space × time × turns) modes, which the golden replays cover.
