<script setup>
import { ref, computed, watch } from 'vue';

const props = defineProps({
  game: { type: Object, default: null },
});

// Only two curated images exist per game today (see api-server.js serveGameImage);
// the swiper is built to grow on its own if more preview_* assets show up later.
const SLIDES = [
  { mode: 'box',   label: 'Cover' },
  { mode: 'asset', label: 'In-game' },
];

const failed = ref({}); // mode -> true once its <img> 404s
const idx    = ref(0);

watch(() => props.game, () => { idx.value = 0; failed.value = {}; });

const slides = computed(() => props.game ? SLIDES.filter(s => !failed.value[s.mode]) : []);

function src(mode) { return `${window.api.basePath}/images/${props.game.name}/preview_${mode}`; }
function onErr(mode) {
  failed.value = { ...failed.value, [mode]: true };
  if (idx.value >= slides.value.length) idx.value = Math.max(0, slides.value.length - 1);
}
function prev() { idx.value = (idx.value - 1 + slides.value.length) % slides.value.length; }
function next() { idx.value = (idx.value + 1) % slides.value.length; }
</script>

<template>
  <div class="gg" v-if="game && slides.length">
    <img v-for="s in SLIDES" v-show="s.mode === slides[idx]?.mode" :key="s.mode"
         class="gg-slide" :src="src(s.mode)" :alt="s.label" @error="onErr(s.mode)"/>
    <div class="gg-gradient"/>
    <template v-if="slides.length > 1">
      <button class="gg-nav gg-nav-l" @click="prev">‹</button>
      <button class="gg-nav gg-nav-r" @click="next">›</button>
      <div class="gg-dots">
        <span v-for="(s, i) in slides" :key="s.mode" :class="['gg-dot', i === idx && 'on']" @click="idx = i"/>
      </div>
    </template>
  </div>
</template>

<style scoped>
.gg{position:relative;aspect-ratio:16/9;background:var(--bg0);flex:none;overflow:hidden}
.gg-slide{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.gg-gradient{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 70%,rgba(0,0,0,.35) 100%);pointer-events:none}
.gg-nav{position:absolute;top:50%;transform:translateY(-50%);width:32px;height:32px;border-radius:50%;border:none;background:rgba(6,9,12,.5);color:#fff;font-size:18px;display:grid;place-items:center;cursor:pointer;line-height:1}
.gg-nav:hover{background:rgba(6,9,12,.75)}
.gg-nav-l{left:10px}
.gg-nav-r{right:10px}
.gg-dots{position:absolute;left:0;right:0;bottom:10px;display:flex;justify-content:center;gap:6px}
.gg-dot{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.4);cursor:pointer}
.gg-dot.on{background:#fff}
</style>
