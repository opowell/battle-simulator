<script setup>
import { ref, shallowRef, computed, watch, onMounted, onUnmounted } from 'vue';
import AnalysisCandidateList from './AnalysisCandidateList.vue';

// Live/replay "what's good here" panel: pick an AI, see its ranked move
// suggestions for the position currently on screen, with live search progress
// (Stockfish "depth N/14", Obscuro "round N/30" — mirrors lichess's ticking
// depth indicator). For the live position, when the game/agent opt in (see
// `useWorker` below), this runs entirely client-side via a Web Worker
// (apps/design/analysis-worker.js); otherwise it streams over SSE from GET
// /sessions/:id/analyze-stream (see api-server.js's handleAnalyzeStream /
// api.js's analyzeStream). Gated by the game's `showAnalysisPanel` option
// (default true for chess) — `enabled=false` renders nothing.
const props = defineProps({
  enabled:   { type: Boolean, default: false },
  sessionId: { type: String, default: null },
  gameName:  { type: String, default: null },
  playerId:  { type: String, default: null }, // the human viewer's own colour/seat
  ply:       { type: Number, default: null }, // null = analyze the live position
  // Bumps to re-trigger a re-analysis while at the live ply. Battlefield.vue passes
  // liveState.turn, NOT log.length — under fog the opponent's move is stripped from
  // the log (see api-server.js's fogFilter), so log.length never changes when a
  // hidden reply lands and a log-length-keyed revision would leave this panel showing
  // stale pre-reply suggestions; turnNumber always advances regardless of fog.
  logRevision: { type: Number, default: 0 },
  fog:       { type: Boolean, default: false },
});
const emit = defineEmits(['hover-move', 'select-move', 'candidates']);

// ── AI roster (which agents this game's server side can analyze with) ──────
// shallowRef, not ref: these plain data objects get passed to the analysis
// Worker via postMessage, which structured-clones its argument — a reactive
// Proxy (what a deep `ref` would wrap them in) can't be cloned and throws.
const agents = shallowRef([]);
// { module, export } pointer for deriving legal actions client-side — the
// counterpart to each agent's own `clientAnalyze` pointer below. Null for
// games that haven't opted into client-side analysis (falls back to SSE).
const clientGame = shallowRef(null);
onMounted(async () => {
  try {
    const games = await api.games();
    const g = games.find(g => g.name === props.gameName);
    agents.value = (g?.agents ?? []).filter(a => a.analyzable);
    clientGame.value = g?.clientGame ?? null;
  } catch { agents.value = []; clientGame.value = null; }
});
const selectedAgentId = ref('obscuro');
const currentAgent = computed(() => agents.value.find(a => a.id === selectedAgentId.value) ?? null);
watch(agents, (list) => {
  if (!list.some(a => a.id === selectedAgentId.value)) selectedAgentId.value = list[0]?.id ?? null;
});

// ── on/off + pause/resume ────────────────────────────────────────────────
const panelOn = ref(true);
const paused  = ref(false);

// ── candidates + live progress ──────────────────────────────────────────
const candidates = ref([]);
const loading    = ref(false);
const errorMsg   = ref('');
const hoveredIdx = ref(-1);
// The latest progress tick from the stream, already formatted ("Depth 8/14",
// "Round 12/30" — see progressLabel below), or null once the final result has
// landed (or before anything's started).
const progress = ref(null);

const fmtNum = (n) => (n ?? 0).toLocaleString();

function progressLabel(data) {
  if (data.kind === 'depth') return `Depth ${data.depth}/${data.maxDepth}`;
  if (data.kind === 'round') return `Round ${data.round}/${data.maxRounds}`;
  // Belief-population walk (Obscuro fog analysis): each batch folds another
  // slice of the belief worlds into the running estimate (see
  // analyzeObscuroProgressive). When the exact position set is finite we show
  // real coverage and, once every world has been evaluated, a settled done
  // state ("exhaustive" — the eval column is now the exact belief expectation).
  // On the generative fallback (no finite set) `total` is null and it just
  // keeps refining, so we show how many worlds have been folded in so far.
  if (data.exhaustive) return `All ${fmtNum(data.total)} worlds evaluated`;
  if (data.kind === 'batch') {
    if (data.total) return `${fmtNum(data.evaluated)} / ${fmtNum(data.total)} worlds`;
    return `${fmtNum(data.evaluated ?? data.batch)} worlds`;
  }
  return null;
}

let debounceTimer = null;
function scheduleAnalysis() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runAnalysis, 250);
}

// The in-flight SSE subscription, if any — a newer call closes the previous
// one outright (rather than just ignoring its late frames) so a stale stream
// never keeps ticking progress for a position we've already left.
let activeStream = null;

// Client-side analysis Web Worker (see apps/design/analysis-worker.js, which is
// fully generic — it just dynamically imports whatever `clientGame`/
// `clientAnalyze` module pointers the selected agent declares): runs the whole
// analysis entirely off the server/main thread. Used whenever both the game
// and the selected agent have opted in; historical-ply review always keeps the
// server SSE path (the worker only knows how to fetch the *live* position).
// Created lazily and reused.
let analysisWorker = null;
const useWorker = computed(() =>
  props.ply == null && !!clientGame.value && !!currentAgent.value?.clientAnalyze,
);
function ensureWorker() {
  if (!analysisWorker) {
    const bp = window.api?.basePath || '';
    analysisWorker = new Worker(`${bp}/ui/design/analysis-worker.js`, { type: 'module' });
    analysisWorker.onmessage = (e) => {
      const d = e.data || {};
      if (d.type === 'error') {
        candidates.value = []; errorMsg.value = d.message || 'Analysis error';
        progress.value = null; loading.value = false; return;
      }
      candidates.value = d.candidates ?? candidates.value;
      if (d.type === 'done') {
        loading.value = false;
        progress.value = d.exhaustive ? progressLabel(d) : null;
      } else {
        progress.value = progressLabel(d);
      }
    };
    analysisWorker.onerror = () => { errorMsg.value = 'Analysis worker failed'; loading.value = false; };
  }
  return analysisWorker;
}
// Stop whichever analysis is in flight (SSE stream or worker run) without
// tearing down the reusable worker.
function stopAnalysis() {
  activeStream?.close();
  activeStream = null;
  analysisWorker?.postMessage({ type: 'cancel' });
}

function runAnalysis() {
  stopAnalysis();
  // Stale suggestions (from whatever position/engine the previous stream was
  // for) must never linger on screen once a new position/engine is up for
  // analysis — a suggestion arrow pointing at a move for a position that just
  // changed underneath it (e.g. right after playing a move) is actively
  // misleading, not just out of date.
  candidates.value = [];
  progress.value = null;
  if (!props.enabled || !panelOn.value || paused.value) return;
  if (!props.sessionId || !props.playerId || !selectedAgentId.value) return;

  loading.value = true;
  errorMsg.value = '';

  if (useWorker.value) {
    ensureWorker().postMessage({
      type: 'analyze', base: window.api?.basePath || '',
      sessionId: props.sessionId, playerId: props.playerId, fog: props.fog,
      clientGame: clientGame.value, clientAnalyze: currentAgent.value.clientAnalyze,
    });
    return;
  }

  activeStream = api.analyzeStream(
    props.sessionId,
    { playerId: props.playerId, agentId: selectedAgentId.value, ply: props.ply },
    (data) => {
      if (data.error) {
        candidates.value = [];
        errorMsg.value = data.error;
        progress.value = null;
        loading.value = false;
        return;
      }
      candidates.value = data.candidates ?? [];
      // A settled, exhaustive result keeps its "All N worlds evaluated" label so
      // the viewer can see the answer is exact (not merely "done, stopped"); any
      // other done frame just clears the progress line.
      if (data.done) {
        loading.value = false;
        progress.value = data.exhaustive ? progressLabel(data) : null;
      } else {
        progress.value = progressLabel(data);
      }
    },
  );
}

onUnmounted(() => { stopAnalysis(); analysisWorker?.terminate(); analysisWorker = null; });

watch(
  () => [props.enabled, props.sessionId, props.playerId, props.ply, props.logRevision, selectedAgentId.value, panelOn.value, paused.value],
  () => {
    // Clear stale suggestions immediately (not just once the debounced fetch
    // below actually lands) — the position/engine already changed, so
    // whatever's on screen no longer describes it. Cancels both the SSE stream
    // and any in-flight worker run so a stale one can't keep posting frames.
    stopAnalysis();
    candidates.value = [];
    progress.value = null;
    if (props.enabled && panelOn.value && !paused.value) scheduleAnalysis();
  },
  { immediate: true },
);

function onHover(i) { hoveredIdx.value = i; emit('hover-move', i >= 0 ? (candidates.value[i]?.move ?? null) : null); }
function onSelect(i) { emit('select-move', candidates.value[i]?.move ?? null); }

watch(candidates, (c) => emit('candidates', c));
</script>

<template>
  <div class="an" v-if="enabled">
    <div class="an-head">
      <span class="an-title-wrap">
        <span class="panel-t">Analysis</span>
        <span v-if="loading" class="an-spinner" title="Analyzing…"/>
        <span v-if="progress" class="an-progress mono">{{ progress }}</span>
      </span>
      <div class="seg an-onoff">
        <button :class="{ on: panelOn }" @click="panelOn = true">On</button>
        <button :class="{ on: !panelOn }" @click="panelOn = false">Off</button>
      </div>
    </div>

    <template v-if="panelOn">
      <div class="an-controls">
        <select v-model="selectedAgentId" class="an-select" title="Analysis engine">
          <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
        <button class="an-pause" :class="{ 'an-pause--on': paused }" @click="paused = !paused"
                :title="paused ? 'Resume analysis' : 'Pause analysis'">
          {{ paused ? '► Resume' : '❙❙ Pause' }}
        </button>
      </div>

      <div v-if="!playerId" class="an-msg">No human player to analyze for.</div>
      <div v-else-if="errorMsg" class="an-msg">{{ errorMsg }}</div>
      <div v-else-if="paused" class="an-msg an-msg--paused">Paused</div>
      <div v-else-if="loading && !candidates.length" class="an-msg">Analyzing…</div>
      <div v-else-if="!candidates.length" class="an-msg">No suggestions.</div>
      <AnalysisCandidateList v-else :candidates="candidates" :hoveredIndex="hoveredIdx" :max="5"
        @hover="onHover" @select="onSelect"/>
    </template>
  </div>
</template>

<style scoped>
.an { border-bottom: 1px solid var(--line); padding: 10px 14px 12px; }
.an-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.an-title-wrap { display: flex; align-items: center; gap: 7px; }
.an-spinner {
  width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;
  border: 2px solid var(--line2); border-top-color: var(--accent);
  animation: an-spin 0.7s linear infinite;
}
@keyframes an-spin { to { transform: rotate(360deg); } }
.an-progress { font-size: 10px; color: var(--faint); }
.an-onoff button { padding: 2px 8px; font-size: 10px; }
.an-controls { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.an-select { flex: 1; min-width: 0; background: var(--bg0); border: 1px solid var(--line); border-radius: var(--r); color: var(--txt); font-size: 11px; padding: 4px 6px; }
.an-pause { font-size: 10px; padding: 4px 8px; white-space: nowrap; border: 1px solid var(--line2); border-radius: var(--r); background: var(--bg2); color: var(--dim); }
.an-pause--on { color: var(--warn); border-color: var(--warn); }
.an-msg { font-size: 11px; color: var(--faint); padding: 6px 2px; }
.an-msg--paused { color: var(--warn); }
</style>
