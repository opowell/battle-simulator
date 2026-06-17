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

// ── hop animation ─────────────────────────────────────────────
// A single server update can bundle several turns (e.g. a human move plus the
// computer's immediate reply). Each turn gets queued and animated in full
// before the next one starts, so a later turn never renders ahead of an
// earlier turn's still-playing animation.
const hopAnim = ref(null); // { unitId, steps: [{x,y},...], step }
const hopQueue = ref([]); // [{ unitId, steps: [{x,y},...] }, ...] — not yet started
let hopTimer = null;
let seenLogLength = 0;

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

function playNextHop() {
  if (hopAnim.value || hopQueue.value.length === 0) return;
  const { unitId, steps } = hopQueue.value[0];
  hopQueue.value = hopQueue.value.slice(1);
  hopAnim.value = { unitId, steps, step: 0 };
  hopTimer = setTimeout(advanceHop, 220);
}

function advanceHop() {
  if (!hopAnim.value) return;
  const next = hopAnim.value.step + 1;
  if (next >= hopAnim.value.steps.length) { hopAnim.value = null; playNextHop(); return; }
  hopAnim.value = { ...hopAnim.value, step: next };
  hopTimer = setTimeout(advanceHop, 220);
}

watch(liveState, (newState, oldState) => {
  const log = newState?.log ?? [];
  if (!newState?.grid?.cells || !oldState?.grid?.cells) { seenLogLength = log.length; return; }

  const moved = new Map(); // unitId -> { from, to }
  for (const newCell of newState.grid.cells) {
    if (!newCell.unitId) continue;
    const oldCell = oldState.grid.cells.find(c => c.unitId === newCell.unitId);
    if (!oldCell || (oldCell.x === newCell.x && oldCell.y === newCell.y)) continue;
    moved.set(newCell.unitId, { from: { x: oldCell.x, y: oldCell.y }, to: { x: newCell.x, y: newCell.y } });
  }
  if (moved.size === 0 || (activeField.value?.ui?.moveAnimation ?? 'hop') === 'none') { seenLogLength = log.length; return; }

  // Order queued hops by the turn log so bundled turns play back in the order they happened.
  const order = [];
  for (const entry of log.slice(seenLogLength)) {
    for (const { action } of entry.playerActions ?? []) {
      if (action?.unitId && moved.has(action.unitId) && !order.includes(action.unitId)) order.push(action.unitId);
    }
  }
  for (const unitId of moved.keys()) if (!order.includes(unitId)) order.push(unitId);

  const diagonal = activeField.value?.ui?.allowDiagonalHopsWhileMoving ?? false;
  const queued = order.map(unitId => {
    const { from, to } = moved.get(unitId);
    return { unitId, steps: buildHopPath(from, to, diagonal) };
  });
  hopQueue.value = [...hopQueue.value, ...queued];
  seenLogLength = log.length;
  playNextHop();
});

// ── field for the battlefield ────────────────────────────────
const activeField = computed(() => {
  const s = liveState.value;
  if (!s) return null;
  const g = s.grid;
  if (!g) return null;

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

  let units = g.cells
    .filter(c => c.glyph)
    .map(c => ({
      id:        c.unitId ?? `u_${c.x}_${c.y}`,
      team:      ownerTeam[c.owner] ?? (teams[0]?.id ?? 'p1'),
      type:      c.glyph.toLowerCase(),
      name:      c.unitName ?? c.glyph,
      hp:        c.maxHp ?? c.hp ?? 1,
      currentHp: c.hp,
      path:      [[c.x + 0.5, c.y + 0.5]],
      facing:    c.facing,
      deathTurn: null,
      mp:            c.mp,
      maxMp:         c.maxMp,
      stats:         c.stats,
      abilities:     c.abilities,
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
    }));

  // Units already queued to hop later must stay put at their pre-move square — otherwise
  // they'd render at their (already-applied) final grid position while waiting their turn.
  units = units.map(u => {
    if (hopAnim.value?.unitId === u.id) {
      const { x, y } = hopAnim.value.steps[hopAnim.value.step];
      return { ...u, path: [[x + 0.5, y + 0.5]] };
    }
    const queued = hopQueue.value.find(q => q.unitId === u.id);
    if (queued) {
      const { x, y } = queued.steps[0];
      return { ...u, path: [[x + 0.5, y + 0.5]] };
    }
    return u;
  });

  const tiles = g.cells
    .filter(c => c.color)
    .map(c => ({ x: c.x, y: c.y, color: c.color }));

  return {
    game:  s.game,
    label: `${s.game} · Turn ${s.turn ?? 0}`,
    world: { w: g.width, h: g.height },
    turns: 1,
    grid:  'square',
    teams,
    walls: [],
    zones: [],
    tiles,
    units,
    ui:       apiGame?.ui ?? {},
    xLabels:  g.xLabels ?? null,
    yLabels:  g.yLabels ?? null,
  };
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

// ── polling ──────────────────────────────────────────────────
let _poll = null;

function stopPoll() { clearInterval(_poll); _poll = null; }

function maybeStartPoll(s) {
  stopPoll();
  if (!s || s.status !== 'active') return;
  const pendingHuman = s.pendingPlayer && s.humanPlayers?.includes(s.pendingPlayer);
  if (pendingHuman) return; // human's turn — no poll needed
  _poll = setInterval(async () => {
    try {
      const fresh = await api.session(s.id);
      liveState.value = fresh;
      if (fresh.status !== 'active') { stopPoll(); return; }
      if (fresh.pendingPlayer && fresh.humanPlayers?.includes(fresh.pendingPlayer)) stopPoll();
    } catch {}
  }, 2000);
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
async function enterSession(id, { push = true } = {}) {
  try {
    const state = await api.session(id);
    liveState.value = state;
    view.value = 'battle';
    if (push) router.push('/session/' + id);
    maybeStartPoll(state);
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
    const created = await api.create({ game: cfg.game, players, config: { maxTurns: cfg.maxTurns ?? 500, fog: cfg.fog ?? false, scenario: cfg.scenario } });
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
                   :theme="theme"
                   :fog="liveState?.fog ?? false"
                   :games-count="apiGames.length"
                   :server-err="serverErr"
                   @exit="exitBattle"
                   @open-settings="openSettings"
                   @submit-action="submitAction"/>
      <div v-else
           style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--dim)">
        Loading…
      </div>
    </div>
  </div>
</template>
