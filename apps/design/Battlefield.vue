<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import SchematicLayer    from './SchematicLayer.vue';
import HtmlLayer         from './HtmlLayer.vue';
import IsoLayer          from './IsoLayer.vue';
import HtmlIsoLayer      from './HtmlIsoLayer.vue';
import GameHeader        from './battlefield/GameHeader.vue';
import SelectedUnitDetail from './battlefield/SelectedUnitDetail.vue';
import SelectedSquareDetail from './battlefield/SelectedSquareDetail.vue';
import ActionsPanel      from './battlefield/ActionsPanel.vue';
import RosterPanel       from './battlefield/RosterPanel.vue';
import UnitsLostPanel    from './battlefield/UnitsLostPanel.vue';
import GameLog           from './battlefield/GameLog.vue';
import AiAnalysisPanel   from './battlefield/AiAnalysisPanel.vue';
import AnalysisPanel     from './battlefield/AnalysisPanel.vue';
import DatabasePanel     from './battlefield/DatabasePanel.vue';
import BottomBar         from './battlefield/BottomBar.vue';
import Minimap           from './battlefield/Minimap.vue';
import MenuOverlay       from './battlefield/MenuOverlay.vue';
import GameOverOverlay   from './battlefield/GameOverOverlay.vue';
import UnitInfoOverlay   from './battlefield/UnitInfoOverlay.vue';
import HelpOverlay       from './battlefield/HelpOverlay.vue';
import AbilityInfoOverlay from './battlefield/AbilityInfoOverlay.vue';
import CityInspectorOverlay from './battlefield/CityInspectorOverlay.vue';
import ObserverPerspective from './battlefield/ObserverPerspective.vue';

const props = defineProps({
  liveState:     Object,
  // The board straight from the server grid, no hop/replay overrides (App.vue's
  // resolvedField). Recorded into fieldHistory so history holds real turn-end
  // positions, not a replay frame — `field` may be mid-animation when a turn resolves.
  resolvedField: { type: Object, default: null },
  // Observer perspective: null = full-information view, else the playerId being
  // watched through their own fog view. App.vue owns re-subscription; we render
  // the switcher (ObserverPerspective) and bubble picks via 'set-observer-view'.
  observerView:  { type: String, default: null },
  field:         Object,
  unitFx:        { type: Object, default: () => ({}) },
  territoryFx:   { type: Object, default: () => ({}) },
  historyFields: { type: Array, default: () => [] },
  revealFields:  { type: Array, default: () => [] },
  revealLog:     { type: Array, default: () => [] },
  theme:         String,
  fog:           { type: Boolean, default: false },
  gamesCount:    { type: Number, default: 0 },
  serverErr:     { type: String, default: '' },
  // Analysis-panel replay fork sandbox (App.vue owns the actual /fork-move calls
  // and builds `forkState.field` the same way it builds activeField — see
  // App.vue's doForkMove). Non-null means the board is showing the sandbox.
  forkState:     { type: Object, default: null },
  forkError:     { type: String, default: '' },
  // Observer lock-step (App.vue owns the state): pause after each turn's playback
  // and wait for a manual "Next", and whether we're currently so parked.
  pauseAfterPlayback: { type: Boolean, default: true },
  awaitingStep:       { type: Boolean, default: false },
  // Wall-clock multiplier for every animated playback (history scrub, turn replay,
  // non-live field playback) — App.vue owns it, the footer's speed control sets it.
  playbackSpeed:      { type: Number, default: 1 },
});
const emit = defineEmits(['exit', 'open-settings', 'submit-action', 'resign', 'set-marker', 'new-game', 'fork-move', 'exit-fork', 'set-paused', 'set-ai-delay', 'set-observer-view', 'set-pause-after-playback', 'step-forward', 'stop-replay', 'set-playback-speed']);

// An observer session: no human seats and observing is allowed (or the server
// already flagged this snapshot as an observer view). Only these get the
// perspective switcher — a seated player is locked to their own view.
const isObserver = computed(() => {
  const s = props.liveState;
  return !!s?.observer || (!!s?.allowObservers && (s?.humanPlayers?.length ?? 0) === 0);
});
// Full, stable player list for the switcher (params.players survives fog trimming,
// unlike field.teams once we're viewing through a single player).
const observerPlayers = computed(() => props.liveState?.params?.players ?? []);
// The team an observer is watching through (viewAs), or null when watching as a
// seated player or in "everyone" mode. Drives client-side vision/visibility so a
// picked player's fog renders from their eyes (server already filtered the board).
const perspectiveViewer = computed(() => (isObserver.value ? props.observerView : null) || null);
// "Everyone" mode reveals the full board like the post-game reveal does: no fog
// shading and every unit shown (the server sends all of them). Kept separate from
// the internal `revealAll` toggle so history/log behaviour is untouched.
const observerRevealAll = computed(() => isObserver.value && !props.observerView);

// ── playback ──────────────────────────────────────────────────
const tFloat  = ref(0);
const playing = ref(false);

// History playback ("view play from here"): declared up here (not with its
// functions below) so the immediate game-switch watcher can safely stopHistoryPlay().
const historyPlaying = ref(false);
// The playback clock's state lives up here for the same reason: stopHistoryPlay()
// touches all three, and the game-switch watcher calls it during setup, before the
// playback section further down has been evaluated.
const histFrac = ref(0);
let playRaf = 0, playLastTs = 0;
// Exact off-sample scrub frame (server-computed) — up here too, since stopHistoryPlay
// (called by the immediate game-switch watcher during setup) clears it. Its fetch
// machinery lives with seekTime further down.
const exactFrame = ref(null); // { pos, frac, byId: Map<id,{x,y,alive}> } | null
let exactFrameSeq = 0, exactFrameTimer = null;

// ── view toggles ──────────────────────────────────────────────
const showRuler  = ref(false);
const showHpBars = ref(true);
const showMenu   = ref(false);
const showHelp   = ref(false);

// ── selection ─────────────────────────────────────────────────
const selectedId = ref(null);
const hoveredId  = ref(null);

// Empty-square selection (terrain info), only meaningful for games whose cells carry
// `terrain` data (see field.hasTerrain, computed in App.vue's buildField). Selecting a
// unit always clears this, and vice versa.
const selectedSquare = ref(null);

// Terrain-shape selection: on non-grid (shape) maps only the terrain shapes are
// selectable — clicking hit-tests the shapes rather than picking an arbitrary grid cell.
// Holds the hit shape plus the clicked cell (atX/atY) for the info panel + highlight.
const selectedShape = ref(null);

// Terrain info is opt-in: a plain click on terrain just clears the current selection
// (like clicking empty space). Only while armed via the "Inspect terrain…" toggle does
// clicking a tile/shape populate selectedSquare/selectedShape below.
const inspectTerrain = ref(false);
function toggleInspectTerrain() {
  inspectTerrain.value = !inspectTerrain.value;
  selectedId.value = null;
  aiming.value = null;
}

function pointInShape(s, px, py) {
  if (s.shape === 'oval') {
    const rx = s.w / 2, ry = s.h / 2;
    if (rx <= 0 || ry <= 0) return false;
    const nx = (px - (s.x + rx)) / rx, ny = (py - (s.y + ry)) / ry;
    return nx * nx + ny * ny <= 1;
  }
  if (s.shape === 'poly') {
    // Standard ray-casting point-in-polygon test over s.points ({x,y}[]).
    let inside = false;
    for (let i = 0, j = s.points.length - 1; i < s.points.length; j = i++) {
      const { x: xi, y: yi } = s.points[i], { x: xj, y: yj } = s.points[j];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  return px >= s.x && px <= s.x + s.w && py >= s.y && py <= s.y + s.h;
}

function selectUnit(id) {
  selectedId.value = id;
  if (id) { selectedSquare.value = null; selectedShape.value = null; inspectTerrain.value = false; }
  aiming.value = null;
}

// ── aiming (throw/shoot: pick a button, then a spot/direction on the map) ───────
// See ActionsPanel's 'aim' emit (a button for an action type in field.ui.aimedActionTypes)
// and SchematicLayer's aiming overlay (throw arc + blast preview, or shoot's aim ray).
const aiming = ref(null);

function startAim(action) {
  if (action.type === 'throw') {
    aiming.value = {
      type: 'throw', unitId: action.unitId, grenade: action.grenade,
      range: action.range, blastRadius: action.blastRadius,
      previewKind: action.previewKind, damage: action.damage,
    };
  } else if (action.type === 'shoot') {
    aiming.value = {
      type: 'shoot', unitId: action.unitId, range: action.range,
      candidates: legalActions.value.filter(a => a.type === 'shoot' && a.unitId === action.unitId),
    };
  } else if (action.type === 'move') {
    const u = displayUnits.value.find(un => un.id === action.unitId);
    aiming.value = { type: 'move', unitId: action.unitId, range: u?.moveRange ?? Infinity };
  } else if (action.type === 'rotate') {
    // No range: only the bearing to the clicked point matters, so any click is valid.
    aiming.value = { type: 'rotate', unitId: action.unitId };
  } else if (action.type === 'punch') {
    // Bearing-only like rotate — the blast always lands a fixed `range` ahead, so the
    // click just picks a direction (see SurvivGame.js's isPunchLegal/applyActions).
    aiming.value = { type: 'punch', unitId: action.unitId, range: action.range, blastRadius: action.radius, damage: action.damage };
  }
}

function cancelAim() { aiming.value = null; }

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

// The board to record into history: the resolved server grid (never a replay/hop
// frame). Falls back to `field` for games/paths that don't provide it.
const snapshotField = () => props.resolvedField ?? props.field;

// Restart on a new session, and equally on a change of VIEWING SEAT (hotseat: the
// turn passes, so App.vue's viewAsId re-fetches through the other player's eyes).
// Every recorded frame is a snapshot of one seat's fog view; appending the new
// seat's frames to the old seat's would make a timeline you cannot read — scrubbing
// back would silently change whose eyes you are looking through. One timeline per
// viewer instead.
// Two separate sources (not one getter returning `[id, viewerId]`) so Vue compares
// each value by identity: liveState is reassigned wholesale on every poll tick/move
// (App.vue never diffs before writing it), so a getter returning a fresh array
// literal each time would look "changed" on every single tick and wipe the history
// constantly — chess's frequent live-state churn made this the common case, not an
// edge case.
watch([() => props.liveState?.id, () => props.liveState?.viewerId], () => {
  stopHistoryPlay();
  fieldHistory.value = snapshotField() ? [snapshotField()] : [];
  histPos.value = 0;
  dismissedResult.value = false;
  revealAll.value = false;
  selectedSquare.value = null;
  selectedShape.value = null;
  aiming.value = null;
  inspectTerrain.value = false;
}, { immediate: true });

watch(() => props.historyFields, (h) => {
  if (h && h.length > 0) {
    fieldHistory.value = [...h];
    histPos.value = h.length - 1;
  }
});

watch(() => props.liveState?.log?.length ?? 0, (newLen, oldLen) => {
  if (oldLen === undefined || !snapshotField()) return;
  fieldHistory.value = [...fieldHistory.value, snapshotField()];
  if (histPos.value >= fieldHistory.value.length - 2) histPos.value = fieldHistory.value.length - 1;
  clearExactFrame(); // a new turn replaces the playback model any pending frame was for
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
  if (fieldHistory.value.length > 0 && snapshotField()) {
    const updated = [...fieldHistory.value];
    updated[updated.length - 1] = snapshotField();
    fieldHistory.value = updated;
  }
});

// ── analysis panel + replay forking ─────────────────────────────
// A "what if" sandbox branched off a live or historical position (see
// AnalysisPanel.vue's select-move / api.forkMove, api-server.js's
// POST /sessions/:id/fork-move). App.vue owns the actual fetch + turning the
// fork's raw grid into a proper display field (buildField needs App-scoped
// context — apiGames/sessionMeta — that doesn't live here); this component
// just reads the result via the forkState/forkError props and emits
// fork-move/exit-fork to drive it. Non-null forkState means the board is
// currently showing the sandbox, not the real game.
const forking = computed(() => !!props.forkState);

function exitFork() { emit('exit-fork'); }

// The `showAnalysisPanel` game option (default true for chess, absent/false —
// and so hidden — for every other game). Read from session config exactly
// like the other opt-in panels above (zoomEnabled).
const analysisEnabled = computed(() => props.liveState?.params?.config?.showAnalysisPanel ?? false);
// Analyze the position currently on screen: the live position while at the
// latest ply (server resolves it from the authoritative session state), or
// the exact historical ply being viewed while scrubbing replay — same
// definition of "ply" as fieldHistory's index (see the historyFields watcher
// above: index 0 = before any moves, index N = after N real moves).
const analysisPly = computed(() => (forking.value || atLatest.value) ? null : histPos.value);
const analysisCandidates = ref([]);
const hoveredSuggestion   = ref(null);
// The recorded-games database (DatabasePanel.vue) answers for the position on
// screen exactly like the analysis panel does, so it takes the same ply — but
// only ONCE THE GAME IS OVER. An opening book open beside a live game is an
// outside engine playing for you, and under fog it would also be a channel for
// what the other side is doing; the server refuses a live session outright, and
// the panel is not mounted for one either.
const databaseHover = ref(null);
// One member of the analysis engine's belief population — the board the panel's
// stepper currently has selected (see AnalysisPanel.vue / BeliefWorldStepper.vue).
// Null whenever nothing is selected or the panel is off. Its `hidden` list is
// already in grid coordinates, so this stays game-agnostic: the board just paints
// the guessed pieces as markers on top of the real fog, which is untouched.
const beliefWorld = ref(null);
const beliefMarkers = computed(() =>
  (forking.value ? [] : (beliefWorld.value?.hidden ?? []))
    .map(h => ({ col: h.x, row: h.y, type: h.type })));

// Whoever is to move at the CURRENTLY DISPLAYED ply (not necessarily the live
// game's pending player — while browsing replay these differ). Chess strictly
// alternates one mover per ply starting with the first team, so the ply's
// parity alone determines it; the same trick viewerTeam above already uses
// for fog-reveal perspective.
const plyToMoveTeam = computed(() => {
  const teams = props.field.teams;
  return teams[histPos.value % 2]?.id ?? teams[0]?.id ?? null;
});

// Top few ranked suggestions as board arrows, chess.com-style; the hovered
// candidate (if any) is emphasised instead of just always-rank-1. Uses the
// grid [col,row] pairs ChessGame.getLegalActions already stamps onto every
// action (gridFrom/gridTo) — the same numeric coordinates HtmlLayer's own
// px()/py() geometry expects, not algebraic square notation.
const suggestionArrows = computed(() => {
  if (forking.value) return [];
  const arrows = !analysisEnabled.value ? [] : analysisCandidates.value.slice(0, 3).map((c, i) => ({
    from: c.move?.gridFrom, to: c.move?.gridTo,
    rank: i + 1, hovered: hoveredSuggestion.value === c.move,
  }));
  // The database row the pointer is currently on (DatabasePanel.vue), drawn like
  // a top suggestion: it is a move somebody actually played, not a hypothesis
  // about the hidden board, so it belongs in the same visual language.
  if (databaseHover.value)
    arrows.push({ from: databaseHover.value.gridFrom, to: databaseHover.value.gridTo, rank: 1, hovered: true });
  return arrows.filter(a => a.from && a.to);
});

// Any move played while browsing replay, or already inside a fork, branches
// into (or continues) the sandbox instead of being submitted for real — see
// submitAction below, and AnalysisPanel.vue's select-move (which always
// routes here too, even on the human's own live turn). App.vue does the
// actual fetch (doForkMove) and hands the result back via the forkState prop.
function forkPlayMove(action) {
  if (!action || !props.liveState?.id) return;
  const playerId = forking.value ? (props.forkState.activePlayers?.[0] ?? null) : plyToMoveTeam.value;
  if (!playerId) return;
  const body = forking.value
    ? { forkState: props.forkState.state, playerId, action }
    : { ply: histPos.value, playerId, action };
  emit('fork-move', body);
}

const displayField = computed(() => {
  if (forking.value) return props.forkState.field;
  if (revealAll.value && props.revealFields.length)
    return props.revealFields[Math.min(histPos.value, props.revealFields.length - 1)];
  // At the latest ply, follow the live reactive field rather than the frozen history
  // snapshot — the snapshot is captured once, at the instant a move lands, which for
  // games with a hop animation (see App.vue's hopAnim/hopQueue) is mid-animation, still
  // pinned to the pre-move square. Following `field` live lets the animation actually
  // play and settle. Stepping back into history still shows the frozen past snapshot.
  if (atLatest.value) return props.field;
  return fieldHistory.value.length > 0 ? fieldHistory.value[histPos.value] : props.field;
});

// Persistent vision (field.ui.persistentFog, e.g. civ1): the original game never
// re-fogs terrain once a viewer's units have seen it — only units/cities out of CURRENT
// sight hide again (already stripped server-side, see getVisibleState). Folds every
// snapshot up to the displayed ply into one running union, so scrubbing replay shows
// exactly what had been explored by that point — no more, no less.
const exploredTileSet = computed(() => {
  if (!props.fog || !props.field?.ui?.persistentFog || revealAll.value) return null;
  const acc = new Set();
  // `f.units` (raw, from buildField) only carries a `path` — not the resolved x/y/dead
  // computeUnits derives from it — so past snapshots need computeUnits same as the
  // live display does (see `units` above); reuse displayUnits for the current one.
  const fold = (f, units) => {
    if (!f?.world) return;
    const sources = VISION.visionSources(units, f.teams?.[0]?.id ?? null, null);
    for (const k of VISION.visibleTileSet(f, sources)) acc.add(k);
  };
  const upto = atLatest.value ? fieldHistory.value.length - 1 : histPos.value;
  for (let i = 0; i <= upto; i++) {
    const f = fieldHistory.value[i];
    // t = f.turns (not turns-1): with turns always 1 for a static snapshot this makes
    // T=0 divide out to +Infinity rather than NaN, which samplePath clamps to the path's
    // final point — the position that actually landed, not an artifact of 0/0.
    if (f) fold(f, computeUnits(f, f.turns));
  }
  fold(displayField.value, displayUnits.value);
  return acc;
});

// Fog perspective in reveal mode: white is to move at even plies (ply 0 = initial
// position), black at odd plies — so the viewer flips as you step through the game.
const viewerTeam = computed(() => {
  if (!revealAll.value) return null;
  const teams = props.field.teams;
  return teams[histPos.value % 2]?.id ?? teams[0]?.id ?? null;
});

// What the render layers treat as "revealed": the post-game reveal toggle OR an
// observer watching "everyone" (view-all == no fog). A viewAs perspective is NOT
// revealed — it keeps fog, just cast from that player's eyes (viewerOverride).
const layerRevealAll = computed(() => revealAll.value || observerRevealAll.value);

function toggleReveal() {
  stopHistoryPlay();
  revealAll.value = !revealAll.value;
  selectedId.value = null;
  selectedSquare.value = null;
  selectedShape.value = null;
  aiming.value = null;
  inspectTerrain.value = false;
  histPos.value = Math.max(0, histLength.value - 1);
}

// ── turn timeline ─────────────────────────────────────────────
// Which turn each recorded ply belongs to. fieldHistory carries a snapshot of the
// position before any move as well as one per log entry, so ply p is the state
// AFTER log[p - offset]; deriving the offset from the two lengths rather than
// hard-coding 1 keeps this right for the revealAll source too, which is built
// from revealFields and need not carry that leading snapshot.
const plyTurns = computed(() => {
  const log = props.liveState?.log ?? [];
  const offset = histLength.value - log.length;
  return Array.from({ length: histLength.value },
    (_, p) => log[p - offset]?.turnNumber ?? log[0]?.turnNumber ?? 0);
});

// The contiguous run of plies sharing the displayed ply's turn — what the timeline
// spans. Null before any move is recorded, when there's no turn to show progress
// through and BottomBar leaves the track out.
const currentTurnRange = computed(() => {
  const turns = plyTurns.value;
  const p = Math.min(histPos.value, turns.length - 1);
  if (p < 0 || !turns.length) return null;
  const turn = turns[p];
  let start = p, end = p;
  while (start > 0 && turns[start - 1] === turn) start--;
  while (end < turns.length - 1 && turns[end + 1] === turn) end++;
  return { turn, start, end };
});

// Any manual history navigation interrupts an in-progress turn replay (App.vue's
// replayAnim, which otherwise keeps re-driving the board and overrides the scrub).
function goBack()    { emit('stop-replay'); stopHistoryPlay(); if (histPos.value > 0)  histPos.value--; }
function goForward() { emit('stop-replay'); stopHistoryPlay(); if (!atLatest.value)     histPos.value++; }
function seekTo(pos) { emit('stop-replay'); stopHistoryPlay(); histPos.value = pos; }

// The playhead as a single fractional time along the recorded plies (histPos +
// histFrac), and jumping to an arbitrary such time. For a discrete-time game the
// value snaps to a whole ply; for a continuous-time game a fraction parks the
// clock partway through a ply, and renderUnits shows the interpolated mid-slide
// board. Drives the bottom bar's time-jump field.
const playheadTime = computed(() => histPos.value + histFrac.value);
// From the LIVE field (props.field), which always carries the session's timeType —
// history/reveal snapshots (what displayField becomes once scrubbed back) don't.
const fieldTimeType = computed(() => props.field?.timeType ?? 'discrete');
function seekTime(t) {
  emit('stop-replay'); // interrupt any in-progress turn replay so the jump takes effect
  if (playRaf) { cancelAnimationFrame(playRaf); playRaf = 0; }
  historyPlaying.value = false;
  const max = Math.max(0, histLength.value - 1);
  t = Math.min(max, Math.max(0, Number(t) || 0));
  if (fieldTimeType.value === 'continuous') {
    histPos.value = Math.min(Math.floor(t), max);
    histFrac.value = histPos.value >= max ? 0 : (t - histPos.value);
  } else {
    histPos.value = Math.round(t);
    histFrac.value = 0;
  }
  requestExactFrame(); // paused mid-turn → pull the server's exact state for this instant
}

// ── exact off-sample frames (server-computed) ─────────────────
// A scrub PAUSED between the sampled playback frames shows the server's exact analytic
// state at that instant, not a client lerp between samples — a lerp across a motion
// event (an arrival, a death) that lands between two samples would mis-place the unit.
// The sampled frames are used only for smooth motion WHILE animating (history
// playback), and as a brief placeholder until the exact frame arrives. `exactFrame` is
// keyed to the (pos, frac) it was fetched for, so a superseded request's late reply is
// ignored and a stale value is never applied to a different playhead position.
// (`exactFrame` / `exactFrameSeq` / `exactFrameTimer` are declared up top so the
// game-switch watcher can clear them during setup.)

// Whichever perspective the board is currently showing — an observer (optionally
// pinned to one player's view) or the seated human — so the server trims the frame's
// fog exactly like the live playback the board already displays.
const viewerPerspective = computed(() => isObserver.value
  ? { observer: true, viewAs: perspectiveViewer.value }
  : { playerId: props.liveState?.humanPlayers?.[0] ?? null });

// Is fractional turn-time `f` exactly on a sampled playback frame? Those are already
// exact on the client, so no server round-trip is needed to display them.
function isSampledFrame(f) {
  const n = (props.liveState?.playback?.frames?.length ?? 0) - 1;
  if (n <= 0) return true;
  const at = f * n;
  return Math.abs(at - Math.round(at)) < 1e-6;
}

function clearExactFrame() {
  exactFrame.value = null;
  exactFrameSeq++; // invalidate any in-flight request
  if (exactFrameTimer) { clearTimeout(exactFrameTimer); exactFrameTimer = null; }
}

// Debounced fetch of the exact server frame for the current paused off-sample scrub.
// Only for the turn the live playback describes (playbackFrames gates histPos ==
// histLength - 2); earlier turns keep no motion model server-side and fall back to the
// sampled/lerped path. Debounced so a drag across the timeline fetches once on settle
// rather than on every pointermove.
function requestExactFrame() {
  if (exactFrameTimer) { clearTimeout(exactFrameTimer); exactFrameTimer = null; }
  const pos = histPos.value, frac = histFrac.value;
  const id = props.liveState?.id;
  if (historyPlaying.value || frac <= 0 || !playbackFrames.value || isSampledFrame(frac) || !id) {
    if (!exactFrame.value || exactFrame.value.pos !== pos || exactFrame.value.frac !== frac) clearExactFrame();
    return;
  }
  const seq = ++exactFrameSeq;
  exactFrameTimer = setTimeout(async () => {
    exactFrameTimer = null;
    try {
      const frame = await window.api.playbackFrame(id, frac, viewerPerspective.value);
      if (seq !== exactFrameSeq) return; // a newer scrub superseded this request
      exactFrame.value = { pos, frac, byId: new Map((frame.units ?? []).map(u => [u.id, u])) };
    } catch { /* keep the sampled placeholder on failure */ }
  }, 60);
}

// ── history playback ("view play from here") ──────────────────
// Auto-advances histPos through the recorded history from the current scrub
// position to the live edge, so a jumped-to point can be watched forward. Purely
// client-side over the already-loaded fieldHistory — independent of the live game,
// which keeps running (once playback reaches the latest ply it stops and the board
// follows live again). Any manual navigation cancels it.
//
// The playhead is fractional and driven by requestAnimationFrame rather than a
// setInterval of whole plies: an interval drifts under load and, more importantly,
// only ever produces whole-ply jumps, so every step teleported the units. histFrac
// is how far the clock has travelled into the ply currently on screen, which
// renderUnits below uses to slide units toward where the NEXT snapshot puts them.
const HISTORY_STEP_MS = 700;

function stopHistoryPlay() {
  if (playRaf) { cancelAnimationFrame(playRaf); playRaf = 0; }
  historyPlaying.value = false;
  histFrac.value = 0;
  clearExactFrame();
}

function toggleHistoryPlay() {
  if (historyPlaying.value) { stopHistoryPlay(); return; }
  if (histLength.value <= 1) return;
  // Nothing ahead to watch at the live edge — rewind to the start first.
  if (atLatest.value) histPos.value = 0;
  historyPlaying.value = true;
  histFrac.value = 0;
  playLastTs = 0;
  playRaf = requestAnimationFrame(stepPlayback);
}

// One animation frame of playback. Advances by real elapsed time (not one ply per
// frame), so the speed is the same on a 60Hz and a 120Hz display, and a frame the
// browser dropped is made up rather than lost. The `while` handles a long stall
// spanning more than a whole ply.
function stepPlayback(ts) {
  playRaf = 0;
  if (!historyPlaying.value) return;
  if (!playLastTs) playLastTs = ts;
  let f = histFrac.value + (ts - playLastTs) / (HISTORY_STEP_MS / props.playbackSpeed);
  playLastTs = ts;
  while (f >= 1) {
    if (histPos.value >= histLength.value - 1) { stopHistoryPlay(); return; }
    histPos.value++;
    f -= 1;
  }
  // At the live edge there is no next snapshot to tween into, so the playhead
  // parks on the ply itself rather than drifting toward a frame that isn't there.
  histFrac.value = atLatest.value ? 0 : f;
  playRaf = requestAnimationFrame(stepPlayback);
}

// Live game controls (server-backed) — bubble the intent to App, which owns the
// api.control call; the resulting state change comes back down via liveState.
function toggleLivePause() { emit('set-paused', !(props.liveState?.paused ?? false)); }
function setAiDelay(ms)    { emit('set-ai-delay', ms); }

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
  'surrender':            'Surrender',
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
  if (id) {
    showRuler.value  = ui.value.showRuler ?? true;
    showHpBars.value = ui.value.showHpBars ?? true;
  }
}, { immediate: true });

// ── board renderer (HtmlLayer vs SchematicLayer/IsoLayer) ──────
// There is no HTML-vs-SVG choice: the HTML renderer is used wherever it can fully draw
// the board; where it can't, SVG is the only option (see useHtmlRenderer below).
// A GRID board: the terrain is a grid of square cells (boardType 'grid'), as opposed to
// positioned shapes. This is a BOARD-type property (drives the minimap and grid-concept
// features) — independent of how UNITS move. csmini is a grid board even in continuous
// space. Hexes and isometric boards are their own thing.
const isGridBoard = computed(() =>
  !ui.value.isometric
  && displayField.value?.boardType === 'grid'
  && displayField.value?.grid === 'square'
  && (displayField.value?.tiles?.length ?? 0) > 0
  && !(displayField.value?.shapes?.length));
// A grid board ALWAYS renders in HTML (HtmlLayer): the terrain is an HTML/CSS grid, and
// units — even continuously-positioned ones (field.positioned, e.g. csmini) — are drawn
// as absolutely-placed HTML tokens sliding to exact points, with facing via CSS rotate.
// Only the vision cone, which has no HTML equivalent, is an SVG overlay inside HtmlLayer.
// SchematicLayer's whole-board SVG is reserved for boards HTML genuinely can't draw
// (shape terrain, hexes, textured iso).
// Isometric boards have their own HTML renderer (HtmlIsoLayer), which covers the same
// slice of IsoLayer that IsoLayer's 'sprite' tile mode does: flat boards of pre-drawn
// diamond art (civ2). 'texture' mode (ffta/xcom) skews terrain onto the ground plane and
// extrudes cliffs per tile height — SVG-only, so those games get no switch.
const isIsoSpriteBoard = computed(() =>
  !!ui.value.isometric && ui.value.isoTileMode === 'sprite');
// The HTML renderer is used whenever it can FULLY draw the board: a grid of square
// cells with cell-placeable units, or an isometric sprite board. Everything HTML has no
// equivalent for — positioned units, vision cones, shape terrain, hex grids, textured
// iso — falls to SVG (SchematicLayer / IsoLayer). No user-facing SVG/HTML toggle: where
// HTML works it is used; where it doesn't, SVG is the only option.
const useHtmlRenderer = computed(() =>
  isGridBoard.value || isIsoSpriteBoard.value);

// ── zoom & pan (the `mapZoom` game option) ────────────────────
// `zoomPx` is the tile size in screen px (null = fitted to the stage, the old behaviour);
// `center` is the world point held at the middle of the stage (null = the board's middle).
// Both feed the fitter below and, for the HTML renderer, HtmlLayer's own geometry.
const MIN_TILE_PX = 4, MAX_TILE_PX = 240, ZOOM_STEP = 1.25;
const zoomPx = ref(null);
const center = ref(null);

const zoomEnabled = computed(() =>
  props.liveState?.params?.config?.mapZoom ?? ui.value.mapZoom ?? false);

// Each game starts at its own default tile size (or fitted), centred on the board.
watch(() => props.liveState?.id, () => {
  zoomPx.value = zoomEnabled.value ? (ui.value.defaultTileSize ?? null) : null;
  center.value = null;
}, { immediate: true });

// What a zoom step works from when the view is still fitted rather than explicitly zoomed.
const baseFit  = computed(() => makeFitter(props.field.world, { w: stageW.value, h: stageH.value }, 24));
const tilePx   = computed(() => zoomPx.value ?? baseFit.value.s);
const canZoomIn  = computed(() => zoomEnabled.value && tilePx.value < MAX_TILE_PX);
const canZoomOut = computed(() => zoomEnabled.value && tilePx.value > MIN_TILE_PX);

function zoomBy(factor) {
  // Pin the current view centre so zooming doesn't drift the map out from under the cursor.
  if (!center.value) center.value = { x: props.field.world.w / 2, y: props.field.world.h / 2 };
  zoomPx.value = Math.min(MAX_TILE_PX, Math.max(MIN_TILE_PX, tilePx.value * factor));
}

function centerOn(x, y) {
  center.value = { x, y };
}

// A row in an empire-overview overlay (e.g. ActionsPanel's Cities list) was clicked —
// jump the view there and select it, the same as clicking that square on the board.
function handleGoto({ x, y, unitId }) {
  centerOn(x + 0.5, y + 0.5);
  if (unitId) selectUnit(unitId);
}

// The minimap sends one event for all three of its gestures (click = pan, double-click =
// pan + zoom in, shift+double-click = pan + zoom out). Centre first: zoomBy pins the
// current centre, so panning ahead of it is what anchors the zoom on the clicked spot.
function handleMinimapGoto({ x, y, zoom }) {
  centerOn(x, y);
  if (zoom > 0) zoomBy(ZOOM_STEP);
  else if (zoom < 0) zoomBy(1 / ZOOM_STEP);
}

// Panning stops at the map's edges rather than letting the board drift off into empty
// stage: the requested centre is pulled back until the board still covers the stage. An
// axis whose whole extent already fits just stays centred, exactly as an unzoomed board
// does. This is applied here (not in centerOn) because the limit moves with the scale —
// zooming out has to re-clamp a centre that was legal at the previous zoom.
// A wrapping axis (civ1's east/west cylinder, world.wrap) has no real edge to clamp
// against, so instead of pulling the centre back it's just normalised into [0, worldLen) —
// every click centres exactly where it landed, however close to the seam. HtmlLayer draws
// the duplicate columns that makes that seamless rather than showing blank stage.
function clampAxis(c, worldLen, stageLen, s, wrap) {
  const half = stageLen / 2 / s;          // half the visible stage, in world units
  if (worldLen <= half * 2) return worldLen / 2;
  if (wrap) return ((c % worldLen) + worldLen) % worldLen;
  return Math.min(worldLen - half, Math.max(half, c));
}

// The centre actually rendered (null = let the fitter centre the whole board).
const viewCenter = computed(() => {
  if (!zoomEnabled.value || !center.value) return null;
  const w = props.field.world;
  return {
    x: clampAxis(center.value.x, w.w, stageW.value, tilePx.value, !!w.wrap),
    y: clampAxis(center.value.y, w.h, stageH.value, tilePx.value, false),
  };
});

// ── world → screen transform ──────────────────────────────────
const fit = computed(() => zoomEnabled.value
  ? makeFitter(props.field.world, { w: stageW.value, h: stageH.value }, 24,
               { scale: zoomPx.value, center: viewCenter.value })
  : baseFit.value);

// ── live units at current time ────────────────────────────────
const units = computed(() => computeUnits(displayField.value, tFloat.value, perspectiveViewer.value));

// ── live session helpers ──────────────────────────────────────
const isLive          = computed(() => !!props.liveState);
const isPending       = computed(() => isLive.value && props.liveState.pendingPlayer &&
                                      props.liveState.humanPlayers?.includes(props.liveState.pendingPlayer));
const isDone          = computed(() => isLive.value && props.liveState.status !== 'active');
// While forking, the board interacts against the sandbox's own legal moves
// (from the last /fork-move response), not the live game's.
const legalActions    = computed(() => forking.value ? (props.forkState?.legalActions ?? []) : (props.liveState?.legalActions ?? []));
const pendingPlayerId = computed(() => props.liveState?.pendingPlayer ?? null);
// Board interaction (destination highlights, click-to-move) is live for the
// real game's pending player as usual, or — while browsing replay/forking —
// for whichever side forkPlayMove would move next, so a suggested/forked line
// can be played out on the board the same way a live turn is.
const canMove = computed(() => isPending.value || (analysisEnabled.value && (forking.value || !atLatest.value)));

// Chime when control passes to a human — i.e. isPending flips false→true (an AI or the
// other player just finished). The watcher isn't `immediate`, so opening a game that's
// already waiting on you doesn't beep; only an actual transition does. Keying on
// `pendingPlayerId` (not just isPending) also catches the rarer human→human handoff
// (two humans in one session), where isPending stays true across the switch.
watch(() => (isPending.value ? pendingPlayerId.value : null), (pending, prev) => {
  if (pending && pending !== prev) window.playTurnSound?.();
});

// Cheer + confetti (or a losing stinger) on a decisive win — keyed on isDone's
// false→true edge (not `immediate`) so opening/resuming an already-finished game
// never replays it. With no human seated (pure spectating) there's no "you" to win
// or lose, so it defaults to the celebration.
watch(() => isDone.value, (done, prev) => {
  if (!done || prev || props.liveState?.result?.outcome !== 'win') return;
  const humanPlayers = props.liveState?.humanPlayers ?? [];
  if (humanPlayers.length && !humanPlayers.includes(props.liveState.result.winnerId)) {
    playLoseSound();
  } else {
    playWinCelebration();
  }
});

function playWinCelebration() {
  window.playWinSound?.();
  window.playConfetti?.();
}

function playLoseSound() {
  window.playLoseSound?.();
}

// CS weapon/action sound effects (games/cs/sounds/*.wav, see cs-sound.js). Keyed on
// `log.length` growing — same trigger as the fieldHistory watcher above — so replay
// scrubbing (which doesn't change log.length) never re-fires a shot that already
// played live. Weapon category comes from `field.units[].type`, the same
// pistol/smg/shotgun/heavy/rifle/sniper/melee tag CsGame.js's toGrid already stamps
// for the marker-shape hash — no CS-specific weapon table duplicated here.
//
// Under simultaneous ("we-go") turns one broadcast resolves a WHOLE turn — many log
// entries at once — and the board replays that turn tick-by-tick over ~duration of
// wall-clock (App.vue's replayTurn, REPLAY_MS_PER_FRAME per sampled frame). So rather
// than fire a single sound for the last entry, schedule EACH order's sound to the
// instant the replay reaches it: its sim-time (t0 for the action, t1 for a kill) maps
// to wall-clock by the same frame pacing the replay uses. Turns with no playback
// (the instant buy turn) fire immediately.
const REPLAY_MS_PER_FRAME = 100; // must match App.vue's replayTurn pacing
let csSoundTimers = [];
const clearCsSoundTimers = () => { for (const t of csSoundTimers) clearTimeout(t); csSoundTimers = []; };

watch(() => props.liveState?.log?.length ?? 0, (newLen, oldLen) => {
  if (oldLen === undefined || props.liveState?.game !== 'cs') return;
  // A new turn's sounds supersede any still-pending from the turn before it.
  clearCsSoundTimers();

  const log = props.liveState.log;
  const latestTurn = log[log.length - 1]?.turnNumber;
  // Only this turn's entries (the ones the current playback actually animates); if
  // several turns bundled into one update, older turns aren't replayed, so skip them.
  const entries = log.slice(oldLen).filter(e => e.turnNumber === latestTurn);
  if (!entries.length) return;

  const unitsById = new Map((props.field?.units ?? []).map(u => [u.id, u]));
  const pb = props.liveState.playback;
  const duration = pb?.duration ?? 0;
  const totalMs = (pb?.frames?.length ?? 0) > 1 ? (pb.frames.length - 1) * REPLAY_MS_PER_FRAME / props.playbackSpeed : 0;
  const at = (t, fn) => {
    const delay = (duration > 0 && totalMs > 0) ? Math.min(1, Math.max(0, t) / duration) * totalMs : 0;
    if (delay > 0) csSoundTimers.push(setTimeout(fn, delay)); else fn();
  };

  for (const entry of entries) {
    const t0 = entry.t0 ?? 0, t1 = entry.t1 ?? t0;
    for (const { action } of entry.playerActions ?? []) {
      if (action.type === 'shoot')        at(t0, () => window.playCsSound?.(unitsById.get(action.unitId)?.type ?? 'rifle'));
      else if (action.type === 'move')    at(t0, () => window.playCsSound?.('footstep'));
      else if (action.type === 'plant')   at(t0, () => window.playCsSound?.('bombbeep'));
      else if (action.type === 'throw') {
        if (action.grenade === 'he')      at(t1, () => window.playCsSound?.('explosion'));
        else if (action.grenade === 'flash') at(t1, () => window.playCsSound?.('flashbang'));
      }
    }
    for (const ev of entry.events ?? []) {
      if (ev.type === 'died' || (ev.type === 'damage' && ev.died)) at(t1, () => window.playCsSound?.('death'));
    }
  }
});

// ── move highlights ───────────────────────────────────────────
const displayUnits = units;

// ── playback tweening ─────────────────────────────────────────
// Units as the board DRAWS them: displayUnits, but during history playback slid
// part-way toward where the next snapshot puts them (see histFrac). Deliberately a
// separate computed rather than folding this into displayUnits — that one feeds
// selection, the roster and several watchers, and handing those a freshly built
// array every animation frame would re-run all of them 60x a second for what is
// only a visual offset.

// The snapshot histPos indexes into, matching displayField's own choice of source
// so a tween never interpolates between two different recordings.
function snapshotAt(pos) {
  if (revealAll.value && props.revealFields.length)
    return props.revealFields[Math.min(pos, props.revealFields.length - 1)];
  return fieldHistory.value[pos] ?? null;
}

// Ease in/out: a unit accelerates off its square and settles onto the next one,
// rather than running at a constant speed and stopping dead on arrival.
function smoothstep(f) { return f * f * (3 - 2 * f); }

// The recorded kinetic frames for the turn the playhead currently sits within, but
// only when that turn is the one liveState.playback describes — the transition INTO
// the latest ply (histPos == histLength - 2). Those frames sample each unit's TRUE
// position along its resolved path (curved, out-and-back, dying mid-move), so a
// fractional time renders where the unit actually was, not a straight line between
// the turn's endpoints. Only the latest turn's frames are retained server-side, so
// scrubbing an earlier turn falls back to the endpoint lerp below.
const playbackFrames = computed(() => {
  const frames = props.liveState?.playback?.frames;
  if (!frames?.length) return null;
  return histPos.value === histLength.value - 2 ? frames : null;
});

// Interpolated unit positions at fractional turn-time `frac` (0-1): the frames are
// evenly spaced across the turn, so scale into [0, N-1] and lerp between the two
// bracketing frames. Returns a Map id -> { x, y, alive }.
function sampleFrames(frames, frac) {
  const span = frames.length - 1;
  const at = Math.min(Math.max(frac, 0), 1) * span;
  const i = Math.floor(at);
  const g = at - i;
  const a = frames[i], b = frames[Math.min(i + 1, span)];
  const bById = new Map(b.units.map(u => [u.id, u]));
  const m = new Map();
  for (const ua of a.units) {
    const ub = bById.get(ua.id) ?? ua;
    const lerp1 = (p, q) => (p == null || q == null) ? (p ?? q) : p + (q - p) * g;
    m.set(ua.id, {
      x: lerp1(ua.x, ub.x), y: lerp1(ua.y, ub.y),
      alive: ua.alive !== false && ub.alive !== false,
    });
  }
  return m;
}

// Turn a Map id->{x,y,alive} of resolved positions into render units: skip a unit
// dead or missing at this instant (mirrors the endpoint-lerp branch's `n.dead` check
// — leave it put rather than firing a mid-scrub removal), and carry BOTH the absolute
// x/y and the sub-cell tween offset (see that branch for why HtmlLayer needs
// baseX/baseY + tweenDx/tweenDy).
function frameToRenderUnits(byId, halfW) {
  return displayUnits.value.map(u => {
    const s = byId.get(u.id);
    if (!s || s.x == null || u.dead || s.alive === false) return u;
    const dx = s.x - u.x, dy = s.y - u.y;
    if ((dx === 0 && dy === 0) || Math.abs(dx) > halfW) return u;
    return { ...u, x: s.x, y: s.y, baseX: u.x, baseY: u.y, tweenDx: dx, tweenDy: dy };
  });
}

const renderUnits = computed(() => {
  const f = histFrac.value;
  // A fractional time parks the clock partway through a ply (during auto-play, a
  // scrub, or a value typed into the time field); interpolate the board so a
  // continuous game's past turns slide instead of jumping snapshot-to-snapshot.
  if (f <= 0) return displayUnits.value;
  // On a wrapping world a unit that crosses the seam has its x jump a whole world
  // width; tweening that would send it sprinting the long way across the map, so
  // any move over half the world just snaps.
  const halfW = props.field?.world?.wrap ? (props.field.world.w ?? 0) / 2 : Infinity;

  // Preferred path: follow the recorded kinetic frames so the unit traces its real
  // resolved trajectory. This is what makes a mid-turn seek / history playback show
  // the actual motion rather than a straight A→B slide between the turn's endpoints.
  const frames = playbackFrames.value;
  if (frames) {
    // Paused between samples: show the server's EXACT state for this instant (fetched
    // by requestExactFrame) rather than a lerp — the lerp is only correct WITHIN a
    // sample interval that has no motion event, so we reserve it for animation
    // smoothness (history playback) and as a brief placeholder until the exact frame
    // lands. On an exact sampled frame, sampleFrames itself is exact (g == 0).
    const ex = exactFrame.value;
    if (!historyPlaying.value && ex && ex.pos === histPos.value && ex.frac === f)
      return frameToRenderUnits(ex.byId, halfW);
    return frameToRenderUnits(sampleFrames(frames, f), halfW);
  }

  // Fallback (no frames retained for this turn): slide toward the next snapshot. A
  // straight line rather than the true path, but better than a snapshot-to-snapshot
  // jump.
  const next = snapshotAt(histPos.value + 1);
  if (!next) return displayUnits.value;
  const ahead = new Map(
    computeUnits(next, tFloat.value, perspectiveViewer.value).map(u => [u.id, u]));
  const t = smoothstep(f);
  return displayUnits.value.map(u => {
    const n = ahead.get(u.id);
    if (!n || u.dead || n.dead) return u;
    const dx = n.x - u.x, dy = n.y - u.y;
    if ((dx === 0 && dy === 0) || Math.abs(dx) > halfW) return u;
    // Two forms of the same offset, because the renderers disagree about what a
    // unit's position IS. The absolute-coordinate ones (SchematicLayer, IsoLayer,
    // Minimap) draw at x/y, so those carry the fraction. HtmlLayer instead files
    // each unit into a CSS grid cell keyed on Math.floor(x) — a fraction there is
    // rounded away until it crosses a cell boundary and the unit jumps a whole
    // square, which is the teleport this is meant to remove. So it also gets
    // tweenDx/tweenDy: a sub-cell shift, in tiles, to translate the sprite by,
    // and baseX/baseY, the unshifted square to keep filing the unit under.
    return {
      ...u,
      x: u.x + dx * t, y: u.y + dy * t,
      baseX: u.x, baseY: u.y,
      tweenDx: dx * t, tweenDy: dy * t,
    };
  });
});

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
  if (!canMove.value || !moveUnitId.value) return [];
  return legalActions.value
    .filter(a => a.unitId === moveUnitId.value)
    .map(a => actionGridCoord(a, 'to'))
    .filter(Boolean);
});

// Whether unitMoves are currently backed by 'queue-move' actions rather than 'move'
// — i.e. moveUnitId's unit has spent its moves for now and further clicks plan a
// future move instead of moving right away (the generic goto-queue mechanic, see
// games/moveQueue.js; ui.moveQueue !== false by default). Derived from action type,
// not any per-game stat field — games use `mp`/`maxMp` for different things (civ1:
// movement points; FFTA: real magic points), so type is the only universal signal.
const queuingMoves = computed(() => {
  if (!moveUnitId.value || ui.value.moveQueue === false) return false;
  const acts = legalActions.value.filter(a => a.unitId === moveUnitId.value && actionGridCoord(a, 'to'));
  return acts.length > 0 && acts.every(a => a.type === 'queue-move');
});

// Selection is click-driven only (see handleSqClick/selectUnit) — nothing here ever
// reassigns selectedId. activeUnitId just mirrors it, except FFTAGame's strictActiveUnit
// mode, which has its own server-driven turn queue and ignores what's clicked.
const activeUnitId = computed(() => {
  if (!isPending.value) return null;
  if (ui.value.freeSelection) return null;
  if (ui.value.strictActiveUnit) return legalActions.value.find(a => a.unitId)?.unitId ?? null;
  return selectedId.value;
});

// The unit that move-square highlighting and click-to-move drive off. Normally the
// selected unit, but in strictActiveUnit mode (ffta) the server picks the active unit and
// clicks don't reselect, so the reachable squares must come from that active unit — even
// before it's clicked. This also keeps `move` actions out of the ActionsPanel button list
// (displayedActions filters them once unitMoves is populated), so ffta never shows a raw
// list of "Move → (x,y)" buttons.
const moveUnitId = computed(() =>
  ui.value.strictActiveUnit ? activeUnitId.value : selectedId.value);

// The one human player viewing this session (fog games are always 1 human vs AI/other-human
// via separate sessions), used to attribute a manual fog marker to the right player.
const humanPlayerId = computed(() => props.liveState?.humanPlayers?.[0] ?? null);

function handleSetMarker(col, row, type) {
  if (!humanPlayerId.value) return;
  emit('set-marker', { playerId: humanPlayerId.value, col, row, type });
}

// Which human seat the analysis panel analyzes for: whichever seat this snapshot
// was rendered for, as stamped by the server (`viewerId`). Deliberately NOT
// re-derived from pendingPlayer here — the board's fog comes from the snapshot, so
// deriving the analysis side separately is how you end up advising one player
// about their position while drawing the other player's fog. App.vue's viewAsId
// owns the choice (it follows the active seat in a hotseat game and re-fetches
// when the turn passes); this just follows it. `viewerId` is absent for
// non-fog/observer snapshots, where the fixed human seat is the right answer.
const analysisPlayerId = computed(() => props.liveState?.viewerId ?? humanPlayerId.value);

// Concede as whichever human seat is currently on screen (in hotseat play that
// follows the active seat, same as the analysis panel above).
function confirmSurrender() {
  if (!analysisPlayerId.value) return;
  if (!window.confirm('Surrender this game?')) return;
  showMenu.value = false;
  emit('resign', analysisPlayerId.value);
}

// ── opening view ──────────────────────────────────────────────
// A zoomable map is bigger than the stage, so opening it centred on the board drops the
// player somewhere they own nothing. Instead start on their first unit, selected — the
// same state a click on it would produce. Scoped to mapZoom games so fixed-board games
// (chess) still open with nothing selected, as they always have.
// Units aren't in `field` on the first watch fire, so this waits for them and then runs
// once per session; any click afterwards is the player's own and must not be overridden.
const initedView = ref(false);
watch(() => props.liveState?.id, () => { initedView.value = false; });
watch([displayUnits, zoomEnabled], () => {
  if (initedView.value || !zoomEnabled.value || !isLive.value) return;
  const mine = displayUnits.value.find(u => !u.dead &&
    (humanPlayerId.value ? u.team === humanPlayerId.value : u.friendly));
  if (!mine) return;
  initedView.value = true;
  selectUnit(mine.id);
  centerOn(mine.x, mine.y);
}, { immediate: true });

// Territory-click games (kdice): every hex belongs to some territory, but only
// one hex (the "capital") carries a unit token — clicking anywhere in a
// territory's blob must resolve to that territory, so find whichever tile's
// center is nearest the click point and use its territoryId as the "unit" to
// select/attack (see KDiceGame.toGrid and SchematicLayer's hexagon click path).
function nearestTerritoryUnitId(x, y) {
  const tiles = displayField.value?.tiles ?? [];
  let best = null, bestD = Infinity;
  for (const t of tiles) {
    if (t.territoryId == null) continue;
    const d = (t.x - x) ** 2 + (t.y - y) ** 2;
    if (d < bestD) { bestD = d; best = t; }
  }
  return best?.territoryId ?? null;
}

function handleTerritoryClick(x, y) {
  const clickedId = nearestTerritoryUnitId(x, y);
  if (!clickedId) { selectedId.value = null; return; }
  if (isPending.value && selectedId.value && selectedId.value !== clickedId) {
    const action = legalActions.value.find(a =>
      a.type === 'attack' && a.from === selectedId.value && a.to === clickedId);
    if (action) { submitAction(action); selectedId.value = null; return; }
  }
  selectedId.value = selectedId.value === clickedId ? null : clickedId;
}

function handleSqClick(col, row, x, y) {
  if (props.field.ui?.territoryClick) { handleTerritoryClick(x, y); return; }
  if (inspectTerrain.value) {
    // Armed via the "Inspect terrain…" toggle: clicks look up terrain info instead of
    // clearing the selection like a normal click would. Stays armed across clicks so
    // several tiles can be inspected in a row; toggle it off (or select a unit) to exit.
    selectedId.value = null;
    if (props.field.shapes?.length) {
      const cx = col + 0.5, cy = row + 0.5;
      const hit = [...props.field.shapes].reverse().find(s => s.name && pointInShape(s, cx, cy));
      selectedShape.value = hit ? { ...hit, atX: col, atY: row } : null;
      selectedSquare.value = null;
    } else {
      selectedSquare.value = props.field.hasTerrain ? { x: col, y: row } : null;
      selectedShape.value = null;
    }
    return;
  }
  if (aiming.value && x != null && y != null) {
    const u = displayUnits.value.find(un => un.id === aiming.value.unitId);
    if (u) {
      if (aiming.value.type === 'throw') {
        // Same continuous-point rule as move above: gate on range client-side so an
        // out-of-range click just cancels aiming; the server (isThrowLegal) is the
        // real authority (walls etc.).
        if (Math.hypot(x - u.x, y - u.y) <= (aiming.value.range ?? Infinity))
          submitAction({ type: 'throw', unitId: u.id, grenade: aiming.value.grenade, target: { x: String(x), y: String(y) } });
      } else if (aiming.value.type === 'move') {
        // Same continuous-point rule as the direct-click move path below.
        if (Math.hypot(x - u.x, y - u.y) <= (aiming.value.range ?? Infinity))
          submitAction({ type: 'move', unitId: u.id, to: { x: String(x), y: String(y) } });
      } else if (aiming.value.type === 'rotate') {
        // Any click sets the facing bearing — no range limit, and a click on the
        // unit's own square (zero-length vector) is simply a no-op cancel.
        if (x !== u.x || y !== u.y)
          submitAction({ type: 'rotate', unitId: u.id, target: { x: String(x), y: String(y) } });
      } else if (aiming.value.type === 'shoot') {
        // "Choose a direction": prefer whichever already-detected enemy's bearing from
        // the unit is closest to the clicked point's bearing (same resolution
        // SchematicLayer's aiming overlay previews on hover — see VISION.nearestBearing).
        // If nothing's currently detected in range/LOS, fall back to a free-aim shot
        // toward the clicked point — the server resolves whatever (if anything) the
        // shot actually lines up with, same as a locked-on shot but possibly a miss.
        const candidates = aiming.value.candidates
          .map(a => { const t = displayUnits.value.find(un => un.id === a.targetId); return t && { ...a, x: t.x, y: t.y }; })
          .filter(Boolean);
        const best = VISION.nearestBearing(u.x, u.y, x, y, candidates);
        if (best) { const { x: _x, y: _y, ...action } = best; submitAction(action); }
        else if (x !== u.x || y !== u.y)
          submitAction({ type: 'shoot', unitId: u.id, target: { x: String(x), y: String(y) } });
      } else if (aiming.value.type === 'punch') {
        // Any click sets the punch bearing — no range limit on the click itself, the
        // blast lands at the weapon's fixed range regardless of how far this point is.
        if (x !== u.x || y !== u.y)
          submitAction({ type: 'punch', unitId: u.id, target: { x: String(x), y: String(y) } });
      }
    }
    aiming.value = null;
    return;
  }
  if (canMove.value && moveUnitId.value) {
    // Continuous-location maps (see games/coord.js): movement is a straight-line slide to
    // the exact point clicked — no grid to snap to. The server (each game's isActionLegal)
    // is the real authority on walls/occupancy/cost; here we only gate on the unit's move
    // radius so an out-of-range click deselects instead of firing off a certain-reject.
    // The click point goes on the wire as decimal strings (the server parses them to
    // authoritative BigNumbers, see games/coord.js posToWire/parsePos).
    // Games that list 'move' in field.ui.aimedActionTypes (CS) route this through the
    // explicit "Move…" button + aim overlay instead (see startAim/aiming above), so a
    // bare click on a selected unit's own square shouldn't also slide it.
    if (props.field.locationType === 'continuous' && !ui.value.aimedActionTypes?.includes('move')
        && x != null && y != null) {
      const u = displayUnits.value.find(un => un.id === selectedId.value);
      if (u && Math.hypot(x - u.x, y - u.y) <= (u.moveRange ?? Infinity)) {
        submitAction({ type: 'move', unitId: selectedId.value, to: { x: String(x), y: String(y) } });
        selectedSquare.value = null; selectedShape.value = null;
        return;
      }
    } else {
      const action = legalActions.value.find(a => {
        if (a.unitId !== moveUnitId.value) return false;
        const coords = actionGridCoord(a, 'to');
        return coords && coords[0] === col && coords[1] === row;
      });
      if (action) { submitAction(action); selectedSquare.value = null; selectedShape.value = null; return; }
    }
  }
  // A plain click (not armed via "Inspect terrain…") never selects terrain — it just
  // clears whatever was selected, same as clicking empty space always has. With the
  // zoom controls on it also recentres the map here: every other click (a unit, a legal
  // destination, an aimed shot, terrain inspection) has already returned above, so only
  // clicks that would otherwise merely deselect pan the view.
  if (zoomEnabled.value) centerOn(x ?? col + 0.5, y ?? row + 0.5);
  selectedId.value = null;
  selectedShape.value = null;
  selectedSquare.value = null;
}

const selectedUnit = computed(() => displayUnits.value.find(u => u.id === selectedId.value) || null);

// Auto-advance to another unit that still wants orders once the selected one no
// longer does (civ1: it used up its moves, or was just given a standing fortify/
// sentry order — see Civ1Game.js's toGrid `needsOrders`). Opt-in via ui.autoAdvanceUnit
// since most games have no such per-unit "still needs orders" concept at all — a plain
// mp-hits-zero check would be wrong for them (see queuingMoves above on why `mp` alone
// isn't a safe cross-game signal). Only fires on a true→not-true transition, so it
// never fights a selection the player just made themselves by clicking elsewhere.
watch(() => selectedUnit.value?.needsOrders, (needsOrders, prev) => {
  if (!ui.value.autoAdvanceUnit || !isPending.value || prev !== true || needsOrders === true) return;
  const myTeam = pendingPlayerId.value;
  const next = displayUnits.value.find(u => u.team === myTeam && u.needsOrders && u.id !== selectedId.value);
  if (next) { selectUnit(next.id); centerOn(next.x, next.y); }
  else selectedId.value = null;
});

// Cities render through the same glyph→pseudo-unit pipeline as real units (see
// App.vue's buildField) — `badge` is only ever set on those city tokens (the size
// number), so it doubles as "this selection is a city, not a unit" here. When it is,
// the City Inspector overlay takes over instead of the generic SelectedUnitDetail
// sidebar (see games/civ1/Civ1Game.js's `cities` field for the full per-city detail).
const selectedCity = computed(() => {
  const u = selectedUnit.value;
  if (!u || u.badge == null) return null;
  const x = Math.floor(u.x), y = Math.floor(u.y);
  return (props.field.cities ?? []).find(c => c.x === x && c.y === y) ?? null;
});
const cityProductionActions = computed(() => {
  if (!selectedCity.value) return [];
  return displayedActions.value.filter(a => a.type === 'set-production' && a.cityId === selectedCity.value.id);
});

const selectedTerrain = computed(() => {
  if (selectedShape.value) {
    const s = selectedShape.value;
    return { x: s.atX, y: s.atY, name: s.name, description: s.description };
  }
  if (!selectedSquare.value) return null;
  const { x, y } = selectedSquare.value;
  const tile = displayField.value?.tiles?.find(t => t.x === x && t.y === y);
  return tile?.terrain ? { x, y, ...tile.terrain } : null;
});

// ── roster groups ─────────────────────────────────────────────
const rosterTeams = computed(() =>
  props.field.teams.map(t => ({
    ...t,
    units: displayUnits.value.filter(u => u.team === t.id),
  }))
);

// ── units lost tracking ───────────────────────────────────────
// Server-authoritative (see api-server's _recordCasualties / confirmedCaptures):
// each entry is already scoped to what this viewer is allowed to know about — their
// own losses always (a player's own units are never fog-stripped from themselves),
// an enemy's only if they actually witnessed it die. Kept for the session's whole
// lifetime server-side, so a reload never loses history the way a client-side
// "units I've seen so far" tally would. No local bookkeeping needed at all.
const lostUnitsTeams = computed(() => {
  const captures = props.liveState?.confirmedCaptures ?? [];
  return props.field.teams.map(t => ({
    ...t,
    units: captures.filter(c => c.ownerId === t.id),
  }));
});

const displayedActions = computed(() => {
  // Territory-click games (kdice): attacks are issued entirely by clicking the
  // map (select a territory, then click its target — see handleTerritoryClick),
  // so the action panel only needs whatever's left (end-turn).
  if (ui.value.territoryClick) return legalActions.value.filter(a => a.type !== 'attack');
  if (ui.value.freeSelection) {
    return legalActions.value.filter(a =>
      a.unitId === '__player__' || (a.unitId === selectedId.value && !actionGridCoord(a, 'to')));
  }
  // Games that drive movement through the explicit "Move…" button + aim overlay
  // (field.ui.aimedActionTypes, see ActionsPanel.vue) keep their 'move' actions here so
  // ActionsPanel can collapse them into one button — the per-cell-square path below is
  // only for grid games that highlight legal destination squares directly on the map.
  // CS lists every not-yet-acted unit's actions in one big legalActions array; only show
  // the selected unit's own actions (or the global '__player__' ones — end-turn/end-buy —
  // when nothing is selected) so the list isn't a jumble of every unit's buttons at once.
  if (ui.value.aimedActionTypes?.includes('move')) {
    return legalActions.value.filter(a =>
      selectedId.value ? a.unitId === selectedId.value : a.unitId === '__player__');
  }
  if (unitMoves.value.length > 0)
    return legalActions.value.filter(a => a.type !== 'move');
  return legalActions.value;
});

function submitAction(action) {
  if (ui.value.clearSelectedAtEndOfTurn) selectedId.value = null;
  // Moving while browsing replay (or already inside a fork) explores a sandbox
  // instead of playing a real move — see forkPlayMove above.
  if (analysisEnabled.value && (forking.value || !atLatest.value)) { forkPlayMove(action); return; }
  // Lichess/chess.com-style move sound, right as the piece is released onto its new
  // square (this is the same drag-release / click-to-move path that produced `action`
  // above — see handleSqClick). Chess-only: window.playChessMoveSound (chess-sound.js).
  if (action.type === 'move' && props.liveState?.game === 'chess') window.playChessMoveSound?.();
  emit('submit-action', { playerId: pendingPlayerId.value, action });
}

// ── playback RAF ──────────────────────────────────────────────
const PLAY_SPEED = 0.7;
let rafId = null;
let lastTs = 0;

function raf(ts) {
  if (playing.value && props.field.turns > 1) {
    const dt   = Math.min((ts - lastTs) / 1000, 0.1);
    const next = tFloat.value + dt * PLAY_SPEED * props.playbackSpeed;
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
    if (aiming.value)           aiming.value = null;
    else if (infoAbility.value) infoAbility.value = null;
    else if (infoUnit.value)    infoUnit.value = null;
    else if (showHelp.value)    showHelp.value = false;
    else showMenu.value = !showMenu.value;
  } else if (e.key === 'ArrowLeft')  goBack();
  else if (e.key === 'ArrowRight') goForward();
  else if (e.key === 'Backspace') {
    // Undoes the most recently queued move for the selected unit (the generic
    // goto-queue mechanic, games/moveQueue.js — see ActionsPanel's "Undo last queued
    // move" button, the mouse equivalent). ui.moveQueue defaults true.
    if (!isPending.value || !selectedId.value || ui.value.moveQueue === false) return;
    const action = legalActions.value.find(a => a.type === 'queue-pop' && a.unitId === selectedId.value);
    if (action) { e.preventDefault(); submitAction(action); }
  }
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
  stopHistoryPlay();
  clearCsSoundTimers();
  window.removeEventListener('resize', updateStageSize);
  window.removeEventListener('keydown', onKeyDown);
});
</script>

<template>
  <div class="bf-root">

    <div class="bf-main">

      <!-- Left panel -->
      <div class="bf-col bf-col--left">
        <GameHeader
          :field="field" :liveState="liveState" :isLive="isLive"
          :isDone="isDone" :isPending="isPending" :pendingPlayerId="pendingPlayerId"
          :statusPlayerId="analysisPlayerId"
          :showMenu="showMenu" :ui="ui"
          @toggle-menu="showMenu = !showMenu"
          @show-help="showHelp = true"/>

        <SelectedUnitDetail v-if="selectedUnit && !selectedCity"
          :unit="selectedUnit" :field="field" :rdr="rdr" :showHpBars="showHpBars"
          @open-info="openInfo"
          @open-ability-info="openAbilityInfo"/>
        <SelectedSquareDetail v-else-if="selectedTerrain" :terrain="selectedTerrain"/>
        <div v-else-if="!selectedCity" class="bf-empty">
          Select a unit{{ (field.shapes?.length || field.hasTerrain) ? ', or "Inspect terrain…" then a tile,' : '' }} to view details.
        </div>
        <button v-if="field.shapes?.length || field.hasTerrain"
          class="action-btn bf-inspect-btn" :class="{ 'bf-inspect-btn--on': inspectTerrain }"
          @click="toggleInspectTerrain">
          {{ inspectTerrain ? 'Cancel inspect' : 'Inspect terrain…' }}
        </button>

        <ActionsPanel v-if="isLive"
          :isDone="isDone" :atLatest="atLatest" :isPending="isPending"
          :selectedId="selectedId" :activeUnitId="activeUnitId" :ui="ui"
          :unitMoves="unitMoves" :queuingMoves="queuingMoves" :displayedActions="displayedActions"
          :pendingPlayerId="pendingPlayerId" :liveState="liveState" :units="displayUnits"
          :aiming="aiming" :civ="field.civ" :cities="field.cities" :military="field.military"
          @submit="submitAction" @aim="startAim" @cancel-aim="cancelAim" @goto="handleGoto"/>

        <!-- Overview map + jump-to control, for the same games that get zoom/pan.
             Pinned to the foot of this column (see .mm), so it stays put as the
             panels above it change height or scroll. -->
        <Minimap v-if="zoomEnabled"
          :field="displayField" :units="renderUnits" :rdr="rdr"
          :center="viewCenter" :tilePx="tilePx" :stageW="stageW" :stageH="stageH"
          :fog="fog" :revealAll="layerRevealAll" :viewerOverride="perspectiveViewer"
          :exploredTiles="exploredTileSet"
          @goto="handleMinimapGoto"/>
      </div>

      <!-- Stage -->
      <div ref="stageEl" class="bf-stage-area">
        <div v-if="forking" class="bf-fork-banner">
          <span>Exploring a forked line — not the real game</span>
          <span v-if="forkError" class="bf-fork-err">{{ forkError }}</span>
          <button class="action-btn bf-fork-back" @click="exitFork">← Back to game</button>
        </div>
        <HtmlIsoLayer v-if="ui.isometric && useHtmlRenderer"
          :field="displayField" :units="renderUnits"
          :selectedId="selectedId" :activeUnitId="activeUnitId" :fog="fog"
          :rdr="rdr"
          :legalSquares="unitMoves"
          :lastMoveSquares="lastMoveSquares"
          :revealAll="layerRevealAll" :viewerTeam="viewerTeam"
          @select="selectUnit"
          @sq-click="handleSqClick"/>
        <IsoLayer v-else-if="ui.isometric"
          :field="displayField" :fit="fit" :units="renderUnits"
          :selectedId="selectedId" :activeUnitId="activeUnitId" :fog="fog"
          :rdr="rdr"
          :legalSquares="unitMoves"
          :lastMoveSquares="lastMoveSquares"
          :revealAll="layerRevealAll" :viewerTeam="viewerTeam"
          @select="selectUnit"
          @sq-click="handleSqClick"/>
        <!-- Derives its own integer-snapped geometry from the stage (no `fit` prop) so every
             board cell is a whole number of pixels — see HtmlLayer.vue's header. -->
        <HtmlLayer v-else-if="useHtmlRenderer"
          :field="displayField" :units="renderUnits"
          :selectedId="selectedId" :hoveredId="hoveredId" :activeUnitId="activeUnitId" :fog="fog"
          :showRuler="showRuler" :showHpBars="showHpBars" :rdr="rdr"
          :legalSquares="unitMoves"
          :lastMoveSquares="lastMoveSquares"
          :dragToMove="ui.dragToMove ?? false"
          :revealAll="layerRevealAll" :viewerTeam="viewerTeam" :viewerOverride="perspectiveViewer"
          :selectedEmptySquare="selectedSquare"
          :exploredTiles="exploredTileSet"
          :aiming="aiming"
          :zoomPx="zoomEnabled ? zoomPx : null"
          :center="viewCenter"
          :suggestionArrows="suggestionArrows"
          :beliefMarkers="beliefMarkers"
          @select="selectUnit"
          @sq-click="handleSqClick"
          @set-marker="handleSetMarker"/>
        <SchematicLayer v-else
          :field="displayField" :fit="fit" :units="renderUnits"
          :selectedId="selectedId" :hoveredId="hoveredId" :activeUnitId="activeUnitId" :fog="fog"
          :showRuler="showRuler" :showHpBars="showHpBars" :rdr="rdr"
          :unitFx="(atLatest && !revealAll) ? unitFx : {}"
          :territoryFx="(atLatest && !revealAll) ? territoryFx : {}"
          :legalSquares="unitMoves"
          :lastMoveSquares="lastMoveSquares"
          :dragToMove="ui.dragToMove ?? false"
          :revealAll="layerRevealAll" :viewerTeam="viewerTeam" :viewerOverride="perspectiveViewer"
          :selectedEmptySquare="selectedSquare"
          :selectedShape="selectedShape"
          :exploredTiles="exploredTileSet"
          :aiming="aiming"
          @select="selectUnit"
          @sq-click="handleSqClick"
          @set-marker="handleSetMarker"/>
      </div>

      <!-- Right sidebar -->
      <div class="bf-col bf-col--right">
        <ObserverPerspective v-if="isObserver"
          :players="observerPlayers" :teams="field.teams" :value="observerView"
          @change="v => $emit('set-observer-view', v)"/>

        <AnalysisPanel v-if="isLive"
          :enabled="analysisEnabled && !forking" :sessionId="liveState.id" :gameName="liveState.game"
          :playerId="analysisPlayerId" :ply="analysisPly" :logRevision="liveState?.turn ?? 0"
          :fog="fog"
          @candidates="analysisCandidates = $event"
          @hover-move="hoveredSuggestion = $event"
          @belief-world="beliefWorld = $event"
          @select-move="forkPlayMove"/>

        <DatabasePanel v-if="isLive && isDone"
          :enabled="!forking" :sessionId="liveState.id" :gameName="liveState.game"
          :ply="analysisPly"
          @hover-move="databaseHover = $event"
          @select-move="forkPlayMove"/>

        <RosterPanel v-if="ui.showRoster !== false"
          :teams="rosterTeams" :selectedId="selectedId" :rdr="rdr" :field="field" :showHpBars="showHpBars"
          @select="selectUnit"
          @hover="id => hoveredId = id"/>

        <UnitsLostPanel v-if="ui.showUnitsLost"
          :teams="lostUnitsTeams" :field="field"/>

        <GameLog v-if="isLive"
          :log="logForDisplay" :historyLength="histLength" :histPos="histPos"
          :units="displayUnits"
          @seek="seekTo"/>

        <AiAnalysisPanel v-if="isLive && liveState?.aiAnalysis"
          :analysis="liveState.aiAnalysis"/>
      </div>
    </div>

    <BottomBar
      :isLive="isLive" :field="field" :tFloat="tFloat" :playing="playing"
      :histPos="histPos" :histLength="histLength" :atLatest="atLatest"
      :isDone="isDone"
      :canReveal="canReveal" :revealAll="revealAll"
      :showZoom="zoomEnabled" :canZoomIn="canZoomIn" :canZoomOut="canZoomOut"
      :paused="liveState?.paused ?? false" :aiDelay="liveState?.aiDelay ?? 0"
      :observerPaced="liveState?.observerPaced ?? false"
      :pauseAfterPlayback="pauseAfterPlayback" :awaitingStep="awaitingStep"
      :playheadTime="playheadTime" :maxTime="histLength - 1" :timeType="fieldTimeType"
      :historyPlaying="historyPlaying"
      :turnRange="currentTurnRange" :histFrac="histFrac"
      :playbackSpeed="playbackSpeed"
      @step-back="stepBack" @step-fwd="stepFwd" @toggle-play="togglePlay"
      @scrub="scrub" @go-back="goBack" @go-forward="goForward"
      @seek-ply="seekTo" @seek-time="seekTime"
      @toggle-reveal="toggleReveal"
      @toggle-pause="toggleLivePause" @set-ai-delay="setAiDelay"
      @set-pause-after-playback="$emit('set-pause-after-playback', $event)"
      @step-forward="$emit('step-forward')"
      @toggle-history-play="toggleHistoryPlay"
      @set-playback-speed="$emit('set-playback-speed', $event)"
      @zoom-in="zoomBy(ZOOM_STEP)" @zoom-out="zoomBy(1 / ZOOM_STEP)"/>
  </div>

  <MenuOverlay
    :show="showMenu" :serverErr="serverErr" :gamesCount="gamesCount"
    :showRuler="showRuler" :showHpBars="showHpBars"
    :canSurrender="!!analysisPlayerId && liveState?.status === 'active'"
    @close="showMenu = false"
    @exit="$emit('exit')"
    @open-settings="$emit('open-settings')"
    @toggle-ruler="showRuler = !showRuler"
    @toggle-hp-bars="showHpBars = !showHpBars"
    @surrender="confirmSurrender"/>

  <CityInspectorOverlay :show="!!selectedCity" :city="selectedCity" :productionActions="cityProductionActions"
    @close="selectedId = null" @submit="submitAction"/>

  <GameOverOverlay
    :isDone="isDone" :dismissed="dismissedResult" :liveState="liveState"
    :winnerTeam="winnerTeam" :reasonLabel="reasonLabel" :field="field"
    @dismiss="dismissedResult = true"
    @exit="$emit('exit')"
    @new-game="$emit('new-game')"/>

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

<style scoped>
.bf-root { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.bf-main { flex: 1; min-height: 0; display: flex; overflow: hidden; }
.bf-col { width: 240px; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; background: var(--bg1); }
.bf-col--left { border-right: 1px solid var(--line); }
.bf-col--right { border-left: 1px solid var(--line); }
.bf-stage-area { flex: 1; position: relative; overflow: hidden; }
.bf-empty { padding: 12px 14px; font-size: 11px; color: var(--faint); }
.bf-inspect-btn { margin: 0 14px 12px; width: calc(100% - 28px); }
.bf-inspect-btn--on { border-color: var(--accent); color: var(--accent); }
.bf-fork-banner {
  position: absolute; top: 10px; left: 50%; transform: translateX(-50%); z-index: 5;
  display: flex; align-items: center; gap: 10px;
  background: var(--bg2); border: 1px solid var(--warn); border-radius: var(--r);
  padding: 6px 10px; font-size: 11px; color: var(--warn);
}
.bf-fork-err { color: var(--danger); }
.bf-fork-back { padding: 3px 9px; font-size: 11px; }
</style>
