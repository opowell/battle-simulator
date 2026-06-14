<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { BattleSimClient } from '@battle-sim/api-client';

const client = new BattleSimClient();
const outputText = ref('connecting...');
const promptText = ref('> ');
const inputVal = ref('');
const screen = ref('games');
const games = ref([]);
const session = ref(null);
const error = ref(null);
let pollTimer = null;

function formatAction(a, i) {
  if (typeof a !== 'object' || a === null) return `${i + 1}. ${a}`;
  const parts = Object.entries(a).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`);
  return `${i + 1}. ${parts.join(' ')}`;
}

function render() {
  if (error.value) {
    outputText.value = `error: ${error.value}\n\ntype 'r' to retry`;
    promptText.value = '> ';
    return;
  }
  if (screen.value === 'games') {
    outputText.value = [
      'battle-simulator',
      '─'.repeat(40),
      '',
      ...games.value.map((g, i) =>
        `${i + 1}. ${g.name.padEnd(16)} ${g.defaultPlayers.map(p => p.name).join(' vs ')}`
      ),
      '',
      'enter number to start a game',
    ].join('\n');
    promptText.value = '> ';
    return;
  }
  const s = session.value;
  const done = s.status !== 'active';
  const waiting = !done && !s.pendingPlayer;
  const acts = s.legalActions ?? [];
  const lines = [
    `${s.game}  turn ${s.turn ?? '?'}  ${s.status}`,
    '─'.repeat(40),
    '',
    s.rendered ?? '',
    '',
    '─'.repeat(40),
  ];
  if (done) {
    lines.push(`result: ${JSON.stringify(s.result ?? s.error)}`);
    lines.push('', "type 'q' to go back");
    promptText.value = '> ';
  } else if (waiting) {
    lines.push('waiting for ai...');
    promptText.value = '';
  } else {
    lines.push(`${s.pendingPlayer}  ${acts.length} actions:`);
    lines.push('');
    acts.slice(0, 30).forEach((a, i) => lines.push(formatAction(a, i)));
    if (acts.length > 30) lines.push(`...+${acts.length - 30} more`);
    lines.push('', "type number to choose  'q' to quit");
    promptText.value = '> ';
  }
  outputText.value = lines.join('\n');
  inputVal.value = '';
}

function handleInput(val) {
  val = val.trim();
  if (!val) return;
  if (error.value) {
    if (val === 'r') { error.value = null; init(); }
    return;
  }
  if (screen.value === 'games') {
    const n = parseInt(val, 10) - 1;
    if (!isNaN(n) && games.value[n]) startGame(games.value[n].name);
    return;
  }
  if (val === 'q') { exitSession(); return; }
  const s = session.value;
  if (s.status !== 'active' || !s.pendingPlayer) return;
  const n = parseInt(val, 10) - 1;
  if (!isNaN(n) && s.legalActions[n]) submitAction(s.legalActions[n]);
}

function onKeydown(e) {
  if (e.key === 'Enter') {
    handleInput(inputVal.value);
    inputVal.value = '';
  }
}

async function init() {
  outputText.value = 'connecting...';
  try {
    games.value = await client.listGames();
    render();
  } catch (e) {
    error.value = `cannot connect to ${client.base}: ${e.message}`;
    render();
  }
}

async function startGame(name) {
  outputText.value = `starting ${name}...`;
  try {
    const game = games.value.find(g => g.name === name);
    const players = game.defaultPlayers.map((p, i) => ({ ...p, agent: i === 0 ? 'human' : 'random' }));
    session.value = await client.createSession(name, players);
    screen.value = 'session';
    render();
    startPolling();
  } catch (e) { error.value = e.message; render(); }
}

async function submitAction(action) {
  try {
    session.value = await client.submitAction(session.value.id, session.value.pendingPlayer, action);
    render();
  } catch (e) { error.value = e.message; render(); }
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (!session.value || session.value.status !== 'active') return clearInterval(pollTimer);
    if (session.value.pendingPlayer) return;
    try { session.value = await client.getSession(session.value.id); render(); } catch {}
  }, 800);
}

function exitSession() {
  clearInterval(pollTimer);
  client.deleteSession(session.value.id).catch(() => {});
  session.value = null;
  screen.value = 'games';
  render();
}

onMounted(init);
onUnmounted(() => clearInterval(pollTimer));
</script>

<template>
  <div id="output">{{ outputText }}</div>
  <div class="input-row">
    <span id="prompt">{{ promptText }}</span>
    <input id="input" v-model="inputVal" type="text" autocomplete="off" autofocus @keydown="onKeydown" />
  </div>
</template>
