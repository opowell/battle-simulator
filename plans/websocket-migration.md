# Replace session polling with WebSockets

## Problem

The frontend (`apps/design`, the only UI now — `apps/classic`/`modern`/`minimal`/`voice2` were removed) polls `GET /sessions/:id` on a timer to detect game state changes:

- `apps/design/App.vue:247` — `maybeStartPoll()`, sets up a 2000ms `setInterval` (line 253) that calls `api.session(s.id, humanId)`

`api.session()` (`apps/design/api.js:17`) hits `GET /sessions/:id?player=<id>`, served by `api-server.js:466` (`handleGetSession`). This adds latency (up to one poll interval per move) and wasted requests when nothing has changed.

## Current server shape (relevant facts)

- `api-server.js` is a plain Node `http.createServer` (no Express) — `createServer(async (req, res) => {...})` at line 542, dispatch is a sequential `if (method === X && parts[0] === Y)` chain ending around line 637.
- Session state is an in-memory `Map`: `const sessions = new Map()`. No DB. `_persistLog()` (233) writes a log file but isn't authoritative.
- Mutating routes, i.e. the only things that change a session:
  - `POST /sessions` (handler `handleCreateSession`, 410-454) — creates session, `sessions.set(id, session)` (450)
  - `POST /sessions/:id/action` (handler `handleSubmitAction`, 488-514) — `agent.submit(action)` unblocks the engine, which advances asynchronously
  - `DELETE /sessions/:id` (handler `handleDeleteSession`, 528-534) — `session.close()` then `sessions.delete(id)`
  - The `Session` class (208-...) drives itself via `_run()` (240), started in its constructor (221) — this is where state changes asynchronously between client requests (AI turns resolving) and is the key place a broadcast hook needs to live.
- `package.json` has zero runtime dependencies today (`"dependencies": {}`), node engine `>=18`. Node has no built-in WebSocket *server*. This migration will add `ws` as the repo's first backend dependency — worth flagging to the user before starting, since it breaks the "zero deps" streak (frontend "no build step" rule is unaffected — `ws` is server-only).
- There is no shared API-client package anymore (`packages/api-client` was deleted as dead code when the other three apps were removed). `apps/design/api.js` is a small standalone `fetch` wrapper local to that app — any WS helper added for the client lives there too, not in a shared package.

## Design

Push instead of poll: when a session mutates (new state after an action, or session closed), broadcast the new state to every WS client subscribed to that session id. Keep the REST endpoints as-is for initial load and as a fallback.

### 1. Server: add `ws` and an upgrade handler

- `npm install ws` (first backend dependency — confirm with user before running).
- In `api-server.js`, alongside `const server = createServer(...)`, create a `WebSocketServer({ noServer: true })` and handle `server.on('upgrade', ...)`.
- Expect connections at `wss://host/sessions/:id/ws?player=:playerId`, mirroring the existing `?player=` query convention used by `getSession`/`getState`.
- On upgrade: parse `id` and `player` from the URL, look up `sessions.get(id)`; if missing, reject with 404 (close the socket during upgrade, don't accept then close). If found, accept and register the socket on the `Session` object (e.g. `session.wsClients` — a `Set<{ ws, playerId }>` or a `Map<playerId, Set<ws>>` if a player can have multiple tabs).
- On socket close, remove it from the session's client set. On session `close()` (existing method on `Session`, near `handleDeleteSession`), close and clear all registered sockets.

### 2. Server: broadcast on mutation

- Add a `_broadcast()` method to the `Session` class that serializes the same payload `handleGetSession` currently returns (respecting per-player visibility/fog if that's already player-scoped — check `handleGetSession`/`handleGetState` for any player-specific filtering before reusing the serializer) and sends it to each registered socket, scoped by `playerId` if the payload differs per player.
- Call `_broadcast()` from the same places that currently change engine state asynchronously — the `Session`'s internal `_run()` loop (240) after each engine step, and from `handleSubmitAction` / `handleDeleteSession` if state changes aren't already covered by `_run()`.
- Reuse existing serialization logic rather than duplicating it — extract whatever `handleGetSession` builds into a shared method on `Session` if it's currently inline in the HTTP handler.

### 3. Client: WS helper in `apps/design/api.js`

Add a function alongside the existing `window.api` object that returns a small subscription object instead of a raw `WebSocket`:

```js
window.api.subscribeSession = function subscribeSession(id, playerId, onUpdate) {
  // opens ws(s)://<host-derived-from-_BASE>/sessions/<id>/ws?player=<playerId>
  // onUpdate(data) on each message
  // on error/close: fall back to a single api.session() poll, then retry the WS connection with backoff
  // returns { close() }
};
```

- Derive `ws://`/`wss://` from `_BASE` (swap `http`→`ws`, `https`→`wss`) so both dev (`http://localhost:3333`) and any future TLS deployment work without a second config value.
- Keep `api.session()` unchanged — still needed for first paint before the socket opens, and as the fallback path.

### 4. Client: swap polling for subscription in `apps/design/App.vue`

- Replace the `setInterval(...)` block in `maybeStartPoll()` (238-261) with a call to `api.subscribeSession(s.id, humanId, (fresh) => { /* existing body of the interval callback, lines 256-258 */ })`.
- Keep the existing update-handling logic (lines 256-258: update `liveState.value`, stop on non-active status or human turn) unchanged — only the trigger mechanism changes.
- Store the returned `{ close() }` in place of `_poll`, and call it from `stopPoll()` (241) instead of `clearInterval(_poll)`.

### 5. Fallback / resilience

- If the WS connection fails to open (e.g. proxy strips upgrade headers) or drops mid-game, fall back to the existing interval-poll behavior automatically rather than leaving the UI stale. Simplest approach: `subscribeSession` internally retries the WS connection with backoff, and while disconnected, runs the old poll loop at the original 2000ms interval as a safety net; stop the safety-net poll once the socket reconnects.

### 6. Out of scope

- No change to session persistence (still in-memory, still lost on server restart) — that's an orthogonal concern.
- No auth/token changes — player id stays a plain query param, matching current REST behavior.
- Not migrating to Cloudflare Workers/Durable Objects — server stays plain Node `http`.

## Verification

- Manual: open two browser tabs against the same session (two different players), confirm moves in one tab appear in the other within the WS round-trip time instead of up to 2000ms later.
- Manual: kill the WS mid-game (e.g. via devtools network throttling/offline toggle) and confirm the UI falls back to polling and recovers when connectivity returns.
- Confirm `apps/design` still functions end-to-end via `/verify` or manual click-through, since this touches `api-server.js`'s session handling.

## Open questions for the user

1. OK to add `ws` as the first backend npm dependency, or is a zero-dependency hand-rolled WS handshake preferred?
2. Does `handleGetSession`'s response already differ per player (fog of war), or is it the same payload for everyone? This determines whether broadcast needs to be per-player-scoped or can be a single shared message.
