# rogue: capability checklist

What `rogue` (Rogue: Dungeons of Doom) can do on 2026-10-24, before it moves to a repo of its own
(plans/generic-core-and-game-repos.md, phase 0 step 3). Phase 3 step 5 checks the
extracted game against it: its tests, its golden replays (`games/rogue/golden.json`),
and every box below in the real UI. Generated from the game definition, its
README, its tests and its `toGrid`, then annotated by hand under **Notes**.

## Registry

- Not in the server's registry (see the plan's open decision 4). Its golden replays seat `p1`.
- [ ] Game module: `games/rogue/index.js`, export `RogueGame`

## Setup options

| | Option | Type | Default | Values |
|---|---|---|---|---|
| [ ] | `fogOfWar` Fog of War | boolean | `false` |  |

## Scenarios

None: one setup, from its options.

## Modes

- [ ] Space: discrete (native)
- [ ] Time: discrete (native)
- [ ] Turns: sequential and we-go offered (the engine's switch), default sequential. Random play, 30 steps from the default setup:
  sequential 30 plies in 30 steps, turn 31; we-go 98 plies in 30 steps, turn 99
- [ ] Fog: switchable, default off; `getVisibleState`, belief sampling (`sampleWorlds`)

## AIs

- [ ] Built in for every game: random, greedy (on its own `evaluateState`), obscuro, generic

## Engine hooks it implements

`getVisibleState`, `sampleWorlds`, `evaluateState`, `getActionDuration`, `toGrid`

## UI

- [ ] `ui` flags: none
- [ ] `toGrid` fields: `cells`, `height`, `width`
- UI plugins: none (`src/gate.test.js` keeps game ids and imports out of the play UI)

## Demos and benches

- [ ] `demo/rogue-demo.js`
- [ ] `npm run demo:rogue` (`node demo/rogue-demo.js`)
- [ ] `npm run demo:rogue:auto` (`node demo/rogue-demo.js --auto`)
- [ ] `npm run demo:rogue:greedy` (`node demo/rogue-demo.js --auto --greedy`)

## Tests

- [ ] `fog.test.js`: 10 tests
- [ ] `golden.test.js`: 2 golden replays (default, fog-on)
- [ ] `index.test.js`: 16 tests
- [ ] The core's checks of it, in its `contract.test.js` since phase 1 (roster editing; the greedy and, with `SLOW_TESTS=1`, rollout agents where it has them), and its pack in `library/` (`src/library.test.js`)

## README

No README.

## Art and other assets

- [ ] `images/`: 15 files, 3 KB

## What it uses from outside its folder

Since phase 1 each is a `#core/…` import (or moved into the game).

Nothing.

## Notes

- Not registered in the server and single-seat (a hero against the dungeon).
  Kept until the plan's open decision 4 is made: the recommendation is to
  extract it as it is.
- Its item ids came from a module counter that never reset, so a game's state
  depended on how many games the process had dealt before. Fixed in phase 0
  (`resetItemIds`, as aow and memoir44 already did) so its replays reproduce.

## Moved (2026-10-24)

To [opowell/battle-rogue](https://github.com/opowell/battle-rogue), built by
`scripts/extract-game.mjs` and pinned to the core at the commit it left from.
There it is registered (`games/games.json`: one seat, `p1` "Rogue", as its
golden replays seat it). It lends no units, so it has no pack in `library/`.
Checked there: `npm test` (the game's 28 tests, its 2 golden replays among them,
plus the app's own 4) passes; in the Browser, driven headless, the default
setup draws the dungeon with the monsters' sprites, and a turn ends and comes
back as the hero's (turn 2), with no console error or failed request.

Fixed in the core for it: the server refused any session of fewer than two
seats, whatever the registry said, so a one-seat game could not start
(`src/server/battleServer.js`, tested in `battleServer.test.js`).

As seen there, with no baseline (it was never playable in the core's Browser):
the roster lists everything on the board under "You", the dungeon's monsters
and the items on the floor (by raw ids, `u_27_5`) as well as the hero, since
the monsters' side (`dungeon`) is not a seat.
