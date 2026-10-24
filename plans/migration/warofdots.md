# warofdots: capability checklist

What `warofdots` (War of Dots) can do on 2026-10-24, before it moves to a repo of its own
(plans/generic-core-and-game-repos.md, phase 0 step 3). Phase 3 step 5 checks the
extracted game against it: its tests, its golden replays (`games/warofdots/golden.json`),
and every box below in the real UI. Generated from the game definition, its
README, its tests and its `toGrid`, then annotated by hand under **Notes**.

## Registry

- [ ] Seats 2–2; default table: `player` (You), `ai` (AI)
- [ ] Game module: `games/warofdots/index.js`, export `WarodDotsGame`

## Setup options

None of its own (the engine options only).

## Scenarios

| | Scenario | Name | Config |
|---|---|---|---|
| [ ] | `standard` | Standard | — |
| [ ] | `lakelands` | Lakelands | `{"scenario":"lakelands"}` |
| [ ] | `divide` | The Divide | `{"scenario":"divide"}` |

## Modes

- [ ] Space: discrete (native)
- [ ] Time: discrete (native)
- [ ] Turns: sequential and we-go offered (the engine's switch), default sequential. Random play, 30 steps from the default setup:
  sequential 30 plies in 30 steps, turn 1; we-go 4488 plies in 22 steps, turn 23, ended (capital-captured)
- [ ] Fog: no switch; `getVisibleState`, belief sampling (`sampleWorlds`)

## AIs

- [ ] Built in for every game: random, greedy (on its own `evaluateState`), obscuro, generic

## Engine hooks it implements

`getVisibleState`, `sampleWorlds`, `evaluateState`, `createSetupUnit`, `foreignUnits`, `toGrid`

## UI

- [ ] `ui` flags: `help`, `hideGridLines`
- [ ] `toGrid` fields: `cells`, `height`, `shapes`, `ui`, `width`
- UI plugins: none (`src/gate.test.js` keeps game ids and imports out of the play UI)

## Demos and benches

None.

## Tests

- [ ] `fog.test.js`: 6 tests
- [ ] `golden.test.js`: 4 golden replays (default, scenario:standard, scenario:lakelands, scenario:divide)
- [ ] `index.test.js`: 30 tests
- [ ] The core's checks of it, in its `contract.test.js` since phase 1 (roster editing; the greedy and, with `SLOW_TESTS=1`, rollout agents where it has them), and its pack in `library/` (`src/library.test.js`)

## README

No README.

## Art and other assets

- [ ] `images/`: 2 files, 42 KB

## What it uses from outside its folder

Since phase 1 each is a `#core/…` import (or moved into the game).

- `src/engine/foreignUnits.js`
- `src/kit/terrainShapes.js`

## Notes

None yet.

## Moved (2026-10-24)

To [opowell/battle-warofdots](https://github.com/opowell/battle-warofdots),
built by `scripts/extract-game.mjs` and pinned to the core at the commit it left
from. Checked there: `npm test` (the game's 42 tests, its 4 golden replays among
them, plus the app's own 4) passes; in the Browser, driven headless, the default
setup, `standard`, `lakelands` and `divide` draw (the tile map, and the two
shape maps as their lakes, forests and hills), the help button shows, and turns
end and come back from the AI ten in a row, with no console error or failed
request. Its pack (2 units, 10 terrain types, and its three maps: the two shape
scenarios as they rasterise onto the game's 40×26 grid, and the standard map,
which the game generates afresh each game, at one fixed seed) was exported into
`library/warofdots/` first. To export them, the game's terrain tables, its unit
table and `speedMod` are now named exports of `WarodDotsGame.js`.

Found here, and fixed in the core: under its own repo's JAS (`JAS_DEFAULT_APP`,
which serves the app at `/` for HTTP only), the Browser's session socket at
`/sessions/:id/ws` was never answered, so an AI's turn never reached the page
(xcom's repo too). The app JAS serves at `/` now claims those sockets
(`src/server/battleServer.js`, tested in `battleServer.test.js`).

Pre-existing, the same in the core today: neutral cities are drawn and listed
in the roster as the first seat's (blue) tokens, named by raw ids (`u_20_4`).
