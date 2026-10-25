<script setup>
// The `display` option (display.js): a kind of screen to start from, and each
// of its options switched on or off. Its value is null (the scenario's own), or
// { preset, …options } — only what the player chose, so an option left alone
// keeps following the scenario.
import { computed } from 'vue';
import { DISPLAY_OPTIONS, DISPLAY_PRESETS, resolveDisplay, optionValues } from './display.js';

const props = defineProps({
  opt:        { type: Object, required: true },
  modelValue: { default: null },
  // The ui flags the game shows without this option: its own, then its
  // scenario's display — what each switch reads as while it is left alone.
  base:       { type: Object, default: () => ({}) },
});
const emit = defineEmits(['update:modelValue', 'preset']);

const chosen = computed(() => {
  const v = props.modelValue;
  if (typeof v === 'string') return DISPLAY_PRESETS[v] ? { preset: v } : {};
  return v && typeof v === 'object' ? v : {};
});
const values = computed(() => optionValues(resolveDisplay(props.base, null, chosen.value)));

function setPreset(id) {
  emit('update:modelValue', id ? { preset: id } : null);
  emit('preset', id);
}
function toggle(id, on) {
  emit('update:modelValue', { ...chosen.value, [id]: on });
}
</script>

<template>
  <div class="field dsp" :title="opt.description">
    <label>{{ opt.label }}</label>
    <select class="gsf-input dsp-preset" :value="chosen.preset ?? ''" @change="setPreset($event.target.value)">
      <option value="">Scenario's own</option>
      <option v-for="(p, id) in DISPLAY_PRESETS" :key="id" :value="id" :title="p.description">{{ p.label }}</option>
    </select>
    <div class="dsp-opts">
      <label v-for="o in DISPLAY_OPTIONS" :key="o.id" class="dsp-opt" :title="o.description">
        <input type="checkbox" :checked="values[o.id]" @change="toggle(o.id, $event.target.checked)"/>
        <span>{{ o.label }}</span>
      </label>
    </div>
  </div>
</template>

<style scoped>
.dsp{grid-column:1 / -1}
.dsp-preset{margin-bottom:8px}
.dsp-opts{display:grid;grid-template-columns:1fr 1fr;gap:4px 14px}
.dsp .dsp-opt{display:flex;align-items:center;justify-content:flex-start;gap:7px;font-size:12px;color:var(--fg);text-transform:none;letter-spacing:0;margin:0;text-align:left;cursor:pointer}
.dsp .dsp-opt input{width:14px;height:14px;flex:none;margin:0}
</style>
