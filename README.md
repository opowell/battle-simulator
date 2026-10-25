# Battle Simulator

A generic battle core in JavaScript (ESM): the engine, its own ruleset
(`BattleGame`, driven by battle specs), generic AIs, an HTTP and WebSocket
server, and the Browser to play in. Run on its own it is a **battle sandbox**:
write a battle as data, play it at once against the generic AI, and mix in units
and maps from every game built on the core. Works offline or online.

A battle is defined along six axes, and the core plays every combination:

| Axis | Values |
|---|---|
| **Units** | hit points, attack, defense, range, rate, speed, vision, facing, plus any attributes a battle declares (pools such as mana or ammo, tags, statuses) |
| **Actions** | move, strike, and any ability a battle defines, from a small closed set of effects |
| **Board** | discrete (square, hex or region cells) or continuous (exact points on a plane), with terrain that changes movement, cover and sight |
| **Time** | discrete (turns) or continuous (one clock; actions take time) |
| **Turns** | sequential or simultaneous |
| **Fog of war** | off, on, or on with last-seen memory |

## The sandbox

| Key | Game | Docs |
|---|---|---|
| `arena` | The core's own battles: Arena's skirmishes, a scenario per battle spec in [games/arena/specs/](games/arena/specs/), and every library map | [games/arena/](games/arena/README.md) |

A **battle spec** is JSON: unit types, terrain, board, abilities, attributes,
objectives ([the format](src/battle/README.md)). Each one in
`games/arena/specs/` is a scenario. The Browser's **Specs** edits them: a spec is
checked as it is typed, saved only when it can be played, and played by the next
session started, with no restart. **New spec…** starts one from a copy or from
two small armies on open ground.

## Games built on the core

Every game that once lived here is a standalone app in a repo of its own, which
vendors this one as `vendor/battle-simulator` and pins a release of it. Its
units, terrain and maps stay here, in [the library](#library), for the sandbox
to mix.

| Key | Game | Repo |
|---|---|---|
| `chess` | Chess, plus fog of war and three (space × time) variants | [opowell/battle-chess](https://github.com/opowell/battle-chess) |
| `civ1` | Civilization I | [opowell/battle-civ1](https://github.com/opowell/battle-civ1) |
| `civ2` | Civilization II | [opowell/battle-civ2](https://github.com/opowell/battle-civ2) |
| `risk` | Risk | [opowell/battle-risk](https://github.com/opowell/battle-risk) |
| `axisallies` | Axis & Allies | [opowell/battle-axisallies](https://github.com/opowell/battle-axisallies) |
| `kdice` | KDice | [opowell/battle-kdice](https://github.com/opowell/battle-kdice) |
| `combatmission` | Combat Mission | [opowell/battle-combatmission](https://github.com/opowell/battle-combatmission) |
| `xcom` | XCOM | [opowell/battle-xcom](https://github.com/opowell/battle-xcom) |
| `aow` | The Ancient Art of War | [opowell/battle-aow](https://github.com/opowell/battle-aow) |
| `cs` | Counter-Strike | [opowell/battle-cs](https://github.com/opowell/battle-cs) |
| `ffta` | Final Fantasy Tactics Advance | [opowell/battle-ffta](https://github.com/opowell/battle-ffta) |
| `sc1` | StarCraft I | [opowell/battle-sc1](https://github.com/opowell/battle-sc1) |
| `sc2` | StarCraft II (vendors battle-sc1) | [opowell/battle-sc2](https://github.com/opowell/battle-sc2) |
| `doom` | Doom | [opowell/battle-doom](https://github.com/opowell/battle-doom) |
| `memoir44` | Memoir '44 | [opowell/battle-memoir44](https://github.com/opowell/battle-memoir44) |
| `mudandblood` | Mud and Blood | [opowell/battle-mudandblood](https://github.com/opowell/battle-mudandblood) |
| `warofdots` | War of Dots | [opowell/battle-warofdots](https://github.com/opowell/battle-warofdots) |
| `surviv` | surviv.io | [opowell/battle-surviv](https://github.com/opowell/battle-surviv) |
| `rogue` | Rogue (one seat; never registered here) | [opowell/battle-rogue](https://github.com/opowell/battle-rogue) |
| `simcity` | SimCity (one seat, not a battle; no board in the Browser) | [opowell/battle-simcity](https://github.com/opowell/battle-simcity) |

## Quick start

Requires Node.js ≥ 18. Two repositories are vendored as git submodules: the
Obscuro search at `vendor/obscuro`
([opowell/obscuro-ai](https://github.com/opowell/obscuro-ai)) and the UI
framework at `vendor/appfr` ([opowell/appfr](https://github.com/opowell/appfr)).
So clone with them, and install the one npm dependency (bignumber.js):

```sh
git clone --recurse-submodules https://github.com/opowell/battle-simulator.git
cd battle-simulator
git config core.hooksPath .githooks    # keeps the submodules in sync from here on
npm install
node api-server.js                     # then open http://localhost:3000/

# already cloned:
git config core.hooksPath .githooks
git submodule update --init --recursive
```

`core.hooksPath` points git at the tracked hooks in `.githooks/`, which re-run
`git submodule update --init --recursive` after every merge, checkout and rebase.
Without it a submodule silently stays empty the first time you pull a branch that
adds one, and every import from it fails with a confusing module-not-found.

### What is where

The repo is a generic **core**; the games built on it are repos of their own
(see [plans/generic-core-and-game-repos.md](plans/generic-core-and-game-repos.md)):

| Path | What it is |
|---|---|
| `src/engine/`, `src/agents/`, `src/kit/` | the engine, the generic AIs, and the board, time and turn machinery games build on |
| `src/server/` | the HTTP and WebSocket server, which an app constructs with its games: `createBattleServer({ games, … })` |
| `apps/` | the Browser and the play UI, which know no game (`src/gate.test.js` holds them to it) |
| `src/battle/` | the core's ruleset, `BattleGame`, driven by battle specs |
| `library/` | every game's units, terrain and maps as data, which the core's own ruleset fields (see [Library](#library)) |
| `games/arena/` | Arena: `BattleGame` with its specs (`specs/*.json`, one scenario each) |
| `games/games.json` | the registry: which games this app serves (`games/registry.js` loads it) |
| `api-server.js` | this app: the core's server with every game in the registry |
| `scripts/export-pack.mjs`, `scripts/export/` | how a game's repo writes its pack into the library |
| `scripts/extract-game.mjs`, `scripts/remove-game.mjs` | how a game made here leaves for a repo of its own (every game so far has) |

A game repo vendors this one as `vendor/battle-simulator` and imports the core as
`#core/...` (its `package.json`'s subpath imports).

### Run the AI bench

The generic AI against random (or greedy) play, in seat-swapped pairs, in every
mode of Arena or one of its reference scenarios:

```sh
node demo/generic-ai-bench.mjs
node demo/generic-ai-bench.mjs --game=close-quarters --vs=greedy-generic
```

Each game's own demos are in its repo.

### Start the HTTP API server

```sh
node api-server.js
# → Battle Simulator API running on http://localhost:3000
```

Set `PORT` to use a different port.

## Web UI

The UI is the Browser, served at the root of the API server (`http://localhost:3000/`; its files live under `/ui/browser/`). It's Vue 3 with no build step: `vue3-sfc-loader` compiles the `.vue` files in the browser, so an edit to one shows on the next page load.

```sh
node api-server.js             # then open http://localhost:3000/
```

A session is played in a tab of the Browser's window. The game screen — board, panels, history, analysis — lives in `apps/browser/play` and is game-agnostic: everything a game wants drawn comes from its `toGrid` and `ui`. A session can also be opened in a browser tab of its own (the ↗ on its tab, or the *Open sessions in new tab* setting), which is the Browser opened on that session.

### How it works

1. `GET /games` — show a game picker
2. `POST /sessions` — create a session (you play player 1, random AI plays the rest)
3. Poll `GET /sessions/:id` until it's your turn
4. When `pendingPlayer` matches your player ID, display `legalActions` and wait for your pick
5. `POST /sessions/:id/action` — submit your chosen action, re-render

### Multiplayer (two humans, separate browsers)

Set both players to **Human** on the configure screen. After the session is created you'll see a share banner under the topbar with a unique link for each other human player — send each player their own link.

When Player B opens their link (`?session=<id>&player=<pid>`), the app joins the existing session as that player. Each browser shows only that player's actions when it's their turn, and "Waiting for…" otherwise. The board stays in sync via polling.

There is no lobby or authentication — the share link is the full credential. Anyone who opens a player's link can act as that player.

### Changing settings mid-game

Every setting can be changed while a game is being played: the game's own options (fog of war, AI difficulty, the space and time models, a map), the engine's (simultaneous turns, observers, AI pacing, turn limit), who plays each seat, and the units on the board. Open the in-game menu (Esc) → **Game settings**. It is the setup form, opened on the game's current settings; only what you change is sent (`POST /sessions/:id/reconfigure`).

How each change lands is worked out generically, without game-specific code (`src/engine/reconfigure.js`):

| A setting that… | e.g. | lands as |
|---|---|---|
| the engine reads on every step | simultaneous turns, turn limit | the config changes, nothing else |
| the game copied into its state at the start | fog of war, AI difficulty | those fields are patched into the live position |
| decides what the world is | space, time, map, board size | the position is **rebuilt** from where every unit stands now |

A rebuild carries each unit to the same cell of the new board (a pawn on e4 becomes a body at the centre of e4, and back), and keeps whose turn it is and every unit's hit points. What a game keeps outside its units (castling rights, a civ's cities and research) restarts from the new settings' defaults. Editing units **without** changing the world is not a rebuild: the units go onto the game as it stands, so cities, research, the explored map and lost castling rights are all kept.

Any seat may change any setting, and every change is announced to everyone in the game and recorded in the session (`changes`). The moves before a rebuild stay readable in the log. Under fog, the units editor shows a seat only what it can see, and an edit leaves every unit it could not see exactly as it was.

## Browser

`/` (`apps/browser`) is where games are played, and everything *around* playing:
one searchable place for every object the server knows about. It is built on
[appfr](https://github.com/opowell/appfr), vendored as a submodule at
`vendor/appfr` and served from its prebuilt `dist/` at `/appfr/`.

| Object | What it is | What you can do |
|---|---|---|
| **Games** | the registry, `games/games.json` | edit player counts and sides, create, delete |
| **Specs** | each BattleGame's battle specs (Arena's `games/arena/specs/`) | edit with a live check, play, copy, create, delete — no restart |
| **Files** | each game's source under `games/<name>/` | edit and save (⌘S) |
| **Sessions** | games being played right now | start one, play it in a tab, delete it |
| **Recordings** | finished and interrupted games under `sessions/` | inspect seats, result and moves |
| **Scenarios** | each game's `scenarios` | start a session from one; edit its spec |
| **Units** | each game's unit types, read from its opening position | browse, with the game's own art |
| **Sides** | each game's default seats | browse; edit them on the game |
| **Agents** | the built-in AIs and the ones a game adds | browse |
| **Options** | each game's setup options, plus the engine's own | browse |

Everything is one result set with appfr's query language, and every object
carries the game it belongs to. The → beside a game narrows the whole corpus to
that game, and a number on a game row (Sessions 3, Units 6) opens exactly those
records. The query lives in the URL, so any view is a link. An opened record
becomes a tab beside the browser.

A link can also **start** a session and open it (`apps/browser/deeplink.js`):

```
/#/new/<game>[/<scenario>]?seats=human,cpu&fog=on&difficulty=40&maxTurns=80
```

Left bare it is the scenario's one-click start. `seats` names one agent per seat
(`cpu` is the game's default AI; `agent:Name` names the seat too); any other key
is one of the game's options by id (`fog` is short for `fogOfWar`, and an AI
difficulty's time key, `aiTimeMs`, sets a per-move time instead of a power level).
A key, agent or scenario the game does not have is refused by name rather than
ignored (`maxTurns=off` turns off a scenario's own limit). `#/session/<id>` and
`#/game/<name>` open an existing session and a game's setup page.

The setup page's **Copy link** writes one from the form as it stands, naming only
what differs from the defaults. Edited starting units can't go in a link; when the
form has them, the button wears a `*` and its tooltip says so.

The data comes from one endpoint, `GET /catalog` (`src/server/catalog.js`), which derives
it all generically: units come from the same `setupPreview` the setup screen
uses, so no game needs code for the Browser. Edits to a game's definition or
source take effect when the server next starts; a spec's take effect at once
(`src/server/specEditor.js`).

## Library

`library/<game>/` keeps each game's units, terrain and maps as data: `units.json`
(each unit type in the common vocabulary — hp, attack, defense, range, move,
domain — with the game's conversion factor, and how it looks for each seat), its
pictures in `art/`, `terrain.json` and `maps/` in the core's board format, and
`pack.json` (which commit of the game it came from, and what it leaves out).
Arena, the core's own ruleset, fields any of them: its setup screen's units editor
offers every unit of every pack, each playing as the nearest Arena type with its
stats converted, drawn as itself. The games themselves don't mix.

Every game has left for a repo of its own, so a pack is rewritten from there when
the game changes: the game's `pack.js` says how its units read, and this repo's
`scripts/export/<game>.mjs` maps its terrain and maps.

```sh
# in a game's repo (its vendored core runs the export):
npm run export-pack -- --out <battle-simulator>/library
```

## Engine API

### Running a full game

A game imports the core through Node subpath imports (`package.json`'s
`"imports"`), never by a relative path out of its own folder: `#core/*` is
`src/*`. Outside a game, plain paths work too.

```js
import { GameEngine } from '#core/engine/index.js';
import { ArenaGame } from './games/arena/index.js';
import { RandomAgent } from '#core/agents/index.js';

const players = [
  { id: 'p1', name: 'One', agent: RandomAgent },
  { id: 'p2', name: 'Two', agent: RandomAgent },
];

const engine = new GameEngine(ArenaGame, players, { maxTurns: 200 });
const { result, log, finalState } = await engine.run();
console.log(result); // { outcome: 'win'|'draw', winnerId, reason }
```

### Stepping manually

```js
engine._init();
while (!engine.result) {
  const { done } = await engine.step();
  if (done) break;
  console.log(ArenaGame.renderState(engine.state));
}
```

### Constructor options

| Option | Type | Default | Description |
|---|---|---|---|
| `maxTurns` | `number` | *(none)* | Stop with a draw after this many turns. Optional — with no limit set, `run()` goes until the game ends itself |
| `stepLimit` | `number` | derived from `maxTurns` | Hard cap on `run()`'s steps; the only bound on an unlimited game |
| `rng` | `() => number` | `Math.random` | Seeded RNG for deterministic replays |
| `fogOfWar` | `boolean` | `false` | Call `game.getVisibleState` per player before asking for actions |

### Properties

| Property | Description |
|---|---|
| `engine.state` | Current (frozen) `GameState` |
| `engine.log` | Array of `{ turnNumber, phase, playerActions }` entries |
| `engine.result` | `GameResult` once the game ends, otherwise `null` |

## Agents

### RandomAgent

Picks a random legal action. Stateless singleton — pass directly without `new`.

```js
import { RandomAgent } from './agents/index.js';
{ id: 'p1', name: 'Player 1', agent: RandomAgent }
```

### HumanAgent

Prints legal actions to stdout and reads a numbered choice from stdin.

```js
import { HumanAgent } from './agents/index.js';
const human = new HumanAgent('Alice');
// call human.close() when done to release readline
```

### ApiAgent

Used internally by the HTTP server. Suspends `chooseAction` until `agent.submit(action)` is called externally.

```js
import { ApiAgent } from './agents/ApiAgent.js';
const agent = new ApiAgent('p1');
// agent.pending → { legalActions } when waiting, null otherwise
agent.submit(action);  // unblocks the engine
agent.abort('reason'); // rejects pending promise
```

### GenericAgent

The generic AI. It plays any battle from the units' numbers alone (attack,
defense, range, speed, hit points), never calling a game's `evaluateState`. It
runs in discrete or continuous space and time, sequentially or simultaneously.
It plans its whole turn with a beam search over its own actions, judges
positions by material, exposure, threat and initiative, remembers enemies lost
under fog, and calibrates itself to each game's damage scale.

```js
import { makeGenericAgent } from './agents/generic/GenericAgent.js';
{ id: 'p2', name: 'CPU', agent: makeGenericAgent(MyGame) }
```

Offered for every game as **AI (generic tactics)**. It is
[Arena](games/arena/README.md)'s default opponent. How it works, and what it has
been measured against: [src/agents/generic/](src/agents/generic/README.md).

### ObscuroAgent

The equilibrium AI: it reasons over a sampled belief cloud, groups
indistinguishable positions into shared information sets, and solves for a mixed
strategy rather than best-responding to a guess. It works for any game here, at
any information level, with perfect information as the special case.

```js
import { ObscuroAgent } from './agents/ObscuroAgent.js';
{ id: 'p1', name: 'Player 1', agent: new ObscuroAgent(MyGame) }
```

It contains no game knowledge, so it lives in **its own repository** —
[github.com/opowell/obscuro-ai](https://github.com/opowell/obscuro-ai) — vendored
here as a submodule at `vendor/obscuro`. `src/agents/ObscuroAgent.js` is a one-line
re-export of it.

```sh
git submodule update --remote vendor/obscuro         # pull the latest upstream
git add vendor/obscuro && git commit                 # pin the new commit
```

A game opts into stronger play by implementing the optional hooks in
[src/kit/types.js](src/kit/types.js) — `evaluateState` for leaf values,
`getVisibleState` + `sampleWorlds` for real fog reasoning. Upstream's
[docs/GAME-INTERFACE.md](vendor/obscuro/docs/GAME-INTERFACE.md) is the guide, and
[docs/PARAMETERS.md](vendor/obscuro/docs/PARAMETERS.md) documents every knob. The
fog-chess specialisation built on it (a Stockfish leaf evaluator, an exact belief
tracker) is [opowell/obscuro-chess](https://github.com/opowell/obscuro-chess),
which [battle-chess](https://github.com/opowell/battle-chess) vendors.

## HTTP API

Start the server with `npm start` (default port 3000).

### Endpoints

#### `GET /games`
List available games and their default player IDs.

#### `POST /sessions`
Create a new game session.

```json
{
  "game": "arena",
  "players": [
    { "id": "p1", "name": "One", "agent": "human" },
    { "id": "p2", "name": "Two", "agent": "random" }
  ],
  "config": { "maxTurns": 300 }
}
```

- `agent`: `"human"` (waits for API input) or `"random"` (auto-plays)
- `players` defaults to both players as `"human"` if omitted
- `config.maxTurns` is optional; omit it and the session has no turn limit

Returns the full session object (201). The response includes `humanPlayers: string[]` — the IDs of all human-controlled players in this session.

#### `POST /games/:name/setup`
The opening position a session *would* start from, for editing the units it opens
with. Body: `{ players?: [{id, name}], config?: {…} }` — the session being set up.

```json
{
  "config":    { "seed": 2553391646 },
  "placeable": true,
  "unitTypes": ["settlers", "militia", "…"],
  "roster":    [{ "id": "u0", "ownerId": "p1", "type": "settlers",
                  "position": {"x": 15, "y": 16}, "cell": [15, 16],
                  "imagePath": "/images/civ1/units/settlers", "glyph": "S" }],
  "board":     { "width": 50, "height": 30,
                 "cells": [{ "x": 0, "y": 0, "color": "#719230", "pos": {"x": 0, "y": 0} }] }
}
```

Every unit comes back with the board cell it stands on, and every cell with the
position it stands for, so a client can lay units out without knowing how a game
names its squares. `config` is echoed back with anything the game would otherwise
roll fresh (a map seed) pinned, and should be sent back when the session is
created so the units are placed on the world they were arranged on. `placeable`
is false for a game whose units aren't on a board at all (cards, territories) —
its roster can still be edited, just not arranged. Creates nothing.

#### Customised starting units

Send the edited roster as `config.startingUnits` on `POST /sessions`: the whole
opening roster, as `[{ id?, ownerId, type, position }]`. An entry whose `id` names
a unit of the same owner and type in the game's own opening is THAT unit, moved to
`position` (keeping its stats and everything else the game hung off it); anything
else is a new unit of that type. It works for every game — see
`src/engine/startingSetup.js` — and a roster the game cannot build is refused with a
reason (400) rather than creating a broken session. Because it lives in the
session's config, replays, analysis and undo rebuild from the same opening.

#### `GET /sessions`
List all active sessions (id, game, status, turn, pendingPlayer).

#### `GET /sessions/:id`
Get full session state including `rendered` board, `legalActions`, `pendingPlayer`, and `humanPlayers`.

#### `GET /sessions/:id/state`
Get the raw `GameState` object.

#### `POST /sessions/:id/action`
Submit an action for a human player.

```json
{ "playerId": "white", "action": { "type": "move", "unitId": "e2", "from": "e2", "to": "e4" } }
```

Returns the updated session. If the action advances to the opponent's turn, `pendingPlayer` and `legalActions` will reflect the next prompt.

#### `GET /sessions/:id/legal-actions?ply=`
What the side to move at `ply` may play — so a position being reviewed can be
picked up and moved by hand into a "what if" line, rather than only replaying
what happened. Refused during a live match (under fog, one side's legal moves
are a restatement of what that side can see); available in replay and on an
analysis board.

#### `GET /sessions/:id/database?ply=` · `POST /sessions/:id/database`
For games that declare one (battle-chess: recorded Fog of War games), what human players
who knew what this seat knows went on to play from here. `POST` takes
`{ ply, line: [action, …] }`, where `line` is a fictional continuation off that
ply, so an explored variation can be looked up too. Same availability rule as
above: replay or analysis board, never a live match.

#### `POST /sessions/:id/undo`
Take moves back: `{ toPly }` keeps exactly that many, `{ plies }` (default 1)
drops that many from the end. The moves are gone from the record — unlike a fork,
which leaves the game alone and explores beside it — and everything they produced
goes with them (result, captured pieces, recorded frames). Analysis boards only.

#### `DELETE /sessions/:id`
Close and remove a session.

### Analysis boards

Create a session with every seat `"human"` and `config.analysisBoard: true` and it
becomes a study board rather than a match: you move all sides, the full board can
be revealed while you play, moves can be taken back, and the analysis/database
panels stay open. The flag is only honoured when no seat is played by an AI, so it
cannot be used to open the book — or rewrite the moves — against an opponent. In
the UI: a game's **Analysis** button in the lobby.

Three ways to go back, which do different things:

| | what it does |
|---|---|
| the ◀ ▶ history controls | change what is on screen; the game is untouched |
| playing a move from a past ply | branches a "what if" line beside the game (a fork) |
| **Undo** | drops the move from the game, and play continues from before it |

### Example: play a battle via curl

```sh
# Create session (one human vs random AI)
SESSION=$(curl -s -X POST localhost:3000/sessions \
  -H 'Content-Type: application/json' \
  -d '{"game":"arena","players":[{"id":"p1","agent":"human"},{"id":"p2","agent":"random"}]}' \
  | jq -r '.id')

# See board + legal actions
curl -s localhost:3000/sessions/$SESSION | jq '{rendered, legalActions}'

# Submit an action
curl -s -X POST localhost:3000/sessions/$SESSION/action \
  -H 'Content-Type: application/json' \
  -d '{"playerId":"p1","action":{"type":"move","unitId":"p1-1","from":{"x":1,"y":1},"to":{"x":2,"y":1}}}'
```

### Example: a two-human battle via curl

Both players post actions to the same session; each waits until `pendingPlayer` matches their own ID.

```sh
# Create session — both players are human
SESSION=$(curl -s -X POST localhost:3000/sessions \
  -H 'Content-Type: application/json' \
  -d '{"game":"arena","players":[{"id":"p1","agent":"human"},{"id":"p2","agent":"human"}]}' \
  | jq -r '.id')

# p1 moves a unit, then ends its turn (pendingPlayer is "p1")
curl -s -X POST localhost:3000/sessions/$SESSION/action \
  -H 'Content-Type: application/json' \
  -d '{"playerId":"p1","action":{"type":"move","unitId":"p1-1","from":{"x":1,"y":1},"to":{"x":2,"y":1}}}'
curl -s -X POST localhost:3000/sessions/$SESSION/action \
  -H 'Content-Type: application/json' \
  -d '{"playerId":"p1","action":{"type":"end-turn","unitId":"__player__"}}' \
  | jq '{pendingPlayer, turn}'
# → pendingPlayer: "p2"
```

Submitting an action out of turn returns a 409 error.

## Implementing a custom game

A game is a plain object (or class with static methods) implementing the `GameDefinition` interface:

```js
export const MyGame = {
  name: 'my-game',

  // Return the starting GameState
  createInitialState(players, config) { ... },

  // Return all legal Action objects for playerId
  getLegalActions(state, playerId) { ... },

  // Apply all actions for this step, return a NEW state (never mutate)
  // Must set state.activePlayers for the next step
  applyActions(state, playerActions, rng) { ... },

  // Return GameResult when game over, null while ongoing
  getResult(state) { ... },

  // Return a human-readable string
  renderState(state) { ... },

  // Optional: filter state for fog-of-war
  getVisibleState(state, playerId) { ... },

  // Optional: only for customised starting units (src/engine/startingSetup.js). The
  // feature itself needs none of these — it works off `state.units` alone.
  applyStartingUnits(state, config) { ... },  // rebuild what you derive from your opening units
  setupUnitTypes(state) { ... },              // types a roster may add beyond the ones you deal
  createSetupUnit(state, spec) { ... },       // mint one of them with your own stats
  resolveSetupConfig(config) { ... },         // pin what you would otherwise roll fresh (a map seed)
};
```

To serve it, add a line to `games/games.json` (the module, its export and its
seating; the Browser's **Games** writes this file too) and restart the server.
A battle the spec format can describe needs no code at all: write it as a spec
(see [The sandbox](#the-sandbox)), or make a `BattleGame` of your own
([src/battle/README.md](src/battle/README.md)). An app of
its own builds its server the same way `api-server.js` does:

```js
import { createBattleServer } from '#core/server/battleServer.js';
const server = createBattleServer({ games: { mygame: { game: MyGame, minPlayers: 2, maxPlayers: 2, defaultPlayers } } });
export default server.mount;           // JAS's embedded-mode contract
// or: server.listen(3333)
```

### GameState shape

```js
{
  gameName: 'my-game',
  turnNumber: 1,          // increment when all players have acted
  activePlayers: ['p1'],  // IDs of players who act this step
  currentPhase: 'main',
  players: [...],
  units: [...],           // alive: false = dead/removed
  board: { ... },         // game-specific
  lastActions: null,      // actions that produced this state
  gameSpecific: { ... },  // any extra data
}
```

### Action shape

```js
{ type: 'move', unitId: 'u1', from: 'a1', to: 'a2' }
{ type: 'attack', unitId: 'u1', targetId: 'u2' }
{ type: 'end-turn' }
{ type: 'play-card', payload: { card: 'fireball', handIndex: 0 } }
```

Always include an `end-turn` action when the player may pass.

### GameResult shape

```js
{ outcome: 'win', winnerId: 'p1', reason: 'checkmate' }
{ outcome: 'draw', winnerId: null, reason: 'stalemate' }
```

## Tests

```sh
npm test
```

Runs the core's tests and Arena's (golden replays included): `npm test -- core`
or `npm test -- arena` for one half. Each game's tests are in its own repo, and
run there against the core it pins.

## Versions

The core is released as tags (`v1.0.0`, …), and a game repo pins its
`vendor/battle-simulator` to one. A minor release adds; a major one changes what
a game repo builds on (`createBattleServer`, the `GameDefinition` contract in
[src/kit/types.js](src/kit/types.js), the spec format, the `#core/*` paths). To
move a game onto a newer core, check the tag out in its `vendor/battle-simulator`
and run its tests and golden replays.

## Releases

```sh
npm run build-release
```

Six archives land in `dist/`, one per combination of two independent choices:

| flavour | how it runs |
| --- | --- |
| `standalone` | `node api-server.js` — the app serves itself |
| `jas` | bundles the [JAS](../..) server; `./jas.sh`, then pick it from the Launchpad |
| `source` | no server at all: `src/server/`, `api-server.js` and `settings.json` are removed. The engine, Arena, the agents and the UI sources, for use as a library or via `demo/*.js` |

| dependencies | |
| --- | --- |
| `-with-deps` | `node_modules` installed from the lockfile — unpack and run, no network |
| `-no-deps` | no `node_modules`; the recipient runs `npm install` |

Useful flags:

```sh
node scripts/build-release.mjs --flavours standalone       # a subset
node scripts/build-release.mjs --deps with                 # only the batteries-included half
node scripts/build-release.mjs --format tar.gz             # default is zip
node scripts/build-release.mjs --ref v0.2.0                # build from a tag
node scripts/build-release.mjs --out /tmp/bs-dist          # write elsewhere
```

Contents come from `git archive`, so an archive holds exactly what is committed
at that ref, minus the paths marked `export-ignore` in
[.gitattributes](.gitattributes). Two things are then added back, because git
archive cannot know about them:

- **The submodules.** `git archive` treats a submodule as a single tree entry
  and leaves the directory empty, so `vendor/obscuro` and `vendor/appfr` are
  archived from their own repositories at their pinned commits and unpacked
  into place. A
  build fails loudly if a submodule is missing or is not at its pin — run
  `git submodule update --init --recursive`.
- **`node_modules`**, from `package-lock.json`, for the `-with-deps` half. The
  build strips whatever a git archive supplied first, so the two halves really
  do differ (JAS, bundled into the `jas` flavour, commits its dependencies on
  purpose).

