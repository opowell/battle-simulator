<script setup>
import { ref, computed, watch } from 'vue';
import GameThumb from './GameThumb.vue';

const props = defineProps({
  game: { type: Object, default: null }, // null = closed
});
const emit = defineEmits(['close', 'quick-start', 'configure']);

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

const playersLabel = computed(() => {
  const g = props.game;
  if (!g) return '';
  return g.minPlayers === g.maxPlayers ? `${g.minPlayers} players` : `${g.minPlayers}–${g.maxPlayers} players`;
});
</script>

<template>
  <teleport to="body">
    <div v-if="game" class="modal-scrim" @click.self="$emit('close')">
      <div class="modal-panel gdm">
        <button class="modal-close" @click="$emit('close')">×</button>

        <div class="gdm-gallery" v-if="slides.length">
          <img v-for="s in SLIDES" v-show="s.mode === slides[idx]?.mode" :key="s.mode"
               class="gdm-slide" :src="src(s.mode)" :alt="s.label" @error="onErr(s.mode)"/>
          <div class="gdm-gradient"/>
          <template v-if="slides.length > 1">
            <button class="gdm-nav gdm-nav-l" @click="prev">‹</button>
            <button class="gdm-nav gdm-nav-r" @click="next">›</button>
            <div class="gdm-dots">
              <span v-for="(s, i) in slides" :key="s.mode" :class="['gdm-dot', i === idx && 'on']" @click="idx = i"/>
            </div>
          </template>
        </div>

        <div class="gdm-body">
          <div class="gdm-head">
            <span class="gdm-icon"><GameThumb :name="game.name" :size="22"/></span>
            <div class="gdm-name-wrap">
              <div class="gdm-name">{{game.name}}</div>
              <div class="mono gdm-players">{{playersLabel}}</div>
            </div>
          </div>

          <div v-if="game.scenarios?.length" class="gdm-scenarios">
            <div class="gdm-scenarios-title">Scenarios</div>
            <div class="gdm-tags">
              <span v-for="sc in game.scenarios" :key="sc.id" class="tag">{{sc.name}}</span>
            </div>
          </div>

          <div class="gdm-actions">
            <button class="btn gdm-action" @click="$emit('configure', game)">
              <BsIcon name="sliders" :size="14" color="var(--dim)"/> Start…
            </button>
            <button class="btn btn-primary gdm-action" @click="$emit('quick-start', game)">
              <BsIcon name="play" :size="14" color="#04222b" :stroke="2"/> Quick start
            </button>
          </div>
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.gdm{width:560px;max-width:92vw}
.gdm-gallery{position:relative;aspect-ratio:16/9;background:var(--bg0);flex:none;overflow:hidden}
.gdm-slide{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.gdm-gradient{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 70%,rgba(0,0,0,.35) 100%);pointer-events:none}
.gdm-nav{position:absolute;top:50%;transform:translateY(-50%);width:32px;height:32px;border-radius:50%;border:none;background:rgba(6,9,12,.5);color:#fff;font-size:18px;display:grid;place-items:center;cursor:pointer;line-height:1}
.gdm-nav:hover{background:rgba(6,9,12,.75)}
.gdm-nav-l{left:10px}
.gdm-nav-r{right:10px}
.gdm-dots{position:absolute;left:0;right:0;bottom:10px;display:flex;justify-content:center;gap:6px}
.gdm-dot{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.4);cursor:pointer}
.gdm-dot.on{background:#fff}
.gdm-body{padding:18px 20px 20px;overflow-y:auto}
.gdm-name-wrap{min-width:0}
.gdm-players{font-size:11px;color:var(--dim)}
.gdm-scenarios{margin-top:14px}
.gdm-scenarios-title{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);margin-bottom:8px}
.gdm-tags{display:flex;flex-wrap:wrap;gap:6px}
.gdm-actions{display:flex;gap:10px;margin-top:18px}
.gdm-action{flex:1;justify-content:center;padding:11px}
.gdm-head{display:flex;align-items:center;gap:12px}
.gdm-icon{width:38px;height:38px;border-radius:8px;display:grid;place-items:center;border:1px solid var(--line2);background:var(--bg2);flex:none}
.gdm-name{font-weight:700;font-size:17px}
</style>
