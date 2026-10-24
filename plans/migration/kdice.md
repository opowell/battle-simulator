# kdice: capability checklist

What `kdice` (KDice) can do on 2026-10-24, before it moves to a repo of its own
(plans/generic-core-and-game-repos.md, phase 0 step 3). Phase 3 step 5 checks the
extracted game against it: its tests, its golden replays (`games/kdice/golden.json`),
and every box below in the real UI. Generated from the game definition, its
README, its tests and its `toGrid`, then annotated by hand under **Notes**.

## Registry

- [ ] Seats 2–8; default table: `p1` (Player 1), `p2` (Player 2), `p3` (Player 3), `p4` (Player 4), `p5` (Player 5), `p6` (Player 6), `p7` (Player 7)
- [ ] Game module: `games/kdice/index.js`, export `KDiceGame`
- [ ] Setup-form defaults (`uiDefaults`): `{"players":[{"agent":"human"},{"agent":"kdice"},{"agent":"kdice"},{"agent":"kdice"},{"agent":"kdice"},{"agent":"kdice"},{"agent":"kdice"}]}`

## Setup options

| | Option | Type | Default | Values |
|---|---|---|---|---|
| [ ] | `fogOfWar` Fog of War | boolean | `false` |  |
| [ ] | `stockMax` Dice reserve | integer | `32` |  |

## Scenarios

None: one setup, from its options.

## Modes

- [ ] Space: discrete (native); board `hexagon`
- [ ] Time: discrete (native)
- [ ] Turns: sequential and we-go offered (the engine's switch), default sequential. Random play, 30 steps from the default setup:
  sequential 30 plies in 30 steps, turn 2; we-go 644 plies in 30 steps, turn 92
- [ ] Fog: switchable, default off; `getVisibleState`, belief sampling (`sampleWorlds`)

## AIs

- [ ] `kdice` AI (KDice)
- [ ] Built in for every game: random, greedy (on its own `evaluateState`), obscuro, generic

## Engine hooks it implements

`getVisibleState`, `sampleWorlds`, `evaluateState`, `getChanceOutcomes`, `applyStartingUnits`, `setupUnitTypes`, `createSetupUnit`, `foreignUnits`, `getActionDuration`, `toGrid`

## UI

- [ ] `ui` flags: `clearSelectedAtEndOfTurn`, `combatFx`, `hideGridLines`, `showAiAnalysis`, `showFacing`, `showHpBars`, `showRightSidebar`, `showRoster`, `showRuler`, `showUnitInfo`, `territoryClick`
- [ ] `toGrid` fields: `cells`, `grid`, `height`, `hexSize`, `standings`, `territoryBorders`, `width`
- Plugins to move out of the play UI:
  - [ ] `DiceRollOverlay` (battles carry `attackerRolls`/`defenderRolls`, read by SessionView)

## Demos and benches

- [ ] `demo/kdice-bench.mjs`
- [ ] `demo/kdice-demo.js`
- [ ] `npm run demo:kdice` (`node demo/kdice-demo.js`)
- [ ] `npm run demo:kdice:auto` (`node demo/kdice-demo.js --auto`)
- [ ] `npm run demo:kdice:3p` (`node demo/kdice-demo.js --auto --players=3`)
- [ ] `npm run demo:kdice:4p` (`node demo/kdice-demo.js --auto --players=4`)

## Tests

- [ ] `agent.test.js`: 6 tests
- [ ] `fog.test.js`: 8 tests
- [ ] `golden.test.js`: 2 golden replays (default, fog-on)
- [ ] `index.test.js`: 19 tests
- [ ] `reserve.test.js`: 10 tests
- [ ] Also covered from outside its folder: `games/startingSetup.test.js`, `games/foreignUnits.test.js` and, where listed, `agents/greedy.test.js`, `agents/rollout.test.js`

## README

No README.

## Art and other assets

- [ ] `images/`: 2 files, 118 KB

## What it uses from outside its folder

Each becomes a `#core/…` import in phase 1, or moves with the game.

- `agents/learned/leafEval.js`
- `engine/foreignUnits.js`
- `games/mapTypes/hexagon.js` (2 imports)

## Notes

- Absorbing a unit (foreign units) loses dice past the reserve cap (32 by
  default): a unit worth 50 dice can land as fewer. Documented in
  `absorbUnits`; mixing leaves the game in phase 1 anyway.
