<script setup>
// A row of one repeated resource icon — the way the original city screen counts
// everything: one icon per point, lit for what you have and dim for what is still
// missing. Used for the food box, the production box and the per-turn yields.
defineProps({
  icon:   { type: String, default: null },    // image path — the game sends these
  filled: { type: Number, default: 0 },
  total:  { type: Number, default: null },    // null = no capacity, just draw `filled`
  size:   { type: Number, default: 18 },
});
const imgSrc = window.api.imgSrc;
</script>

<template>
  <div class="cis" v-if="icon">
    <img v-for="i in Math.max(0, Math.min(filled, total ?? filled))" :key="'f' + i"
         :src="imgSrc(icon)" class="cis-i" :style="{ width: size + 'px', height: size + 'px' }" draggable="false"/>
    <img v-for="i in Math.max(0, (total ?? 0) - filled)" :key="'e' + i"
         :src="imgSrc(icon)" class="cis-i cis-i--dim" :style="{ width: size + 'px', height: size + 'px' }" draggable="false"/>
  </div>
</template>

<style scoped>
.cis { display: flex; flex-wrap: wrap; gap: 2px; align-items: center; min-height: 18px; }
.cis-i { object-fit: contain; image-rendering: pixelated; flex: none; }
.cis-i--dim { opacity: .18; }
</style>
