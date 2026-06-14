# Battle Simulator

A turn-based game engine for running and building strategy games in JavaScript (ESM). Comes with 15 game implementations, three agent types, and an HTTP API server.

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
| `aow` | Age of Wonders | [games/aow/](games/aow/README.md) |
| `cs` | Counter-Strike | [games/cs/](games/cs/README.md) |
| `ffta` | Final Fantasy Tactics Advance | [games/ffta/](games/ffta/README.md) |
| `sc1` | StarCraft 1 | [games/sc1/](games/sc1/README.md) |
| `sc2` | StarCraft 2 | [games/sc2/](games/sc2/README.md) |
| `doom` | Doom | [games/doom/](games/doom/README.md) |

## Quick start

Requires Node.js ≥ 18. No install step — `node_modules` is committed.

### Run a demo

Each game has an interactive demo (you vs random AI) and an `--auto` mode (random vs random):

```sh
node demo/chess-demo.js
node demo/chess-demo.js --auto
node demo/xcom-demo.js --auto --greedy
```

All demos are in `demo/`: `chess`, `tactical`, `cardbattle`, `civ1`, `civ2`, `risk`, `axisallies`, `combatmission`, `xcom`, `aow`, `cs`, `ffta`, `sc2`, `doom`, `rogue`.

### Start the HTTP API server

```sh
node api-server.js
# → Battle Simulator API running on http://localhost:3000
```

Set `PORT` to use a different port.

## Web UIs

Four browser UIs ship in `apps/`. The first three connect to the live API server and can play every game; they differ only in visual style. The fourth is a standalone design prototype.

| App | Port | Aesthetic |
|---|---|---|
| `apps/classic` | 5173 | CRT terminal — green-on-black, monospace, sidebar action list |
| `apps/modern` | 5174 | Card-based — clean sans-serif, hover effects, spinner for AI turns |
| `apps/minimal` | 5175 | Text only — type a number and press Enter to act |
| `apps/design` | any | Vue 3 UI prototype — hardcoded data, no API, no build step |

### Running

The UIs talk to the HTTP API server, so start that first:

```sh
node api-server.js    # API on localhost:3000
```

Then in a separate terminal, start whichever UI you want:

```sh
node apps/classic/vite.js   # → localhost:5173
node apps/modern/vite.js    # → localhost:5174
node apps/minimal/vite.js   # → localhost:5175
```

No `cd` needed — run everything from the repo root.

Override the port with `--port`:

```sh
node apps/modern/vite.js --port 5200
```

Or use npm workspaces if you prefer:

```sh
npm run dev -w @battle-sim/classic
npm run dev -w @battle-sim/modern
npm run dev -w @battle-sim/minimal
```

All three can run simultaneously against the same server.

### Design app

`apps/design` is a UI prototype built with Vue 3 and has no build step. It loads Vue from a CDN and uses `vue3-sfc-loader` to compile `.vue` Single File Components directly in the browser at runtime. It contains hardcoded static data (`data.js`) and makes no API calls — it's a standalone sandbox for visual design, not a playable client.

To run it, serve the directory with any static file server:

```sh
npx serve apps/design          # or:
python3 -m http.server -d apps/design 5176
```

### How they work

Each UI follows the same flow:
1. `GET /games` — show a game picker
2. `POST /sessions` — create a session (you play player 1, random AI plays the rest)
3. Poll `GET /sessions/:id` every 800 ms until it's your turn
4. When `pendingPlayer` matches your player ID, display `legalActions` and wait for your pick
5. `POST /sessions/:id/action` — submit your chosen action, re-render

### Multiplayer (two humans, separate browsers)

Set both players to **Human** on the configure screen. After the session is created you'll see a share banner under the topbar with a unique link for each other human player — send each player their own link.

When Player B opens their link (`?session=<id>&player=<pid>`), the app joins the existing session as that player. Each browser shows only that player's actions when it's their turn, and "Waiting for…" otherwise. The board stays in sync via polling.

**Flow at a glance:**

```
Player A opens app → configures Chess (both Human) → Start Game
  → sees White's actions
  → share banner shows: Black → http://localhost:5174/?session=abc&player=black

Player B opens the Black link
  → joins session abc as Black
  → sees "Waiting for White..." until White moves
  → once it's Black's turn, sees Black's actions

Both browsers poll every 800 ms and re-render automatically.
```

There is no lobby or authentication — the share link is the full credential. Anyone who opens a player's link can act as that player.

They're vanilla JS with no framework. [Vite](https://vitejs.dev) is the only build tool, used for the dev server and ES module bundling.

### Shared API client

All three apps import from `packages/api-client`, a workspace package symlinked by npm workspaces. It's a thin `fetch` wrapper:

```js
import { BattleSimClient } from '@battle-sim/api-client';

const client = new BattleSimClient();          // defaults to localhost:3000
await client.listGames();
await client.createSession('chess', players);
await client.getSession(id);
await client.submitAction(id, playerId, action);
await client.deleteSession(id);
```

### Adding a new UI

1. Copy any `apps/*` directory and add a `vite.js` with the new port
2. Import `BattleSimClient` from `@battle-sim/api-client` and build whatever DOM structure you want

### Building for production

```sh
node node_modules/vite/bin/vite.js build --root apps/classic
# outputs to apps/classic/dist/
```

Serve the `dist/` directory from any static host. Point it at your deployed API server by instantiating `new BattleSimClient('https://your-api-host')`.

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
| `maxTurns` | `number` | `500` | Stop with a draw after this many turns |
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

#### `DELETE /sessions/:id`
Close and remove a session.

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
