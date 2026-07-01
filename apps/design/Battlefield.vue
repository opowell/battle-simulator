<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import SchematicLayer    from './SchematicLayer.vue';
import GameHeader        from './battlefield/GameHeader.vue';
import SelectedUnitDetail from './battlefield/SelectedUnitDetail.vue';
import ActionsPanel      from './battlefield/ActionsPanel.vue';
import RosterPanel       from './battlefield/RosterPanel.vue';
import UnitsLostPanel    from './battlefield/UnitsLostPanel.vue';
import GameLog           from './battlefield/GameLog.vue';
import BottomBar         from './battlefield/BottomBar.vue';
import MenuOverlay       from './battlefield/MenuOverlay.vue';
import GameOverOverlay   from './battlefield/GameOverOverlay.vue';
import UnitInfoOverlay   from './battlefield/UnitInfoOverlay.vue';
import HelpOverlay       from './battlefield/HelpOverlay.vue';
import AbilityInfoOverlay from './battlefield/AbilityInfoOverlay.vue';

const props = defineProps({
  liveState:     Object,
  field:         Object,
  historyFields: { type: Array, default: () => [] },
  revealFields:  { type: Array, default: () => [] },
  revealLog:     { type: Array, default: () => [] },
  theme:         String,
  fog:           { type: Boolean, default: false },
  gamesCount:    { type: Number, default: 0 },
  serverErr:     { type: String, default: '' },
});
const emit = defineEmits(['exit', 'open-settings', 'submit-action']);

// ── playback ──────────────────────────────────────────────────
const tFloat  = ref(0);
const playing = ref(false);

// ── view toggles ──────────────────────────────────────────────
const showRuler = ref(false);
const showMenu  = ref(false);
const showHelp  = ref(false);

// ── selection ─────────────────────────────────────────────────
const selectedId = ref(null);

// ── game-over overlay ─────────────────────────────────────────
const dismissedResult = ref(false);

// ── reveal-all (finished fog games) ───────────────────────────
// When on, the full (unfiltered) board is shown so every piece's true position
// is visible; fog is still drawn, but from the perspective of whoever is to move
// at the displayed ply (it flips as you step through the game).
const revealAll = ref(false);
const canReveal = computed(() => props.fog && isDone.value && props.revealFields.length > 0);

// ── action history (back/forward replay) ──────────────────────
const fieldHistory = ref([]);
const histPos      = ref(0);
const histLength   = computed(() => revealAll.value ? props.revealFields.length : fieldHistory.value.length);
const atLatest     = computed(() => histPos.value >= histLength.value - 1);

watch(() => props.liveState?.id, () => {
  fieldHistory.value = props.field ? [props.field] : [];
  histPos.value = 0;
  dismissedResult.value = false;
  revealAll.value = false;
}, { immediate: true });

watch(() => props.historyFields, (h) => {
  if (h && h.length > 0) {
    fieldHistory.value = [...h];
    histPos.value = h.length - 1;
  }
});

watch(() => props.liveState?.log?.length ?? 0, (newLen, oldLen) => {
  if (oldLen === undefined || !props.field) return;
  fieldHistory.value = [...fieldHistory.value, props.field];
  if (histPos.value >= fieldHistory.value.length - 2) histPos.value = fieldHistory.value.length - 1;
});

// In fog mode the AI's move is stripped from the log, so the log-length watch above
// never fires when the AI responds. Instead, watch for the pendingPlayer switching
// from an AI player to a human player (the AI just finished), and refresh the latest
// history entry so the board reflects the post-AI-response state.
watch(() => props.liveState?.fog ? props.liveState?.pendingPlayer : null, (pending, prev) => {
  if (!prev) return; // initial fire or fog off — skip
  const humanPlayers = props.liveState?.humanPlayers ?? [];
  if (!humanPlayers.includes(pending)) return; // still AI's turn or game over
  if (humanPlayers.includes(prev))    return; // was already the human's turn (no-op)
  // AI → human transition: refresh the latest snapshot with the post-AI board.
  if (fieldHistory.value.length > 0 && props.field) {
    const updated = [...fieldHistory.value];
    updated[updated.length - 1] = props.field;
    fieldHistory.value = updated;
  }
});

const displayField = computed(() => {
  if (revealAll.value && props.revealFields.length)
    return props.revealFields[Math.min(histPos.value, props.revealFields.length - 1)];
  return fieldHistory.value.length > 0 ? fieldHistory.value[histPos.value] : props.field;
});

// Fog perspective in reveal mode: white is to move at even plies (ply 0 = initial
// position), black at odd plies — so the viewer flips as you step through the game.
const viewerTeam = computed(() => {
  if (!revealAll.value) return null;
  const teams = props.field.teams;
  return teams[histPos.value % 2]?.id ?? teams[0]?.id ?? null;
});

function toggleReveal() {
  revealAll.value = !revealAll.value;
  selectedId.value = null;
  histPos.value = Math.max(0, histLength.value - 1);
}

function goBack()    { if (histPos.value > 0)  histPos.value--; }
function goForward() { if (!atLatest.value)     histPos.value++; }

const winnerTeam = computed(() => {
  const winnerId = props.liveState?.result?.winnerId;
  if (!winnerId) return null;
  return props.field.teams.find(t => t.id === winnerId) ?? null;
});

const REASON_LABELS = {
  'all-units-eliminated': 'All units eliminated',
  'checkmate':            'Checkmate',
  'stalemate':            'Stalemate',
  'king-captured':        'King captured',
  'fifty-move-rule':      'Fifty-move rule',
  'max-turns':            'Turn limit reached',
  'step-limit':           'Turn limit reached',
  'no-legal-actions':     'No legal actions',
};

const reasonLabel = computed(() => {
  const r = props.liveState?.result?.reason;
  return REASON_LABELS[r] ?? r ?? '';
});

// ── unit info overlay ─────────────────────────────────────────
const infoUnit    = ref(null);
const infoAbility = ref(null);

function openInfo(u) {
  if (props.field.ui?.showUnitInfo === false) return;
  infoUnit.value = u;
}

function openAbilityInfo(ab) {
  infoAbility.value = typeof ab === 'string' ? { name: ab } : ab;
}

// ── stage sizing ──────────────────────────────────────────────
const stageEl = ref(null);
const stageW  = ref(900);
const stageH  = ref(600);

function updateStageSize() {
  if (stageEl.value) {
    stageW.value = stageEl.value.clientWidth;
    stageH.value = stageEl.value.clientHeight;
  }
}

// ── renderer palette ──────────────────────────────────────────
const rdr = computed(() => RDR[props.theme] || RDR.military);

// ── game UI flags ─────────────────────────────────────────────
const ui = computed(() => props.field.ui ?? {});

watch(() => props.liveState?.id, (id) => {
  if (id) showRuler.value = ui.value.showGrid ?? true;
}, { immediate: true });

// ── world → screen transform ──────────────────────────────────
const fit = computed(() => makeFitter(props.field.world, { w: stageW.value, h: stageH.value }, 24));

// ── live units at current time ────────────────────────────────
const units = computed(() => computeUnits(displayField.value, tFloat.value));

// ── live session helpers ──────────────────────────────────────
const isLive          = computed(() => !!props.liveState);
const isPending       = computed(() => isLive.value && props.liveState.pendingPlayer &&
                                      props.liveState.humanPlayers?.includes(props.liveState.pendingPlayer));
const isDone          = computed(() => isLive.value && props.liveState.status !== 'active');
const legalActions    = computed(() => props.liveState?.legalActions ?? []);
const pendingPlayerId = computed(() => props.liveState?.pendingPlayer ?? null);

// ── move highlights ───────────────────────────────────────────
const displayUnits = units;

const lastMoveSquares = computed(() => {
  if (revealAll.value) return []; // the live log's last move is meaningless while stepping history
  if (!ui.value.highlightLastMove) return [];
  const log = props.liveState?.log;
  if (!log?.length) return [];
  const lastEntry = log[log.length - 1];
  if (props.liveState?.fog) {
    const humanPlayers = props.liveState?.humanPlayers ?? [];
    const mover = lastEntry?.playerActions?.[0]?.playerId;
    if (mover && !humanPlayers.includes(mover)) return [];
  }
  const action = lastEntry?.playerActions?.[0]?.action;
  if (!action) return [];
  const squares = [];
  if (action.gridFrom) squares.push(action.gridFrom);
  if (action.gridTo)   squares.push(action.gridTo);
  return squares;
});

const displayLog = computed(() => {
  const log = props.liveState?.log ?? [];
  if (!props.liveState?.fog) return log;
  if (props.liveState?.debugAI) return log;
  const humanPlayers = props.liveState?.humanPlayers ?? [];
  return log.filter(entry => entry.playerActions?.every(pa => humanPlayers.includes(pa.playerId)));
});

// In reveal mode the whole game is exposed, so the log shows every move (both sides) and
// its entries align 1:1 with reveal plies — clicking one seeks to that ply (and flips fog).
const logForDisplay = computed(() => revealAll.value ? props.revealLog : displayLog.value);

function actionGridCoord(action, field) {
  if (field === 'to')   return action.gridTo   ?? (action.to?.x   != null ? [action.to.x,   action.to.y]   : null);
  if (field === 'from') return action.gridFrom ?? (action.from?.x != null ? [action.from.x, action.from.y] : null);
  return null;
}

const unitMoves = computed(() => {
  if (!isPending.value || !selectedId.value) return [];
  return legalActions.value
    .filter(a => a.unitId === selectedId.value)
    .map(a => actionGridCoord(a, 'to'))
    .filter(Boolean);
});

const activeUnitId = computed(() => {
  if (!isPending.value) return null;
  if (ui.value.freeSelection) return null;
  return legalActions.value.find(a => a.unitId)?.unitId ?? null;
});

watch(activeUnitId, (id) => {
  if (id) selectedId.value = id;
}, { immediate: true });

function handleSqClick(col, row) {
  if (isPending.value && selectedId.value) {
    const action = legalActions.value.find(a => {
      if (a.unitId !== selectedId.value) return false;
      const coords = actionGridCoord(a, 'to');
      return coords && coords[0] === col && coords[1] === row;
    });
    if (action) { submitAction(action); return; }
  }
  selectedId.value = null;
}

const selectedUnit = computed(() => displayUnits.value.find(u => u.id === selectedId.value) || null);

// ── roster groups ─────────────────────────────────────────────
const rosterTeams = computed(() =>
  props.field.teams.map(t => ({
    ...t,
    units: displayUnits.value.filter(u => u.team === t.id),
  }))
);

// ── units lost tracking ───────────────────────────────────────
const everSeenUnits = ref({});

watch(() => props.liveState?.id, () => {
  everSeenUnits.value = {};
}, { immediate: true });

watch(displayUnits, (units) => {
  let changed = false;
  const updated = { ...everSeenUnits.value };
  for (const u of units) {
    if (!updated[u.id]) {
      updated[u.id] = { id: u.id, name: u.name, team: u.team, type: u.type };
      changed = true;
    }
  }
  if (changed) everSeenUnits.value = updated;
}, { immediate: true });

const lostUnitsTeams = computed(() => {
  const currentIds = new Set(displayUnits.value.map(u => u.id));
  const lost = [];
  for (const [id, unit] of Object.entries(everSeenUnits.value)) {
    if (!currentIds.has(id)) lost.push(unit);
  }
  return props.field.teams.map(t => ({
    ...t,
    units: lost.filter(u => u.team === t.id),
  }));
});

const displayedActions = computed(() => {
  if (ui.value.freeSelection) {
    return legalActions.value.filter(a => a.unitId === selectedId.value && !actionGridCoord(a, 'to'));
  }
  if (unitMoves.value.length > 0)
    return legalActions.value.filter(a => a.type !== 'move');
  return legalActions.value;
});

function submitAction(action) {
  if (ui.value.clearSelectedAtEndOfTurn) selectedId.value = null;
  emit('submit-action', { playerId: pendingPlayerId.value, action });
}

// ── playback RAF ──────────────────────────────────────────────
const PLAY_SPEED = 0.7;
let rafId = null;
let lastTs = 0;

function raf(ts) {
  if (playing.value && props.field.turns > 1) {
    const dt   = Math.min((ts - lastTs) / 1000, 0.1);
    const next = tFloat.value + dt * PLAY_SPEED;
    if (next >= props.field.turns - 1) {
      tFloat.value = props.field.turns - 1;
      playing.value = false;
    } else {
      tFloat.value = next;
    }
  }
  lastTs = ts;
  rafId = requestAnimationFrame(raf);
}

function togglePlay() {
  if (tFloat.value >= props.field.turns - 1) tFloat.value = 0;
  playing.value = !playing.value;
}

function stepBack() {
  playing.value = false;
  tFloat.value = Math.max(0, Math.floor(tFloat.value) - 1);
}

function stepFwd() {
  playing.value = false;
  tFloat.value = Math.min(props.field.turns - 1, Math.floor(tFloat.value) + 1);
}

function scrub(e) {
  playing.value = false;
  tFloat.value = parseFloat(e.target.value);
}

function onKeyDown(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'Escape') {
    if (infoAbility.value)      infoAbility.value = null;
    else if (infoUnit.value)    infoUnit.value = null;
    else if (showHelp.value)    showHelp.value = false;
    else showMenu.value = !showMenu.value;
  } else if (e.key === 'ArrowLeft')  goBack();
  else if (e.key === 'ArrowRight') goForward();
}

onMounted(() => {
  lastTs = performance.now();
  rafId = requestAnimationFrame(raf);
  updateStageSize();
  window.addEventListener('resize', updateStageSize);
  window.addEventListener('keydown', onKeyDown);
});

onUnmounted(() => {
  cancelAnimationFrame(rafId);
  window.removeEventListener('resize', updateStageSize);
  window.removeEventListener('keydown', onKeyDown);
});
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">

    <div style="flex:1;min-height:0;display:flex;overflow:hidden">

      <!-- Left panel -->
      <div style="width:240px;min-height:0;overflow-y:auto;border-right:1px solid var(--line);display:flex;flex-direction:column;background:var(--bg1)">
        <GameHeader
          :field="field" :liveState="liveState" :isLive="isLive"
          :isDone="isDone" :isPending="isPending" :pendingPlayerId="pendingPlayerId"
          :showMenu="showMenu" :ui="ui"
          @toggle-menu="showMenu = !showMenu"
          @show-help="showHelp = true"/>

        <SelectedUnitDetail v-if="selectedUnit"
          :unit="selectedUnit" :field="field" :rdr="rdr"
          @open-info="openInfo"
          @open-ability-info="openAbilityInfo"/>
        <div v-else style="padding:12px 14px;font-size:11px;color:var(--faint)">
          Select a unit to view details.
        </div>

        <ActionsPanel v-if="isLive"
          :isDone="isDone" :atLatest="atLatest" :isPending="isPending"
          :selectedId="selectedId" :activeUnitId="activeUnitId" :ui="ui"
          :unitMoves="unitMoves" :displayedActions="displayedActions"
          :pendingPlayerId="pendingPlayerId" :liveState="liveState" :units="displayUnits"
          @submit="submitAction"/>
      </div>

      <!-- Stage -->
      <div ref="stageEl" style="flex:1;position:relative;overflow:hidden">
        <SchematicLayer
          :field="displayField" :fit="fit" :units="displayUnits"
          :selectedId="selectedId" :activeUnitId="activeUnitId" :fog="fog"
          :showRuler="showRuler" :rdr="rdr"
          :legalSquares="unitMoves"
          :lastMoveSquares="lastMoveSquares"
          :dragToMove="ui.dragToMove ?? false"
          :revealAll="revealAll" :viewerTeam="viewerTeam"
          @select="id => selectedId = id"
          @sq-click="handleSqClick"/>
      </div>

      <!-- Right sidebar -->
      <div style="width:240px;min-height:0;overflow-y:auto;border-left:1px solid var(--line);display:flex;flex-direction:column;background:var(--bg1)">
        <RosterPanel v-if="ui.showRoster !== false"
          :teams="rosterTeams" :selectedId="selectedId" :rdr="rdr" :field="field"
          @select="id => selectedId = id"/>

        <UnitsLostPanel v-if="ui.showUnitsLost"
          :teams="lostUnitsTeams"/>

        <GameLog v-if="isLive"
          :log="logForDisplay" :historyLength="histLength" :histPos="histPos"
          :units="displayUnits"
          @seek="pos => histPos = pos"/>
      </div>
    </div>

    <BottomBar
      :isLive="isLive" :field="field" :tFloat="tFloat" :playing="playing"
      :histPos="histPos" :histLength="histLength" :atLatest="atLatest"
      :liveState="liveState" :isDone="isDone" :isPending="isPending"
      :pendingPlayerId="pendingPlayerId"
      :canReveal="canReveal" :revealAll="revealAll"
      @step-back="stepBack" @step-fwd="stepFwd" @toggle-play="togglePlay"
      @scrub="scrub" @go-back="goBack" @go-forward="goForward"
      @toggle-reveal="toggleReveal"/>
  </div>

  <MenuOverlay
    :show="showMenu" :serverErr="serverErr" :gamesCount="gamesCount" :showRuler="showRuler"
    @close="showMenu = false"
    @exit="$emit('exit')"
    @open-settings="$emit('open-settings')"
    @toggle-ruler="showRuler = !showRuler"/>

  <GameOverOverlay
    :isDone="isDone" :dismissed="dismissedResult" :liveState="liveState"
    :winnerTeam="winnerTeam" :reasonLabel="reasonLabel" :field="field"
    @dismiss="dismissedResult = true"
    @exit="$emit('exit')"/>

  <UnitInfoOverlay
    :unit="infoUnit"
    @close="infoUnit = null"
    @open-ability-info="openAbilityInfo"/>

  <HelpOverlay
    :show="showHelp" :ui="ui" :game="field.game"
    @close="showHelp = false"/>

  <AbilityInfoOverlay
    :ability="infoAbility"
    @close="infoAbility = null"/>
</template>
