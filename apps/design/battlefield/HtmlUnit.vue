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

// What a token says: the game's own label if it gave one (a quantity, like Risk's army
// count — a token reading "10" must not come out as "1"), else the glyph from a numbered
// sprite composite (see e.g. CsMiniGame.js's spriteLayers — SchematicLayer's SVG renderer
// draws that text layer directly), else the initial of the unit's name, so a piece reads
// as "K" and not "King". Same order as SchematicLayer's tokenText.
function unitLabel(unit) {
  if (unit.label != null) return unit.label;
  const textLayer = unit.spriteLayers?.find(l => l.shape === 'text');
  return textLayer ? textLayer.text : unit.name[0].toUpperCase();
}

// A multi-character label shrinks so it stays inside the token (same rule as
// SchematicLayer's tokenFontSize).
function labelFontSize(unit) {
  const len = String(unitLabel(unit)).length;
  return props.r * (len > 1 ? 1.6 / (len + 0.6) : 1);
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
           unit.imagePath && unit.origin ? 'hl-body--plate' : '',
           ringClass,
         ]"
         :style="{
           width: r*2+'px', height: r*2+'px',
           // A unit from another game stands on a plate of its team's colour: its
           // picture is its own game's, drawn with no idea which side it is on here.
           ...(unit.imagePath && unit.origin ? { '--plate': unit.teamObj?.raw ?? '#888' } : {}),
           ...(unit.imagePath ? {} : {
             background: shape === 'triangle' ? 'transparent' : (active ? unit.teamObj.raw : rdr.unitFill),
             borderColor: active ? 'white' : unit.teamObj.raw,
             color: active ? 'white' : unit.teamObj.raw,
           }),
         }">
      <img v-if="unit.imagePath" class="hl-sprite" draggable="false"
           :src="teamSpriteHref(unit.imagePath, unit.teamObj?.raw, recolor)"/>
      <span v-else-if="showLetter" class="hl-letter"
            :style="{ fontFamily: rdr.font, fontSize: labelFontSize(unit)+'px' }">{{ unitLabel(unit) }}</span>

      <!-- Standing order (civ1's fortifying/sentry/fortified — see App.vue's statusMark):
           a frame drawn round the body, a letter in its corner, or both. Both sit on top
           of the body without a layout slot of their own, so the sprite under them is
           never nudged and the mark reads the same whatever that token is. -->
      <div v-if="unit.statusMark?.frame" class="hl-statusframe" :title="unit.statusMark.title"/>
      <span v-if="unit.statusMark?.glyph" class="hl-statusglyph"
            :title="unit.statusMark.title"
            :style="{ fontFamily: rdr.font, fontSize: (r * 0.8)+'px' }">{{ unit.statusMark.glyph }}</span>
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
.hl-body--plate {
  border: 2px solid var(--plate); border-radius: 22%;
  background: color-mix(in srgb, var(--plate) 28%, transparent);
}
.hl-body--plate .hl-sprite { width: 86%; height: 86%; object-fit: contain; }
.hl-letter { font-weight: 800; line-height: 1; }

.hl-marker { border: 2px solid currentColor; }
.hl-marker--circle { border-radius: 50%; }
.hl-marker--triangle { border: none; clip-path: polygon(50% 0, 100% 100%, 0 100%); background: currentColor !important; }

/* Rings: outlines follow the body's border-radius, so a circular marker gets a circular
   ring and a square one a square ring — and neither needs an element or a layout slot. */
.hl-ring-active   { outline: 2px solid #fff; outline-offset: 5px; box-shadow: 0 0 0 9px rgba(255,255,255,0.25); animation: hl-pulse 1.4s ease-in-out infinite; }
.hl-ring-selected { outline: 1.5px dashed rgba(255,255,255,0.75); outline-offset: 4px; }
.hl-ring-hover    { outline: 1.5px solid rgba(255,255,255,0.5); outline-offset: 4px; }

/* Status marks. The frame sits just OUTSIDE the body (and inherits its border-radius, so
   a circular marker gets a circular frame): unit sprites tend to carry a pale edge of
   their own, and a frame drawn on that edge is read as part of the art rather than as a
   state. The dark line either side of the white one keeps it legible over both pale
   terrain and a pale sprite. Neither mark is hit-testable — the token under it stays
   clickable, including the part the glyph covers. */
.hl-statusframe {
  position: absolute; inset: -3px; box-sizing: border-box; pointer-events: none;
  border: 2px solid rgba(255,255,255,0.95); border-radius: inherit;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,0,0,0.6);
}
.hl-statusglyph {
  position: absolute; top: -2px; right: -1px; pointer-events: none;
  font-weight: 800; line-height: 1; color: #fff;
  text-shadow: 0 1px 0 #000, 0 -1px 0 #000, 1px 0 0 #000, -1px 0 0 #000;
}

.hl-hp { height: 3px; flex: none; }
.hl-hp-fill { height: 100%; }

/* The blink is a hard on/off cut: steps(1), and the off frame is fully transparent
   rather than dimmed, so the token disappears outright instead of ghosting. It stays
   hit-testable while invisible, so a click still lands on the unit. */
.hl-blink { animation: hl-blink 0.7s steps(1) infinite; }
@keyframes hl-blink { 50% { opacity: 0; } }
@keyframes hl-pulse { 0%,100% { opacity: 0.6; } 50% { opacity: 1; } }
</style>
