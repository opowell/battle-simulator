<script setup>
// The fights on the HTML board (see App.vue's battleFx): fighters the board no longer
// draws itself — a loser waiting for its explosion, an attacker lunging that is not on
// the board — and the explosion frame playing over whoever lost. HtmlLayer places each
// item on its square (and its wrap copies); this only draws them, over the units.
//
// A ghost is an ordinary HtmlUnit, so it looks exactly like the piece did a moment ago,
// team colours and all. The explosion frame is the game's own art, drawn at a unit
// sprite's size and as crisply pixelated. Nothing here takes a click.
import HtmlUnit from './HtmlUnit.vue';

defineProps({
  // [{ key, left, top, size, z, unit?, r?, src? }] — px, the square's top-left corner.
  items:   { type: Array, default: () => [] },
  rdr:     Object,
  recolor: Boolean,
});
const imgSrc = window.api.imgSrc;
</script>

<template>
  <div v-for="it in items" :key="it.key" class="hb-item"
       :style="{ left: it.left+'px', top: it.top+'px', width: it.size+'px', height: it.size+'px', zIndex: it.z }">
    <HtmlUnit v-if="it.unit" :unit="it.unit" :r="it.r" :rdr="rdr" :showHp="false" :recolor="recolor"/>
    <img v-else class="hb-blast" :src="imgSrc(it.src)" draggable="false"
         :style="{ width: it.r*2+'px', height: it.r*2+'px' }"/>
  </div>
</template>

<style scoped>
.hb-item { position: absolute; display: grid; pointer-events: none; }
.hb-blast { place-self: center; image-rendering: pixelated; }
</style>
