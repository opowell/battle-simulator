<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import Lobby       from './Lobby.vue';
import GamePage    from './GamePage.vue';
import Battlefield from './Battlefield.vue';

const router = useRouter();
const route  = useRoute();

const THEMES = [
  { id: 'military', label: 'Military', accent: '#42c6e6', teams: ['#4f9dff', '#ff5f56'] },
  { id: 'minimal',  label: 'Minimal',  accent: '#2f6bff', teams: ['#3b7bff', '#ff5a52'] },
  { id: 'retro',    label: 'Retro',    accent: '#39ff88', teams: ['#46c6ff', '#ff5f6e'] },
];

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
// The game whose page is open (/game/:name). Resolved out of apiGames, so a page
// opened by URL before the list has loaded fills itself in once it arrives.
const gameName    = ref('');
const pageGame    = computed(() => apiGames.value.find(g => g.name === gameName.value) ?? null);
const serverErr   = ref('');
const apiLabel    = 'api · ' + window.location.host + window.api.basePath;

// Cached player info for sessions we've created (id → [{id, name, agent}])
const sessionMeta = ref({});

// ── turn animation queue ──────────────────────────────────────
// A single server update can bundle several turns (e.g. a human move plus the
// computer's immediate reply). Each turn becomes one or more "beats" — a move
// hop and/or a burst of combat flashes — queued and played in log order, so a
// later turn never renders (or flashes) ahead of an earlier turn still playing.
// Beats: { kind:'hop', unitId, steps:[{x,y}], slide } | { kind:'fx', flashes:[{unitId,fx}] }
const HOP_STEP_MS = 220;
const FX_BEAT_MS  = 400; // gap before the next beat; the numeral keeps rising into it
// currently-playing hop (for pinning): { unitId, steps, step, frac, slide }. `step` is
// the index of the square the unit is standing on; `frac` is how far it has travelled
// from there toward steps[step + 1], and is always 0 for a hop — only a slide
// (ui.moveAnimation: 'slide') puts a unit between two squares.
const hopAnim  = ref(null);
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

// A colour hold (an entry with blinks: 0 — see the bundleHold pre-population) exists
// only to keep a territory looking un-conquered until the attack beat that flips it
// plays. Once the queue is idle there is no beat left to play, so any hold still
// standing is stale — and unlike a real flash it carries no removal timer of its own.
// Sweeping them here is what stops a captured territory from sitting in its old
// owner's colour indefinitely when no flash claimed it.
function clearColourHolds() {
  const stale = Object.keys(territoryFx.value).filter(tid => !(territoryFx.value[tid].blinks > 0));
  if (!stale.length) return;
  const next = { ...territoryFx.value };
  for (const tid of stale) {
    delete next[tid];
    clearTimeout(territoryFxTimers.get(tid));
    territoryFxTimers.delete(tid);
  }
  territoryFx.value = next;
}

function triggerTerritoryFx(territoryId, blinks, holdOwner, holdLabel = null) {
  if (!territoryId) return;
  territoryFxKey += 1;
  territoryFx.value = { ...territoryFx.value, [territoryId]: { key: territoryFxKey, blinks, holdOwner, holdLabel } };
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
// Wall-clock speed multiplier for every animated playback (this replay, Battlefield's
// history scrub and non-live field playback) — set by the footer's speed control.
const playbackSpeed = ref(1);
function setPlaybackSpeed(v) { playbackSpeed.value = v; }

function replayTurn() {
  const s = liveState.value;
  const frames = s?.playback?.frames;
  if (!frames?.length) return;
  stopReplay();
  replayAnim.value = { frames, idx: 0 };
  // Observer lock-step: stretch the replay across the round's real sim-duration
  // so it plays at natural speed; otherwise use the fixed re-watch speed.
  const spanMs = ((s.observerPaced && s.stepSimTime) ? s.stepSimTime * MS_PER_SIM_SECOND : REPLAY_MS_PER_FRAME * frames.length) / playbackSpeed.value;
  const idealMs = spanMs / frames.length;
  const perFrame = Math.max(16, idealMs);
  // A timer can't tick faster than ~16ms, so past that point the high speeds are
  // honoured by skipping frames rather than by an interval the browser won't keep.
  const stride = Math.max(1, Math.round(perFrame / idealMs));
  replayTimer = setInterval(() => {
    if (!replayAnim.value) return;
    const next = replayAnim.value.idx + stride;
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
// The park is per TURN, not per engine step: a civ1 turn is one step per unit
// action, so parking after every step would ask for a Next press half a dozen
// times a turn — and leave a game that is running normally looking hung. Steps
// inside the turn already on screen ack themselves; the park happens on the step
// that first shows a new turn number (`parkedTurn` is the turn we last parked at).
// Games whose every step is its own turn — and games that expose no turn number —
// park every step, exactly as before.
const pauseAfterPlayback = ref(true);
const awaitingStep = ref(false);
let manualStep = false;
let parkedTurn = null, parkedSeq = -1;

let ackedSeq = -1, shownSeq = -1, shownAt = 0, ackTimer = null;
const animating = () => !!hopAnim.value || fxBusy.value || !!replayAnim.value || animQueue.value.length > 0;
// The same thing as a reactive value, for anything that has to wait out the animation
// rather than poll it — Battlefield holds the "your turn" chime until the board has
// finished showing what the last player did (see its chime watcher).
const animatingNow = computed(() =>
  !!hopAnim.value || fxBusy.value || !!replayAnim.value || animQueue.value.length > 0);
function maybeAckAdvance() {
  const s = liveState.value;
  if (!s || !s.observerPaced || !s.awaitingAdvance || s.status !== 'active') return;
  if (s.seq === ackedSeq) return; // already acked this step
  if (animating()) return;        // still playing the shown step — wait for it
  // Hold the step on screen for its full game-time (stepSimTime) at real speed, so
  // a turn plays at its natural pace even when the animation itself is brief (a
  // one-cell hop is ~0.2s but a csmini action is a whole in-game second). The
  // footer's speed multiplier scales this hold like every other playback it
  // drives: it is the only thing pacing a watched civ1 game (one second per unit
  // action, ~8,300 of them in a 300-turn game), so without it the control leaves
  // the game running at 1× however fast the observer asks for.
  const targetMs = (s.stepSimTime ?? 0) * MS_PER_SIM_SECOND / playbackSpeed.value;
  const elapsed = performance.now() - shownAt;
  if (elapsed < targetMs) {
    clearTimeout(ackTimer);
    ackTimer = setTimeout(maybeAckAdvance, targetMs - elapsed + 5);
    return;
  }
  // Playback finished. In "pause after playback" mode, stop here until the observer
  // clicks Next (which sets manualStep) — but only at a turn boundary, so one Next
  // plays one whole turn (see parkedTurn); otherwise advance automatically.
  // `parkedSeq` keeps the park sticky per step: this runs more than once for the
  // same step (an animation-completion path can reach it before the watcher below
  // has even stamped the step, and that watcher then clears `awaitingStep` and
  // calls in again), and without it the later call would see the new turn already
  // recorded in parkedTurn, take the step for a mid-turn one, and ack the park
  // away — which is exactly what made a watched civ1 game run on unattended.
  const turn = s.turn ?? null;
  if (pauseAfterPlayback.value && !manualStep
      && (parkedSeq === s.seq || turn == null || turn !== parkedTurn)) {
    parkedTurn = turn;
    parkedSeq = s.seq;
    awaitingStep.value = true;
    return;
  }
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
    if (!hopAnim.value && !fxBusy.value && animQueue.value.length === 0) {
      clearColourHolds();
      maybeAckAdvance();
    }
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
        triggerTerritoryFx(tf.territoryId, tf.blinks, tf.holdOwner, tf.holdLabel);
        maxBlinks = Math.max(maxBlinks, tf.blinks);
      }
      // The pause separates one battle from the next. A long tail of them — a bundled
      // AI turn, which the player now waits out before their own turn is announced —
      // plays at a brisker beat, so ten battles take a few seconds rather than twenty.
      const pause = animQueue.value.length > 2 ? TERRITORY_PAUSE_MS / 4 : TERRITORY_PAUSE_MS;
      delay = maxBlinks * TERRITORY_BLINK_MS + pause;
    }
    // The footer's speed control scales this like every other playback it drives, so a
    // player who doesn't want to watch the AI's turn at all can wind it up.
    animTimer = setTimeout(() => { fxBusy.value = false; playNext(); }, delay / playbackSpeed.value);
    return;
  }
  hopAnim.value = { unitId: beat.unitId, steps: beat.steps, step: 0, frac: 0, slide: beat.slide };
  if (beat.slide) startSlide();
  else animTimer = setTimeout(advanceHop, HOP_STEP_MS);
}

function advanceHop() {
  if (!hopAnim.value) return;
  const next = hopAnim.value.step + 1;
  if (next >= hopAnim.value.steps.length) { hopAnim.value = null; playNext(); return; }
  hopAnim.value = { ...hopAnim.value, step: next };
  animTimer = setTimeout(advanceHop, HOP_STEP_MS);
}

// A slide covers the same ground at the same pace as a hop — one HOP_STEP_MS per
// square — but the unit is redrawn at a fractional position every animation frame
// instead of landing square-centre to square-centre. It ends the moment it reaches
// the last square, where a hop still holds that square for a final step.
let slideRaf = 0, slideToken = 0;
function startSlide() {
  const segments = hopAnim.value.steps.length - 1;
  // A single-square "path" is a snap with nothing to traverse (see pushHop's
  // seam crossing) — there is no motion to draw, so don't hold the queue for it.
  if (segments < 1) { hopAnim.value = null; playNext(); return; }
  const token = ++slideToken;
  const duration = Math.max(1, segments * HOP_STEP_MS / playbackSpeed.value);
  const t0 = performance.now();
  const frame = () => {
    if (token !== slideToken || !hopAnim.value) return;
    const p = Math.min(1, (performance.now() - t0) / duration);
    if (p >= 1) { endSlide(token); return; }
    const at = p * segments;
    const step = Math.floor(at);
    hopAnim.value = { ...hopAnim.value, step, frac: at - step };
    slideRaf = requestAnimationFrame(frame);
  };
  // A hidden tab throttles requestAnimationFrame to nothing, which would park this
  // beat — and behind it the whole queue, and an observer game's step ack — until
  // the tab came back. The timer is the backstop that ends the slide regardless.
  animTimer = setTimeout(() => endSlide(token), duration + 250);
  slideRaf = requestAnimationFrame(frame);
}

function endSlide(token) {
  if (token !== slideToken) return;
  slideToken++;
  cancelAnimationFrame(slideRaf);
  clearTimeout(animTimer);
  hopAnim.value = null;
  playNext();
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
  const straightPath = continuous;
  // 'slide' plays the same path as a hop, but continuously — the unit glides across
  // each square instead of blinking from centre to centre (civ1). See startSlide.
  const smooth = (ui.moveAnimation ?? 'hop') === 'slide';
  // Wrapping worlds (civ1's east/west seam — see the `world.wrap` in buildField): a
  // move ACROSS the seam reads as a jump the whole width of the map, and animating it
  // would walk the unit all the way back across every square it didn't cross. Snap it
  // instead, exactly as Battlefield's playback tweening does with the same halfW test.
  const halfW = newState.grid.wrap ? (newState.grid.width ?? 0) / 2 : Infinity;

  // Net position changes A→B (a unit moved twice in a bundle collapses to one hop —
  // matching the pre-sequencing behaviour), unitId -> { from, to }. Each is claimed by
  // the beat it belongs to. A token that is drawn as a board fixture — civ1's city
  // sprite, which carries its garrison's id — is not in here: see boardMoves.js.
  const moved = MOVES.movedTokens(oldState.grid, newState.grid);

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

  // Pre-bundle owner AND army count of every territory (kdice, risk), so a territory
  // under attack keeps showing what it looked like before — its old owner's colour and
  // its old count — until the flash for that attack plays. Without the count, a bundled
  // AI turn gives itself away: every number on the board lands at its final value the
  // instant the update arrives, seconds before the battles that produced it animate.
  // (See territoryFx's holdOwner/holdLabel, read by the renderers' tileColor and token.)
  // Built once per watch fire, not per attack, since one update can bundle several AI
  // turns' worth of attacks — see the bundleHold pre-population below.
  const oldOwnerByTerritory = new Map();
  const oldLabelByTerritory = new Map();
  for (const c of oldState.grid.cells) {
    if (c.territoryId == null) continue;
    if (!oldOwnerByTerritory.has(c.territoryId)) oldOwnerByTerritory.set(c.territoryId, c.owner);
    if (c.label != null && c.label !== '' && !oldLabelByTerritory.has(c.territoryId)) {
      oldLabelByTerritory.set(c.territoryId, c.label);
    }
  }
  const oldOwnerOf = (territoryId) => oldOwnerByTerritory.get(territoryId) ?? null;
  const oldLabelOf = (territoryId) => oldLabelByTerritory.get(territoryId) ?? null;
  // Every territory id on this board. An action counts as a territory attack when it
  // names two of them — whichever field it uses for the attacker (kdice puts it in
  // unitId, risk in from) — so the flash follows the ids, not one game's action shape.
  const territoryIds = new Set(newState.grid.cells.map(c => c.territoryId).filter(t => t != null));

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
  // Prepare a territoryFx entry for all of them (blinks: 0 — no blink, just a colour
  // hold; see the renderers' flashingHexes, which only draws the white overlay for
  // blinks > 0) so they keep their pre-bundle colour until the specific attack beat
  // that changes them plays and overwrites this entry with a real flash.
  // These are only APPLIED below, once we know this update actually has beats to
  // animate: a hold has no timer of its own and is lifted by the animation that
  // follows it, so a hold applied to an update that animates nothing would pin a
  // captured territory to its old owner's colour for good.
  // The count is held for every territory whose count changed, not just the ones that
  // changed hands: armies lost defending a held territory are as much a spoiler as a
  // capture, and they are what most of a Risk bundle consists of.
  const bundleHold = {};
  if (fxOn) {
    const newOwnerByTerritory = new Map();
    const newLabelByTerritory = new Map();
    for (const c of newState.grid.cells) {
      if (c.territoryId == null) continue;
      if (!newOwnerByTerritory.has(c.territoryId)) newOwnerByTerritory.set(c.territoryId, c.owner);
      if (c.label != null && c.label !== '' && !newLabelByTerritory.has(c.territoryId)) {
        newLabelByTerritory.set(c.territoryId, c.label);
      }
    }
    for (const [tid, newOwner] of newOwnerByTerritory) {
      const oldOwner = oldOwnerByTerritory.get(tid);
      const oldLabel = oldLabelByTerritory.get(tid);
      const ownerChanged = oldOwner != null && oldOwner !== newOwner;
      const labelChanged = oldLabel != null && oldLabel !== newLabelByTerritory.get(tid);
      if (!ownerChanged && !labelChanged) continue;
      bundleHold[tid] = {
        key: 0, blinks: 0,
        holdOwner: ownerChanged ? oldOwner : null,
        holdLabel: labelChanged ? oldLabel : null,
      };
    }
  }

  // Build beats in log order: the mover's hop, then this turn's flashes, then any
  // knockback slide of a struck unit — so a bundled reply plays step by step.
  const beats = [];
  const tapFlashes = [];   // territories to blink right away, outside the beat queue
  const claimed = new Set();
  const pushHop = (unitId) => {
    const { from, to } = moved.get(unitId);
    claimed.add(unitId);
    // Seam crossing: nothing to animate, the unit is simply already there.
    if (Math.abs(to.x - from.x) > halfW) return;
    const steps = straightPath ? [from, to] : buildHopPath(from, to, diagonal);
    beats.push({ kind: 'hop', unitId, steps, slide: smooth });
  };
  for (const entry of newEntries) {
    const action = entry.playerActions?.[0]?.action;
    if (hopsOn && action?.unitId && moved.has(action.unitId) && !claimed.has(action.unitId)) pushHop(action.unitId);

    if (fxOn) {
      const flashes = [];
      const territoryFlashes = [];
      // Territory-attack games target a second territory via action.to rather than an
      // events list — flash the whole attacker + defender territory instead of the
      // generic single-unit circle (see the renderers' territoryFx). An attack
      // hard-blinks 3x; a single reinforcement (below) blinks once. The attacker is
      // named by unitId (kdice) or by from (risk); requiring BOTH ends to be real
      // territory ids is what keeps a unit game's attack — whose `to` is a square, not
      // a territory — on the single-unit flash below.
      const attackerTid = FX_ACTION_TYPES.has(action?.type)
        ? [action.unitId, action.from].find(v => territoryIds.has(v)) ?? null
        : null;
      if (attackerTid && territoryIds.has(action.to) && action.to !== attackerTid) {
        territoryFlashes.push(
          { territoryId: attackerTid, blinks: 3, holdOwner: oldOwnerOf(attackerTid), holdLabel: oldLabelOf(attackerTid) },
          { territoryId: action.to, blinks: 3, holdOwner: oldOwnerOf(action.to), holdLabel: oldLabelOf(action.to) },
        );
      } else if (action?.unitId && FX_ACTION_TYPES.has(action.type)) {
        flashes.push({ unitId: action.unitId, fx: { type: 'action', ...fxSquare(action.unitId) } });
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
      // An action naming one territory and nothing else (Risk's place-armies — the
      // click that puts a single army down): blink it once. Everything such an action
      // changes is one digit on one token, which is easy to miss and easy to mistake
      // for a click that didn't land at all. Collected for an IMMEDIATE blink rather
      // than a queued beat: it acknowledges one click and sequences with nothing, and
      // a queued beat would hold up every animation behind it — a capture's flash, and
      // with it the moment the board flips to the new owner's colour.
      if (action?.territoryId && !action.to) tapFlashes.push(action.territoryId);
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

  for (const tid of new Set(tapFlashes)) triggerTerritoryFx(tid, 1, null);

  if (beats.length) {
    if (Object.keys(bundleHold).length) territoryFx.value = { ...territoryFx.value, ...bundleHold };
    animQueue.value = [...animQueue.value, ...beats];
    playNext();
  } else {
    // Nothing to animate for this update — so nothing to hold a colour for, and any
    // hold left from an earlier one has missed its chance to be played out.
    clearColourHolds();
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
  // The seats this session actually has (params.players, in server seat order) —
  // NOT the game's defaultPlayers, which is only the starting shape of the setup
  // form. A session seated past that length (extra slots added on the Configure
  // screen) would otherwise leave its last seats out of `teams` entirely, and the
  // board would paint them with SchematicLayer's no-team grey.
  const defs    = s.params?.players ?? apiGame?.defaultPlayers ?? [];
  const cached  = sessionMeta.value[s.id] ?? [];

  const teams = defs.map((d, i) => {
    const c = cached.find(p => p.id === d.id);
    return {
      id:    d.id,
      name:  c?.name ?? d.name,
      ...teamPalette.seatColorFor(apiGame, i),
    };
  });

  // Fallback: if defs is empty, infer teams from cells
  if (!teams.length) {
    const owners = [...new Set(g.cells.filter(c => c.owner).map(c => c.owner))].sort();
    owners.forEach((o, i) => teams.push({
      id: 'p' + o, name: 'Player ' + o,
      ...teamPalette.seatColorFor(apiGame, i),
    }));
  }

  // Factions a game declares that hold pieces without occupying a seat — nobody plays
  // them, no agent is asked for their orders, and they are not in defaultPlayers, but
  // their pieces still need a name and a colour of their own. A game names them in
  // toGrid's `extraTeams` and gives them owner indices continuing past the seats, so
  // they simply append here. Each supplies its own colours (there is no seat palette
  // slot to take) and falls back to neutral grey if it doesn't.
  for (const t of g.extraTeams ?? []) {
    teams.push({ id: t.id, name: t.name, color: t.color ?? '#8a96a1', raw: t.raw ?? '#8a96a1' });
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
  // Time axis: discrete (a whole-number turn clock) vs continuous (a real-valued
  // clock). Drives the time-jump field's step/precision — see BottomBar's TimeField.
  const timeType = g.timeType ?? s?.params?.config?.time ?? s?.params?.config?.timeType ?? 'discrete';

  // Discrete SQUARE-grid games locate a unit by an integer cell index, rendered at the
  // cell centre (hence +0.5). Hexagon-grid games (kdice) already give cell.x/y as an
  // exact pixel-space hex center (see games/mapTypes/hexagon.js hexToPixel) — adding
  // +0.5 there would shift every unit token half a hex radius off its own hex's center.
  // Continuous games (doom/cs/combatmission — see games/coord.js) carry real positions
  // in a parallel `g.units` channel as decimal strings; a position is already the exact
  // point, so it renders directly with no cell-centre offset either.
  const cellCenterOffset = (locationType === 'continuous' || g.grid === 'hexagon') ? 0 : 0.5;
  // A positioned game (its units come through the parallel g.units channel) that is
  // nonetheless a DISCRETE square-grid board (csmini in discrete space) locates units by
  // an integer cell index too, so it needs the same cell-centre offset as an embedded-cell
  // grid game — otherwise the token sits on the cell's top-left corner. Continuous-space
  // positioned games carry exact points and get no offset.
  const positionedOffset = (boardType === 'grid' && spaceType === 'discrete' && g.grid !== 'hexagon') ? 0.5 : 0;
  const unitSource = locationType === 'continuous'
    ? (g.units ?? []).map(u => ({ src: u, x: Number(u.x) + positionedOffset, y: Number(u.y) + positionedOffset, id: u.id }))
    : g.cells.filter(c => c.glyph).map(c => ({ src: c, x: c.x + cellCenterOffset, y: c.y + cellCenterOffset, id: c.unitId ?? `u_${c.x}_${c.y}` }));

  const units = unitSource
    .map(({ src: c, x, y, id }) => ({
      id,
      team:      ownerTeam[c.owner] ?? (teams[0]?.id ?? 'p1'),
      type:      c.glyph.toLowerCase(),
      name:      c.unitName ?? c.glyph,
      // Explicit token text, when a token stands for a quantity rather than a piece
      // (Risk paints a territory's army count on it). Without one the renderer falls
      // back to the initial of the unit's name, which is what a piece wants.
      label:     c.label ?? null,
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
      // Standing facts about a unit worth naming in its own colour — what group it
      // belongs to, rather than what has happened to it (that's statusEffects). A
      // game's toGrid may set [{ label, color?, title? }]; Risk names the continent a
      // territory is in, in the colour the map paints it.
      tags:          c.tags,
      abilities:     c.abilities,
      equipment:     c.equipment,
      statusEffects: c.statusEffects,
      // Whether this unit still wants orders this turn (a game's toGrid may set this —
      // see Civ1Game.js's `needsOrders`); drives Battlefield.vue's opt-in
      // ui.autoAdvanceUnit feature. Undefined for games with no such concept.
      needsOrders:   c.needsOrders,
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
      // Token size multiplier (default 1 = the standard piece size both renderers pick
      // for the board). A game's toGrid may set it where one token stands for a bigger
      // thing than another — e.g. an SC1 command center vs a marine.
      sizeFrac:      c.sizeFrac,
      // A small count worth SEEING as well as reading — kdice's dice stack. Drawn as a
      // row of dots under the token (see HtmlHexLayer), so a big stack is recognisable
      // without reading the number off it.
      pips:          c.pips,
      // Widens the clickable hit area past the body radius for sprites that draw
      // outside it (see CsGame.js's armor ring and SchematicLayer's u.hitRFrac).
      hitRFrac:      c.hitRFrac,
      description:   c.description,
      job:           c.job,
      moveRange:     c.moveRange,
      // A count that IS the token (e.g. civ1 city size) — a game's toGrid may set this
      // on a glyph cell, and the HTML renderer then draws the token as a badged plaque
      // (see battlefield/HtmlBadgeToken.vue) rather than a marker. badgeLabel names the
      // badged thing where that differs from the unit standing on the square (a garrisoned
      // city is drawn as the city but selects the garrison). Absent for games with
      // nothing to badge.
      badge:         c.badge,
      badgeLabel:    c.badgeLabel,
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
    // Connections between territories that don't share a border — drawn as dashed
    // lines between the two ends (see SchematicLayer). Risk's sea routes are the
    // first user; a game with no such connections leaves this empty.
    hexLinks: g.links ?? [],
    // 'discrete' (integer tile grid) vs 'continuous' (real click-to-point positions,
    // see games/coord.js). Gates the straight-line slide animation, the move-radius
    // circle, and exact-point move submission — replaces the old shapes?.length proxy.
    locationType,
    boardType,
    spaceType,
    positioned,
    timeType,
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
    // Per-owner {icon,value,title,warn} chips for GameHeader's optional status strip
    // (see StatusChips.vue) — a game's toGrid may set this; the design app has no
    // idea what the chips mean, it just renders whatever the game hands it.
    statusChips: g.statusChips ?? null,
    // Optional per-turn label a game may set beside the turn counter in the header —
    // civ1 puts the calendar year there ("3550 BC"). Absent for games where a turn
    // is just a turn.
    turnLabel: g.turnLabel ?? null,
  };
}

const historyFields = ref([]);
// Full (unfiltered) per-ply board + move log for a finished fog game, used by the
// "Reveal all" review toggle. Only fetched once the game is over, so they never leak
// live positions or the opponent's moves mid-game.
const revealFields = ref([]);
const revealLog    = ref([]);

// The resolved board straight from the server grid — no hop/replay animation overrides
// (unlike activeField below). This is the authoritative per-turn snapshot the history
// recorder appends (see Battlefield's fieldHistory watcher), so a live we-go game's
// history holds the real turn-end positions rather than whatever replay frame happened
// to be on screen when the turn resolved. Recomputes only when liveState changes.
const resolvedField = computed(() => {
  const s = liveState.value;
  return s ? buildField(s.grid, s) : null;
});

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
      const { steps, step, frac } = hopAnim.value;
      const a = steps[step], b = steps[step + 1] ?? a;
      const dx = (b.x - a.x) * frac, dy = (b.y - a.y) * frac;
      const unit = { ...u, path: [[a.x + off + dx, a.y + off + dy]] };
      if (!dx && !dy) return unit;
      // Mid-square, so the same two forms of the offset the history scrub carries (see
      // Battlefield's renderUnits): the absolute renderers draw at the fractional point
      // in `path`, while HtmlLayer files each unit into the CSS grid cell it is standing
      // on and translates the sprite by tweenDx/tweenDy — without which the fraction is
      // rounded away and the unit jumps a whole square at a time after all.
      return { ...unit, baseX: a.x + off, baseY: a.y + off, tweenDx: dx, tweenDy: dy };
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
// Which seat we watch the game through. In a hotseat game (every seat human) this
// follows whoever is on the clock, so the board, the fog and the analysis panel all
// belong to the player actually being asked to move — previously it was pinned to
// the first human seat, so on the other seat's turn you were shown one player's fog
// while being advised about the other's position. With a single human seat (the
// ordinary case) it resolves to that seat either way.
function viewAsId(s) {
  const simultaneous = !!s?.params?.config?.simultaneousTurns;
  if (!(s?.fog || simultaneous)) return null;
  const humans = s.humanPlayers ?? [];
  const pending = s.pendingPlayer;
  if (pending && humans.includes(pending)) return pending;
  return humans[0] ?? null;
}

// Re-fetch the snapshot when the seat we should be watching through has changed
// (hotseat: the turn passed to the other player). The server stamps every snapshot
// with the seat it was rendered for, so this compares against that rather than
// guessing — and re-fetching yields the same `viewerId` it asked for, so it settles
// in one hop instead of looping.
async function syncViewer(state) {
  const want = viewAsId(state);
  if (!want || state?.viewerId === want) return state;
  try {
    const fresh = await api.session(state.id, want);
    if (liveState.value?.id === state.id) liveState.value = fresh;
    return fresh;
  } catch { return state; }
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
    if (fresh.pendingPlayer && fresh.humanPlayers?.includes(fresh.pendingPlayer)) {
      stopPoll();
      // The socket was opened for whichever seat we were watching; if the turn has
      // landed on a DIFFERENT human seat (hotseat), that seat's view is the one to show.
      syncViewer(fresh);
    }
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
watch(() => [route.params.id, route.params.name], async ([id, name], [prevId] = []) => {
  if (id) {
    if (liveState.value?.id !== id) await enterSession(id, { push: false });
    return;
  }
  if (prevId) { stopPoll(); liveState.value = null; }
  gameName.value = name ?? '';
  view.value = name ? 'game' : 'lobby';
});

onMounted(async () => {
  await refresh();
  if (route.params.id) await enterSession(route.params.id, { push: false });
  else if (route.params.name) { gameName.value = route.params.name; view.value = 'game'; }
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
// the game is done (revealing earlier would expose hidden pieces mid-game) — or on an
// analysis board, where every seat is the viewer's own and there is nobody to expose
// them to. That one is still being played, so its reveal history has to keep up with
// the moves rather than being fetched once.
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

watch(() => {
  const s = liveState.value;
  if (!s?.fog) return null;
  if (s.status !== 'active') return `${s.id}:done`;
  return s.analysisBoard ? `${s.id}:${s.log?.length ?? 0}` : null;
}, (key, prev) => {
  if (!key) { revealFields.value = []; revealLog.value = []; return; }
  // Same session, one move later (an analysis board being played): keep the frames
  // already on screen until the new ones land. Blanking them first would take the
  // reveal control away mid-move — the board would drop out of "Reveal all" and
  // back into fog with every move, which is exactly what someone studying a
  // position does not want.
  if (key.split(':')[0] !== prev?.split(':')[0]) { revealFields.value = []; revealLog.value = []; }
  loadReveal(liveState.value.id, liveState.value);
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
    // maxTurns is optional: the form leaves it null when the turn limit is off.
    const created = await api.create({ game: cfg.game, players, config: { ...(cfg.maxTurns ? { maxTurns: cfg.maxTurns } : {}), fog: opts.fogOfWar ?? false, ...opts, scenario: cfg.scenario } });
    sessionMeta.value = { ...sessionMeta.value, [created.id]: players };
    await enterSession(created.id);
    refresh();
  } catch (e) { serverErr.value = e.message; }
}

// ── game page ────────────────────────────────────────────────
function openGame(g) {
  gameName.value = g.name;
  view.value = 'game';
  router.push('/game/' + encodeURIComponent(g.name));
}

function leaveGamePage() {
  view.value = 'lobby';
  gameName.value = '';
  router.push('/');
}

// A /game/:name URL for a game the server doesn't serve (renamed, removed, or a
// typo) has no page to show — send it back to the lobby once the list is in.
watch([apiGames, gameName], () => {
  if (view.value === 'game' && gameName.value && apiGames.value.length && !pageGame.value) leaveGamePage();
});

// An ANALYSIS BOARD: a study session with no opponent. Every seat is human (the
// one person at the keyboard moves both sides), which is the condition the
// server puts on the flag, and which is what lets the whole board be revealed
// and the game database stay open while the session is still being played.
//
// Fog goes ON for a game that has one to offer: an analysis board with the fog
// lifted is just a board, and the database's whole question — what did players
// who could see what you can see go on to play — needs the fog to mean anything.
// Everything else — scenario, options, turn limit — is taken from the page's form.
function createAnalysisBoard(cfg) {
  const g = pageGame.value;
  if (!cfg || !g) return;
  const fogged = (g.gameOptions ?? []).some(o => o.id === 'fogOfWar');
  createSession({
    ...cfg,
    gameOpts: { ...cfg.gameOpts, analysisBoard: true, ...(fogged ? { fogOfWar: true } : {}) },
    players:  cfg.players.map(p => ({ ...p, agent: 'human' })),
  });
}

async function submitAction({ playerId, action }) {
  if (!liveState.value) return;
  try {
    // The submit response is rendered for the seat that just moved; in a hotseat
    // game the turn has now passed, so switch to the new player's view.
    let state = await api.action(liveState.value.id, playerId, action);
    liveState.value = state;
    state = await syncViewer(state);
    maybeStartPoll(state);
  } catch (e) { serverErr.value = e.message; }
}

// Concede the match as `playerId`, stopping the run loop and marking the
// session done — works the same for every game since it's a session-level
// operation, not a game move.
async function resign(playerId) {
  if (!liveState.value) return;
  try {
    const state = await api.resign(liveState.value.id, playerId);
    liveState.value = state;
    stopPoll();
  } catch (e) { serverErr.value = e.message; }
}

// Take moves back on an analysis board (Battlefield's Undo). The server rewinds
// the session itself (Session.rewindTo), so anything hanging off the moves that
// just vanished goes with them: a fork branched off a position that may no longer
// exist, and the revealed history, which the fog watcher above re-fetches on its
// own because the log length changed. The shorter log is also what tells
// Battlefield to drop the timeline frames those moves produced — deliberately not
// a /history fetch, which in fog mode would hand over every hidden piece.
async function undoMoves({ toPly, plies } = {}) {
  if (!liveState.value) return;
  const id = liveState.value.id;
  try {
    forkState.value = null;
    forkError.value = '';
    liveState.value = await api.undo(id, { toPly, plies });
    maybeStartPoll(liveState.value);
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

// ── the position being reviewed ─────────────────────────────────
// A past ply as the side to move there saw it: their board and their moves (see
// api-server.js's GET /sessions/:id/position). Battlefield asks for one whenever
// the playhead lands somewhere explorable and renders it instead of its own
// recorded frame — which is one seat's view, taken as that seat moved, and so is
// missing the pieces of whoever moves NEXT. Without this you could step back to a
// black-to-move ply and find no black piece to pick up.
//
// Built here rather than there because turning a raw grid into a display field
// needs App-scoped context (apiGames/sessionMeta), same as activeField.
const plyView = ref(null);
let plyViewSeq = 0;

async function loadPlyView(ply) {
  const id = liveState.value?.id;
  const mine = ++plyViewSeq;
  if (!id || ply == null) { plyView.value = null; return; }
  try {
    const res = await api.positionAt(id, ply);
    if (mine !== plyViewSeq || liveState.value?.id !== id) return;
    plyView.value = { ...res, field: buildField(res.grid, liveState.value) };
  } catch {
    // Refused (a live match) or failed: no position to explore from, which the
    // board reads as "not movable here" — the right outcome either way.
    if (mine === plyViewSeq) plyView.value = null;
  }
}

// ── analysis-panel replay forking ───────────────────────────────
// A "what if" line branched off a live/historical position (Battlefield.vue's
// fork-move emit, AnalysisPanel.vue's select-move — see api-server.js's
// POST /sessions/:id/fork-move). Never touches liveState/the real session.
//
// A LINE, not a position. It keeps every step it has taken — the invented moves
// and the frame each produced — so it can be stepped back through like the game
// itself, and so a different move can be tried from partway down it. Two things
// need that: the history controls (which otherwise appear to do nothing inside a
// fork, since the board would stay pinned to the tip) and the game database,
// which under fog re-derives its whole answer from the line as a HISTORY.
//
//   basePly  the real game's ply this branched off
//   line     the invented moves, in order
//   frames   what each one produced: { field, state, legalActions, activePlayers }
//            — frames[i] is the position after line[i], so the branch point
//            itself is not in here; that one is the real game's own board, which
//            Battlefield already has.
const forkState = ref(null);
const forkError = ref('');

function exitFork() { forkState.value = null; forkError.value = ''; }

// `cursor` says where in the line the move is played from: 0 is the branch point
// (so the line starts over), 1 is after the first invented move, and so on.
// Anything past the cursor is a line the viewer has just walked away from.
async function doForkMove({ ply, cursor = null, playerId, action }) {
  if (!liveState.value) return;
  const cur = forkState.value;
  const at = cursor ?? (cur?.line?.length ?? 0);
  const from = (cur && at > 0) ? cur.frames[at - 1] : null;
  const basePly = cur?.basePly ?? ply;
  try {
    const resp = await api.forkMove(liveState.value.id, {
      // Continuing the line means handing back the state that frame reached;
      // starting it (or restarting it from the branch point) goes by ply.
      forkState: from?.state ?? null,
      ply: from ? null : basePly,
      playerId, action,
    });
    const frame = {
      field: buildField(resp.grid, liveState.value),
      state: resp.state, legalActions: resp.legalActions, activePlayers: resp.activePlayers,
    };
    forkState.value = {
      basePly,
      line:   [...(cur?.line ?? []).slice(0, at), action],
      frames: [...(cur?.frames ?? []).slice(0, at), frame],
    };
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
             @open-game="openGame"
             @delete-session="deleteSession"
             @refresh="refresh"/>
      <GamePage v-else-if="view === 'game'"
                :game="pageGame"
                :disabled="!!serverErr"
                @back="leaveGamePage"
                @create="createSession"
                @analysis-board="createAnalysisBoard"/>
      <Battlefield v-else-if="activeField"
                   :live-state="liveState"
                   :resolved-field="resolvedField"
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
                   :fork-state="forkState"
                   :fork-error="forkError"
                   :ply-view="plyView"
                   :pause-after-playback="pauseAfterPlayback"
                   :awaiting-step="awaitingStep"
                   :animating="animatingNow"
                   :playback-speed="playbackSpeed"
                   @exit="exitBattle"
                   @new-game="restartGame"
                   @open-settings="openSettings"
                   @submit-action="submitAction"
                   @resign="resign"
                   @set-marker="setMarker"
                   @set-paused="p => setControl({ paused: p })"
                   @set-ai-delay="ms => setControl({ aiDelay: ms })"
                   @set-pause-after-playback="setPauseAfterPlayback"
                   @step-forward="stepForward"
                   @set-observer-view="setObserverView"
                   @stop-replay="stopReplay"
                   @fork-move="doForkMove"
                   @exit-fork="exitFork"
                   @view-ply="loadPlyView"
                   @undo="undoMoves"
                   @set-playback-speed="setPlaybackSpeed"/>
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
