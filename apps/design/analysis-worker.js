// ---------------------------------------------------------------------------
// Browser analysis Web Worker — runs the Obscuro fog-of-war "suggest a move"
// analysis entirely off the main thread AND off the server.
//
// The expensive part (the CFR equilibrium solve, ~1–2s/batch of pure JS) runs
// here in the worker; belief worlds are computed locally from the fetched view
// state (identical to what the server derives for a human, who has no server-
// maintained belief either — both start fresh from the current observation).
// The one thing the browser can't do is Stockfish (WASM stays server-side), so
// each batch's centipawn evals are fetched from the server's cheap /cp-eval
// endpoint (~tens of ms). Results stream back to the panel as they refine.
//
// The whole chess + CFR graph is imported straight from the server's /lib/
// route (see api-server.js serveLibModule); stockfish.js is browser-safe
// (available() → false) so importing it here is harmless.
// ---------------------------------------------------------------------------
// Relative (not /lib absolute) so the imports also resolve when the app is
// mounted under a base path — this worker lives at <base>/ui/design/, so
// ../../lib/… lands on <base>/lib/… in both the standalone and embedded cases.
import { ChessGame } from '../../lib/games/chess/ChessGame.js';
import { analyzeObscuroProgressive } from '../../lib/games/chess/ObscuroAgent.js';

// Monotonic request id. A new 'analyze' (or 'cancel') bumps it; the running
// loop's isCancelled compares against it and bails at the next batch boundary
// (the loop awaits per batch, so these messages are processed between batches).
let currentReqId = 0;

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type === 'cancel') { currentReqId++; return; }
  if (msg.type !== 'analyze') return;

  const reqId = ++currentReqId;
  const { base = '', sessionId, playerId } = msg;
  const isCancelled = () => reqId !== currentReqId;

  try {
    // The fog-filtered view state (board, gameSpecific with castling/en-passant,
    // players, activePlayers, turnNumber) — exactly what the server-side analysis
    // sees. Legal moves are then derived locally the same way the server does
    // (resolveAnalysisContext: getLegalActions(viewState, color)).
    const res = await fetch(`${base}/sessions/${sessionId}/state?player=${encodeURIComponent(playerId)}`);
    if (!res.ok) throw new Error(`state ${res.status}`);
    const state = await res.json();
    if (isCancelled()) return;

    const color = playerId;
    const legalActions = ChessGame.getLegalActions(state, color);
    if (!legalActions || !legalActions.length) {
      self.postMessage({ type: 'done', reqId, candidates: [] });
      return;
    }

    // cp for a batch of belief worlds → the server's Stockfish leaf eval.
    const cpEval = async (worlds, la) => {
      const r = await fetch(`${base}/sessions/${sessionId}/cp-eval`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ color, legalActions: la, worlds }),
      });
      if (!r.ok) return { sums: null, n: 0 };
      return await r.json();
    };

    const result = await analyzeObscuroProgressive(state, legalActions, {
      color, isCancelled, cpEval,
      onProgress: (info) => { if (!isCancelled()) self.postMessage({ type: 'progress', reqId, ...info }); },
    });
    if (!isCancelled()) self.postMessage({ type: 'done', reqId, ...(result ?? { candidates: [] }) });
  } catch (err) {
    if (!isCancelled()) self.postMessage({ type: 'error', reqId, message: String((err && err.message) || err) });
  }
};
