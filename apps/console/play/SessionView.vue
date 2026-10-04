<script setup>
// One session being played, inside the console: the board (Battlefield) and
// everything that keeps it in step with the server — the subscription, the turn
// animations, history, forks. The console opens one per session tab and keeps it
// alive while the tab is behind another (see SessionFrames), so `active` says
// whether this one is the one on screen, and only that one answers the keyboard.
import { ref, computed, watch, onMounted, onUnmounted, provide } from 'vue';
import Battlefield from './Battlefield.vue';
import { nextScenarioRequest } from '../sessions.js';
import { KEYS_LIVE, OVERLAY_TARGET } from './sessionScope.js';

const props = defineProps({
  sessionId: { type: String, required: true },
  /** On screen, in front: the one session that takes the keyboard. */
  active:    { type: Boolean, default: false },
});
// open-session: (id, { replace }) — a session started from this one (a rematch, the
// next scenario), which `replace` puts in this one's place. close: leave the game.
const emit = defineEmits(['open-session', 'close']);

// A key is this session's to answer only while it is on screen, and only when the
// keyboard is with the game: on something inside it, or nowhere in particular
// (body). A key pressed with the console's tab strip focused belongs to the strip.
const rootEl = ref(null);
provide(KEYS_LIVE, (e) => props.active
  && (!e || e.target === document.body || !!rootEl.value?.contains(e.target)));
// Overlays (the city screen, advisors, game over) open inside this session's own
// root rather than on the page's body — see sessionScope.js.
provide(OVERLAY_TARGET, rootEl);

const liveState   = ref(null);   // raw API session JSON
// Observer perspective: null = full-information ("everyone"), else a playerId to
// watch through that player's own fog-limited view. Only meaningful for observer
// sessions (see isObserverSession / setObserverView).
const observerView = ref(null);
const apiGames    = ref([]);     // from GET /games
const serverErr   = ref('');

// ── turn animation queue ──────────────────────────────────────
// A single server update can bundle several turns (e.g. a human move plus the
// computer's immediate reply). Each turn becomes one or more "beats" — a move
// hop and/or a burst of combat flashes — queued and played in log order, so a
// later turn never renders (or flashes) ahead of an earlier turn still playing.
// Beats: { kind:'hop', hops:[{unitId, steps:[{x,y}], times?:[0..1]}], slide, durationMs? }
//      | { kind:'fx', flashes:[{unitId,fx}] }
//      | { kind:'battle', battle, spec }   (one fight — see ui.battleAnimation below)
//
// A hop beat carries a LIST of movers, not one, because a beat is an instant and
// some games move more than one piece in it. A turn-based game gives every mover a
// beat of its own, so they play one after another; a game whose moves all run on
// one clock (ui.simultaneousMotion — chess's continuous-time quadrants, where both
// sides order into the same instant and the clock then runs for everyone at once)
// puts the whole instant in ONE beat, so the pieces travel together on screen the
// way they travelled together in the game.
const HOP_STEP_MS = 220;
const FX_BEAT_MS  = 400; // gap before the next beat; the numeral keeps rising into it
// currently-playing hop (for pinning): { hops, step, p, slide }. A HOP walks whole
// squares, so `step` is the index of the one every mover in the beat is standing on,
// clamped per unit to its own path's last. A SLIDE is continuous, so `p` is how far
// through the beat it is (0-1) and each mover is placed along its own path by that.
const hopAnim  = ref(null);
// A mover's pose within the beat on screen: the square it is standing on, the one it
// is heading for, and how far between them it is. A path shorter than the beat's
// longest simply parks on its final square.
function hopPose(hop, anim) {
  const pts = hop.steps, last = pts.length - 1;
  if (!anim.slide || last < 1) {
    const step = Math.min(anim.step ?? 0, last);
    return { a: pts[step], b: pts[step + 1] ?? pts[step], frac: 0 };
  }
  const p = Math.min(1, Math.max(0, anim.p ?? 0));
  // `times` (from the game's own record of the journey — see grid.motion) says WHEN
  // the piece was at each point. A piece is not evenly spread along its own route: it
  // can set off late, stop early, or walk legs of different lengths, and spacing the
  // points evenly would slide it through all of that at one made-up speed. Without
  // times the path is all the beat knows, so the legs share the time equally.
  const times = hop.times;
  let i = 0;
  if (times) while (i < last - 1 && times[i + 1] <= p) i++;
  else i = Math.min(last - 1, Math.floor(p * last));
  const t0 = times ? times[i] : i / last;
  const t1 = times ? times[i + 1] : (i + 1) / last;
  const frac = t1 > t0 ? Math.min(1, Math.max(0, (p - t0) / (t1 - t0))) : (p >= t1 ? 1 : 0);
  return { a: pts[i], b: pts[i + 1], frac };
}
const hopFor = (beat, unitId) => beat?.hops?.find(h => h.unitId === unitId) ?? null;
const animQueue = ref([]);   // pending beats, not yet started

// ── battles ───────────────────────────────────────────────────
// A game that declares ui.battleAnimation has its fights played out the way the old
// strategy games played them (civ1's is the 1991 original's): the attacker slides
// `lunge` of a square toward the square it attacks, is put straight back, and then
// the `frames` of an explosion play over whoever lost, which is still standing there
// underneath until the last frame — only then is it gone. The fights come from the
// board's own running record (grid.battles — see boardMoves.js newBattles), not the
// log, since a fogged player's log never shows them the moves that hit them.
//   spec:   { lunge (fraction of a square), lungeMs, frames: [imagePath…], frameMs }
//   battle: { id, from, at, won, attacker, defender } — the fighters as board tokens
// The fight on screen, while there is one: which beat, and how far into it — the
// lunge (`p` 0-1 of the way out) or the explosion (`frame`, an index into frames).
const battleAnim = ref(null);   // { beat, phase: 'lunge'|'blast', p, frame }
// The shift (in squares) a lunge puts on its attacker at `p` of the way out: along
// each axis toward the target, as the original steps its sprite pixel by pixel. A
// wrapping world's seam is crossed the short way round, so an attack across it
// lunges over the seam rather than back across the whole map.
function lungeShift(battle, spec, p, world) {
  let dx = battle.at.x - battle.from.x;
  const dy = battle.at.y - battle.from.y;
  if (world?.wrap && Math.abs(dx) > world.w / 2) dx -= Math.sign(dx) * world.w;
  const reach = (spec.lunge ?? 0.5) * p;
  return { dx: Math.sign(dx) * reach, dy: Math.sign(dy) * reach };
}
const battleBeats = () => [
  ...(battleAnim.value ? [battleAnim.value.beat] : []),
  ...animQueue.value.filter(q => q.kind === 'battle'),
];
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
const animating = () => !!hopAnim.value || fxBusy.value || !!battleAnim.value || !!replayAnim.value || animQueue.value.length > 0;
// The same thing as a reactive value, for anything that has to wait out the animation
// rather than poll it — Battlefield holds the "your turn" chime until the board has
// finished showing what the last player did (see its chime watcher).
const animatingNow = computed(() =>
  !!hopAnim.value || fxBusy.value || !!battleAnim.value || !!replayAnim.value || animQueue.value.length > 0);
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
  if (hopAnim.value || fxBusy.value || battleAnim.value || animQueue.value.length === 0) {
    // Idle (queue drained, nothing mid-flight) — the shown step has fully
    // animated, so ack it in observer lock-step mode.
    if (!hopAnim.value && !fxBusy.value && !battleAnim.value && animQueue.value.length === 0) {
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
  if (beat.kind === 'battle') { startBattle(beat); return; }
  hopAnim.value = { hops: beat.hops, step: 0, p: 0, slide: beat.slide, durationMs: beat.durationMs };
  if (beat.slide) startSlide();
  else animTimer = setTimeout(advanceHop, HOP_STEP_MS);
}

// The squares the longest path in a beat has to walk through — what paces the beat.
// Movers with a shorter path arrive first and hold their last square (see hopPose).
const beatSegments = (anim) => Math.max(...anim.hops.map(h => h.steps.length - 1), 0);

function advanceHop() {
  if (!hopAnim.value) return;
  const next = hopAnim.value.step + 1;
  if (next > beatSegments(hopAnim.value)) { hopAnim.value = null; playNext(); return; }
  hopAnim.value = { ...hopAnim.value, step: next };
  animTimer = setTimeout(advanceHop, HOP_STEP_MS);
}

// A slide covers the same ground at the same pace as a hop — one HOP_STEP_MS per
// square — but the unit is redrawn at a fractional position every animation frame
// instead of landing square-centre to square-centre. It ends the moment it reaches
// the last square, where a hop still holds that square for a final step.
let slideRaf = 0, slideToken = 0;
function startSlide() {
  const segments = beatSegments(hopAnim.value);
  // A single-square "path" is a snap with nothing to traverse (see pushHop's
  // seam crossing) — there is no motion to draw, so don't hold the queue for it.
  if (segments < 1) { hopAnim.value = null; playNext(); return; }
  const token = ++slideToken;
  // A beat that knows how long its instant lasted (a clock game — see the watcher's
  // `spanMs`) is played out over that, so every mover in it covers its own distance
  // in the same wall time and the fast pieces visibly outrun the slow ones. Otherwise
  // it is paced by distance, at one square per HOP_STEP_MS.
  const duration = Math.max(1, (hopAnim.value.durationMs ?? segments * HOP_STEP_MS) / playbackSpeed.value);
  const t0 = performance.now();
  const frame = () => {
    if (token !== slideToken || !hopAnim.value) return;
    const p = Math.min(1, (performance.now() - t0) / duration);
    if (p >= 1) { endSlide(token); return; }
    hopAnim.value = { ...hopAnim.value, p };
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

// One fight (see battleAnim above): the lunge out, redrawn every animation frame like
// a slide, then the explosion a frame at a time. The attacker is back home the moment
// the lunge ends — the original does not slide it back. Both halves scale with the
// footer's playback speed, and the lunge has the same hidden-tab backstop as a slide.
let battleRaf = 0, battleToken = 0;
function startBattle(beat) {
  const token = ++battleToken;
  const { spec } = beat;
  const lungeMs = Math.max(1, (spec.lungeMs ?? 400) / playbackSpeed.value);
  const frameMs = Math.max(1, (spec.frameMs ?? 72) / playbackSpeed.value);
  const frames = spec.frames ?? [];
  battleAnim.value = { beat, phase: 'lunge', p: 0, frame: -1 };
  const blast = (i) => {
    if (token !== battleToken) return;
    if (i >= frames.length) {
      battleToken++;
      battleAnim.value = null;
      playNext();
      return;
    }
    battleAnim.value = { beat, phase: 'blast', p: 0, frame: i };
    animTimer = setTimeout(() => blast(i + 1), frameMs);
  };
  let lunged = false;
  const struck = () => {
    if (lunged || token !== battleToken) return;
    lunged = true;
    cancelAnimationFrame(battleRaf);
    clearTimeout(animTimer);
    blast(0);
  };
  const t0 = performance.now();
  const frame = () => {
    if (lunged || token !== battleToken) return;
    const p = Math.min(1, (performance.now() - t0) / lungeMs);
    if (p >= 1) { struck(); return; }
    battleAnim.value = { beat, phase: 'lunge', p, frame: -1 };
    battleRaf = requestAnimationFrame(frame);
  };
  animTimer = setTimeout(struck, lungeMs + 250);
  battleRaf = requestAnimationFrame(frame);
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
  // Games played on one clock (ui.simultaneousMotion — chess's continuous-time
  // quadrants): everything that moved between these two states moved AT THE SAME
  // INSTANT, so it belongs in one beat rather than a queue of them. Playing it as a
  // queue is a straight misreading of the position — it shows an exchange as one
  // piece politely waiting for the other to finish crossing the board.
  const together = !!ui.simultaneousMotion;
  // How long that instant lasted, in game time, so the beat can be played out over
  // it (see startSlide): a piece covers as much ground on screen as it covered on
  // the clock, and the whole advance takes the same wall time whatever moved in it.
  const clockSpan = (newState.grid.clock ?? 0) - (oldState.grid.clock ?? 0);
  const spanMs = together && clockSpan > 0
    ? Math.min(4000, Math.max(200, clockSpan * MS_PER_SIM_SECOND)) : undefined;
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
  // …and the pieces that walked into one of those fixtures (a unit into a city — its
  // own, or one it is taking), whose walk is played by a stand-in. See boardMoves.js.
  const entered = MOVES.enteredFixtures(oldState.grid, newState.grid);

  // The route a unit actually travelled to get here, when the game recorded one
  // (grid.motion: `[[x, y, when], …]` per unit, `when` being how far through the
  // instant it was at that point). A game that resolves a journey rather than a
  // relocation knows the corners it turned; the straight from-to line below cuts
  // them all off, which is wrong wherever the journey had any shape to it.
  //
  // Only when the route starts where this unit stood: `moved` is NET over everything
  // this update bundled, so a bundle of more than one instant leaves the recorded
  // route describing the last one alone, and drawing it would teleport the unit to
  // the start of that leg. The straight line is the honest summary in that case.
  const routes = newState.grid.motion ?? null;
  const travelled = (unitId, from) => {
    const route = routes?.[unitId];
    if (!route || route.length < 2) return null;
    const [x, y] = route[0];
    return (Math.abs(x - from.x) < 1e-6 && Math.abs(y - from.y) < 1e-6) ? route : null;
  };

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
    // The square a piece is on — its own cell, or the cell it is stacked in when
    // something else is drawn on top of it (see buildField's `stack`).
    const cellOf = (grid) => grid.cells.find(c =>
      c.unitId === id || (c.stack ?? []).some(s => s.unitId === id));
    const c = cellOf(newState.grid) ?? cellOf(oldState.grid);
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
  // On one clock every mover shares a single beat, which leads the queue: the pieces
  // travel, and whatever the travelling cost them flashes after (see `together`).
  const groupBeat = together ? { kind: 'hop', hops: [], slide: smooth, durationMs: spanMs } : null;
  // `start` overrides where the hop sets off from: a piece that fought on its way is
  // standing on the square it struck from by the time it moves on (see pushBattle).
  const pushHop = (unitId, start = null) => {
    const { from: setOff, to, token } = moved.get(unitId) ?? entered.get(unitId);
    const from = start ?? setOff;
    claimed.add(unitId);
    // Seam crossing: nothing to animate, the unit is simply already there.
    if (Math.abs(to.x - from.x) > halfW) return;
    const route = travelled(unitId, from);
    const steps = route ? route.map(([x, y]) => ({ x, y }))
      : straightPath ? [from, to] : buildHopPath(from, to, diagonal);
    const hop = { unitId, steps, times: route?.map(p => p[2]) };
    // A piece walking into a fixture (see `entered`) is walked by a stand-in drawn as
    // the old board drew it (see battleFx), since its own id now belongs to the city.
    if (token) hop.ghost = token;
    // Whatever stands as a fixture on the square it is heading for keeps its old look
    // until it gets there (see activeField): a city it is taking would otherwise show
    // its new owner's colours before the unit taking it has even set off.
    const held = !continuous && MOVES.fixtureAt(newState.grid, to.x, to.y)
      ? MOVES.fixtureAt(oldState.grid, to.x, to.y) : null;
    if (held) hop.hold = { x: to.x, y: to.y, token: held };
    if (groupBeat) {
      if (!groupBeat.hops.length) beats.push(groupBeat);
      groupBeat.hops.push(hop);
    } else beats.push({ kind: 'hop', hops: [hop], slide: smooth });
  };

  // Fights (ui.battleAnimation — see battleAnim): every one the board's record holds
  // that the last board had not shown. Where the viewer's log has the attack, the fight
  // plays in its place; the rest — an enemy's attacks, which a fogged log leaves out,
  // and fights inside some other action (civ1's barbarian raids, inside an end-turn) —
  // play after the log's own beats, in the order they were fought.
  const battleSpec = ui.battleAnimation ?? null;
  const fights = battleSpec ? MOVES.newBattles(oldState.grid, newState.grid) : [];
  // The square a piece is drawn as itself on — not as a fixture (a civ1 city carries
  // its garrison's id, but it is the CITY that is drawn there; see boardMoves.js).
  const ownSquare = (grid, id) => grid.cells.find(c =>
    (c.unitId === id && !c.fixture) || (c.stack ?? []).some(s => s.unitId === id && !s.fixture)) ?? null;
  // An attacker has to be standing on the square it struck from when its fight plays,
  // but `moved` only knows where it started this update and where it ended up — so its
  // journey is split around the fight: up to the square, the fight, then on to where
  // the board has it now (the square it took, in a game whose winners advance; civ1's
  // stay put, so nothing follows there). `standing` is where the
  // beats queued so far leave it. A piece the board does not draw as itself any more
  // (dead, out of sight, gone into a city) has no token to walk; its fight draws it.
  const standing = new Map();
  const walk = (unitId, to) => {
    const from = standing.get(unitId) ?? moved.get(unitId)?.from;
    standing.set(unitId, to);
    claimed.add(unitId);
    if (!hopsOn || !from || (from.x === to.x && from.y === to.y)) return;
    if (Math.abs(to.x - from.x) > halfW || !ownSquare(newState.grid, unitId)) return;
    beats.push({ kind: 'hop', hops: [{ unitId, steps: buildHopPath(from, to, diagonal) }], slide: smooth });
  };
  const pushBattle = (battle) => {
    const id = battle.attacker.unitId;
    walk(id, battle.from);
    beats.push({ kind: 'battle', battle, spec: battleSpec });
    if (fights.some(f => f.attacker.unitId === id)) return; // it fights again later on
    const end = ownSquare(newState.grid, id);
    if (end) walk(id, { x: end.x, y: end.y });
    // A winner that went on into the square it emptied — a city with no one left to
    // hold it — walks in by stand-in, from where it struck.
    else if (hopsOn && entered.has(id)) pushHop(id, battle.from);
  };

  // A clock advance is not attributed to the piece that moved — the action that ran
  // the clock is somebody's `wait` — so on one clock the movers are collected up
  // front, ahead of the entry loop, instead of trailing after its flashes.
  if (hopsOn && together) for (const unitId of moved.keys()) pushHop(unitId);
  for (const entry of newEntries) {
    const action = entry.playerActions?.[0]?.action;
    const fight = action?.unitId ? fights.findIndex(f => f.attacker.unitId === action.unitId) : -1;
    if (fight >= 0) {
      // A piece with a fight to come: its attack plays the fight, and the moves before
      // it only take it as far as the square it attacks from.
      if (FX_ACTION_TYPES.has(action.type)) pushBattle(fights.splice(fight, 1)[0]);
      else walk(action.unitId, fights[fight].from);
    } else if (hopsOn && action?.unitId && (moved.has(action.unitId) || entered.has(action.unitId))
               && !claimed.has(action.unitId)) pushHop(action.unitId);

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
  // The fights no log entry accounted for, oldest first (see `fights` above).
  while (fights.length) pushBattle(fights.shift());
  // Any remaining moved units (e.g. fx off, or moves the log didn't attribute) hop last.
  if (hopsOn) for (const unitId of [...moved.keys(), ...entered.keys()]) if (!claimed.has(unitId)) pushHop(unitId);

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

  const teams = defs.map((d, i) => ({
    id:    d.id,
    name:  d.name,
    ...teamPalette.seatColorFor(apiGame, i),
  }));

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
    // A square may hold more than one piece (civ1 stacks units on it). The cell names
    // the top of the stack — the piece the board draws — and carries the rest in
    // `stack`, each with the same token fields; they become tokens of their own in the
    // same square, listed BEFORE it so the renderer draws them underneath (a cell's
    // children all share one grid area, see HtmlLayer's .hl-cell) and the top of the
    // stack keeps the square's clicks. Everything else — the roster, the keyboard's
    // next-unit key, auto-advance, the actions panel — then reaches them by id like any
    // other unit, which is what stops a piece under an escort from vanishing from the UI.
    : g.cells.filter(c => c.glyph).flatMap(c => [
        ...(c.stack ?? []).map(s => ({ src: s, x: c.x + cellCenterOffset, y: c.y + cellCenterOffset, id: s.unitId })),
        { src: c, x: c.x + cellCenterOffset, y: c.y + cellCenterOffset, id: c.unitId ?? `u_${c.x}_${c.y}` },
      ]);

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
      // Per-unit field-of-vision overrides (see apps/console/play/vision.js) — a game's toGrid
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
      // The one standing order worth SEEING on the board rather than reading in the
      // panel — a game's toGrid may set { glyph?, frame?, title? } (civ1: fortifying/
      // sentry/fortified). The renderer draws the glyph as a corner letter on the token
      // and the frame as a box round it; see battlefield/HtmlUnit.vue.
      statusMark:    c.statusMark,
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
      // A unit from another game ({ game, type, chassis } — engine/foreignUnits.js):
      // its picture is its own game's, which knows nothing of this board's sides, so
      // the renderer stands it on a plate of its team's colour (battlefield/HtmlUnit.vue).
      origin:        c.origin,
      // Layered composite sprite (body/hands/held weapon/team ring/equipment badges,
      // each independently offset+rotated) — see apps/console/play/SchematicLayer.vue's
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
      // How many pieces stand on this token's square, counting itself — set by a game
      // whose board doesn't list them all (civ1 sends a city's garrison in the city
      // screen, not the cell). With ui.unitStacks 'top', more than one marks the token
      // as the top of a stack (see HtmlLayer).
      stackSize:     c.stackSize,
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
      // The badged thing has pieces inside it (a garrisoned civ1 city): the plaque is
      // framed in black, the original's mark for an occupied settlement.
      badgeOccupied: c.badgeOccupied,
      // The token is the square's own art standing in for the piece whose id it
      // carries (civ1's city over its garrison — see boardMoves.js): animations that
      // move a piece by id leave it where it is.
      fixture:       c.fixture,
      // A token the viewer knows is there without seeing it (civ1: a revealed
      // battlefield's cities) — drawn through the fog, where the rest is only drawn in
      // sight of the viewer's own pieces (see the renderers' isVisible).
      known:         c.known,
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
    // Marked areas a game's toGrid may draw on the board ({x, y, w, h, kind, label} in
    // world units) — civ1's fixed battles mark the square they are about.
    zones: g.zones ?? [],
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
    // of bleeding through them (see apps/console/play/vision.js). Absent ⇒ no occlusion.
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
  const fighting = battleAnim.value;
  // Fixtures held at their old look by a walk still to land on them (see pushHop's
  // `hold`), by square — the walk on screen and every one queued behind it.
  const holds = new Map();
  for (const beat of [hopAnim.value, ...animQueue.value]) {
    for (const h of beat?.hops ?? []) if (h.hold) holds.set(`${h.hold.x},${h.hold.y}`, h.hold.token);
  }
  field.units = field.units.map(u => {
    // A fixture is drawn as the square's own art (a civ1 city carrying its garrison's
    // id): it never travels with the piece whose id it carries. It may be wearing the
    // look it had before a piece walked into it, until that piece is seen to arrive —
    // a taken city in its old owner's colours, an emptied one still unframed.
    if (u.fixture) {
      const was = holds.get(`${Math.floor(u.path[0][0])},${Math.floor(u.path[0][1])}`);
      return was ? {
        ...u,
        // Only its colours: whose it is (sight, friendliness) is already the new owner's.
        paintTeam: field.teams[(was.owner ?? 1) - 1]?.id ?? u.team,
        badge: was.badge, badgeLabel: was.badgeLabel, badgeOccupied: was.badgeOccupied,
      } : u;
    }
    // The attacker of the fight on screen: on the square it struck from, pushed along
    // its lunge while that lasts (see lungeShift) — in the same two forms as a slide.
    if (fighting?.beat.battle.attacker.unitId === u.id) {
      const { battle, spec } = fighting.beat;
      const x = battle.from.x + off, y = battle.from.y + off;
      if (fighting.phase !== 'lunge') return { ...u, path: [[x, y]] };
      const { dx, dy } = lungeShift(battle, spec, fighting.p, field.world);
      return { ...u, path: [[x + dx, y + dy]], baseX: x, baseY: y, tweenDx: dx, tweenDy: dy };
    }
    const moving = hopFor(hopAnim.value, u.id);
    if (moving) {
      const { a, b, frac } = hopPose(moving, hopAnim.value);
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
    // Waiting its turn: where the first beat still to come for it starts — the start of
    // its next hop, or the square its next fight is struck from.
    const queued = animQueue.value.find(q => q.kind === 'hop' ? hopFor(q, u.id)
      : q.kind === 'battle' && q.battle.attacker.unitId === u.id);
    if (queued) {
      const { x, y } = queued.kind === 'hop' ? hopFor(queued, u.id).steps[0] : queued.battle.from;
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

// What the board draws over itself for the fights on screen and still to come (see
// battleAnim), or null when there are none:
//   • ghosts — the fighters the board no longer draws as themselves: the loser, gone
//     from it the moment the update arrived, and an attacker that died, was never in
//     view before it struck, or has since gone into a city. Each holds its square
//     (the attacker's lunging with it) until its own fight is over, so a loser is still
//     standing there when its explosion plays, and is gone after it — not before.
//     And a piece walking into a fixture (a unit into a city — see pushHop's `ghost`):
//     its stand-in stands on its old square while queued, walks in, and is gone once
//     it arrives, which is the moment the city it walked into shows what it did.
//   • blasts — the explosion frame now showing, over the loser's square.
// Positions are board squares; the renderer places them (see HtmlLayer's battleFx).
const battleFx = computed(() => {
  const beats = battleBeats();
  // The walks into a fixture (see pushHop's `ghost`): the one on screen, where it has
  // got to, and the ones still queued, standing where they will set off from.
  const walks = [
    ...(hopAnim.value?.hops ?? []).filter(h => h.ghost).map(h => ({ hop: h, now: hopAnim.value })),
    ...animQueue.value.filter(q => q.kind === 'hop')
      .flatMap(q => q.hops.filter(h => h.ghost).map(h => ({ hop: h, now: null }))),
  ];
  const field = activeField.value;
  if ((!beats.length && !walks.length) || !field) return null;
  const drawn = new Set(field.units.filter(u => !u.fixture).map(u => u.id));
  const ghostOf = (token, key) => {
    const team = field.teams[(token.owner ?? 1) - 1] ?? field.teams[0];
    return {
      id: key, team: team?.id, teamObj: team,
      name: token.unitName ?? token.glyph ?? '?', type: (token.glyph ?? '?').toLowerCase(),
      imagePath: token.imagePath ?? null, hp: 1, hpMax: 1, currentHp: 1,
    };
  };
  const ghosts = [], blasts = [];
  // One piece, one ghost: a unit that fights twice in one update (two turns bundled)
  // is drawn by the earliest of its fights still to finish, not by each of them.
  const ghosted = new Set();
  for (const beat of beats) {
    const b = beat.battle;
    const now = battleAnim.value?.beat === beat ? battleAnim.value : null;
    const lostAt = b.won ? b.at : b.from;
    // The defender under the attacker: the attacker is drawn over it, as it lunges in.
    if (b.won && !drawn.has(b.defender.unitId) && !ghosted.has(b.defender.unitId)) {
      ghosted.add(b.defender.unitId);
      ghosts.push({ key: `${b.id}d`, unit: ghostOf(b.defender, `ghost:${b.id}d`), x: b.at.x, y: b.at.y, lunging: false });
    }
    if (!drawn.has(b.attacker.unitId) && !ghosted.has(b.attacker.unitId)) {
      ghosted.add(b.attacker.unitId);
      const shift = now?.phase === 'lunge' ? lungeShift(b, beat.spec, now.p, field.world) : { dx: 0, dy: 0 };
      ghosts.push({ key: `${b.id}a`, unit: ghostOf(b.attacker, `ghost:${b.id}a`),
                    x: b.from.x + shift.dx, y: b.from.y + shift.dy, lunging: !!(shift.dx || shift.dy) });
    }
    if (now?.phase === 'blast') blasts.push({ key: `${b.id}x${now.frame}`, x: lostAt.x, y: lostAt.y, src: beat.spec.frames[now.frame] });
  }
  // A piece walking into a fixture is drawn by its stand-in, over the fixture it is
  // walking into — unless a fight of its own still to finish is drawing it already.
  for (const { hop, now } of walks) {
    if (ghosted.has(hop.unitId)) continue;
    ghosted.add(hop.unitId);
    const { a, b, frac } = now ? hopPose(hop, now) : { a: hop.steps[0], b: hop.steps[0], frac: 0 };
    ghosts.push({ key: `walk:${hop.unitId}`, unit: ghostOf(hop.ghost, `ghost:walk:${hop.unitId}`),
                  x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac, moving: true });
  }
  return { ghosts, blasts };
});

// ── live updates ─────────────────────────────────────────────
// A WebSocket subscription pushes state changes instead of the old 2s poll
// (api.subscribeSession falls back to polling internally if the socket drops).
// _sub holds the subscription handle; stopPoll() tears it down.
let _sub = null;

function stopPoll() { if (_sub) { _sub.close(); _sub = null; } }

// Which seat we watch the game through — every snapshot is fetched and every
// subscription opened as somebody, whenever there is a human seat to be. Fog needs
// it so the server can filter the board; simultaneous turns needs it so the server
// can render this player's private plan state (their queued orders) during the
// planning window; and a queued future move (games/planQueue.js) needs it in games
// with neither, because a plan is private to its owner and the server serves it
// only to the seat that asks as itself — a snapshot fetched as nobody comes back
// with `plan: null`, and the board silently has nothing to queue onto.
// In a hotseat game (every seat human) this follows whoever is on the clock, so the
// board, the fog and the analysis panel all belong to the player actually being
// asked to move — previously it was pinned to the first human seat, so on the other
// seat's turn you were shown one player's fog while being advised about the other's
// position. With a single human seat (the ordinary case) it resolves to that seat
// either way, and with none (a game we only observe) to nobody, as before.
function viewAsId(s) {
  const humans = s?.humanPlayers ?? [];
  const pending = s?.pendingPlayer;
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
  if (pendingHuman) {
    // A human's turn: nothing to wait on — except what can change under a player
    // who is thinking. Anyone in the game may change its settings mid-play (the
    // board may even be rebuilt), and the game can end; listen for exactly those
    // and ignore everything else, so a waiting player's board is left alone.
    const heldChanges = s.changes?.length ?? 0;
    _sub = api.subscribeSession(s.id, viewAsId(s), (fresh) => {
      if ((fresh.changes?.length ?? 0) === heldChanges && fresh.status === 'active') return;
      liveState.value = fresh;
      maybeStartPoll(fresh);
    });
    return;
  }
  const humanId = viewAsId(s);
  _sub = api.subscribeSession(s.id, humanId, (fresh) => {
    liveState.value = fresh;
    if (fresh.status !== 'active') { stopPoll(); return; }
    if (fresh.pendingPlayer && fresh.humanPlayers?.includes(fresh.pendingPlayer)) {
      stopPoll();
      // The socket was opened for whichever seat we were watching; if the turn has
      // landed on a DIFFERENT human seat (hotseat), that seat's view is the one to show.
      syncViewer(fresh).then(maybeStartPoll);
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
    apiGames.value  = await api.games();
    serverErr.value = '';
  } catch (e) {
    serverErr.value = e.message;
  }
}

onMounted(async () => {
  await refresh();
  await enterSession(props.sessionId);
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

async function enterSession(id) {
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
    maybeStartPoll(state);
    if (!state.fog) loadHistory(id, state); // skip history in fog mode (would reveal all pieces)
  } catch (e) {
    serverErr.value = e.message;
  }
}

// A session started from this one, opened in this one's place: the console swaps
// the tab, and this view (stopped first, so nothing more arrives for it) goes with it.
async function startInstead(body) {
  try {
    const created = await api.create(body);
    stopPoll();
    emit('open-session', created.id, { replace: true });
  } catch (e) { serverErr.value = e.message; }
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

// A group order (Battlefield's drag-selected units, one action each). Sent one at a
// time, not all at once: each is its own step on the server, judged against the
// position the one before it left. A member whose order is refused — its share of the
// formation landed somewhere it can't stand — doesn't hold up the rest, so that is only
// an error worth showing when none got through. Stops early if the turn passes.
async function submitActions({ playerId, actions }) {
  if (!liveState.value) return;
  let state = null, lastErr = null;
  for (const action of actions) {
    try {
      state = await api.action(liveState.value.id, playerId, action);
      liveState.value = state;
    } catch (e) { lastErr = e; }
    if (state && state.pendingPlayer !== playerId) break;
  }
  if (!state) { serverErr.value = lastErr?.message ?? 'No order was accepted'; return; }
  try {
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

// Replace a player's queued future moves (games/planQueue.js). Same out-of-band
// channel as a fog marker, and for the same reason: it isn't a move, it doesn't
// consume a turn, and it has to work while the other side is thinking.
async function setPlan({ playerId, moves }) {
  if (!liveState.value) return;
  try {
    liveState.value = await api.setPlan(liveState.value.id, playerId, moves);
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
// needs SessionView-scoped context (apiGames), same as activeField.
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

function exitBattle() {
  stopPoll();
  emit('close');
}

// Start a fresh game reusing the finished session's exact creation parameters
// (game, players, config), which the server echoes back on liveState.params.
function restartGame() {
  const params = liveState.value?.params;
  if (params) startInstead(params);
}

// The scenario a finished game suggests next (see sessions.js nextScenarioRequest).
function playScenario(scenarioId) {
  const params = liveState.value?.params;
  const apiGame = apiGames.value.find(g => g.name === params?.game);
  const body = apiGame && nextScenarioRequest(apiGame, params, scenarioId);
  if (body) startInstead(body);
}
</script>

<template>
  <!-- Focusable (but not in the tab order) so the console can hand it the keyboard,
       and so a click anywhere on the board keeps the keyboard here. -->
  <div ref="rootEl" class="play app-root" tabindex="-1">
    <div class="app-body">
      <Battlefield v-if="activeField"
                   :live-state="liveState"
                   :resolved-field="resolvedField"
                   :observer-view="observerView"
                   :field="activeField"
                   :unit-fx="unitFx"
                   :territory-fx="territoryFx"
                   :battle-fx="battleFx"
                   :history-fields="historyFields"
                   :reveal-fields="revealFields"
                   :reveal-log="revealLog"
                   :fog="liveState?.fog ?? false"
                   :games-count="apiGames.length"
                   :game-def="apiGames.find(g => g.name === liveState?.game) ?? null"
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
                   @play-scenario="playScenario"
                   @submit-action="submitAction"
                   @submit-actions="submitActions"
                   @resign="resign"
                   @set-marker="setMarker"
                   @set-plan="setPlan"
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
      <div v-else class="app-loading" :class="{ 'app-loading--err': serverErr }">
        {{ serverErr || 'Loading…' }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-root { height: 100%; display: flex; flex-direction: column; outline: none; }
.app-body { flex: 1; min-height: 0; }
.app-loading--err { color: var(--danger); }
.app-loading { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--dim); }
</style>
