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
- UI plugins: none (`src/gate.test.js` keeps game ids and imports out of the play UI)

## Demos and benches

- [ ] `demo/ffta-demo.js`
- [ ] `npm run demo:ffta` (`node demo/ffta-demo.js`)
- [ ] `npm run demo:ffta:auto` (`node demo/ffta-demo.js --auto`)
- [ ] `npm run demo:ffta:greedy` (`node demo/ffta-demo.js --auto --greedy`)

## Tests

- [ ] `fog.test.js`: 6 tests
- [ ] `golden.test.js`: 11 golden replays (default, scenario:standard, scenario:ambush, scenario:jagd, scenario:magicCouncil, scenario:honorGuard, scenario:desertReckoning, scenario:bangaaWarband, scenario:moogleRaiders, scenario:grandMelee, fog-on)
- [ ] `index.test.js`: 46 tests
- [ ] The core's checks of it, in its `contract.test.js` since phase 1 (roster editing; the greedy and, with `SLOW_TESTS=1`, rollout agents where it has them), and its pack in `library/` (`src/library.test.js`)

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

Since phase 1 each is a `#core/…` import (or moved into the game).

- `src/agents/learned/leafEval.js`
- `src/engine/foreignUnits.js`
- `src/kit/evalHelpers.js`
- `src/kit/moveQueue.js`
- `src/kit/vision.js` (2 imports)

## Notes

- Replaces tactical (dropped 2026-10-24) as the grid skirmish the generic AI is
  measured against: `npm run bench:generic -- --game=ffta --vs=greedy`. The one
  thing tactical had that FFTA lacks, three or four seats, Arena has.
- Greedy against Greedy in sequential play does not finish: a draw at 300 turns,
  where the same pairing we-go ends in 149. Neither side closes in.
- The generic AI against Greedy (2026-10-24, 100-turn limit): 0–0–20
  sequential, 0–1–11 we-go. Almost nothing is decided in 100 turns.

## Moved (2026-10-24)

To [opowell/battle-ffta](https://github.com/opowell/battle-ffta), built by
`scripts/extract-game.mjs` and pinned to the core at the commit it left from.
Checked there: `npm test` (the game's 66 tests, its 11 golden replays among them,
plus the app's own 4; the slow rollout skipped) passes; `npm run demo:ffta:greedy`
plays to a win. In the Browser, driven headless, the default setup and all nine
scenarios draw the isometric board from its terrain textures with every job's
directional sprite and portrait (`/images/ffta/…` served), with no console error
or failed request; in seven a turn ends and the AI plays, while in
`bangaaWarband` and `grandMelee` the AI's unit has the first CT turn, so the
check found no End Turn to press. Its `ui` flags (`isometric`, `combatFx`,
`moveAnimation: hop`, `strictActiveUnit`, `showFacing: false`, `moveQueue`) are
served as before; it has no UI plugins or sounds. Its pack was re-exported into
`library/ffta/` first: its 29 jobs unchanged, plus its 4 terrain types (the
heights as the core's elevation, a step up costing a level more, as in the game)
and its nine scenarios, each the one 12×10 board walked four ways, with the jobs
it deals and the way each starts facing.

Pre-existing, not changed by the move: battles seldom finish (see Notes), and
the server logs Obscuro's warning that FFTA's information-set identity names
static terrain. What it leaves behind in the core: `demo/generic-ai-bench.mjs`
imports `games/ffta/index.js` at the top, so the whole bench fails to load once
ffta is gone, not just `--game=ffta`; `src/agents/learned/train.mjs` names ffta
only in a usage comment; Arena's `mixed-encounter` and `mixed-world` field ffta
units from `library/ffta/`, which stays.
