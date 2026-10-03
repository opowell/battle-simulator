<script setup>
// The game screen's panels — the menu, settings, help, … — as appfr windows.
//
// Two ways of showing them, chosen by `mode`:
//   float  every panel is a window floating over the board. The desk is a layer
//          over the whole screen whose bare desktop lets every click through to
//          the board under it; only the windows themselves catch the pointer.
//   dock   the panels are a column of their own beside the board, sharing it as
//          appfr panes (split, tabbed, dragged about — appfr's own menu on the
//          column's bar). Choosing "Desktop" from that menu floats them again.
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
  // The open panels, in the order they were opened: [{ id, title, subtitle?, w?, h? }].
  // w/h are the size a window first opens at.
  panels: { type: Array, default: () => [] },
  mode:   { type: String, default: 'float' },
});
const emit = defineEmits(['close', 'update:mode']);

const DOCK_TITLE = 'Panels';
const RECTS_KEY = 'bs_panel_rects';
const DOCK_W_KEY = 'bs_dock_width';

const root = ref(null);
const layout = ref(null);

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
  const box = root.value?.parentElement?.getBoundingClientRect() ?? { width: 1200, height: 800 };
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
const slotted = computed(() => props.panels.map(p => ({ id: p.id, slot: 'panel-' + p.id })));

function floatLayout(ids) {
  const taken = [];
  const frames = ids.map((id) => {
    const rect = rectFor(byId.value.get(id) ?? { id }, taken);
    taken.push(rect);
    return frame(panelNode(id), rect);
  });
  return headless(float(frames));
}

const dockLayout = (ids) => column(ids.map(panelNode), undefined, DOCK_TITLE);

// Squares the arrangement with the panels that are open: closed ones leave it,
// newly opened ones join it the way this mode adds them.
function sync() {
  const ids = props.panels.map(p => p.id);
  let next = layout.value;
  if (next) for (const id of panelIds(next)) if (!ids.includes(id)) next = next && removePanel(next, id);
  // An emptied column or desktop is started afresh rather than added to.
  if (next && !panelIds(next).length) next = null;
  const present = next ? panelIds(next) : [];
  const missing = ids.filter(id => !present.includes(id));
  if (!missing.length) { layout.value = next; return; }
  if (props.mode === 'float') {
    const base = next && isFloat(next) ? next : headless(float([]));
    const taken = base.frames.map(f => f.rect);
    next = { ...base, frames: [...base.frames, ...missing.map((id) => {
      const rect = rectFor(byId.value.get(id), taken);
      taken.push(rect);
      return frame(panelNode(id), rect);
    })] };
  } else {
    next = next ?? dockLayout([missing.shift()]);
    for (const id of missing) next = insertPanel(next, id, panelIds(next).at(-1), 'bottom');
  }
  layout.value = next;
}

watch(() => props.panels.map(p => p.id).join('|'), sync, { immediate: true });

// Switching modes rebuilds the arrangement in the new shape, every open panel kept.
watch(() => props.mode, (mode) => {
  const ids = layout.value ? panelIds(layout.value) : [];
  layout.value = ids.length ? (mode === 'float' ? floatLayout(ids) : dockLayout(ids)) : null;
});

// "Desktop" chosen from the column's own menu floats the panels: the desk follows,
// and the desktop loses the bar it would otherwise draw across the top of the board.
function onLayout(next) {
  if (next && isFloat(next) && props.mode === 'dock') {
    layout.value = headless({ ...next, title: undefined });
    emit('update:mode', 'float');
    return;
  }
  layout.value = next;
}

function onFrameChange({ panel, rect }) { remember(panel, rect); }

function onClose(id) {
  const held = layout.value && frameOf(layout.value, id);
  if (held) remember(id, held.rect);
  emit('close', id);
}

// Brings an open panel forward: to the front (and unrolled) as a window, or to
// the top of its tabs in the column.
function focus(id) {
  if (!layout.value) return;
  if (isFloat(layout.value)) layout.value = minimizeFrame(raiseFrame(layout.value, id), id, false);
  else layout.value = setActivePanel(layout.value, id);
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
onMounted(() => { if (props.mode === 'float' && layout.value) layout.value = floatLayout(panelIds(layout.value)); });

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
  <div ref="root" class="pd" :class="'pd--' + mode"
       :style="mode === 'dock' ? { width: dockWidth + 'px' } : null"
       v-show="panels.length">
    <div v-if="mode === 'dock'" class="pd-resize" @pointerdown.prevent="startResize"/>
    <WindowFrame v-if="layout" class="pd-frame" theme="dark" :tokens="tokens"
                 :panels="panels" :layout="layout" movable resizable closable
                 :min-panel-size="140"
                 @update:layout="onLayout" @frame-change="onFrameChange" @panel-close="onClose">
      <template v-for="p in slotted" :key="p.id" #[p.slot]>
        <div class="pd-body"><slot :name="p.id"/></div>
      </template>
    </WindowFrame>
  </div>
</template>

<style scoped>
.pd--float { position: absolute; inset: 0; z-index: 40; pointer-events: none; }
.pd--dock { position: relative; flex: none; height: 100%; border-left: 1px solid var(--line); background: var(--bg0); }
.pd-frame { height: 100%; }
.pd-body { height: 100%; overflow: auto; font-family: var(--ui); color: var(--txt); }
.pd-resize { position: absolute; left: -3px; top: 0; bottom: 0; width: 6px; cursor: col-resize; z-index: 2; }
.pd-resize:hover { background: var(--accent-d); }

/* Floating: the desk itself is see-through and click-through — the board stays
   playable everywhere no window covers it. */
.pd--float :deep(.dc-window) { padding: 0; background: transparent; }
.pd--float :deep(.dc-window > .dc-space) { border: none; background: transparent; }
.pd--float :deep(.dc-float) { pointer-events: auto; }
.pd--dock :deep(.dc-window) { padding: 6px; }
</style>
