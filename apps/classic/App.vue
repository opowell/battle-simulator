<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { BattleSimClient } from '@battle-sim/api-client';

const client = new BattleSimClient();
const screen = ref('games');
const games = ref([]);
const session = ref(null);
const error = ref(null);
let pollTimer = null;

function formatAction(a) {
  if (typeof a !== 'object' || a === null) return String(a);
  return Object.entries(a)
    .map(([k, v]) => `${k}:${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' ').slice(0, 50);
}

const done = computed(() => session.value?.status !== 'active');
const waiting = computed(() => !done.value && !session.value?.pendingPlayer);
const actions = computed(() => session.value?.legalActions ?? []);

const headerText = computed(() => {
  if (error.value) return 'BATTLE SIMULATOR — ERROR';
  if (screen.value === 'games') return `BATTLE SIMULATOR v0.1 • ${games.value.length} GAMES AVAILABLE`;
  const s = session.value;
  if (!s) return 'BATTLE SIMULATOR';
  return `${s.game.toUpperCase()} • TURN ${s.turn ?? '?'} • PHASE: ${s.phase ?? '-'} • ${s.status.toUpperCase()}`;
});

const gamesText = computed(() =>
  games.value.map(g =>
    `  ${g.name.toUpperCase().padEnd(16)} ${g.defaultPlayers.map(p => p.name).join(' vs ')}`
  ).join('\n')
);

const statusText = computed(() => {
  if (error.value) return 'ERROR';
  if (screen.value === 'games') return 'READY — SELECT A GAME TO BEGIN';
  return session.value ? `SESSION ${session.value.id.slice(0, 8)}…` : '';
});

async function init() {
  try {
    games.value = await client.listGames();
  } catch (e) {
    error.value = `Cannot reach API at ${client.base} — ${e.message}`;
  }
}

async function startGame(name) {
  try {
    const game = games.value.find(g => g.name === name);
    const players = game.defaultPlayers.map((p, i) => ({ ...p, agent: i === 0 ? 'human' : 'random' }));
    session.value = await client.createSession(name, players);
    screen.value = 'session';
    startPolling();
  } catch (e) { error.value = e.message; }
}

async function submitAction(action) {
  try {
    session.value = await client.submitAction(session.value.id, session.value.pendingPlayer, action);
  } catch (e) { error.value = e.message; }
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (!session.value || session.value.status !== 'active') return clearInterval(pollTimer);
    if (session.value.pendingPlayer) return;
    try { session.value = await client.getSession(session.value.id); } catch {}
  }, 800);
}

function exitSession() {
  clearInterval(pollTimer);
  client.deleteSession(session.value.id).catch(() => {});
  session.value = null;
  screen.value = 'games';
}

function retry() { error.value = null; init(); }

onMounted(init);
onUnmounted(() => clearInterval(pollTimer));
</script>

<template>
  <div id="header">{{ headerText }}</div>
  <div id="content">
    <div id="board">
      <pre v-if="error"><span class="err">{{ error }}</span></pre>
      <pre v-else-if="screen === 'games'">{{ gamesText }}</pre>
      <pre v-else-if="session">{{ session.rendered ?? '' }}</pre>
    </div>
    <div id="sidebar">
      <template v-if="error">
        <button class="btn" @click="retry">[ RETRY ]</button>
      </template>
      <template v-else-if="screen === 'games'">
        <div class="label">SELECT GAME</div>
        <button v-for="g in games" :key="g.name" class="btn" @click="startGame(g.name)">
          {{ g.name.toUpperCase() }}
        </button>
      </template>
      <template v-else-if="session">
        <template v-if="done">
          <div class="label">GAME OVER</div>
          <pre class="info">{{ JSON.stringify(session.result ?? session.error, null, 2) }}</pre>
          <button class="btn" @click="exitSession">[ MENU ]</button>
        </template>
        <template v-else-if="waiting">
          <div class="label">WAITING FOR AI</div>
          <div class="blink">...</div>
        </template>
        <template v-else>
          <div class="label">PLAYER: {{ session.pendingPlayer }} &mdash; {{ actions.length }} ACTIONS</div>
          <div id="action-list">
            <button v-for="(a, i) in actions.slice(0, 40)" :key="i" class="action-btn" @click="submitAction(a)">
              [{{ String(i + 1).padStart(2, '0') }}] {{ formatAction(a) }}
            </button>
            <div v-if="actions.length > 40" class="dim">...+{{ actions.length - 40 }} more</div>
          </div>
          <button class="btn" @click="exitSession">[ MENU ]</button>
        </template>
      </template>
    </div>
  </div>
  <div id="status">{{ statusText }}</div>
</template>
