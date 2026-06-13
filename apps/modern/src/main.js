import { BattleSimClient } from '@battle-sim/api-client';
import './style.css';

const client = new BattleSimClient();
let state = { screen: 'games', games: [], session: null, error: null };
let pollTimer = null;

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(typeof child === 'string' ? child : child);
  }
  return node;
}

function formatAction(a) {
  if (typeof a !== 'object' || a === null) return String(a);
  return Object.entries(a)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join('  ·  ').slice(0, 60);
}

function render() {
  const app = document.getElementById('app');
  app.innerHTML = '';
  if (state.error) {
    app.append(
      el('div', { class: 'error-card' },
        el('h2', {}, 'Connection Error'),
        el('p', {}, state.error),
        el('button', { class: 'btn-primary', onclick: () => { state.error = null; init(); } }, 'Retry')
      )
    );
    return;
  }
  if (state.screen === 'games') renderGames(app);
  else renderSession(app);
}

function renderGames(app) {
  app.append(
    el('header', { class: 'topbar' },
      el('h1', {}, 'Battle Simulator'),
      el('span', { class: 'badge' }, `${state.games.length} games`)
    ),
    el('main', { class: 'grid' },
      ...state.games.map(g =>
        el('div', { class: 'game-card', onclick: () => startGame(g.name) },
          el('h3', {}, g.name),
          el('p', {}, g.defaultPlayers.map(p => p.name).join(' vs ')),
          el('span', { class: 'play-label' }, 'Play →')
        )
      )
    )
  );
}

function renderSession(app) {
  const s = state.session;
  const done = s.status !== 'active';
  const waiting = !done && !s.pendingPlayer;
  const actions = s.legalActions ?? [];

  app.append(
    el('header', { class: 'topbar' },
      el('button', { class: 'btn-back', onclick: exitSession }, '← Back'),
      el('h1', {}, s.game),
      el('span', { class: 'badge', style: `background:${done ? '#dc2626' : '#16a34a'}` },
        s.status === 'active' ? `Turn ${s.turn ?? '?'}` : s.status)
    ),
    el('main', { class: 'session-layout' },
      el('div', { class: 'board-card' },
        el('div', { class: 'card-title' }, 'Board'),
        el('pre', { class: 'board-pre' }, s.rendered ?? '')
      ),
      el('div', { class: 'actions-card' },
        el('div', { class: 'card-title' },
          done ? 'Result' : waiting ? 'Status' : `Actions — ${s.pendingPlayer}`
        ),
        done
          ? el('pre', { class: 'result-pre' }, JSON.stringify(s.result ?? s.error, null, 2))
          : waiting
            ? el('div', { class: 'waiting' },
                el('div', { class: 'spinner' }),
                el('p', {}, 'AI is thinking...')
              )
            : el('div', { class: 'action-grid' },
                ...actions.slice(0, 40).map((a, i) =>
                  el('button', { class: 'action-btn', onclick: () => submitAction(a) },
                    el('span', { class: 'action-num' }, String(i + 1)),
                    el('span', { class: 'action-text' }, formatAction(a))
                  )
                ),
                actions.length > 40
                  ? el('p', { class: 'more' }, `+${actions.length - 40} more`)
                  : null
              )
      )
    )
  );
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
    try { state.session = await client.getSession(state.session.id); render(); } catch {}
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
