# Vendored Stockfish (chess engine)

These are unmodified, prebuilt artifacts copied verbatim (no build step) so the
chess AI ships a strong engine with **no install required**.

- `stockfish.cjs`  — Stockfish 11, single-threaded WASM build (Emscripten loader).
  Renamed from the upstream `stockfish.js` to `.cjs` only because this repo is
  `"type":"module"`; the file contents are unmodified CommonJS.
- `stockfish.wasm` — the companion WebAssembly binary

**Source:** the npm package [`stockfish@11.0.0`](https://www.npmjs.com/package/stockfish)
(`src/stockfish.js`, `src/stockfish.wasm`) — the [stockfish.js](https://github.com/nmrugg/stockfish.js)
port of [Stockfish](https://stockfishchess.org/).

**License:** Stockfish is **GPL-3.0**. These files are redistributed under the
GPL. If you distribute this project with these files included, the GPL's terms
apply to that distribution.

Loaded in Node by [`../stockfish.js`](../stockfish.js); used as the
perfect-information move picker, with automatic fallback to the built-in JS
search if these files are absent or fail to load.
