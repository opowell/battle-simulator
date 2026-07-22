<script setup>
// A numeric "jump to a point in time" field for the live/replay timeline. The time
// axis is the recorded-ply index (each ply is one turn window): for a DISCRETE-time
// game it's a whole number; for a CONTINUOUS-time game any real value in range, and
// a fractional value parks the playhead partway through a ply so the board shows the
// interpolated (mid-slide) state (see Battlefield's renderUnits). Editing commits on
// Enter or blur; the arrows step by one whole ply.
import { ref, computed, watch } from 'vue';

const props = defineProps({
  time:     { type: Number, default: 0 },   // current playhead (histPos + histFrac)
  max:      { type: Number, default: 0 },   // last ply index
  timeType: { type: String, default: 'discrete' },
});
const emit = defineEmits(['seek']);

const continuous = computed(() => props.timeType === 'continuous');
const step = computed(() => (continuous.value ? 0.1 : 1));
const fmt = (t) => (continuous.value ? Number(t).toFixed(1) : String(Math.round(t)));

// Local editable copy; follows `time` unless the user is mid-edit. Explicit handlers
// (not inline expressions) so the ref updates and Enter commits reliably under the
// runtime SFC loader.
const draft = ref(fmt(props.time));
const editing = ref(false);
watch(() => props.time, (t) => { if (!editing.value) draft.value = fmt(t); });

function onFocus() { editing.value = true; }
function onInput(e) { draft.value = e.target.value; }
function onKeydown(e) {
  if (e.key === 'Enter') { e.preventDefault(); commit(); e.target.blur(); }
  else if (e.key === 'Escape') { editing.value = false; draft.value = fmt(props.time); e.target.blur(); }
}
function commit() {
  editing.value = false;
  const v = parseFloat(draft.value);
  if (Number.isFinite(v)) emit('seek', continuous.value ? v : Math.round(v));
  draft.value = fmt(props.time);
}
function nudge(d) { emit('seek', Math.min(props.max, Math.max(0, props.time + d))); }
</script>

<template>
  <div class="tf" :title="'Jump to a point in time (0–' + fmt(max) + ')'">
    <span class="tf-label">Time</span>
    <button class="tf-arrow" :disabled="time <= 0" @click="nudge(-1)">‹</button>
    <input class="tf-input mono" :value="draft" inputmode="decimal"
           @focus="onFocus" @input="onInput" @keydown="onKeydown" @blur="commit"/>
    <span class="tf-max mono">/ {{ fmt(max) }}</span>
    <button class="tf-arrow" :disabled="time >= max" @click="nudge(1)">›</button>
  </div>
</template>

<style scoped>
.tf { display: flex; align-items: center; gap: 4px; }
.tf-label { font-size: 10px; color: var(--faint); letter-spacing: .06em; text-transform: uppercase; }
.tf-input { width: 46px; text-align: right; padding: 2px 5px; font-size: 12px;
  background: var(--panel, #1a1d24); color: var(--fg, #e6e6e6);
  border: 1px solid var(--line, #333); border-radius: 4px; }
.tf-input:focus { outline: none; border-color: var(--accent); }
.tf-max { font-size: 11px; color: var(--faint); }
.tf-arrow { width: 18px; height: 20px; line-height: 1; padding: 0; font-size: 14px;
  color: var(--dim); background: transparent; border: none; cursor: pointer; }
.tf-arrow:disabled { opacity: .3; cursor: default; }
</style>
