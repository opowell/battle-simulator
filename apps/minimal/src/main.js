import { BattleSimClient } from '@battle-sim/api-client';
import './style.css';

const client = new BattleSimClient();
let state = { screen: 'games', games: [], session: null, myPlayerId: null, error: null };
let pollTimer = null;

const output = () => document.getElementById('output');
const prompt = () => document.getElementById('prompt');

function formatAction(a, i) {
  if (typeof a !== 'object' || a === null) return `${i + 1}. ${a}`;
  const parts = Object.entries(a).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`);
  return `${i + 1}. ${parts.join(' ')}`;
}

function render() {
  if (state.error) {
    output().textContent = `error: ${state.error}\n\ntype 'r' to retry`;
    prompt().textContent = '> ';
    return;
  }

  if (state.screen === 'games') {
    output().textContent = [
      'battle-simulator',
      '─'.repeat(40),
      '',
      ...state.games.map((g, i) =>
        `${i + 1}. ${g.name.padEnd(16)} ${g.defaultPlayers.map(p => p.name).join(' vs ')}`
      ),
      '',
      'enter number to start a game',
    ].join('\n');
    prompt().textContent = '> ';
    return;
  }

  const s = state.session;
  const done = s.status !== 'active';
  const waiting = !done && !s.pendingPlayer;
  const actions = s.legalActions ?? [];

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
    prompt().textContent = '> ';
  } else if (waiting) {
    lines.push('waiting for ai...');
    prompt().textContent = '';
  } else {
    lines.push(`${s.pendingPlayer}  ${actions.length} actions:`);
    lines.push('');
    actions.slice(0, 30).forEach((a, i) => lines.push(formatAction(a, i)));
    if (actions.length > 30) lines.push(`...+${actions.length - 30} more`);
    lines.push('', "type number to choose  'q' to quit");
    prompt().textContent = '> ';
  }

  output().textContent = lines.join('\n');
  document.getElementById('input').value = '';
  if (prompt().textContent) document.getElementById('input').focus();
}

function handleInput(val) {
  val = val.trim();
  if (!val) return;

  if (state.error) {
    if (val === 'r') { state.error = null; init(); }
    return;
  }

  if (state.screen === 'games') {
    const n = parseInt(val, 10) - 1;
    if (!isNaN(n) && state.games[n]) startGame(state.games[n].name);
    return;
  }

  if (val === 'q') { exitSession(); return; }

  const s = state.session;
  if (s.status !== 'active' || !s.pendingPlayer) return;
  const n = parseInt(val, 10) - 1;
  if (!isNaN(n) && s.legalActions[n]) submitAction(s.legalActions[n]);
}

async function init() {
  output().textContent = 'connecting...';
  try {
    state.games = await client.listGames();
    render();
  } catch (e) {
    state.error = `cannot connect to ${client.base}: ${e.message}`;
    render();
  }
}

async function startGame(name) {
  output().textContent = `starting ${name}...`;
  try {
    const game = state.games.find(g => g.name === name);
    const players = game.defaultPlayers.map((p, i) => ({ ...p, agent: i === 0 ? 'human' : 'random' }));
    state.session = await client.createSession(name, players);
    state.myPlayerId = state.session.humanPlayers?.[0] ?? null;
    state.screen = 'session';
    render();
    startPolling();
  } catch (e) { state.error = e.message; render(); }
}

async function submitAction(action) {
  try {
    state.session = await client.submitAction(state.session.id, state.session.pendingPlayer, action);
    render();
  } catch (e) { state.error = e.message; render(); }
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (!state.session || state.session.status !== 'active') return clearInterval(pollTimer);
    if (state.session.pendingPlayer) return;
    try { state.session = await client.getSession(state.session.id, state.myPlayerId); render(); } catch {}
  }, 800);
}

function exitSession() {
  clearInterval(pollTimer);
  client.deleteSession(state.session.id).catch(() => {});
  state.session = null;
  state.screen = 'games';
  render();
}

document.getElementById('input').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    handleInput(e.target.value);
    e.target.value = '';
  }
});

init();
