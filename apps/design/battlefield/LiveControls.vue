<script setup>
// Live playback controls for an in-progress session:
//  - Pause/resume the game loop on the server (the AI stops moving until resumed).
//  - Set the AI move delay (ms) so a fast game is watchable — pushed live to the server.
//  - Play through recorded history from the current scrub position ("view play from here").
// Owns none of the state: it reflects props and emits intent up to Battlefield/App.
defineProps({
  // Live game controls (server-backed).
  paused:         { type: Boolean, default: false },
  aiDelay:        { type: Number, default: 0 },
  isDone:         { type: Boolean, default: false },
  // History playback (client-side scrubbing of recorded grids).
  historyPlaying: { type: Boolean, default: false },
  canPlayHistory: { type: Boolean, default: false },
});
const emit = defineEmits(['toggle-pause', 'set-ai-delay', 'toggle-history-play']);

// A small set of watchable delays, chosen on the slider (index → ms).
const DELAYS = [0, 250, 500, 1000, 2000, 4000];
function delayIndex(ms) {
  let best = 0;
  for (let i = 0; i < DELAYS.length; i++) if (ms >= DELAYS[i]) best = i;
  return best;
}
function onDelay(e) { emit('set-ai-delay', DELAYS[Number(e.target.value)] ?? 0); }
function fmtDelay(ms) { return ms >= 1000 ? (ms / 1000) + 's' : ms + 'ms'; }
</script>

<template>
  <div class="lc">
    <!-- Play through recorded history from the current position -->
    <button class="iconbtn lc-icon" :disabled="!canPlayHistory"
            :class="{ 'lc-on': historyPlaying }"
            @click="$emit('toggle-history-play')"
            :title="historyPlaying ? 'Stop history playback' : 'Play through history from here'">
      <BsIcon :name="historyPlaying ? 'pause' : 'play'" :size="14"
              :color="historyPlaying ? 'var(--accent)' : 'var(--dim)'"/>
    </button>

    <span class="mono lc-sep">·</span>

    <!-- Pause / resume the live game (AI stops until resumed) -->
    <button class="btn btn-sm lc-pause" :disabled="isDone"
            :class="{ 'lc-on': paused }"
            @click="$emit('toggle-pause')"
            :title="paused ? 'Resume the live game' : 'Pause the live game (AI stops moving)'">
      <BsIcon :name="paused ? 'play' : 'pause'" :size="13"
              :color="paused ? 'var(--accent)' : 'var(--dim)'"/>
      {{ paused ? 'Resume' : 'Pause' }}
    </button>

    <!-- AI move delay -->
    <div class="lc-delay" :title="'Delay between AI moves: ' + fmtDelay(aiDelay)">
      <BsIcon name="clock" :size="12" color="var(--faint)"/>
      <input type="range" class="lc-slider" :min="0" :max="DELAYS.length - 1" step="1"
             :value="delayIndex(aiDelay)" @input="onDelay"/>
      <span class="mono lc-delay-val">{{ fmtDelay(aiDelay) }}</span>
    </div>
  </div>
</template>

<style scoped>
.lc { display: flex; align-items: center; gap: 8px; }
.lc-icon { width: 30px; height: 30px; }
.lc-sep { font-size: 11px; color: var(--faint); }
.lc-pause { gap: 5px; min-width: 74px; justify-content: center; }
.lc-on { border-color: var(--accent); color: var(--accent); }
.lc-delay { display: flex; align-items: center; gap: 6px; }
.lc-slider { width: 84px; }
.lc-delay-val { font-size: 11px; color: var(--dim); min-width: 34px; text-align: right; }
</style>
