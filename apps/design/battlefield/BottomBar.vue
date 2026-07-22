<script setup>
import LiveControls from './LiveControls.vue';
import TurnTimeline from './TurnTimeline.vue';
import TimeField from './TimeField.vue';

defineProps({
  isLive:          Boolean,
  field:           Object,
  tFloat:          { type: Number, default: 0 },
  playing:         Boolean,
  histPos:         { type: Number, default: 0 },
  histLength:      { type: Number, default: 0 },
  atLatest:        Boolean,
  liveState:       Object,
  isDone:          Boolean,
  isPending:       Boolean,
  pendingPlayerId: { type: String, default: null },
  canReveal:       Boolean,
  revealAll:       Boolean,
  canReplayTurn:   Boolean,
  replaying:       Boolean,
  showZoom:        Boolean,
  canZoomIn:       { type: Boolean, default: true },
  canZoomOut:      { type: Boolean, default: true },
  // Live playback controls (pause / AI delay / history playback).
  paused:          Boolean,
  aiDelay:         { type: Number, default: 0 },
  // Observer lock-step: whether this is an observer-paced session, and the
  // pause-after-playback preference + parked-awaiting-step state.
  observerPaced:      Boolean,
  pauseAfterPlayback: { type: Boolean, default: true },
  awaitingStep:       { type: Boolean, default: false },
  // Time-jump field: the current fractional playhead, its max, and whether the
  // game's time axis is whole-number (discrete) or real-valued (continuous).
  playheadTime:    { type: Number, default: 0 },
  maxTime:         { type: Number, default: 0 },
  timeType:        { type: String, default: 'discrete' },
  historyPlaying:  Boolean,
  // Progress through the turn on screen: the ply range it spans (null = nothing
  // recorded yet) and how far playback has travelled into the current ply.
  turnRange:       { type: Object, default: null },
  histFrac:        { type: Number, default: 0 },
});
defineEmits(['step-back', 'step-fwd', 'toggle-play', 'scrub', 'go-back', 'go-forward',
             'toggle-reveal', 'replay-turn', 'zoom-in', 'zoom-out',
             'toggle-pause', 'set-ai-delay', 'toggle-history-play', 'seek-ply',
             'set-pause-after-playback', 'step-forward', 'seek-time']);
</script>

<template>
  <div class="bb">
    <template v-if="!isLive && field.turns > 1">
      <button class="iconbtn bb-icon" @click="$emit('step-back')">
        <BsIcon name="stepb" :size="15" color="var(--dim)"/>
      </button>
      <button class="btn btn-sm bb-play" @click="$emit('toggle-play')">
        <BsIcon :name="playing ? 'pause' : 'play'" :size="13" :color="playing ? 'var(--dim)' : 'var(--accent)'"/>
        {{playing ? 'Pause' : 'Play'}}
      </button>
      <button class="iconbtn bb-icon" @click="$emit('step-fwd')">
        <BsIcon name="step" :size="15" color="var(--dim)"/>
      </button>
      <input type="range" class="bb-range"
             :min="0" :max="field.turns - 1" step="0.05"
             :value="tFloat" @input="$emit('scrub', $event)"/>
      <span class="mono bb-tcount">
        T {{Math.floor(tFloat)}} / {{field.turns - 1}}
      </span>
    </template>
    <template v-else-if="isLive">
      <button class="iconbtn bb-icon" :disabled="histPos <= 0" @click="$emit('go-back')" title="Previous action">
        <BsIcon name="back" :size="15" color="var(--dim)"/>
      </button>
      <span class="mono bb-count" :class="{ 'bb-count--latest': atLatest }">
        {{histPos + 1}}/{{histLength}}
      </span>
      <button class="iconbtn bb-icon" :disabled="atLatest" @click="$emit('go-forward')" title="Next action">
        <BsIcon name="back" :size="15" color="var(--dim)" class="bb-flip"/>
      </button>
      <span class="mono bb-sep">·</span>
      <span class="mono bb-meta">
        <b class="bb-meta-b">{{liveState.id.slice(0, 8)}}</b>
      </span>
      <span class="mono bb-sep">·</span>
      <span class="mono bb-meta">
        Turn <b class="bb-meta-b">{{liveState.turn ?? 0}}</b>
      </span>
      <span class="mono bb-sep">·</span>
      <span class="mono bb-state"
            :class="isDone ? 'bb-state--done' : isPending ? 'bb-state--pending' : 'bb-state--ai'">
        {{isDone ? 'game over' : isPending ? ('your turn · ' + pendingPlayerId) : 'ai thinking…'}}
      </span>
      <button v-if="canReplayTurn" class="btn btn-sm bb-replay"
              :class="{ 'bb-replay--on': replaying }"
              @click="$emit('replay-turn')"
              title="Replay the last resolved turn">
        <BsIcon name="play" :size="13" :color="replaying ? 'var(--accent)' : 'var(--dim)'"/>
        {{replaying ? 'Replaying…' : 'Replay turn'}}
      </button>
      <button v-if="canReveal" class="btn btn-sm bb-reveal"
              :class="{ 'bb-reveal--on': revealAll }"
              @click="$emit('toggle-reveal')"
              :title="revealAll ? 'Hide hidden pieces' : 'Show true positions of all pieces'">
        <BsIcon name="eye" :size="13" :color="revealAll ? 'var(--accent)' : 'var(--dim)'"/>
        {{revealAll ? 'Revealed' : 'Reveal all'}}
      </button>
      <!-- Jump to any point in time (integer plies for discrete time, any real value
           for continuous — a fraction shows the interpolated mid-slide board). -->
      <TimeField v-if="histLength > 1"
        :time="playheadTime" :max="histLength - 1" :timeType="timeType"
        @seek="$emit('seek-time', $event)"/>
      <!-- Takes the bar's flexible space (where the spacer used to be), so the
           track is as wide as the rest of the row leaves it. -->
      <TurnTimeline v-if="turnRange"
        :start="turnRange.start" :end="turnRange.end" :turn="turnRange.turn"
        :pos="histPos" :frac="histFrac"
        @seek="$emit('seek-ply', $event)"/>
      <div v-else class="bb-spacer"/>
      <LiveControls
        :paused="paused" :aiDelay="aiDelay" :isDone="isDone"
        :observerPaced="observerPaced"
        :pauseAfterPlayback="pauseAfterPlayback" :awaitingStep="awaitingStep"
        :historyPlaying="historyPlaying" :canPlayHistory="histLength > 1"
        @toggle-pause="$emit('toggle-pause')"
        @set-ai-delay="$emit('set-ai-delay', $event)"
        @set-pause-after-playback="$emit('set-pause-after-playback', $event)"
        @step-forward="$emit('step-forward')"
        @toggle-history-play="$emit('toggle-history-play')"/>
    </template>
    <template v-else>
      <span class="mono bb-label">{{field.label}}</span>
      <div class="bb-spacer"/>
    </template>
    <template v-if="showZoom">
      <button class="iconbtn bb-icon" :disabled="!canZoomOut" @click="$emit('zoom-out')" title="Zoom out">
        <BsIcon name="zoomout" :size="15" color="var(--dim)"/>
      </button>
      <button class="iconbtn bb-icon" :disabled="!canZoomIn" @click="$emit('zoom-in')" title="Zoom in">
        <BsIcon name="zoomin" :size="15" color="var(--dim)"/>
      </button>
    </template>
    <BsIcon name="clock" :size="14" color="var(--faint)"/>
  </div>
</template>

<style scoped>
.bb { border-top: 1px solid var(--line); padding: 8px 14px; display: flex; align-items: center; gap: 10px; background: var(--bg1); }
.bb-icon { width: 30px; height: 30px; }
.bb-play { min-width: 62px; justify-content: center; gap: 5px; }
.bb-range { flex: 1; min-width: 0; }
.bb-tcount { font-size: 11px; color: var(--dim); white-space: nowrap; min-width: 72px; text-align: right; }
.bb-count { font-size: 11px; min-width: 36px; text-align: center; color: var(--accent); }
.bb-count--latest { color: var(--faint); }
.bb-flip { transform: scaleX(-1); }
.bb-sep { font-size: 11px; color: var(--faint); }
.bb-meta { font-size: 11px; color: var(--dim); }
.bb-meta-b { color: var(--txt); }
.bb-state { font-size: 11px; }
.bb-state--done { color: var(--faint); }
.bb-state--pending { color: var(--ok); }
.bb-state--ai { color: var(--warn); }
.bb-reveal { gap: 5px; }
.bb-replay { gap: 5px; }
.bb-replay--on { border-color: var(--accent); color: var(--accent); }
.bb-reveal--on { border-color: var(--accent); color: var(--accent); }
.bb-spacer { flex: 1; }
.bb-label { font-size: 11px; color: var(--faint); }
</style>
