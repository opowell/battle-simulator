<script setup>
import { ref, shallowRef, computed, watch, onMounted, onUnmounted } from 'vue';
import AnalysisCandidateList from './AnalysisCandidateList.vue';
import BeliefWorldStepper from './BeliefWorldStepper.vue';

// Live/replay "what's good here" panel: pick an AI, see its ranked move
// suggestions for the position currently on screen, with live search progress
// (Obscuro "Depth 12/30 · 480 / 1,200 worlds", Stockfish "Depth N/14" — mirrors
// lichess's ticking depth indicator). For the live position, when the game/agent opt in (see
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
const emit = defineEmits(['hover-move', 'select-move', 'candidates', 'belief-world']);

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
// Which side these suggestions are FOR, as reported by whoever produced them
// (see api-server.js's resolveAnalysisContext). Usually the viewer's own seat,
// but at a historical ply the analysis follows the side to move there, and with
// full information it follows the side to move at the live position too — so
// this can be the opponent, and then it has to be said out loud.
const analyzedSide = ref(null);
const otherSide = computed(() =>
  analyzedSide.value && analyzedSide.value !== props.playerId ? analyzedSide.value : null);
// The belief population itself ({ total, exact, depth, moves, worlds }) — the
// set of boards consistent with what the viewer can see, which the analysis
// already reasons over internally (see vendor/obscuro-chess/src/ObscuroAgent.js). Rides along
// on a fraction of the progress frames because it is bulky, so a frame without
// it means "unchanged", not "gone".
const belief = ref(null);

const fmtNum = (n) => (n ?? 0).toLocaleString();

// Belief-population walk (Obscuro analysis): the engine refines along two axes
// at once, so the line reports both — which rung of the Stockfish
// iterative-deepening ladder it is on, and how much of the belief population has
// been folded in at that rung (see analyzeObscuroProgressive). Once every world
// has been evaluated at the top rung it is settled ("exhaustive" — the eval
// column is the exact belief expectation). With nothing hidden the population is
// a single world, so coverage is noise and only the depth is worth showing. On
// the generative fallback (no finite set) `total` is null and it just keeps
// refining, so we show how many worlds have been folded in so far.
function beliefWalkLabel(data) {
  const depth = data.depth ? `Depth ${data.depth}/${data.maxDepth}` : null;
  const worlds = data.exhaustive ? `all ${fmtNum(data.total)} worlds`
    : data.total ? `${fmtNum(data.evaluated)} / ${fmtNum(data.total)} worlds`
    : `${fmtNum(data.evaluated ?? data.batch)} worlds`;
  if (data.total === 1) return depth ?? worlds;
  return depth ? `${depth} · ${worlds}` : worlds;
}

function progressLabel(data) {
  if (data.kind === 'depth') return `Depth ${data.depth}/${data.maxDepth}`;
  if (data.kind === 'round') return `Round ${data.round}/${data.maxRounds}`;
  // `exhaustive` also arrives on the final (kind-less) done frame, which is how
  // a settled result keeps its label instead of clearing the progress line.
  if (data.kind === 'batch' || data.exhaustive) return beliefWalkLabel(data);
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
//
// FOG also keeps the SSE path, for a reason that isn't about cost: an
// imperfect-information belief is built up ACROSS turns (each turn advances and
// filters the set of positions still consistent with everything seen so far), so
// it only exists where something persists between analyses. The server has that —
// one long-lived tracker per session and seat, kept current by
// Session.syncSeatBelief. The worker fetches a fresh position per call and keeps
// nothing, so its tracker would attach mid-game every single time and fall back to
// a guess. Under fog the belief IS the analysis, so it has to come from the side
// that can actually maintain one.
let analysisWorker = null;
const useWorker = computed(() =>
  props.ply == null && !props.fog && !!clientGame.value && !!currentAgent.value?.clientAnalyze,
);
function ensureWorker() {
  if (!analysisWorker) {
    const bp = window.api?.basePath || '';
    analysisWorker = new Worker(`${bp}/ui/design/analysis-worker.js`, { type: 'module' });
    analysisWorker.onmessage = (e) => {
      const d = e.data || {};
      if (d.type === 'error') {
        candidates.value = []; belief.value = null; errorMsg.value = d.message || 'Analysis error';
        progress.value = null; analyzedSide.value = null; loading.value = false; return;
      }
      candidates.value = d.candidates ?? candidates.value;
      if (d.color) analyzedSide.value = d.color;
      if (d.beliefWorlds) belief.value = d.beliefWorlds;
      if (d.type === 'done') {
        loading.value = false;
        progress.value = d.exhaustive ? progressLabel(d) : null;
      } else {
        progress.value = progressLabel(d) ?? progress.value;
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
  // Deliberately does NOT clear candidates/belief/progress: the target watcher
  // below does that whenever the position or engine actually changes, which is
  // the case where a lingering suggestion would be misleading. Resume is not
  // that case — it re-requests the SAME position, so the suggestions the panel
  // already had are still the right ones and come straight back the moment the
  // "Paused" placeholder goes, instead of the panel blanking to "No
  // suggestions." and refilling with the answer it had all along.
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
        belief.value = null;
        errorMsg.value = data.error;
        progress.value = null;
        analyzedSide.value = null;
        loading.value = false;
        return;
      }
      if (data.color) analyzedSide.value = data.color;
      // A frame may legitimately carry no candidates (the belief-only opener,
      // which hands over the plausible boards before the first batch is priced);
      // that must not blank a list already on screen. Stale suggestions are
      // cleared where the position/engine actually changes, not here.
      if (data.candidates) candidates.value = data.candidates;
      if (data.beliefWorlds) belief.value = data.beliefWorlds;
      // A settled, exhaustive result keeps its "All N worlds evaluated" label so
      // the viewer can see the answer is exact (not merely "done, stopped"); any
      // other done frame just clears the progress line.
      if (data.done) {
        loading.value = false;
        progress.value = data.exhaustive ? progressLabel(data) : null;
      } else {
        progress.value = progressLabel(data) ?? progress.value;
      }
    },
  );
}

onUnmounted(() => {
  stopAnalysis(); analysisWorker?.terminate(); analysisWorker = null;
  emit('belief-world', null); // never leave a guessed board painted over the fog
});

// A real change of what is being analyzed — new position, different engine,
// panel switched off. Deliberately does NOT depend on `paused`: toggling
// Pause/Resume must not blow away the suggestions on screen or the walk behind
// them (see the dedicated paused watcher below); only an actual change of the
// thing being analyzed should.
watch(
  () => [props.enabled, props.sessionId, props.playerId, props.ply, props.logRevision, selectedAgentId.value, panelOn.value],
  () => {
    // Clear stale suggestions immediately (not just once the debounced fetch
    // below actually lands) — the position/engine already changed, so
    // whatever's on screen no longer describes it. Cancels both the SSE stream
    // and any in-flight worker run so a stale one can't keep posting frames.
    stopAnalysis();
    candidates.value = [];
    belief.value = null;
    progress.value = null;
    analyzedSide.value = null;
    if (props.enabled && panelOn.value && !paused.value) scheduleAnalysis();
  },
  { immediate: true },
);

// Pause/Resume: stop or restart the walk WITHOUT touching what is on screen.
// Pause just stops spending on it — the last suggestions stay put, no spinner —
// and Resume re-requests the SAME position, which the worker and the server
// both recognise and continue from the saved cursor and running sums rather
// than restarting the belief walk at 0 (see analysis-worker.js's lastWalk and
// api-server.js's analysisWalks).
watch(paused, (isPaused) => {
  if (!props.enabled || !panelOn.value) return;
  if (isPaused) { stopAnalysis(); loading.value = false; }
  else scheduleAnalysis();
});

function onHover(i) { hoveredIdx.value = i; emit('hover-move', i >= 0 ? (candidates.value[i]?.move ?? null) : null); }
function onSelect(i) { emit('select-move', candidates.value[i]?.move ?? null); }

watch(candidates, (c) => emit('candidates', c));
// The board overlay must follow the panel's own on/off/pause state — a phantom
// army left drawn over the fog after the analysis is switched off would read as
// real information.
const beliefShown = computed(() => panelOn.value && !paused.value && !!belief.value);
watch(beliefShown, (on) => { if (!on) emit('belief-world', null); });
</script>

<template>
  <div class="an" v-if="enabled">
    <div class="an-head">
      <span class="an-title-wrap">
        <span class="panel-t">Analysis</span>
        <span v-if="loading" class="an-spinner" title="Analyzing…"/>
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

      <!-- Own full-width row: the belief walk reports two axes at once
           ("Depth 12/30 · 1,024 worlds"), which does not fit beside the
           On/Off buttons in the header. -->
      <!-- Hidden while paused: the walk is stopped, and a progress count frozen
           beside a "Paused" message reads as one that is still running. -->
      <div v-if="progress && !paused" class="an-progress mono">{{ progress }}</div>

      <!-- Suggestions for somebody other than the viewer (a historical ply where
           the opponent is to move, or a full-information game mid-opponent-turn).
           Unlabelled, they read as the viewer's own options. -->
      <div v-if="otherSide" class="an-side">{{ otherSide }} to move</div>

      <div v-if="!playerId" class="an-msg">No human player to analyze for.</div>
      <div v-else-if="errorMsg" class="an-msg">{{ errorMsg }}</div>
      <div v-else-if="paused" class="an-msg an-msg--paused">Paused</div>
      <div v-else-if="loading && !candidates.length" class="an-msg">Analyzing…</div>
      <div v-else-if="!candidates.length" class="an-msg">No suggestions.</div>
      <AnalysisCandidateList v-else :candidates="candidates" :hoveredIndex="hoveredIdx" :max="5"
        @hover="onHover" @select="onSelect"/>

      <!-- Step through the boards the fog could be hiding (drawn as markers on
           the real, still-fogged board). Only meaningful under fog: with perfect
           information the population is the one board already on screen. -->
      <BeliefWorldStepper v-if="fog && beliefShown"
        :belief="belief" :candidates="candidates"
        @world="emit('belief-world', $event)"/>
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
.an-progress { font-size: 10px; color: var(--faint); margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.an-onoff button { padding: 2px 8px; font-size: 10px; }
.an-controls { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.an-select { flex: 1; min-width: 0; background: var(--bg0); border: 1px solid var(--line); border-radius: var(--r); color: var(--txt); font-size: 11px; padding: 4px 6px; }
.an-pause { font-size: 10px; padding: 4px 8px; white-space: nowrap; border: 1px solid var(--line2); border-radius: var(--r); background: var(--bg2); color: var(--dim); }
.an-pause--on { color: var(--warn); border-color: var(--warn); }
.an-side { font-size: 10px; color: var(--warn); margin-bottom: 6px; text-transform: capitalize; }
.an-msg { font-size: 11px; color: var(--faint); padding: 6px 2px; }
.an-msg--paused { color: var(--warn); }
</style>
