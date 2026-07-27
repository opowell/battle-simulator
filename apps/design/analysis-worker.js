// ---------------------------------------------------------------------------
// Generic browser analysis Web Worker — runs whatever AI agent's position
// analysis the current game declares, entirely off the main thread AND off the
// server (aside from one cheap position fetch). No game-specific code lives
// here: the panel (AnalysisPanel.vue) tells us, per message, which ES modules
// to import and which exports to call — see each game's `agents[].clientAnalyze`
// and `clientGame` roster fields (api-server.js's /games serializes them).
//
// Everything the imported `analyze` function needs (search, leaf evaluation,
// etc.) is expected to run locally too — e.g. chess's analyze functions reach
// for games/chess/stockfish.js, which itself spins up the vendored Stockfish
// WASM as a nested Worker in the browser. This worker just wires the generic
// plumbing: fetch the (already fog-filtered) position, derive legal actions,
// call `analyze`, forward progress/result frames back to the panel.
// ---------------------------------------------------------------------------

// Monotonic request id. A new 'analyze' (or 'cancel') bumps it; the running
// analyze call's isCancelled compares against it and bails at its next chance
// to check (whenever the agent's search polls isCancelled between steps).
let currentReqId = 0;

// Resolves a dot-path ("Foo.bar") into an imported module namespace.
function resolveExport(mod, exportPath) {
  return exportPath.split('.').reduce((o, k) => o?.[k], mod);
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type === 'cancel') { currentReqId++; return; }
  if (msg.type !== 'analyze') return;

  const reqId = ++currentReqId;
  const { base = '', sessionId, playerId, fog, clientGame, clientAnalyze } = msg;
  const isCancelled = () => reqId !== currentReqId;

  try {
    // The fog-filtered view state (board, players, activePlayers, turnNumber,
    // …) — exactly what the server-side analysis sees. Legal moves are then
    // derived locally the same way the server does (resolveAnalysisContext).
    const res = await fetch(`${base}/sessions/${sessionId}/state?player=${encodeURIComponent(playerId)}`);
    if (!res.ok) throw new Error(`state ${res.status}`);
    const state = await res.json();
    if (isCancelled()) return;

    const [gameMod, analyzeMod] = await Promise.all([
      import(/* @vite-ignore */ `${base}/lib/${clientGame.module}`),
      import(/* @vite-ignore */ `${base}/lib/${clientAnalyze.module}`),
    ]);
    const Game = resolveExport(gameMod, clientGame.export);
    const analyze = resolveExport(analyzeMod, clientAnalyze.export);
    if (isCancelled()) return;

    // Mirrors api-server.js's resolveAnalysisContext: under fog, always analyze
    // the requesting viewer's own side (the only side they can reason about);
    // otherwise analyze whoever is actually to move.
    const color = fog ? playerId : (state.activePlayers?.[0] ?? playerId);
    const legalActions = Game.getLegalActions(state, color);
    if (!legalActions || !legalActions.length) {
      self.postMessage({ type: 'done', reqId, candidates: [] });
      return;
    }

    const result = await analyze(state, legalActions, {
      color, isCancelled,
      onProgress: (info) => { if (!isCancelled()) self.postMessage({ type: 'progress', reqId, ...info }); },
    });
    if (!isCancelled()) self.postMessage({ type: 'done', reqId, ...(result ?? { candidates: [] }) });
  } catch (err) {
    if (!isCancelled()) self.postMessage({ type: 'error', reqId, message: String((err && err.message) || err) });
  }
};
