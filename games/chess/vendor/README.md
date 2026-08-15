Two collections of data that are too big, too specific to this repo, or both, to
live inside the public AI package: the **Stockfish evaluation cache** and the
**corpus of recorded fog games**.

# Recorded fog games

`fow-*.json` — crawls of real Fog of War games, as move lists with the players'
usernames and ratings:

```json
{ "games": [ { "gameId": "…", "white": "…", "black": "…", "result": "1-0",
               "moves": ["d4", "c5", …],
               "players": [{ "username": "…", "rating": 2289 }, …] } ] }
```

Every file matching that name is read, de-duplicated by `gameId` (a crawl that
walks several archives meets the same game from both sides), and replayed to
build the game-database index behind the review panel — see
[`../fowDatabase.js`](../fowDatabase.js) and the chess README. Drop another crawl
in here and it joins the corpus; no rebuild step, the index is derived at
runtime.

# Stockfish evaluation cache

The engine itself is no longer here — Stockfish 18 lite is vendored with the
chess AI, at
[vendor/obscuro-chess/vendor/stockfish/](../../../vendor/obscuro-chess/vendor/stockfish/README.md).
What lives in this directory is only the **cache of its output**:

- `sf-cache.sqlite` — the disk-backed LRU used on Node ≥ 22.5 (`node:sqlite`)
- `sf-cache.ndjson` — the append-only fallback on older Node

`multiPV` is deterministic given (fen, depth, multipv), so its results keep
indefinitely; every key is namespaced by the engine tag (`ENGINE_TAG` in the
package's `src/stockfish.js`), so evaluations from an older engine can never be
served as though this one had produced them — they simply age out through the
LRU.

Both files are gitignored. They were tracked until they had cost ~420 MB of
history between them — a 23 MB sqlite that every run rewrites does not delta,
and it was committed sixteen times. Nothing is lost by that: the cache is
derived, and a missing entry is recomputed by the engine to the same value.

It stayed behind when the AI was extracted because it is ours and it is large:
tens of thousands of positions from games played here, ~50 MB, and derived data
by definition. Shipping that inside a public package would put it in front of
every clone. [`../stockfish.js`](../stockfish.js) is the shim that points the
vendored engine at this directory; without it the package would write its cache
next to its own engine instead.
