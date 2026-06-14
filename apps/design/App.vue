<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import Lobby       from './Lobby.vue';
import Battlefield from './Battlefield.vue';

const THEMES = [
  { id: 'military', label: 'Military', accent: '#42c6e6', teams: ['#4f9dff', '#ff5f56'] },
  { id: 'minimal',  label: 'Minimal',  accent: '#2f6bff', teams: ['#3b7bff', '#ff5a52'] },
  { id: 'retro',    label: 'Retro',    accent: '#39ff88', teams: ['#46c6ff', '#ff5f6e'] },
];

const TEAM_VARS = ['var(--teamA)', 'var(--teamB)', 'var(--teamC)', 'var(--teamD)'];
const TEAM_RAWS = ['#4f9dff', '#ff5f56', '#46d39a', '#f2b441'];

const theme       = ref('military');
const view        = ref('lobby');
const liveState   = ref(null);   // raw API session JSON
const sessions    = ref([]);     // lobby list from GET /sessions
const apiGames    = ref([]);     // from GET /games
const serverErr   = ref('');

// Cached player info for sessions we've created (id → [{id, name, agent}])
const sessionMeta = ref({});

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

  const units = g.cells
    .filter(c => c.glyph)
    .map(c => ({
      id:        c.unitId ?? `u_${c.x}_${c.y}`,
      team:      ownerTeam[c.owner] ?? (teams[0]?.id ?? 'p1'),
      type:      c.glyph.toLowerCase(),
      name:      c.unitName ?? c.glyph,
      hp:        c.maxHp ?? c.hp ?? 1,
      currentHp: c.hp,
      path:      [[c.x + 0.5, c.y + 0.5]],
      deathTurn: null,
      mp:            c.mp,
      maxMp:         c.maxMp,
      stats:         c.stats,
      abilities:     c.abilities,
      statusEffects: c.statusEffects,
      moved:         c.moved,
      acted:         c.acted,
      isActive:      c.isActive,
    }));

  return {
    game:  s.game,
    label: `${s.game} · Turn ${s.turn ?? 0}`,
    world: { w: g.width, h: g.height },
    turns: 1,
    grid:  'square',
    teams,
    walls: [],
    zones: [],
    units,
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
}, { immediate: true });

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

onMounted(refresh);
onUnmounted(stopPoll);

// ── session flow ─────────────────────────────────────────────
async function openSession(s) {
  try {
    const state = await api.session(s.id);
    liveState.value = state;
    view.value = 'battle';
    maybeStartPoll(state);
  } catch (e) { serverErr.value = e.message; }
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
    const created = await api.create({ game: cfg.game, players, config: { maxTurns: cfg.maxTurns ?? 500, fog: cfg.fog ?? false } });
    sessionMeta.value = { ...sessionMeta.value, [created.id]: players };
    const state = await api.session(created.id);
    liveState.value = state;
    view.value = 'battle';
    refresh();
    maybeStartPoll(state);
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
  refresh();
}
</script>

<template>
  <div style="height:100vh;display:flex;flex-direction:column">
    <div class="topbar">
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
      <span class="up" style="font-size:10px;color:var(--faint)">theme</span>
      <div class="seg">
        <button v-for="th in THEMES" :key="th.id"
                :class="{on: theme === th.id}"
                @click="theme = th.id"
                style="padding:4px 9px;font-size:11px">
          {{th.label}}
        </button>
      </div>
      <span class="mono" style="font-size:11px;color:var(--faint)">
        {{apiGames.length}} games
      </span>
    </div>

    <div style="flex:1;min-height:0">
      <Lobby v-if="view === 'lobby'"
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
                   @exit="exitBattle"
                   @submit-action="submitAction"/>
      <div v-else
           style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--dim)">
        Loading…
      </div>
    </div>
  </div>
</template>
