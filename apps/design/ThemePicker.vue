<script setup>
// The theme list: one row per theme, its accent and seat colours as swatches.
// Shared by the lobby's Settings page and the game screen's Settings panel.
defineProps({
  themes:     { type: Array, default: () => [] },   // [{ id, label, accent, teams }]
  modelValue: { type: String, default: '' },
});
defineEmits(['update:modelValue']);
</script>

<template>
  <div class="tp">
    <button v-for="th in themes" :key="th.id"
            :class="['scenrow', 'tp-row', modelValue === th.id && 'sel']"
            @click="$emit('update:modelValue', th.id)">
      <div class="scenmark">
        <div class="tp-swatch tp-swatch--accent" :style="{background:th.accent}"/>
      </div>
      <div>
        <div class="tp-label">{{th.label}}</div>
        <div class="mono tp-id">{{th.id}}</div>
      </div>
      <div class="tp-teams">
        <div v-for="c in th.teams" :key="c" class="tp-swatch tp-swatch--team" :style="{background:c}"/>
      </div>
    </button>
  </div>
</template>

<style scoped>
.tp { display: flex; flex-direction: column; gap: 8px; }
.tp-row { text-align: left; }
.tp-row + .tp-row { margin-top: 0; }
.tp-label { font-size: 14px; font-weight: 600; }
.tp-id { font-size: 11px; color: var(--dim); }
.tp-teams { display: flex; gap: 5px; align-items: center; }
.tp-swatch { border-radius: 50%; }
.tp-swatch--accent { width: 14px; height: 14px; }
.tp-swatch--team { width: 16px; height: 16px; }
</style>
