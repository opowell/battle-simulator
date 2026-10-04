<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue';
import HtmlIsoUnit from './battlefield/HtmlIsoUnit.vue';
// HTML/CSS isometric board renderer — used for sprite-tile isometric games (civ2); other
// isometric modes (textured terrain) fall to IsoLayer's SVG (see Battlefield.vue's
// useHtmlRenderer; there is no user toggle). HtmlLayer is the flat-grid equivalent.
//
// Scope is IsoLayer's 'sprite' tile mode + 'token' unit style only: flat boards whose
// terrain is pre-drawn diamond art, blitted centred on each cell. IsoLayer's other mode
// ('texture', FFTA/xcom) skews terrain onto the ground plane and extrudes cliff faces per
// tile height — a real 3-D projection that SVG patterns do and CSS boxes don't, so those
// games keep using IsoLayer and Battlefield routes them there.
//
// Each tile is one absolutely-positioned box on its diamond's bounding rect, clipped to
// the diamond itself. The clip is load-bearing twice over: it trims the opaque corners
// classic Civ2 tilesets bake in (they're drawn to overlap; we tessellate exactly), and it
// clips hit-testing too — so a click lands on the tile whose diamond you actually pressed
// and each tile can own its own click handler, no manual hit-test needed. Painting order
// is z-index by depth (x+y) rather than IsoLayer's back-to-front array.
//
// Globals (window.*) come from data.js etc., loaded as classic <script>s in index.html —
// vue3-sfc-loader can't parse an ESM import of a plain .js.

const props = defineProps({
  field:        Object,
  units:        Array,
  selectedId:   String,
  activeUnitId: { type: String, default: null },
  fog:          Boolean,
  rdr:          Object,
  legalSquares:    { type: Array, default: () => [] },
  lastMoveSquares: { type: Array, default: () => [] },
  revealAll:       { type: Boolean, default: false },
  viewerTeam:      { type: String, default: null },
});
const emit = defineEmits(['select', 'sq-click']);
const imgSrc = window.api.imgSrc;

const PAD = 26;

// ── container sizing ──────────────────────────────────────────────────────────
const rootEl = ref(null);
const boxW = ref(900), boxH = ref(640);
let ro = null;
onMounted(() => {
  ro = new ResizeObserver(([entry]) => {
    boxW.value = entry.contentRect.width;
    boxH.value = entry.contentRect.height;
  });
  if (rootEl.value) ro.observe(rootEl.value);
});
onUnmounted(() => ro?.disconnect());

// ── fog visibility (distance-based, mirroring IsoLayer's square fog) ──────────
const visibleSet = computed(() => {
  if (!props.fog || props.revealAll) return null;
  const W = props.field.world.w, H = props.field.world.h;
  const sight = W * 0.22;
  const friends = props.units.filter(u => u.friendly && !u.dead);
  const vis = new Set();
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (friends.some(f => Math.hypot(f.x - (x + 0.5), f.y - (y + 0.5)) < sight)) vis.add(`${x},${y}`);
  return vis;
});
function tileVisible(x, y) { return !visibleSet.value || visibleSet.value.has(`${x},${y}`); }
function unitVisible(u) {
  if (!props.fog || props.revealAll) return true;
  if (u.friendly) return true;
  return tileVisible(Math.floor(u.x), Math.floor(u.y));
}

// ── projection ────────────────────────────────────────────────────────────────
// Solve the fit at unit scale (half-width 1), exactly as IsoLayer does, then snap the
// half-width to an even number of pixels. Even, because the half-height is half of it:
// an odd half-width would put every second diamond's tips on a half-pixel, and neighbours
// that don't share an exact edge leave hairline seams between tiles.
const geom = computed(() => {
  const tiles = props.field.tiles ?? [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const t of tiles) {
    const cx = t.x - t.y, cy = (t.x + t.y) * 0.5;
    minX = Math.min(minX, cx - 1); maxX = Math.max(maxX, cx + 1);
    minY = Math.min(minY, cy - 0.5); maxY = Math.max(maxY, cy + 0.5);
  }
  if (!isFinite(minX)) { minX = maxX = minY = maxY = 0; }
  const spanX = Math.max(1e-3, maxX - minX), spanY = Math.max(1e-3, maxY - minY);
  const raw = Math.min((boxW.value - 2 * PAD) / spanX, (boxH.value - 2 * PAD) / spanY);
  const hw = Math.max(6, 2 * Math.floor(raw / 2));
  const hh = hw / 2;
  const originX = Math.round((boxW.value - spanX * hw) / 2 - minX * hw);
  const originY = Math.round((boxH.value - spanY * hw) / 2 - minY * hw);
  return { hw, hh, originX, originY,
           gridClip: diamondRing(hw, hh, 0.75), hiClip: diamondRing(hw, hh, 1.5) };
});

// Clip path for a diamond outline: the tile's diamond, minus the same diamond inset by
// `d` px, as one even-odd polygon — so an element wearing it paints just the 0.75px band
// along the tile edges (IsoLayer strokes the same line on its <polygon>). A border can't
// do this; the box's border follows its rectangle, and the clip then throws it away.
// Insetting every edge by d shrinks the diamond about its centre by d/inradius, which
// makes the inner ring plain percentages of the same box.
function diamondRing(hw, hh, d) {
  const inradius = (hw * hh) / Math.hypot(hw, hh);
  const k = Math.max(0, 1 - d / inradius);
  const lo = (50 - 50 * k).toFixed(2), hi = (50 + 50 * k).toFixed(2);
  return `polygon(evenodd, 50% 0, 100% 50%, 50% 100%, 0 50%,`
       + ` 50% ${lo}%, ${hi}% 50%, 50% ${hi}%, ${lo}% 50%)`;
}

// ── lookups ───────────────────────────────────────────────────────────────────
const legalSet = computed(() => new Set(props.legalSquares.map(([c, r]) => `${c},${r}`)));
const lastSet  = computed(() => new Set(props.lastMoveSquares.map(([c, r]) => `${c},${r}`)));
const unitsAt = computed(() => {
  const m = new Map();
  for (const u of props.units) {
    if (!unitVisible(u)) continue;
    const k = `${Math.floor(u.x)},${Math.floor(u.y)}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(u);
  }
  return m;
});

// Depth: the diagonal a cell sits on, painted back to front. Tiles and the tokens standing
// on them interleave (a token must cover its own tile but not the one in front), so each
// depth step owns two z-index slots — tile below, token above.
const zTile  = (gx, gy) => (gx + gy) * 2;
const zToken = (gx, gy) => (gx + gy) * 2 + 1;

// ── tiles: one box per diamond, positioned on its bounding rect ───────────────
const tiles = computed(() => {
  const { hw, hh, originX, originY } = geom.value;
  return (props.field.tiles ?? []).map(t => {
    const k = `${t.x},${t.y}`;
    const cx = originX + (t.x - t.y) * hw, cy = originY + (t.x + t.y) * hh;
    return {
      k, x: t.x, y: t.y,
      style: { left: (cx - hw) + 'px', top: (cy - hh) + 'px',
               width: (hw * 2) + 'px', height: (hh * 2) + 'px', zIndex: zTile(t.x, t.y) },
      color: t.color || '#808070',
      img:   imgSrc(t.bgImage),
      fogged: !tileVisible(t.x, t.y),
      legal:  legalSet.value.has(k),
      lastMove: lastSet.value.has(k),
    };
  });
});

// ── tokens: a separate layer, not tile children ───────────────────────────────
// A token's rings, sprite and HP bar all spill well outside its tile's diamond, and the
// tile's clip-path cuts off everything it paints — descendants included, at any position.
// So tokens are siblings of the tiles, anchored as zero-size points on the tile centre
// (each one positions itself around that origin, see HtmlIsoUnit) and ordered by z-index.
const tokens = computed(() => {
  const { hw, hh, originX, originY } = geom.value;
  return props.units.filter(unitVisible).map(u => {
    const gx = Math.floor(u.x), gy = Math.floor(u.y);
    // Units carry continuous coordinates at cell centres (x.5), so shift to the cell
    // corner before projecting — this is IsoLayer's `fx`/`fy`.
    const fx = u.x - 0.5, fy = u.y - 0.5;
    return {
      u,
      style: { left: (originX + (fx - fy) * hw) + 'px', top: (originY + (fx + fy) * hh) + 'px',
               zIndex: zToken(gx, gy) },
      // Full-health tokens skip the HP bar, to reduce civ clutter (mirrors IsoLayer).
      showHp: props.field.ui?.showHpBars !== false && (u.currentHp ?? u.hpNow) < u.hpMax,
    };
  });
});

// ── clicks (same emit contract as IsoLayer) ───────────────────────────────────
// The tile's diamond clip means this only fires for a press inside the diamond itself;
// tokens are pointer-events:none, so a click on a unit lands on the tile it stands on.
function handleTileClick(t) {
  if (t.legal) { emit('sq-click', t.x, t.y); return; }
  const u = (unitsAt.value.get(t.k) ?? []).find(u => !u.dead);
  if (u) emit('select', u.id); else emit('sq-click', t.x, t.y);
}
</script>

<template>
  <div ref="rootEl" class="bf-layer hi-root" :style="{ background: rdr.stage }"
       @click="emit('select', null)">
    <div v-for="t in tiles" :key="t.k" class="hi-tile" :style="t.style"
         @click.stop="handleTileClick(t)">
      <!-- Terrain colour under the art: fills the gaps left by partial/transparent tiles,
           matching the flat renderer -->
      <div class="hi-fill" :style="{ background: t.color }"/>
      <img v-if="t.img" class="hi-fill hi-pixel" :src="t.img" draggable="false"/>
      <div class="hi-fill" :style="{ background: rdr.grid, clipPath: geom.gridClip }"/>
      <!-- legal / last-move: a translucent diamond, and for legal tiles a brighter edge
           along the rim (IsoLayer strokes the same tint on its highlight polygon) -->
      <template v-if="t.legal">
        <div class="hi-fill hi-legal"/>
        <div class="hi-fill hi-legal-edge" :style="{ clipPath: geom.hiClip }"/>
      </template>
      <div v-else-if="t.lastMove" class="hi-fill hi-lastmove"/>
      <div v-if="t.fogged"   class="hi-fill hi-fog"/>
    </div>

    <div v-for="tk in tokens" :key="tk.u.id" class="hi-token" :style="tk.style">
      <HtmlIsoUnit :unit="tk.u" :hw="geom.hw" :rdr="rdr" :spriteSrc="imgSrc(tk.u.imagePath)"
        :active="tk.u.id === activeUnitId" :selected="tk.u.id === selectedId"
        :showHp="tk.showHp"/>
    </div>
  </div>
</template>

<style scoped>
/* Dragging across the board must never start a native text/image selection — the browser
   would paint its selection tint over whole tiles and sprites (IsoLayer's SVG is immune;
   real DOM is not). Images additionally opt out of native drag via draggable="false". */
.hi-root { position: absolute; inset: 0; overflow: hidden; user-select: none; }

/* The diamond: clips the art to the tile's true shape, and with it the click target. */
.hi-tile {
  position: absolute;
  clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
  cursor: pointer;
}
.hi-fill { position: absolute; inset: 0; pointer-events: none; }
img.hi-fill { display: block; width: 100%; height: 100%; }
.hi-pixel { image-rendering: pixelated; }

.hi-legal      { background: rgba(66,198,230,0.34); }
.hi-legal-edge { background: rgba(66,198,230,0.75); }
.hi-lastmove { background: rgba(242,180,65,0.34); }
.hi-fog      { background: rgba(9,11,16,0.60); }

/* Zero-size anchor on the tile centre; the token draws around it, unclipped. Clicks fall
   through to the tile below, so tile hit-testing stays the only hit-testing. */
.hi-token { position: absolute; width: 0; height: 0; pointer-events: none; }
</style>
