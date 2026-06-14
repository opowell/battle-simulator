import { BattleSimClient } from '@battle-sim/api-client';
import './style.css';

const client = new BattleSimClient();
let state = { screen: 'games', games: [], session: null, myPlayerId: null, error: null };
let pollTimer = null;

function formatAction(a) {
  if (typeof a !== 'object' || a === null) return String(a);
  return Object.entries(a)
    .map(([k, v]) => `${k}:${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' ').slice(0, 50);
}

function render() {
  const app = document.getElementById('app');
  if (state.error) {
    app.innerHTML = `
      <div id="header">BATTLE SIMULATOR &mdash; ERROR</div>
      <div id="content"><div id="board"><span class="err">${state.error}</span><br><br>
        <button class="btn" id="retry">[ RETRY ]</button></div></div>
      <div id="status">ERROR</div>`;
    document.getElementById('retry').onclick = () => { state.error = null; init(); };
    return;
  }
  if (state.screen === 'games') {
    app.innerHTML = `
      <div id="header">BATTLE SIMULATOR v0.1 &bull; ${state.games.length} GAMES AVAILABLE</div>
      <div id="content">
        <div id="board"><pre>${state.games.map(g =>
          `  ${g.name.toUpperCase().padEnd(16)} ${g.defaultPlayers.map(p => p.name).join(' vs ')}`
        ).join('\n')}</pre></div>
        <div id="sidebar">
          <div class="label">SELECT GAME</div>
          ${state.games.map(g => `<button class="btn" data-game="${g.name}">${g.name.toUpperCase()}</button>`).join('')}
        </div>
      </div>
      <div id="status">READY &mdash; SELECT A GAME TO BEGIN</div>`;
    app.querySelectorAll('[data-game]').forEach(b =>
      b.addEventListener('click', () => startGame(b.dataset.game)));
    return;
  }

  const s = state.session;
  const done = s.status !== 'active';
  const waiting = !done && !s.pendingPlayer;
  const actions = s.legalActions ?? [];

  app.innerHTML = `
    <div id="header">${s.game.toUpperCase()} &bull; TURN ${s.turn ?? '?'} &bull; PHASE: ${s.phase ?? '-'} &bull; ${s.status.toUpperCase()}</div>
    <div id="content">
      <div id="board"><pre>${s.rendered ?? ''}</pre></div>
      <div id="sidebar">
        ${done ? `
          <div class="label">GAME OVER</div>
          <pre class="info">${JSON.stringify(s.result ?? s.error, null, 2)}</pre>
          <button class="btn" id="back">[ MENU ]</button>
        ` : waiting ? `
          <div class="label">WAITING FOR AI</div>
          <div class="blink">...</div>
        ` : `
          <div class="label">PLAYER: ${s.pendingPlayer} &mdash; ${actions.length} ACTIONS</div>
          <div id="action-list">
            ${actions.slice(0, 40).map((a, i) =>
              `<button class="action-btn" data-idx="${i}">[${String(i + 1).padStart(2, '0')}] ${formatAction(a)}</button>`
            ).join('')}
            ${actions.length > 40 ? `<div class="dim">...+${actions.length - 40} more</div>` : ''}
          </div>
          <button class="btn" id="back">[ MENU ]</button>
        `}
      </div>
    </div>
    <div id="status">SESSION ${s.id.slice(0, 8)}&hellip;</div>`;

  app.querySelectorAll('.action-btn').forEach(b =>
    b.addEventListener('click', () => submitAction(actions[+b.dataset.idx])));
  document.getElementById('back')?.addEventListener('click', exitSession);
}

async function init() {
  try {
    state.games = await client.listGames();
    render();
  } catch (e) {
    state.error = `Cannot reach API at ${client.base} — ${e.message}`;
    render();
  }
}

async function startGame(name) {
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

init();
