<script setup>
// One unit token for the HTML board renderer (see HtmlLayer.vue). Rendered as a direct
// child of its board cell and centred in it — units in grid games always sit on a cell
// centre (hop steps are cell indices at +0.5, see App.vue).
//
// No absolute positioning anywhere: the token is a flex column (body, then HP bar), and
// the state rings are `outline`s on the body — an outline is painted outside the border
// box without taking part in layout, so it can spill into neighbouring cells with no
// element of its own. z-index lifts the token above sibling cells' backgrounds so that
// spill isn't painted over.

import { computed } from 'vue';
import HtmlBadgeToken from './HtmlBadgeToken.vue';

const props = defineProps({
  unit:     Object,
  r:        Number,   // token radius in px (half its body box)
  rdr:      Object,
  shape:    { type: String, default: 'square' },  // circle | square | triangle
  showLetter: { type: Boolean, default: true },
  showHp:     { type: Boolean, default: true },
  recolor:    { type: Boolean, default: false },
  active:     Boolean,
  selected:   Boolean,
  hovered:    Boolean,
  blink:      Boolean,
  // Drag-to-move (see HtmlLayer): `grab` offers the affordance, `dim` fades the token
  // in place while its ghost follows the cursor.
  grab:       Boolean,
  dim:        Boolean,
  // History playback slide: a sub-cell {dx, dy} offset in px, or null when the unit
  // is at rest. See HtmlLayer's unitTween — the token stays a child of the cell it
  // is leaving and is translated out of it, since a cell is the only place a unit
  // can live in this renderer's grid.
  tween:      { type: Object, default: null },
});
defineEmits(['click', 'mousedown']);
const teamSpriteHref = window.teamSpriteHref;

// A transform (not margins/insets) so the slide never reflows the cell, and no CSS
// transition — the offset is already recomputed every animation frame by the
// playback clock, and easing it again would just lag the board.
function tweenStyle(t) {
  return t ? { transform: `translate(${t.dx}px, ${t.dy}px)`, willChange: 'transform' } : null;
}

// Games that draw a numbered sprite composite (see e.g. CsMiniGame.js's spriteLayers —
// SchematicLayer's SVG renderer draws that text layer directly) carry the intended glyph
// there; fall back to the unit's own initial for the classic shape+letter marker games.
function unitLabel(unit) {
  const textLayer = unit.spriteLayers?.find(l => l.shape === 'text');
  return textLayer ? textLayer.text : unit.name[0].toUpperCase();
}

function hpColor(frac, raw) {
  return frac > 0.5 ? raw : frac > 0.25 ? '#f2b441' : '#ff5f56';
}

// Which state ring this token wears (active beats selected beats roster-hover). A
// blinking token gets no selected ring — the blink already says "this one is yours to
// move", and SchematicLayer skips it for the same reason. Each body draws the state in
// its own idiom, so the state travels as a name and the class is just this body's.
const ringState = computed(() =>
  props.active ? 'active'
    : (props.selected && !props.blink) ? 'selected'
      : props.hovered ? 'hover' : '');
const ringClass = computed(() => ringState.value ? 'hl-ring-' + ringState.value : '');
</script>

<template>
  <!-- Dead: faded X -->
  <div v-if="unit.dead" class="hl-unit" :style="tweenStyle(tween)" @click="$emit('click', $event)">
    <div class="hl-body hl-dead" :style="{ width: r*2+'px', height: r*2+'px', color: unit.teamObj.raw }">✕</div>
  </div>

  <div v-else class="hl-unit"
       :class="{ 'hl-blink': blink, 'hl-unit--grab': grab, 'hl-unit--dim': dim,
                 'hl-unit--badged': unit.badge != null }"
       :style="tweenStyle(tween)"
       @click="$emit('click', $event)"
       @mousedown="$emit('mousedown', $event)">
    <!-- A badged token is a settlement, not a piece: it draws as a cell-filling plaque
         with its count and name (see HtmlBadgeToken), not as a small marker. -->
    <HtmlBadgeToken v-if="unit.badge != null"
                    :unit="unit" :size="r*2" :rdr="rdr" :state="ringState"/>

    <!-- Body: team sprite, else a shape marker carrying the unit's initial. -->
    <div v-else class="hl-body"
         :class="[
           unit.imagePath ? 'hl-body--sprite' : 'hl-marker hl-marker--' + shape,
           ringClass,
         ]"
         :style="{
           width: r*2+'px', height: r*2+'px',
           ...(unit.imagePath ? {} : {
             background: shape === 'triangle' ? 'transparent' : (active ? unit.teamObj.raw : rdr.unitFill),
             borderColor: active ? 'white' : unit.teamObj.raw,
             color: active ? 'white' : unit.teamObj.raw,
           }),
         }">
      <img v-if="unit.imagePath" class="hl-sprite" draggable="false"
           :src="teamSpriteHref(unit.imagePath, unit.teamObj?.raw, recolor)"/>
      <span v-else-if="showLetter" class="hl-letter"
            :style="{ fontFamily: rdr.font, fontSize: r+'px' }">{{ unitLabel(unit) }}</span>
    </div>

    <!-- HP bar, stacked under the body by the flex column -->
    <div v-if="showHp && unit.badge == null" class="hl-hp" :style="{ width: r*2+'px', background: rdr.hpTrack }">
      <div class="hl-hp-fill"
           :style="{ width: (100*((unit.currentHp ?? unit.hpNow)/unit.hpMax))+'%',
                     background: hpColor((unit.currentHp ?? unit.hpNow)/unit.hpMax, unit.teamObj.raw) }"/>
    </div>
  </div>
</template>

<style scoped>
/* Centred in the parent cell's single grid track (see HtmlLayer's .hl-cell) */
.hl-unit { place-self: center; z-index: 1; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 3px; }
.hl-unit--grab { cursor: grab; }
/* A badged token's name overhangs the squares either side, so it outranks neighbouring
   tokens — a map label reads over the map, not under the next piece along. */
.hl-unit--badged { z-index: 2; }
.hl-unit--dim { opacity: 0.25; }
.hl-body { position: relative; display: flex; align-items: center; justify-content: center; box-sizing: border-box; flex: none; }
.hl-dead { font-weight: 700; opacity: 0.4; }
.hl-sprite { width: 100%; height: 100%; image-rendering: pixelated; pointer-events: none; }
.hl-letter { font-weight: 800; line-height: 1; }

.hl-marker { border: 2px solid currentColor; }
.hl-marker--circle { border-radius: 50%; }
.hl-marker--triangle { border: none; clip-path: polygon(50% 0, 100% 100%, 0 100%); background: currentColor !important; }

/* Rings: outlines follow the body's border-radius, so a circular marker gets a circular
   ring and a square one a square ring — and neither needs an element or a layout slot. */
.hl-ring-active   { outline: 2px solid #fff; outline-offset: 5px; box-shadow: 0 0 0 9px rgba(255,255,255,0.25); animation: hl-pulse 1.4s ease-in-out infinite; }
.hl-ring-selected { outline: 1.5px dashed rgba(255,255,255,0.75); outline-offset: 4px; }
.hl-ring-hover    { outline: 1.5px solid rgba(255,255,255,0.5); outline-offset: 4px; }

.hl-hp { height: 3px; flex: none; }
.hl-hp-fill { height: 100%; }

.hl-blink { animation: hl-blink 1s steps(1) infinite; }
@keyframes hl-blink { 50% { opacity: 0.35; } }
@keyframes hl-pulse { 0%,100% { opacity: 0.6; } 50% { opacity: 1; } }
</style>
