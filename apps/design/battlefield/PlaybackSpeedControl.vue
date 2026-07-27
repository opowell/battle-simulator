<script setup>
// Wall-clock speed multiplier for every animated playback the footer drives: history
// scrubbing (Battlefield's HISTORY_STEP_MS), turn replay (App.vue's replayTurn), and
// the non-live turn-by-turn field playback (Battlefield's PLAY_SPEED). One control
// scales all three rather than each owning its own.
defineProps({
  speed: { type: Number, default: 1 },
});
defineEmits(['set-speed']);
const SPEEDS = [0.5, 1, 1.5, 2, 4];
</script>

<template>
  <label class="psc" title="Playback speed">
    <BsIcon name="clock" :size="12" color="var(--faint)"/>
    <select class="psc-select mono" :value="speed"
            @change="$emit('set-speed', Number($event.target.value))">
      <option v-for="s in SPEEDS" :key="s" :value="s">{{s}}×</option>
    </select>
  </label>
</template>

<style scoped>
.psc { display: flex; align-items: center; gap: 4px; }
.psc-select { font-size: 11px; padding: 2px 4px;
  background: var(--panel, #1a1d24); color: var(--fg, #e6e6e6);
  border: 1px solid var(--line, #333); border-radius: 4px; cursor: pointer; }
.psc-select:focus { outline: none; border-color: var(--accent); }
</style>
