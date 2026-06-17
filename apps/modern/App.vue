<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue';
import { BattleSimClient } from '@battle-sim/api-client';

const ACCENT_PRESETS = [
  { name: 'Indigo', accent: '#4f46e5', hover: '#4338ca', light: '#eef2ff' },
  { name: 'Blue',   accent: '#2563eb', hover: '#1d4ed8', light: '#eff6ff' },
  { name: 'Teal',   accent: '#0d9488', hover: '#0f766e', light: '#f0fdfa' },
  { name: 'Green',  accent: '#16a34a', hover: '#15803d', light: '#f0fdf4' },
  { name: 'Rose',   accent: '#e11d48', hover: '#be123c', light: '#fff1f2' },
  { name: 'Orange', accent: '#ea580c', hover: '#c2410c', light: '#fff7ed' },
];

const LIGHT_VARS = {
  '--bg': '#f8fafc', '--surface': '#ffffff', '--surface-2': '#fafbfc',
  '--border': '#e2e8f0', '--text': '#0f172a', '--text-2': '#334155', '--muted': '#64748b',
};
const DARK_VARS = {
  '--bg': '#0f172a', '--surface': '#1e293b', '--surface-2': '#263045',
  '--border': '#334155', '--text': '#f1f5f9', '--text-2': '#cbd5e1', '--muted': '#94a3b8',
};

// Offered for every game, regardless of what the game itself declares via gameOptions.
// A game can override the default via `ui.<id>` (e.g. FFTA sets ui.moveAnimation = 'hop').
const GENERAL_GAME_OPTIONS = [
  {
    id: 'moveAnimation', label: 'Move Animation', type: 'select',
    description: 'How units animate when moving across the board',
    default: 'none',
    choices: [
      { value: 'none', label: 'None' },
      { value: 'hop', label: 'Hop' },
      { value: 'slide', label: 'Slide' },
    ],
  },
];

const client = new BattleSimClient();
const screen = ref('main');
const theme = ref({ accent: '#4f46e5', mode: 'light' });

function applyTheme() {
  const root = document.documentElement;
  const preset = ACCENT_PRESETS.find(p => p.accent === theme.value.accent) ?? ACCENT_PRESETS[0];
  root.style.setProperty('--accent', preset.accent);
  root.style.setProperty('--accent-hover', preset.hover);
  root.style.setProperty('--accent-light', preset.light);
  const modeVars = theme.value.mode === 'dark' ? DARK_VARS : LIGHT_VARS;
  for (const [k, v] of Object.entries(modeVars)) root.style.setProperty(k, v);
}

watch(theme, (t) => {
  applyTheme();
  localStorage.setItem('battleSim_theme', JSON.stringify(t));
}, { deep: true });

const games = ref([]);
const sessions = ref([]);
const pendingGame = ref(null);
const pendingPlayers = ref([]);
const pendingScenario = ref(null);
const pendingOptions = ref({});
const session = ref(null);
const players = ref([]);
const myPlayerId = ref(null);
const error = ref(null);
const actionSearch = ref('');
let pollTimer = null;

const selectedUnitId = ref(null);
const animCells = ref({});   // "x,y" → { flash: 'hit'|'heal' }
const movingSprite = ref(null); // { unitId, glyph, color, shadow, path, step }
const failedImages = reactive({}); // imagePath → true when load failed
const moveAnimation = ref('none'); // 'none' | 'hop' | 'slide' — resolved for the active session
let spriteTimer = null;

function buildMovePath(from, to) {
  const path = [{ ...from }];
  let { x, y } = from;
  while (x !== to.x) { x += to.x > x ? 1 : -1; path.push({ x, y }); }
  while (y !== to.y) { y += to.y > y ? 1 : -1; path.push({ x, y }); }
  return path;
}

function advanceSprite() {
  if (!movingSprite.value) return;
  const next = movingSprite.value.step + 1;
  if (next >= movingSprite.value.path.length) { movingSprite.value = null; return; }
  movingSprite.value = { ...movingSprite.value, step: next };
  spriteTimer = setTimeout(advanceSprite, 210);
}

const spriteStyle = computed(() => {
  if (!movingSprite.value || !gridView.value) return null;
  const { x, y } = movingSprite.value.path[movingSprite.value.step];
  const cs = gridView.value.cellSize;
  const labelW = gridView.value.yLabels ? Math.ceil(cs * 0.6) + 1 : 0;
  return {
    position: 'absolute',
    left: (1 + labelW + x * (cs + 1)) + 'px',
    top:  (1 + y * (cs + 1)) + 'px',
    width: cs + 'px', height: cs + 'px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: '700', fontFamily: "'Segoe UI', sans-serif", lineHeight: '1',
    fontSize: gridView.value.fontSize + 'px',
    color: movingSprite.value.color,
    textShadow: movingSprite.value.shadow + ', 0 1px 2px rgba(0,0,0,0.7)',
    pointerEvents: 'none', zIndex: 10, userSelect: 'none',
    transition: 'left 200ms ease, top 200ms ease',
  };
});

watch(session, (newSess, oldSess) => {
  if (!newSess?.grid?.cells || !oldSess?.grid?.cells) return;
  const lastActions = newSess?.lastActions ?? [];
  if (!lastActions.length) return;

  const oldPos = {}, oldHp = {};
  for (const c of oldSess.grid.cells) {
    if (c.unitId) { oldPos[c.unitId] = { x: c.x, y: c.y }; if (c.hp != null) oldHp[c.unitId] = c.hp; }
  }

  const newAnim = {};
  for (const { action } of lastActions) {
    if (action.type === 'move') {
      if (moveAnimation.value === 'none') continue;
      const old = oldPos[action.unitId];
      if (old && (old.x !== action.to.x || old.y !== action.to.y)) {
        const src = oldSess.grid.cells.find(c => c.unitId === action.unitId);
        clearTimeout(spriteTimer);
        movingSprite.value = {
          unitId: action.unitId,
          glyph: src?.emoji ?? src?.glyph ?? '?',
          color: OWNER_COLOR[src?.owner ?? 0],
          shadow: OWNER_SHADOW[src?.owner ?? 0],
          path: buildMovePath(old, action.to),
          step: 0,
        };
        spriteTimer = setTimeout(advanceSprite, 210);
      }
    } else if (action.type === 'ability') {
      const targetCell = newSess.grid.cells.find(c => c.unitId === action.targetId);
      if (targetCell) {
        const type = (oldHp[action.targetId] != null && targetCell.hp > oldHp[action.targetId]) ? 'heal' : 'hit';
        newAnim[`${targetCell.x},${targetCell.y}`] = { flash: type };
      }
    }
  }

  if (Object.keys(newAnim).length) {
    animCells.value = newAnim;
    setTimeout(() => { animCells.value = {}; }, 500);
  }
});

const activeUnitId = computed(() => {
  const cells = session.value?.grid?.cells;
  if (!cells) return null;
  return cells.find(c => c.isActive)?.unitId ?? null;
});

watch(activeUnitId, (id) => {
  if (id) selectedUnitId.value = id;
}, { immediate: true });

const selectedCell = computed(() => {
  if (!gridView.value || !selectedUnitId.value) return null;
  for (const row of gridView.value.rows) {
    for (const c of row) {
      if (c.unitId === selectedUnitId.value) return c;
    }
  }
  return null;
});

const selectedIsActive = computed(() => selectedCell.value?.isActive ?? false);

const overlayMap = computed(() => {
  if (!isMyTurn.value) return {};
  const cells = session.value?.grid?.cells ?? [];
  const unitPos = {};
  for (const c of cells) if (c.unitId) unitPos[c.unitId] = { x: c.x, y: c.y };
  const map = {};
  for (const a of sessionActions.value) {
    if (a.type === 'move') {
      map[`${a.to.x},${a.to.y}`] = 'move';
    } else if (a.type === 'ability') {
      const pos = unitPos[a.targetId];
      if (pos) map[`${pos.x},${pos.y}`] = 'ability';
    }
  }
  return map;
});

const OWNER_COLOR = ['#9a8878', '#3b82f6', '#ef4444'];
const OWNER_SHADOW = ['none', '0 0 6px rgba(59,130,246,0.8)', '0 0 6px rgba(239,68,68,0.8)'];

function gameMeta(name) {
  return {
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
const allGameOptions = computed(() => {
  if (!pendingGame.value) return [];
  return [...GENERAL_GAME_OPTIONS, ...(pendingGame.value.gameOptions ?? [])];
});

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

watch(isMyTurn, (myTurn, wasMyTurn) => {
  if (wasMyTurn && !myTurn && !activeUnitId.value) selectedUnitId.value = null;
});
const sessionLog = computed(() => session.value?.log ?? []);
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

function playerName(id) {
  return players.value.find(p => p.id === id)?.name ?? id;
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

function genreColor(_meta) { return '#64748b'; }

async function init() {
  const savedTheme = localStorage.getItem('battleSim_theme');
  if (savedTheme) theme.value = { ...theme.value, ...JSON.parse(savedTheme) };
  applyTheme();
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
      moveAnimation.value = localStorage.getItem(`battleSim_${sessionParam}_moveAnim`) ?? game?.ui?.moveAnimation ?? 'none';
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
  const optionDefs = [...GENERAL_GAME_OPTIONS, ...(game.gameOptions ?? [])];
  const opts = {};
  for (const opt of optionDefs) {
    opts[opt.id] = game.ui?.[opt.id] ?? opt.default ?? false;
  }
  pendingOptions.value = opts;
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
    const config = { ...(pendingScenario.value?.config ?? {}), ...pendingOptions.value };
    session.value = await client.createSession(name, pls, config);
    const firstHuman = pls.find(p => p.agent === 'human');
    myPlayerId.value = firstHuman?.id ?? null;
    if (myPlayerId.value) localStorage.setItem(`battleSim_${session.value.id}_player`, myPlayerId.value);
    moveAnimation.value = pendingOptions.value.moveAnimation ?? 'none';
    localStorage.setItem(`battleSim_${session.value.id}_moveAnim`, moveAnimation.value);
    pendingGame.value = null;
    pendingPlayers.value = [];
    pendingScenario.value = null;
    pendingOptions.value = {};
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
    moveAnimation.value = localStorage.getItem(`battleSim_${id}_moveAnim`) ?? game?.ui?.moveAnimation ?? 'none';
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
  localStorage.removeItem(`battleSim_${id}_moveAnim`);
  sessions.value = sessions.value.filter(s => s.id !== id);
  client.deleteSession(id).catch(() => {});
  session.value = null;
  players.value = [];
  myPlayerId.value = null;
  screen.value = 'main';
  actionSearch.value = '';
}

onMounted(init);
onUnmounted(() => {
  clearInterval(pollTimer);
});
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
      <button class="btn-icon" @click="screen = 'settings'" title="Settings">⚙</button>
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
        <div v-if="allGameOptions.length" class="config-options">
          <h3 class="config-section-label">Options</h3>
          <div v-for="opt in allGameOptions" :key="opt.id" class="config-option-row">
            <div class="config-option-info">
              <span class="config-option-label">{{ opt.label }}</span>
              <span v-if="opt.description" class="config-option-desc">{{ opt.description }}</span>
            </div>
            <template v-if="opt.type === 'boolean'">
              <button :class="['option-toggle', pendingOptions[opt.id] ? 'on' : 'off']"
                @click="pendingOptions[opt.id] = !pendingOptions[opt.id]">
                {{ pendingOptions[opt.id] ? 'On' : 'Off' }}
              </button>
            </template>
            <template v-else-if="opt.type === 'integer'">
              <input class="option-int-input" type="number"
                :min="opt.min" :max="opt.max" :step="opt.step ?? 1"
                :value="pendingOptions[opt.id]"
                @input="pendingOptions[opt.id] = parseInt($event.target.value) || opt.default" />
            </template>
            <template v-else-if="opt.type === 'select'">
              <select class="option-select" :value="pendingOptions[opt.id]"
                @change="pendingOptions[opt.id] = $event.target.value">
                <option v-for="choice in opt.choices" :key="choice.value" :value="choice.value">{{ choice.label }}</option>
              </select>
            </template>
          </div>
        </div>
        <div v-if="humanCount > 1" class="mp-notice">
          Multiplayer mode — you'll get a shareable link for each other player.
        </div>
        <button class="btn-primary btn-launch" @click="launchGame">Start Game →</button>
      </div>
    </div>
  </template>

  <!-- Settings -->
  <template v-else-if="screen === 'settings'">
    <header class="topbar">
      <div class="topbar-left">
        <button class="btn-back" @click="screen = 'main'">← Back</button>
        <div class="topbar-brand">
          <h1>Settings</h1>
        </div>
      </div>
    </header>
    <div class="settings-screen">
      <div class="settings-card">
        <section class="settings-section">
          <h3 class="settings-section-label">Accent Color</h3>
          <div class="color-swatches">
            <button v-for="p in ACCENT_PRESETS" :key="p.accent"
              :class="['color-swatch', theme.accent === p.accent && 'selected']"
              :style="{ background: p.accent }"
              :title="p.name"
              @click="theme.accent = p.accent" />
          </div>
        </section>
        <section class="settings-section">
          <h3 class="settings-section-label">Appearance</h3>
          <div class="mode-buttons">
            <button :class="['mode-btn', theme.mode === 'light' && 'active']" @click="theme.mode = 'light'">☀ Light</button>
            <button :class="['mode-btn', theme.mode === 'dark' && 'active']" @click="theme.mode = 'dark'">☾ Dark</button>
          </div>
        </section>
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
          <div style="position: relative; display: inline-block;">
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
                <div v-for="c in row" :key="c.x" class="board-cell"
                  :style="cellStyle(c, gridView.cellSize, gridView.fontSize)"
                  :class="{ 'cell-active': c.isActive, 'cell-selected': c.unitId && c.unitId === selectedUnitId && !c.isActive }"
                  @click="c.unitId && (selectedUnitId = c.unitId)">
                  <div v-if="overlayMap[`${c.x},${c.y}`]" class="cell-overlay"
                    :class="overlayMap[`${c.x},${c.y}`] === 'move' ? 'overlay-move' : 'overlay-ability'"/>
                  <template v-if="movingSprite?.unitId !== c.unitId">
                    <img v-if="c.imagePath && !failedImages[c.imagePath]"
                      :src="c.imagePath" :alt="c.glyph ?? ''"
                      class="cell-unit-img"
                      @error="failedImages[c.imagePath] = true" />
                    <span v-else-if="c.emoji ?? c.glyph"
                      style="pointer-events:none; position:relative; z-index:1">{{ c.emoji ?? c.glyph }}</span>
                  </template>
                  <div v-if="animCells[`${c.x},${c.y}`]?.flash"
                    class="cell-flash-overlay"
                    :class="`cell-flash-${animCells[`${c.x},${c.y}`].flash}`"/>
                  <div v-if="(c.emoji ?? c.glyph) && gridView.hpBarH && c.hp != null && c.maxHp"
                    :style="{ position:'absolute', bottom:'1px', left:'1px', right:'1px', height: gridView.hpBarH+'px', background:'#2224', borderRadius:'1px', overflow:'hidden', zIndex: 1 }">
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
            <!-- Moving unit sprite: slides between cells always; hops only when moveAnimation === 'hop' -->
            <div v-if="movingSprite && spriteStyle" class="unit-sprite"
              :class="{ 'unit-sprite-hop': moveAnimation === 'hop' }" :style="spriteStyle">
              {{ movingSprite.glyph }}
            </div>
          </div>
        </div>
        <pre v-else class="board-pre">{{ session.rendered ?? '' }}</pre>
      </div>

      <div class=”actions-card”>
        <div class=”actions-main”>
          <!-- Unit info for selected unit (active or not) -->
          <template v-if="selectedCell && selectedCell.unitName">
            <div class="card-title unit-card-title">
              {{ selectedCell.unitName }}
              <span v-if="selectedCell.isActive" class="active-badge">▶ Active</span>
            </div>
            <div v-if="(selectedCell.portraitPath || selectedCell.imagePath) && !failedImages[selectedCell.portraitPath ?? selectedCell.imagePath]" class="unit-portrait-wrap">
              <img :src="selectedCell.portraitPath ?? selectedCell.imagePath" :alt="selectedCell.unitName"
                class="unit-portrait"
                @error="failedImages[selectedCell.portraitPath ?? selectedCell.imagePath] = true" />
            </div>
            <div class="unit-info-panel">
              <div class="unit-resource-row">
                <span class="unit-res-label">HP</span>
                <div class="unit-bar-track"><div class="unit-bar-fill" :style="{ width: Math.round(hpPct(selectedCell)*100)+'%', background: hpColor(selectedCell) }"/></div>
                <span class="unit-res-val">{{ selectedCell.hp }}/{{ selectedCell.maxHp }}</span>
              </div>
              <div class="unit-resource-row">
                <span class="unit-res-label">MP</span>
                <div class="unit-bar-track"><div class="unit-bar-fill" :style="{ width: Math.round((selectedCell.mp/selectedCell.maxMp)*100)+'%', background:'#818cf8' }"/></div>
                <span class="unit-res-val">{{ selectedCell.mp }}/{{ selectedCell.maxMp }}</span>
              </div>
              <div v-if="selectedCell.stats" class="unit-stat-grid">
                <span v-for="(val, key) in selectedCell.stats" :key="key" class="unit-stat-chip">{{ key }}: {{ val }}</span>
              </div>
              <div v-if="selectedCell.abilities?.length" class="unit-ability-list">
                <span v-for="ab in selectedCell.abilities" :key="ab.key" class="unit-ability-chip">{{ ab.name }}</span>
              </div>
              <div v-if="selectedCell.reaction || selectedCell.support" class="unit-passive-row">
                <span v-if="selectedCell.reaction" class="unit-passive-chip reaction-chip" :title="'Reaction: triggers automatically when hit'">↩ {{ selectedCell.reaction.name }}</span>
                <span v-if="selectedCell.support"  class="unit-passive-chip support-chip"  :title="'Support: always active passive bonus'">✦ {{ selectedCell.support.name }}</span>
              </div>
              <div v-if="selectedCell.statusEffects?.length" class="unit-status-row">{{ selectedCell.statusEffects.join(' · ') }}</div>
              <div class="unit-flag-row">
                <span :class="['unit-flag', selectedCell.moved ? 'flag-spent' : 'flag-ready']">Move</span>
                <span :class="['unit-flag', selectedCell.acted ? 'flag-spent' : 'flag-ready']">Act</span>
              </div>
            </div>
          </template>

          <!-- Actions / result / waiting -->
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
          <template v-else-if="isMyTurn && selectedIsActive">
            <div class="card-title">Actions</div>
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
          <template v-else-if="isMyTurn">
            <div class="hint-text">Click the active unit (▶) on the board to see actions.</div>
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

        <div v-if="sessionLog.length" class="log-panel">
          <div class="card-title">Log</div>
          <div class="log-entries">
            <div v-for="entry in [...sessionLog].reverse()" :key="entry.turnNumber" class="log-entry">
              <span class="log-turn">T{{ entry.turnNumber }}</span>
              <span class="log-actions">
                <span v-for="(pa, i) in entry.playerActions" :key="i" class="log-action">
                  <span class="log-player">{{ playerName(pa.playerId) }}</span>{{ session.fog && myPlayerId && pa.playerId !== myPlayerId ? '?' : formatAction(pa.action) }}
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </main>
  </template>
</template>

<style scoped>
/* Game options */
.config-options { margin-top: 16px; }
.config-option-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; padding: 8px 0;
  border-bottom: 1px solid var(--border);
}
.config-option-row:last-child { border-bottom: none; }
.config-option-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.config-option-label { font-size: 0.88em; font-weight: 600; color: var(--text); }
.config-option-desc  { font-size: 0.75em; color: var(--muted); }
.option-toggle {
  flex-shrink: 0; min-width: 48px; padding: 3px 10px;
  border-radius: 12px; border: 1px solid transparent;
  font-size: 0.8em; font-weight: 600; cursor: pointer; transition: all 0.15s;
}
.option-toggle.on  { background: var(--accent); color: #fff; border-color: var(--accent); }
.option-toggle.off { background: var(--surface-2); color: var(--muted); border-color: var(--border); }
.option-int-input {
  width: 80px; padding: 4px 8px; border-radius: 6px;
  border: 1px solid var(--border); background: var(--surface-2);
  color: var(--text); font-size: 0.85em; text-align: right;
}
.option-select {
  padding: 4px 8px; border-radius: 6px;
  border: 1px solid var(--border); background: var(--surface-2);
  color: var(--text); font-size: 0.85em;
}

/* Board cell states */
.board-cell { cursor: pointer; }
.cell-active   { box-shadow: inset 0 0 0 2px #facc15; }
.cell-selected { box-shadow: inset 0 0 0 2px rgba(255,255,255,0.7); }

/* Unit images in board cells */
.cell-unit-img {
  width: 82%; height: 82%;
  object-fit: contain;
  image-rendering: pixelated;
  pointer-events: none;
  position: relative; z-index: 1;
}

/* Unit portrait in side panel */
.unit-portrait-wrap {
  display: flex; justify-content: center;
  padding: 6px 0 2px;
}
.unit-portrait {
  width: 80px; height: 80px;
  object-fit: contain;
  image-rendering: pixelated;
  border-radius: 4px;
}

/* Range overlays */
.cell-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}
.overlay-move    { background: rgba(59, 130, 246, 0.28); }
.overlay-ability { background: rgba(239, 68, 68, 0.28); }

/* Unit info panel */
.unit-card-title { display: flex; align-items: center; gap: 6px; }
.active-badge {
  font-size: 0.7em; font-weight: 600; color: #facc15;
  background: rgba(250,204,21,0.12); border: 1px solid rgba(250,204,21,0.35);
  border-radius: 4px; padding: 1px 5px;
}
.unit-info-panel {
  padding: 6px 12px 10px;
  border-bottom: 1px solid rgba(255,255,255,0.07);
  margin-bottom: 4px;
}
.unit-resource-row { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.unit-res-label { font-size: 0.7em; color: #888; width: 18px; flex-shrink: 0; }
.unit-bar-track { flex: 1; height: 5px; background: #2a2a2a; border-radius: 3px; overflow: hidden; }
.unit-bar-fill  { height: 100%; border-radius: 3px; transition: width 0.2s; }
.unit-res-val   { font-size: 0.7em; color: #aaa; width: 44px; text-align: right; flex-shrink: 0; }

.unit-stat-grid    { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0 4px; }
.unit-stat-chip    { font-size: 0.68em; color: #bbb; background: rgba(255,255,255,0.06); border-radius: 3px; padding: 1px 5px; }

.unit-ability-list { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
.unit-ability-chip { font-size: 0.68em; color: #93c5fd; background: rgba(59,130,246,0.1); border-radius: 3px; padding: 1px 5px; }

.unit-passive-row { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
.unit-passive-chip { font-size: 0.68em; border-radius: 3px; padding: 1px 5px; cursor: default; }
.reaction-chip { color: #f9a8d4; background: rgba(236,72,153,0.1); }
.support-chip  { color: #86efac; background: rgba(34,197,94,0.1); }

.unit-status-row { font-size: 0.68em; color: #f97316; margin-bottom: 4px; }

.unit-flag-row { display: flex; gap: 5px; margin-top: 2px; }
.unit-flag     { font-size: 0.65em; font-weight: 600; border-radius: 3px; padding: 1px 6px; }
.flag-ready    { background: rgba(74,222,128,0.15); color: #4ade80; border: 1px solid rgba(74,222,128,0.3); }
.flag-spent    { background: rgba(100,100,100,0.15); color: #666; border: 1px solid rgba(100,100,100,0.2); text-decoration: line-through; }

.hint-text { padding: 12px; color: #666; font-size: 0.82em; font-style: italic; }

/* Movement sprite: hop adds a bounce on top of the slide transition in spriteStyle */
.unit-sprite-hop { animation: sprite-hop 0.21s ease-in-out infinite alternate; }
@keyframes sprite-hop { from { transform: translateY(0) scale(1); } to { transform: translateY(-30%) scale(1.1); } }

/* Ability flash overlay */
.cell-flash-overlay { position: absolute; inset: 0; z-index: 2; pointer-events: none; border-radius: 1px; }
@keyframes flash-hit  { 0%, 100% { opacity: 0; } 25% { opacity: 0.75; } }
@keyframes flash-heal { 0%, 100% { opacity: 0; } 25% { opacity: 0.65; } }
.cell-flash-hit  { background: #ef4444; animation: flash-hit  0.45s ease-out; }
.cell-flash-heal { background: #4ade80; animation: flash-heal 0.45s ease-out; }
</style>
