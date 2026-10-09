// api.js — HTTP client for the Battle Simulator API. Talks to whatever
// origin/path prefix loaded this page, so it works standalone (served at the
// root) or embedded under a launcher (e.g. served at /battle-simulator/ui/console/).
const _BASE_PATH = window.location.pathname.replace(/\/ui\/.*$/, '');
const _BASE = window.location.origin + _BASE_PATH;

// ── A board's static parts ──────────────────────────────────────────────────
// The server sends a board's unchanging fields (terrain shapes, …) by content key:
// `grid.statics` names each one's key, and the value itself is left out when we
// already hold it (see engine/gridStatics.js). These put the values back, so every
// consumer still gets whole boards — and the SAME array object for as long as the
// terrain doesn't change, which lets caches keyed on it (the minimap's) hold.
//
// REST: we name the keys we hold in an X-Grid-Have header; a few are kept, most
// recently used last (several sessions can be open at once).
const _statics = new Map();
const _STATICS_KEEP = 24;
function _keepStatic(key, value) {
  _statics.delete(key);
  _statics.set(key, value);
  while (_statics.size > _STATICS_KEEP) _statics.delete(_statics.keys().next().value);
}
/**
 * Fill a board's left-out static fields from `lookup(key)` (and remember the ones it
 * carries). False if a value was left out that `lookup` doesn't have — the caller
 * must then get the board again whole.
 */
function _fillStatics(grid, lookup) {
  if (!grid?.statics) return true;
  for (const [field, key] of Object.entries(grid.statics)) {
    if (grid[field] != null) { _keepStatic(key, grid[field]); continue; }
    const value = lookup(key);
    if (value == null) return false;
    grid[field] = value;
    _keepStatic(key, value);
  }
  return true;
}
// The places a response carries a board — the same two the server strips.
const _boardsOf = (body) => [body?.grid, body?.session?.grid].filter(Boolean);

async function _req(path, opts) {
  // What we hold right now, pinned: the response is filled from THESE values even if
  // another request's answer evicts some of them from the cache while this is in flight.
  const held = new Map(_statics);
  const r = await fetch(_BASE + path, {
    headers: { 'Content-Type': 'application/json', ...(held.size ? { 'X-Grid-Have': [...held.keys()].join(',') } : {}) },
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
  const body = await r.json();
  if (body && typeof body === 'object') {
    for (const grid of _boardsOf(body)) if (!_fillStatics(grid, (k) => held.get(k))) throw new Error('board arrived without its terrain');
  }
  return body;
}

// Game state carries root-relative image paths computed server-side (e.g.
// "/images/cs/units/ct"); re-add our own mount prefix so they resolve
// correctly whether running standalone (prefix '') or embedded (e.g.
// "/battle-simulator") under a launcher.
function imgSrc(path) {
  return path && path.startsWith('/') ? _BASE_PATH + path : path;
}

/**
 * Rebuild the grid a history frame describes, given the one before it — the mirror
 * of api-server.js's applyGridFrame. A new object every time: each frame becomes its
 * own board in the scrub bar, and aliasing two of them would show the same position
 * twice.
 */
function applyGridFrame(prev, frame) {
  if (!frame) return prev;
  if (frame.full) return frame.full;
  const cells = (prev?.cells ?? []).slice();
  for (const [i, cell] of frame.patch ?? []) cells[i] = cell;
  const next = { ...(prev ?? {}), ...(frame.rest ?? {}), cells };
  for (const k of frame.removed ?? []) delete next[k];
  return next;
}

/**
 * Page through GET /sessions/:id/history and rebuild every frame.
 *
 * A live game can thin its timeline (dropping every other frame) between our
 * requests, which re-indexes everything we have already asked for — the server says
 * so with `revision`, and we start over. Bounded, so a game thinning faster than we
 * can read cannot spin here for ever; it gives up with an empty timeline instead,
 * which callers already handle (the scrub bar simply has no history to seed from,
 * and fills up again from the live game as it plays on).
 */
async function _fetchHistory(id, attempts = 4) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const grids = [];
    let from = 0, revision = null, restart = false;
    for (;;) {
      const page = await _req('/sessions/' + id + '/history?from=' + from + '&limit=200');
      if (revision !== null && page.revision !== revision) { restart = true; break; }
      revision = page.revision;
      let cur = null;
      for (const frame of page.frames ?? []) { cur = applyGridFrame(cur, frame); grids.push(cur); }
      from += page.frames?.length ?? 0;
      if (!page.frames?.length || from >= page.total) break;
    }
    if (!restart) return grids;
  }
  return [];
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
  // The whole scrub-bar timeline, as an array of grids — the same thing callers
  // always got back, assembled here. The endpoint pages (it used to hand over
  // hundreds of megabytes in one response on a long civ1 game) and diff-encodes:
  // each page opens with a whole grid and continues in changed cells only.
  history:  (id)                    => _fetchHistory(id),
  // The EXACT resolved state at fraction `t` (0..1) of the last simultaneous round —
  // requested when a mid-turn scrub is PAUSED between the sampled playback frames, so
  // the board shows the server's true analytic state rather than a client-side lerp
  // (see api-server GET /sessions/:id/playback-frame). `view` selects the perspective
  // the same way subscribeSession does: { observer, viewAs } or { playerId }.
  playbackFrame: (id, t, { observer = false, viewAs = null, playerId = null } = {}) => {
    const persp = observer
      ? ('&observer=1' + (viewAs ? '&viewAs=' + encodeURIComponent(viewAs) : ''))
      : (playerId ? '&player=' + encodeURIComponent(playerId) : '');
    return _req('/sessions/' + id + '/playback-frame?t=' + encodeURIComponent(t) + persp);
  },
  log:      (id)                    => _req('/sessions/' + id + '/log'),
  create:   (body)                  => _req('/sessions', { method: 'POST', body: JSON.stringify(body) }),
  // The opening position a session WOULD start from, for the setup screen's
  // starting-units editor: the game's own roster (each unit with the board cell it
  // stands on), the board to arrange it on, the unit types that may be added, and
  // the config it was built from — which comes back with anything the game rolls
  // at random (a map seed) pinned, so the session is created on the same world.
  // Creates nothing; the edited roster is sent back as config.startingUnits.
  setupPreview: (game, body)        => _req('/games/' + encodeURIComponent(game) + '/setup', { method: 'POST', body: JSON.stringify(body) }),
  action:   (id, playerId, action)  => _req('/sessions/' + id + '/action', { method: 'POST', body: JSON.stringify({ playerId, action }) }),
  // Take moves back on an analysis board: `toPly` keeps that many, `plies`
  // (default 1) drops that many from the end. Unlike a fork this rewrites the
  // game — the moves are gone. Refused on anything but an analysis board.
  undo:     (id, { toPly, plies } = {}) =>
    _req('/sessions/' + id + '/undo', { method: 'POST', body: JSON.stringify({ toPly, plies }) }),
  // Generic surrender — ends the match immediately as a loss for `playerId`,
  // regardless of whose turn it is or which game this session is running.
  resign:   (id, playerId)          => _req('/sessions/' + id + '/resign', { method: 'POST', body: JSON.stringify({ playerId }) }),
  setMarker: (id, playerId, col, row, type) => _req('/sessions/' + id + '/marker', { method: 'POST', body: JSON.stringify({ playerId, col, row, type }) }),
  // Replace a player's queued future moves (games/planQueue.js). Not a turn action
  // and not gated on whose turn it is — a plan is made, and called off, while the
  // opponent is still thinking. `moves` is the whole plan, thin descriptors
  // ({unitId, from, to, payload, pathId}); the server validates it end to end and
  // refuses the lot rather than storing half of it.
  setPlan:  (id, playerId, moves)   => _req('/sessions/' + id + '/plan', { method: 'POST', body: JSON.stringify({ playerId, moves }) }),
  // Live playback controls: { paused?, aiDelay? }. Pauses/resumes the run loop and
  // sets the delay (ms) the engine waits between AI moves. Returns the applied values.
  control:  (id, body)              => _req('/sessions/' + id + '/control', { method: 'POST', body: JSON.stringify(body) }),
  // Change a game's settings while it is played — { config?, players?, units?, by? }
  // — and the units editor's board for it under settings being edited.
  reconfigure: (id, body)           => _req('/sessions/' + id + '/reconfigure', { method: 'POST', body: JSON.stringify(body) }),
  liveSetup:   (id, body)           => _req('/sessions/' + id + '/setup', { method: 'POST', body: JSON.stringify(body) }),
  // Read-only "what's good here" analysis for a live or replayed (ply) position.
  analyze:  (id, { playerId, agentId, ply }) =>
    _req('/sessions/' + id + '/analyze', { method: 'POST', body: JSON.stringify({ playerId, agentId, ply }) }),
  // What recorded human players did from the position at `ply` — for games that
  // declare a database (see the `database` field on GET /games). Replay or
  // analysis board only: the server refuses during a live match.
  //
  // `line` continues that position with moves that never happened (a fork being
  // explored), which needs a body — hence POST once there is one.
  database: (id, { ply, line } = {}) =>
    (line?.length
      ? _req('/sessions/' + id + '/database', { method: 'POST', body: JSON.stringify({ ply, line }) })
      : _req('/sessions/' + id + '/database' + (ply != null ? '?ply=' + encodeURIComponent(ply) : ''))),
  // A past position as the side to move there saw it — their board (fog and all)
  // and the moves they could have played — so a position being reviewed can be
  // picked up and moved by hand, not just clicked at through a panel. Replay or
  // analysis board only (the server refuses during a live match).
  positionAt: (id, ply) =>
    _req('/sessions/' + id + '/position' + (ply != null ? '?ply=' + encodeURIComponent(ply) : '')),
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

  // Last full snapshot handed to onUpdate — the base the server's deltas patch
  // against (see api-server.js _deltaFor). A message carrying `delta` is the
  // changed cells and the new log entries only; rebuild the whole snapshot here so
  // every consumer downstream keeps receiving exactly what it always did.
  let base = null;
  // The static board fields this socket has sent us, by field: { shapes: {key, value} }.
  // The server keeps the same record for the connection (see engine/gridStatics.js).
  let held = {};
  function rehydrate(msg) {
    // Static fields first, so a delta is rebuilt over a whole board. A key we don't
    // hold can't be filled in — same remedy as a delta with no base: resync.
    const grid = msg?.grid;
    if (grid?.statics) {
      for (const [field, key] of Object.entries(grid.statics)) {
        if (grid[field] != null) held[field] = { key, value: grid[field] };
        else if (held[field]?.key === key) grid[field] = held[field].value;
        else return null;
      }
      _fillStatics(grid, () => null); // remember them for REST requests too
    }
    if (!msg?.delta) { base = msg; return msg; }
    // A delta against a base we don't have (a REST poll landed in between, or this
    // is the first message after a reconnect) can't be applied — asking for a whole
    // snapshot re-syncs us, and the server rebases off whatever it sends next.
    if (!base || base.seq !== msg.delta.baseSeq) return null;
    // A NEW cells array, never a mutation of the old one: the App's animation
    // watcher compares the incoming board against the previous one cell by cell, so
    // patching in place would leave it diffing an array against itself.
    const cells = (base.grid?.cells ?? []).slice();
    for (const [i, cell] of msg.gridPatch ?? []) cells[i] = cell;
    const full = { ...msg, grid: { ...msg.grid, cells }, log: (base.log ?? []).concat(msg.logTail ?? []) };
    delete full.delta; delete full.gridPatch; delete full.logTail;
    base = full;
    return full;
  }

  function startPoll() {
    if (pollTimer || closed) return;
    // Observers poll the full-information observer snapshot (fog bypassed); other
    // clients poll their own player view. Either keeps the game watchable while the
    // socket is down — important for observers behind a proxy that drops upgrades.
    const fetchSnapshot = observer
      ? () => window.api.sessionObserver(id, viewAs)
      : () => window.api.session(id, playerId);
    pollTimer = setInterval(async () => {
      // REST snapshots are always whole, so this doubles as re-establishing the
      // delta base for whenever the socket comes back.
      try { onUpdate(rehydrate(await fetchSnapshot())); } catch {}
    }, 2000);
  }
  function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  // Recover from a delta we have no base for by asking the SERVER to forget its
  // base and re-send a whole snapshot. Refetching over REST instead would not fix
  // it: the server rebases on every send, so our REST snapshot and its base would
  // still be different positions and the very next delta would fail the same way.
  function resync() {
    if (closed || !ws || ws.readyState !== 1) return; // socket down: the poll covers us
    // The server also forgets what this socket holds, and sends every static field
    // again. `held` is kept: messages already on their way were stripped against it.
    try { ws.send(JSON.stringify({ resync: true })); } catch {}
  }

  function scheduleRetry() {
    if (closed || retryTimer) return;
    retryTimer = setTimeout(() => { retryTimer = null; connect(); }, backoff);
    backoff = Math.min(backoff * 2, 15000);
  }

  function connect() {
    if (closed) return;
    try { ws = new WebSocket(wsUrl); }
    catch { startPoll(); scheduleRetry(); return; }
    // A new socket starts with nothing sent, on the server's side and so on ours.
    ws.onopen    = () => { backoff = 1000; held = {}; stopPoll(); };
    ws.onmessage = (ev) => {
      try {
        const full = rehydrate(JSON.parse(ev.data));
        // rehydrate() returns null when it was handed a delta it has no base for.
        // Ask for a whole snapshot rather than paint a patch onto the wrong board;
        // the socket stays up throughout, so nothing else is interrupted.
        if (full) onUpdate(full);
        else resync();
      } catch {}
    };
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
