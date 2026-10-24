# ffta: capability checklist

What `ffta` (Final Fantasy Tactics Advance) can do on 2026-10-24, before it moves to a repo of its own
(plans/generic-core-and-game-repos.md, phase 0 step 3). Phase 3 step 5 checks the
extracted game against it: its tests, its golden replays (`games/ffta/golden.json`),
and every box below in the real UI. Generated from the game definition, its
README, its tests and its `toGrid`, then annotated by hand under **Notes**.

## Registry

- [ ] Seats 2–2; default table: `p1` (Player 1), `p2` (Player 2)
- [ ] Game module: `games/ffta/index.js`, export `FFTAGame`

## Setup options

| | Option | Type | Default | Values |
|---|---|---|---|---|
| [ ] | `fogOfWar` Fog of War | boolean | `false` |  |

## Scenarios

| | Scenario | Name | Config |
|---|---|---|---|
| [ ] | `standard` | Standard Battle | `{"scenario":"standard"}` |
| [ ] | `ambush` | Ambush in the Pass | `{"scenario":"ambush"}` |
| [ ] | `jagd` | Jagd Helje | `{"scenario":"jagd"}` |
| [ ] | `magicCouncil` | Magic Council Dispute | `{"scenario":"magicCouncil"}` |
| [ ] | `honorGuard` | Honor Guard | `{"scenario":"honorGuard"}` |
| [ ] | `desertReckoning` | Desert Reckoning | `{"scenario":"desertReckoning"}` |
| [ ] | `bangaaWarband` | Bangaa Warband | `{"scenario":"bangaaWarband"}` |
| [ ] | `moogleRaiders` | Moogle Raiders | `{"scenario":"moogleRaiders"}` |
| [ ] | `grandMelee` | Grand Melee | `{"scenario":"grandMelee"}` |

## Modes

- [ ] Space: discrete (native)
- [ ] Time: discrete (native)
- [ ] Turns: sequential and we-go offered (the engine's switch), default sequential. Random play, 30 steps from the default setup:
  sequential 30 plies in 30 steps, turn 4; we-go 130 plies in 30 steps, turn 31
- [ ] Fog: switchable, default off; `getVisibleState`, belief sampling (`sampleWorlds`)

## AIs

- [ ] Built in for every game: random, greedy (on its own `evaluateState`), obscuro, generic

## Engine hooks it implements

`getVisibleState`, `sampleWorlds`, `evaluateState`, `createSetupUnit`, `foreignUnits`, `getActionDuration`, `toGrid`

## UI

- [ ] `ui` flags: `combatFx`, `isometric`, `moveAnimation`, `moveQueue`, `showFacing`, `strictActiveUnit`
- [ ] `toGrid` fields: `cells`, `height`, `width`
- Plugins to move out of the play UI: none found

## Demos and benches

- [ ] `demo/ffta-demo.js`
- [ ] `npm run demo:ffta` (`node demo/ffta-demo.js`)
- [ ] `npm run demo:ffta:auto` (`node demo/ffta-demo.js --auto`)
- [ ] `npm run demo:ffta:greedy` (`node demo/ffta-demo.js --auto --greedy`)

## Tests

- [ ] `fog.test.js`: 6 tests
- [ ] `golden.test.js`: 11 golden replays (default, scenario:standard, scenario:ambush, scenario:jagd, scenario:magicCouncil, scenario:honorGuard, scenario:desertReckoning, scenario:bangaaWarband, scenario:moogleRaiders, scenario:grandMelee, fog-on)
- [ ] `index.test.js`: 46 tests
- [ ] Also covered from outside its folder: `games/startingSetup.test.js`, `games/foreignUnits.test.js` and, where listed, `agents/greedy.test.js`, `agents/rollout.test.js`

## README

What [its README](../../games/ffta/README.md) documents, each still true after the move:

- [ ] Players
- [ ] Jobs & units
- [ ] Starting lineup
- [ ] Actions
- [ ] Abilities
- [ ] Items
- [ ] Special mechanics
- [ ] Map
- [ ] Win conditions
- [ ] Not implemented (vs original FFTA)
- [ ] Run

## Art and other assets

- [ ] `images/`: 254 files, 1.7 MB

## What it uses from outside its folder

Each becomes a `#core/…` import in phase 1, or moves with the game.

- `agents/learned/leafEval.js`
- `engine/foreignUnits.js`
- `games/evalHelpers.js`
- `games/moveQueue.js`
- `games/vision.js` (2 imports)

## Notes

- Replaces tactical (dropped 2026-10-24) as the grid skirmish the generic AI is
  measured against: `npm run bench:generic -- --game=ffta --vs=greedy`. The one
  thing tactical had that FFTA lacks, three or four seats, Arena has.
- Greedy against Greedy in sequential play does not finish: a draw at 300 turns,
  where the same pairing we-go ends in 149. Neither side closes in.
- The generic AI against Greedy (2026-10-24, 100-turn limit): 0–0–20
  sequential, 0–1–11 we-go. Almost nothing is decided in 100 turns.
