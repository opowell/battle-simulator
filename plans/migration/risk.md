# risk: capability checklist

What `risk` (Risk) can do on 2026-10-24, before it moves to a repo of its own
(plans/generic-core-and-game-repos.md, phase 0 step 3). Phase 3 step 5 checks the
extracted game against it: its tests, its golden replays (`games/risk/golden.json`),
and every box below in the real UI. Generated from the game definition, its
README, its tests and its `toGrid`, then annotated by hand under **Notes**.

## Registry

- [ ] Seats 2–6; default table: `p1` (Player 1), `p2` (Player 2), `p3` (Player 3), `p4` (Player 4), `p5` (Player 5), `p6` (Player 6)
- [ ] Game module: `games/risk/index.js`, export `RiskGame`

## Setup options

| | Option | Type | Default | Values |
|---|---|---|---|---|
| [ ] | `cardSetValues` Card set values | select | `"fixed"` | fixed, increasing |
| [ ] | `fortifyMoves` Fortify moves | select | `"one"` | one, unlimited |
| [ ] | `reinforcePlacement` Reinforcements | select | `"selected"` | selected, random |
| [ ] | `autoOccupy` Move in everything you can spare | boolean | `true` |  |
| [ ] | `postCaptureFortify` Choose occupying force | boolean | `true` |  |

## Scenarios

| | Scenario | Name | Config |
|---|---|---|---|
| [ ] | `world-domination` | World Domination | — |

## Modes

- [ ] Space: discrete (native); board `hexagon`
- [ ] Time: discrete (native)
- [ ] Turns: sequential and we-go offered (the engine's switch), default sequential. Random play, 30 steps from the default setup:
  sequential 30 plies in 30 steps, turn 1; we-go 251 plies in 30 steps, turn 5
- [ ] Fog: no switch; `getVisibleState`, belief sampling (`sampleWorlds`)

## AIs

- [ ] Built in for every game: random, greedy (on its own `evaluateState`), obscuro, generic

## Engine hooks it implements

`getVisibleState`, `sampleWorlds`, `evaluateState`, `applyStartingUnits`, `setupUnitTypes`, `createSetupUnit`, `foreignUnits`, `getActionDuration`, `toGrid`

## UI

- [ ] `ui` flags: `actionGroupLabels`, `clearSelectedAtEndOfTurn`, `combatFx`, `help`, `hideGridLines`, `phaseHints`, `phases`, `showAiAnalysis`, `showFacing`, `showHpBars`, `showRightSidebar`, `showRoster`, `showRuler`, `showUnitInfo`, `territoryClick`, `territoryFollowUp`, `territoryPairTypes`, `territoryPairVariant`, `territoryTapType`
- [ ] `toGrid` fields: `cells`, `grid`, `height`, `hexSize`, `links`, `statusChips`, `territoryBorders`, `ui`, `width`
- Stayed in the core, as a generic contract: `DiceRollOverlay`, for any action whose `result` carries `attackerRolls`/`defenderRolls`

## Demos and benches

- [ ] `demo/risk-demo.js`
- [ ] `npm run demo:risk` (`node demo/risk-demo.js`)
- [ ] `npm run demo:risk:auto` (`node demo/risk-demo.js --auto`)
- [ ] `npm run demo:risk:3p` (`node demo/risk-demo.js --auto --players=3`)

## Tests

- [ ] `fog.test.js`: 7 tests
- [ ] `golden.test.js`: 2 golden replays (default, scenario:world-domination)
- [ ] `index.test.js`: 26 tests
- [ ] `layout.test.js`: 11 tests
- [ ] The core's checks of it, in its `contract.test.js` since phase 1 (roster editing; the greedy and, with `SLOW_TESTS=1`, rollout agents where it has them), and its pack in `library/` (`src/library.test.js`)

## README

What [its README](../../games/risk/README.md) documents, each still true after the move:

- [ ] Players
- [ ] Board
- [ ] Setup
- [ ] Phases
- [ ] Actions
- [ ] Rule options
- [ ] Combat
- [ ] Reinforcements
- [ ] Card sets
- [ ] The board
- [ ] Win conditions
- [ ] Run

## Art and other assets

- [ ] `images/`: 2 files, 163 KB

## What it uses from outside its folder

Since phase 1 each is a `#core/…` import (or moved into the game).

- `src/agents/learned/leafEval.js`
- `src/engine/foreignUnits.js`
- `src/kit/evalHelpers.js`
- `src/kit/hexagon.js` (2 imports)

## Notes

None yet.

## Moved (2026-10-24)

To [opowell/battle-risk](https://github.com/opowell/battle-risk), built by
`scripts/extract-game.mjs` and pinned to the core at the commit it left from.
Checked there: `npm test` (the game's 49 tests, its 2 golden replays among them,
plus the app's own 4; the slow rollout skipped) passes; `npm run demo:risk:auto`
plays to a win; `npm run export-pack` re-exports the pack unchanged. In the
Browser, driven headless, the default setup and `world-domination` draw the 42
territories with their army counts, with no console error or failed request
(its preview pictures are served); played by clicking the board, three
reinforcements are placed and an attack is made from Northwest Territory into
Alaska. Its pack was re-exported into `library/risk/` first: the world map now
opens with the game's own deal for two (40 armies each, from a fixed seed), each
territory's armies one counted group (`stacking: 'count'`), and the continents
as terrain and features.

Pre-existing, not fixed: Risk's battles throw no dice on screen, here or in the
core today. `DiceRollOverlay` shows a roll only from an action's
`result.attackerRolls`/`defenderRolls`, which kdice stamps and Risk does not (it
keeps them in `gameSpecific.lastCombat`).
