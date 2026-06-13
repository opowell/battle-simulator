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

### Run a demo

Each game has an interactive demo (you vs random AI) and an `--auto` mode (random vs random):

```sh
# Interactive — you play White
npm run demo:chess

# Auto — watch random agents play
npm run demo:chess:auto

# Some games also have a --greedy flag for a smarter AI
npm run demo:xcom:greedy
```

All demo scripts: `demo:tactical`, `demo:cardbattle`, `demo:civ1`, `demo:civ2`, `demo:risk`, `demo:axisallies`, `demo:combatmission`, `demo:xcom`, `demo:aow`, `demo:cs`, `demo:ffta`, `demo:sc2`, `demo:doom` (append `:auto` or `:greedy` where available).

### Start the HTTP API server

```sh
npm start
# → Battle Simulator API running on http://localhost:3000
```

Set `PORT` to use a different port.

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

Returns the full session object (201).

#### `GET /sessions`
List all active sessions (id, game, status, turn, pendingPlayer).

#### `GET /sessions/:id`
Get full session state including `rendered` board, `legalActions`, and `pendingPlayer`.

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
# Create session
SESSION=$(curl -s -X POST localhost:3000/sessions \
  -H 'Content-Type: application/json' \
  -d '{"game":"chess","players":[{"id":"white","agent":"human"},{"id":"black","agent":"random"}]}' \
  | jq -r '.id')

# See board + legal actions
curl -s localhost:3000/sessions/$SESSION | jq '{rendered, legalActions}'

# Submit an action
curl -s -X POST localhost:3000/sessions/$SESSION/action \
  -H 'Content-Type: application/json' \
  -d '{"playerId":"white","action":{"type":"move","unitId":"e2","from":"e2","to":"e4"}}'
```

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
npm test
```

Runs engine, chess, and tactical test suites.
