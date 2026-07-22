<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import Lobby       from './Lobby.vue';
import Battlefield from './Battlefield.vue';

const router = useRouter();
const route  = useRoute();

const THEMES = [
  { id: 'military', label: 'Military', accent: '#42c6e6', teams: ['#4f9dff', '#ff5f56'] },
  { id: 'minimal',  label: 'Minimal',  accent: '#2f6bff', teams: ['#3b7bff', '#ff5a52'] },
  { id: 'retro',    label: 'Retro',    accent: '#39ff88', teams: ['#46c6ff', '#ff5f6e'] },
];

const TEAM_VARS = ['var(--teamA)', 'var(--teamB)', 'var(--teamC)', 'var(--teamD)'];
const TEAM_RAWS = ['#4f9dff', '#ff5f56', '#46d39a', '#f2b441'];

const theme       = ref(localStorage.getItem('bs_theme') ?? 'military');
const view        = ref('lobby');
const prevView    = ref('lobby');
const liveState   = ref(null);   // raw API session JSON
// Observer perspective: null = full-information ("everyone"), else a playerId to
// watch through that player's own fog-limited view. Only meaningful for observer
// sessions (see isObserverSession / setObserverView).
const observerView = ref(null);
const sessions    = ref([]);     // lobby list from GET /sessions
const apiGames    = ref([]);     // from GET /games
const serverErr   = ref('');
const apiLabel    = 'api · ' + window.location.host + window.api.basePath;

// Cached player info for sessions we've created (id → [{id, name, agent}])
const sessionMeta = ref({});

// ── turn animation queue ──────────────────────────────────────
// A single server update can bundle several turns (e.g. a human move plus the
// computer's immediate reply). Each turn becomes one or more "beats" — a move
// hop and/or a burst of combat flashes — queued and played in log order, so a
// later turn never renders (or flashes) ahead of an earlier turn still playing.
// Beats: { kind:'hop', unitId, steps:[{x,y}] } | { kind:'fx', flashes:[{unitId,fx}] }
const HOP_STEP_MS = 220;
const FX_BEAT_MS  = 400; // gap before the next beat; the numeral keeps rising into it
const hopAnim  = ref(null);  // currently-playing hop { unitId, steps, step } (for pinning)
const animQueue = ref([]);   // pending beats, not yet started
// True from the moment an 'fx' beat starts until its full delay (flashes + any
// pause) has elapsed. Without this, a beat appended to animQueue mid-flight (the
// watcher below calls playNext() as soon as it queues anything) would start
// immediately instead of waiting its turn — invisible back when fx beats only ran
// ~400ms, but a real bug once a territory-flash beat can run ~1900ms.
const fxBusy = ref(false);
let animTimer = null;
let seenLogLength = 0;

// ── combat flashes ────────────────────────────────────────────
// Transient hit feedback keyed by unit id: a white flash on the acting unit, a
// red blink + floating "-N" on a struck unit, a green glow + "+N" on a healed
// one — mirroring the original's damage/heal numerals and hit-blink. Each flash
// carries the board square it fires on (captured when the beat is built) so a
// killing blow still flashes at the victim's last position after it leaves the
// board. Gated per-game by ui.combatFx (see each game's `ui`).
const unitFx = ref({}); // unitId -> { type, amount?, died?, key, x, y }
let fxKey = 0;
const fxTimers = new Map();
// Action types (by unit) that should flash the actor white — i.e. "took an
// action" in the FFTA sense (used a skill), not merely repositioned.
const FX_ACTION_TYPES = new Set(['ability', 'attack', 'cast', 'skill']);

function triggerFx(unitId, fx) {
  if (!unitId || fx.x == null) return;
  fxKey += 1;
  unitFx.value = { ...unitFx.value, [unitId]: { ...fx, key: fxKey } };
  clearTimeout(fxTimers.get(unitId));
  fxTimers.set(unitId, setTimeout(() => {
    const next = { ...unitFx.value };
    delete next[unitId];
    unitFx.value = next;
    fxTimers.delete(unitId);
  }, fx.type === 'action' ? 420 : 780));
}

// Territory-wide flash (kdice): every hex belonging to a territory hard-blinks
// white (no fade — see SchematicLayer's .territory-flash-hex, which steps
// opacity 1/0 rather than easing) instead of a single circle on its capital hex.
// An attack blinks 3x (attacker + defender); placing reinforcements blinks 1x.
// Each blink is one on/off cycle of TERRITORY_BLINK_MS; playNext (below) then
// holds the queue for a further TERRITORY_PAUSE_MS once the blinking ends,
// before the next queued action starts — the "beat" pause the caller asked for.
// holdOwner (attacks only — see oldOwnerOf above) is the pre-attack owner index;
// while a territory's flash entry exists, SchematicLayer keeps painting it that
// colour instead of its true (already-updated) one, so a conquered territory only
// visibly flips to the winner's colour once its flash finishes and this entry
// is removed — not the instant the underlying state changes.
const territoryFx = ref({}); // territoryId -> { key, blinks, holdOwner }
let territoryFxKey = 0;
const territoryFxTimers = new Map();
const TERRITORY_BLINK_MS = 300;
const TERRITORY_PAUSE_MS = 1000;

function triggerTerritoryFx(territoryId, blinks, holdOwner) {
  if (!territoryId) return;
  territoryFxKey += 1;
  territoryFx.value = { ...territoryFx.value, [territoryId]: { key: territoryFxKey, blinks, holdOwner } };
  clearTimeout(territoryFxTimers.get(territoryId));
  territoryFxTimers.set(territoryId, setTimeout(() => {
    const next = { ...territoryFx.value };
    delete next[territoryId];
    territoryFx.value = next;
    territoryFxTimers.delete(territoryId);
  }, blinks * TERRITORY_BLINK_MS));
}

// ── turn replay (simultaneous mode) ───────────────────────────
// The server samples each resolved simultaneous round into evenly spaced
// position frames (liveState.playback — see GameEngine._buildPlayback): units
// glide along their exact resolution-timeline paths. Replay steps through the
// frames on a wall-clock timer, overriding unit positions in activeField, so
// players can re-watch the resolved turn as often as they like.
const REPLAY_MS_PER_FRAME = 100; // 61 frames ≈ 6s per replay (default re-watch speed)
// Wall-clock ms per unit of game-time when an observer plays a turn back at its
// natural pace (liveState.stepSimTime). 1000 = real time: a csmini 5-second turn
// takes 5 seconds on screen instead of finishing instantly.
const MS_PER_SIM_SECOND = 1000;
const replayAnim = ref(null);    // { frames, idx } while replaying
let replayTimer = null;

function replayTurn() {
  const s = liveState.value;
  const frames = s?.playback?.frames;
  if (!frames?.length) return;
  stopReplay();
  replayAnim.value = { frames, idx: 0 };
  // Observer lock-step: stretch the replay across the round's real sim-duration
  // so it plays at natural speed; otherwise use the fixed re-watch speed.
  const spanMs = (s.observerPaced && s.stepSimTime) ? s.stepSimTime * MS_PER_SIM_SECOND : REPLAY_MS_PER_FRAME * frames.length;
  const perFrame = Math.max(16, spanMs / frames.length);
  replayTimer = setInterval(() => {
    if (!replayAnim.value) return;
    const next = replayAnim.value.idx + 1;
    if (next >= replayAnim.value.frames.length) { stopReplay(); return; }
    replayAnim.value = { ...replayAnim.value, idx: next };
  }, perFrame);
}

function stopReplay() {
  if (replayTimer) { clearInterval(replayTimer); replayTimer = null; }
  replayAnim.value = null;
  maybeAckAdvance();
}

// ── observer lock-step ack ────────────────────────────────────
// In observer-paced mode (liveState.observerPaced) the server computes ONE step,
// shows it, then waits for us to finish animating it before computing the next —
// signalled by liveState.awaitingAdvance with a step number `seq`. We ack (POST
// /control { advance: seq }) only once every animation for the shown step has
// settled, so a would-be-instant AI game unfolds at exactly watching speed. `seq`
// guards against a duplicate ack advancing an unwatched step (see api-server.js
// Session._advance).
// "Pause after playback" (observer): when on (default), the game stops after each
// turn's playback and waits for the observer to step forward manually, instead of
// auto-advancing. `awaitingStep` is true while so parked (enables the Next button);
// `manualStep` is the one-shot the Next button sets to release exactly one step.
const pauseAfterPlayback = ref(true);
const awaitingStep = ref(false);
let manualStep = false;

let ackedSeq = -1, shownSeq = -1, shownAt = 0, ackTimer = null;
const animating = () => !!hopAnim.value || fxBusy.value || !!replayAnim.value || animQueue.value.length > 0;
function maybeAckAdvance() {
  const s = liveState.value;
  if (!s || !s.observerPaced || !s.awaitingAdvance || s.status !== 'active') return;
  if (s.seq === ackedSeq) return; // already acked this step
  if (animating()) return;        // still playing the shown step — wait for it
  // Hold the step on screen for its full game-time (stepSimTime) at real speed, so
  // a turn plays at its natural pace even when the animation itself is brief (a
  // one-cell hop is ~0.2s but a csmini action is a whole in-game second).
  const targetMs = (s.stepSimTime ?? 0) * MS_PER_SIM_SECOND;
  const elapsed = performance.now() - shownAt;
  if (elapsed < targetMs) {
    clearTimeout(ackTimer);
    ackTimer = setTimeout(maybeAckAdvance, targetMs - elapsed + 5);
    return;
  }
  // Playback finished. In "pause after playback" mode, stop here until the observer
  // clicks Next (which sets manualStep); otherwise advance automatically.
  if (pauseAfterPlayback.value && !manualStep) { awaitingStep.value = true; return; }
  manualStep = false;
  awaitingStep.value = false;
  ackedSeq = s.seq;
  api.control(s.id, { advance: s.seq }).catch(() => {});
}

// Observer: advance one step now (only meaningful while parked awaiting a step).
function stepForward() { if (awaitingStep.value) { manualStep = true; maybeAckAdvance(); } }
function setPauseAfterPlayback(v) { pauseAfterPlayback.value = v; }
// Turning "pause after playback" off while parked resumes immediately.
watch(pauseAfterPlayback, (v) => { if (!v && awaitingStep.value) maybeAckAdvance(); });

function buildHopPath(from, to, diagonal = false) {
  const path = [{ x: from.x, y: from.y }];
  let { x, y } = from;
  if (diagonal) {
    while (x !== to.x || y !== to.y) {
      if (x !== to.x) x += to.x > x ? 1 : -1;
      if (y !== to.y) y += to.y > y ? 1 : -1;
      path.push({ x, y });
    }
  } else {
    while (x !== to.x) { x += to.x > x ? 1 : -1; path.push({ x, y }); }
    while (y !== to.y) { y += to.y > y ? 1 : -1; path.push({ x, y }); }
  }
  return path;
}

function playNext() {
  if (hopAnim.value || fxBusy.value || animQueue.value.length === 0) {
    // Idle (queue drained, nothing mid-flight) — the shown step has fully
    // animated, so ack it in observer lock-step mode.
    if (!hopAnim.value && !fxBusy.value && animQueue.value.length === 0) maybeAckAdvance();
    return;
  }
  const beat = animQueue.value[0];
  animQueue.value = animQueue.value.slice(1);
  if (beat.kind === 'fx') {
    fxBusy.value = true;
    for (const f of beat.flashes) triggerFx(f.unitId, f.fx);
    let delay = FX_BEAT_MS;
    const territoryFlashes = beat.territoryFlashes ?? [];
    if (territoryFlashes.length) {
      let maxBlinks = 0;
      for (const tf of territoryFlashes) {
        triggerTerritoryFx(tf.territoryId, tf.blinks, tf.holdOwner);
        maxBlinks = Math.max(maxBlinks, tf.blinks);
      }
      delay = maxBlinks * TERRITORY_BLINK_MS + TERRITORY_PAUSE_MS;
    }
    animTimer = setTimeout(() => { fxBusy.value = false; playNext(); }, delay);
    return;
  }
  hopAnim.value = { unitId: beat.unitId, steps: beat.steps, step: 0 };
  animTimer = setTimeout(advanceHop, HOP_STEP_MS);
}

function advanceHop() {
  if (!hopAnim.value) return;
  const next = hopAnim.value.step + 1;
  if (next >= hopAnim.value.steps.length) { hopAnim.value = null; playNext(); return; }
  hopAnim.value = { ...hopAnim.value, step: next };
  animTimer = setTimeout(advanceHop, HOP_STEP_MS);
}

watch(liveState, (newState, oldState) => {
  const log = newState?.log ?? [];
  if (!newState?.grid?.cells || !oldState?.grid?.cells) { seenLogLength = log.length; return; }

  const newEntries = log.slice(seenLogLength);
  seenLogLength = log.length;
  // A new round arrived — any in-progress replay is of a stale turn.
  if (newEntries.length) stopReplay();

  // Simultaneous ("we-go") turns arrive as one package with a sampled kinetic
  // playback of the WHOLE turn — units gliding along their exact paths, bullets in
  // flight (see GameEngine._stepSimultaneous / KineticResolver). When a new turn
  // carries that playback, replay it tick-by-tick instead of the net A→B hop/slide:
  // it is the real per-tick motion, and it's what "play through the turn" means for
  // CS. Turns with no motion (e.g. the instant buy turn) have no playback and fall
  // through to the normal path, so the board just shows their resolved state.
  if (newEntries.length && newState.playback?.frames?.length) {
    replayTurn();
    return;
  }

  const ui = activeField.value?.ui ?? {};
  const hopsOn = (ui.moveAnimation ?? 'hop') !== 'none';
  const fxOn   = !!ui.combatFx;
  const diagonal = ui.allowDiagonalHopsWhileMoving ?? false;
  // Continuous-location maps (doom/cs/combatmission — see games/coord.js) have no grid
  // to hop across: a unit slides in a straight line to the exact point clicked. Their
  // per-unit positions travel in newState.grid.units (real points), not by cell index.
  const continuous = newState.grid.locationType === 'continuous';
  const slide = continuous;

  // Net position changes A→B (a unit moved twice in a bundle collapses to one hop —
  // matching the pre-sequencing behaviour). Each is claimed by the beat it belongs to.
  const moved = new Map(); // unitId -> { from, to }
  if (continuous) {
    const oldUnits = new Map((oldState.grid.units ?? []).map(u => [u.id, u]));
    for (const nu of newState.grid.units ?? []) {
      const ou = oldUnits.get(nu.id);
      if (!ou) continue;
      const from = { x: Number(ou.x), y: Number(ou.y) }, to = { x: Number(nu.x), y: Number(nu.y) };
      if (from.x === to.x && from.y === to.y) continue;
      moved.set(nu.id, { from, to });
    }
  } else {
    for (const newCell of newState.grid.cells) {
      if (!newCell.unitId) continue;
      const oldCell = oldState.grid.cells.find(c => c.unitId === newCell.unitId);
      if (!oldCell || (oldCell.x === newCell.x && oldCell.y === newCell.y)) continue;
      moved.set(newCell.unitId, { from: { x: oldCell.x, y: oldCell.y }, to: { x: newCell.x, y: newCell.y } });
    }
  }

  // Board point of a unit for a flash: its new point if still on the board, else its
  // last-seen point (a slain unit is gone from newState). Square-grid discrete units
  // centre at cell + 0.5 (see buildField); hexagon-grid cells are already exact pixel
  // centers (no offset — see buildField's cellCenterOffset); continuous positions are
  // already exact points too.
  const fxSquare = (id) => {
    if (continuous) {
      const u = (newState.grid.units ?? []).find(u => u.id === id)
             ?? (oldState.grid.units ?? []).find(u => u.id === id);
      return u ? { x: Number(u.x), y: Number(u.y) } : {};
    }
    const c = newState.grid.cells.find(c => c.unitId === id)
           ?? oldState.grid.cells.find(c => c.unitId === id);
    const offset = newState.grid.grid === 'hexagon' ? 0 : 0.5;
    return c ? { x: c.x + offset, y: c.y + offset } : {};
  };

  // Pre-bundle owner of every territory (kdice), so a conquered territory's hexes
  // can keep displaying its old owner's colour throughout the attack flash and
  // only flip to the new colour once the flash ends (see territoryFx's holdOwner,
  // read by SchematicLayer's tileColor/segBorderColor). Built once per watch fire
  // (not per attack) since a single update can bundle several AI turns' worth of
  // attacks — see the bundleHold pre-population below.
  const oldOwnerByTerritory = new Map();
  for (const c of oldState.grid.cells) {
    if (c.territoryId != null && !oldOwnerByTerritory.has(c.territoryId)) oldOwnerByTerritory.set(c.territoryId, c.owner);
  }
  const oldOwnerOf = (territoryId) => oldOwnerByTerritory.get(territoryId) ?? null;

  // playerId → board index (see KDiceGame.toGrid's pidIdx). The raw session JSON
  // has no top-level `players` array — field.teams (built by buildField from
  // apiGames' defaultPlayers) is the client's own ordered player list, index+1
  // already matching the server's pidIdx convention.
  const pidIdxByPlayer = new Map((activeField.value?.teams ?? []).map((t, i) => [t.id, i + 1]));

  // Ownership advanced entry-by-entry through this bundle (starting from the
  // pre-bundle snapshot), so a reinforcement flash reflects what the player
  // owned AT THAT POINT in the turn sequence — not newState's final post-bundle
  // ownership, which could already exclude a territory a later entry in this
  // same bundle went on to capture from them.
  const runningOwner = new Map(oldOwnerByTerritory);
  const territoriesOwnedBy = (playerId) => {
    const idx = pidIdxByPlayer.get(playerId);
    if (idx == null) return [];
    const ids = [];
    for (const [tid, owner] of runningOwner) if (owner === idx) ids.push(tid);
    return ids;
  };

  // A bundled update (e.g. several AI turns played out before control returns to
  // the human) rebuilds `field` from the FINAL post-bundle state right away, so
  // every territory that changes hands anywhere in the bundle would otherwise show
  // its end color immediately — before any of that bundle's attacks have animated.
  // Pre-populate territoryFx for all of them (blinks: 0 — no blink, just a colour
  // hold; see SchematicLayer's flashingHexes, which only draws the white overlay
  // for blinks > 0) so they keep their pre-bundle colour until the specific attack
  // beat that changes them plays and overwrites this entry with a real flash.
  if (fxOn) {
    const newOwnerByTerritory = new Map();
    for (const c of newState.grid.cells) {
      if (c.territoryId != null && !newOwnerByTerritory.has(c.territoryId)) newOwnerByTerritory.set(c.territoryId, c.owner);
    }
    const bundleHold = {};
    for (const [tid, newOwner] of newOwnerByTerritory) {
      const old = oldOwnerByTerritory.get(tid);
      if (old != null && old !== newOwner) bundleHold[tid] = { key: 0, blinks: 0, holdOwner: old };
    }
    if (Object.keys(bundleHold).length) territoryFx.value = { ...territoryFx.value, ...bundleHold };
  }

  // Build beats in log order: the mover's hop, then this turn's flashes, then any
  // knockback slide of a struck unit — so a bundled reply plays step by step.
  const beats = [];
  const claimed = new Set();
  const pushHop = (unitId) => {
    const { from, to } = moved.get(unitId);
    beats.push({ kind: 'hop', unitId, steps: slide ? [from, to] : buildHopPath(from, to, diagonal) });
    claimed.add(unitId);
  };
  for (const entry of newEntries) {
    const action = entry.playerActions?.[0]?.action;
    if (hopsOn && action?.unitId && moved.has(action.unitId) && !claimed.has(action.unitId)) pushHop(action.unitId);

    if (fxOn) {
      const flashes = [];
      const territoryFlashes = [];
      if (action?.unitId && FX_ACTION_TYPES.has(action.type)) {
        // Territory-attack games (e.g. kdice) target a second cell via action.to rather
        // than an events list — flash the whole attacker + defender territory instead
        // of the generic single-unit circle (see SchematicLayer's territoryFx). An
        // attack hard-blinks 3x; a single reinforcement (below) blinks once.
        if (action.to && action.to !== action.unitId) {
          territoryFlashes.push(
            { territoryId: action.unitId, blinks: 3, holdOwner: oldOwnerOf(action.unitId) },
            { territoryId: action.to, blinks: 3, holdOwner: oldOwnerOf(action.to) },
          );
        } else {
          flashes.push({ unitId: action.unitId, fx: { type: 'action', ...fxSquare(action.unitId) } });
        }
      }
      // Reinforcements placed (kdice end-turn) — see KDiceGame.applyActions, which
      // stamps action.result.reinforced (used only to detect that a reinforcement
      // step happened at all). The flash itself covers every territory the player
      // owns, not just the handful that actually got a bonus die, so it reads as
      // "reinforcements were assigned this turn" rather than pointing at specific
      // recipients.
      if (action?.type === 'end-turn' && action.result?.reinforced) {
        const playerId = entry.playerActions?.[0]?.playerId;
        for (const tid of territoriesOwnedBy(playerId)) territoryFlashes.push({ territoryId: tid, blinks: 1 });
      }
      for (const ev of entry.events ?? []) {
        if (ev.type === 'damage')    flashes.push({ unitId: ev.targetId, fx: { type: 'damage', amount: ev.amount, died: ev.died, ...fxSquare(ev.targetId) } });
        else if (ev.type === 'heal') flashes.push({ unitId: ev.targetId, fx: { type: 'heal',   amount: ev.amount, ...fxSquare(ev.targetId) } });
      }
      if (flashes.length || territoryFlashes.length) beats.push({ kind: 'fx', flashes, territoryFlashes });
      // Knockback: a struck unit that also moved slides after the hit lands.
      if (hopsOn) for (const ev of entry.events ?? [])
        if (ev.type === 'damage' && moved.has(ev.targetId) && !claimed.has(ev.targetId)) pushHop(ev.targetId);
    }

    // Advance runningOwner for a won attack so later entries in this same bundle
    // (e.g. that player's own end-turn reinforcement, or another player's attack)
    // see this territory's owner as of here, not the bundle's eventual final state.
    if (action?.type === 'attack' && action.result?.won && action.to) {
      const attackerIdx = pidIdxByPlayer.get(entry.playerActions?.[0]?.playerId);
      if (attackerIdx != null) runningOwner.set(action.to, attackerIdx);
    }
  }
  // Any remaining moved units (e.g. fx off, or moves the log didn't attribute) hop last.
  if (hopsOn) for (const unitId of moved.keys()) if (!claimed.has(unitId)) pushHop(unitId);

  if (beats.length) {
    animQueue.value = [...animQueue.value, ...beats];
    playNext();
  }
});

// Runs AFTER the animation-building watcher above (registration order), so any
// beats/replay for this step are already queued: if the step had nothing to
// animate, we're idle here and ack once its game-time has elapsed; otherwise
// animating() is true and the ack waits for the animation-completion path
// (playNext / stopReplay). Stamp when each new awaiting step first appears so the
// hold-for-sim-time in maybeAckAdvance measures from the right moment.
watch(liveState, (s) => {
  if (s?.observerPaced && s.awaitingAdvance && s.seq !== shownSeq) {
    shownSeq = s.seq;
    shownAt = performance.now();
    awaitingStep.value = false; // fresh step: not yet parked awaiting a manual advance
  }
  maybeAckAdvance();
});

// ── field for the battlefield ────────────────────────────────
function buildField(g, s) {
  if (!g || !s) return null;

  const apiGame = apiGames.value.find(x => x.name === s.game);
  const defs    = apiGame?.defaultPlayers ?? [];
  const cached  = sessionMeta.value[s.id] ?? [];

  const teams = defs.map((d, i) => {
    const c = cached.find(p => p.id === d.id);
    return {
      id:    d.id,
      name:  c?.name ?? d.name,
      color: TEAM_VARS[i] ?? 'var(--teamA)',
      raw:   TEAM_RAWS[i] ?? '#8a96a1',
    };
  });

  // Fallback: if defs is empty, infer teams from cells
  if (!teams.length) {
    const owners = [...new Set(g.cells.filter(c => c.owner).map(c => c.owner))].sort();
    owners.forEach((o, i) => teams.push({
      id: 'p' + o, name: 'Player ' + o,
      color: TEAM_VARS[i] ?? 'var(--teamA)',
      raw:   TEAM_RAWS[i] ?? '#8a96a1',
    }));
  }

  const ownerTeam = {};
  teams.forEach((t, i) => { ownerTeam[i + 1] = t.id; });

  const locationType = g.locationType ?? 'discrete';
  // Two independent axes (see a game's toGrid):
  //   • boardType — how the TERRAIN is drawn: a grid of square cells ('grid') vs
  //     positioned shapes ('continuous', games with a `shapes` array like cs/doom).
  //   • spaceType — how UNITS are placed: snapped to cells ('discrete') vs free
  //     points ('continuous').
  // These are independent: csmini is a GRID board (square cells) whose units may move
  // in continuous space. `positioned` is whether the game supplies a separate
  // positioned unit channel (g.units) instead of embedding units in cells — those
  // need SchematicLayer's absolute placement, so the HTML cell renderer skips them.
  const boardType = g.boardType ?? (g.shapes?.length ? 'continuous' : 'grid');
  const spaceType = g.spaceType ?? locationType;
  const positioned = g.units != null;

  // Discrete SQUARE-grid games locate a unit by an integer cell index, rendered at the
  // cell centre (hence +0.5). Hexagon-grid games (kdice) already give cell.x/y as an
  // exact pixel-space hex center (see games/mapTypes/hexagon.js hexToPixel) — adding
  // +0.5 there would shift every unit token half a hex radius off its own hex's center.
  // Continuous games (doom/cs/combatmission — see games/coord.js) carry real positions
  // in a parallel `g.units` channel as decimal strings; a position is already the exact
  // point, so it renders directly with no cell-centre offset either.
  const cellCenterOffset = (locationType === 'continuous' || g.grid === 'hexagon') ? 0 : 0.5;
  const unitSource = locationType === 'continuous'
    ? (g.units ?? []).map(u => ({ src: u, x: Number(u.x), y: Number(u.y), id: u.id }))
    : g.cells.filter(c => c.glyph).map(c => ({ src: c, x: c.x + cellCenterOffset, y: c.y + cellCenterOffset, id: c.unitId ?? `u_${c.x}_${c.y}` }));

  const units = unitSource
    .map(({ src: c, x, y, id }) => ({
      id,
      team:      ownerTeam[c.owner] ?? (teams[0]?.id ?? 'p1'),
      type:      c.glyph.toLowerCase(),
      name:      c.unitName ?? c.glyph,
      hp:        c.maxHp ?? c.hp ?? 1,
      currentHp: c.hp,
      path:      [[x, y]],
      facing:    c.facing,
      deathTurn: null,
      // Per-unit field-of-vision overrides (see apps/design/vision.js) — a game's toGrid
      // may set these; absent, the unit falls back to the game/default FoV cone + range.
      fov:           c.fov,
      visionRange:   c.visionRange,
      mp:            c.mp,
      maxMp:         c.maxMp,
      // Queued future waypoints ({x,y}[], oldest first) — a game's toGrid may set this
      // (see Civ1Game.js) to support planning several moves ahead; drives both the
      // goto-path overlay on the map (every unit) and the queue list in the side panel
      // (selected unit only). Absent for games with no move-queue mechanic.
      queue:         c.queue ?? [],
      apNow:         c.apNow,
      apMax:         c.apMax,
      stats:         c.stats,
      abilities:     c.abilities,
      equipment:     c.equipment,
      statusEffects: c.statusEffects,
      moved:         c.moved,
      acted:         c.acted,
      isActive:      c.isActive,
      imagePath:     c.imagePath,
      portraitPath:  c.portraitPath,
      mainImagePath: c.mainImagePath,
      // Layered composite sprite (body/hands/held weapon/team ring/equipment badges,
      // each independently offset+rotated) — see apps/design/SchematicLayer.vue's
      // generic renderer and e.g. games/surviv/SurvivGame.js's spriteLayers().
      spriteLayers:  c.spriteLayers,
      description:   c.description,
      job:           c.job,
      moveRange:     c.moveRange,
      // Small corner badge (e.g. civ1 city size) — a game's toGrid may set this on a
      // glyph cell; absent for games with nothing to badge.
      badge:         c.badge,
      // Per-unit money (CS buy phase) — a game's toGrid may set it; drives the buy
      // panel's affordability display. Absent for games with no economy.
      money:         c.money,
      // Fraction of incoming damage this unit shrugs off (see CsGame.js's toGrid) —
      // lets the aiming overlay preview show an estimated "-NN" without the design
      // UI knowing any particular game's armor model.
      damageReduction: c.damageReduction,
    }));

  const tiles = g.cells
    .filter(c => c.color)
    .map(c => ({
      x: c.x, y: c.y, color: c.color, bgImage: c.bgImage ?? null, overlayImage: c.overlayImage ?? null, coastSprite: c.coastSprite ?? null, height: c.height ?? 0, terrain: c.terrain ?? null,
      // Owner index (for the 'team' tile-colour sentinel, see SchematicLayer's tileColor)
      // and the logical territory a hex belongs to (for click-to-select on multi-hex
      // territory maps — see games/mapTypes/hexagon.js and KDiceGame.toGrid).
      owner: c.owner ?? null,
      territoryId: c.territoryId ?? null,
    }));

  return {
    game:  s.game,
    turn:  s.turn ?? null,
    label: `${s.game} · Turn ${s.turn ?? 0}`,
    // wrap: the map is a horizontal cylinder (civ1) — see Civ1Game.toGrid and
    // Battlefield.vue's clampAxis / HtmlLayer.vue's column duplication near the seam.
    world: { w: g.width, h: g.height, wrap: !!g.wrap },
    turns: 1,
    grid:  g.grid ?? 'square',
    // Hex "radius" (center-to-corner) in world units — only set by hexagon-grid
    // games (see games/mapTypes/hexagon.js) — used by SchematicLayer to draw
    // hex polygon tiles instead of square-grid rects.
    hexSize: g.hexSize ?? null,
    // Per-territory outline segments on a hexagon-grid map — only the edges
    // bordering a different territory, so multi-hex blobs get one clean
    // outline instead of a full hex lattice (see KDiceGame.toGrid and
    // games/mapTypes/hexagon.js's territoryBorders).
    hexBorders: g.territoryBorders ?? [],
    // 'discrete' (integer tile grid) vs 'continuous' (real click-to-point positions,
    // see games/coord.js). Gates the straight-line slide animation, the move-radius
    // circle, and exact-point move submission — replaces the old shapes?.length proxy.
    locationType,
    boardType,
    spaceType,
    positioned,
    teams,
    walls: [],
    zones: [],
    tiles,
    // Whether this game's cells carry per-square terrain data — gates click-to-select
    // on empty squares and the terrain-info panel (see Battlefield.vue). Games with
    // uniform terrain (chess, etc.) never populate cell.terrain, so this stays false.
    hasTerrain: tiles.some(t => t.terrain),
    // Non-grid terrain: an array of layered SVG shapes (rectangles + ovals) the game's
    // toGrid emits instead of colouring tiles (see SchematicLayer.vue). Empty for
    // ordinary grid games.
    shapes: g.shapes ?? [],
    // Line-of-sight occluders (opaque tile keys) for the fog renderer — the same wall
    // grid the engine's LOS blocks on, so the drawn vision veil stops at walls instead
    // of bleeding through them (see apps/design/vision.js). Absent ⇒ no occlusion.
    los: g.los ?? null,
    units,
    // A game's toGrid may return a per-state `ui` override (e.g. hideGridLines for shape
    // maps); it layers on top of the game's static ui.
    ui:       { ...(apiGame?.ui ?? {}), ...(g.ui ?? {}) },
    xLabels:  g.xLabels ?? null,
    yLabels:  g.yLabels ?? null,
    // Authoritative fog visibility from the server (computed on the full board). When
    // present the UI must use this rather than re-deriving fog from the filtered board.
    fogVisible: g.visible ? new Set(g.visible.map(([x, y]) => `${x},${y}`)) : null,
    // Server-persisted per-square fog markers (seeded from the last real sighting,
    // freely re-cyclable by the player), so a reload doesn't forget them.
    fogMarkers: g.markers ?? [],
    // Per-owner economy snapshot (civ1's tax/luxury/science rates, gold, government) —
    // keyed by player id; a game's toGrid may set this, absent for games with no
    // per-player economy (see ActionsPanel's rates overlay).
    civ: g.civ ?? null,
    // Every visible city (civ1) — used by the Cities overlay; absent for other games.
    cities: g.cities ?? null,
    // Per-owner military roster (civ1), keyed by player id — used by the Military
    // overlay; absent for other games.
    military: g.military ?? null,
  };
}

const historyFields = ref([]);
// Full (unfiltered) per-ply board + move log for a finished fog game, used by the
// "Reveal all" review toggle. Only fetched once the game is over, so they never leak
// live positions or the opponent's moves mid-game.
const revealFields = ref([]);
const revealLog    = ref([]);

const activeField = computed(() => {
  const s = liveState.value;
  if (!s) return null;
  const field = buildField(s.grid, s);
  if (!field) return null;

  // Units already queued to hop later must stay put at their pre-move square — otherwise
  // they'd render at their (already-applied) final grid position while waiting their turn.
  // Discrete hop steps are cell indices (centre at +0.5); continuous steps are already
  // exact board points (see the move watcher above), so no offset.
  const off = field.locationType === 'continuous' ? 0 : 0.5;
  field.units = field.units.map(u => {
    if (hopAnim.value?.unitId === u.id) {
      const { x, y } = hopAnim.value.steps[hopAnim.value.step];
      return { ...u, path: [[x + off, y + off]] };
    }
    const queued = animQueue.value.find(q => q.kind === 'hop' && q.unitId === u.id);
    if (queued) {
      const { x, y } = queued.steps[0];
      return { ...u, path: [[x + off, y + off]] };
    }
    return u;
  });

  // Turn replay (simultaneous mode): while replaying, every unit renders at its
  // sampled/interpolated position from the current playback frame — this wins
  // over the hop overrides above, since a replay re-enacts the whole round.
  if (replayAnim.value) {
    const frame = replayAnim.value.frames[replayAnim.value.idx];
    const byId = new Map(frame.units.map(u => [u.id, u]));
    field.units = field.units.map(u => {
      const f = byId.get(u.id);
      if (!f || f.x == null) return u;
      return { ...u, path: [[f.x + off, f.y + off]] };
    });
  }

  return field;
});

// ── theme ────────────────────────────────────────────────────
watch(theme, id => {
  document.documentElement.dataset.theme = id;
  const th = THEMES.find(x => x.id === id);
  if (!th) return;
  document.documentElement.style.setProperty('--accent', th.accent);
  document.documentElement.style.setProperty('--teamA',  th.teams[0]);
  document.documentElement.style.setProperty('--teamB',  th.teams[1]);
  localStorage.setItem('bs_theme', id);
}, { immediate: true });

function openSettings() {
  prevView.value = view.value;
  view.value = 'settings';
}
function closeSettings() {
  view.value = prevView.value;
}

// ── live updates ─────────────────────────────────────────────
// A WebSocket subscription pushes state changes instead of the old 2s poll
// (api.subscribeSession falls back to polling internally if the socket drops).
// _sub holds the subscription handle; stopPoll() tears it down.
let _sub = null;

function stopPoll() { if (_sub) { _sub.close(); _sub = null; } }

// Player to view/subscribe as. Fog needs it so the server can filter the board;
// simultaneous-turns needs it so the server can render this player's private
// plan state (their queued orders) during the planning window.
function viewAsId(s) {
  const simultaneous = !!s?.params?.config?.simultaneousTurns;
  return (s?.fog || simultaneous) ? (s.humanPlayers?.[0] ?? null) : null;
}

// A session we watch read-only: it allows observers and we hold no human seat
// (the server auto-connects the creator of an all-AI game as an observer).
function isObserverSession(s) {
  return !!s?.observer || (!!s?.allowObservers && (s?.humanPlayers?.length ?? 0) === 0);
}

function maybeStartPoll(s) {
  stopPoll();
  if (!s || s.status !== 'active') return;
  // Observer: subscribe read-only for the full (delayed) game state; there is no
  // seat to play, so the pending-human short-circuit below doesn't apply.
  if (isObserverSession(s)) {
    _sub = api.subscribeSession(s.id, null, (fresh) => {
      liveState.value = fresh;
      if (fresh.status !== 'active') stopPoll();
    }, true, observerView.value);
    return;
  }
  const pendingHuman = s.pendingPlayer && s.humanPlayers?.includes(s.pendingPlayer);
  if (pendingHuman) return; // human's turn — nothing to wait on
  const humanId = viewAsId(s);
  _sub = api.subscribeSession(s.id, humanId, (fresh) => {
    liveState.value = fresh;
    if (fresh.status !== 'active') { stopPoll(); return; }
    if (fresh.pendingPlayer && fresh.humanPlayers?.includes(fresh.pendingPlayer)) stopPoll();
  });
}

// Switch an observer's perspective: null = full-information view, or a playerId to
// watch through that player's fog-limited view. For a live game we just re-open the
// subscription with the new perspective; for a finished one (no socket, and there's
// no REST endpoint for the full observer view) we one-shot refetch the player view.
function setObserverView(playerId) {
  observerView.value = playerId || null;
  const s = liveState.value;
  if (!s) return;
  if (s.status === 'active') { maybeStartPoll(s); return; }
  if (observerView.value) {
    api.session(s.id, observerView.value)
      .then(fresh => { if (liveState.value?.id === s.id) liveState.value = fresh; })
      .catch(() => {});
  }
}

// ── data loading ─────────────────────────────────────────────
async function refresh() {
  try {
    const [s, g] = await Promise.all([api.sessions(), api.games()]);
    sessions.value  = s;
    apiGames.value  = g;
    serverErr.value = '';
  } catch (e) {
    serverErr.value = e.message;
  }
}

// Sync view when navigating via browser back/forward
watch(() => route.params.id, async (id, prevId) => {
  if (id && liveState.value?.id !== id) {
    await enterSession(id, { push: false });
  } else if (!id && prevId) {
    stopPoll();
    liveState.value = null;
    view.value = 'lobby';
  }
});

onMounted(async () => {
  await refresh();
  if (route.params.id) await enterSession(route.params.id, { push: false });
});

onUnmounted(() => { stopPoll(); stopReplay(); });

// ── session flow ─────────────────────────────────────────────
async function loadHistory(id, state) {
  try {
    const grids = await api.history(id);
    if (liveState.value?.id !== id) return;
    historyFields.value = grids.map(g => buildField(g, state)).filter(Boolean);
  } catch {
    historyFields.value = [];
  }
}

// The /history endpoint returns full unfiltered grids; in fog mode we only fetch it once
// the game is done (revealing earlier would expose hidden pieces mid-game).
async function loadReveal(id, state) {
  try {
    const [grids, log] = await Promise.all([api.history(id), api.log(id)]);
    if (liveState.value?.id !== id) return;
    revealFields.value = grids.map(g => buildField(g, state)).filter(Boolean);
    revealLog.value    = Array.isArray(log) ? log : [];
  } catch {
    revealFields.value = [];
    revealLog.value    = [];
  }
}

watch(() => (liveState.value?.fog && liveState.value?.status !== 'active') ? liveState.value.id : null,
  (id) => {
    revealFields.value = [];
    revealLog.value    = [];
    if (id) loadReveal(id, liveState.value);
  });

async function enterSession(id, { push = true } = {}) {
  historyFields.value = [];
  observerView.value = null; // start every session in the full-information view
  try {
    let state = await api.session(id);
    const humanId = viewAsId(state);
    if (humanId) state = await api.session(id, humanId);
    // An observer session's plain snapshot is fog-blanked (a playerless fog view
    // gets no board); refetch the full observer view so the board shows at once,
    // before the observer socket has even connected.
    else if (isObserverSession(state)) state = await api.sessionObserver(id, observerView.value);
    liveState.value = state;
    view.value = 'battle';
    if (push) router.push('/session/' + id);
    maybeStartPoll(state);
    if (!state.fog) loadHistory(id, state); // skip history in fog mode (would reveal all pieces)
  } catch (e) {
    if (/session not found/i.test(e.message)) {
      router.replace('/');
    } else {
      serverErr.value = e.message;
    }
  }
}

async function openSession(s) {
  await enterSession(s.id);
}

async function createSession(cfg) {
  const apiGame = apiGames.value.find(g => g.name === cfg.game);
  const defs    = apiGame?.defaultPlayers ?? [];
  const players = cfg.players.map((p, i) => ({
    id:    defs[i]?.id ?? ('p' + (i + 1)),
    name:  p.name || defs[i]?.name || ('Player ' + (i + 1)),
    agent: p.agent === 'human' ? 'human' : (p.agent ?? 'random'),
  }));
  try {
    const opts    = cfg.gameOpts ?? {};
    const created = await api.create({ game: cfg.game, players, config: { maxTurns: cfg.maxTurns ?? 500, fog: opts.fogOfWar ?? false, ...opts, scenario: cfg.scenario } });
    sessionMeta.value = { ...sessionMeta.value, [created.id]: players };
    await enterSession(created.id);
    refresh();
  } catch (e) { serverErr.value = e.message; }
}

async function submitAction({ playerId, action }) {
  if (!liveState.value) return;
  try {
    const state = await api.action(liveState.value.id, playerId, action);
    liveState.value = state;
    maybeStartPoll(state);
  } catch (e) { serverErr.value = e.message; }
}

// Live playback controls (pause/resume + AI move delay). The change is applied
// server-side and broadcast to every subscriber; we also patch liveState with the
// returned values so the controls reflect it even when we're not subscribed (e.g.
// during our own turn, where maybeStartPoll leaves no socket open).
async function setControl(patch) {
  if (!liveState.value) return;
  const id = liveState.value.id;
  try {
    const applied = await api.control(id, patch);
    if (liveState.value?.id === id) {
      liveState.value = { ...liveState.value, paused: applied.paused, aiDelay: applied.aiDelay };
    }
  } catch (e) { serverErr.value = e.message; }
}

// Persist a manual fog-square guess server-side so it survives a reload and (via the
// server's WebSocket broadcast) shows up immediately without waiting on a turn to pass.
async function setMarker({ playerId, col, row, type }) {
  if (!liveState.value) return;
  try {
    liveState.value = await api.setMarker(liveState.value.id, playerId, col, row, type);
  } catch (e) { serverErr.value = e.message; }
}

// ── analysis-panel replay forking ───────────────────────────────
// A "what if" sandbox branched off a live/historical position (Battlefield.vue's
// fork-move emit, AnalysisPanel.vue's select-move — see api-server.js's
// POST /sessions/:id/fork-move). Never touches liveState/the real session; holds
// its own display field (built the same way activeField is, from the fork's raw
// grid) plus the raw session-shape bits (state/legalActions/activePlayers)
// Battlefield needs to keep chaining further moves within the same fork.
const forkState = ref(null);
const forkError = ref('');

function exitFork() { forkState.value = null; forkError.value = ''; }

async function doForkMove({ forkState: fs, ply, playerId, action }) {
  if (!liveState.value) return;
  try {
    const resp = await api.forkMove(liveState.value.id, { forkState: fs, ply, playerId, action });
    const field = buildField(resp.grid, liveState.value);
    forkState.value = { field, state: resp.state, legalActions: resp.legalActions, activePlayers: resp.activePlayers };
    forkError.value = '';
  } catch (e) { forkError.value = e.message; }
}

// The real game moving on (or switching sessions entirely) leaves any fork stale —
// it was a detour off one position, not something that follows the game forward.
watch(() => liveState.value?.id, () => { forkState.value = null; forkError.value = ''; });
watch(() => liveState.value?.log?.length ?? 0, () => { forkState.value = null; forkError.value = ''; });

async function deleteSession(id) {
  try { await api.del(id); await refresh(); } catch {}
}

function exitBattle() {
  stopPoll();
  liveState.value = null;
  view.value = 'lobby';
  router.push('/');
  refresh();
}

// Start a fresh game reusing the finished session's exact creation parameters
// (game, players, config), which the server echoes back on liveState.params.
async function restartGame() {
  const params = liveState.value?.params;
  if (!params) return;
  try {
    stopPoll();
    const created = await api.create(params);
    sessionMeta.value = { ...sessionMeta.value, [created.id]: params.players };
    await enterSession(created.id);
    refresh();
  } catch (e) { serverErr.value = e.message; }
}
</script>

<template>
  <div class="app-root">
    <div class="topbar" v-if="view !== 'battle'">
      <div class="brand">
        <span class="mark"><BsIcon name="crosshair" :size="15"/></span>
        BATTLE&nbsp;SIMULATOR
      </div>
      <div class="statuschip" :class="{ 'app-chip--err': serverErr }">
        <span class="pulse" :class="{ 'app-pulse--err': serverErr }"/>
        {{ serverErr ? 'offline' : apiLabel }}
      </div>
      <div class="app-spacer"/>
      <span class="mono app-games">
        {{apiGames.length}} games
      </span>
      <button class="iconbtn app-settings-btn" @click="openSettings" title="Settings">
        <BsIcon name="sliders" :size="15" color="var(--dim)"/>
      </button>
    </div>

    <div class="app-body">
      <div v-if="view === 'settings'" class="app-settings">
        <div class="app-settings-inner">
          <div class="app-settings-head">
            <button class="btn btn-ghost btn-sm" @click="closeSettings">
              <BsIcon name="back" :size="13" color="var(--dim)"/> Back
            </button>
            <span class="up app-settings-title">Settings</span>
          </div>
          <div class="panel">
            <div class="panel-h"><span class="panel-t">Theme</span></div>
            <div class="panel-b app-theme-list">
              <button v-for="th in THEMES" :key="th.id"
                      :class="['scenrow', 'app-theme-row', theme === th.id && 'sel']"
                      @click="theme = th.id">
                <div class="scenmark">
                  <div class="app-swatch app-swatch--accent" :style="{background:th.accent}"/>
                </div>
                <div>
                  <div class="app-theme-label">{{th.label}}</div>
                  <div class="mono app-theme-id">{{th.id}}</div>
                </div>
                <div class="app-team-swatches">
                  <div v-for="c in th.teams" :key="c" class="app-swatch app-swatch--team" :style="{background:c}"/>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>

      <Lobby v-else-if="view === 'lobby'"
             :sessions="sessions"
             :api-games="apiGames"
             :server-err="serverErr"
             @open-session="openSession"
             @create="createSession"
             @delete-session="deleteSession"
             @refresh="refresh"/>
      <Battlefield v-else-if="activeField"
                   :live-state="liveState"
                   :observer-view="observerView"
                   :field="activeField"
                   :unit-fx="unitFx"
                   :territory-fx="territoryFx"
                   :history-fields="historyFields"
                   :reveal-fields="revealFields"
                   :reveal-log="revealLog"
                   :theme="theme"
                   :fog="liveState?.fog ?? false"
                   :games-count="apiGames.length"
                   :server-err="serverErr"
                   :can-replay-turn="!!liveState?.playback"
                   :replaying="!!replayAnim"
                   :fork-state="forkState"
                   :fork-error="forkError"
                   :pause-after-playback="pauseAfterPlayback"
                   :awaiting-step="awaitingStep"
                   @exit="exitBattle"
                   @new-game="restartGame"
                   @open-settings="openSettings"
                   @submit-action="submitAction"
                   @set-marker="setMarker"
                   @set-paused="p => setControl({ paused: p })"
                   @set-ai-delay="ms => setControl({ aiDelay: ms })"
                   @set-pause-after-playback="setPauseAfterPlayback"
                   @step-forward="stepForward"
                   @set-observer-view="setObserverView"
                   @replay-turn="replayTurn"
                   @fork-move="doForkMove"
                   @exit-fork="exitFork"/>
      <div v-else class="app-loading">
        Loading…
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-root { height: 100vh; display: flex; flex-direction: column; }
.app-chip--err { border-color: var(--danger); color: var(--danger); }
.app-pulse--err { background: var(--danger); animation-play-state: paused; }
.app-spacer { flex: 1; }
.app-games { font-size: 11px; color: var(--faint); }
.app-settings-btn { color: var(--dim); }
.app-body { flex: 1; min-height: 0; }
.app-settings { height: 100%; overflow-y: auto; padding: 32px 24px; display: flex; align-items: flex-start; justify-content: center; }
.app-settings-inner { width: 100%; max-width: 480px; display: flex; flex-direction: column; gap: 20px; }
.app-settings-head { display: flex; align-items: center; gap: 14px; }
.app-settings-title { font-size: 12px; font-weight: 700; letter-spacing: .12em; }
.app-theme-list { display: flex; flex-direction: column; gap: 8px; }
.app-theme-row { text-align: left; }
.app-theme-label { font-size: 14px; font-weight: 600; }
.app-theme-id { font-size: 11px; color: var(--dim); }
.app-team-swatches { display: flex; gap: 5px; align-items: center; }
.app-swatch { border-radius: 50%; }
.app-swatch--accent { width: 14px; height: 14px; }
.app-swatch--team { width: 16px; height: 16px; }
.app-loading { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--dim); }
</style>
