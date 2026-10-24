<script setup>
// Domain-agnostic status-chip row for GameHeader's optional strip. This component
// has no idea what a chip's value means — the game that populates field.statusChips
// (see e.g. games/civ1/Civ1Game.js's toGrid) decides what to show and how to label it.
defineProps({
  chips: { type: Array, default: () => [] }, // [{ icon?, value, title?, warn? }]
});
</script>

<template>
  <div v-if="chips.length" class="mono sc">
    <span v-for="(c, i) in chips" :key="i" class="sc-item" :class="{ 'sc-item--warn': c.warn }" :title="c.title">
      <BsIcon v-if="c.icon" :name="c.icon" :size="10" color="var(--faint)"/>{{c.value}}
    </span>
  </div>
</template>

<style scoped>
.sc { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; font-size: 10px; color: var(--dim); }
.sc-item { display: flex; align-items: center; gap: 3px; }
.sc-item--warn { color: var(--warn); }
</style>
