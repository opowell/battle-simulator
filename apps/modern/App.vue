<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { BattleSimClient } from '@battle-sim/api-client';

const client = new BattleSimClient();
const screen = ref('main');
const games = ref([]);
const sessions = ref([]);
const pendingGame = ref(null);
const pendingPlayers = ref([]);
const pendingScenario = ref(null);
const session = ref(null);
const players = ref([]);
const myPlayerId = ref(null);
const error = ref(null);
const actionSearch = ref('');
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

const OWNER_COLOR = ['#9a8878', '#3b82f6', '#ef4444'];
const OWNER_SHADOW = ['none', '0 0 6px rgba(59,130,246,0.8)', '0 0 6px rgba(239,68,68,0.8)'];

function gameMeta(name) {
  return GAME_META[name] ?? {
    emoji: '🎮',
    title: name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Game',
    genre: 'Game', desc: '',
  };
}

function formatAction(a) {
  if (typeof a !== 'object' || a === null) return String(a);
  return Object.entries(a)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join('  ·  ');
}

const activeSessions = computed(() => sessions.value.filter(s => s.status === 'active'));
const sessionMeta = computed(() => session.value ? gameMeta(session.value.game) : null);
const pendingMeta = computed(() => pendingGame.value ? gameMeta(pendingGame.value.name) : null);
const humanCount = computed(() => pendingPlayers.value.filter(p => p.agent === 'human').length);

const isDone = computed(() => !!session.value && session.value.status !== 'active');
const isMyTurn = computed(() => {
  if (!session.value || isDone.value) return false;
  return myPlayerId.value
    ? session.value.pendingPlayer === myPlayerId.value
    : !!session.value.pendingPlayer;
});
const isWaitingForHuman = computed(() =>
  !isDone.value && !isMyTurn.value && session.value?.pendingPlayer !== null
);
const sessionActions = computed(() => session.value?.legalActions ?? []);
const filteredActions = computed(() => {
  const term = actionSearch.value.trim().toLowerCase();
  return term
    ? sessionActions.value.filter(a => formatAction(a).toLowerCase().includes(term))
    : sessionActions.value;
});
const otherHumans = computed(() => {
  if (!session.value || isDone.value || !myPlayerId.value) return [];
  return (session.value.humanPlayers ?? []).filter(pid => pid !== myPlayerId.value);
});

const gridView = computed(() => {
  if (!session.value?.grid) return null;
  const { width, height, cells, xLabels, yLabels } = session.value.grid;
  const MAX_CELL = 72, MIN_CELL = 14;
  const cellW = Math.floor((window.innerWidth * 0.56) / width);
  const cellH = Math.floor((window.innerHeight * 0.80) / height);
  const cellSize = Math.max(MIN_CELL, Math.min(MAX_CELL, Math.min(cellW, cellH)));
  const fontSize = Math.max(9, Math.floor(cellSize * 0.52));
  const hpBarH = cellSize >= 24 ? 3 : 0;
  const lookup = {};
  for (const c of cells) lookup[`${c.x},${c.y}`] = c;
  const rows = [];
  for (let row = 0; row < height; row++) {
    const cols = [];
    for (let col = 0; col < width; col++) {
      cols.push(lookup[`${col},${row}`] ?? { x: col, y: row, glyph: '', owner: 0 });
    }
    rows.push(cols);
  }
  const labelSize = `${Math.max(8, Math.floor(cellSize * 0.38))}px`;
  return { width, height, rows, xLabels, yLabels, cellSize, fontSize, hpBarH, labelSize };
});

function cellStyle(c, cellSize, fontSize) {
  return {
    background: c.color ?? '#808070',
    width: cellSize + 'px',
    height: cellSize + 'px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    fontSize: fontSize + 'px',
    fontWeight: '700',
    fontFamily: "'Segoe UI', sans-serif",
    color: OWNER_COLOR[c.owner] ?? OWNER_COLOR[0],
    textShadow: (c.owner ? (OWNER_SHADOW[c.owner] ?? 'none') : 'none') + ', 0 1px 2px rgba(0,0,0,0.7)',
    lineHeight: '1',
    userSelect: 'none',
  };
}

function hpPct(c) { return Math.max(0, Math.min(1, c.hp / c.maxHp)); }
function hpColor(c) {
  const p = hpPct(c);
  return p > 0.5 ? '#4ade80' : p > 0.25 ? '#facc15' : '#f87171';
}

function shareUrl(pid) {
  return `${location.origin}${location.pathname}?session=${encodeURIComponent(session.value.id)}&player=${encodeURIComponent(pid)}`;
}

function copyUrl(pid, btn) {
  navigator.clipboard.writeText(shareUrl(pid)).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  });
}

function genreColor(meta) { return GENRE_COLOR[meta.genre] ?? '#64748b'; }

async function init() {
  const params = new URLSearchParams(location.search);
  const sessionParam = params.get('session');
  const playerParam = params.get('player');
  try {
    games.value = await client.listGames();
    if (sessionParam && playerParam) {
      history.replaceState({}, '', location.pathname);
      myPlayerId.value = playerParam;
      localStorage.setItem(`battleSim_${sessionParam}_player`, playerParam);
      session.value = await client.getSession(sessionParam);
      const game = games.value.find(g => g.name === session.value.game);
      players.value = game ? game.defaultPlayers : [];
      screen.value = 'session';
      actionSearch.value = '';
      startPolling();
      return;
    }
    sessions.value = await client.listSessions();
  } catch (e) {
    error.value = `Cannot reach API at ${client.base} — ${e.message}`;
  }
}

function selectGame(name) {
  const game = games.value.find(g => g.name === name);
  pendingGame.value = game;
  pendingPlayers.value = game.defaultPlayers.map((p, i) => ({ ...p, agent: i === 0 ? 'human' : 'random' }));
  pendingScenario.value = game.scenarios?.[0] ?? null;
  screen.value = 'configure';
}

function toggleAgent(i) {
  const p = pendingPlayers.value[i];
  pendingPlayers.value[i] = { ...p, agent: p.agent === 'human' ? 'random' : 'human' };
}

async function launchGame() {
  try {
    const { name } = pendingGame.value;
    const pls = pendingPlayers.value;
    players.value = pls;
    const config = pendingScenario.value?.config ?? {};
    session.value = await client.createSession(name, pls, config);
    const firstHuman = pls.find(p => p.agent === 'human');
    myPlayerId.value = firstHuman?.id ?? null;
    if (myPlayerId.value) localStorage.setItem(`battleSim_${session.value.id}_player`, myPlayerId.value);
    pendingGame.value = null;
    pendingPlayers.value = [];
    pendingScenario.value = null;
    screen.value = 'session';
    actionSearch.value = '';
    startPolling();
  } catch (e) { error.value = e.message; }
}

async function resumeSession(id) {
  try {
    session.value = await client.getSession(id);
    myPlayerId.value = localStorage.getItem(`battleSim_${id}_player`);
    if (!myPlayerId.value && session.value.humanPlayers?.length > 0)
      myPlayerId.value = session.value.humanPlayers[0];
    const game = games.value.find(g => g.name === session.value.game);
    players.value = game ? game.defaultPlayers : [];
    screen.value = 'session';
    actionSearch.value = '';
    startPolling();
  } catch (e) { error.value = e.message; }
}

async function submitAction(action) {
  try {
    actionSearch.value = '';
    session.value = await client.submitAction(session.value.id, session.value.pendingPlayer, action);
  } catch (e) { error.value = e.message; }
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (!session.value || session.value.status !== 'active') return clearInterval(pollTimer);
    const myTurn = myPlayerId.value
      ? session.value.pendingPlayer === myPlayerId.value
      : !!session.value.pendingPlayer;
    if (myTurn) return;
    try { session.value = await client.getSession(session.value.id); } catch {}
  }, 800);
}

function exitSession() {
  clearInterval(pollTimer);
  const id = session.value.id;
  localStorage.removeItem(`battleSim_${id}_player`);
  sessions.value = sessions.value.filter(s => s.id !== id);
  client.deleteSession(id).catch(() => {});
  session.value = null;
  players.value = [];
  myPlayerId.value = null;
  screen.value = 'main';
  actionSearch.value = '';
}

onMounted(init);
onUnmounted(() => clearInterval(pollTimer));
</script>

<template>
  <!-- Error -->
  <div v-if="error" class="error-wrap">
    <div class="error-card">
      <div class="error-icon">⚠️</div>
      <h2>Connection Error</h2>
      <p>{{ error }}</p>
      <button class="btn-primary" @click="error = null; init()">Retry</button>
    </div>
  </div>

  <!-- Main -->
  <template v-else-if="screen === 'main'">
    <header class="topbar">
      <div class="topbar-brand">
        <span class="brand-icon">⚔️</span>
        <h1>Battle Simulator</h1>
      </div>
    </header>
    <div class="main-screen">
      <section v-if="activeSessions.length" class="main-section">
        <h2 class="section-title">Resume Game</h2>
        <div class="resume-list">
          <div v-for="s in activeSessions" :key="s.id" class="resume-card" @click="resumeSession(s.id)">
            <span class="resume-emoji">{{ gameMeta(s.game).emoji }}</span>
            <div class="resume-info">
              <span class="resume-title">{{ gameMeta(s.game).title }}</span>
              <span class="resume-detail">Turn {{ s.turn ?? '?' }} · {{ s.status }}</span>
            </div>
            <span class="play-label">Resume →</span>
          </div>
        </div>
      </section>
      <section class="main-section">
        <h2 class="section-title">New Game</h2>
        <button class="btn-new-game" @click="screen = 'games'">
          <span>+</span><span>Start New Game</span>
        </button>
      </section>
    </div>
  </template>

  <!-- Games -->
  <template v-else-if="screen === 'games'">
    <header class="topbar">
      <div class="topbar-left">
        <button class="btn-back" @click="screen = 'main'">← Back</button>
        <div class="topbar-brand">
          <span class="brand-icon">⚔️</span>
          <h1>Battle Simulator</h1>
        </div>
      </div>
      <span class="badge">{{ games.length }} games</span>
    </header>
    <div class="games-screen">
      <div class="games-hero">
        <p class="games-subtitle">Choose a game to configure and play</p>
      </div>
      <main class="grid">
        <div v-for="g in games" :key="g.name" class="game-card" @click="selectGame(g.name)">
          <div class="game-card-top">
            <span class="game-emoji">{{ gameMeta(g.name).emoji }}</span>
            <span class="genre-badge" :style="`--gc:${genreColor(gameMeta(g.name))}`">{{ gameMeta(g.name).genre }}</span>
          </div>
          <h3>{{ gameMeta(g.name).title }}</h3>
          <p class="game-desc">{{ gameMeta(g.name).desc }}</p>
          <div class="game-card-footer">
            <span class="game-players">{{ g.defaultPlayers.map(p => p.name).join(' vs ') }}</span>
            <span class="play-label">Play →</span>
          </div>
        </div>
      </main>
    </div>
  </template>

  <!-- Configure -->
  <template v-else-if="screen === 'configure' && pendingGame">
    <header class="topbar">
      <div class="topbar-left">
        <button class="btn-back" @click="screen = 'games'">← Back</button>
        <span class="topbar-game">{{ pendingMeta.emoji }} {{ pendingMeta.title }}</span>
      </div>
    </header>
    <div class="configure-screen">
      <div class="configure-card">
        <div class="config-header">
          <span class="config-emoji">{{ pendingMeta.emoji }}</span>
          <div>
            <h2 class="config-game-title">{{ pendingMeta.title }}</h2>
            <span class="genre-badge" :style="`--gc:${genreColor(pendingMeta)}`">{{ pendingMeta.genre }}</span>
          </div>
        </div>
        <p class="config-desc">{{ pendingMeta.desc }}</p>
        <div v-if="pendingGame.scenarios?.length" class="config-scenarios">
          <h3 class="config-section-label">Scenario</h3>
          <div class="scenario-list">
            <div v-for="sc in pendingGame.scenarios" :key="sc.id"
              :class="['scenario-option', pendingScenario?.id === sc.id && 'selected']"
              @click="pendingScenario = sc">
              <div class="scenario-name">{{ sc.name }}</div>
              <div class="scenario-desc">{{ sc.description }}</div>
            </div>
          </div>
        </div>
        <div class="config-players">
          <h3 class="config-section-label">Players</h3>
          <div v-for="(p, i) in pendingPlayers" :key="i" class="config-player-row">
            <span class="config-player-name">{{ p.name }}</span>
            <button :class="['agent-toggle', p.agent === 'human' ? 'human' : 'ai']" @click="toggleAgent(i)">
              {{ p.agent === 'human' ? '👤 Human' : '🤖 AI' }}
            </button>
          </div>
        </div>
        <div v-if="humanCount > 1" class="mp-notice">
          Multiplayer mode — you'll get a shareable link for each other player.
        </div>
        <button class="btn-primary btn-launch" @click="launchGame">Start Game →</button>
      </div>
    </div>
  </template>

  <!-- Session -->
  <template v-else-if="screen === 'session' && session">
    <header class="topbar">
      <div class="topbar-left">
        <button class="btn-back" @click="exitSession">← Back</button>
        <span class="topbar-game">{{ sessionMeta.emoji }} {{ sessionMeta.title }}</span>
      </div>
      <div class="player-pills">
        <template v-for="(p, i) in players" :key="p.id">
          <span v-if="i > 0" class="vs-sep">vs</span>
          <span :class="['player-pill', p.id === session.pendingPlayer && 'active']">{{ p.name }}</span>
        </template>
      </div>
      <span class="badge" :style="`background:${isDone ? '#dc2626' : '#16a34a'}`">
        {{ isDone ? session.status : `Turn ${session.turn ?? '?'}` }}
      </span>
    </header>

    <div v-if="otherHumans.length" class="share-banner">
      <span class="share-label">Share with other players:</span>
      <div v-for="pid in otherHumans" :key="pid" class="share-row">
        <span class="share-name">{{ players.find(p => p.id === pid)?.name ?? pid }}</span>
        <input class="share-input" type="text" readonly :value="shareUrl(pid)" @click="$event.target.select()" />
        <button class="btn-copy" @click="copyUrl(pid, $event.target)">Copy</button>
      </div>
    </div>

    <main class="session-layout">
      <div class="board-card">
        <div class="card-title">Board{{ session.phase ? ` — ${session.phase}` : '' }}</div>
        <div v-if="gridView" class="board-grid-wrap">
          <div :style="{
            display: 'grid',
            gridTemplateColumns: (gridView.yLabels ? `${Math.ceil(gridView.cellSize * 0.6)}px ` : '') + `repeat(${gridView.width}, ${gridView.cellSize}px)`,
            gap: '1px', background: '#111', border: '1px solid #111',
            borderRadius: '4px', overflow: 'hidden', width: 'fit-content',
          }">
            <template v-for="(row, ri) in gridView.rows" :key="ri">
              <div v-if="gridView.yLabels" class="axis-label"
                :style="{ fontSize: gridView.labelSize, color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a1a1a' }">
                {{ gridView.yLabels[ri] ?? '' }}
              </div>
              <div v-for="c in row" :key="c.x" class="board-cell" :style="cellStyle(c, gridView.cellSize, gridView.fontSize)">
                <span v-if="c.emoji ?? c.glyph" style="pointer-events:none">{{ c.emoji ?? c.glyph }}</span>
                <div v-if="(c.emoji ?? c.glyph) && gridView.hpBarH && c.hp != null && c.maxHp"
                  :style="{ position:'absolute', bottom:'1px', left:'1px', right:'1px', height: gridView.hpBarH+'px', background:'#2224', borderRadius:'1px', overflow:'hidden' }">
                  <div :style="{ height:'100%', width: Math.round(hpPct(c)*100)+'%', background: hpColor(c) }"/>
                </div>
              </div>
            </template>
            <template v-if="gridView.xLabels">
              <div v-if="gridView.yLabels" style="background:#1a1a1a"/>
              <div v-for="lbl in gridView.xLabels" :key="lbl" class="axis-label"
                :style="{ fontSize: gridView.labelSize, color: '#888', display:'flex', alignItems:'center', justifyContent:'center', background:'#1a1a1a' }">
                {{ lbl }}
              </div>
            </template>
          </div>
        </div>
        <pre v-else class="board-pre">{{ session.rendered ?? '' }}</pre>
      </div>

      <div class="actions-card">
        <template v-if="isDone">
          <div class="card-title">Result</div>
          <div class="result-body">
            <div class="result-outcome">
              {{ session.result?.outcome === 'win' ? '🏆' : session.result?.outcome === 'draw' ? '🤝' : '❌' }}
            </div>
            <h3>
              {{ session.result?.outcome === 'win'
                ? `${players.find(p => p.id === session.result.winnerId)?.name ?? session.result.winnerId} wins!`
                : session.result?.outcome === 'draw' ? 'Draw' : session.status }}
            </h3>
            <p v-if="session.result?.reason" class="result-reason">{{ session.result.reason.replace(/-/g, ' ') }}</p>
            <button class="btn-primary result-btn" @click="exitSession">New Game</button>
          </div>
        </template>
        <template v-else-if="isMyTurn">
          <div class="card-title">Actions — {{ session.pendingPlayer }}</div>
          <div class="search-wrap">
            <input class="search-input" type="text" v-model="actionSearch"
              :placeholder="`Filter ${sessionActions.length} actions...`" />
          </div>
          <div class="action-grid">
            <button v-for="(a, i) in filteredActions.slice(0, 50)" :key="i" class="action-btn" @click="submitAction(a)">
              <span class="action-num">{{ i + 1 }}</span>
              <span class="action-text">{{ formatAction(a) }}</span>
            </button>
            <p v-if="filteredActions.length > 50" class="more">+{{ filteredActions.length - 50 }} more</p>
            <p v-else-if="!filteredActions.length && actionSearch.trim()" class="no-results">No actions match "{{ actionSearch }}"</p>
          </div>
        </template>
        <template v-else>
          <div class="card-title">Status</div>
          <div class="waiting">
            <div class="spinner"/>
            <p>{{ isWaitingForHuman
              ? `Waiting for ${players.find(p => p.id === session.pendingPlayer)?.name ?? session.pendingPlayer}...`
              : 'AI is thinking...' }}</p>
          </div>
        </template>
      </div>
    </main>
  </template>
</template>
