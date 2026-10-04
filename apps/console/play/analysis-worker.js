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
// for the vendored chess AI's stockfish.js, which itself spins up Stockfish
// WASM as a nested Worker in the browser. This worker just wires the generic
// plumbing: fetch the (already fog-filtered) position, derive legal actions,
// call `analyze`, forward progress/result frames back to the panel.
// ---------------------------------------------------------------------------

// Monotonic request id. A new 'analyze' (or 'cancel') bumps it; the running
// analyze call's isCancelled compares against it and bails at its next chance
// to check (whenever the agent's search polls isCancelled between steps).
let currentReqId = 0;

// The last stopped walk, kept so Pause can be a pause rather than an
// abandonment: 'cancel' only bumps currentReqId, it deliberately does NOT clear
// this, so a later 'analyze' for the SAME position can hand the agent its own
// accumulator back (as `resumeState`) and continue instead of re-scoring every
// belief world from zero. Only agents that support it call `saveWalkState` —
// for anything else this stays null and nothing changes.
//
// One entry, not a cache: the walk being resumed is always the one just paused.
let lastWalk = null; // { key, state }

// Fingerprints the position a walk belongs to. A different board, side, session
// or agent is a different walk, and its accumulator must not be resumed into
// this one — the agent double-checks the shape it can (population size, ladder
// height), but only the caller knows the position actually changed.
function walkKey(sessionId, color, clientAnalyze, state) {
  return `${sessionId}|${color}|${clientAnalyze.module}.${clientAnalyze.export}|` +
    JSON.stringify({ b: state.board, g: state.gameSpecific, a: state.activePlayers, t: state.turnNumber });
}

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
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      let detail = body;
      try { detail = JSON.parse(body).error ?? body; } catch { /* not JSON */ }
      throw new Error(`state ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    const state = await res.json();
    if (isCancelled()) return;

    const [gameMod, analyzeMod] = await Promise.all([
      import(/* @vite-ignore */ `${base}/lib/${clientGame.module}`),
      import(/* @vite-ignore */ `${base}/lib/${clientAnalyze.module}`),
    ]);
    const Game = resolveExport(gameMod, clientGame.export);
    const analyze = resolveExport(analyzeMod, clientAnalyze.export);
    if (isCancelled()) return;

    // Mirrors api-server.js's resolveAnalysisContext for the only case that ever
    // reaches this worker — the LIVE position: under fog, always analyze the
    // requesting viewer's own side (the only side they can reason about);
    // otherwise analyze whoever is actually to move. (Historical plies, where
    // the analysed side follows the ply instead, stay on the server path.)
    const color = fog ? playerId : (state.activePlayers?.[0] ?? playerId);
    const legalActions = Game.getLegalActions(state, color);
    if (!legalActions || !legalActions.length) {
      self.postMessage({ type: 'done', reqId, color, candidates: [] });
      return;
    }

    const key = walkKey(sessionId, color, clientAnalyze, state);
    const result = await analyze(state, legalActions, {
      color, isCancelled,
      // `color` on every frame: the panel labels suggestions that are for a side
      // other than the viewer's own (see AnalysisPanel.vue).
      onProgress: (info) => { if (!isCancelled()) self.postMessage({ type: 'progress', reqId, color, ...info }); },
      resumeState: lastWalk?.key === key ? lastWalk.state : undefined,
      saveWalkState: (walkState) => { lastWalk = { key, state: walkState }; },
    });
    if (!isCancelled()) self.postMessage({ type: 'done', reqId, color, ...(result ?? { candidates: [] }) });
  } catch (err) {
    if (!isCancelled()) self.postMessage({ type: 'error', reqId, message: String((err && err.message) || err) });
  }
};
