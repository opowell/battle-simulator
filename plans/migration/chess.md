# chess: capability checklist

What `chess` (Chess) can do on 2026-10-24, before it moves to a repo of its own
(plans/generic-core-and-game-repos.md, phase 0 step 3). Phase 3 step 5 checks the
extracted game against it: its tests, its golden replays (`games/chess/golden.json`),
and every box below in the real UI. Generated from the game definition, its
README, its tests and its `toGrid`, then annotated by hand under **Notes**.

## Registry

- [ ] Seats 2–2; default table: `white` (White), `black` (Black)
- [ ] Game module: `games/chess/index.js`, export `ChessGame`

## Setup options

| | Option | Type | Default | Values |
|---|---|---|---|---|
| [ ] | `space` Space | select | `"discrete"` | discrete, continuous |
| [ ] | `time` Time | select | `"discrete"` | discrete, continuous |
| [ ] | `fogOfWar` Fog of War | boolean | `false` |  |
| [ ] | `debugAI` Debug AI | boolean | `false` |  |
| [ ] | `initialMarkers` Initial piece markers | boolean | `false` |  |
| [ ] | `showAnalysisPanel` Analysis Panel | boolean | `true` |  |
| [ ] | `difficulty` AI Difficulty | ai-difficulty | `25` |  |

## Scenarios

| | Scenario | Name | Config |
|---|---|---|---|
| [ ] | `standard` | Standard | `{"space":"discrete","time":"discrete","fogOfWar":false,"players":[{"name":"You","agent":"…` |
| [ ] | `fog` | Fog of War | `{"space":"discrete","time":"discrete","fogOfWar":true,"players":[{"name":"You","agent":"h…` |
| [ ] | `clockwork` | Clockwork | `{"space":"discrete","time":"continuous","fogOfWar":false,"showAnalysisPanel":false,"maxTu…` |
| [ ] | `melee` | Melee | `{"space":"continuous","time":"continuous","fogOfWar":false,"showAnalysisPanel":false,"max…` |
| [ ] | `sliding` | Sliding | `{"space":"continuous","time":"discrete","fogOfWar":false,"showAnalysisPanel":false,"maxTu…` |

## Modes

- [ ] Space: discrete and continuous
- [ ] Time: discrete and continuous
- [ ] Turns: sequential and we-go offered (the engine's switch), default sequential. Random play, 30 steps from the default setup:
  sequential 30 plies in 30 steps, turn 16; we-go 60 plies in 30 steps, turn 31
- [ ] Fog: switchable, default off; `getVisibleState`, belief sampling (`sampleWorlds`)

## AIs

- [ ] `chess-ai` Chess AI (backs the analysis panel) (also runs in the browser)
- [ ] `obscuro` Obscuro (CFR) (backs the analysis panel) (also runs in the browser)
- [ ] Built in for every game: random, greedy (on its own `evaluateState`), obscuro, generic

## Engine hooks it implements

`getVisibleState`, `sampleWorlds`, `evaluateState`, `actionKey`, `onActionCommitted`, `applyStartingUnits`, `foreignUnits`, `getActionDuration`, `isActionLegal`, `getSearchActions`, `toGrid`, `clientGame`

## UI

- [ ] `ui` flags: `allowDiagonalHopsWhileMoving`, `clearSelectedAtEndOfTurn`, `dragToMove`, `freeSelection`, `gridDestinations`, `gridFog`, `gridLabelsBottom`, `hideGridLines`, `hideTurnTimeline`, `highlightLastMove`, `highlightSelectedSquare`, `moveAnimation`, `ownTileColors`, `showFacing`, `showHpBars`, `showRoster`, `showUnitsLost`, `simultaneousMotion`, `timeEntry`, `unitShapes`
- [ ] `toGrid` fields: `boardType`, `cells`, `clock`, `height`, `locationType`, `markers`, `motion`, `spaceType`, `timeType`, `ui`, `units`, `visible`, `width`, `xLabels`, `yLabels`
- UI plugins, moved out of the play UI in phase 1 (`uiPlugins`, `games/chess/ui/`):
  - [ ] `ui/sound.js` (slot `sound`): the move clack, on `onSubmit`
  - [ ] fog markers: `ui.markerCycle` names the pieces a click guesses; `toGrid`'s markers and `hiddenPiecesOf` carry their own pictures
  - [ ] `ui.actionLabels` (castling as O-O / O-O-O)
- Stayed in the core, as generic contracts chess fills:
  - [ ] `DatabasePanel` / `DatabaseMoveList`, on `game.database`; its rows now say how they are written (`label`, and each example's `title`, `outcome`, `when`), which `fowDatabase.js` fills in
  - [ ] the analysis Web Worker (`play/analysis-worker.js`), on `clientGame` / `clientAnalyze`, and `BeliefWorldStepper` on the analysis's belief worlds

## Demos and benches

- [ ] `demo/chess-demo.js`
- [ ] `npm run demo:chess` (`node demo/chess-demo.js`)
- [ ] `npm run demo:chess:auto` (`node demo/chess-demo.js --auto`)
- [ ] `npm run demo:chess:fog` (`node demo/chess-demo.js --auto --scenario=fog`)
- [ ] `npm run demo:chess:clockwork` (`node demo/chess-demo.js --auto --scenario=clockwork`)
- [ ] `npm run demo:chess:melee` (`node demo/chess-demo.js --auto --scenario=melee`)
- [ ] `npm run demo:chess:sliding` (`node demo/chess-demo.js --auto --scenario=sliding`)

## Tests

- [ ] `analysis-seat.test.js`: 7 tests
- [ ] `blocked-push.test.js`: 3 tests
- [ ] `fowDatabase.test.js`: 17 tests
- [ ] `golden.test.js`: 15 golden replays (default, scenario:standard, scenario:fog, scenario:clockwork, scenario:melee, scenario:sliding, mode:discrete-discrete-sequential, mode:discrete-discrete-simultaneous, mode:discrete-continuous-sequential, mode:discrete-continuous-simultaneous, mode:continuous-discrete-sequential, mode:continuous-discrete-simultaneous, mode:continuous-continuous-sequential, mode:continuous-continuous-simultaneous, fog-on)
- [ ] `index.test.js`: 44 tests
- [ ] `obscuro.test.js`: 7 tests
- [ ] `spacetime.test.js`: 36 tests
- [ ] The core's checks of it, in its `contract.test.js` since phase 1 (roster editing; the greedy and, with `SLOW_TESTS=1`, rollout agents where it has them), and its pack in `library/` (`src/library.test.js`)

## README

What [its README](../../games/chess/README.md) documents, each still true after the move:

- [ ] Players
- [ ] Units
- [ ] Actions
- [ ] Special mechanics
- [ ] Win conditions
- [ ] Run
- [ ] Scenarios: the five ways to play
- [ ] What the three new quadrants have in common
- [ ] Clockwork — continuous time, discrete space
- [ ] Melee — continuous time and space
- [ ] Sliding — discrete time, continuous space
- [ ] How real-time play fits a turn-based interface
- [ ] The game database (fog opening explorer)
- [ ] Two ways to use it
- [ ] Where the AI is

## Art and other assets

- [ ] `images/`: 14 files, 198 KB
- [ ] `vendor/`: 3 files, 10.4 MB

## What it uses from outside its folder

Since phase 1 each is a `#core/…` import (or moved into the game).

- `src/agents/cfr.js`
- `src/kit/planQueue.js`
- `src/kit/spacetime.js`
- `vendor/obscuro-chess/src/index.js` (3 imports)
- `vendor/obscuro-chess/src/stockfish.js` (2 imports)

## Notes

- Besides its folder, chess owns `vendor/obscuro-chess` (the fog-chess AI and
  Stockfish), the Stockfish evaluation cache `games/chess/vendor/sf-cache.*`,
  and `games/chess/stockfish.js`, the shim pointing the engine at that cache
  (see CLAUDE.md). All go to its repo (phase 4 drops the submodule here).
- The Browser's search placeholder (`apps/browser/schema.js`) uses
  `game:chess` as its example: harmless, but the phase 1 gate test will flag it.
- Its four (space × time) quadrants are scenarios (`clockwork`, `melee`,
  `sliding`) as well as options; the golden replays cover both, and each mode
  in sequential and we-go play.

## Moved (2026-10-25)

To [opowell/battle-chess](https://github.com/opowell/battle-chess) (open
decision 3: a new repo, not fog-chess), built by `scripts/extract-game.mjs` and
pinned to the core at the commit it left from. Chess owns the fog-chess AI
there: `vendor/obscuro-chess` is a submodule of the repo's own, at the core's
pin (008841f, with its own `vendor/obscuro` at fd91cda), and `#obscuro-chess/*`
maps to it rather than to the core's copy, so nothing there needs the core's
`vendor/obscuro-chess` when phase 4 drops it. The Stockfish cache is
git-ignored there as here, and was copied in from the main checkout. Its module
pointers (`clientAnalyze`, `clientGame`, `database`) name their modules from the
repo's root, `apps/chess/games/chess/…`, where /lib/ serves from; the core now
imports a `database` module from the app's root too (it had resolved against
src/server/ since phase 1, so the database panel 500ed here as well).

Checked there: `npm test` passes, 158 tests: the game's 144 (its 15 golden
replays among them), the app's own 4, and 10 new. Eight are the core's old
api-server tests of chess (`test/midgame.test.js`: the opening roster with the
queen on d4, the refused roster, fog switched on mid-game, continuous space
mid-game, the seat handed to an AI, units added and removed, the fog units
editor, the refused change), which left the core when its api-server.test.js
moved to Arena. Two (`test/analysis.test.js`) check that /lib serves the
analysis worker's whole import graph, its obscuro-chess the repo's own, and that
the database answers on an analysis board. `demo/chess-demo.js --auto` and
`obscuro-demo.js` run from `apps/chess/demo/`. In the Browser, driven headless,
the default setup and all 5 scenarios draw the board with its pieces, with no
console error or failed request (chess has no End Turn button: a move is the
turn). The sound plugin is served (its clack is synthesised, so there are no
sound files). The analysis panel runs in the browser Web Worker on the standard
board (86 /lib requests, every one 200, Stockfish's wasm worker started, moves
suggested); under fog, in a session made over the API with
`showAnalysisPanel: true`, it analyses over the server's stream and steps
through the belief boards; on a fog analysis board the Fog of War games panel
answers (3,154 games for the opening). Its pack was re-exported into
`library/chess/` first: its 6 units unchanged, plus 2 terrain types (the light
and dark squares, which carry no rule) and the board of 4 scenarios, each with
its space and time as the map's `modes`; fog is the standard board.

Pre-existing, the same with the core's own server: a finished all-AI session
made over the API stays on "Loading…" when opened in the Browser. Not checked:
playing moves by drag in the UI, the continuous quadrants beyond their first
position, and the slow rollouts (`SLOW_TESTS=1`).
