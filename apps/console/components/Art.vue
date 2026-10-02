<script setup>
// A record's picture: the art the server names for it, or — when there is none,
// or it fails to load — the one-letter glyph the game's renderer draws instead.
// Rendered by appfr as a `component` cell, so it is handed { row, value, … }.
import { ref, watch } from 'vue'

const props = defineProps({
  row: Object,
  entry: Object,
  column: Object,
  value: Object,
  size: { type: Number, default: 28 },
})

const broken = ref(false)
watch(() => props.value?.src, () => { broken.value = false })
</script>

<template>
  <span class="art" :style="{ width: size + 'px', height: size + 'px' }">
    <img v-if="value?.src && !broken" :src="value.src" alt="" loading="lazy" @error="broken = true">
    <span v-else class="art__glyph">{{ value?.glyph ?? '' }}</span>
  </span>
</template>

<style scoped>
.art {
  display: inline-grid;
  place-items: center;
  flex: none;
  overflow: hidden;
  border-radius: var(--dc-radius-sm, 4px);
  background: var(--dc-bg-2);
  vertical-align: middle;
}
.art img { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
.art__glyph { font: var(--dc-weight-semibold, 600) 12px/1 var(--dc-mono, monospace); color: var(--dc-fg-2); }
</style>
