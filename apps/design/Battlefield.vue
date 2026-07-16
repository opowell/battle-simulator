<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import SchematicLayer    from './SchematicLayer.vue';
import HtmlLayer         from './HtmlLayer.vue';
import IsoLayer          from './IsoLayer.vue';
import GameHeader        from './battlefield/GameHeader.vue';
import SelectedUnitDetail from './battlefield/SelectedUnitDetail.vue';
import SelectedSquareDetail from './battlefield/SelectedSquareDetail.vue';
import ActionsPanel      from './battlefield/ActionsPanel.vue';
import RosterPanel       from './battlefield/RosterPanel.vue';
import UnitsLostPanel    from './battlefield/UnitsLostPanel.vue';
import GameLog           from './battlefield/GameLog.vue';
import AiAnalysisPanel   from './battlefield/AiAnalysisPanel.vue';
import BottomBar         from './battlefield/BottomBar.vue';
import MenuOverlay       from './battlefield/MenuOverlay.vue';
import GameOverOverlay   from './battlefield/GameOverOverlay.vue';
import UnitInfoOverlay   from './battlefield/UnitInfoOverlay.vue';
import HelpOverlay       from './battlefield/HelpOverlay.vue';
import AbilityInfoOverlay from './battlefield/AbilityInfoOverlay.vue';

const props = defineProps({
  liveState:     Object,
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
});
const emit = defineEmits(['exit', 'open-settings', 'submit-action', 'set-marker', 'new-game']);

// ── playback ──────────────────────────────────────────────────
const tFloat  = ref(0);
const playing = ref(false);

// ── view toggles ──────────────────────────────────────────────
const showRuler = ref(false);
const showMenu  = ref(false);
const showHelp  = ref(false);

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

watch(() => props.liveState?.id, () => {
  fieldHistory.value = props.field ? [props.field] : [];
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
  // At the latest ply, follow the live reactive field rather than the frozen history
  // snapshot — the snapshot is captured once, at the instant a move lands, which for
  // games with a hop animation (see App.vue's hopAnim/hopQueue) is mid-animation, still
  // pinned to the pre-move square. Following `field` live lets the animation actually
  // play and settle. Stepping back into history still shows the frozen past snapshot.
  if (atLatest.value) return props.field;
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
  selectedSquare.value = null;
  selectedShape.value = null;
  aiming.value = null;
  inspectTerrain.value = false;
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
  if (id) showRuler.value = ui.value.showRuler ?? true;
}, { immediate: true });

// ── HTML board renderer (opt-in; see HtmlLayer.vue) ────────────
// Local override driven by the live menu toggle: null follows the game's own setting,
// true/false forces the HTML or SVG renderer for this session.
const htmlRenderOverride = ref(null);
// The game's own preference: the `htmlRenderer` game option (live sessions carry it in
// params.config) or a static ui.htmlRenderer flag from the game definition.
const gameHtmlRenderer = computed(() =>
  props.liveState?.params?.config?.htmlRenderer ?? ui.value.htmlRenderer ?? false);
// HtmlLayer only handles square tile grids (not hexes, non-grid shapes or continuous
// maps) — this gates both the toggle's availability and, as a safety net, actual use.
const isGridBoard = computed(() =>
  displayField.value?.grid === 'square'
  && (displayField.value?.tiles?.length ?? 0) > 0
  && !(displayField.value?.shapes?.length));
const useHtmlRenderer = computed(() =>
  isGridBoard.value && (htmlRenderOverride.value ?? gameHtmlRenderer.value));
// Each game starts from its own setting — drop any manual override on game switch.
watch(() => props.liveState?.id, () => { htmlRenderOverride.value = null; });

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

// Chime when control passes to a human — i.e. isPending flips false→true (an AI or the
// other player just finished). The watcher isn't `immediate`, so opening a game that's
// already waiting on you doesn't beep; only an actual transition does. Keying on
// `pendingPlayerId` (not just isPending) also catches the rarer human→human handoff
// (two humans in one session), where isPending stays true across the switch.
watch(() => (isPending.value ? pendingPlayerId.value : null), (pending, prev) => {
  if (pending && pending !== prev) window.playTurnSound?.();
});

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
  if (!isPending.value || !moveUnitId.value) return [];
  return legalActions.value
    .filter(a => a.unitId === moveUnitId.value)
    .map(a => actionGridCoord(a, 'to'))
    .filter(Boolean);
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
  if (isPending.value && moveUnitId.value) {
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
  // clears whatever was selected, same as clicking empty space always has.
  selectedId.value = null;
  selectedShape.value = null;
  selectedSquare.value = null;
}

const selectedUnit = computed(() => displayUnits.value.find(u => u.id === selectedId.value) || null);

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
    if (aiming.value)           aiming.value = null;
    else if (infoAbility.value) infoAbility.value = null;
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
  <div class="bf-root">

    <div class="bf-main">

      <!-- Left panel -->
      <div class="bf-col bf-col--left">
        <GameHeader
          :field="field" :liveState="liveState" :isLive="isLive"
          :isDone="isDone" :isPending="isPending" :pendingPlayerId="pendingPlayerId"
          :showMenu="showMenu" :ui="ui"
          :showRenderer="isGridBoard" :htmlRenderer="useHtmlRenderer"
          @toggle-menu="showMenu = !showMenu"
          @set-renderer="v => htmlRenderOverride = v"
          @show-help="showHelp = true"/>

        <SelectedUnitDetail v-if="selectedUnit"
          :unit="selectedUnit" :field="field" :rdr="rdr"
          @open-info="openInfo"
          @open-ability-info="openAbilityInfo"/>
        <SelectedSquareDetail v-else-if="selectedTerrain" :terrain="selectedTerrain"/>
        <div v-else class="bf-empty">
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
          :unitMoves="unitMoves" :displayedActions="displayedActions"
          :pendingPlayerId="pendingPlayerId" :liveState="liveState" :units="displayUnits"
          :aiming="aiming"
          @submit="submitAction" @aim="startAim" @cancel-aim="cancelAim"/>
      </div>

      <!-- Stage -->
      <div ref="stageEl" class="bf-stage-area">
        <IsoLayer v-if="ui.isometric"
          :field="displayField" :fit="fit" :units="displayUnits"
          :selectedId="selectedId" :activeUnitId="activeUnitId" :fog="fog"
          :rdr="rdr"
          :legalSquares="unitMoves"
          :lastMoveSquares="lastMoveSquares"
          :revealAll="revealAll" :viewerTeam="viewerTeam"
          @select="selectUnit"
          @sq-click="handleSqClick"/>
        <!-- Derives its own integer-snapped geometry from the stage (no `fit` prop) so every
             board cell is a whole number of pixels — see HtmlLayer.vue's header. -->
        <HtmlLayer v-else-if="useHtmlRenderer"
          :field="displayField" :units="displayUnits"
          :selectedId="selectedId" :hoveredId="hoveredId" :activeUnitId="activeUnitId" :fog="fog"
          :showRuler="showRuler" :rdr="rdr"
          :legalSquares="unitMoves"
          :lastMoveSquares="lastMoveSquares"
          :dragToMove="ui.dragToMove ?? false"
          :revealAll="revealAll" :viewerTeam="viewerTeam"
          :selectedEmptySquare="selectedSquare"
          :aiming="aiming"
          @select="selectUnit"
          @sq-click="handleSqClick"
          @set-marker="handleSetMarker"/>
        <SchematicLayer v-else
          :field="displayField" :fit="fit" :units="displayUnits"
          :selectedId="selectedId" :hoveredId="hoveredId" :activeUnitId="activeUnitId" :fog="fog"
          :showRuler="showRuler" :rdr="rdr"
          :unitFx="(atLatest && !revealAll) ? unitFx : {}"
          :territoryFx="(atLatest && !revealAll) ? territoryFx : {}"
          :legalSquares="unitMoves"
          :lastMoveSquares="lastMoveSquares"
          :dragToMove="ui.dragToMove ?? false"
          :revealAll="revealAll" :viewerTeam="viewerTeam"
          :selectedEmptySquare="selectedSquare"
          :selectedShape="selectedShape"
          :aiming="aiming"
          @select="selectUnit"
          @sq-click="handleSqClick"
          @set-marker="handleSetMarker"/>
      </div>

      <!-- Right sidebar -->
      <div class="bf-col bf-col--right">
        <RosterPanel v-if="ui.showRoster !== false"
          :teams="rosterTeams" :selectedId="selectedId" :rdr="rdr" :field="field"
          @select="selectUnit"
          @hover="id => hoveredId = id"/>

        <UnitsLostPanel v-if="ui.showUnitsLost"
          :teams="lostUnitsTeams"/>

        <GameLog v-if="isLive"
          :log="logForDisplay" :historyLength="histLength" :histPos="histPos"
          :units="displayUnits"
          @seek="pos => histPos = pos"/>

        <AiAnalysisPanel v-if="isLive && liveState?.aiAnalysis"
          :analysis="liveState.aiAnalysis"/>
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
</style>
