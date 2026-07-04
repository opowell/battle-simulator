// ---------------------------------------------------------------------------
// Worker-thread bridge for the vendored Stockfish WASM.
//
// The WASM engine accrues heap memory across searches and eventually aborts with
// "memory access out of bounds". Running it inside a worker lets the main thread
// terminate() and respawn it to reclaim memory wholesale — an in-process reload
// cannot, because a fresh instance shares the same growing linear memory.
//
// Protocol (plain strings, structured-clone-cheap):
//   main → worker : a UCI command line to forward to the engine
//   worker → main : each engine output line, verbatim; or "__error__ <msg>" if
//                   the engine could not be constructed.
// ---------------------------------------------------------------------------
const { parentPort } = require('worker_threads');
const path = require('path');

const HERE = __dirname;
const JS_PATH = path.join(HERE, 'stockfish.cjs');
const WASM_PATH = path.join(HERE, 'stockfish.wasm');

// The Emscripten loader mistakes a defined `fetch` for a browser and tries to
// fetch the .wasm as a URL. WASM instantiation is async, so we must keep `fetch`
// hidden for the whole load — not just around the constructor call. This worker
// never needs fetch, so we simply drop it for the thread's lifetime.
globalThis.fetch = undefined;

let engine = null;
try {
  const STOCKFISH = require(JS_PATH);
  engine = STOCKFISH(WASM_PATH);
} catch (e) {
  parentPort.postMessage('__error__ ' + (e && e.message ? e.message : e));
}

if (engine) {
  engine.onmessage = (raw) => {
    parentPort.postMessage(String(raw == null ? '' : (raw.data ?? raw)));
  };
  parentPort.on('message', (cmd) => {
    try { engine.postMessage(cmd, true); } catch { /* engine dying; ignore */ }
  });
}
