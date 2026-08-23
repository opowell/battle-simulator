# Battle Simulator

A turn-based game engine for running and building strategy games in JavaScript (ESM). Comes with 15 game implementations, three agent types, and an HTTP API server. No install required; works offline or online.

## Games

| Key | Game | Docs |
|---|---|---|
| `chess` | Chess | [games/chess/](games/chess/README.md) |
| `tactical` | Tactical grid combat | [games/tactical/](games/tactical/README.md) |
| `cardbattle` | Card battle | [games/cardbattle/](games/cardbattle/README.md) |
| `civ1` | Civilization 1 | [games/civ1/](games/civ1/README.md) |
| `civ2` | Civilization 2 | [games/civ2/](games/civ2/README.md) |
| `risk` | Risk | [games/risk/](games/risk/README.md) |
| `axisallies` | Axis & Allies | [games/axisallies/](games/axisallies/README.md) |
| `combatmission` | Combat Mission | [games/combatmission/](games/combatmission/README.md) |
| `xcom` | XCOM | [games/xcom/](games/xcom/README.md) |
| `aow` | The Ancient Art of War | [games/aow/](games/aow/README.md) |
| `cs` | Counter-Strike | [games/cs/](games/cs/README.md) |
| `csmini` | Counter-Strike (simplified 2v2) | [games/csmini/](games/csmini/README.md) |
| `ffta` | Final Fantasy Tactics Advance | [games/ffta/](games/ffta/README.md) |
| `sc1` | StarCraft 1 | [games/sc1/](games/sc1/README.md) |
| `sc2` | StarCraft 2 | [games/sc2/](games/sc2/README.md) |
| `doom` | Doom | [games/doom/](games/doom/README.md) |
| `memoir44` | Memoir '44 | [games/memoir44/](games/memoir44/README.md) |

## Quick start

Requires Node.js ≥ 18. No install step — `node_modules` is committed.

The Obscuro AI lives in its own repositories and is vendored here as git
submodules — the generic search at `vendor/obscuro`, the fog-chess AI at
`vendor/obscuro-chess` (which carries the search as a submodule of its own) — so
clone with them:

```sh
git clone --recurse-submodules https://github.com/opowell/battle-simulator.git
git config core.hooksPath .githooks    # keeps the submodules in sync from here on

# already cloned:
git config core.hooksPath .githooks
git submodule update --init --recursive
```

`core.hooksPath` points git at the tracked hooks in `.githooks/`, which re-run
`git submodule update --init --recursive` after every merge, checkout and rebase.
Without it a submodule silently stays empty the first time you pull a branch that
adds one, and every Obscuro import fails with a confusing module-not-found.
`--recursive` matters: it is what fills in `vendor/obscuro-chess/vendor/obscuro`,
the search the chess AI actually runs on.

### Run a demo

Each game has an interactive demo (you vs random AI) and an `--auto` mode (random vs random):

```sh
node demo/chess-demo.js
node demo/chess-demo.js --auto
node demo/xcom-demo.js --auto --greedy
```

All demos are in `demo/`: `chess`, `tactical`, `cardbattle`, `civ1`, `civ2`, `risk`, `axisallies`, `combatmission`, `xcom`, `aow`, `cs`, `csmini`, `ffta`, `sc2`, `doom`, `memoir44`, `rogue`.

### Start the HTTP API server

```sh
node api-server.js
# → Battle Simulator API running on http://localhost:3000
```

Set `PORT` to use a different port.

## Web UI

One browser UI ships in `apps/design`. It's a Vue 3 app with no build step — it loads Vue from a CDN and uses `vue3-sfc-loader` to compile `.vue` Single File Components directly in the browser at runtime.

Start the API server, then serve `apps/design` with any static file server:

```sh
node api-server.js             # API on localhost:3000
npx serve apps/design          # or:
python3 -m http.server -d apps/design 5176
```

Or hit it directly from the API server at `/ui/design` (`http://localhost:3000/ui/design`).

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

## Engine API

### Running a full game

```js
import { GameEngine } from './engine/index.js';
import { ChessGame } from './games/chess/index.js';
import { RandomAgent } from './agents/index.js';

const players = [
  { id: 'white', name: 'White', agent: RandomAgent },
  { id: 'black', name: 'Black', agent: RandomAgent },
];

const engine = new GameEngine(ChessGame, players, { maxTurns: 200 });
const { result, log, finalState } = await engine.run();
console.log(result); // { outcome: 'win'|'draw', winnerId, reason }
```

### Stepping manually

```js
engine._init();
while (!engine.result) {
  const { done } = await engine.step();
  if (done) break;
  console.log(ChessGame.renderState(engine.state));
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
here as a submodule at `vendor/obscuro`. `agents/ObscuroAgent.js` is a one-line
re-export of it.

The **fog-chess** specialisation on top of it — the Stockfish leaf evaluator, the
exact belief tracker, the fitted move prior, chess's own difficulty dial — is a
second repository,
[github.com/opowell/obscuro-chess](https://github.com/opowell/obscuro-chess),
vendored at `vendor/obscuro-chess`. What stays here is
[games/chess/ChessGame.js](games/chess/ChessGame.js): this engine's rules
definition plus the renderer, fog markers and difficulty menu, handed to the
vendored agent with `setGame`.

```sh
git submodule update --remote vendor/obscuro         # pull the latest upstream
git add vendor/obscuro && git commit                 # pin the new commit
git submodule update --remote vendor/obscuro-chess   # same, for the chess AI
git add vendor/obscuro-chess && git commit
```

A game opts into stronger play by implementing the optional hooks in
[games/types.js](games/types.js) — `evaluateState` for leaf values,
`getVisibleState` + `sampleWorlds` for real fog reasoning. Upstream's
[docs/GAME-INTERFACE.md](vendor/obscuro/docs/GAME-INTERFACE.md) is the guide, and
[docs/PARAMETERS.md](vendor/obscuro/docs/PARAMETERS.md) documents every knob; the
fog-chess specialisation on top of it (Stockfish leaf eval, the exact belief
tracker) has its own docs at
[vendor/obscuro-chess/docs/PARAMETERS.md](vendor/obscuro-chess/docs/PARAMETERS.md).

## HTTP API

Start the server with `npm start` (default port 3000).

### Endpoints

#### `GET /games`
List available games and their default player IDs.

#### `POST /sessions`
Create a new game session.

```json
{
  "game": "chess",
  "players": [
    { "id": "white", "name": "White", "agent": "human" },
    { "id": "black", "name": "Black", "agent": "random" }
  ],
  "config": { "maxTurns": 300 }
}
```

- `agent`: `"human"` (waits for API input) or `"random"` (auto-plays)
- `players` defaults to both players as `"human"` if omitted
- `config.maxTurns` is optional; omit it and the session has no turn limit

Returns the full session object (201). The response includes `humanPlayers: string[]` — the IDs of all human-controlled players in this session.

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
For games that declare one (chess: recorded Fog of War games), what human players
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

### Example: play a chess game via curl

```sh
# Create session (one human vs random AI)
SESSION=$(curl -s -X POST localhost:3000/sessions \
  -H 'Content-Type: application/json' \
  -d '{"game":"chess","players":[{"id":"white","agent":"human"},{"id":"black","agent":"random"}]}' \
  | jq -r '.id')

# See board + legal actions
curl -s localhost:3000/sessions/$SESSION | jq '{rendered, legalActions}'

# Submit an action
curl -s -X POST localhost:3000/sessions/$SESSION/action \
  -H 'Content-Type: application/json' \
  -d '{"playerId":"white","action":{"type":"move","unitId":"wN","from":"b1","to":"c3"}}'
```

### Example: two-human chess game via curl

Both players post actions to the same session; each waits until `pendingPlayer` matches their own ID.

```sh
# Create session — both players are human
SESSION=$(curl -s -X POST localhost:3000/sessions \
  -H 'Content-Type: application/json' \
  -d '{"game":"chess","players":[{"id":"white","agent":"human"},{"id":"black","agent":"human"}]}' \
  | jq -r '.id')

# White moves (pendingPlayer is "white")
curl -s -X POST localhost:3000/sessions/$SESSION/action \
  -H 'Content-Type: application/json' \
  -d '{"playerId":"white","action":{"type":"move","unitId":"wN","from":"b1","to":"c3"}}' \
  | jq '{pendingPlayer, turn}'
# → pendingPlayer: "black"

# Black responds
curl -s -X POST localhost:3000/sessions/$SESSION/action \
  -H 'Content-Type: application/json' \
  -d '{"playerId":"black","action":{"type":"move","unitId":"bN","from":"b8","to":"c6"}}' \
  | jq '{pendingPlayer, turn}'
# → pendingPlayer: "white"
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
};
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
node --test test/*.test.js
```

Runs all game test suites.

## Releases

```sh
npm run build-release
```

Six archives land in `dist/`, one per combination of two independent choices:

| flavour | how it runs |
| --- | --- |
| `standalone` | `node api-server.js` — the app serves itself |
| `jas` | bundles the [JAS](../..) server; `./jas.sh`, then pick it from the Launchpad |
| `source` | no server at all: `api-server.js` and `settings.json` are removed. The engine, games, agents and UI sources, for use as a library or via `demo/*.js` |

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
  and leaves the directory empty, so `vendor/obscuro` and `vendor/obscuro-chess`
  (and the checkout of the search nested inside the latter) are archived from
  their own repositories at their pinned commits and unpacked into place. A
  build fails loudly if a submodule is missing or is not at its pin — run
  `git submodule update --init --recursive`.
- **`node_modules`**, from `package-lock.json`, for the `-with-deps` half. The
  build strips whatever a git archive supplied first, so the two halves really
  do differ: JAS commits its dependencies on purpose, and this repo still tracks
  a stray `node_modules/.package-lock.json`.

The Stockfish evaluation cache under `games/chess/vendor/` never ships, in any
flavour. It is not committed, so a `git archive` does not supply it — and the
build deletes `sf-cache.*` from the staged tree anyway, so re-committing it one
day cannot quietly put tens of MB of derived data into a release.
