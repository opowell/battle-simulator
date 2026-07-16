<script setup>
import { computed } from 'vue';
// Opt-in HTML/CSS renderer for square tile grids (field.ui.htmlRenderer). A lighter
// alternative to SchematicLayer's SVG for the common square-grid case: tiles, terrain
// images, unit tokens, selection/active rings, legal- and last-move highlights, grid
// lines, boundary, walls, zones and HP bars. It deliberately does NOT cover hexes,
// non-grid shapes, fog masks, aiming overlays, drag-to-move ghosts, coast sprites or
// sprite-layer units — games needing those keep using the SVG SchematicLayer (see
// Battlefield.vue's renderer routing). Globals (window.*) come from apps/design/data.js
// and teamSprite.js, loaded as classic <script>s in index.html; vue3-sfc-loader can't
// parse an ESM import of a plain .js.

const props = defineProps({
  field:        Object,
  fit:          Object,
  units:        Array,
  selectedId:   String,
  hoveredId:    { type: String, default: null },
  activeUnitId: { type: String, default: null },
  fog:          Boolean,
  showRuler:    Boolean,
  rdr:          Object,
  legalSquares:    { type: Array, default: () => [] },
  lastMoveSquares: { type: Array, default: () => [] },
  dragToMove:      { type: Boolean, default: false },
  revealAll:       { type: Boolean, default: false },
  viewerTeam:      { type: String, default: null },
  selectedEmptySquare: { type: Object, default: null },
  selectedShape:   { type: Object, default: null },
  aiming:          { type: Object, default: null },
});
const emit = defineEmits(['select', 'sq-click', 'set-marker']);
const imgSrc = window.api.imgSrc;
const teamSpriteHref = window.teamSpriteHref;

const highlightUnitId = computed(() => props.activeUnitId);

// When ui.highlightSelectedSquare is set, tint the selected unit's cell instead of
// drawing a dashed ring on the token itself (mirrors SchematicLayer).
const selectedSquare = computed(() => {
  if (!props.field.ui?.highlightSelectedSquare || !props.selectedId) return null;
  const u = props.units.find(u => u.id === props.selectedId);
  return u ? { x: Math.floor(u.x), y: Math.floor(u.y) } : null;
});

// ── geometry helpers (see makeFitter: fit.x/y map world→screen px, fit.len scales) ──
const W = computed(() => props.field.world.w);
const H = computed(() => props.field.world.h);

// One CSS rect covering [x,y,w,h] world units. A hair of overlap on tiles is added by
// callers where seams would otherwise show.
function box(x, y, w, h, extra = 0) {
  return {
    position: 'absolute',
    left:   props.fit.x(x) + 'px',
    top:    props.fit.y(y) + 'px',
    width:  (props.fit.len(w) + extra) + 'px',
    height: (props.fit.len(h) + extra) + 'px',
  };
}

// Alternating dark squares on small boards (checkerboard look), matching SchematicLayer.
const boardSquares = computed(() => {
  if (props.field.grid !== 'square' || W.value > 10) return [];
  const out = [];
  for (let y = 0; y < H.value; y++)
    for (let x = 0; x < W.value; x++)
      if ((x + y) % 2 === 1) out.push({ x, y });
  return out;
});

function unitR(u) {
  const mult = props.field.grid === 'square' ? (W.value <= 10 ? 0.36 : 0.42) : 2.4;
  const boosted = u?.imagePath ? mult * 1.25 : mult;
  return Math.max(5, props.fit.len(boosted));
}

function tileColor(tile) { return tile.color; }
function tileBgImage(tile)      { return tile.bgImage ? imgSrc(tile.bgImage) : null; }
function tileOverlayImage(tile) { return tile.overlayImage ? imgSrc(tile.overlayImage) : null; }

function unitShape(u) {
  const shapes = props.field.ui?.unitShapes;
  if (shapes?.[u.type]) return shapes[u.type];
  return props.field.locationType === 'continuous' ? 'circle' : 'square';
}

const gridLines = computed(() => {
  if (props.field.ui?.hideGridLines) return { xs: [], ys: [] };
  const xs = [], ys = [];
  for (let x = 0; x <= W.value; x++) xs.push(x);
  for (let y = 0; y <= H.value; y++) ys.push(y);
  return { xs, ys };
});

function zoneColor(kind) {
  if (kind === 'site')      return '#f2b441';
  if (kind === 'resource')  return '#46d39a';
  if (kind === 'objective') return '#42c6e6';
  return '#8a96a1';
}

function hpColor(frac, raw) {
  return frac > 0.5 ? raw : frac > 0.25 ? '#f2b441' : '#ff5f56';
}

const rulerX = computed(() =>
  props.showRuler
    ? Array.from({ length: W.value }, (_, x) => ({ label: props.field.xLabels?.[x] ?? x, pos: x + 0.5 }))
    : []);
const rulerY = computed(() =>
  props.showRuler
    ? Array.from({ length: H.value }, (_, y) => ({ label: props.field.yLabels?.[y] ?? y, pos: y + 0.5 }))
    : []);
const xRulerTop = computed(() => props.field.ui?.gridLabelsBottom
  ? props.fit.y(H.value) + 2
  : props.fit.y(0) - 12);

// ── visibility / motion (fog is out of scope; reveal-all still fades unseen enemies) ──
function isVisible(u) {
  if (!props.fog) return true;
  if (u.friendly) return true;
  return u.visible;
}

function hasMoveIntent(u) {
  if (u.dead || !isVisible(u)) return false;
  const dx = props.fit.x(u.next.x) - props.fit.x(u.x);
  const dy = props.fit.y(u.next.y) - props.fit.y(u.y);
  return Math.hypot(dx, dy) >= 3;
}

// ── styles for a unit token wrapper (centered on its world position) ──
function unitStyle(u) {
  return {
    position: 'absolute',
    left: props.fit.x(u.x) + 'px',
    top:  props.fit.y(u.y) + 'px',
    transform: 'translate(-50%, -50%)',
    transition: hasMoveIntent(u) ? 'left 0.15s ease, top 0.15s ease' : 'none',
    cursor: 'pointer',
  };
}

// ── clicks (same emit contract as SchematicLayer: select / sq-click / set-marker) ──
function boardPoint(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  const x = (e.clientX - rect.left - props.fit.x(0)) / props.fit.s;
  const y = (e.clientY - rect.top  - props.fit.y(0)) / props.fit.s;
  return { x, y };
}

function handleBoardClick(e) {
  if (props.field.grid !== 'square') { emit('select', null); return; }
  const { x, y } = boardPoint(e);
  const col = Math.floor(x), row = Math.floor(y);
  if (col >= 0 && col < W.value && row >= 0 && row < H.value) {
    emit('sq-click', col, row, x, y);
  } else {
    emit('select', null);
  }
}

function handleUnitClick(e, u) {
  if (props.aiming) return; // aiming: let the click bubble to the board like bare ground
  const col = Math.floor(u.x), row = Math.floor(u.y);
  const isLegalTarget = props.legalSquares.some(([lc, lr]) => lc === col && lr === row);
  if (isLegalTarget) return; // legal target: bubble to sq-click
  e.stopPropagation();
  emit('select', u.id);
}
</script>

<template>
  <div class="bf-layer hl-root" :style="{ background: rdr.stage }"
       @click="handleBoardClick">

    <!-- Terrain tiles (color + optional terrain/overlay images). +0.75px overlap on
         the right/bottom edges kills the anti-alias seam between adjacent cells. -->
    <div v-for="(tile, i) in (field.tiles ?? [])" :key="'t'+i"
         class="hl-noevents"
         :style="{ ...box(tile.x, tile.y, 1, 1, 0.75), background: tileColor(tile) }"/>
    <template v-for="(tile, i) in (field.tiles ?? [])" :key="'ti'+i">
      <img v-if="tileBgImage(tile)" class="hl-noevents hl-pixel hl-cover"
           :src="tileBgImage(tile)"
           :style="box(tile.x, tile.y, 1, 1, 0.75)"/>
    </template>
    <template v-for="(tile, i) in (field.tiles ?? [])" :key="'to'+i">
      <img v-if="tileOverlayImage(tile)" class="hl-noevents hl-pixel hl-cover"
           :src="tileOverlayImage(tile)"
           :style="box(tile.x, tile.y, 1, 1)"/>
    </template>

    <!-- Checkerboard shading for small boards -->
    <div v-for="(sq, i) in boardSquares" :key="'bs'+i"
         class="hl-noevents"
         :style="{ ...box(sq.x, sq.y, 1, 1), background: 'rgba(0,0,0,0.22)' }"/>

    <!-- Selected-square tint (ui.highlightSelectedSquare) -->
    <div v-if="selectedSquare" class="hl-noevents"
         :style="{ ...box(selectedSquare.x, selectedSquare.y, 1, 1), background: 'rgba(255,255,255,0.35)' }"/>

    <!-- Selected empty square (terrain info) -->
    <div v-if="selectedEmptySquare" class="hl-noevents hl-dashed"
         :style="box(selectedEmptySquare.x, selectedEmptySquare.y, 1, 1)"/>

    <!-- Last-move highlights -->
    <div v-for="([lc, lr], i) in lastMoveSquares" :key="'lmv'+i"
         class="hl-noevents"
         :style="{ ...box(lc, lr, 1, 1), background: 'rgba(242,180,65,0.35)' }"/>

    <!-- Legal-move highlights (per cell) -->
    <template v-if="!aiming && !field.ui?.aimedActionTypes?.includes('move')">
      <div v-for="([lc, lr], i) in legalSquares" :key="'lm'+i"
           class="hl-clickable hl-legal"
           :style="box(lc, lr, 1, 1)"
           @click.stop="emit('sq-click', lc, lr, lc + 0.5, lr + 0.5)"/>
    </template>

    <!-- Grid lines -->
    <template v-if="!field.ui?.hideGridLines">
      <div v-for="gx in gridLines.xs" :key="'gx'+gx" class="hl-noevents"
           :style="{ position:'absolute', left: fit.x(gx)+'px', top: fit.y(0)+'px',
                     width:'1px', height: fit.len(H)+'px', background: rdr.grid }"/>
      <div v-for="gy in gridLines.ys" :key="'gy'+gy" class="hl-noevents"
           :style="{ position:'absolute', left: fit.x(0)+'px', top: fit.y(gy)+'px',
                     width: fit.len(W)+'px', height:'1px', background: rdr.grid }"/>
    </template>

    <!-- Boundary -->
    <div class="hl-noevents"
         :style="{ ...box(0, 0, W, H), border: '1.5px solid ' + rdr.bound }"/>

    <!-- Zones -->
    <div v-for="(z, i) in field.zones" :key="'z'+i" class="hl-noevents hl-zone"
         :style="{ ...box(z.x, z.y, z.w, z.h),
                   border: '1.2px dashed ' + zoneColor(z.kind),
                   background: zoneColor(z.kind) + '10' }">
      <span class="hl-zone-label" :style="{ color: zoneColor(z.kind), fontFamily: rdr.font }">{{ z.label }}</span>
    </div>

    <!-- Walls -->
    <div v-for="(w, i) in field.walls" :key="'w'+i" class="hl-noevents"
         :style="{ ...box(w[0], w[1], w[2], w[3]), background: rdr.wallS, border: '1px solid ' + rdr.wallS2 }"/>

    <!-- Move-intent arrows (simple line via rotated bar) -->
    <template v-for="u in units" :key="'mv'+u.id">
      <div v-if="hasMoveIntent(u)" class="hl-noevents hl-intent"
           :style="{
             position:'absolute',
             left: fit.x(u.x)+'px', top: fit.y(u.y)+'px',
             width: Math.hypot(fit.x(u.next.x)-fit.x(u.x), fit.y(u.next.y)-fit.y(u.y))+'px',
             transform: `rotate(${Math.atan2(fit.y(u.next.y)-fit.y(u.y), fit.x(u.next.x)-fit.x(u.x))}rad)`,
             transformOrigin: '0 50%',
             borderTop: '1.4px dashed ' + u.teamObj.raw,
             opacity: 0.5,
           }"/>
    </template>

    <!-- Units -->
    <template v-for="u in units" :key="u.id">
      <div v-if="isVisible(u)" :style="unitStyle(u)"
           @click="handleUnitClick($event, u)">

        <!-- Dead: faded X -->
        <div v-if="u.dead" class="hl-token hl-dead"
             :style="{ width: unitR(u)*2+'px', height: unitR(u)*2+'px', color: u.teamObj.raw }">✕</div>

        <template v-else>
          <div class="hl-token"
               :class="{ 'hl-blink': u.id === (field.ui?.freeSelection ? selectedId : activeUnitId) && field.ui?.blinkActiveUnit }"
               :style="{ width: unitR(u)*2+'px', height: unitR(u)*2+'px' }">

            <!-- Active-unit ring -->
            <div v-if="u.id === highlightUnitId && !field.ui?.blinkActiveUnit"
                 class="hl-ring hl-ring-active"/>
            <!-- Selected-unit ring (dashed), unless active/blinked/square-highlighted -->
            <div v-else-if="u.id === selectedId && !field.ui?.highlightSelectedSquare"
                 class="hl-ring hl-ring-selected"/>
            <!-- Roster-hover ring -->
            <div v-else-if="u.id === hoveredId" class="hl-ring hl-ring-hover"/>

            <!-- Sprite image -->
            <img v-if="u.imagePath" class="hl-noevents hl-pixel hl-body"
                 :src="teamSpriteHref(u.imagePath, u.teamObj?.raw, field.ui?.recolorTeamSprites)"/>
            <!-- Shape marker -->
            <div v-else class="hl-noevents hl-body hl-marker"
                 :class="'hl-marker--' + unitShape(u)"
                 :style="{
                   background: unitShape(u) === 'triangle' ? 'transparent' : (u.id === highlightUnitId ? u.teamObj.raw : rdr.unitFill),
                   borderColor: u.id === highlightUnitId ? 'white' : u.teamObj.raw,
                   color: u.id === highlightUnitId ? 'white' : u.teamObj.raw,
                 }">
              <span v-if="!field.ui?.showFacing" class="hl-letter"
                    :style="{ fontFamily: rdr.font, fontSize: unitR(u)+'px' }">{{ u.name[0].toUpperCase() }}</span>
            </div>

            <!-- HP bar -->
            <div v-if="field.ui?.showHpBars !== false" class="hl-hp"
                 :style="{ width: unitR(u)*2+'px', top: unitR(u)+3+'px', background: rdr.hpTrack }">
              <div class="hl-hp-fill"
                   :style="{ width: (100*((u.currentHp ?? u.hpNow)/u.hpMax))+'%',
                             background: hpColor((u.currentHp ?? u.hpNow)/u.hpMax, u.teamObj.raw) }"/>
            </div>
          </div>
        </template>
      </div>
    </template>

    <!-- Ruler labels -->
    <template v-if="showRuler">
      <span v-for="r in rulerX" :key="'rx'+r.label" class="hl-noevents hl-ruler"
            :style="{ left: fit.x(r.pos)+'px', top: xRulerTop+'px', color: rdr.ruler, fontFamily: rdr.font, transform:'translateX(-50%)' }">{{ r.label }}</span>
      <span v-for="r in rulerY" :key="'ry'+r.label" class="hl-noevents hl-ruler hl-ruler-y"
            :style="{ left: (fit.x(0)-6)+'px', top: fit.y(r.pos)+'px', color: rdr.ruler, fontFamily: rdr.font, transform:'translate(-100%,-50%)' }">{{ r.label }}</span>
    </template>
  </div>
</template>

<style scoped>
.hl-root { position: absolute; inset: 0; overflow: hidden; }
.hl-noevents { pointer-events: none; }
.hl-pixel { image-rendering: pixelated; }
.hl-cover { object-fit: cover; }
.hl-dashed { border: 2px dashed rgba(255,255,255,0.85); }
.hl-legal { background: rgba(66,198,230,0.28); border: 1.5px solid rgba(66,198,230,0.7); cursor: pointer; }
.hl-clickable { pointer-events: auto; }

.hl-zone { border-radius: 2px; }
.hl-zone-label { position: absolute; left: 4px; top: 1px; font-size: 10px; letter-spacing: 0.5px; }

.hl-intent { height: 0; }

/* Unit token: a centered square box; body + rings + hp bar all center on it */
.hl-token { position: relative; display: flex; align-items: center; justify-content: center; }
.hl-dead { font-weight: 700; opacity: 0.4; display: flex; align-items: center; justify-content: center; }
.hl-body { position: absolute; inset: 0; width: 100%; height: 100%; }

.hl-marker { display: flex; align-items: center; justify-content: center; border: 2px solid currentColor; box-sizing: border-box; }
.hl-marker--square {}
.hl-marker--circle { border-radius: 50%; }
.hl-marker--triangle {
  border: none;
  clip-path: polygon(50% 0, 100% 100%, 0 100%);
  background: currentColor !important;
}
.hl-letter { font-weight: 800; line-height: 1; user-select: none; }

.hl-ring { position: absolute; border-radius: 50%; pointer-events: none; }
.hl-ring-active   { inset: -7px; border: 2px solid #fff; box-shadow: 0 0 0 4px rgba(255,255,255,0.25); animation: hl-pulse 1.4s ease-in-out infinite; }
.hl-ring-selected { inset: -6px; border: 1.5px dashed rgba(255,255,255,0.75); }
.hl-ring-hover    { inset: -6px; border: 1.5px solid rgba(255,255,255,0.5); }

.hl-hp { position: absolute; left: 0; height: 3px; }
.hl-hp-fill { height: 100%; }

.hl-ruler { position: absolute; font-size: 8px; white-space: nowrap; }
.hl-ruler-y { }

.hl-blink { animation: hl-blink 1s steps(1) infinite; }
@keyframes hl-blink { 50% { opacity: 0.35; } }
@keyframes hl-pulse { 0%,100% { opacity: 0.6; } 50% { opacity: 1; } }
</style>
