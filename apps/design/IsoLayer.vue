<script setup>
// Generic isometric board renderer. Opt in with `field.ui.isometric` (Battlefield picks
// IsoLayer over SchematicLayer). Data-driven from the same `field.tiles` (x, y, height,
// bgImage, color) and `units` the flat renderer uses, so any square-grid game can adopt it.
//
// Two tile modes (field.ui.isoTileMode):
//   'texture' (default, FFTA) — flat terrain textures skewed onto the ground plane via an
//              SVG pattern, with height-extruded left/right cliff faces. Real 3-D steps.
//   'sprite'  (civ2)          — pre-drawn isometric diamond tiles blitted centred on each
//              cell; no skew, no cliffs (these games are flat, height 0).
// Two unit styles (field.ui.isoUnitStyle): 'character' (default, FFTA — standing sprite with
// shadow/footring/facing) and 'token' (civ2 — sprite centred on an owner-tinted marker).
// Everything is painted back-to-front; clicks hit-test tile tops → same sq-click/select events.
import { computed, ref, onMounted, onUnmounted } from 'vue';

const props = defineProps({
  field:        Object,
  fit:          Object,
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

const PAD = 26;
const DZR = 0.5;   // one height level rises DZR·halfWidth on screen
const TS  = 64;    // pattern tile size (px) — one terrain texture per grid cell

const tileMode  = computed(() => props.field.ui?.isoTileMode  ?? 'texture');
const unitStyle = computed(() => props.field.ui?.isoUnitStyle ?? 'character');

// ── container sizing ──────────────────────────────────────────────────────────
const host = ref(null);
const svgEl = ref(null);
const box = ref({ w: 900, h: 640 });
let ro;
onMounted(() => {
  const measure = () => { if (host.value) box.value = { w: host.value.clientWidth || 900, h: host.value.clientHeight || 640 }; };
  measure();
  ro = new ResizeObserver(measure);
  if (host.value) ro.observe(host.value);
});
onUnmounted(() => ro && ro.disconnect());

// ── helpers ───────────────────────────────────────────────────────────────────
function shade(hex, f) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex || '#808070';
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  return `rgb(${r},${g},${b})`;
}
const pts = arr => arr.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');

// ── fog visibility (distance-based, mirrors SchematicLayer's square fog) ────────
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

// ── projection + scene ──────────────────────────────────────────────────────────
const scene = computed(() => {
  const sprite = tileMode.value === 'sprite';
  const token = unitStyle.value === 'token';
  const W = props.field.world.w, H = props.field.world.h;
  const tiles = props.field.tiles ?? [];
  const heightAt = new Map(tiles.map(t => [`${t.x},${t.y}`, t.height || 0]));

  // extents at unit scale (halfWidth = 1) to solve the fit
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const t of tiles) {
    const h = sprite ? 0 : (t.height || 0);
    const cx = t.x - t.y, cyTop = (t.x + t.y) * 0.5 - h * DZR;
    const bottom = sprite ? 0.5 : (h + 1) * DZR;   // diamond bottom, or face bottom
    minX = Math.min(minX, cx - 1); maxX = Math.max(maxX, cx + 1);
    minY = Math.min(minY, cyTop - 0.5); maxY = Math.max(maxY, cyTop + bottom);
  }
  if (!isFinite(minX)) { minX = maxX = minY = maxY = 0; }
  const spanX1 = Math.max(1e-3, maxX - minX), spanY1 = Math.max(1e-3, maxY - minY);
  const hw = Math.max(6, Math.min((box.value.w - 2 * PAD) / spanX1, (box.value.h - 2 * PAD) / spanY1));
  const hh = hw * 0.5, dz = hw * DZR;
  const originX = (box.value.w - spanX1 * hw) / 2 - minX * hw;
  const originY = (box.value.h - spanY1 * hw) / 2 - minY * hw;

  // texture mode: one skewed pattern per (texture, height), mapping a TS×TS tile onto the ground basis
  const patterns = [];
  const patId = new Map();
  const patFor = (href, h) => {
    if (!href) return null;
    const key = `${href}@${h}`;
    if (!patId.has(key)) {
      const id = `isopat${patterns.length}`;
      const a = hw / TS, b = hh / TS, c = -hw / TS, d = hh / TS;
      patterns.push({ id, href, matrix: `matrix(${a},${b},${c},${d},${originX},${(originY - h * dz).toFixed(2)})` });
      patId.set(key, id);
    }
    return patId.get(key);
  };

  const P = (gx, gy, z = 0) => [originX + (gx - gy) * hw, originY + (gx + gy) * hh - z];

  const tileDraw = tiles.map(t => {
    const h = sprite ? 0 : (t.height || 0);
    const [cx, cyTop] = P(t.x, t.y, h * dz);
    const N = [cx, cyTop - hh], E = [cx + hw, cyTop], S = [cx, cyTop + hh], Wc = [cx - hw, cyTop];
    const top = pts([N, E, S, Wc]);
    const base = {
      kind: 'tile', key: `t${t.x},${t.y}`, depth: t.x + t.y, gx: t.x, gy: t.y, cx, cyTop, top,
      fogged: !tileVisible(t.x, t.y),
    };
    if (sprite) {
      return { ...base, sprite: true, img: t.bgImage,
        imgX: cx - hw, imgY: cyTop - hh, imgW: hw * 2, imgH: hh * 2, topFill: t.color || '#808070' };
    }
    const fH = (h + 1) * dz;
    return { ...base, sprite: false,
      right: pts([E, S, [S[0], S[1] + fH], [E[0], E[1] + fH]]),
      left:  pts([Wc, S, [S[0], S[1] + fH], [Wc[0], Wc[1] + fH]]),
      topFill: t.bgImage ? `url(#${patFor(t.bgImage, h)})` : (t.color || '#808070'),
      rightFill: shade(t.color, 0.70), leftFill: shade(t.color, 0.48) };
  });

  const unitDraw = props.units.filter(u => unitVisible(u)).map(u => {
    const fx = u.x - 0.5, fy = u.y - 0.5;
    const h = sprite ? 0 : (heightAt.get(`${Math.floor(u.x)},${Math.floor(u.y)}`) || 0);
    const [sx, syTop] = P(fx, fy, h * dz);
    const a = u.ang ?? 0;
    let dx = Math.cos(a) - Math.sin(a), dy = (Math.cos(a) + Math.sin(a)) * 0.5;
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const spriteW = hw * (token ? 1.45 : 1.7);
    const imgX = sx - spriteW / 2;
    const imgY = token ? syTop - spriteW * 0.62 : syTop + hh * 0.30 - spriteW;
    return {
      kind: 'unit', key: `u${u.id}`, depth: Math.floor(u.x) + Math.floor(u.y) + 0.5,
      u, sx, syTop, token, spriteW, imgX, imgY, hpY: imgY - 6,
      faceTip: [sx + dx * hw * 0.62, syTop + dy * hw * 0.62],
      faceL:   [sx + (-dy) * hw * 0.16, syTop + (dx) * hw * 0.16 * 0.5],
      faceR:   [sx + (dy) * hw * 0.16, syTop + (-dx) * hw * 0.16 * 0.5],
      hw, hh,
    };
  });

  const draw = [...tileDraw, ...unitDraw].sort((p, q) => p.depth - q.depth || (p.kind === 'unit' ? 1 : -1));
  return { hw, hh, dz, originX, originY, patterns, tiles: tileDraw, draw };
});

// legal / last-move lookups
const legalSet = computed(() => new Set(props.legalSquares.map(([c, r]) => `${c},${r}`)));
const lastSet  = computed(() => new Set(props.lastMoveSquares.map(([c, r]) => `${c},${r}`)));
function tileHi(t) {
  if (legalSet.value.has(`${t.gx},${t.gy}`)) return 'rgba(66,198,230,0.34)';
  if (lastSet.value.has(`${t.gx},${t.gy}`))  return 'rgba(242,180,65,0.34)';
  return null;
}

function hpColor(frac, raw) { return frac > 0.5 ? raw : frac > 0.25 ? '#f2b441' : '#ff5f56'; }

// Design rule (see SchematicLayer's facingActive): a unit shows its facing arrow or its
// type letter, never both. Only the 'character' style ever draws a facing arrow — 'token'
// style units always get the letter.
const facingActive = computed(() => unitStyle.value === 'character' && props.field.ui?.showFacing !== false);

// markerGlyph's polygon points are origin-relative (see data.js); IsoLayer bakes absolute
// screen coordinates into every shape's attributes instead of using a per-unit <g
// transform> (see the tile/unit drawing above), so offset them here before use.
function isoMarkerPolygon(pointsStr, ox, oy) {
  return pointsStr.split(' ').map(pair => {
    const [x, y] = pair.split(',').map(Number);
    return `${(x + ox).toFixed(2)},${(y + oy).toFixed(2)}`;
  }).join(' ');
}

// ── click: front-to-back hit-test on tile tops ─────────────────────────────────
function onClick(e) {
  const s = scene.value;
  const rect = svgEl.value.getBoundingClientRect();
  const px = e.clientX - rect.left, py = e.clientY - rect.top;
  const hit = [...s.tiles].sort((a, b) => b.depth - a.depth)
    .find(t => Math.abs((px - t.cx) / s.hw) + Math.abs((py - t.cyTop) / s.hh) <= 1.02);
  if (!hit) { emit('select', null); return; }
  const col = hit.gx, row = hit.gy;
  if (legalSet.value.has(`${col},${row}`)) { emit('sq-click', col, row); return; }
  const u = props.units.find(u => !u.dead && Math.floor(u.x) === col && Math.floor(u.y) === row && unitVisible(u));
  if (u) emit('select', u.id); else emit('sq-click', col, row);
}
</script>

<template>
  <div ref="host" class="bf-layer" :style="{ background: rdr.stage, overflow: 'hidden' }">
    <svg ref="svgEl" :width="box.w" :height="box.h" @click="onClick"
         style="position:absolute;inset:0;display:block;cursor:pointer">
      <defs>
        <!-- clips a sprite tile to its inscribed diamond, trimming the opaque corners some
             tilesets bake in (classic Civ2 tiles overlap; we tessellate exactly instead) -->
        <clipPath id="isodiamond" clipPathUnits="objectBoundingBox">
          <polygon points="0.5,0 1,0.5 0.5,1 0,0.5"/>
        </clipPath>
        <pattern v-for="p in scene.patterns" :key="p.id" :id="p.id"
                 patternUnits="userSpaceOnUse" :width="TS" :height="TS" :patternTransform="p.matrix">
          <image :href="p.href" :width="TS" :height="TS" preserveAspectRatio="none"
                 style="image-rendering:pixelated"/>
        </pattern>
      </defs>

      <template v-for="d in scene.draw" :key="d.key">
        <!-- Terrain -->
        <g v-if="d.kind === 'tile'">
          <!-- sprite mode: terrain-colour diamond (fills gaps under partial/transparent
               tiles, matching the flat renderer) then the pre-drawn diamond tile on top -->
          <template v-if="d.sprite">
            <polygon :points="d.top" :fill="d.topFill"
                     :stroke="rdr.grid" stroke-width="0.5" stroke-linejoin="round"/>
            <image v-if="d.img" :href="d.img" :x="d.imgX" :y="d.imgY" :width="d.imgW" :height="d.imgH"
                   preserveAspectRatio="none" clip-path="url(#isodiamond)" style="image-rendering:pixelated"/>
          </template>
          <!-- texture mode: extruded diamond with cliff faces -->
          <template v-else>
            <polygon :points="d.right" :fill="d.rightFill"/>
            <polygon :points="d.left"  :fill="d.leftFill"/>
            <polygon :points="d.top" :fill="d.topFill"
                     :stroke="rdr.grid" stroke-width="0.75" stroke-linejoin="round"/>
          </template>
          <polygon v-if="tileHi(d)" :points="d.top" :fill="tileHi(d)"
                   stroke="rgba(66,198,230,0.75)" stroke-width="1" style="pointer-events:none"/>
          <polygon v-if="d.fogged" :points="d.top" fill="rgba(9,11,16,0.60)" style="pointer-events:none"/>
        </g>

        <!-- Unit / city -->
        <g v-else style="pointer-events:none">
          <g v-if="d.u.dead" :opacity="0.4">
            <line :x1="d.sx-d.hw*.4" :y1="d.syTop-d.hh*.4" :x2="d.sx+d.hw*.4" :y2="d.syTop+d.hh*.4"
                  :stroke="d.u.teamObj.raw" stroke-width="2"/>
            <line :x1="d.sx-d.hw*.4" :y1="d.syTop+d.hh*.4" :x2="d.sx+d.hw*.4" :y2="d.syTop-d.hh*.4"
                  :stroke="d.u.teamObj.raw" stroke-width="2"/>
          </g>
          <template v-else>
            <!-- token base marker (civ2): a diamond, matching the isometric tile shape -->
            <polygon v-if="d.token"
                     :points="pts([[d.sx, d.syTop+d.hh*0.12-d.hh*0.66],[d.sx+d.hw*0.66, d.syTop+d.hh*0.12],[d.sx, d.syTop+d.hh*0.12+d.hh*0.66],[d.sx-d.hw*0.66, d.syTop+d.hh*0.12]])"
                     :fill="d.u.teamObj.raw" fill-opacity="0.28" :stroke="d.u.teamObj.raw" stroke-width="1.5"/>
            <!-- character extras (FFTA) -->
            <template v-else>
              <ellipse :cx="d.sx" :cy="d.syTop+d.hh*0.32" :rx="d.hw*0.52" :ry="d.hh*0.52" fill="rgba(0,0,0,0.28)"/>
              <polygon v-if="field.ui?.showFacing !== false"
                       :points="`${d.faceTip[0]},${d.faceTip[1]} ${d.faceL[0]},${d.faceL[1]} ${d.faceR[0]},${d.faceR[1]}`"
                       :fill="d.u.id === activeUnitId ? 'white' : d.u.teamObj.raw" :stroke="rdr.stage" stroke-width="0.5"/>
              <ellipse :cx="d.sx" :cy="d.syTop+d.hh*0.30" :rx="d.hw*0.44" :ry="d.hh*0.44"
                       fill="none" :stroke="d.u.teamObj.raw" stroke-width="2" opacity="0.9"/>
            </template>
            <!-- selection / active ring (both styles) -->
            <ellipse v-if="d.u.id === activeUnitId"
                     :cx="d.sx" :cy="d.syTop" :rx="d.hw*0.86" :ry="d.hh*0.86"
                     fill="none" stroke="white" stroke-width="2.5" class="iso-active"/>
            <ellipse v-else-if="d.u.id === selectedId"
                     :cx="d.sx" :cy="d.syTop" :rx="d.hw*0.86" :ry="d.hh*0.86"
                     fill="none" stroke="rgba(255,255,255,0.8)" stroke-width="1.5" stroke-dasharray="4 3"/>
            <!-- sprite -->
            <image v-if="d.u.imagePath" :href="d.u.imagePath"
                   :x="d.imgX" :y="d.imgY" :width="d.spriteW" :height="d.spriteW"
                   preserveAspectRatio="xMidYMax meet" style="image-rendering:pixelated"/>
            <template v-else-if="facingActive">
              <circle v-if="markerGlyph(markerShapeFor(d.u.type), d.hw*0.18).kind === 'circle'"
                      :cx="d.sx" :cy="d.syTop" :r="markerGlyph(markerShapeFor(d.u.type), d.hw*0.18).r"
                      :fill="d.u.id === activeUnitId ? 'white' : d.u.teamObj.raw"/>
              <template v-else-if="markerGlyph(markerShapeFor(d.u.type), d.hw*0.18).kind === 'ring'">
                <circle :cx="d.sx" :cy="d.syTop" :r="markerGlyph(markerShapeFor(d.u.type), d.hw*0.18).rOuter"
                        fill="none" :stroke="d.u.id === activeUnitId ? 'white' : d.u.teamObj.raw" stroke-width="1.4"/>
                <circle :cx="d.sx" :cy="d.syTop" :r="markerGlyph(markerShapeFor(d.u.type), d.hw*0.18).rInner"
                        :fill="d.u.id === activeUnitId ? 'white' : d.u.teamObj.raw"/>
              </template>
              <polygon v-else :points="isoMarkerPolygon(markerGlyph(markerShapeFor(d.u.type), d.hw*0.18).points, d.sx, d.syTop)"
                       :fill="d.u.id === activeUnitId ? 'white' : d.u.teamObj.raw"/>
            </template>
            <text v-else :x="d.sx" :y="d.syTop" :fill="d.u.teamObj.raw" :font-family="rdr.font"
                  :font-size="d.hw*0.8" font-weight="800" text-anchor="middle" dominant-baseline="central">
              {{ d.u.name[0].toUpperCase() }}
            </text>
            <!-- hp bar (skip full-health tokens to reduce civ clutter) -->
            <template v-if="field.ui?.showHpBars !== false && (!d.token || (d.u.currentHp ?? d.u.hpNow) < d.u.hpMax)">
              <rect :x="d.sx-d.hw*0.7" :y="d.hpY" :width="d.hw*1.4" height="3" :fill="rdr.hpTrack"/>
              <rect :x="d.sx-d.hw*0.7" :y="d.hpY"
                    :width="d.hw*1.4*((d.u.currentHp ?? d.u.hpNow)/d.u.hpMax)" height="3"
                    :fill="hpColor((d.u.currentHp ?? d.u.hpNow)/d.u.hpMax, d.u.teamObj.raw)"/>
            </template>
          </template>
        </g>
      </template>
    </svg>
  </div>
</template>

<style scoped>
@keyframes iso-active-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
.iso-active { animation: iso-active-pulse 1.2s ease-in-out infinite; }
</style>
