<script setup>
// The game screen's panels — the menu, settings, help, … — as appfr windows.
//
// Two ways of showing them, chosen by `mode`:
//   float  every panel is a window floating over the board. The desk is a layer
//          over the whole screen whose bare desktop lets every click through to
//          the board under it; only the windows themselves catch the pointer.
//   dock   the panels are a column of their own beside the board, sharing it as
//          appfr panes (split, tabbed, dragged about). The column draws no bar of
//          its own — the panels' own bars head it; the menu's "Panels" switch
//          floats them again.
//
// A panel that says `dock: true` is pinned to the column whatever the mode: the
// column is then there even while everything else floats, holding just those —
// the tools a turn is played with stand beside the board, never over it.
//
// Which panels are open is the host's: `panels` lists them, a window's close
// button asks for one to go (`close`), and this keeps the arrangement in step —
// a newly opened panel turns up as a window where it was last left (or centred),
// or at the foot of the column. Nothing here knows what any panel is.
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import {
  WindowFrame, column, float, frame, frameOf, headless, insertPanel, isFloat,
  minimizeFrame, panelIds, panelNode, raiseFrame, removePanel, setActivePanel,
} from 'header-content-layout';

const props = defineProps({
  // The open panels, in the order they were opened: [{ id, title, subtitle?, w?, h?, dock? }].
  // w/h are the size a window first opens at (h is also its share of the column).
  panels: { type: Array, default: () => [] },
  mode:   { type: String, default: 'float' },
});
const emit = defineEmits(['close', 'update:mode']);

const RECTS_KEY = 'bs_panel_rects';
const DOCK_W_KEY = 'bs_dock_width';

const floatEl = ref(null);
// The two arrangements: the windows over the board, and the column beside it.
const floatLayout = ref(null);
const dockLayout = ref(null);

const docked   = computed(() => props.panels.filter(p => p.dock || props.mode === 'dock'));
const floating = computed(() => props.panels.filter(p => !p.dock && props.mode !== 'dock'));

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};

// Where each window was last left, so one closed and opened again comes back there.
const rects = readJson(RECTS_KEY, {});
function remember(id, rect) {
  rects[id] = rect;
  try { localStorage.setItem(RECTS_KEY, JSON.stringify(rects)); } catch { /* private mode */ }
}

// A new window: where it was last left; else beside a window already open — the
// one in front first, as the one it was most likely opened from — anywhere it
// covers none of them; else centred, stepped clear of any window already sitting
// there. Always kept inside the desk, whatever size it now is.
function rectFor(def, taken) {
  // The desk's parent, not the desk: a desk with nothing open yet is hidden, and
  // measures nothing. Floating, the desk covers its parent exactly.
  const box = floatEl.value?.parentElement?.getBoundingClientRect() ?? { width: 1200, height: 800 };
  const saved = rects[def.id];
  const w = Math.min(saved?.w ?? def.w ?? 360, Math.max(160, box.width - 16));
  const h = Math.min(saved?.h ?? def.h ?? 320, Math.max(120, box.height - 16));
  let x = saved?.x ?? Math.round((box.width - w) / 2);
  let y = saved?.y ?? Math.round((box.height - h) / 3);
  if (!saved) {
    const gap = 12;
    const overlaps = (r) => taken.some(t => r.x < t.x + t.w && t.x < r.x + r.w && r.y < t.y + t.h && t.y < r.y + r.h);
    const spot = [...taken].reverse()
      .flatMap(t => [{ x: t.x + t.w + gap, y: t.y }, { x: t.x - gap - w, y: t.y }])
      .map(p => ({ ...p, y: Math.max(0, Math.min(p.y, box.height - h)), w, h }))
      .find(r => r.x >= 0 && r.x + w <= box.width && !overlaps(r));
    if (spot) ({ x, y } = spot);
  }
  if (!saved) while (taken.some(r => r.x === x && r.y === y)) { x += 28; y += 28; }
  x = Math.max(0, Math.min(x, box.width - w));
  y = Math.max(0, Math.min(y, box.height - h));
  return { x, y, w, h };
}

const byId = computed(() => new Map(props.panels.map(p => [p.id, p])));
const slots = (list) => list.map(p => ({ id: p.id, slot: 'panel-' + p.id }));

function floatOf(ids) {
  const taken = [];
  const frames = ids.map((id) => {
    const rect = rectFor(byId.value.get(id) ?? { id }, taken);
    taken.push(rect);
    return frame(panelNode(id), rect);
  });
  return headless(float(frames));
}

// An arrangement with the panels no longer meant to be in it taken out — null once
// nothing is left, so an emptied column or desktop is started afresh, not added to.
function keepOnly(layout, ids) {
  let next = layout;
  if (next) for (const id of panelIds(next)) if (!ids.includes(id)) next = next && removePanel(next, id);
  return next && panelIds(next).length ? next : null;
}

// Squares each arrangement with the panels meant to be in it: closed ones leave,
// newly opened ones join the way that arrangement adds them.
function syncFloat() {
  const ids = floating.value.map(p => p.id);
  const kept = keepOnly(floatLayout.value, ids);
  const present = kept ? panelIds(kept) : [];
  const missing = ids.filter(id => !present.includes(id));
  if (!missing.length) { floatLayout.value = kept; return; }
  const base = kept && isFloat(kept) ? kept : headless(float([]));
  const taken = base.frames.map(f => f.rect);
  floatLayout.value = { ...base, frames: [...base.frames, ...missing.map((id) => {
    const rect = rectFor(byId.value.get(id), taken);
    taken.push(rect);
    return frame(panelNode(id), rect);
  })] };
}

function syncDock() {
  const ids = docked.value.map(p => p.id);
  let next = keepOnly(dockLayout.value, ids);
  const present = next ? panelIds(next) : [];
  const missing = ids.filter(id => !present.includes(id));
  if (!missing.length) { dockLayout.value = next; return; }
  next = next ?? headless(column([panelNode(missing.shift())]));
  for (const id of missing) next = insertPanel(next, id, panelIds(next).at(-1), 'bottom');
  // A column of single panels shares its height by what each asked for, so a small
  // panel (the minimap) is not handed as much of it as a long one (the orders).
  if (next.kind === 'split' && next.children.every(c => c.kind === 'group' && c.panels.length === 1)) {
    next = { ...next, sizes: next.children.map(c => byId.value.get(c.panels[0])?.h ?? 320) };
  }
  dockLayout.value = next;
}

watch(() => floating.value.map(p => p.id).join('|'), syncFloat, { immediate: true });
watch(() => docked.value.map(p => p.id).join('|'), syncDock, { immediate: true });

// While everything else floats, the column holds only pinned panels, and nothing
// offers to float it — they are pinned. Docked, it is everyone's column.
const dockShown = computed(() => dockLayout.value
  && { ...dockLayout.value, fixedView: props.mode !== 'dock' });

function onFloatLayout(next) { floatLayout.value = next; }

// A column turned into a desktop floats the panels: the desk
// follows, and the desktop loses the bar it would otherwise draw across the board.
// The pinned panels leave it again for a column of their own once the mode has
// flipped (syncFloat / syncDock).
function onDockLayout(next) {
  if (next && isFloat(next) && props.mode === 'dock') {
    floatLayout.value = headless({ ...next, title: undefined, fixedView: undefined });
    dockLayout.value = null;
    emit('update:mode', 'float');
    return;
  }
  dockLayout.value = next ? { ...next, fixedView: undefined } : next;
}

function onFrameChange({ panel, rect }) { remember(panel, rect); }

function onClose(id) {
  const held = floatLayout.value && frameOf(floatLayout.value, id);
  if (held) remember(id, held.rect);
  emit('close', id);
}

// Brings an open panel forward: to the front (and unrolled) as a window, or to
// the top of its tabs in the column.
function focus(id) {
  if (floatLayout.value && panelIds(floatLayout.value).includes(id)) {
    floatLayout.value = minimizeFrame(raiseFrame(floatLayout.value, id), id, false);
  } else if (dockLayout.value) {
    dockLayout.value = setActivePanel(dockLayout.value, id);
  }
}
defineExpose({ focus });

// ── the column's width, dragged from its left edge ─────────────────────────
const dockWidth = ref(readJson(DOCK_W_KEY, 340));
let dragFrom = null;
function startResize(e) {
  dragFrom = { x: e.clientX, w: dockWidth.value };
  window.addEventListener('pointermove', onResize);
  window.addEventListener('pointerup', endResize);
}
function onResize(e) {
  if (!dragFrom) return;
  dockWidth.value = Math.max(240, Math.min(window.innerWidth * 0.6, dragFrom.w + dragFrom.x - e.clientX));
}
function endResize() {
  dragFrom = null;
  window.removeEventListener('pointermove', onResize);
  window.removeEventListener('pointerup', endResize);
  try { localStorage.setItem(DOCK_W_KEY, JSON.stringify(Math.round(dockWidth.value))); } catch { /* private mode */ }
}
onUnmounted(endResize);

// A window left outside the desk by a smaller screen is brought back inside it.
onMounted(() => { if (floatLayout.value) floatLayout.value = floatOf(panelIds(floatLayout.value)); });

// appfr's tokens drawn from the play UI's own theme variables, so a window wears
// whichever theme is on (index.html's :root blocks) rather than appfr's palette.
const tokens = {
  '--dc-surface': 'var(--bg1)', '--dc-ink': 'var(--txt)', '--dc-accent': 'var(--accent)',
  '--dc-ok': 'var(--ok)', '--dc-warn': 'var(--warn)', '--dc-danger': 'var(--danger)',
  '--dc-sans': 'var(--ui)', '--dc-mono': 'var(--mono)',
  '--dc-radius-sm': 'var(--r)', '--dc-radius': 'var(--r)', '--dc-radius-lg': 'var(--r2)',
  '--dc-bg-0': 'var(--bg0)', '--dc-bg-1': 'var(--bg1)', '--dc-bg-2': 'var(--bg2)', '--dc-bg-3': 'var(--bg3)',
  '--dc-line': 'var(--line)', '--dc-line-2': 'var(--line2)',
  '--dc-fg-0': 'var(--txt)', '--dc-fg-1': 'var(--txt)', '--dc-fg-2': 'var(--dim)', '--dc-fg-3': 'var(--faint)',
  '--dc-shadow': '0 24px 64px -12px rgba(0,0,0,.7)',
};
</script>

<template>
  <!-- The column first: it is a flex item beside the board. The desktop after it is
       laid over the whole shell, column included. -->
  <div v-show="dockLayout" class="pd pd--dock" :style="{ width: dockWidth + 'px' }">
    <div class="pd-resize" @pointerdown.prevent="startResize"/>
    <WindowFrame v-if="dockLayout" class="pd-frame" theme="dark" :tokens="tokens"
                 :panels="docked" :layout="dockShown" movable resizable closable
                 :min-panel-size="120"
                 @update:layout="onDockLayout" @panel-close="onClose">
      <template v-for="p in slots(docked)" :key="p.id" #[p.slot]>
        <div class="pd-body"><slot :name="p.id"/></div>
      </template>
    </WindowFrame>
  </div>
  <div ref="floatEl" v-show="floatLayout" class="pd pd--float">
    <WindowFrame v-if="floatLayout" class="pd-frame" theme="dark" :tokens="tokens"
                 :panels="floating" :layout="floatLayout" movable resizable closable
                 :min-panel-size="140"
                 @update:layout="onFloatLayout" @frame-change="onFrameChange" @panel-close="onClose">
      <template v-for="p in slots(floating)" :key="p.id" #[p.slot]>
        <div class="pd-body"><slot :name="p.id"/></div>
      </template>
    </WindowFrame>
  </div>
</template>

<style scoped>
.pd--float { position: absolute; inset: 0; z-index: 40; pointer-events: none; }
.pd--dock { position: relative; flex: none; height: 100%; border-left: 1px solid var(--line); background: var(--bg0); }
.pd-frame { height: 100%; }
.pd-body { position: relative; height: 100%; overflow: auto; font-family: var(--ui); color: var(--txt); }
.pd-resize { position: absolute; left: -3px; top: 0; bottom: 0; width: 6px; cursor: col-resize; z-index: 2; }
.pd-resize:hover { background: var(--accent-d); }

/* Floating: the desk itself is see-through and click-through — the board stays
   playable everywhere no window covers it. */
.pd--float :deep(.dc-window) { padding: 0; background: transparent; }
.pd--float :deep(.dc-window > .dc-space) { border: none; background: transparent; }
.pd--float :deep(.dc-float) { pointer-events: auto; }
.pd--dock :deep(.dc-window) { padding: 6px; }
/* Docked, the column is no box of its own: the panels sit straight on it. */
.pd--dock :deep(.dc-window > .dc-space) { border: none; background: transparent; }
</style>
