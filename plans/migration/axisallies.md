# axisallies: capability checklist

What `axisallies` (AxisAllies) can do on 2026-10-24, before it moves to a repo of its own
(plans/generic-core-and-game-repos.md, phase 0 step 3). Phase 3 step 5 checks the
extracted game against it: its tests, its golden replays (`games/axisallies/golden.json`),
and every box below in the real UI. Generated from the game definition, its
README, its tests and its `toGrid`, then annotated by hand under **Notes**.

## Registry

- [ ] Seats 2–5; default table: `allies` (Allies), `axis` (Axis)
- [ ] Game module: `games/axisallies/index.js`, export `AxisAlliesGame`

## Setup options

| | Option | Type | Default | Values |
|---|---|---|---|---|
| [ ] | `mapZoom` Zoom & pan controls | boolean | `true` |  |
| [ ] | `fogOfWar` Fog of War | boolean | `false` |  |

## Scenarios

| | Scenario | Name | Config |
|---|---|---|---|
| [ ] | `wwii-1942` | WWII 1942 | — |

## Modes

- [ ] Space: continuous (native)
- [ ] Time: discrete (native)
- [ ] Turns: sequential and we-go offered (the engine's switch), default sequential. Random play, 30 steps from the default setup:
  sequential 30 plies in 30 steps, turn 1; we-go 411 plies in 3 steps, turn 1, ended (captured-moscow)
- [ ] Fog: switchable, default off; `getVisibleState`, belief sampling (`sampleWorlds`)

## AIs

- [ ] Built in for every game: random, greedy (on its own `evaluateState`), obscuro, generic

## Engine hooks it implements

`getVisibleState`, `sampleWorlds`, `evaluateState`, `createSetupUnit`, `foreignUnits`, `toGrid`

## UI

- [ ] `ui` flags: `hideGridLines`
- [ ] `toGrid` fields: `cells`, `height`, `locationType`, `shapes`, `ui`, `units`, `width`
- UI plugins: none (`src/gate.test.js` keeps game ids and imports out of the play UI)

## Demos and benches

- [ ] `demo/axisallies-demo.js`
- [ ] `npm run demo:axisallies` (`node demo/axisallies-demo.js`)
- [ ] `npm run demo:axisallies:auto` (`node demo/axisallies-demo.js --auto`)

## Tests

- [ ] `fog.test.js`: 5 tests
- [ ] `golden.test.js`: 3 golden replays (default, scenario:wwii-1942, fog-on)
- [ ] `index.test.js`: 9 tests
- [ ] The core's checks of it, in its `contract.test.js` since phase 1 (roster editing; the greedy and, with `SLOW_TESTS=1`, rollout agents where it has them), and its pack in `library/` (`src/library.test.js`)

## README

What [its README](../../games/axisallies/README.md) documents, each still true after the move:

- [ ] Players
- [ ] Units
- [ ] Phases
- [ ] Actions
- [ ] Special mechanics
- [ ] Capitals
- [ ] Territories
- [ ] Win conditions
- [ ] Run

## Art and other assets

- [ ] `images/`: 12 files, 175 KB

## What it uses from outside its folder

Since phase 1 each is a `#core/…` import (or moved into the game).

- `src/engine/foreignUnits.js`
- `src/kit/evalHelpers.js`
- `src/kit/renderOptions.js`

## Notes

None yet.

## Moved (2026-10-24)

To [opowell/battle-axisallies](https://github.com/opowell/battle-axisallies),
built by `scripts/extract-game.mjs` and pinned to the core at the commit it left
from. Checked there: `npm test` (the game's 19 tests, its 3 golden replays among
them, plus the app's own 4) passes; `npm run demo:axisallies:auto` plays to a win
(the Axis take Moscow). In the Browser, driven headless, the default setup and
`wwii-1942` draw the map with all 66 pieces and their portraits in the roster,
with no console error or failed request; played through the Orders panel, the
human seat goes purchase → combat move → non-combat move → mobilize, the AI
plays its turn, and turn 2 comes back. Its pack was re-exported into
`library/axisallies/` first: its 10 units unchanged, plus land, industrial land
and sea zones as terrain and the 1942 map as 26 regions (the game's boxes and
ovals rasterised), each side's pieces of a type in a territory one counted
group (`stacking: 'count'`), capitals and income as features.

The AI's turn took about half a minute. Pre-existing (the core's screenshot is
the same): the territories' boxes barely show under the piece clusters at the
default zoom.
