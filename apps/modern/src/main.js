import { BattleSimClient } from '@battle-sim/api-client';
import './style.css';

const client = new BattleSimClient();
let state = {
  screen: 'main',
  games: [],
  sessions: [],
  pendingGame: null,
  pendingPlayers: [],
  pendingScenario: null,
  session: null,
  players: [],
  myPlayerId: null,
  error: null,
  actionSearch: '',
};
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

const OWNER_COLOR = ['#9a8878', '#3b82f6', '#ef4444']; // neutral, p1 blue, p2 red
const OWNER_SHADOW = ['none', '0 0 6px rgba(59,130,246,0.8)', '0 0 6px rgba(239,68,68,0.8)'];

function buildGrid(gridData) {
  const { width, height, cells, xLabels, yLabels } = gridData;

  const MAX_CELL = 72;
  const MIN_CELL = 14;
  const cellW = Math.floor((window.innerWidth  * 0.56) / width);
  const cellH = Math.floor((window.innerHeight * 0.80) / height);
  const cellSize = Math.max(MIN_CELL, Math.min(MAX_CELL, Math.min(cellW, cellH)));
  const fontSize = Math.max(9, Math.floor(cellSize * 0.52));
  const hpBarH  = cellSize >= 24 ? 3 : 0;

  const wrap = el('div', { class: 'grid-wrap' });

  const table = el('div', {
    class: 'board-grid',
    style: `
      display: grid;
      grid-template-columns: ${yLabels ? `${Math.ceil(cellSize * 0.6)}px ` : ''}repeat(${width}, ${cellSize}px);
      grid-template-rows: repeat(${height}, ${cellSize}px)${xLabels ? ` ${Math.ceil(cellSize * 0.5)}px` : ''};
      gap: 1px;
      background: #111;
      border: 1px solid #111;
      border-radius: 4px;
      overflow: hidden;
      width: fit-content;
    `,
  });

  // Build a lookup: { "x,y": cell }
  const lookup = {};
  for (const c of cells) lookup[`${c.x},${c.y}`] = c;

  for (let row = 0; row < height; row++) {
    // Y-axis label
    if (yLabels) {
      table.append(el('div', {
        class: 'axis-label',
        style: `font-size:${Math.max(8, cellSize * 0.38)}px; color:#888; display:flex; align-items:center; justify-content:center; background:#1a1a1a;`,
      }, yLabels[row] ?? ''));
    }
    for (let col = 0; col < width; col++) {
      const c = lookup[`${col},${row}`] ?? { x: col, y: row, glyph: '', owner: 0, terrain: '' };
      const bg = c.color ?? '#808070';
      const fg = OWNER_COLOR[c.owner] ?? OWNER_COLOR[0];
      const shadow = OWNER_SHADOW[c.owner] ?? 'none';

      const cellEl = el('div', {
        class: 'board-cell',
        style: `
          background: ${bg};
          width: ${cellSize}px;
          height: ${cellSize}px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          position: relative;
          font-size: ${fontSize}px;
          font-weight: 700;
          font-family: 'Segoe UI', sans-serif;
          color: ${fg};
          text-shadow: ${c.owner ? shadow : 'none'}, 0 1px 2px rgba(0,0,0,0.7);
          line-height: 1;
          user-select: none;
        `,
      });

      const display = c.emoji ?? c.glyph;
      if (display) {
        cellEl.append(el('span', { style: 'pointer-events:none' }, display));
        if (hpBarH && c.hp != null && c.maxHp) {
          const pct = Math.max(0, Math.min(1, c.hp / c.maxHp));
          const barColor = pct > 0.5 ? '#4ade80' : pct > 0.25 ? '#facc15' : '#f87171';
          cellEl.append(el('div', {
            style: `
              position: absolute;
              bottom: 1px; left: 1px; right: 1px;
              height: ${hpBarH}px;
              background: #2224;
              border-radius: 1px;
              overflow: hidden;
            `,
          }, el('div', {
            style: `height:100%; width:${Math.round(pct * 100)}%; background:${barColor};`,
          })));
        }
      }
      table.append(cellEl);
    }
  }

  // X-axis labels
  if (xLabels) {
    if (yLabels) {
      table.append(el('div', { style: 'background:#1a1a1a;' })); // corner spacer
    }
    for (const lbl of xLabels) {
      table.append(el('div', {
        class: 'axis-label',
        style: `font-size:${Math.max(8, cellSize * 0.38)}px; color:#888; display:flex; align-items:center; justify-content:center; background:#1a1a1a;`,
      }, lbl));
    }
  }

  wrap.append(table);
  return wrap;
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
  if (state.screen === 'main') renderMain(app);
  else if (state.screen === 'games') renderGames(app);
  else if (state.screen === 'configure') renderConfigure(app);
  else renderSession(app);
}

function renderMain(app) {
  const active = state.sessions.filter(s => s.status === 'active');
  app.append(
    el('header', { class: 'topbar' },
      el('div', { class: 'topbar-brand' },
        el('span', { class: 'brand-icon' }, '⚔️'),
        el('h1', {}, 'Battle Simulator')
      )
    ),
    el('div', { class: 'main-screen' },
      active.length > 0
        ? el('section', { class: 'main-section' },
            el('h2', { class: 'section-title' }, 'Resume Game'),
            el('div', { class: 'resume-list' },
              ...active.map(s => {
                const meta = gameMeta(s.game);
                return el('div', { class: 'resume-card', onclick: () => resumeSession(s.id) },
                  el('span', { class: 'resume-emoji' }, meta.emoji),
                  el('div', { class: 'resume-info' },
                    el('span', { class: 'resume-title' }, meta.title),
                    el('span', { class: 'resume-detail' }, `Turn ${s.turn ?? '?'} · ${s.status}`)
                  ),
                  el('span', { class: 'play-label' }, 'Resume →')
                );
              })
            )
          )
        : null,
      el('section', { class: 'main-section' },
        el('h2', { class: 'section-title' }, 'New Game'),
        el('button', { class: 'btn-new-game', onclick: () => { state.screen = 'games'; render(); } },
          el('span', {}, '+'),
          el('span', {}, 'Start New Game')
        )
      )
    )
  );
}

function renderConfigure(app) {
  const g = state.pendingGame;
  const meta = gameMeta(g.name);
  const gc = GENRE_COLOR[meta.genre] ?? '#64748b';
  const humanCount = state.pendingPlayers.filter(p => p.agent === 'human').length;

  app.append(
    el('header', { class: 'topbar' },
      el('div', { class: 'topbar-left' },
        el('button', { class: 'btn-back', onclick: () => { state.screen = 'games'; render(); } }, '← Back'),
        el('span', { class: 'topbar-game' }, `${meta.emoji} ${meta.title}`)
      )
    ),
    el('div', { class: 'configure-screen' },
      el('div', { class: 'configure-card' },
        el('div', { class: 'config-header' },
          el('span', { class: 'config-emoji' }, meta.emoji),
          el('div', {},
            el('h2', { class: 'config-game-title' }, meta.title),
            el('span', { class: 'genre-badge', style: `--gc:${gc}` }, meta.genre)
          )
        ),
        el('p', { class: 'config-desc' }, meta.desc),
        state.pendingGame.scenarios?.length > 0
          ? el('div', { class: 'config-scenarios' },
              el('h3', { class: 'config-section-label' }, 'Scenario'),
              el('div', { class: 'scenario-list' },
                ...state.pendingGame.scenarios.map(sc => {
                  const active = state.pendingScenario?.id === sc.id;
                  return el('div', {
                    class: `scenario-option${active ? ' selected' : ''}`,
                    onclick: () => { state.pendingScenario = sc; render(); },
                  },
                    el('div', { class: 'scenario-name' }, sc.name),
                    el('div', { class: 'scenario-desc' }, sc.description)
                  );
                })
              )
            )
          : null,
        el('div', { class: 'config-players' },
          el('h3', { class: 'config-section-label' }, 'Players'),
          ...state.pendingPlayers.map((p, i) => {
            const isHuman = p.agent === 'human';
            return el('div', { class: 'config-player-row' },
              el('span', { class: 'config-player-name' }, p.name),
              el('button', {
                class: `agent-toggle${isHuman ? ' human' : ' ai'}`,
                onclick: () => {
                  state.pendingPlayers[i] = { ...state.pendingPlayers[i], agent: isHuman ? 'random' : 'human' };
                  render();
                },
              }, isHuman ? '👤 Human' : '🤖 AI')
            );
          })
        ),
        humanCount > 1
          ? el('div', { class: 'mp-notice' },
              'Multiplayer mode — you\'ll get a shareable link for each other player. Each person opens their link in their own browser tab.'
            )
          : null,
        el('button', { class: 'btn-primary btn-launch', onclick: launchGame }, 'Start Game →')
      )
    )
  );
}

function renderGames(app) {
  const scroll = el('div', { class: 'games-screen' });
  app.append(
    el('header', { class: 'topbar' },
      el('div', { class: 'topbar-left' },
        el('button', { class: 'btn-back', onclick: () => { state.screen = 'main'; render(); } }, '← Back'),
        el('div', { class: 'topbar-brand' },
          el('span', { class: 'brand-icon' }, '⚔️'),
          el('h1', {}, 'Battle Simulator')
        )
      ),
      el('span', { class: 'badge' }, `${state.games.length} games`)
    ),
    scroll
  );
  scroll.append(
    el('div', { class: 'games-hero' },
      el('p', { class: 'games-subtitle' }, 'Choose a game to configure and play')
    ),
    el('main', { class: 'grid' },
      ...state.games.map(g => {
        const meta = gameMeta(g.name);
        const gc = GENRE_COLOR[meta.genre] ?? '#64748b';
        return el('div', { class: 'game-card', onclick: () => selectGame(g.name) },
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
  const myPlayerId = state.myPlayerId;
  const done = s.status !== 'active';
  const myTurn = !done && (myPlayerId ? s.pendingPlayer === myPlayerId : !!s.pendingPlayer);
  const waitingForHuman = !done && !myTurn && s.pendingPlayer !== null;
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
  } else if (myTurn) {
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
  } else if (waitingForHuman) {
    const oppName = state.players.find(p => p.id === activePid)?.name ?? activePid;
    actionsCard.append(
      el('div', { class: 'card-title' }, 'Status'),
      el('div', { class: 'waiting' },
        el('div', { class: 'spinner' }),
        el('p', {}, `Waiting for ${oppName}...`)
      )
    );
  } else {
    actionsCard.append(
      el('div', { class: 'card-title' }, 'Status'),
      el('div', { class: 'waiting' },
        el('div', { class: 'spinner' }),
        el('p', {}, 'AI is thinking...')
      )
    );
  }

  // Share banner: show links for other human players so they can join in their own tab
  const otherHumans = !done && myPlayerId
    ? (s.humanPlayers ?? []).filter(pid => pid !== myPlayerId)
    : [];

  const header = el('header', { class: 'topbar' },
    el('div', { class: 'topbar-left' },
      el('button', { class: 'btn-back', onclick: exitSession }, '← Back'),
      el('span', { class: 'topbar-game' }, `${meta.emoji} ${meta.title}`)
    ),
    el('div', { class: 'player-pills' }, pills),
    el('span', {
      class: 'badge',
      style: `background:${done ? '#dc2626' : '#16a34a'}`,
    }, done ? s.status : `Turn ${s.turn ?? '?'}`)
  );

  const main = el('main', { class: 'session-layout' },
    el('div', { class: 'board-card' },
      el('div', { class: 'card-title' }, `Board${s.phase ? ` — ${s.phase}` : ''}`),
      s.grid
        ? el('div', { class: 'board-grid-wrap' }, buildGrid(s.grid))
        : el('pre', { class: 'board-pre' }, s.rendered ?? '')
    ),
    actionsCard
  );

  app.append(header);

  if (otherHumans.length > 0) {
    app.append(el('div', { class: 'share-banner' },
      el('span', { class: 'share-label' }, 'Share with other players:'),
      ...otherHumans.map(pid => {
        const pname = state.players.find(p => p.id === pid)?.name ?? pid;
        const url = `${location.origin}${location.pathname}?session=${encodeURIComponent(s.id)}&player=${encodeURIComponent(pid)}`;
        const input = el('input', {
          class: 'share-input',
          type: 'text',
          readonly: 'readonly',
          value: url,
        });
        input.addEventListener('click', () => input.select());
        const btn = el('button', { class: 'btn-copy' }, 'Copy');
        btn.addEventListener('click', () => {
          navigator.clipboard.writeText(url).then(() => {
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
          });
        });
        return el('div', { class: 'share-row' },
          el('span', { class: 'share-name' }, pname),
          input,
          btn
        );
      })
    ));
  }

  app.append(main);
}

async function init() {
  const params = new URLSearchParams(location.search);
  const sessionParam = params.get('session');
  const playerParam = params.get('player');

  try {
    state.games = await client.listGames();

    if (sessionParam && playerParam) {
      history.replaceState({}, '', location.pathname);
      state.myPlayerId = playerParam;
      localStorage.setItem(`battleSim_${sessionParam}_player`, playerParam);
      state.session = await client.getSession(sessionParam, state.myPlayerId);
      const game = state.games.find(g => g.name === state.session.game);
      state.players = game ? game.defaultPlayers : [];
      state.screen = 'session';
      state.actionSearch = '';
      render();
      startPolling();
      return;
    }

    state.sessions = await client.listSessions();
    render();
  } catch (e) {
    state.error = `Cannot reach API at ${client.base} — ${e.message}`;
    render();
  }
}

function selectGame(name) {
  const game = state.games.find(g => g.name === name);
  state.pendingGame = game;
  state.pendingPlayers = game.defaultPlayers.map((p, i) => ({ ...p, agent: i === 0 ? 'human' : 'random' }));
  state.pendingScenario = game.scenarios?.[0] ?? null;
  state.screen = 'configure';
  render();
}

async function launchGame() {
  try {
    const { name } = state.pendingGame;
    const players = state.pendingPlayers;
    state.players = players;
    const config = state.pendingScenario?.config ?? {};
    state.session = await client.createSession(name, players, config);
    const firstHuman = players.find(p => p.agent === 'human');
    state.myPlayerId = firstHuman?.id ?? null;
    if (state.myPlayerId) {
      localStorage.setItem(`battleSim_${state.session.id}_player`, state.myPlayerId);
    }
    state.pendingGame = null;
    state.pendingPlayers = [];
    state.pendingScenario = null;
    state.screen = 'session';
    state.actionSearch = '';
    render();
    startPolling();
  } catch (e) { state.error = e.message; render(); }
}

async function resumeSession(id) {
  try {
    state.myPlayerId = localStorage.getItem(`battleSim_${id}_player`);
    state.session = await client.getSession(id, state.myPlayerId);
    if (!state.myPlayerId && state.session.humanPlayers?.length > 0) {
      state.myPlayerId = state.session.humanPlayers[0];
    }
    const game = state.games.find(g => g.name === state.session.game);
    state.players = game ? game.defaultPlayers : [];
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
    const isMyTurn = state.myPlayerId
      ? state.session.pendingPlayer === state.myPlayerId
      : !!state.session.pendingPlayer;
    if (isMyTurn) return;
    try { state.session = await client.getSession(state.session.id, state.myPlayerId); render(); } catch {}
  }, 800);
}

function exitSession() {
  clearInterval(pollTimer);
  const id = state.session.id;
  localStorage.removeItem(`battleSim_${id}_player`);
  state.sessions = state.sessions.filter(s => s.id !== id);
  client.deleteSession(id).catch(() => {});
  state.session = null;
  state.players = [];
  state.myPlayerId = null;
  state.screen = 'main';
  state.actionSearch = '';
  render();
}

init();
