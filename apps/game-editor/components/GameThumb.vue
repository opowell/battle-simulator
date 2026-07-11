<script setup>
// Small preview-asset thumbnail for a game, replacing the old icon glyph.
// Renders nothing (leaving the parent's empty box) if no preview exists yet.
import { ref, watch } from 'vue';
const props = defineProps({ name: String });
const broken = ref(false);
watch(() => props.name, () => { broken.value = false; });
</script>

<template>
  <img v-if="!broken" class="gthumb-img" :src="`/images/${name}/preview_asset`" :alt="name" @error="broken = true"/>
</template>

<style scoped>
.gthumb-img{width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block}
</style>
