// api.js — HTTP client for the Battle Simulator API. Talks to whatever
// origin/path prefix loaded this page, so it works standalone (served at the
// root) or embedded under a launcher (e.g. served at /battle-simulator/ui/design/).
const _BASE_PATH = window.location.pathname.replace(/\/ui\/.*$/, '');
const _BASE = window.location.origin + _BASE_PATH;

async function _req(path, opts) {
  const r = await fetch(_BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!r.ok) {
    const text = await r.text();
    // Error responses are JSON ({ error: "..." }, see api-server.js's err()) — surface
    // just the message, not the raw '{"error":"..."}' body, wherever e.message is shown.
    let message = text;
    try { message = JSON.parse(text).error ?? text; } catch { /* not JSON — use as-is */ }
    throw new Error(message);
  }
  return r.json();
}

// Game state carries root-relative image paths computed server-side (e.g.
// "/images/cs/units/ct"); re-add our own mount prefix so they resolve
// correctly whether running standalone (prefix '') or embedded (e.g.
// "/battle-simulator") under a launcher.
function imgSrc(path) {
  return path && path.startsWith('/') ? _BASE_PATH + path : path;
}

window.api = {
  basePath: _BASE_PATH,
  imgSrc,
  games:    ()                      => _req('/games'),
  sessions: ()                      => _req('/sessions'),
  session:  (id, player)             => _req('/sessions/' + id + (player ? '?player=' + player : '')),
  // Full-information observer snapshot over REST (fog bypassed) — the polling
  // fallback for the observer WebSocket, so a fog game stays watchable even where
  // the socket can't connect (e.g. behind a proxy that drops upgrades). `viewAs`
  // narrows it to one player's fog-limited view instead.
  sessionObserver: (id, viewAs) => _req('/sessions/' + id + '?observer=1' + (viewAs ? '&viewAs=' + encodeURIComponent(viewAs) : '')),
  history:  (id)                    => _req('/sessions/' + id + '/history'),
  log:      (id)                    => _req('/sessions/' + id + '/log'),
  create:   (body)                  => _req('/sessions', { method: 'POST', body: JSON.stringify(body) }),
  action:   (id, playerId, action)  => _req('/sessions/' + id + '/action', { method: 'POST', body: JSON.stringify({ playerId, action }) }),
  setMarker: (id, playerId, col, row, type) => _req('/sessions/' + id + '/marker', { method: 'POST', body: JSON.stringify({ playerId, col, row, type }) }),
  // Live playback controls: { paused?, aiDelay? }. Pauses/resumes the run loop and
  // sets the delay (ms) the engine waits between AI moves. Returns the applied values.
  control:  (id, body)              => _req('/sessions/' + id + '/control', { method: 'POST', body: JSON.stringify(body) }),
  // Read-only "what's good here" analysis for a live or replayed (ply) position.
  analyze:  (id, { playerId, agentId, ply }) =>
    _req('/sessions/' + id + '/analyze', { method: 'POST', body: JSON.stringify({ playerId, agentId, ply }) }),
  // Play a move into a throwaway sandbox branched off a live/historical position.
  // Pass `ply` to start a new fork from history, or `forkState` (the `state` a
  // prior forkMove call returned) to continue moving within the same fork.
  forkMove: (id, { ply, forkState, playerId, action }) =>
    _req('/sessions/' + id + '/fork-move', { method: 'POST', body: JSON.stringify({ ply, forkState, playerId, action }) }),
  del:      (id)                    => _req('/sessions/' + id, { method: 'DELETE' }),
};

// Stream a single analysis with live progress (Stockfish "depth N/14" ticks,
// Obscuro "round N/30" ticks — see api-server.js's handleAnalyzeStream) via
// Server-Sent Events. onEvent(data) fires once per progress frame and once
// more for the final result ({..., done:true}), then the stream closes on its
// own. Returns a handle with close() to abandon it early (e.g. a newer
// analysis request supersedes this one) — the caller owns its lifecycle.
window.api.analyzeStream = function analyzeStream(id, { playerId, agentId, ply }, onEvent) {
  const params = new URLSearchParams({ playerId, agentId });
  if (ply != null) params.set('ply', ply);
  const es = new EventSource(_BASE + '/sessions/' + id + '/analyze-stream?' + params);
  let closed = false;
  es.onmessage = (ev) => {
    if (closed) return;
    try {
      const data = JSON.parse(ev.data);
      onEvent(data);
      if (data.done) { closed = true; es.close(); }
    } catch {}
  };
  // A dropped connection mid-stream (network hiccup, server restart) — surface
  // it as a terminal error frame rather than leaving the caller waiting forever.
  es.onerror = () => {
    if (closed) return;
    closed = true;
    es.close();
    onEvent({ error: 'Analysis stream disconnected', done: true });
  };
  return { close() { if (!closed) { closed = true; es.close(); } } };
};

// Subscribe to live session updates over WebSocket, replacing the old 2s poll.
// onUpdate(data) fires with the same shape api.session() returns, once on connect
// and again on every server-side state change. If the socket can't open or drops,
// it falls back to a 2s REST poll and keeps retrying the socket with backoff, so
// the UI never goes stale behind a proxy that strips upgrade headers. Returns a
// handle with close(); the caller owns its lifecycle.
const _WS_BASE = _BASE.replace(/^http/, 'ws'); // http→ws, https→wss

// `observer` (4th arg) subscribes read-only — the server pushes the full,
// fog-bypassing game state (held back by the session's observer delay, if any).
// `viewAs` (5th arg, observer only) narrows the observer to one player's own
// fog-limited perspective instead of the full-information view.
window.api.subscribeSession = function subscribeSession(id, playerId, onUpdate, observer = false, viewAs = null) {
  const query = observer
    ? ('?observer=1' + (viewAs ? '&viewAs=' + encodeURIComponent(viewAs) : ''))
    : (playerId ? '?player=' + playerId : '');
  const wsUrl = _WS_BASE + '/sessions/' + id + '/ws' + query;
  let ws = null, closed = false, pollTimer = null, retryTimer = null, backoff = 1000;

  function startPoll() {
    if (pollTimer || closed) return;
    // Observers poll the full-information observer snapshot (fog bypassed); other
    // clients poll their own player view. Either keeps the game watchable while the
    // socket is down — important for observers behind a proxy that drops upgrades.
    const fetchSnapshot = observer
      ? () => window.api.sessionObserver(id, viewAs)
      : () => window.api.session(id, playerId);
    pollTimer = setInterval(async () => {
      try { onUpdate(await fetchSnapshot()); } catch {}
    }, 2000);
  }
  function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  function scheduleRetry() {
    if (closed || retryTimer) return;
    retryTimer = setTimeout(() => { retryTimer = null; connect(); }, backoff);
    backoff = Math.min(backoff * 2, 15000);
  }

  function connect() {
    if (closed) return;
    try { ws = new WebSocket(wsUrl); }
    catch { startPoll(); scheduleRetry(); return; }
    ws.onopen    = () => { backoff = 1000; stopPoll(); };
    ws.onmessage = (ev) => { try { onUpdate(JSON.parse(ev.data)); } catch {} };
    ws.onclose   = () => {
      ws = null;
      if (closed) return;
      startPoll();      // safety net while the socket is down
      scheduleRetry();
    };
    // onerror is followed by onclose, which handles fallback + retry.
    ws.onerror   = () => {};
  }

  connect();

  return {
    close() {
      closed = true;
      stopPoll();
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      if (ws) { try { ws.close(); } catch {} ws = null; }
    },
  };
};
