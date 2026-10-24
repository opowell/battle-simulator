<script setup>
import { ref, computed, watchEffect, onMounted, onUnmounted } from 'vue';
// Overview map for zoom/pan games (the `mapZoom` option — see Battlefield.vue's zoom
// state), in a panel of its own docked beside the board. A zoomed-in map shows a few dozen
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

// The map fills the box it is given (its panel — see GamePanels), keeping its own
// aspect ratio inside it, so a wide world is short. Until that box has been measured
// it is drawn at a small default.
const boxEl = ref(null);
const box = ref({ w: 180, h: 150 });
let boxObserver = null;
onMounted(() => {
  boxObserver = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    if (width > 0 && height > 0) box.value = { w: width, h: height };
  });
  boxObserver.observe(boxEl.value);
});
onUnmounted(() => boxObserver?.disconnect());

const W = computed(() => props.field?.world?.w ?? 0);
const H = computed(() => props.field?.world?.h ?? 0);
const wrap = computed(() => !!props.field?.world?.wrap);

// px per world tile on the minimap (not rounded — a 3.4px tile stays 3.4px so the drawn
// map is exactly the world's aspect ratio; the fills below overdraw to hide the seams).
// The 2px are the border round it.
const s = computed(() => (W.value && H.value)
  ? Math.max(0, Math.min((box.value.w - 2) / W.value, (box.value.h - 2) / H.value)) : 0);
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
  if (u.friendly || u.known) return true;
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

// ── terrain shapes ────────────────────────────────────────────────────────────
// A shape map (field.shapes — the layered terrain SchematicLayer draws, decoration
// included) has no per-tile colours worth showing, so the minimap paints the shapes
// themselves, fills only (stroke widths are screen pixels on the board, meaningless at
// this scale). Painted once into an offscreen canvas per shape list and scale, then
// blitted: a pan repaints the minimap every frame, and a dressed map can run to a
// couple of thousand primitives.
let shapeCache = null;
function shapeLayer(shapes, scale, dpr) {
  if (shapeCache && shapeCache.shapes === shapes && shapeCache.scale === scale && shapeCache.dpr === dpr)
    return shapeCache.canvas;
  const c = document.createElement('canvas');
  c.width = Math.round(cssW.value * dpr);
  c.height = Math.round(cssH.value * dpr);
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0); // world units from here on
  for (const sh of shapes) {
    if (!sh.fill || sh.fill === 'none' || sh.shape === 'line') continue;
    ctx.beginPath();
    if (sh.shape === 'oval') ctx.ellipse(sh.x + sh.w / 2, sh.y + sh.h / 2, sh.w / 2, sh.h / 2, 0, 0, Math.PI * 2);
    else if (sh.shape === 'poly') {
      sh.points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.closePath();
    } else if (sh.rx && ctx.roundRect) ctx.roundRect(sh.x, sh.y, sh.w, sh.h, sh.rx);
    else ctx.rect(sh.x, sh.y, sh.w, sh.h);
    ctx.globalAlpha = sh.opacity ?? 1;
    ctx.fillStyle = sh.fill;
    ctx.fill();
  }
  shapeCache = { shapes, scale, dpr, canvas: c };
  return c;
}

// ── unit marks ────────────────────────────────────────────────────────────────
// Each unit is drawn in its own shape, not a generic square: the game's `footprint`
// for it when it gives one (its real outline in world tiles — a tank's oriented hull
// rectangle, a squad's circle), else the token shape the board draws it as
// (ui.unitShapes, or a circle on a continuous map and a square on a grid).
function unitShape(u) {
  return props.field?.ui?.unitShapes?.[u.type]
    ?? (props.field?.locationType === 'continuous' ? 'circle' : 'square');
}

function drawUnit(ctx, u, outline) {
  const fp = u.footprint;
  // Unit positions are already the point the board draws them at (a grid unit's x/y
  // carry its cell-centre offset — see SessionView), so no half-tile shift here.
  const cx = u.x * s.value, cy = u.y * s.value;
  // Without a footprint, a mark is sized up from the tile so a single unit is still
  // findable on a map drawn at 2px per tile; a footprint draws true to scale, but
  // never below a findable minimum.
  const r = fp?.r != null ? Math.max(1.5, fp.r * s.value) : Math.max(1.5, s.value * 0.9);
  ctx.beginPath();
  if (fp?.shape === 'rect') {
    const w = Math.max(3, fp.w * s.value) / 2, h = Math.max(2, fp.h * s.value) / 2;
    const c = Math.cos(fp.ang ?? 0), sn = Math.sin(fp.ang ?? 0);
    [[w, h], [-w, h], [-w, -h], [w, -h]].forEach(([x, y], i) => {
      const px = cx + x * c - y * sn, py = cy + x * sn + y * c;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    });
    ctx.closePath();
  } else {
    const shape = fp?.shape ?? unitShape(u);
    if (shape === 'circle') ctx.arc(cx, cy, r, 0, Math.PI * 2);
    else if (shape === 'triangle') {
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy + r); ctx.lineTo(cx - r, cy + r); ctx.closePath();
    } else ctx.rect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.fill();
  if (outline) ctx.stroke();
}

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

  // Shape terrain over the tile fills; then any tile still in the dark is covered again,
  // so the shapes withhold exactly what the tiles do.
  const shapes = props.field?.shapes;
  if (shapes?.length) {
    ctx.drawImage(shapeLayer(shapes, s.value, dpr), 0, 0, cssW.value, cssH.value);
    if (fogVisibleSet.value) {
      ctx.fillStyle = props.rdr?.fogA;
      for (const t of props.field?.tiles ?? [])
        if (tileHidden(t)) ctx.fillRect(t.x * s.value, t.y * s.value, px, px);
    }
  }

  // Units, in team colour — outlined over shape terrain, where a bare fill gets lost
  // in the detail.
  const outline = !!shapes?.length;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 1;
  for (const u of props.units) {
    if (u.dead || !isVisible(u)) continue;
    ctx.fillStyle = u.teamObj?.raw ?? '#fff';
    drawUnit(ctx, u, outline);
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
  <div ref="boxEl" class="mm-box">
    <div class="mm" :style="{ width: cssW + 2 + 'px', height: cssH + 2 + 'px' }">
      <canvas ref="canvasEl" class="mm-canvas" :class="{ 'mm-dragging': dragging }"
              :style="{ width: cssW + 'px', height: cssH + 'px' }"
              title="Click or drag to pan · double-click to zoom in · shift+double-click to zoom out"
              @pointerdown="onPointerDown" @pointermove="onPointerMove"
              @pointerup="endDrag" @pointercancel="endDrag"
              @dblclick="onDblClick"/>
    </div>
  </div>
</template>

<style scoped>
/* The whole of its panel, the map centred in it. Absolutely placed so the map's own
   size never feeds back into the box it is measured from. */
.mm-box { position: absolute; inset: 8px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.mm {
  flex-shrink: 0; box-sizing: border-box;
  border: 1px solid var(--line); border-radius: var(--r);
  background: var(--bg1);
  overflow: hidden;
}
/* touch-action: a touch drag must pan the map, not scroll/zoom the page under it. */
.mm-canvas { display: block; cursor: grab; touch-action: none; }
.mm-canvas.mm-dragging { cursor: grabbing; }
</style>
