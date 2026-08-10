<script setup>
import { ref, computed, watchEffect, onUnmounted } from 'vue';
// Overview map for zoom/pan games (the `mapZoom` option — see Battlefield.vue's zoom
// state), drawn in the stage's bottom-right corner. A zoomed-in map shows a few dozen
// tiles of a board that may be 100 wide, so this is the only view of where those tiles
// sit in the world, and the fastest way to jump somewhere far away.
//
// Canvas rather than a grid of divs: at one <div> per tile a 100x60 world is 6000 nodes
// re-laid-out on every pan, for something whose tiles are a single pixel each.
//
// Clicks pan, and a double-click pans *and* zooms — the two-step "get me over there,
// then closer" that a click-to-recentre board otherwise needs the corner buttons for.
// Both are emitted as one `goto` so the parent applies centre-then-zoom in that order
// (zoomBy pins whatever centre is current, so panning first is what keeps the zoom
// anchored on the clicked spot rather than the old one).
//
// Globals (VISION) come from vision.js, loaded as a classic <script> in index.html —
// vue3-sfc-loader can't parse an ESM import of a plain .js.

const props = defineProps({
  field:  Object,
  units:  { type: Array, default: () => [] },
  rdr:    Object,
  // Current view, for the viewport rectangle: the world point held at the middle of the
  // stage (null = the board's centre, i.e. the unpanned fit), the tile size in screen px,
  // and the stage box those two are measured against.
  center: { type: Object, default: null },
  tilePx: { type: Number, default: 0 },
  stageW: { type: Number, default: 0 },
  stageH: { type: Number, default: 0 },
  fog:       { type: Boolean, default: false },
  revealAll: { type: Boolean, default: false },
  // An observer watching through one player's eyes: fog is cast from this team instead
  // of the local player (teams[0]). Mirrors HtmlLayer's prop of the same name.
  viewerOverride: { type: String, default: null },
  // Persistent-vision games (field.ui.persistentFog, e.g. civ1): every tile the viewer
  // has EVER seen (see Battlefield's exploredTileSet). Terrain there stays drawn once
  // explored — which is most of what a minimap is for — while units still re-fog when
  // they leave current sight. Null when the game doesn't remember terrain.
  exploredTiles: { type: Set, default: null },
});
const emit = defineEmits(['goto']);

// Box the map is fitted into. Small enough to stay out of the way of the board it
// overlays; the map keeps its own aspect ratio inside it, so a wide world is short.
const MAX_W = 180, MAX_H = 150;

const W = computed(() => props.field?.world?.w ?? 0);
const H = computed(() => props.field?.world?.h ?? 0);
const wrap = computed(() => !!props.field?.world?.wrap);

// px per world tile on the minimap (not rounded — a 3.4px tile stays 3.4px so the drawn
// map is exactly the world's aspect ratio; the fills below overdraw to hide the seams).
const s = computed(() => (W.value && H.value)
  ? Math.min(MAX_W / W.value, MAX_H / H.value) : 0);
const cssW = computed(() => Math.round(W.value * s.value));
const cssH = computed(() => Math.round(H.value * s.value));

// Tiles the viewer can see right now, so the minimap withholds exactly what the board
// withholds rather than leaking the unexplored map. Same derivation the two board
// renderers each make for themselves (HtmlLayer's squareFogVisibleSet).
const fogVisibleSet = computed(() => {
  if (!props.fog || props.revealAll) return null;
  if (props.field?.ui?.gridFog) return props.field.fogVisible ?? null;
  if (props.field?.grid !== 'square' || props.field?.locationType === 'continuous') return null;
  const viewerId = props.viewerOverride ?? props.field.teams?.[0]?.id ?? null;
  return VISION.visibleTileSet(props.field, VISION.visionSources(props.units, viewerId, null));
});

// Terrain is withheld only where the viewer has neither current sight nor a memory of
// having been there — see the exploredTiles prop.
function tileHidden(t) {
  if (!fogVisibleSet.value) return false;
  const key = `${t.x},${t.y}`;
  if (fogVisibleSet.value.has(key)) return false;
  return !props.exploredTiles?.has(key);
}

// A unit is a dot only where the board would show it at all. Unlike terrain, a remembered
// tile doesn't keep showing whoever used to stand on it — current sight only.
function isVisible(u) {
  if (!props.fog || props.revealAll) return true;
  if (u.friendly) return true;
  if (fogVisibleSet.value) return fogVisibleSet.value.has(`${Math.floor(u.x)},${Math.floor(u.y)}`);
  return u.visible;
}

// The stage's visible world rectangle, in tiles — the viewport box drawn over the map.
const viewRect = computed(() => {
  if (!props.tilePx || !props.stageW || !props.stageH) return null;
  const halfW = props.stageW / 2 / props.tilePx;
  const halfH = props.stageH / 2 / props.tilePx;
  const cx = props.center?.x ?? W.value / 2;
  const cy = props.center?.y ?? H.value / 2;
  return { x: cx - halfW, y: cy - halfH, w: halfW * 2, h: halfH * 2 };
});

// 'team' is a server-side sentinel for "whatever colour the client gave this tile's
// owner" (see SchematicLayer's tileColor) — passed to fillStyle as-is it's an invalid
// colour, which canvas silently ignores, so the tile would take the previous tile's fill.
function tileColor(t) {
  if (t.color !== 'team') return t.color;
  return props.field.teams?.[t.owner - 1]?.raw ?? null;
}

const canvasEl = ref(null);

function draw() {
  const c = canvasEl.value;
  if (!c || !s.value) return;
  const dpr = window.devicePixelRatio || 1;
  c.width  = Math.round(cssW.value * dpr);
  c.height = Math.round(cssH.value * dpr);
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Anything with no tile (or a tile still in the dark) is left as bare background, which
  // is what "unexplored" looks like.
  ctx.fillStyle = props.rdr?.stage ?? '#000';
  ctx.fillRect(0, 0, cssW.value, cssH.value);

  // Fills overdraw by a pixel: at a fractional tile size neighbouring rects otherwise
  // leave hairline gaps of background between them.
  const px = s.value + 1;
  for (const t of props.field?.tiles ?? []) {
    const color = tileHidden(t) ? props.rdr?.fogA : tileColor(t);
    if (!color) continue;
    ctx.fillStyle = color;
    ctx.fillRect(t.x * s.value, t.y * s.value, px, px);
  }

  // Units: a dot each, in team colour. Sized up from the tile so a single unit is still
  // findable on a map drawn at 2px per tile.
  const r = Math.max(1.5, s.value * 0.9);
  for (const u of props.units) {
    if (u.dead || !isVisible(u)) continue;
    ctx.fillStyle = u.teamObj?.raw ?? '#fff';
    ctx.fillRect((u.x + 0.5) * s.value - r, (u.y + 0.5) * s.value - r, r * 2, r * 2);
  }

  // Viewport box. On a wrapping world the stage can straddle the seam, so the box is
  // drawn again a world-width to each side; the canvas clips whichever parts fall off.
  const v = viewRect.value;
  if (v) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.85;
    const offsets = wrap.value ? [-W.value, 0, W.value] : [0];
    for (const off of offsets) {
      ctx.strokeRect(Math.round((v.x + off) * s.value) + 0.5, Math.round(v.y * s.value) + 0.5,
                     Math.round(v.w * s.value), Math.round(v.h * s.value));
    }
    ctx.globalAlpha = 1;
  }
}

// Every dependency read in draw() is reactive, so the map repaints on any of them —
// including canvasEl itself, so the first real paint is the re-run once it's mounted.
watchEffect(draw);

// Where on the world this event landed. Measured off the element's real box so it stays
// right whatever the canvas is scaled to.
//
// A drag holds pointer capture, so it keeps delivering events once the cursor leaves the
// minimap: y is clamped because there's nothing above or below the poles to look at, but
// on a wrapping world x deliberately isn't — running off the right edge yields x > W,
// which the parent's clampAxis normalises back into range, so the view wraps around the
// cylinder instead of sticking at the seam.
function worldAt(e) {
  const rect = canvasEl.value.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width  * W.value;
  const y = (e.clientY - rect.top)  / rect.height * H.value;
  return {
    x: wrap.value ? x : Math.min(W.value, Math.max(0, x)),
    y: Math.min(H.value, Math.max(0, y)),
  };
}

// ── gestures ──────────────────────────────────────────────────────────────────
// Drag pans live. A plain click is just a degenerate drag, so pointerdown is the only
// pan path — no separate click handler, which is also what keeps a click from emitting
// the same pan twice. Double-click still lands on top of that: its two pointerdowns pan
// to the spot, then dblclick pans+zooms to the same spot, so the destination is
// identical either way and neither needs suppressing.
const dragging = ref(false);
// Moves arrive faster than the board can usefully redraw (a centre change re-renders the
// whole board layer), so they're coalesced to one emit per frame.
let pendingPt = null, rafId = 0;

function flushDrag() {
  rafId = 0;
  if (pendingPt) { emit('goto', { ...pendingPt, zoom: 0 }); pendingPt = null; }
}

function onPointerDown(e) {
  if (e.button != null && e.button !== 0) return; // left button / touch only
  dragging.value = true;
  canvasEl.value?.setPointerCapture?.(e.pointerId);
  emit('goto', { ...worldAt(e), zoom: 0 });
}

function onPointerMove(e) {
  if (!dragging.value) return;
  e.preventDefault?.(); // a drag over a canvas would otherwise start a native image drag
  pendingPt = worldAt(e);
  if (!rafId) rafId = requestAnimationFrame(flushDrag);
}

function endDrag(e) {
  if (!dragging.value) return;
  dragging.value = false;
  canvasEl.value?.releasePointerCapture?.(e.pointerId);
  // Emit whatever the last move produced rather than dropping it on the floor — without
  // this, a drag ending between frames lands the view a few tiles short of the cursor.
  if (rafId) { cancelAnimationFrame(rafId); flushDrag(); }
}

function onDblClick(e) { emit('goto', { ...worldAt(e), zoom: e.shiftKey ? -1 : 1 }); }

onUnmounted(() => { if (rafId) cancelAnimationFrame(rafId); });
</script>

<template>
  <div class="mm" :style="{ width: cssW + 'px', height: cssH + 'px' }">
    <canvas ref="canvasEl" class="mm-canvas" :class="{ 'mm-dragging': dragging }"
            :style="{ width: cssW + 'px', height: cssH + 'px' }"
            title="Click or drag to pan · double-click to zoom in · shift+double-click to zoom out"
            @pointerdown="onPointerDown" @pointermove="onPointerMove"
            @pointerup="endDrag" @pointercancel="endDrag"
            @dblclick="onDblClick"/>
  </div>
</template>

<style scoped>
/* The left sidebar's footer: it sits below the column's scrolling region (see
   Battlefield's .bf-col-body), so it's always at the bottom without floating
   over the panels above — nothing ever scrolls under it. flex-shrink guards
   against a short viewport squashing it. */
.mm {
  margin: 10px auto; flex-shrink: 0;
  border: 1px solid var(--line); border-radius: var(--r);
  background: var(--bg1);
  overflow: hidden;
}
/* touch-action: a touch drag must pan the map, not scroll/zoom the page under it. */
.mm-canvas { display: block; cursor: grab; touch-action: none; }
.mm-canvas.mm-dragging { cursor: grabbing; }
</style>
