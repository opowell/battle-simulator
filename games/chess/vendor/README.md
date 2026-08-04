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

It stayed behind when the AI was extracted because it is ours and it is large:
tens of thousands of positions from games played here, ~50 MB, and derived data
by definition. Shipping that inside a public package would put it in front of
every clone. [`../stockfish.js`](../stockfish.js) is the shim that points the
vendored engine at this directory; without it the package would write its cache
next to its own engine instead.
