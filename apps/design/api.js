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
  if (!r.ok) throw new Error(await r.text());
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
  history:  (id)                    => _req('/sessions/' + id + '/history'),
  log:      (id)                    => _req('/sessions/' + id + '/log'),
  create:   (body)                  => _req('/sessions', { method: 'POST', body: JSON.stringify(body) }),
  action:   (id, playerId, action)  => _req('/sessions/' + id + '/action', { method: 'POST', body: JSON.stringify({ playerId, action }) }),
  setMarker: (id, playerId, col, row, type) => _req('/sessions/' + id + '/marker', { method: 'POST', body: JSON.stringify({ playerId, col, row, type }) }),
  del:      (id)                    => _req('/sessions/' + id, { method: 'DELETE' }),
};

// Subscribe to live session updates over WebSocket, replacing the old 2s poll.
// onUpdate(data) fires with the same shape api.session() returns, once on connect
// and again on every server-side state change. If the socket can't open or drops,
// it falls back to a 2s REST poll and keeps retrying the socket with backoff, so
// the UI never goes stale behind a proxy that strips upgrade headers. Returns a
// handle with close(); the caller owns its lifecycle.
const _WS_BASE = _BASE.replace(/^http/, 'ws'); // http→ws, https→wss

window.api.subscribeSession = function subscribeSession(id, playerId, onUpdate) {
  const wsUrl = _WS_BASE + '/sessions/' + id + '/ws' + (playerId ? '?player=' + playerId : '');
  let ws = null, closed = false, pollTimer = null, retryTimer = null, backoff = 1000;

  function startPoll() {
    if (pollTimer || closed) return;
    pollTimer = setInterval(async () => {
      try { onUpdate(await window.api.session(id, playerId)); } catch {}
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
