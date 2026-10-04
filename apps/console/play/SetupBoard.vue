<script setup>
// A small, read-only-terrain board that units can be picked up and put down on,
// for the starting-units editor (StartingUnitsField.vue). Deliberately NOT the
// battlefield renderer: nothing here knows about fog, vision, animation, moves or
// any one game — it draws the cells a game's own toGrid described (colour and
// terrain art), lays the roster's tokens on top of them, and reports clicks.
//
// Every game whose unit positions map to grid cells gets this for free; the ones
// whose don't (a card, a territory) never mount it — see `placeable` in
// engine/startingSetup.js.
import { computed, ref, onMounted, onUnmounted } from 'vue';

const props = defineProps({
  // { width, height, cells:[{x,y,color,bgImage}] } from the setup preview.
  board:      { type: Object, required: true },
  // [{ id, cell:[col,row], color, glyph, imagePath, ownerId }]
  tokens:     { type: Array, default: () => [] },
  selectedId: { type: String, default: null },
});
const emit = defineEmits(['pick-cell']);

const wrap = ref(null);
const wrapW = ref(560);

// One integer number of pixels per cell, so cell edges land on whole pixels and
// the grid can't shimmer. Bounded either way: never so large that an 8x8 board
// fills the page, never so small that a 63-wide one has nothing to click.
const cellPx = computed(() => {
  const w = props.board?.width || 1;
  return Math.max(6, Math.min(44, Math.floor((wrapW.value - 2) / w)));
});
const boardW = computed(() => cellPx.value * (props.board?.width || 0));
const boardH = computed(() => cellPx.value * (props.board?.height || 0));

const measure = () => { wrapW.value = wrap.value?.clientWidth || 560; };
let ro = null;
onMounted(() => {
  measure();
  if (window.ResizeObserver && wrap.value) { ro = new ResizeObserver(measure); ro.observe(wrap.value); }
});
onUnmounted(() => ro?.disconnect());

const cells = computed(() => props.board?.cells ?? []);

// Tokens keyed by cell, so a square that several units share draws one token with
// a count rather than a stack nobody can click apart.
const stacks = computed(() => {
  const at = new Map();
  for (const t of props.tokens) {
    if (!t.cell) continue;
    const key = t.cell[0] + ',' + t.cell[1];
    (at.get(key) ?? at.set(key, []).get(key)).push(t);
  }
  return [...at.entries()].map(([key, list]) => {
    const [col, row] = key.split(',').map(Number);
    const top = list.find(t => t.id === props.selectedId) ?? list[0];
    return { key, col, row, top, count: list.length };
  });
});

function onCell(ev) {
  const el = ev.target.closest('[data-cell]');
  if (!el) return;
  const [col, row] = el.dataset.cell.split(',').map(Number);
  emit('pick-cell', [col, row]);
}

const imgSrc = (p) => (p ? window.api.imgSrc(p) : null);
</script>

<template>
  <div ref="wrap" class="sb-wrap">
    <div class="sb" :style="{ width: boardW + 'px', height: boardH + 'px' }" @click="onCell">
      <div v-for="c in cells" :key="c.x + ',' + c.y" class="sb-cell" data-cell-bg
           :data-cell="c.x + ',' + c.y"
           :style="{
             left: (c.x * cellPx) + 'px', top: (c.y * cellPx) + 'px',
             width: cellPx + 'px', height: cellPx + 'px',
             background: c.color || 'var(--bg2)',
             backgroundImage: c.bgImage ? `url(${imgSrc(c.bgImage)})` : undefined,
           }"/>
      <!-- Tokens sit on the same grid, and are click-through to the cell under
           them: clicking a unit is just clicking its square, which is what makes
           "pick up here, put down there" one interaction instead of two. -->
      <div v-for="s in stacks" :key="s.key" class="sb-token"
           :class="{ on: s.top.id === selectedId }"
           :data-cell="s.col + ',' + s.row"
           :style="{
             left: (s.col * cellPx) + 'px', top: (s.row * cellPx) + 'px',
             width: cellPx + 'px', height: cellPx + 'px',
             '--tc': s.top.color,
           }">
        <img v-if="s.top.imagePath" :src="imgSrc(s.top.imagePath)" alt=""/>
        <span v-else class="sb-glyph">{{ s.top.glyph || s.top.type?.[0]?.toUpperCase() || '•' }}</span>
        <span v-if="s.count > 1" class="sb-count">{{ s.count }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sb-wrap{width:100%;overflow:auto;display:flex;justify-content:center;background:var(--bg0);border:1px solid var(--line);border-radius:var(--r);padding:6px}
.sb{position:relative;flex:none}
.sb-cell{position:absolute;background-size:cover;background-position:center;cursor:pointer;outline:.5px solid rgba(0,0,0,.18)}
.sb-token{position:absolute;display:grid;place-items:center;pointer-events:none;padding:1px}
.sb-token img{width:100%;height:100%;object-fit:contain;image-rendering:pixelated;
  filter:drop-shadow(0 0 1px rgba(0,0,0,.9))}
.sb-glyph{width:78%;height:78%;border-radius:50%;background:var(--tc);color:#08121a;
  font-size:9px;font-weight:700;display:grid;place-items:center;box-shadow:0 0 0 1px rgba(0,0,0,.5)}
.sb-token.on{box-shadow:inset 0 0 0 2px var(--accent);border-radius:3px}
.sb-count{position:absolute;right:0;bottom:0;font-family:var(--mono);font-size:8px;line-height:1;
  padding:1px 2px;background:var(--bg0);color:var(--txt);border-radius:2px}
</style>
