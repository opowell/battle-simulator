<script setup>
// Small preview-asset thumbnail for a game, used wherever a compact per-game
// visual is needed (session rows, modal headers) instead of a generic icon.
import { ref, watch } from 'vue';
const props = defineProps({ name: String, size: { type: Number, default: 20 } });
const broken = ref(false);
watch(() => props.name, () => { broken.value = false; });
const basePath = window.api.basePath;
</script>

<template>
  <img v-if="name && !broken" class="game-thumb" :src="`${basePath}/images/${name}/preview_asset`" :alt="name"
       :style="{ width: size + 'px', height: size + 'px' }" @error="broken = true"/>
</template>

<style scoped>
.game-thumb{object-fit:cover;border-radius:6px;display:block;flex:none}
</style>
