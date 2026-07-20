<script setup>
import { ref, computed, onUnmounted } from 'vue';
// Progress through the turn currently on screen, as a track with one tick per
// recorded ply of that turn. The back/forward buttons beside it move one ply at a
// time and the counter says where you are, but neither shows how far through the
// turn that is, nor lets you land somewhere directly — this does both.
//
// Scoped to the current turn rather than the whole game on purpose: a long session
// runs to hundreds of plies, and at that length a whole-game track puts the ticks
// closer together than a cursor can pick out.
//
// Holds no state of its own beyond the drag flag: the playhead is `pos` + `frac`
// from the parent, and seeking is an emit.
const props = defineProps({
  // Inclusive ply range of the turn being shown.
  start: { type: Number, required: true },
  end:   { type: Number, required: true },
  // Playhead: the ply on screen, plus how far playback has travelled into it (0-1).
  pos:   { type: Number, required: true },
  frac:  { type: Number, default: 0 },
  turn:  { type: Number, default: 0 },
});
const emit = defineEmits(['seek']);

const span  = computed(() => Math.max(0, props.end - props.start));
const ticks = computed(() => Array.from({ length: span.value + 1 }, (_, i) => props.start + i));

// A one-ply turn has no length to travel along, so the fill is simply full rather
// than a divide-by-zero.
const pct = computed(() => {
  if (!span.value) return 100;
  const at = Math.min(Math.max(props.pos + props.frac, props.start), props.end);
  return (at - props.start) / span.value * 100;
});

function tickPct(p) { return span.value ? (p - props.start) / span.value * 100 : 0; }

// ── seeking ───────────────────────────────────────────────────────────────────
// Click and drag both land on the nearest tick: the ticks ARE the seekable states,
// so snapping is what makes a click anywhere on the track do something predictable
// rather than rounding down to whatever ply happens to sit left of the cursor.
const trackEl = ref(null);
const dragging = ref(false);

function plyAt(e) {
  const r = trackEl.value.getBoundingClientRect();
  const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  return props.start + Math.round(f * span.value);
}

function seek(e) {
  const p = plyAt(e);
  if (p !== props.pos) emit('seek', p);
}

function onDown(e) {
  if (e.button != null && e.button !== 0) return;
  dragging.value = true;
  trackEl.value?.setPointerCapture?.(e.pointerId);
  seek(e);
}
function onMove(e) { if (dragging.value) seek(e); }
function onUp(e) {
  if (!dragging.value) return;
  dragging.value = false;
  trackEl.value?.releasePointerCapture?.(e.pointerId);
}

onUnmounted(() => { dragging.value = false; });
</script>

<template>
  <!-- No turn label of its own: BottomBar already prints "Turn N" immediately to
       the left of this track. -->
  <div class="tl">
    <div ref="trackEl" class="tl-track" :class="{ 'tl-track--drag': dragging }"
         :title="'Turn ' + turn + ' · click to jump to a tick'"
         @pointerdown="onDown" @pointermove="onMove"
         @pointerup="onUp" @pointercancel="onUp">
      <div class="tl-rail"/>
      <!-- No width transition: the fill is already driven frame-by-frame during
           playback, and a CSS ease on top of that would lag the board it tracks. -->
      <div class="tl-fill" :style="{ width: pct + '%' }"/>
      <span v-for="p in ticks" :key="p" class="tl-tick"
            :class="{ 'tl-tick--done': p <= pos, 'tl-tick--at': p === pos }"
            :style="{ left: tickPct(p) + '%' }"/>
    </div>
    <span class="mono tl-count">{{ pos - start + 1 }}/{{ span + 1 }}</span>
  </div>
</template>

<style scoped>
.tl { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
/* Padded so the end ticks aren't clipped, and tall enough to be an easy target
   while the rail itself stays a hairline. */
.tl-track { position: relative; flex: 1; min-width: 60px; height: 18px; cursor: pointer; touch-action: none; }
.tl-track--drag { cursor: grabbing; }
.tl-rail, .tl-fill {
  position: absolute; top: 50%; transform: translateY(-50%);
  height: 3px; border-radius: 2px; pointer-events: none;
}
.tl-rail { left: 0; right: 0; background: var(--line); }
.tl-fill { left: 0; background: var(--accent); opacity: .55; }
.tl-tick {
  position: absolute; top: 50%; width: 3px; height: 3px; margin-left: -1.5px;
  transform: translateY(-50%); border-radius: 50%;
  background: var(--faint); pointer-events: none; transition: background .12s, height .12s, width .12s;
}
.tl-tick--done { background: var(--accent); }
/* The playhead tick reads as a knob, so the current ply is findable at a glance. */
.tl-tick--at {
  width: 9px; height: 9px; margin-left: -4.5px;
  background: var(--accent); box-shadow: 0 0 0 2px var(--bg1);
}
.tl-count { font-size: 11px; color: var(--dim); white-space: nowrap; min-width: 34px; text-align: right; }
</style>
