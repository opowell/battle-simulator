import { BattleSimClient } from '@battle-sim/api-client';
import './style.css';

const client = new BattleSimClient();
let state = { screen: 'games', games: [], session: null, players: [], error: null, actionSearch: '' };
let pollTimer = null;

const GAME_META = {
  chess:         { emoji: '♟️',  title: 'Chess',           genre: 'Strategy',  desc: 'Classic — checkmate the king' },
  tactical:      { emoji: '⚔️',  title: 'Tactical',        genre: 'Tactical',  desc: 'Turn-based squad combat on a grid' },
  cardbattle:    { emoji: '🃏',  title: 'Card Battle',     genre: 'Card',      desc: 'Draw, play, and duel to zero HP' },
  civ1:          { emoji: '🏛️',  title: 'Civilization',    genre: 'Strategy',  desc: 'Build an empire from a single settler' },
  civ2:          { emoji: '🌍',  title: 'Civilization II', genre: 'Strategy',  desc: 'Expanded civs, diplomacy & tech tree' },
  risk:          { emoji: '🗺️',  title: 'Risk',            genre: 'Strategy',  desc: 'Conquer territories for global domination' },
  axisallies:    { emoji: '✈️',  title: 'Axis & Allies',   genre: 'Wargame',   desc: 'WWII grand strategy board game' },
  combatmission: { emoji: '🪖',  title: 'Combat Mission',  genre: 'Wargame',   desc: 'Realistic platoon-level tactical combat' },
  xcom:          { emoji: '👽',  title: 'XCOM',            genre: 'Tactical',  desc: 'Defend Earth from alien invasion' },
  aow:           { emoji: '🧙',  title: 'Age of Wonders',  genre: 'Fantasy',   desc: 'Fantasy empire building & conquest' },
  cs:            { emoji: '🔫',  title: 'Counter-Strike',  genre: 'Shooter',   desc: 'CTs vs Terrorists — defuse or detonate' },
  ffta:          { emoji: '⚡',  title: 'FF Tactics',      genre: 'RPG',       desc: 'Job-class tactical RPG on a grid' },
  sc1:           { emoji: '🚀',  title: 'StarCraft',       genre: 'RTS',       desc: 'Three-faction real-time strategy' },
  sc2:           { emoji: '🛸',  title: 'StarCraft II',    genre: 'RTS',       desc: 'Refined RTS with new units & mechanics' },
  doom:          { emoji: '👹',  title: 'DOOM',            genre: 'Shooter',   desc: 'Survive waves of hell-spawned demons' },
  rogue:         { emoji: '🏚️',  title: 'Rogue',           genre: 'Roguelike', desc: 'Procedural ASCII dungeon crawler' },
  simcity:       { emoji: '🏙️',  title: 'SimCity',         genre: 'Builder',   desc: 'Zone, build, and manage a thriving city' },
};

const GENRE_COLOR = {
  Strategy: '#4f46e5', Tactical: '#0891b2', Card:      '#7c3aed',
  Wargame:  '#b45309', Fantasy:  '#059669', Shooter:   '#dc2626',
  RPG:      '#db2777', RTS:      '#0369a1', Roguelike: '#57534e',
  Builder:  '#16a34a',
};

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

function gameMeta(name) {
  return GAME_META[name] ?? {
    emoji: '🎮',
    title: name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Game',
    genre: 'Game',
    desc: '',
  };
}

function formatAction(a) {
  if (typeof a !== 'object' || a === null) return String(a);
  return Object.entries(a)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join('  ·  ');
}

function renderActionItems(container, actions, search) {
  container.innerHTML = '';
  const term = search.trim().toLowerCase();
  const filtered = term ? actions.filter(a => formatAction(a).toLowerCase().includes(term)) : actions;
  const shown = filtered.slice(0, 50);
  for (const [i, a] of shown.entries()) {
    container.append(
      el('button', { class: 'action-btn', onclick: () => submitAction(a) },
        el('span', { class: 'action-num' }, String(i + 1)),
        el('span', { class: 'action-text' }, formatAction(a))
      )
    );
  }
  if (filtered.length > 50) {
    container.append(el('p', { class: 'more' }, `+${filtered.length - 50} more actions`));
  } else if (filtered.length === 0 && term) {
    container.append(el('p', { class: 'no-results' }, `No actions match "${term}"`));
  }
}

function render() {
  const app = document.getElementById('app');
  app.innerHTML = '';
  if (state.error) {
    app.append(
      el('div', { class: 'error-wrap' },
        el('div', { class: 'error-card' },
          el('div', { class: 'error-icon' }, '⚠️'),
          el('h2', {}, 'Connection Error'),
          el('p', {}, state.error),
          el('button', { class: 'btn-primary', onclick: () => { state.error = null; init(); } }, 'Retry')
        )
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
      el('div', { class: 'topbar-brand' },
        el('span', { class: 'brand-icon' }, '⚔️'),
        el('h1', {}, 'Battle Simulator')
      ),
      el('span', { class: 'badge' }, `${state.games.length} games`)
    ),
    el('div', { class: 'games-hero' },
      el('p', { class: 'games-subtitle' }, 'Choose a game and play against the AI')
    ),
    el('main', { class: 'grid' },
      ...state.games.map(g => {
        const meta = gameMeta(g.name);
        const gc = GENRE_COLOR[meta.genre] ?? '#64748b';
        return el('div', { class: 'game-card', onclick: () => startGame(g.name) },
          el('div', { class: 'game-card-top' },
            el('span', { class: 'game-emoji' }, meta.emoji),
            el('span', { class: 'genre-badge', style: `--gc:${gc}` }, meta.genre)
          ),
          el('h3', {}, meta.title),
          el('p', { class: 'game-desc' }, meta.desc),
          el('div', { class: 'game-card-footer' },
            el('span', { class: 'game-players' }, g.defaultPlayers.map(p => p.name).join(' vs ')),
            el('span', { class: 'play-label' }, 'Play →')
          )
        );
      })
    )
  );
}

function renderSession(app) {
  const s = state.session;
  const done = s.status !== 'active';
  const waiting = !done && !s.pendingPlayer;
  const actions = s.legalActions ?? [];
  const activePid = s.pendingPlayer;
  const meta = gameMeta(s.game);

  const pills = state.players.flatMap((p, i) => [
    i > 0 ? el('span', { class: 'vs-sep' }, 'vs') : null,
    el('span', { class: `player-pill${p.id === activePid ? ' active' : ''}` }, p.name),
  ]);

  const actionsCard = el('div', { class: 'actions-card' });

  if (done) {
    const r = s.result ?? {};
    const winnerName = r.winnerId
      ? (state.players.find(p => p.id === r.winnerId)?.name ?? r.winnerId)
      : null;
    actionsCard.append(
      el('div', { class: 'card-title' }, 'Result'),
      el('div', { class: 'result-body' },
        el('div', { class: 'result-outcome' },
          r.outcome === 'win' ? '🏆' : r.outcome === 'draw' ? '🤝' : '❌'
        ),
        el('h3', {}, r.outcome === 'win' ? `${winnerName} wins!` : r.outcome === 'draw' ? 'Draw' : s.status),
        r.reason ? el('p', { class: 'result-reason' }, r.reason.replace(/-/g, ' ')) : null,
        el('button', { class: 'btn-primary result-btn', onclick: exitSession }, 'New Game')
      )
    );
  } else if (waiting) {
    actionsCard.append(
      el('div', { class: 'card-title' }, 'Status'),
      el('div', { class: 'waiting' },
        el('div', { class: 'spinner' }),
        el('p', {}, 'AI is thinking...')
      )
    );
  } else {
    const grid = el('div', { class: 'action-grid' });
    renderActionItems(grid, actions, state.actionSearch);

    const searchInput = el('input', {
      class: 'search-input',
      type: 'text',
      placeholder: `Filter ${actions.length} actions...`,
      value: state.actionSearch,
    });
    searchInput.addEventListener('input', e => {
      state.actionSearch = e.target.value;
      renderActionItems(grid, actions, state.actionSearch);
    });

    actionsCard.append(
      el('div', { class: 'card-title' }, `Actions — ${activePid}`),
      el('div', { class: 'search-wrap' }, searchInput),
      grid
    );
  }

  app.append(
    el('header', { class: 'topbar' },
      el('div', { class: 'topbar-left' },
        el('button', { class: 'btn-back', onclick: exitSession }, '← Back'),
        el('span', { class: 'topbar-game' }, `${meta.emoji} ${meta.title}`)
      ),
      el('div', { class: 'player-pills' }, pills),
      el('span', {
        class: 'badge',
        style: `background:${done ? '#dc2626' : '#16a34a'}`,
      }, done ? s.status : `Turn ${s.turn ?? '?'}`)
    ),
    el('main', { class: 'session-layout' },
      el('div', { class: 'board-card' },
        el('div', { class: 'card-title' }, `Board${s.phase ? ` — ${s.phase}` : ''}`),
        el('pre', { class: 'board-pre' }, s.rendered ?? '')
      ),
      actionsCard
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
    state.players = players;
    state.session = await client.createSession(name, players);
    state.screen = 'session';
    state.actionSearch = '';
    render();
    startPolling();
  } catch (e) { state.error = e.message; render(); }
}

async function submitAction(action) {
  try {
    state.actionSearch = '';
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
  state.players = [];
  state.screen = 'games';
  state.actionSearch = '';
  render();
}

init();
