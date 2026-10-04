<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useKeysLive } from './sessionScope.js';
import SchematicLayer    from './SchematicLayer.vue';
import HtmlLayer         from './HtmlLayer.vue';
import IsoLayer          from './IsoLayer.vue';
import HtmlIsoLayer      from './HtmlIsoLayer.vue';
import HtmlHexLayer      from './HtmlHexLayer.vue';
import GameHeader        from './battlefield/GameHeader.vue';
import SelectedUnitDetail from './battlefield/SelectedUnitDetail.vue';
import SelectedSquareDetail from './battlefield/SelectedSquareDetail.vue';
import SquareUnits       from './battlefield/SquareUnits.vue';
import ActionsPanel      from './battlefield/ActionsPanel.vue';
import RosterPanel       from './battlefield/RosterPanel.vue';
import UnitsLostPanel    from './battlefield/UnitsLostPanel.vue';
import GameLog           from './battlefield/GameLog.vue';
import AiAnalysisPanel   from './battlefield/AiAnalysisPanel.vue';
import AnalysisPanel     from './battlefield/AnalysisPanel.vue';
import DatabasePanel     from './battlefield/DatabasePanel.vue';
import BottomBar         from './battlefield/BottomBar.vue';
import Minimap           from './battlefield/Minimap.vue';
import GamePanels        from './battlefield/GamePanels.vue';
import SettingsChangeNotice from './battlefield/SettingsChangeNotice.vue';
import GameOverOverlay   from './battlefield/GameOverOverlay.vue';
import UnitInfoOverlay   from './battlefield/UnitInfoOverlay.vue';
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
  // The fights being played out on the board (App.vue's battleFx): fighters it no longer
  // draws itself, and the explosion frame showing — and a piece walking into a city,
  // drawn by a stand-in until it arrives. Null when none of that is on the board.
  battleFx:      { type: Object, default: null },
  historyFields: { type: Array, default: () => [] },
  revealFields:  { type: Array, default: () => [] },
  revealLog:     { type: Array, default: () => [] },
  fog:           { type: Boolean, default: false },
  gamesCount:    { type: Number, default: 0 },
  // This game's definition as GET /games serves it (options, agents, seat
  // limits) — what the in-game settings editor is built from.
  gameDef:       { type: Object, default: null },
  serverErr:     { type: String, default: '' },
  // Analysis-panel replay fork sandbox (App.vue owns the actual /fork-move calls
  // and builds `forkState.field` the same way it builds activeField — see
  // App.vue's doForkMove). Non-null means the board is showing the sandbox.
  forkState:     { type: Object, default: null },
  forkError:     { type: String, default: '' },
  // The ply this component last asked about (via `view-ply`), as the side to move
  // there saw it: { ply, playerId, legalActions, field }. Null when there is
  // nothing to review, or when the server refused (a live match).
  plyView:       { type: Object, default: null },
  // Observer lock-step (App.vue owns the state): pause after each turn's playback
  // and wait for a manual "Next", and whether we're currently so parked.
  pauseAfterPlayback: { type: Boolean, default: true },
  awaitingStep:       { type: Boolean, default: false },
  // True while App.vue is still playing out what just happened (hops, combat flashes,
  // a turn replay). Anything that announces "it's your turn now" waits for this to
  // fall, so the announcement lands after the board has finished saying why.
  animating:          { type: Boolean, default: false },
  // Wall-clock multiplier for every animated playback (history scrub, turn replay,
  // non-live field playback) — App.vue owns it, the footer's speed control sets it.
  playbackSpeed:      { type: Number, default: 1 },
});
const emit = defineEmits(['exit', 'submit-action', 'submit-actions', 'resign', 'set-marker', 'set-plan', 'new-game', 'play-scenario','fork-move', 'exit-fork', 'undo', 'view-ply', 'set-paused', 'set-ai-delay', 'set-observer-view', 'set-pause-after-playback', 'step-forward', 'stop-replay', 'set-playback-speed']);

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
// Side column (log/roster/analysis) and the AI's own reasoning: shown or not, per game
// default (ui.showRightSidebar / ui.showAiAnalysis), toggled from the menu.
const showSidebar = ref(true);
const showAiAnalysis = ref(true);
const showHpBars = ref(true);
// The panels open on the desk (battlefield/GamePanels.vue), in the order opened.
// They are windows rather than modals, so none of them covers the board's keys.
const openPanels = ref([]);
const gamePanels = ref(null);
const panelFlag = (id) => computed({
  get: () => openPanels.value.includes(id),
  set: (on) => {
    if (on) gamePanels.value?.show(id);
    else openPanels.value = openPanels.value.filter(x => x !== id);
  },
});
const showMenu = panelFlag('menu');
const showHelp = panelFlag('help');
// A unit in hand from the Add units panel ({ ownerId, type }): board clicks place it.
const placingUnit = ref(null);
const canShowHelp = computed(() => !!(ui.value?.help || KEYS.helpGroups(ui.value?.keys).length));
const menuProps = computed(() => ({
  serverErr: props.serverErr, gamesCount: props.gamesCount,
  showRuler: showRuler.value, showHpBars: showHpBars.value,
  showSidebar: showSidebar.value, showAiAnalysis: showAiAnalysis.value,
  canSurrender: !!analysisPlayerId.value && props.liveState?.status === 'active',
  canChangeSettings: props.liveState?.status === 'active' && !!props.gameDef,
  canShowHelp: canShowHelp.value,
  hasOrders: ordersDocked.value, hasMinimap: hostPanels.value.includes('minimap'),
  observerPlayers: isObserver.value ? observerPlayers.value : [],
  teams: props.field?.teams ?? [], observerView: props.observerView,
}));
function onMenu(name, arg) {
  if (name === 'exit') emit('exit');
  else if (name === 'toggle-ruler') showRuler.value = !showRuler.value;
  else if (name === 'toggle-hp-bars') showHpBars.value = !showHpBars.value;
  else if (name === 'toggle-sidebar') showSidebar.value = !showSidebar.value;
  else if (name === 'toggle-ai-analysis') showAiAnalysis.value = !showAiAnalysis.value;
  else if (name === 'surrender') confirmSurrender();
  else if (name === 'set-observer-view') emit('set-observer-view', arg);
}

// ── selection ─────────────────────────────────────────────────
const selectedId = ref(null);
const hoveredId  = ref(null);
// A drag-selected group (ui.boxSelect — see handleBoxSelect). selectedId stays its first
// member, so the side panel and everything else keyed on one selected unit keep working;
// the group only adds what a click means (see groupOrderAt). Any selection that isn't a
// member of the group — a plain click on another unit, a deselect — breaks it up.
const groupIds = ref([]);
watch(selectedId, (id) => {
  if (!groupIds.value.includes(id)) groupIds.value = [];
});
// Set when the selection was picked out of the city screen's garrison box rather than
// off the board — it says the selected id means the UNIT, not the city sharing its
// square. Declared up here with selectedId because selectUnit, below, clears it; see
// selectedCity for why the two need telling apart at all.
const garrisonPick = ref(null);
// A city the unit in hand has just taken, followed from the walk in to its screen
// closing — see the watchers beside selectedCity. Declared up here because the
// result dialog (doneShown) waits for it too.
const cityTaken = ref(null);   // { unitId, phase: 'walking'|'open', advance }

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
  garrisonPick.value = null;
  if (id) { selectedSquare.value = null; selectedShape.value = null; inspectTerrain.value = false; }
  aiming.value = null;
}

// Picking a unit out of the city screen's "Units in City" box (see garrisonPick, and
// CityInspectorOverlay's select-unit). Goes through selectUnit first so it clears the
// same things any other selection does, then claims the id as a garrison pick.
function selectGarrisonUnit(id) {
  selectUnit(id);
  garrisonPick.value = id;
}

// Put the piece in hand down. On a map you play by picking units up one after another
// (civ1) there has to be a way to let go that isn't "click bare ground" — that also
// pans the view (see handleSqClick) — or "give an order you didn't want to give".
// Reached from Esc and from the panel's Deselect button.
function deselectUnit() {
  selectedId.value = null;
  garrisonPick.value = null;
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
// A study board rather than a match: the session's `analysisBoard` flag, which
// the server only honours when no seat is played by an AI (see api-server.js's
// Session). Every seat belongs to the person at the keyboard, which is what lets
// the reveal control and the database panel work on a session that is still
// "active" — there is no opponent to keep anything from.
const analysisBoard = computed(() => !!props.liveState?.analysisBoard);

const revealAll = ref(false);
// Revealing mid-game would expose hidden pieces to a player who has an opponent —
// so it waits for the game to be over, EXCEPT on an analysis board, where every
// seat is the viewer's own and there is nobody to hide anything from.
const canReveal = computed(() =>
  props.fog && (isDone.value || analysisBoard.value) && props.revealFields.length > 0);

// ── action history (back/forward replay) ──────────────────────
const fieldHistory = ref([]);
const histPos      = ref(0);
// The frames recorded for a move this seat's log leaves out (the AI's, under fog —
// see the watch that records them), as { ply, playerId, turnNumber }. displayLog
// puts a hidden-move row at each, so the log still lines up with the frames.
const hiddenMoves  = ref([]);
// Inside a "what if" line the controls walk that line instead of the game (see
// forkLength below); otherwise it is the recorded history, revealed or not.
const histLength   = computed(() => forking.value ? forkLength.value
  : revealAll.value ? props.revealFields.length : fieldHistory.value.length);
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
//
// An ANALYSIS BOARD is the exception: there the seat changes on every single move
// (one person plays both sides), so honouring that rule would leave a timeline one
// frame long and nothing to step back through. Mixing the seats is what is wanted
// there — it is the same thing replay does, showing each ply as the side to move
// saw it.
watch([() => props.liveState?.id, () => (analysisBoard.value ? null : props.liveState?.viewerId)], () => {
  stopHistoryPlay();
  fieldHistory.value = snapshotField() ? [snapshotField()] : [];
  hiddenMoves.value = [];
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
    hiddenMoves.value = [];
    histPos.value = h.length - 1;
  }
});

watch(() => props.liveState?.log?.length ?? 0, (newLen, oldLen) => {
  if (oldLen === undefined || !snapshotField()) return;
  // A SHORTER log means moves were taken back (analysis boards — see undoMoves).
  // The frames those moves produced describe positions that no longer exist, so
  // they go; index 0 is the pre-move snapshot, hence the +1.
  if (newLen < oldLen) {
    const kept = fieldHistory.value.slice(0, newLen + 1);
    fieldHistory.value = kept.length ? kept : [snapshotField()];
    hiddenMoves.value = hiddenMoves.value.filter(m => m.ply < fieldHistory.value.length);
    histPos.value = Math.min(histPos.value, fieldHistory.value.length - 1);
    clearExactFrame();
    return;
  }
  fieldHistory.value = [...fieldHistory.value, snapshotField()];
  if (histPos.value >= fieldHistory.value.length - 2) histPos.value = fieldHistory.value.length - 1;
  clearExactFrame(); // a new turn replaces the playback model any pending frame was for
});

// The AI to move, when this seat's log leaves its moves out (a fog seat's, unless
// debugAI or an observer's view put them back in).
const hiddenMover = computed(() => {
  const s = props.liveState;
  if (!s?.fog || s.debugAI || s.observer || s.status !== 'active') return null;
  const humans = s.humanPlayers ?? [];
  return (s.activePlayers ?? []).find(id => !humans.includes(id)) ?? null;
});

// A seat's fog view strips the AI's moves from the log (see api-server.js's toJSON),
// so the log-length watch above never fires when the AI responds. Instead, watch for
// the turn leaving the AI — to a human, or to nobody when its move ended the game —
// and record the board it left as a ply of its own. Stepping back then goes a
// half-move at a time, through the position right after your move as well as the
// one after the reply, and — in a game this page has watched from the start — a
// frame's index is the ply the server counts (the engine's full log), which is
// what /position and the analysis panel look up.
// (Not pendingPlayer: that only ever names a human, so it reads null while the AI
// thinks.)
watch(() => [hiddenMover.value, props.liveState?.turn], ([mover], [wasMover, wasTurn] = []) => {
  if (mover || !wasMover) return;
  if (props.liveState?.result?.resignedBy) return; // resigned while the AI thought: no move came
  if (!snapshotField()) return;
  fieldHistory.value = [...fieldHistory.value, snapshotField()];
  hiddenMoves.value = [...hiddenMoves.value,
    { ply: fieldHistory.value.length - 1, playerId: wasMover, turnNumber: wasTurn ?? null }];
  if (histPos.value >= fieldHistory.value.length - 2) histPos.value = fieldHistory.value.length - 1;
  clearExactFrame();
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

// Position analysis and an opening book both assume the position IS a board and a
// move is atomic — one side plays, the other answers. Neither holds in a game
// played on a clock or in continuous space (chess's own other quadrants, see
// games/chess/spacetime.js), where a piece can be halfway through a move and both
// sides can be moving at once, so both panels stay shut there. Read off the axes
// toGrid already stamps, so it holds for any game that grows such a mode.
const atomicMoves = computed(() =>
  (props.field?.spaceType ?? 'discrete') === 'discrete'
  && (props.field?.timeType ?? 'discrete') === 'discrete');
// The `showAnalysisPanel` game option (default true for chess, absent/false —
// and so hidden — for every other game). Read from session config exactly
// like the other opt-in panels above (zoomEnabled).
const analysisEnabled = computed(() =>
  atomicMoves.value && (props.liveState?.params?.config?.showAnalysisPanel ?? false));
// Analyze the position currently on screen: the live position while at the
// latest ply (server resolves it from the authoritative session state), or
// the exact historical ply being viewed while scrubbing replay — same
// definition of "ply" as fieldHistory's index (see the historyFields watcher
// above: index 0 = before any moves, index N = after N real moves).
const analysisPly = computed(() => (forking.value || atLatest.value) ? null : histPos.value);
const analysisCandidates = ref([]);
const hoveredSuggestion   = ref(null);
// The recorded-games database (DatabasePanel.vue) answers for the position on
// screen exactly like the analysis panel does — but only once the game is OVER,
// or on an analysis board. An opening book open beside a live match is an
// outside engine playing for you, and under fog it would also be a channel for
// what the other side is doing; the server refuses such a session outright, and
// the panel is not mounted for one either.
const databaseHover = ref(null);
const databaseShown = computed(() =>
  atomicMoves.value && isLive.value && (isDone.value || analysisBoard.value));
// Whether a move played away from the live position branches into the "what if"
// sandbox instead of being refused. Either panel is reason enough: both of them
// hand the board moves to try (a database row is clicked to play it), and a
// suggestion you cannot play is a poor suggestion.
const canExplore = computed(() => analysisEnabled.value || databaseShown.value);
// Which position to ask about. Inside a fork that is "ply P of the real game,
// then these moves that never happened" — the database rebuilds the line itself,
// because what a fog player knows is a history and an invented line has one too.
const databasePly  = computed(() => (forking.value ? props.forkState.basePly : analysisPly.value));
// Only as far as the cursor: stepping back through a line asks the database about
// the position you are looking at, not about the end of a line you have left.
const databaseLine = computed(() => (forking.value ? props.forkState.line.slice(0, forkCursor.value) : []));
// On an analysis board the live position keeps moving while the panel is open,
// and `ply` cannot see that: it stays null from one move to the next. Whose turn
// it is and how long the log has grown both do change, so they drive the re-ask.
const databaseRevision = computed(() =>
  `${props.liveState?.turn ?? 0}:${props.liveState?.pendingPlayer ?? ''}:${props.liveState?.log?.length ?? 0}`);
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
  // Inside a line the playhead counts invented moves, not plies of the real game,
  // so parity has to be taken at the ply it branched from.
  const ply = forking.value ? (props.forkState.basePly ?? 0) : histPos.value;
  return teams[ply % 2]?.id ?? teams[0]?.id ?? null;
});

// Top few ranked suggestions as board arrows, chess.com-style; the hovered
// candidate (if any) is emphasised instead of just always-rank-1. Uses the
// grid [col,row] pairs ChessGame.getLegalActions already stamps onto every
// action (gridFrom/gridTo) — the same numeric coordinates HtmlLayer's own
// px()/py() geometry expects, not algebraic square notation.
const suggestionArrows = computed(() => {
  // The analysis panel does not follow a fork (it answers about a ply of the real
  // game), so its arrows are stale the moment one is opened. The database panel
  // does follow — see databaseLine — so its arrow stays.
  const arrows = (!analysisEnabled.value || forking.value) ? [] : analysisCandidates.value.slice(0, 3).map((c, i) => ({
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
  // Inside a line, the mover is whoever the frame under the cursor says is next;
  // at its branch point (cursor 0) it is the real game's ply parity, same as
  // starting a fresh fork from a reviewed ply.
  const frame = forkFrame.value;
  const playerId = frame ? (frame.activePlayers?.[0] ?? null) : plyToMoveTeam.value;
  if (!playerId) return;
  emit('fork-move', {
    ply: forking.value ? props.forkState.basePly : histPos.value,
    cursor: forking.value ? forkCursor.value : null,
    playerId, action,
  });
}

// ── the fork's own timeline ───────────────────────────────────
// While a line is open the history controls walk IT, not the real game: cursor 0
// is the branch point (the real board at basePly, which this component already
// has) and cursor i is the position after the line's i-th invented move. Without
// this the board stayed pinned to the tip of the line and stepping back looked
// broken — the counter moved and nothing else did.
const forkCursor = computed(() => (forking.value ? Math.min(histPos.value, forkLength.value - 1) : 0));
const forkLength = computed(() => (forking.value ? props.forkState.line.length + 1 : 0));
// The frame under the cursor, or null at the branch point.
const forkFrame = computed(() =>
  (forking.value && forkCursor.value > 0) ? props.forkState.frames[forkCursor.value - 1] : null);
// The real game's board at the branch point: the revealed frame if the viewer is
// revealing, otherwise the position as its own mover saw it (plyView), falling
// back to this client's recorded frame while that is still in flight.
const forkBaseField = computed(() => {
  const p = props.forkState?.basePly ?? 0;
  if (revealAll.value && props.revealFields.length)
    return props.revealFields[Math.min(p, props.revealFields.length - 1)];
  return plyView.value?.field ?? fieldHistory.value[Math.min(p, fieldHistory.value.length - 1)] ?? props.field;
});

// The playhead follows the line: opening one or playing into it lands on the new
// tip, and closing it puts the playhead back at the ply the line branched from
// (rather than wherever in the line the cursor happened to be, which is not a
// position the real game ever had).
let leftFromPly = null;
watch(() => (props.forkState ? props.forkState.line.length : -1), (len) => {
  if (len >= 0) {
    leftFromPly = props.forkState.basePly;
    histPos.value = len;
  } else if (leftFromPly != null) {
    histPos.value = Math.min(leftFromPly, Math.max(0, histLength.value - 1));
    leftFromPly = null;
  }
});

const displayField = computed(() => {
  if (forking.value) return forkFrame.value?.field ?? forkBaseField.value;
  if (revealAll.value && props.revealFields.length)
    return props.revealFields[Math.min(histPos.value, props.revealFields.length - 1)];
  // A reviewed ply is shown as its own mover saw it (App.vue's plyView), not as
  // this client's recorded frame — those were each taken through one seat's eyes
  // as that seat moved, so the side about to move is the one missing from them.
  // The recorded frame stays as the fallback until the lookup lands.
  if (!atLatest.value && plyView.value?.field) return plyView.value.field;
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
  // A game may declare the whole map known ground from the start (field.ui.terrainKnown
  // — civ1's revealed battlefields): every square is remembered, only units re-fog.
  if (props.field.ui.terrainKnown && props.field.world) {
    for (let y = 0; y < props.field.world.h; y++)
      for (let x = 0; x < props.field.world.w; x++) acc.add(`${x},${y}`);
    return acc;
  }
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

// Whose eyes the board is drawn through — which the render layers need for more
// than fog itself: it decides which way pawns move and which colour a guessed
// piece is drawn in (an unseen enemy is drawn in the OTHER side's colours).
//
// In reveal mode that flips with the playhead: white is to move at even plies
// (ply 0 = the initial position), black at odd ones, so stepping through the game
// shows each position through the eyes of whoever was deciding.
//
// Otherwise it is the seat the server fog-filtered this snapshot FOR. Layers used
// to assume teams[0] here, which is right for an ordinary one-human game and
// wrong the moment the viewer is the other seat — a hotseat or analysis board,
// where the view changes hands every move, drew black's hidden enemies (white
// pieces) in black's own colours.
const viewerTeam = computed(() => {
  if (!revealAll.value) return props.liveState?.viewerId ?? null;
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

// ── taking moves back (analysis boards) ───────────────────────
// Stepping back only changes what is on screen; this drops the moves from the
// game itself, so play continues from the earlier position (App.vue does the
// call — see api-server.js's POST /sessions/:id/undo). Offered only where the
// server would allow it anyway, and only once something has been played.
const playedPlies = computed(() => props.liveState?.log?.length ?? 0);
const canUndo = computed(() => analysisBoard.value && playedPlies.value > 0 && !forking.value);
// Where the playhead is aims it: stepping back to a ply and taking the game back
// to that ply is one gesture, not two. At the latest ply there is nothing aimed
// at, so it means "the last move".
const undoToPly = computed(() => (atLatest.value ? playedPlies.value - 1 : histPos.value));
const undoTitle = computed(() => {
  const n = playedPlies.value - undoToPly.value;
  return atLatest.value
    ? 'Take the last move back'
    : `Take back ${n} ${n === 1 ? 'move' : 'moves'} — play on from the position you are looking at`;
});
function undoMoves() {
  if (!canUndo.value) return;
  stopHistoryPlay();
  // Reveal stays as the viewer set it: the frames behind it are rebuilt (App.vue
  // re-fetches them because the log got shorter) but that is no reason to put the
  // fog back over a board somebody deliberately uncovered. `histPos` is clamped
  // by the watcher below once the shorter timeline arrives.
  emit('undo', { toPly: undoToPly.value });
}

// Whatever shortens the timeline — an undo, or a reveal source that came back
// smaller — must not leave the playhead pointing past its end.
watch(histLength, (len) => {
  if (histPos.value > len - 1) histPos.value = Math.max(0, len - 1);
});

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
  // Games where a "turn" is a couple of single moves (chess: one each) get nothing
  // from a progress track — the back/forward counter beside it already says the
  // same thing, in less space. They opt out with ui.hideTurnTimeline.
  if (ui.value.hideTurnTimeline) return null;
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
  'city-taken':           'City taken',
  'city-held':            'City held to the last turn',
  'position-taken':       'Position taken',
  'position-held':        'Position held to the last turn',
  'escort-arrived':       'The escort got through',
  'escort-lost':          'The escort was lost',
  'escort-stopped':       'The escort ran out of time',
  'army-routed':          'Army routed',
  'army-escaped':         'The army held out to the last turn',
  'step-limit':           'Turn limit reached',
  'no-legal-actions':     'No legal actions',
  'surrender':            'Surrender',
};

const reasonLabel = computed(() => {
  const r = props.liveState?.result?.reason;
  return REASON_LABELS[r] ?? r ?? '';
});

// The scenario a game's own scenario entry suggests playing once this one is over
// (its `next`), offered by the game-over dialog. Null when it names none.
const nextScenario = computed(() => {
  const scenarios = props.gameDef?.scenarios ?? [];
  const id = scenarios.find(s => s.id === props.liveState?.params?.config?.scenario)?.next;
  return scenarios.find(s => s.id === id) ?? null;
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
// Whether those two are the real board's size yet. Until the stage is in the DOM
// they are placeholders, and the opening view (below) must not be computed from a
// board that isn't there — it only gets one chance to frame the position.
const stageMeasured = ref(false);

function updateStageSize() {
  if (stageEl.value && stageEl.value.clientWidth > 0) {
    stageW.value = stageEl.value.clientWidth;
    stageH.value = stageEl.value.clientHeight;
    stageMeasured.value = true;
  }
}

// ── renderer palette ──────────────────────────────────────────
const rdr = computed(() => RDR.military);

// ── game UI flags ─────────────────────────────────────────────
const ui = computed(() => props.field.ui ?? {});

watch(() => props.liveState?.id, (id) => {
  if (id) {
    showRuler.value  = ui.value.showRuler ?? true;
    showHpBars.value = ui.value.showHpBars ?? true;
    // Each game says whether its side column (log, roster, analysis) and the AI's own
    // reasoning are worth the space by default; both stay togglable from the menu, so
    // "off" here means "not in the way", not "unavailable".
    showSidebar.value = ui.value.showRightSidebar !== false;
    showAiAnalysis.value = ui.value.showAiAnalysis !== false;
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
// A hex TERRITORY map (kdice, risk): blobs of hexes, one outline per blob, one count
// token per territory. HtmlHexLayer draws all of that in HTML — each hex is a div cut to
// shape with clip-path — so the board is made of the same elements as the rest of the
// app and a hex fields its own clicks. A hex board of per-hex terrain and pieces
// (memoir44) has no HTML renderer yet and stays on SchematicLayer.
const isHexTerritoryBoard = computed(() =>
  displayField.value?.grid === 'hexagon'
  && (displayField.value?.tiles ?? []).some(t => t.territoryId != null));
// The HTML renderer is used whenever it can FULLY draw the board: a grid of square
// cells with cell-placeable units, a hex territory map, or an isometric sprite board.
// Everything HTML has no equivalent for — positioned units, vision cones, shape terrain,
// hex boards with terrain and pieces, textured iso — falls to SVG (SchematicLayer /
// IsoLayer). No user-facing SVG/HTML toggle: where HTML works it is used; where it
// doesn't, SVG is the only option.
const useHtmlRenderer = computed(() =>
  isGridBoard.value || isIsoSpriteBoard.value);

// ── zoom & pan (the `mapZoom` game option) ────────────────────
// `zoomPx` is the tile size in screen px (null = fitted to the stage, the old behaviour);
// `center` is the world point held at the middle of the stage (null = the board's middle).
// Both feed the fitter below and, for the HTML renderer, HtmlLayer's own geometry.
const MIN_TILE_PX = 4, MAX_TILE_PX = 240, ZOOM_STEP = 1.25;
const zoomPx = ref(null);
const center = ref(null);

// A game whose map never fits the stage declares `ui.mapZoom` and offers no option;
// everyone else gets it per-session from MAP_ZOOM_OPTION, or not at all.
const zoomEnabled = computed(() =>
  props.liveState?.params?.config?.mapZoom ?? ui.value.mapZoom ?? false);

// Set once the opening view (openingView, below) has framed a session's position,
// so it does so once and never fights the player's own zooming afterwards.
const openedFor = ref(null);

// Each game starts at its own default tile size (or fitted), centred on the board —
// until the opening position arrives and frames itself (openingView, below).
watch(() => props.liveState?.id, () => {
  zoomPx.value = zoomEnabled.value ? (ui.value.defaultTileSize ?? null) : null;
  center.value = null;
  openedFor.value = null;
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

// The mouse wheel zooms about the point under the cursor, as any map app does: that
// spot stays where it is on screen while the map grows or shrinks around it. The step
// follows the size of the wheel delta rather than counting events, so a trackpad's
// stream of small deltas zooms as smoothly as a mouse's notches (deltaMode 1 reports
// lines, not pixels — roughly 33px each).
function handleWheel(e) {
  if (!zoomEnabled.value) return;
  e.preventDefault();
  const px = e.deltaY * (e.deltaMode === 1 ? 33 : 1);
  const oldS = tilePx.value;
  const newS = Math.min(MAX_TILE_PX, Math.max(MIN_TILE_PX, oldS * Math.exp(-px * 0.002)));
  if (newS === oldS) return;
  const r = stageEl.value.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  const f = fit.value;
  const wx = (sx - f.x(0)) / f.s, wy = (sy - f.y(0)) / f.s;   // world point under the cursor
  zoomPx.value = newS;
  // The fitter puts `center` at the middle of the stage, so this is the centre that
  // leaves (wx, wy) under the cursor at the new scale.
  centerOn(wx - (sx - stageW.value / 2) / newS, wy - (sy - stageH.value / 2) / newS);
}

// The board token standing on a square, identified the way App.vue's buildField ids
// them: a real unit's own id if one is there, else the synthetic position id that a
// glyph-only cell (civ1's city sprite) gets. Needed because a garrisoned city's token
// carries the GARRISON's id — so "select the city at x,y" can't just build the
// synthetic id and hope.
function tokenIdAt(x, y) {
  // findLast, not find: a square may hold a stack, and buildField lists the piece the
  // board actually draws last (the others are underneath it) — that top piece is the
  // one a click on the square means.
  const token = displayUnits.value.findLast(u => !u.dead && Math.floor(u.x) === x && Math.floor(u.y) === y);
  return token?.id ?? `u_${x}_${y}`;
}

// A row in an empire-overview overlay (e.g. ActionsPanel's Cities list) was clicked —
// jump the view there and select it, the same as clicking that square on the board.
function handleGoto({ x, y, unitId }) {
  centerOn(x + 0.5, y + 0.5);
  if (unitId) selectUnit(tokenIdAt(x, y));
}

// The same jump for one NAMED unit (the Military advisor's roster rows — see
// MilitaryOverlay.vue). Not handleGoto: that picks whatever token is on top of the
// square, which for a stack or a garrison is the wrong piece — and picking the unit by
// id is exactly what these rows exist for. handOverUnit is what makes a garrisoned one
// arrive as the unit rather than as its city screen (see the garrison note there).
function handleGotoUnit(unitId) {
  const u = displayUnits.value.find(un => un.id === unitId);
  if (u) handOverUnit(u);
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

// The board's own panels on the desk (GamePanels' hostPanels), pinned to its docked
// column: the orders a turn is played with, and the overview map. Only a map that
// zooms gets them — a world panned across, whose turns are many orders to many
// units; a fixed board (chess) keeps its orders in the left column instead, rather
// than giving up a column of its width to them.
// Each opens by itself the first time a session has it — orders before the minimap,
// ahead of anything already open, so the column reads top-down in that order — and
// once closed stays closed for that session, reopened from the menu.
// (An observer has no orders to give: their panel is the empire overview, which only
// a game with one has — the same test ActionsPanel's hasContent makes.)
const hasOrders = computed(() => isLive.value && (!isObserver.value || !!props.field?.civ || isDone.value));
const hostPanels = computed(() => zoomEnabled.value
  ? [...(hasOrders.value ? ['orders'] : []), 'minimap']
  : []);
const ordersDocked = computed(() => hostPanels.value.includes('orders'));
// ActionsPanel's wiring, shared by its two homes (the docked panel, the left column).
const ordersProps = computed(() => ({
  isDone: isDone.value, atLatest: atLatest.value, isPending: isPending.value,
  selectedId: selectedId.value, activeUnitId: activeUnitId.value, ui: ui.value,
  unitMoves: unitMoves.value, queuingMoves: queuingMoves.value, displayedActions: displayedActions.value,
  pendingPlayerId: pendingPlayerId.value, liveState: props.liveState, units: displayUnits.value,
  awaitingStep: props.awaitingStep,
  aiming: aiming.value, civ: props.field.civ, cities: props.field.cities, military: props.field.military,
  panel: openPanel.value,
  observing: isObserver.value, overviewPlayerId: overviewPlayerId.value,
  variantSpec: pairVariantSpec.value, variantValues: pairVariantValues.value, variantValue: pairVariant.value,
  // In the left column it names itself; docked, the panel's own bar does.
  titled: !ordersDocked.value,
}));
const ordersOn = computed(() => ({
  'submit': submitAction, 'aim': startAim, 'cancel-aim': cancelAim, 'goto': handleGoto,
  'goto-unit': handleGotoUnit, 'next-unit': selectNextUnit, 'deselect': deselectUnit,
  'set-variant': (v) => { pairVariant.value = v; },
  'update:panel': (v) => { openPanel.value = v; },
}));
const hostPanelsShown = new Set();
watch([() => props.liveState?.id ?? props.field?.game, hostPanels], ([key, avail]) => {
  const fresh = avail.filter(id => !hostPanelsShown.has(`${key}:${id}`));
  if (!fresh.length) return;
  for (const id of fresh) hostPanelsShown.add(`${key}:${id}`);
  openPanels.value = [...fresh, ...openPanels.value.filter(id => !fresh.includes(id))];
}, { immediate: true });
// Which action set the board interacts against. Three different positions can be
// on screen and each has its own:
//   • a fork — the sandbox's own moves, from the last /fork-move response;
//   • a past ply being reviewed — that ply's mover's moves, fetched below, so a
//     piece can be picked up and a line tried by hand;
//   • otherwise the live game's pending player.
// The reviewed position, as the side to move there saw it — App.vue fetches it
// (see its loadPlyView / GET /sessions/:id/position) whenever `view-ply` asks.
// Only trusted when it is FOR the ply on screen: it arrives a round-trip late,
// and a stale one would put another position's pieces under the cursor.
const plyView = computed(() =>
  (props.plyView && props.plyView.ply === viewedPly.value) ? props.plyView : null);

// Which ply needs looking up: the one under the playhead while reviewing, or —
// inside a line — the ply it branched from, which is the one position in the line
// the fork responses do not describe (and the one you step back to in order to
// try something else from the start).
const viewedPly = computed(() => {
  if (!isLive.value || !canExplore.value) return null;
  if (forking.value) return props.forkState.basePly;
  return atLatest.value ? null : histPos.value;
});
watch(viewedPly, (ply) => emit('view-ply', ply), { immediate: true });

const legalActions = computed(() => {
  // Inside a line, the frame under the cursor knows its own moves; at the branch
  // point it is the reviewed ply's, same as if the line had not been started.
  if (forking.value) return forkFrame.value?.legalActions ?? plyView.value?.legalActions ?? [];
  if (!atLatest.value) return plyView.value?.legalActions ?? [];
  return props.liveState?.legalActions ?? [];
});
const pendingPlayerId = computed(() => props.liveState?.pendingPlayer ?? null);
// Whose empire the left panel's overview screens describe (ActionsPanel's
// overviewPlayerId). A seated player: null, so the panel follows the player to
// move — always them. An observer: whoever they picked in the perspective
// switcher, and in "everyone" mode the first seat, because an observer is never
// given a pending player (the server names only seats it is waiting on, and an
// all-AI session has none) and the screens would otherwise describe nobody.
const overviewPlayerId = computed(() => {
  if (!isObserver.value) return null;
  return perspectiveViewer.value ?? pendingPlayerId.value ?? observerPlayers.value[0]?.id ?? null;
});
// Board interaction (destination highlights, click-to-move) is live for the
// real game's pending player as usual, or — while browsing replay/forking —
// for whichever side forkPlayMove would move next, so a suggested/forked line
// can be played out on the board the same way a live turn is.
const canMove = computed(() => isPending.value || (canExplore.value && (forking.value || !atLatest.value)));

// Chime when control passes to a human — i.e. isPending flips false→true (an AI or the
// other player just finished). The watcher isn't `immediate`, so opening a game that's
// already waiting on you doesn't beep; only an actual transition does. Keying on
// `pendingPlayerId` (not just isPending) also catches the rarer human→human handoff
// (two humans in one session), where isPending stays true across the switch.
//
// The chime waits for the board, though: a bundled AI turn arrives as one update whose
// battles animate over the next few seconds, and chiming on arrival announces your turn
// over the top of someone else's still being shown. So a handover is ARMED by the first
// watcher and FIRED by the second once nothing is animating — which also means an
// animation ending on its own never chimes, only a handover that was waiting for one.
const chimeArmed = ref(null);
watch(() => (isPending.value ? pendingPlayerId.value : null), (pending, prev) => {
  chimeArmed.value = pending && pending !== prev ? pending : null;
});
watch([chimeArmed, () => props.animating], ([pending, busy]) => {
  if (!pending || busy) return;
  chimeArmed.value = null;
  window.playTurnSound?.();
});

// The game is over AS FAR AS THE BOARD HAS SHOWN: the move that ends it arrives with
// the result, but is still being played out on the board (the unit walking into the
// city that wins the battle, the fight that takes the last piece), and announcing the
// result over the top of that hides the very move that won. So the result dialog and
// its cheer wait for the board to finish, and then a moment longer, for the last thing
// it showed (a city in its new colours) to be seen before the dialog dims it. A city
// taken by the winning move has its screen shown first (cityTaken), and the result
// follows once the player closes it.
// `immediate` so a game opened already over is over from the start — before the
// cheer's watcher below exists to hear it as news.
const RESULT_PAUSE_MS = 800;
const doneShown = ref(false);
let doneTimer = null;
watch([isDone, () => props.animating || !!cityTaken.value], ([done, busy], prev) => {
  clearTimeout(doneTimer);
  if (!done) { doneShown.value = false; return; }
  if (busy || doneShown.value) return;
  if (!prev) doneShown.value = true;
  else doneTimer = setTimeout(() => { doneShown.value = true; }, RESULT_PAUSE_MS);
}, { immediate: true });
onUnmounted(() => clearTimeout(doneTimer));

// Cheer + confetti (or a losing stinger) on a decisive win — keyed on doneShown's
// false→true edge (not `immediate`) so opening/resuming an already-finished game
// never replays it. With no human seated (pure spectating) there's no "you" to win
// or lose, so it defaults to the celebration.
// "Somebody won" is a result that names a winner, whatever word the game's getResult
// chose for its outcome — a game that says 'victory' rather than 'win' still ends in a
// cheer (kdice and risk both did, and both went out in silence for it).
watch(() => doneShown.value, (done, prev) => {
  if (!done || prev || props.liveState?.result?.winnerId == null) return;
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

// ── the opening view ──────────────────────────────────────────
// A zoomable map opens ON the units you start with, not on the middle of a world
// you have not seen yet. The view is framed around the units you own (all of them,
// for an observer with no seat), with a couple of tiles of air around the outermost
// one, and never narrower than `ui.openingSpan` tiles — so a civ that begins with
// two settlers opens about ten tiles high, close enough to read what it has, while
// a game that deals an army across the map opens far enough back to show all of it.
// How far it zooms is therefore a consequence of how many starting units there are
// and how far apart they stand, rather than one fixed number per game.
//
// It happens once per session, the first time there is both a measured board and a
// position on it; every zoom and pan after that is the player's.
const OPENING_SPAN = 10;      // tiles across, at least
const OPENING_MARGIN = 2;     // tiles of air around the outermost unit
function openingView() {
  const alive = displayUnits.value.filter(u => !u.dead && Number.isFinite(u.x) && Number.isFinite(u.y));
  const mine = viewerTeam.value ? alive.filter(u => u.team === viewerTeam.value) : [];
  const use = mine.length ? mine : alive;
  if (!use.length) return null;
  const xs = use.map(u => u.x), ys = use.map(u => u.y);
  const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  const span = ui.value.openingSpan ?? OPENING_SPAN;
  const spanX = Math.max(box.x1 - box.x0 + OPENING_MARGIN * 2, span);
  const spanY = Math.max(box.y1 - box.y0 + OPENING_MARGIN * 2, span);
  const px = Math.min(MAX_TILE_PX, Math.max(MIN_TILE_PX,
    Math.min(stageW.value / spanX, stageH.value / spanY)));
  // Along an axis the whole board fits on at this size, the board sits in the middle
  // of the view rather than pushed off to one side by where the units happen to stand.
  const world = props.field.world;
  return {
    px,
    center: {
      x: world.w * px <= stageW.value ? world.w / 2 : (box.x0 + box.x1) / 2,
      y: world.h * px <= stageH.value ? world.h / 2 : (box.y0 + box.y1) / 2,
    },
  };
}

watch([() => props.liveState?.id, stageMeasured, stageW, stageH, displayUnits], () => {
  const id = props.liveState?.id;
  if (!id || !zoomEnabled.value || !stageMeasured.value || openedFor.value === id) return;
  const view = openingView();
  if (!view) return;
  zoomPx.value = view.px;
  center.value = view.center;
  openedFor.value = id;
});

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
  // Stepped back, the move that led to the position on screen (displayLog lines up
  // with the frames); otherwise the game's last.
  const lastEntry = forking.value || atLatest.value
    ? props.liveState?.log?.at(-1)
    : displayLog.value[histPos.value - 1];
  if (!lastEntry) return [];
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
  const shown = log.filter(entry => entry.playerActions?.every(pa => humanPlayers.includes(pa.playerId)));
  if (!hiddenMoves.value.length) return shown;
  // A row per frame after the first: the moves the log has, in order, and a
  // "hidden move" where the AI moved unseen — so row i is what led to frame i + 1,
  // as GameLog and lastMoveSquares both assume.
  const hidden = new Map(hiddenMoves.value.map(m => [m.ply, m]));
  const rows = [];
  let next = 0;
  for (let ply = 1; ply < fieldHistory.value.length; ply++) {
    const m = hidden.get(ply);
    if (m) rows.push({ turnNumber: m.turnNumber, playerActions: [{ playerId: m.playerId, action: { type: 'hidden', label: 'hidden move' } }] });
    else if (next < shown.length) rows.push(shown[next++]);
  }
  return [...rows, ...shown.slice(next)];
});

// In reveal mode the whole game is exposed, so the log shows every move (both sides) and
// its entries align 1:1 with reveal plies — clicking one seeks to that ply (and flips fog).
const logForDisplay = computed(() => revealAll.value ? props.revealLog : displayLog.value);

function actionGridCoord(action, field) {
  if (field === 'to')   return action.gridTo   ?? (action.to?.x   != null ? [action.to.x,   action.to.y]   : null);
  if (field === 'from') return action.gridFrom ?? (action.from?.x != null ? [action.from.x, action.from.y] : null);
  return null;
}

// ── queued future moves (the player-level plan, games/planQueue.js) ───────────
// Moves this seat has committed to for its NEXT turns, and the moves that could be
// added behind them — both served by the session (see api-server's toJSON). Unlike
// everything else the board interacts with, these are not legal ACTIONS: a plan is
// edited through its own channel at any time, which is what makes it safe for the
// head to fire the moment the turn opens (see planWatch below).
const plannedMoves = computed(() => (atLatest.value && !forking.value)
  ? (props.liveState?.plan ?? []) : []);
const planActions  = computed(() => (atLatest.value && !forking.value)
  ? (props.liveState?.planActions ?? []) : []);
// The board is taking PLAN clicks rather than move clicks: it isn't this seat's
// turn, but the game will let them say what they intend to do when it is.
const planning = computed(() =>
  !isPending.value && !isDone.value && !!humanPlayerId.value && planActions.value.length > 0);

// Two moves are the same move: from/to, plus whatever else distinguishes two moves
// between the same squares (a promotion choice; a knight's chosen route in chess's
// continuous-space variants).
const sameMove = (a, b) => a && b && a.from === b.from && a.to === b.to
  && (a.payload?.promote ?? null) === (b.payload?.promote ?? null)
  && (a.pathId ?? null) === (b.pathId ?? null);
// A plan travels as thin descriptors; the server matches each against the real
// legal move at that point in the plan.
const thin = (a) => ({ unitId: a.unitId, from: a.from, to: a.to, payload: a.payload, pathId: a.pathId });
function sendPlan(moves) {
  if (!humanPlayerId.value) return;
  emit('set-plan', { playerId: humanPlayerId.value, moves: moves.map(thin) });
}

const unitMoves = computed(() => {
  if (!moveUnitId.value) return [];
  // Your turn: where this piece can actually go. Not your turn: where it could go
  // next in the plan — the same highlight, the same click, a different commitment.
  const source = planning.value ? planActions.value : (canMove.value ? legalActions.value : []);
  return source
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
  if (planning.value) return true;
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

// Which unit blinks, in the games that blink the unit in hand (ui.blinkActiveUnit).
// The blink means "this one is waiting on your order", so it is only ever a unit the
// player on the clock actually commands: clicking someone else's unit still selects it
// and still fills the detail panel, it just wears the ordinary selected ring instead of
// claiming to be up for orders. Free-selection games (civ1) have no turn-scoped active
// unit, so there the blink follows whatever was clicked.
const blinkUnitId = computed(() => {
  // Not while a fight is on the board: nothing is waiting on an order then, and the
  // unit in hand is as often as not the attacker, which would blink out of its own fight.
  if (!isPending.value || props.battleFx) return null;
  const id = ui.value.freeSelection ? selectedId.value : activeUnitId.value;
  if (!id) return null;
  const u = displayUnits.value.find(x => x.id === id);
  return u && u.team === pendingPlayerId.value ? id : null;
});

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
// same state a click on it would produce, except that a unit garrisoned in a city is
// handed over as the unit rather than as its city screen (see handOverUnit). Scoped to
// mapZoom games so fixed-board games (chess) still open with nothing selected, as they
// always have.
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
  handOverUnit(mine);
}, { immediate: true });

// Territory-click games (kdice, risk): every hex belongs to some territory, but only
// one hex (the "capital") carries a unit token — clicking anywhere in a territory's
// blob must resolve to that territory, so find whichever tile's center is nearest the
// click point and use its territoryId as the "unit" to select/attack (see
// KDiceGame.toGrid and HtmlHexLayer's clicks).
// A click on a hex arrives carrying that hex's own center — the hex is an element and
// fields its own click — so the search is exact for those; what it resolves is
// everything else, including the gaps between blobs on a map that isn't a full lattice
// (Risk's oceans). Those are off the map rather than a near miss, so a point farther
// than a hex from every center is no territory at all: clicking open water clears the
// selection instead of acting on whichever blob happened to be closest.
function nearestTerritoryUnitId(x, y) {
  const tiles = displayField.value?.tiles ?? [];
  let best = null, bestD = Infinity;
  for (const t of tiles) {
    if (t.territoryId == null) continue;
    const d = (t.x - x) ** 2 + (t.y - y) ** 2;
    if (d < bestD) { bestD = d; best = t; }
  }
  const reach = displayField.value?.hexSize;
  if (reach != null && bestD > reach ** 2) return null;
  return best?.territoryId ?? null;
}

// Some games offer the same pair action at several strengths, differing in one numeric
// field they name in ui.territoryPairVariant (Risk: how many dice an attack commits,
// which are also the armies that occupy what it takes). The player picks a value in the
// action panel; a click takes the largest option that doesn't exceed it, so a pick of 3
// still attacks from a territory that can only manage 2. Null = whatever the game
// listed first, which it orders strongest-first.
const pairVariant = ref(null);
const pairVariantSpec = computed(() => ui.value.territoryPairVariant ?? null);
// Every value the current position actually offers, high to low — the panel's choices.
const pairVariantValues = computed(() => {
  const spec = pairVariantSpec.value;
  if (!spec || !isPending.value) return [];
  const types = spec.types ?? ui.value.territoryPairTypes ?? ['attack'];
  const vals = new Set();
  for (const a of legalActions.value) {
    if (types.includes(a.type) && typeof a[spec.field] === 'number') vals.add(a[spec.field]);
  }
  return [...vals].sort((a, b) => b - a);
});
function pickPairVariant(matches) {
  const spec = pairVariantSpec.value;
  if (!spec || pairVariant.value == null || !matches.length) return matches[0];
  const wanted = matches.filter(a => a[spec.field] <= pairVariant.value);
  return wanted[0] ?? matches[matches.length - 1];
}
// A pick the position no longer offers at all goes back to "strongest available", so a
// stale choice never sits in the panel claiming something that can't happen.
watch(pairVariantValues, (vals) => {
  if (pairVariant.value != null && vals.length && !vals.includes(pairVariant.value)) {
    pairVariant.value = null;
  }
});

// Some pair actions stop the game to ask a follow-up whose whole content is a number —
// Risk's capture asks how many more armies follow the dice into the territory just
// taken. The game names the follow-up's type and its number in ui.territoryFollowUp,
// and `auto` there says the biggest answer is the default, so the question is never put
// to the player at all (Risk's autoOccupy option, which its toGrid ships per session).
// A shift-click on the pair that leads here asks for the other mode: the question when
// the game would answer it, and the largest answer when the game would ask. The ref
// below carries that one click's choice and is spent on the very next position, so it
// is never a standing order either way.
const followUpSpec = computed(() => ui.value.territoryFollowUp ?? null);
const followUpMode = ref(null);   // 'auto' | 'ask' | null (= whatever the game's default is)
// The biggest answer the position offers — "everything you can spare".
function maxFollowUp(actions, spec) {
  return actions.reduce((a, b) => ((b[spec.field] ?? 0) > (a[spec.field] ?? 0) ? b : a));
}
// Whether the follow-up asked by the position a pair action leads to should be answered
// for the player: the game's default, flipped by a shift-click.
function followUpAuto(shift) {
  return shift ? !followUpSpec.value?.auto : !!followUpSpec.value?.auto;
}
watch(legalActions, (actions) => {
  const mode = followUpMode.value;
  followUpMode.value = null;
  const spec = followUpSpec.value;
  if (!spec || !isPending.value || !actions.length) return;
  // Only the live game at its latest position: a past ply reached by the timeline (or a
  // fork being explored) can be sitting on the same question, and answering that one
  // would play a move nobody asked for into a sandbox.
  if (!atLatest.value || forking.value) return;
  // Only ever answers a question that has no other answer: if anything besides the
  // follow-up is legal here, the position is a real choice and stays the player's.
  if (!actions.every(a => a.type === spec.type)) return;
  if (mode ? mode !== 'auto' : !spec.auto) return;
  submitAction(maxFollowUp(actions, spec));
}, { immediate: true });   // a question already standing when the page opens is one too

// A click on a territory map means one of three things, in order: finish a pair
// (something is selected and the pair is a legal from→to action — attack, or Risk's
// fortify), act on the territory alone (a legal action naming just it — Risk's
// place-armies), or change the selection. Which action types count as which is the
// game's call via ui.territoryPairTypes / ui.territoryTapType, so this stays a rule
// about clicks rather than about any particular game; several actions of the same
// type may match, and the game orders its legal actions so the first is the one a
// click should mean.
function handleTerritoryClick(x, y, mods = {}) {
  const clickedId = nearestTerritoryUnitId(x, y);
  if (!clickedId) { selectedId.value = null; return; }
  const pairTypes = ui.value.territoryPairTypes ?? ['attack'];
  const tapType = ui.value.territoryTapType;

  // A follow-up left for the player to answer (see followUpSpec) is a question about two
  // territories the map is already showing — Risk's "how many more armies follow the dice
  // into the one you just took?" — so it can be answered on the map instead of in the
  // panel: click the territory the armies would move to and every one that can go goes,
  // click the one they would come from and none of them do. Nothing else is legal while
  // the question stands, so a click anywhere else is left alone rather than turned into
  // a selection the player can't use.
  const followUp = followUpSpec.value;
  const pendingFollowUp = isPending.value && followUp && legalActions.value.length
    && legalActions.value.every(a => a.type === followUp.type);
  if (pendingFollowUp) {
    const acts = legalActions.value;
    if (acts.some(a => a.to === clickedId)) submitAction(maxFollowUp(acts, followUp));
    else if (acts.some(a => a.from === clickedId))
      submitAction(acts.reduce((a, b) => ((b[followUp.field] ?? 0) < (a[followUp.field] ?? 0) ? b : a)));
    return;
  }

  if (isPending.value && selectedId.value && selectedId.value !== clickedId) {
    const matches = legalActions.value.filter(a =>
      pairTypes.includes(a.type) && a.from === selectedId.value && a.to === clickedId);
    // Several matches differ only in the variant field the game named (Risk's dice):
    // take the player's pick, or the most the pair allows when they picked more than
    // this one can manage. A shift-click means "everything" — the most this pair allows,
    // and the largest answer to whatever the action asks next — except where the game
    // already answers that follow-up by itself, which is what a shift-click is *for*:
    // there it buys the question back instead, and leaves the picker's choice of dice
    // alone, since going all in was never what the player was asking for.
    const auto = followUpAuto(!!mods.shift);
    const action = mods.shift && !followUpSpec.value?.auto ? matches[0] : pickPairVariant(matches);
    if (action) {
      submitAction(action);
      // Arm the follow-up above for exactly the position this action leads to.
      followUpMode.value = auto ? 'auto' : 'ask';
      // Keep the source selected: after an attack that didn't take the territory, the
      // obvious next move is to attack again from the same place. A watcher below drops
      // the selection as soon as nothing can be done from there.
      selectedId.value = action.from;
      return;
    }
  }
  if (isPending.value && tapType) {
    const action = legalActions.value.find(a => a.type === tapType && a.territoryId === clickedId);
    if (action) { submitAction(action); selectedId.value = clickedId; return; }
  }
  selectedId.value = selectedId.value === clickedId ? null : clickedId;
}

// Prune a kept selection (see the pair path above) once the position moves on: the
// territory you attacked from stays selected while it can still attack, and lets go by
// itself when it runs out of armies, loses the phase, or the turn passes.
watch(legalActions, (actions) => {
  if (!ui.value.territoryClick || !selectedId.value) return;
  if (!isPending.value) return;
  const pairTypes = ui.value.territoryPairTypes ?? ['attack'];
  const tapType = ui.value.territoryTapType;
  const stillUsable = actions.some(a =>
    (pairTypes.includes(a.type) && a.from === selectedId.value)
    || (tapType && a.type === tapType && a.territoryId === selectedId.value));
  if (!stillUsable) selectedId.value = null;
});

// ── group selection & orders (ui.boxSelect) ────────────────────
// A box picks up the acting side's units inside it (GROUP.boxPick); shift adds them to
// the group already in hand instead of replacing it, the way an RTS does.
function handleBoxSelect(box, mods = {}) {
  const team = pendingPlayerId.value ?? viewerTeam.value;
  const picked = GROUP.boxPick(displayUnits.value, box, team);
  const ids = mods.shift ? [...new Set([...groupIds.value, ...picked])] : picked;
  groupIds.value = ids;
  selectUnit(ids[0] ?? null);
}

// What a click means to a group of two or more, as the list of actions to send, or
// null when it means nothing special and should go through the ordinary click path.
//   • a token that some members have an action naming as its target (attack it): each
//     of those members does the first such action it has;
//   • open ground on a continuous map: the group moves there, keeping its shape
//     (GROUP.formationTargets).
// Only on the live position — a fork or a reviewed ply plays one move at a time.
function groupOrderAt({ targetId = null, x = null, y = null }) {
  if (groupIds.value.length < 2 || !isPending.value || !atLatest.value || forking.value) return null;
  if (targetId) {
    const acts = groupIds.value
      .map(id => legalActions.value.find(a => a.unitId === id && a.targetId === targetId))
      .filter(Boolean);
    return acts.length ? acts : null;
  }
  if (props.field.locationType !== 'continuous' || x == null || y == null) return null;
  const members = displayUnits.value.filter(u => groupIds.value.includes(u.id));
  const orders = GROUP.formationTargets(members, { x, y },
    { bounds: { w: props.field.world.w, h: props.field.world.h } });
  return orders.length
    ? orders.map(o => ({ type: 'move', unitId: o.unitId, to: { x: String(o.to.x), y: String(o.to.y) } }))
    : null;
}

// A token clicked on the map: with a group in hand, a click on something it can attack
// is an attack order, not a change of selection. Anything else is a plain click, which
// picks out that one unit — a member of the group included, as in an RTS.
function handleTokenSelect(id) {
  const acts = id && !groupIds.value.includes(id) ? groupOrderAt({ targetId: id }) : null;
  if (acts) { emit('submit-actions', { playerId: pendingPlayerId.value, actions: acts }); return; }
  groupIds.value = [];
  selectUnit(id);
}

function handleSqClick(col, row, x, y, mods) {
  if (placingUnit.value && gamePanels.value?.place(col, row)) return;
  if (props.field.ui?.territoryClick) { handleTerritoryClick(x, y, mods ?? {}); return; }
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
  const groupActs = groupOrderAt({ x, y });
  if (groupActs) {
    emit('submit-actions', { playerId: pendingPlayerId.value, actions: groupActs });
    selectedSquare.value = null; selectedShape.value = null;
    return;
  }
  if ((canMove.value || planning.value) && moveUnitId.value) {
    // Continuous-location maps (see games/coord.js): movement is a straight-line slide to
    // the exact point clicked — no grid to snap to. The server (each game's isActionLegal)
    // is the real authority on walls/occupancy/cost; here we only gate on the unit's move
    // radius so an out-of-range click deselects instead of firing off a certain-reject.
    // The click point goes on the wire as decimal strings (the server parses them to
    // authoritative BigNumbers, see games/coord.js posToWire/parsePos).
    // Games that list 'move' in field.ui.aimedActionTypes (CS) route this through the
    // explicit "Move…" button + aim overlay instead (see startAim/aiming above), so a
    // bare click on a selected unit's own square shouldn't also slide it.
    // `ui.gridDestinations` is the exception to that: a game whose UNITS live at
    // exact points but whose DESTINATIONS are still squares (chess in continuous
    // space — see games/chess/spacetime.js). A free point is not a legal order
    // there, so such a click has to be matched against the enumerated list like
    // any grid game's, even though the tokens are positioned continuously.
    if (props.field.locationType === 'continuous' && !ui.value.gridDestinations
        && !ui.value.aimedActionTypes?.includes('move')
        && x != null && y != null) {
      const u = displayUnits.value.find(un => un.id === selectedId.value);
      if (u && Math.hypot(x - u.x, y - u.y) <= (u.moveRange ?? Infinity)) {
        submitAction({ type: 'move', unitId: selectedId.value, to: { x: String(x), y: String(y) } });
        selectedSquare.value = null; selectedShape.value = null;
        return;
      }
    } else {
      const source = planning.value ? planActions.value : legalActions.value;
      const action = source.find(a => {
        if (a.unitId !== moveUnitId.value) return false;
        const coords = actionGridCoord(a, 'to');
        return coords && coords[0] === col && coords[1] === row;
      });
      if (action) {
        if (planning.value) sendPlan([...plannedMoves.value, action]);
        else submitAction(action);
        selectedSquare.value = null; selectedShape.value = null; return;
      }
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

// Everyone standing on the selected unit's square, top of the stack first (buildField
// lists a square's pieces bottom-up, the order the board draws them in). A stacking
// board shows only the top, so the side panel lists the rest (SquareUnits). Square
// grids only: elsewhere two units never share "a square" to begin with.
const unitsHere = computed(() => {
  const u = selectedUnit.value;
  if (!u || u.dead || u.x == null || !isGridBoard.value) return [];
  const x = Math.floor(u.x), y = Math.floor(u.y);
  return displayUnits.value
    .filter(o => !o.dead && !o.fixture && Math.floor(o.x) === x && Math.floor(o.y) === y)
    .reverse();
});

// Auto-advance to another unit that still wants orders once the selected one no
// longer does (civ1: it used up its moves, or was just given a standing fortify/
// sentry order — see Civ1Game.js's toGrid `needsOrders`). Opt-in via ui.autoAdvanceUnit
// since most games have no such per-unit "still needs orders" concept at all — a plain
// mp-hits-zero check would be wrong for them (see queuingMoves above on why `mp` alone
// isn't a safe cross-game signal). Fires only when the SAME unit's flag goes true→not-
// true, so it never fights a selection the player just made themselves: selecting
// anything else — another unit, or a city — is a selection change, not a unit
// finishing its turn, and used to have its selection yanked straight back to the
// nearest unit still wanting orders.
//
// Except while a fight is on the board (battleFx): a unit that has just attacked has
// finished too, but the board is still showing what its attack did, and centring the
// map on the next unit would pan away from it. The hand-over waits for the fight, and
// for whatever the board plays after it (a winner advancing, in a game where winners
// do), and is dropped if the player picks something meanwhile.
// Only a fight holds it — and a walk into a city, which battleFx also carries: the
// city it took changes colours as the walk lands, and the map should still be on it
// then. An ordinary move's slide is short, and holding the hand-over for every one
// would swallow the next keypress of anyone moving units quickly.
const advanceOff = ref(null);
watch(() => [selectedId.value, selectedUnit.value?.needsOrders],
      ([id, needsOrders], [prevId, prev] = []) => {
  if (!ui.value.autoAdvanceUnit || !isPending.value || id !== prevId
      || prev !== true || needsOrders === true) return;
  if (props.battleFx) { advanceOff.value = id; return; }
  advanceFrom(id);
});
watch([advanceOff, () => props.battleFx, () => props.animating], ([id, fighting, busy]) => {
  if (!id || fighting || busy) return;
  advanceOff.value = null;
  if (selectedId.value === id && isPending.value) advanceFrom(id);
});
function advanceFrom(id) {
  // A unit that has just taken a city hands over once its city screen has been seen
  // (see cityTaken), not while it is still to open.
  if (cityTaken.value?.unitId === id && !cityTaken.value.advance) {
    cityTaken.value = { ...cityTaken.value, advance: true };
    return;
  }
  const next = unitWantingOrders(id);
  if (next) handOverUnit(next);
  else selectedId.value = null;
}

// The player's first unit that still wants orders, skipping `exceptId` — the one that
// just finished, when advancing off it.
function unitWantingOrders(exceptId) {
  return displayUnits.value.find(u =>
    u.team === pendingPlayerId.value && u.needsOrders && u.id !== exceptId) ?? null;
}

// Put that unit in hand and bring it on screen. A unit standing in a city shares its
// square (see selectedCity), so selecting it the plain way would open the city screen
// over the unit instead of handing it over. Going through the garrison pick says this
// selection means the UNIT, which is what a turn handing you one unit after another has
// to mean: the original never answers "your militia is waiting" with a city screen. An
// EMPTY city's token is the city and nothing else (`needsOrders` is only ever stamped on
// a real unit), so that one still selects as a city.
function handOverUnit(u) {
  takeUnit(u);
  centerOn(u.x, u.y);
}

// Picks a unit up by id where it stands — a garrison through garrisonPick, so it
// arrives as the unit rather than as its city screen.
function takeUnit(u) {
  if (u.needsOrders != null && cityAt(Math.floor(u.x), Math.floor(u.y))) selectGarrisonUnit(u.id);
  else selectUnit(u.id);
}

// ...and the same jump at the other end: a turn opens with the first unit that wants
// orders already picked and on screen, the way the original game hands you one unit
// after another. Without it every turn starts by hunting the map for a unit to click,
// and the auto-advance chain — which only ever fires off a unit FINISHING — never gets
// its first link. Armed and fired in two steps like the turn chime above, and for the
// same reason: a bundled AI turn arrives as one update whose battles animate for
// seconds afterwards, and centring the map on your own unit over the top of that yanks
// the view off the fight being shown. Keyed on the turn NUMBER as well as the player,
// because for a seated human the AI seats' turns never take the pending player away:
// the server goes on naming you as the one it waits on, and a whole AI round arrives
// as a single update in which only `turn` has moved. Watching who is to move (as the
// chime above does) therefore sees one unbroken "p1 to move" and would arm exactly
// once, on load. The player stays in the key so a human→human
// handoff inside one turn counts as a new turn too. Both watchers are `immediate`: the
// first so that opening a game already waiting on you hands you a unit, the second
// because that first arming happens while this very setup runs — before a plain
// watcher exists to see it — and the arm would otherwise sit unfired until something
// else happened to move.
// One exception: a unit of yours that still wants orders and is already selected was
// chosen by the player themselves (they ended the turn early with it in hand), so it
// stands rather than being replaced by whichever unit happens to come first.
const preselectFor = ref(null);
watch(() => (isPending.value && ui.value.autoAdvanceUnit
             ? `${pendingPlayerId.value}:${props.liveState?.turn}` : null),
      (key, prev) => { preselectFor.value = key && key !== prev ? pendingPlayerId.value : null; },
      { immediate: true });
watch([preselectFor, () => props.animating, displayUnits], ([pending, busy, unitList]) => {
  if (!pending || busy || !unitList.length) return;
  preselectFor.value = null;
  if (selectedUnit.value?.team === pending && selectedUnit.value.needsOrders) return;
  const first = unitWantingOrders(null);
  if (first) handOverUnit(first);
}, { immediate: true });

// The city standing on a square, if any (a function declaration, not a const, because
// handOverUnit above calls it and one of the watchers that hands a unit over fires while
// this file is still being set up).
function cityAt(x, y) {
  return (props.field.cities ?? []).find(c => c.x === x && c.y === y) ?? null;
}

// A city standing on the selected square (field.cities — see games/civ1/Civ1Game.js for
// the full per-city detail) means the selection is that CITY: the City Inspector overlay
// takes over instead of the generic SelectedUnitDetail sidebar. It is the SQUARE that
// decides, not the token on it, because a game may draw either one there — civ1 draws
// its city, except while a unit garrisoned in it is the piece the turn is waiting on,
// which stands on top — and a click on the square has to open the city screen either way.
//
// …but that means a city and the unit standing in it share one square: two things a
// click could mean, so a unit inside a city could be selected and never *reached* —
// every click on that square put the city screen over it and its orders behind that.
// garrisonPick is the way out: the screen's "Units in City" box picks the unit by id
// (selectGarrisonUnit), and that pick says the selection means the UNIT, so the screen
// closes and leaves it in hand. Any other selection goes through selectUnit and clears
// the pick, which is what lets a click on that same city open its screen again.
const selectedCity = computed(() => {
  const u = selectedUnit.value;
  if (!u || garrisonPick.value === selectedId.value) return null;
  return cityAt(Math.floor(u.x), Math.floor(u.y));
});
// …and a unit in hand that walks INTO a city — its own, or one it is taking — is still
// the unit in hand once it gets there: the square changed under the same selection, so
// it was the unit that moved, not the player picking the city. Without this the move
// that takes a city answers with that city's screen the instant it lands, over the top
// of the unit walking in and the city changing colours; the original only ever shows a
// city screen to a player who asked for one.
watch(() => {
  const u = selectedUnit.value;
  return u && !u.dead && u.x != null ? [u.id, Math.floor(u.x), Math.floor(u.y)] : null;
}, (now, before) => {
  if (!now || !before || now[0] !== before[0]) return;
  if (now[1] !== before[1] || now[2] !== before[2]) garrisonPick.value = now[0];
});

// …except a city it has just TAKEN, whose screen the original does show — once the
// board has shown the unit walking in and the city turning its new owner's colours,
// not over the top of that. `cityTaken` follows one capture through:
//   'walking' — the update that took it has arrived and the board is still playing it;
//   'open'    — the board is done, and the city's screen is up (garrisonPick let go of
//               the unit, so the square selects as the city again — see selectedCity).
// The unit's own turn waits for the screen too: one that spent its last move taking the
// city would otherwise hand over to the next unit the moment the walk lands (see
// advanceFrom), and the screen with it. `advance` remembers that it owes that hand-over,
// paid when the player closes the screen.
// A city changing hands to the side of the unit in hand, with that unit standing in it
// on the board as the server has it (the board on screen may still be walking it there).
watch(() => props.field.cities, (now, before) => {
  const u = selectedUnit.value;
  if (!u || !now || !before) return;
  const was = new Map(before.map(c => [c.id, c.owner]));
  const cells = props.liveState?.grid?.cells ?? [];
  const standsIn = c => cells.some(cell => cell.x === c.x && cell.y === c.y
    && (cell.unitId === u.id || (cell.stack ?? []).some(s => s.unitId === u.id)));
  const taken = now.find(c => was.has(c.id) && was.get(c.id) !== c.owner && c.owner === u.team && standsIn(c));
  if (taken) cityTaken.value = { unitId: u.id, phase: 'walking', advance: false };
});
// A moment after the board settles, so the unit standing in its new city is seen before
// the screen goes up over it.
const CITY_SCREEN_PAUSE_MS = 600;
let cityScreenTimer = null;
watch([cityTaken, () => props.animating, () => props.battleFx], ([taken, busy, fx]) => {
  clearTimeout(cityScreenTimer);
  if (taken?.phase !== 'walking' || busy || fx) return;
  cityScreenTimer = setTimeout(() => {
    if (cityTaken.value !== taken) return;
    // The player picked something else while it played: that is what they want to see.
    if (selectedId.value !== taken.unitId) { cityTaken.value = null; return; }
    garrisonPick.value = null;
    cityTaken.value = { ...taken, phase: 'open' };
  }, CITY_SCREEN_PAUSE_MS);
});
onUnmounted(() => clearTimeout(cityScreenTimer));
// The screen closed (or the player picked something else from it): the unit's turn
// carries on from where the capture left it — on to the next unit if it owed that hand-
// over, else the unit back in hand as itself (a horseman with a move left to make).
watch(selectedCity, (city) => {
  const taken = cityTaken.value;
  if (city || taken?.phase !== 'open') return;
  cityTaken.value = null;
  if (selectedId.value != null && selectedId.value !== taken.unitId) return;
  if (taken.advance) advanceFrom(taken.unitId);
  else if (displayUnits.value.some(u => u.id === taken.unitId && u.needsOrders)) selectGarrisonUnit(taken.unitId);
});
// The city screen paints the city and its units in their owner's colour, the same way
// the board does (see teamSprite.js) — team ids are player ids (App.vue's buildField).
const selectedCityTeam = computed(() =>
  props.field.teams?.find(t => t.id === selectedCity.value?.owner) ?? null);
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
  // Territory-click games (kdice, risk): anything about a territory is issued on the
  // map — select a territory and click its target for a from→to action, or tap one
  // territory for a single-territory action (see handleTerritoryClick) — so the panel
  // drops every action of those types, bulk variants included (Risk's "place all N
  // here" is the same job as N taps), and keeps only what a click can't express:
  // ending a phase, turning in card sets.
  if (ui.value.territoryClick) {
    const pairTypes = ui.value.territoryPairTypes ?? ['attack'];
    const tapType = ui.value.territoryTapType;
    return legalActions.value.filter(a => !pairTypes.includes(a.type) && a.type !== tapType);
  }
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

// A selection means one thing inside a phase (the territory you are placing armies on)
// and something else in the next (the one you are attacking FROM), so it does not carry
// across the boundary — least of all when the game crosses it by itself, as Risk does
// when the last army goes down. Without this the first click of the new phase is spent
// deselecting whatever the old phase left behind, and reads as a click that did nothing.
// Same opt-in as the end-of-turn clear.
watch(() => props.liveState?.phase, (phase, prev) => {
  if (prev != null && phase !== prev && ui.value.clearSelectedAtEndOfTurn) selectedId.value = null;
});

// A queued move fires the moment its turn opens — that is what makes it a QUEUE
// rather than a list of suggestions. It is only fair because the plan can be
// called off at any time, including while the opponent is thinking (it lives
// out-of-band, see plannedMoves above); a plan you could not cancel would be a
// blunder you had to watch yourself commit.
//
// Keyed on the false→true edge of isPending, so it fires once per turn and never
// while reviewing history or exploring a fork (both make plannedMoves empty). If
// the head is no longer legal the server has already dropped the whole plan
// (planQueue's pruneForTurn), so there is nothing here to re-check.
watch(isPending, (now, was) => {
  if (!now || was || ui.value.autoPlayPlan === false) return;
  const head = plannedMoves.value[0];
  if (!head) return;
  const match = legalActions.value.find(a => sameMove(a, head));
  if (match) submitAction(match);
});

function submitAction(action) {
  if (ui.value.clearSelectedAtEndOfTurn) selectedId.value = null;
  // Any deliberate action disarms the follow-up's one-click override, so a shift-click
  // that never met its question (the attack simply bounced) can't answer a later, plain
  // one — the game's own default takes it from there. Actions that DO expect a follow-up
  // re-arm it right after calling this (see handleTerritoryClick).
  followUpMode.value = null;
  // Moving while browsing replay (or already inside a fork) explores a sandbox
  // instead of playing a real move — see forkPlayMove above.
  if (canExplore.value && (forking.value || !atLatest.value)) { forkPlayMove(action); return; }
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

// ── keyboard play ─────────────────────────────────────────────
// Games that want to be playable without a mouse declare their own bindings in
// ui.keys; keyBindings.js turns a keydown into one of the intents handled below and
// knows no game (see its header for the declaration format, and civ1's ui.keys for
// the real one). Everything here goes through the same submitAction/selectUnit/
// centerOn paths the mouse uses, so a key can never do something a click can't.
const PAN_TILES = 5;   // how far one shift+direction press scrolls the map

// The named overview overlay on screen (ActionsPanel owns the components; its own
// toolbar buttons set this too). Held here so a `panel` binding can open one.
const openPanel = ref(null);

// Anything covering the board swallows the board's keys, so 'b' while reading the
// city screen can't found a city underneath it. Escape is handled ahead of this and
// always gets through; panel keys stay live while a panel is up, so the advisor keys
// switch between advisors the way the original's F-keys do.
const overlayOpen = computed(() => !!(infoUnit.value
  || infoAbility.value || openPanel.value || selectedCity.value));

// ── auto end turn ─────────────────────────────────────────────
// Civ1 never had an "end turn" key: the turn ended by itself once every unit had its
// orders. So does this, opt-in via ui.autoEndTurn — but only once you have actually
// DONE something this turn. Without that guard a turn nobody has any orders to give
// (an empire sitting fortified) would end the instant it arrived, and the game would
// play itself out at a turn a frame; with it, a turn you want to spend doing nothing
// still ends the explicit way (Enter / the End Turn button), and that pass is the
// signal that you meant it.
//
// "Acted this turn" is read off the move log rather than tracked here, so a reload
// mid-turn doesn't forget it. Under fog a seat's own entries are always in the log it
// is served (see api-server's fogFilter), which is all this needs.
const actedThisTurn = computed(() => {
  const turn = props.liveState?.turn;
  const me = pendingPlayerId.value;
  if (turn == null || !me) return false;
  return (props.liveState?.log ?? []).some(e => e.turnNumber === turn
    && (e.playerActions ?? []).some(pa => pa.playerId === me));
});

// The end-turn action to fire, or null while anything still wants doing. Waits for a
// clear board — an overlay open (the city screen, an advisor) is someone reading, and
// pulling the turn out from under them lands their next click in the next turn — and
// for playback to settle, so a turn never ends over the top of its own animation.
const autoEndTurnAction = computed(() => {
  if (!ui.value.autoEndTurn || !isPending.value || !atLatest.value || forking.value) return null;
  if (!actedThisTurn.value || props.animating || overlayOpen.value) return null;
  const wanting = displayUnits.value.some(u => !u.dead && u.badge == null
    && u.team === pendingPlayerId.value && u.needsOrders);
  if (wanting) return null;
  return legalActions.value.find(a => a.type === 'end-turn') ?? null;
});

// One auto-end per turn: the submitted action only leaves legalActions once the server
// answers, and until it does this would otherwise re-fire on every unrelated update.
const autoEndedTurn = ref(null);
watch(autoEndTurnAction, (action) => {
  if (!action) return;
  const key = `${pendingPlayerId.value}:${props.liveState?.turn}`;
  if (autoEndedTurn.value === key) return;
  autoEndedTurn.value = key;
  submitAction(action);
}, { flush: 'post' });

// Submit the first available action among `types` (a binding may name several, e.g.
// civ1's I = irrigate here, clear the forest there) for the selected unit, or the
// player-level ones like end-turn. getLegalActions stays the only authority: a key
// whose action isn't legal right now simply does nothing.
function keyAction(types) {
  if (!canMove.value) return false;
  for (const t of types) {
    const action = legalActions.value.find(a => a.type === t &&
      (a.unitId === selectedId.value || a.unitId === '__player__'));
    if (action) { submitAction(action); return true; }
  }
  return false;
}

// One square in a direction with the selected unit: the same resolution clicking that
// square gets (see handleSqClick), plus "move into an enemy to attack it" — the
// mouse equivalent of that is the Attack button in the action list, which is fine
// with a mouse and unreachable as a direction key.
function keyMove(dx, dy) {
  const u = selectedUnit.value;
  if (!u || !canMove.value) return false;
  const w = props.field.world;
  const row = Math.floor(u.y) + dy;
  let col = Math.floor(u.x) + dx;
  if (w.wrap) col = ((col % w.w) + w.w) % w.w;   // civ1's east/west cylinder
  if (col < 0 || col >= w.w || row < 0 || row >= w.h) return false;
  const move = legalActions.value.find(a => {
    if (a.unitId !== u.id) return false;
    const coords = actionGridCoord(a, 'to');
    return coords && coords[0] === col && coords[1] === row;
  });
  if (move) {
    submitAction(move);
    selectedSquare.value = null; selectedShape.value = null;
    return true;
  }
  // Any attack on a piece standing on that square. Matched by every token there rather
  // than one picked out, because the attack's target need not be the piece the board
  // draws: a garrisoned enemy city is drawn as the CITY (a `badge` token that carries
  // the garrison's id), and the game picks a stack's defender itself. A square's own
  // synthetic id never names an attack target, so including it is harmless.
  const here = new Set(displayUnits.value.filter(un => !un.dead
    && Math.floor(un.x) === col && Math.floor(un.y) === row).map(un => un.id));
  const attack = legalActions.value.find(a =>
    a.type === 'attack' && a.unitId === u.id && here.has(a.targetId));
  if (attack) { submitAction(attack); return true; }
  return false;
}

function panBy(dx, dy) {
  if (!zoomEnabled.value) return false;
  const c = center.value ?? { x: props.field.world.w / 2, y: props.field.world.h / 2 };
  centerOn(c.x + dx * PAN_TILES, c.y + dy * PAN_TILES);
  return true;
}

// Picking a unit without a mouse: step to the next one that still wants orders,
// wrapping around, and take the view with it — the same jump the auto-advance
// watcher makes when a unit finishes. `needsOrders` is only meaningful for games
// that stamp it (see civ1's toGrid); elsewhere every unit counts. Once nothing wants
// orders it cycles the player's units anyway, so the key always gets somewhere.
function selectNextUnit() {
  const mine = displayUnits.value.filter(u => !u.dead && u.badge == null && u.team === pendingPlayerId.value);
  const wanting = mine.filter(u => u.needsOrders !== false);
  const pool = wanting.length ? wanting : mine;
  if (!pool.length) return false;
  const at = pool.findIndex(u => u.id === selectedId.value);
  const next = pool[(at + 1) % pool.length];
  // handOverUnit, not selectUnit + centerOn: a unit standing in a city shares its
  // square, and selecting it the plain way opens the city screen over the unit you
  // just asked for (see handOverUnit's note). Stepping through units must hand you
  // units.
  handOverUnit(next);
  return true;
}

// Selecting a city opens the city screen (see selectedCity), so stepping through the
// player's cities is how a keyboard gets at production without clicking each one on
// the map. Same jump CitiesOverlay's rows make.
function selectNextCity() {
  const mine = (props.field.cities ?? []).filter(c => c.owner === pendingPlayerId.value);
  if (!mine.length) return false;
  const at = mine.findIndex(c => c.id === selectedCity.value?.id);
  const next = mine[(at + 1) % mine.length];
  centerOn(next.x + 0.5, next.y + 0.5);
  selectUnit(tokenIdAt(next.x, next.y));
  return true;
}

function keyCommand(command) {
  if (command === 'center') {
    const u = selectedUnit.value;
    if (!u) return false;
    centerOn(u.x, u.y);
    return true;
  }
  if (command === 'next-unit') return canMove.value && selectNextUnit();
  if (command === 'next-city') return selectNextCity();
  if (command === 'help') { showHelp.value = true; return true; }
  return false;
}

// Every open session's board hears every key; this says whether it is ours (see
// sessionScope.js) — only the board on screen, with the keyboard, answers.
const keysLive = useKeysLive();

function onKeyDown(e) {
  if (!keysLive(e)) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'Escape') {
    if (placingUnit.value)       gamePanels.value?.disarm();
    else if (aiming.value)       aiming.value = null;
    else if (infoAbility.value)  infoAbility.value = null;
    else if (infoUnit.value)     infoUnit.value = null;
    else if (openPanel.value)    openPanel.value = null;
    else if (selectedCity.value) selectedId.value = null;   // leave the city screen
    else if (showHelp.value)     showHelp.value = false;
    // Put the piece in hand down. On a map you play by picking units up one after
    // another (civ1), having no way to let go means the only exits are clicking bare
    // ground — which also pans the view out from under you — or giving an order you
    // did not want to give. Escape reaches the menu from an empty board, as before.
    else if (selectedId.value)   deselectUnit();
    else showMenu.value = !showMenu.value;
    return;
  }
  const intent = KEYS.resolve(e, ui.value.keys);
  // What still gets through while something covers the board: nothing at all under the
  // menu or the key list; an advisor key while an advisor is up, so those keys switch
  // between advisors the way the original's F-keys do; on the city screen, commands and
  // advisor keys (step to the next city, leave for an advisor) but no unit orders or
  // movement — there is no unit selected there, only the city.
  const cityScreenOnly = selectedCity.value && !openPanel.value
    && !infoUnit.value && !infoAbility.value;
  const allowed = !overlayOpen.value
    || (openPanel.value && intent?.kind === 'panel')
    || (cityScreenOnly && (intent?.kind === 'command' || intent?.kind === 'panel'));
  if (intent && allowed) {
    const handled =
        intent.kind === 'action'  ? keyAction(intent.types)
      : intent.kind === 'command' ? keyCommand(intent.command)
      : intent.kind === 'panel'   ? ((openPanel.value = intent.panel), true)
      : intent.kind === 'pan'     ? panBy(intent.dx, intent.dy)
      : intent.kind === 'move'    ? keyMove(intent.dx, intent.dy)
      : false;
    // A bound key never falls through to the defaults below even when its action
    // wasn't available: F on a unit that cannot fortify should do nothing, not step
    // the replay. An unusable DIRECTION key is the one exception — with no unit
    // selected the arrows still browse history, as they always have.
    e.preventDefault();
    if (handled || intent.kind !== 'move') return;
  }
  if (e.key === 'ArrowLeft')  goBack();
  else if (e.key === 'ArrowRight') goForward();
  else if (e.key === 'Backspace') {
    // Drops the last queued move. Two mechanics land here, because to the player
    // they are one gesture: the player-level plan while waiting for a turn
    // (games/planQueue.js), and the selected unit's own goto queue on it
    // (games/moveQueue.js — see ActionsPanel's "Undo last queued move" button, the
    // mouse equivalent). ui.moveQueue defaults true.
    if (planning.value && plannedMoves.value.length) {
      e.preventDefault();
      sendPlan(plannedMoves.value.slice(0, -1));
      return;
    }
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
  <!-- The battle screen and its panels' desk side by side: docked, the desk is a
       column beside the screen; floating, it is laid over the whole of it. -->
  <div class="bf-shell">
  <div class="bf-root">

    <div class="bf-main">

      <!-- Left panel: the game, and whatever is selected on its board. -->
      <div class="bf-col bf-col--left">
        <div class="bf-col-body">
          <GameHeader
            :field="field" :liveState="liveState" :isLive="isLive"
            :isDone="isDone" :isPending="isPending" :pendingPlayerId="pendingPlayerId"
            :statusPlayerId="analysisPlayerId"
            :showMenu="showMenu" :ui="ui" :awaitingStep="awaitingStep"
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
          <SquareUnits v-if="selectedUnit && !selectedCity && unitsHere.length > 1"
            :units="unitsHere" :selectedId="selectedId" :field="field"
            @select="takeUnit"/>
          <button v-if="field.shapes?.length || field.hasTerrain"
            class="action-btn bf-inspect-btn" :class="{ 'bf-inspect-btn--on': inspectTerrain }"
            @click="toggleInspectTerrain">
            {{ inspectTerrain ? 'Cancel inspect' : 'Inspect terrain…' }}
          </button>
          <!-- A map that zooms has its orders (and minimap) in panels of their own,
               docked beside the board (GamePanels' hostPanels, below). -->
          <ActionsPanel v-if="isLive && !ordersDocked" v-bind="ordersProps" v-on="ordersOn"/>
        </div>
      </div>

      <!-- Stage -->
      <div ref="stageEl" class="bf-stage-area" :class="{ 'bf-stage-area--placing': placingUnit }" @wheel="handleWheel">
        <div v-if="forking" class="bf-fork-banner">
          <span>Exploring a forked line — not the real game</span>
          <span v-if="forkError" class="bf-fork-err">{{ forkError }}</span>
          <button class="action-btn bf-fork-back" @click="exitFork">← Back to game</button>
        </div>
        <HtmlHexLayer v-if="isHexTerritoryBoard"
          :field="displayField" :fit="fit" :units="renderUnits"
          :selectedId="selectedId" :hoveredId="hoveredId" :activeUnitId="activeUnitId"
          :rdr="rdr"
          :territoryFx="(atLatest && !revealAll) ? territoryFx : {}"
          @sq-click="handleSqClick"/>
        <HtmlIsoLayer v-else-if="ui.isometric && useHtmlRenderer"
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
          :selectedId="selectedId" :blinkUnitId="blinkUnitId" :hoveredId="hoveredId" :activeUnitId="activeUnitId" :fog="fog"
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
          :battleFx="(atLatest && !revealAll) ? battleFx : null"
          @select="selectUnit"
          @sq-click="handleSqClick"
          @set-marker="handleSetMarker"/>
        <SchematicLayer v-else
          :field="displayField" :fit="fit" :units="renderUnits"
          :selectedId="selectedId" :blinkUnitId="blinkUnitId" :hoveredId="hoveredId" :activeUnitId="activeUnitId" :fog="fog"
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
          :boxSelect="!!ui.boxSelect && isLive"
          :selectedIds="groupIds"
          @select="handleTokenSelect"
          @sq-click="handleSqClick"
          @set-marker="handleSetMarker"
          @box-select="handleBoxSelect"/>
      </div>

      <!-- Right sidebar. Games whose map wants the width, and which say what the
           panels here would say somewhere else, drop the whole column with
           ui.showRightSidebar: false — every panel below goes with it, including
           the ones that appear on their own schedule (the database at game over).
           The one control with no other home, the observer's perspective switcher,
           is in the Menu panel too, so hiding this column never strands an observer. -->
      <div v-if="showSidebar" class="bf-col bf-col--right">
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

        <DatabasePanel v-if="databaseShown"
          :enabled="true" :sessionId="liveState.id" :gameName="liveState.game"
          :ply="databasePly" :line="databaseLine" :revision="databaseRevision"
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
          :units="displayUnits" :earlier-log="liveState?.earlierLog ?? []"
          @seek="seekTo"/>

        <AiAnalysisPanel v-if="isLive && showAiAnalysis && liveState?.aiAnalysis"
          :analysis="liveState.aiAnalysis"/>
      </div>
    </div>

    <BottomBar
      :isLive="isLive" :field="field" :tFloat="tFloat" :playing="playing"
      :histPos="histPos" :histLength="histLength" :atLatest="atLatest"
      :isDone="isDone"
      :canReveal="canReveal" :revealAll="revealAll"
      :canUndo="canUndo" :undoTitle="undoTitle"
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
      @toggle-reveal="toggleReveal" @undo="undoMoves"
      @toggle-pause="toggleLivePause" @set-ai-delay="setAiDelay"
      @set-pause-after-playback="$emit('set-pause-after-playback', $event)"
      @step-forward="$emit('step-forward')"
      @toggle-history-play="toggleHistoryPlay"
      @set-playback-speed="$emit('set-playback-speed', $event)"
      @zoom-in="zoomBy(ZOOM_STEP)" @zoom-out="zoomBy(1 / ZOOM_STEP)"/>
  </div>

  <GamePanels ref="gamePanels" v-model:open="openPanels"
    :menu="menuProps" :live-state="liveState" :game-def="gameDef"
    :ui="ui" :game="field.game" :teams="field?.teams ?? []"
    :host-panels="hostPanels" :orders-title="isObserver ? 'Overview' : 'Orders'"
    :orders-subtitle="liveState?.phase ?? ''"
    @menu="onMenu" @arm="placingUnit = $event">
    <template #orders>
      <ActionsPanel v-if="isLive && ordersDocked" v-bind="ordersProps" v-on="ordersOn"/>
    </template>
    <!-- Overview map + jump-to control, for the same games that get zoom/pan. -->
    <template #minimap>
      <Minimap v-if="zoomEnabled"
        :field="displayField" :units="renderUnits" :rdr="rdr"
        :center="viewCenter" :tilePx="tilePx" :stageW="stageW" :stageH="stageH"
        :fog="fog" :revealAll="layerRevealAll" :viewerOverride="perspectiveViewer"
        :exploredTiles="exploredTileSet"
        @goto="handleMinimapGoto"/>
    </template>
  </GamePanels>
  </div>

  <SettingsChangeNotice :live-state="liveState" :game-def="gameDef"/>

  <CityInspectorOverlay :show="!!selectedCity" :city="selectedCity" :productionActions="cityProductionActions"
    :team="selectedCityTeam" :recolor="field.ui?.recolorTeamSprites"
    @close="selectedId = null" @submit="submitAction" @select-unit="selectGarrisonUnit"/>

  <GameOverOverlay
    :isDone="doneShown" :dismissed="dismissedResult" :liveState="liveState"
    :winnerTeam="winnerTeam" :reasonLabel="reasonLabel" :field="field"
    @dismiss="dismissedResult = true"
    @exit="$emit('exit')"
    @new-game="$emit('new-game')"
    :nextScenario="nextScenario"
    @play-next="id => $emit('play-scenario', id)"/>

  <UnitInfoOverlay
    :unit="infoUnit"
    @close="infoUnit = null"
    @open-ability-info="openAbilityInfo"/>

  <AbilityInfoOverlay
    :ability="infoAbility"
    @close="infoAbility = null"/>
</template>

<style scoped>
.bf-shell { height: 100%; display: flex; position: relative; overflow: hidden; }
.bf-root { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.bf-main { flex: 1; min-height: 0; display: flex; overflow: hidden; }
.bf-col { width: 240px; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; background: var(--bg1); }
/* The left column scrolls in .bf-col-body, not as a whole, so anything ever put after
   the body is a footer the scrolling content can never run under. */
.bf-col--left { border-right: 1px solid var(--line); overflow: hidden; }
.bf-col-body { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; }
.bf-col--right { border-left: 1px solid var(--line); }
.bf-stage-area { flex: 1; position: relative; overflow: hidden; }
/* A unit in hand from the Add units panel: the board takes it where clicked. */
.bf-stage-area--placing, .bf-stage-area--placing :deep(*) { cursor: copy !important; }
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
