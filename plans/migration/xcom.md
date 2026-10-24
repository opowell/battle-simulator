# xcom: capability checklist

What `xcom` (X-Com Tactical) can do on 2026-10-24, before it moves to a repo of its own
(plans/generic-core-and-game-repos.md, phase 0 step 3). Phase 3 step 5 checks the
extracted game against it: its tests, its golden replays (`games/xcom/golden.json`),
and every box below in the real UI. Generated from the game definition, its
README, its tests and its `toGrid`, then annotated by hand under **Notes**.

## Registry

- [ ] Seats 2–2; default table: `xcom` (XCOM), `aliens` (Aliens)
- [ ] Game module: `games/xcom/index.js`, export `XComGame`

## Setup options

| | Option | Type | Default | Values |
|---|---|---|---|---|
| [ ] | `fogOfWar` Fog of War | boolean | `false` |  |

## Scenarios

| | Scenario | Name | Config |
|---|---|---|---|
| [ ] | `ufo-crash` | UFO Crash Site | — |

## Modes

- [ ] Space: discrete (native)
- [ ] Time: discrete (native)
- [ ] Turns: sequential and we-go offered (the engine's switch), default sequential. Random play, 30 steps from the default setup:
  sequential 30 plies in 30 steps, turn 3; we-go 367 plies in 30 steps, turn 31
- [ ] Fog: switchable, default off; `getVisibleState`, belief sampling (`sampleWorlds`)

## AIs

- [ ] Built in for every game: random, greedy (on its own `evaluateState`), obscuro, generic

## Engine hooks it implements

`getVisibleState`, `sampleWorlds`, `evaluateState`, `createSetupUnit`, `foreignUnits`, `getActionDuration`, `toGrid`

## UI

- [ ] `ui` flags: `isometric`, `showFacing`
- [ ] `toGrid` fields: `cells`, `height`, `width`
- UI plugins: none (`src/gate.test.js` keeps game ids and imports out of the play UI)

## Demos and benches

- [ ] `demo/xcom-demo.js`
- [ ] `npm run demo:xcom` (`node demo/xcom-demo.js`)
- [ ] `npm run demo:xcom:auto` (`node demo/xcom-demo.js --auto`)
- [ ] `npm run demo:xcom:greedy` (`node demo/xcom-demo.js --auto --greedy`)

## Tests

- [ ] `fog.test.js`: 6 tests
- [ ] `golden.test.js`: 3 golden replays (default, scenario:ufo-crash, fog-on)
- [ ] `index.test.js`: 13 tests
- [ ] The core's checks of it, in its `contract.test.js` since phase 1 (roster editing; the greedy and, with `SLOW_TESTS=1`, rollout agents where it has them), and its pack in `library/` (`src/library.test.js`)

## README

What [its README](../../games/xcom/README.md) documents, each still true after the move:

- [ ] Players
- [ ] Units
- [ ] XCOM squad
- [ ] Aliens
- [ ] Actions
- [ ] Special mechanics
- [ ] Map
- [ ] Win conditions
- [ ] Run

## Art and other assets

- [ ] `images/`: 9 files, 239 KB

## What it uses from outside its folder

Since phase 1 each is a `#core/…` import (or moved into the game).

- `src/agents/learned/leafEval.js`
- `src/engine/foreignUnits.js`
- `src/kit/evalHelpers.js`

## Notes

None yet.

## Moved (2026-10-24)

To [opowell/battle-xcom](https://github.com/opowell/battle-xcom), built by
`scripts/extract-game.mjs` and pinned to the core at the commit it left from.
Checked there: `npm test` (the game's 24 tests, its 3 golden replays among them,
plus the app's own 2) passes; in the Browser, driven headless, the default setup
and `ufo-crash` draw the isometric board with every unit's art, and a turn ends
and comes back with no console error or failed request. Its pack (7 units, 4
terrain types and the `ufo-crash` map) was re-exported into `library/xcom/` first.
