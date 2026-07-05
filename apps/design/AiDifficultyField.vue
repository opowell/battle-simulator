<script setup>
// Exclusive AI-difficulty control: pick EITHER a raw power level (0–100) OR a
// per-move time limit (0 = random … up to 10 minutes). Exactly one mode is
// active; switching modes nulls the other value so the config carries only one.
import { computed } from 'vue';

const props = defineProps({
  opt:   { type: Object, required: true },
  power: { type: Number, default: 25 },   // 0–100, or null when time mode is active
  time:  { type: Number, default: null }, // ms,   or null when power mode is active
  mode:  { type: String, default: 'power' },
});
const emit = defineEmits(['update:power', 'update:time', 'update:mode']);

const maxTime = computed(() => props.opt.maxTimeMs ?? 600000); // 10 minutes

function setMode(m) {
  if (m === props.mode) return;
  emit('update:mode', m);
  if (m === 'power') {
    emit('update:time', null);
    emit('update:power', props.power ?? props.opt.default ?? 25);
  } else {
    emit('update:power', null);
    emit('update:time', props.time ?? props.opt.timeDefault ?? 5000);
  }
}

// Quadratic slider mapping so the useful low end (100 ms … 30 s) isn't crammed
// into the first sliver of a linear 0–10 min track.
const SLIDER_MAX = 1000;
const posToMs = (pos) => Math.round(((pos / SLIDER_MAX) ** 2) * maxTime.value / 100) * 100;
const msToPos = (ms) => Math.round(Math.sqrt(Math.max(0, (ms ?? 0) / maxTime.value)) * SLIDER_MAX);

function fmtTime(ms) {
  if (!ms || ms <= 0) return 'Random';
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return Number.isInteger(s) ? `${s} s` : `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60), rs = Math.round(s % 60);
  return rs ? `${m}m ${rs}s` : `${m}m`;
}
</script>

<template>
  <div class="field" :title="opt.description" style="grid-column:1 / -1">
    <label>{{ opt.label }}</label>
    <div class="seg" style="font-size:11px;margin:4px 0 8px">
      <button :class="{ on: mode === 'power' }" @click="setMode('power')" style="padding:3px 10px">Power level</button>
      <button :class="{ on: mode === 'time' }"  @click="setMode('time')"  style="padding:3px 10px">Time limit</button>
    </div>

    <template v-if="mode === 'power'">
      <label style="font-weight:400;color:var(--dim)">
        {{ (power ?? 0) === 0 ? 'Random' : power }} <span style="opacity:.6">/ 100</span>
      </label>
      <input type="range" min="0" max="100" step="1"
             :value="power ?? 0"
             @input="emit('update:power', Number($event.target.value))"/>
    </template>

    <template v-else>
      <label style="font-weight:400;color:var(--dim)">
        {{ fmtTime(time) }} <span style="opacity:.6">per move</span>
      </label>
      <input type="range" min="0" :max="SLIDER_MAX" step="1"
             :value="msToPos(time)"
             @input="emit('update:time', posToMs(Number($event.target.value)))"/>
    </template>
  </div>
</template>
