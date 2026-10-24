<script setup>
// A record's picture: the art the server names for it, or — when there is none,
// or it fails to load — the one-letter glyph the game's renderer draws instead.
// Rendered by appfr as a `component` cell, so it is handed { row, value, … };
// there the value is the picture's src alone (the column is the card's `image`
// too), and the row's own `art` carries the glyph.
import { computed, ref, watch } from 'vue'

const props = defineProps({
  row: Object,
  entry: Object,
  column: Object,
  value: Object,
  size: { type: Number, default: 28 },
})

const art = computed(() => props.row?.fields?.art ?? props.value)
const broken = ref(false)
watch(() => art.value?.src, () => { broken.value = false })
</script>

<template>
  <span class="art" :style="{ width: size + 'px', height: size + 'px' }">
    <img v-if="art?.src && !broken" :src="art.src" alt="" loading="lazy" @error="broken = true">
    <span v-else class="art__glyph">{{ art?.glyph ?? '' }}</span>
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
