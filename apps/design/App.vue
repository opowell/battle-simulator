<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import Lobby       from './Lobby.vue';
import Battlefield from './Battlefield.vue';

const router = useRouter();
const route  = useRoute();

const THEMES = [
  { id: 'military', label: 'Military', accent: '#42c6e6', teams: ['#4f9dff', '#ff5f56'] },
  { id: 'minimal',  label: 'Minimal',  accent: '#2f6bff', teams: ['#3b7bff', '#ff5a52'] },
  { id: 'retro',    label: 'Retro',    accent: '#39ff88', teams: ['#46c6ff', '#ff5f6e'] },
];

const TEAM_VARS = ['var(--teamA)', 'var(--teamB)', 'var(--teamC)', 'var(--teamD)'];
const TEAM_RAWS = ['#4f9dff', '#ff5f56', '#46d39a', '#f2b441'];

const theme       = ref(localStorage.getItem('bs_theme') ?? 'military');
const view        = ref('lobby');
const prevView    = ref('lobby');
const liveState   = ref(null);   // raw API session JSON
const sessions    = ref([]);     // lobby list from GET /sessions
const apiGames    = ref([]);     // from GET /games
const serverErr   = ref('');

// Cached player info for sessions we've created (id → [{id, name, agent}])
const sessionMeta = ref({});

// ── turn animation queue ──────────────────────────────────────
// A single server update can bundle several turns (e.g. a human move plus the
// computer's immediate reply). Each turn becomes one or more "beats" — a move
// hop and/or a burst of combat flashes — queued and played in log order, so a
// later turn never renders (or flashes) ahead of an earlier turn still playing.
// Beats: { kind:'hop', unitId, steps:[{x,y}] } | { kind:'fx', flashes:[{unitId,fx}] }
const HOP_STEP_MS = 220;
const FX_BEAT_MS  = 400; // gap before the next beat; the numeral keeps rising into it
const hopAnim  = ref(null);  // currently-playing hop { unitId, steps, step } (for pinning)
const animQueue = ref([]);   // pending beats, not yet started
let animTimer = null;
let seenLogLength = 0;

// ── combat flashes ────────────────────────────────────────────
// Transient hit feedback keyed by unit id: a white flash on the acting unit, a
// red blink + floating "-N" on a struck unit, a green glow + "+N" on a healed
// one — mirroring the original's damage/heal numerals and hit-blink. Each flash
// carries the board square it fires on (captured when the beat is built) so a
// killing blow still flashes at the victim's last position after it leaves the
// board. Gated per-game by ui.combatFx (see each game's `ui`).
const unitFx = ref({}); // unitId -> { type, amount?, died?, key, x, y }
let fxKey = 0;
const fxTimers = new Map();
// Action types (by unit) that should flash the actor white — i.e. "took an
// action" in the FFTA sense (used a skill), not merely repositioned.
const FX_ACTION_TYPES = new Set(['ability', 'attack', 'cast', 'skill']);

function triggerFx(unitId, fx) {
  if (!unitId || fx.x == null) return;
  fxKey += 1;
  unitFx.value = { ...unitFx.value, [unitId]: { ...fx, key: fxKey } };
  clearTimeout(fxTimers.get(unitId));
  fxTimers.set(unitId, setTimeout(() => {
    const next = { ...unitFx.value };
    delete next[unitId];
    unitFx.value = next;
    fxTimers.delete(unitId);
  }, fx.type === 'action' ? 420 : 780));
}

function buildHopPath(from, to, diagonal = false) {
  const path = [{ x: from.x, y: from.y }];
  let { x, y } = from;
  if (diagonal) {
    while (x !== to.x || y !== to.y) {
      if (x !== to.x) x += to.x > x ? 1 : -1;
      if (y !== to.y) y += to.y > y ? 1 : -1;
      path.push({ x, y });
    }
  } else {
    while (x !== to.x) { x += to.x > x ? 1 : -1; path.push({ x, y }); }
    while (y !== to.y) { y += to.y > y ? 1 : -1; path.push({ x, y }); }
  }
  return path;
}

function playNext() {
  if (hopAnim.value || animQueue.value.length === 0) return;
  const beat = animQueue.value[0];
  animQueue.value = animQueue.value.slice(1);
  if (beat.kind === 'fx') {
    for (const f of beat.flashes) triggerFx(f.unitId, f.fx);
    animTimer = setTimeout(playNext, FX_BEAT_MS);
    return;
  }
  hopAnim.value = { unitId: beat.unitId, steps: beat.steps, step: 0 };
  animTimer = setTimeout(advanceHop, HOP_STEP_MS);
}

function advanceHop() {
  if (!hopAnim.value) return;
  const next = hopAnim.value.step + 1;
  if (next >= hopAnim.value.steps.length) { hopAnim.value = null; playNext(); return; }
  hopAnim.value = { ...hopAnim.value, step: next };
  animTimer = setTimeout(advanceHop, HOP_STEP_MS);
}

watch(liveState, (newState, oldState) => {
  const log = newState?.log ?? [];
  if (!newState?.grid?.cells || !oldState?.grid?.cells) { seenLogLength = log.length; return; }

  const newEntries = log.slice(seenLogLength);
  seenLogLength = log.length;

  const ui = activeField.value?.ui ?? {};
  const hopsOn = (ui.moveAnimation ?? 'hop') !== 'none';
  const fxOn   = !!ui.combatFx;
  const diagonal = ui.allowDiagonalHopsWhileMoving ?? false;
  // Continuous-location maps (doom/cs/combatmission — see games/coord.js) have no grid
  // to hop across: a unit slides in a straight line to the exact point clicked. Their
  // per-unit positions travel in newState.grid.units (real points), not by cell index.
  const continuous = newState.grid.locationType === 'continuous';
  const slide = continuous;

  // Net position changes A→B (a unit moved twice in a bundle collapses to one hop —
  // matching the pre-sequencing behaviour). Each is claimed by the beat it belongs to.
  const moved = new Map(); // unitId -> { from, to }
  if (continuous) {
    const oldUnits = new Map((oldState.grid.units ?? []).map(u => [u.id, u]));
    for (const nu of newState.grid.units ?? []) {
      const ou = oldUnits.get(nu.id);
      if (!ou) continue;
      const from = { x: Number(ou.x), y: Number(ou.y) }, to = { x: Number(nu.x), y: Number(nu.y) };
      if (from.x === to.x && from.y === to.y) continue;
      moved.set(nu.id, { from, to });
    }
  } else {
    for (const newCell of newState.grid.cells) {
      if (!newCell.unitId) continue;
      const oldCell = oldState.grid.cells.find(c => c.unitId === newCell.unitId);
      if (!oldCell || (oldCell.x === newCell.x && oldCell.y === newCell.y)) continue;
      moved.set(newCell.unitId, { from: { x: oldCell.x, y: oldCell.y }, to: { x: newCell.x, y: newCell.y } });
    }
  }

  // Board point of a unit for a flash: its new point if still on the board, else its
  // last-seen point (a slain unit is gone from newState). Discrete units centre at
  // cell + 0.5 (see buildField); continuous positions are already exact points.
  const fxSquare = (id) => {
    if (continuous) {
      const u = (newState.grid.units ?? []).find(u => u.id === id)
             ?? (oldState.grid.units ?? []).find(u => u.id === id);
      return u ? { x: Number(u.x), y: Number(u.y) } : {};
    }
    const c = newState.grid.cells.find(c => c.unitId === id)
           ?? oldState.grid.cells.find(c => c.unitId === id);
    return c ? { x: c.x + 0.5, y: c.y + 0.5 } : {};
  };

  // Build beats in log order: the mover's hop, then this turn's flashes, then any
  // knockback slide of a struck unit — so a bundled reply plays step by step.
  const beats = [];
  const claimed = new Set();
  const pushHop = (unitId) => {
    const { from, to } = moved.get(unitId);
    beats.push({ kind: 'hop', unitId, steps: slide ? [from, to] : buildHopPath(from, to, diagonal) });
    claimed.add(unitId);
  };
  for (const entry of newEntries) {
    const action = entry.playerActions?.[0]?.action;
    if (hopsOn && action?.unitId && moved.has(action.unitId) && !claimed.has(action.unitId)) pushHop(action.unitId);

    if (fxOn) {
      const flashes = [];
      if (action?.unitId && FX_ACTION_TYPES.has(action.type))
        flashes.push({ unitId: action.unitId, fx: { type: 'action', ...fxSquare(action.unitId) } });
      for (const ev of entry.events ?? []) {
        if (ev.type === 'damage')    flashes.push({ unitId: ev.targetId, fx: { type: 'damage', amount: ev.amount, died: ev.died, ...fxSquare(ev.targetId) } });
        else if (ev.type === 'heal') flashes.push({ unitId: ev.targetId, fx: { type: 'heal',   amount: ev.amount, ...fxSquare(ev.targetId) } });
      }
      if (flashes.length) beats.push({ kind: 'fx', flashes });
      // Knockback: a struck unit that also moved slides after the hit lands.
      if (hopsOn) for (const ev of entry.events ?? [])
        if (ev.type === 'damage' && moved.has(ev.targetId) && !claimed.has(ev.targetId)) pushHop(ev.targetId);
    }
  }
  // Any remaining moved units (e.g. fx off, or moves the log didn't attribute) hop last.
  if (hopsOn) for (const unitId of moved.keys()) if (!claimed.has(unitId)) pushHop(unitId);

  if (beats.length) {
    animQueue.value = [...animQueue.value, ...beats];
    playNext();
  }
});

// ── field for the battlefield ────────────────────────────────
function buildField(g, s) {
  if (!g || !s) return null;

  const apiGame = apiGames.value.find(x => x.name === s.game);
  const defs    = apiGame?.defaultPlayers ?? [];
  const cached  = sessionMeta.value[s.id] ?? [];

  const teams = defs.map((d, i) => {
    const c = cached.find(p => p.id === d.id);
    return {
      id:    d.id,
      name:  c?.name ?? d.name,
      color: TEAM_VARS[i] ?? 'var(--teamA)',
      raw:   TEAM_RAWS[i] ?? '#8a96a1',
    };
  });

  // Fallback: if defs is empty, infer teams from cells
  if (!teams.length) {
    const owners = [...new Set(g.cells.filter(c => c.owner).map(c => c.owner))].sort();
    owners.forEach((o, i) => teams.push({
      id: 'p' + o, name: 'Player ' + o,
      color: TEAM_VARS[i] ?? 'var(--teamA)',
      raw:   TEAM_RAWS[i] ?? '#8a96a1',
    }));
  }

  const ownerTeam = {};
  teams.forEach((t, i) => { ownerTeam[i + 1] = t.id; });

  const locationType = g.locationType ?? 'discrete';

  // Discrete games locate a unit by an integer cell, rendered at the cell centre (hence
  // +0.5). Continuous games (doom/cs/combatmission — see games/coord.js) carry real
  // positions in a parallel `g.units` channel as decimal strings; a position is already
  // the exact point, so it renders directly with no cell-centre offset.
  const unitSource = locationType === 'continuous'
    ? (g.units ?? []).map(u => ({ src: u, x: Number(u.x), y: Number(u.y), id: u.id }))
    : g.cells.filter(c => c.glyph).map(c => ({ src: c, x: c.x + 0.5, y: c.y + 0.5, id: c.unitId ?? `u_${c.x}_${c.y}` }));

  const units = unitSource
    .map(({ src: c, x, y, id }) => ({
      id,
      team:      ownerTeam[c.owner] ?? (teams[0]?.id ?? 'p1'),
      type:      c.glyph.toLowerCase(),
      name:      c.unitName ?? c.glyph,
      hp:        c.maxHp ?? c.hp ?? 1,
      currentHp: c.hp,
      path:      [[x, y]],
      facing:    c.facing,
      deathTurn: null,
      // Per-unit field-of-vision overrides (see apps/design/vision.js) — a game's toGrid
      // may set these; absent, the unit falls back to the game/default FoV cone + range.
      fov:           c.fov,
      visionRange:   c.visionRange,
      mp:            c.mp,
      maxMp:         c.maxMp,
      stats:         c.stats,
      abilities:     c.abilities,
      equipment:     c.equipment,
      statusEffects: c.statusEffects,
      moved:         c.moved,
      acted:         c.acted,
      isActive:      c.isActive,
      imagePath:     c.imagePath,
      portraitPath:  c.portraitPath,
      mainImagePath: c.mainImagePath,
      description:   c.description,
      job:           c.job,
      moveRange:     c.moveRange,
      // Fraction of incoming damage this unit shrugs off (see CsGame.js's toGrid) —
      // lets the aiming overlay preview show an estimated "-NN" without the design
      // UI knowing any particular game's armor model.
      damageReduction: c.damageReduction,
    }));

  const tiles = g.cells
    .filter(c => c.color)
    .map(c => ({ x: c.x, y: c.y, color: c.color, bgImage: c.bgImage ?? null, height: c.height ?? 0, terrain: c.terrain ?? null }));

  return {
    game:  s.game,
    turn:  s.turn ?? null,
    label: `${s.game} · Turn ${s.turn ?? 0}`,
    world: { w: g.width, h: g.height },
    turns: 1,
    grid:  'square',
    // 'discrete' (integer tile grid) vs 'continuous' (real click-to-point positions,
    // see games/coord.js). Gates the straight-line slide animation, the move-radius
    // circle, and exact-point move submission — replaces the old shapes?.length proxy.
    locationType,
    teams,
    walls: [],
    zones: [],
    tiles,
    // Whether this game's cells carry per-square terrain data — gates click-to-select
    // on empty squares and the terrain-info panel (see Battlefield.vue). Games with
    // uniform terrain (chess, etc.) never populate cell.terrain, so this stays false.
    hasTerrain: tiles.some(t => t.terrain),
    // Non-grid terrain: an array of layered SVG shapes (rectangles + ovals) the game's
    // toGrid emits instead of colouring tiles (see SchematicLayer.vue). Empty for
    // ordinary grid games.
    shapes: g.shapes ?? [],
    // Line-of-sight occluders (opaque tile keys) for the fog renderer — the same wall
    // grid the engine's LOS blocks on, so the drawn vision veil stops at walls instead
    // of bleeding through them (see apps/design/vision.js). Absent ⇒ no occlusion.
    los: g.los ?? null,
    units,
    // A game's toGrid may return a per-state `ui` override (e.g. hideGrid for shape
    // maps); it layers on top of the game's static ui.
    ui:       { ...(apiGame?.ui ?? {}), ...(g.ui ?? {}) },
    xLabels:  g.xLabels ?? null,
    yLabels:  g.yLabels ?? null,
    // Authoritative fog visibility from the server (computed on the full board). When
    // present the UI must use this rather than re-deriving fog from the filtered board.
    fogVisible: g.visible ? new Set(g.visible.map(([x, y]) => `${x},${y}`)) : null,
    // Server-persisted per-square fog markers (seeded from the last real sighting,
    // freely re-cyclable by the player), so a reload doesn't forget them.
    fogMarkers: g.markers ?? [],
  };
}

const historyFields = ref([]);
// Full (unfiltered) per-ply board + move log for a finished fog game, used by the
// "Reveal all" review toggle. Only fetched once the game is over, so they never leak
// live positions or the opponent's moves mid-game.
const revealFields = ref([]);
const revealLog    = ref([]);

const activeField = computed(() => {
  const s = liveState.value;
  if (!s) return null;
  const field = buildField(s.grid, s);
  if (!field) return null;

  // Units already queued to hop later must stay put at their pre-move square — otherwise
  // they'd render at their (already-applied) final grid position while waiting their turn.
  // Discrete hop steps are cell indices (centre at +0.5); continuous steps are already
  // exact board points (see the move watcher above), so no offset.
  const off = field.locationType === 'continuous' ? 0 : 0.5;
  field.units = field.units.map(u => {
    if (hopAnim.value?.unitId === u.id) {
      const { x, y } = hopAnim.value.steps[hopAnim.value.step];
      return { ...u, path: [[x + off, y + off]] };
    }
    const queued = animQueue.value.find(q => q.kind === 'hop' && q.unitId === u.id);
    if (queued) {
      const { x, y } = queued.steps[0];
      return { ...u, path: [[x + off, y + off]] };
    }
    return u;
  });

  return field;
});

// ── theme ────────────────────────────────────────────────────
watch(theme, id => {
  document.documentElement.dataset.theme = id;
  const th = THEMES.find(x => x.id === id);
  if (!th) return;
  document.documentElement.style.setProperty('--accent', th.accent);
  document.documentElement.style.setProperty('--teamA',  th.teams[0]);
  document.documentElement.style.setProperty('--teamB',  th.teams[1]);
  localStorage.setItem('bs_theme', id);
}, { immediate: true });

function openSettings() {
  prevView.value = view.value;
  view.value = 'settings';
}
function closeSettings() {
  view.value = prevView.value;
}

// ── live updates ─────────────────────────────────────────────
// A WebSocket subscription pushes state changes instead of the old 2s poll
// (api.subscribeSession falls back to polling internally if the socket drops).
// _sub holds the subscription handle; stopPoll() tears it down.
let _sub = null;

function stopPoll() { if (_sub) { _sub.close(); _sub = null; } }

function fogHumanId(s) {
  return s?.fog ? (s.humanPlayers?.[0] ?? null) : null;
}

function maybeStartPoll(s) {
  stopPoll();
  if (!s || s.status !== 'active') return;
  const pendingHuman = s.pendingPlayer && s.humanPlayers?.includes(s.pendingPlayer);
  if (pendingHuman) return; // human's turn — nothing to wait on
  const humanId = fogHumanId(s);
  _sub = api.subscribeSession(s.id, humanId, (fresh) => {
    liveState.value = fresh;
    if (fresh.status !== 'active') { stopPoll(); return; }
    if (fresh.pendingPlayer && fresh.humanPlayers?.includes(fresh.pendingPlayer)) stopPoll();
  });
}

// ── data loading ─────────────────────────────────────────────
async function refresh() {
  try {
    const [s, g] = await Promise.all([api.sessions(), api.games()]);
    sessions.value  = s;
    apiGames.value  = g;
    serverErr.value = '';
  } catch (e) {
    serverErr.value = e.message;
  }
}

// Sync view when navigating via browser back/forward
watch(() => route.params.id, async (id, prevId) => {
  if (id && liveState.value?.id !== id) {
    await enterSession(id, { push: false });
  } else if (!id && prevId) {
    stopPoll();
    liveState.value = null;
    view.value = 'lobby';
  }
});

onMounted(async () => {
  await refresh();
  if (route.params.id) await enterSession(route.params.id, { push: false });
});

onUnmounted(stopPoll);

// ── session flow ─────────────────────────────────────────────
async function loadHistory(id, state) {
  try {
    const grids = await api.history(id);
    if (liveState.value?.id !== id) return;
    historyFields.value = grids.map(g => buildField(g, state)).filter(Boolean);
  } catch {
    historyFields.value = [];
  }
}

// The /history endpoint returns full unfiltered grids; in fog mode we only fetch it once
// the game is done (revealing earlier would expose hidden pieces mid-game).
async function loadReveal(id, state) {
  try {
    const [grids, log] = await Promise.all([api.history(id), api.log(id)]);
    if (liveState.value?.id !== id) return;
    revealFields.value = grids.map(g => buildField(g, state)).filter(Boolean);
    revealLog.value    = Array.isArray(log) ? log : [];
  } catch {
    revealFields.value = [];
    revealLog.value    = [];
  }
}

watch(() => (liveState.value?.fog && liveState.value?.status !== 'active') ? liveState.value.id : null,
  (id) => {
    revealFields.value = [];
    revealLog.value    = [];
    if (id) loadReveal(id, liveState.value);
  });

async function enterSession(id, { push = true } = {}) {
  historyFields.value = [];
  try {
    let state = await api.session(id);
    const humanId = fogHumanId(state);
    if (humanId) state = await api.session(id, humanId);
    liveState.value = state;
    view.value = 'battle';
    if (push) router.push('/session/' + id);
    maybeStartPoll(state);
    if (!humanId) loadHistory(id, state); // skip history in fog mode (would reveal all pieces)
  } catch (e) {
    if (/session not found/i.test(e.message)) {
      router.replace('/');
    } else {
      serverErr.value = e.message;
    }
  }
}

async function openSession(s) {
  await enterSession(s.id);
}

async function createSession(cfg) {
  const apiGame = apiGames.value.find(g => g.name === cfg.game);
  const defs    = apiGame?.defaultPlayers ?? [];
  const players = cfg.players.map((p, i) => ({
    id:    defs[i]?.id ?? ('p' + (i + 1)),
    name:  p.name || defs[i]?.name || ('Player ' + (i + 1)),
    agent: p.agent === 'human' ? 'human' : (p.agent ?? 'random'),
  }));
  try {
    const opts    = cfg.gameOpts ?? {};
    const created = await api.create({ game: cfg.game, players, config: { maxTurns: cfg.maxTurns ?? 500, fog: opts.fogOfWar ?? false, ...opts, scenario: cfg.scenario } });
    sessionMeta.value = { ...sessionMeta.value, [created.id]: players };
    await enterSession(created.id);
    refresh();
  } catch (e) { serverErr.value = e.message; }
}

async function submitAction({ playerId, action }) {
  if (!liveState.value) return;
  try {
    const state = await api.action(liveState.value.id, playerId, action);
    liveState.value = state;
    maybeStartPoll(state);
  } catch (e) { serverErr.value = e.message; }
}

// Persist a manual fog-square guess server-side so it survives a reload and (via the
// server's WebSocket broadcast) shows up immediately without waiting on a turn to pass.
async function setMarker({ playerId, col, row, type }) {
  if (!liveState.value) return;
  try {
    liveState.value = await api.setMarker(liveState.value.id, playerId, col, row, type);
  } catch (e) { serverErr.value = e.message; }
}

async function deleteSession(id) {
  try { await api.del(id); await refresh(); } catch {}
}

function exitBattle() {
  stopPoll();
  liveState.value = null;
  view.value = 'lobby';
  router.push('/');
  refresh();
}
</script>

<template>
  <div style="height:100vh;display:flex;flex-direction:column">
    <div class="topbar" v-if="view !== 'battle'">
      <div class="brand">
        <span class="mark"><BsIcon name="crosshair" :size="15"/></span>
        BATTLE&nbsp;SIMULATOR
      </div>
      <div class="statuschip"
           :style="serverErr ? {borderColor:'var(--danger)',color:'var(--danger)'} : {}">
        <span class="pulse"
              :style="serverErr ? {background:'var(--danger)',animationPlayState:'paused'} : {}"/>
        {{ serverErr ? 'offline' : 'api · localhost:3000' }}
      </div>
      <div style="flex:1"/>
      <span class="mono" style="font-size:11px;color:var(--faint)">
        {{apiGames.length}} games
      </span>
      <button class="iconbtn" @click="openSettings" title="Settings" style="color:var(--dim)">
        <BsIcon name="sliders" :size="15" color="var(--dim)"/>
      </button>
    </div>

    <div style="flex:1;min-height:0">
      <div v-if="view === 'settings'"
           style="height:100%;overflow-y:auto;padding:32px 24px;display:flex;align-items:flex-start;justify-content:center">
        <div style="width:100%;max-width:480px;display:flex;flex-direction:column;gap:20px">
          <div style="display:flex;align-items:center;gap:14px">
            <button class="btn btn-ghost btn-sm" @click="closeSettings">
              <BsIcon name="back" :size="13" color="var(--dim)"/> Back
            </button>
            <span class="up" style="font-size:12px;font-weight:700;letter-spacing:.12em">Settings</span>
          </div>
          <div class="panel">
            <div class="panel-h"><span class="panel-t">Theme</span></div>
            <div class="panel-b" style="display:flex;flex-direction:column;gap:8px">
              <button v-for="th in THEMES" :key="th.id"
                      :class="['scenrow', theme === th.id && 'sel']"
                      style="text-align:left"
                      @click="theme = th.id">
                <div class="scenmark" :style="theme === th.id ? 'border-color:var(--accent)' : ''">
                  <div :style="{width:'14px',height:'14px',borderRadius:'50%',background:th.accent}"/>
                </div>
                <div>
                  <div style="font-size:14px;font-weight:600">{{th.label}}</div>
                  <div style="font-size:11px;color:var(--dim)" class="mono">{{th.id}}</div>
                </div>
                <div style="display:flex;gap:5px;align-items:center">
                  <div v-for="c in th.teams" :key="c"
                       :style="{width:'16px',height:'16px',borderRadius:'50%',background:c}"/>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>

      <Lobby v-else-if="view === 'lobby'"
             :sessions="sessions"
             :api-games="apiGames"
             :server-err="serverErr"
             @open-session="openSession"
             @create="createSession"
             @delete-session="deleteSession"
             @refresh="refresh"/>
      <Battlefield v-else-if="activeField"
                   :live-state="liveState"
                   :field="activeField"
                   :unit-fx="unitFx"
                   :history-fields="historyFields"
                   :reveal-fields="revealFields"
                   :reveal-log="revealLog"
                   :theme="theme"
                   :fog="liveState?.fog ?? false"
                   :games-count="apiGames.length"
                   :server-err="serverErr"
                   @exit="exitBattle"
                   @open-settings="openSettings"
                   @submit-action="submitAction"
                   @set-marker="setMarker"/>
      <div v-else
           style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--dim)">
        Loading…
      </div>
    </div>
  </div>
</template>
