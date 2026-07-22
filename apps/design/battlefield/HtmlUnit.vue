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

defineProps({
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
</script>

<template>
  <!-- Dead: faded X -->
  <div v-if="unit.dead" class="hl-unit" :style="tweenStyle(tween)" @click="$emit('click', $event)">
    <div class="hl-body hl-dead" :style="{ width: r*2+'px', height: r*2+'px', color: unit.teamObj.raw }">✕</div>
  </div>

  <div v-else class="hl-unit"
       :class="{ 'hl-blink': blink, 'hl-unit--grab': grab, 'hl-unit--dim': dim }"
       :style="tweenStyle(tween)"
       @click="$emit('click', $event)"
       @mousedown="$emit('mousedown', $event)">
    <!-- Body: team sprite, else a shape marker carrying the unit's initial. The rings are
         outlines on this box (active wins over selected wins over roster-hover). A badged
         token (civ1 cities — see Civ1Game.js's `badge` field) always gets an owner-colour
         backdrop: its sprite (map/city.png) is a small transparent-background icon that
         otherwise vanishes into the terrain under it. -->
    <div class="hl-body"
         :class="[
           unit.imagePath ? 'hl-body--sprite' : 'hl-marker hl-marker--' + shape,
           active ? 'hl-ring-active' : selected ? 'hl-ring-selected' : hovered ? 'hl-ring-hover' : '',
         ]"
         :style="{
           width: r*2+'px', height: r*2+'px',
           ...(unit.badge != null ? {
             background: unit.teamObj.raw + (active ? '' : 'cc'),
             borderColor: active ? 'white' : unit.teamObj.raw, borderWidth: '1.5px', borderStyle: 'solid', borderRadius: '3px',
           } : unit.imagePath ? {} : {
             background: shape === 'triangle' ? 'transparent' : (active ? unit.teamObj.raw : rdr.unitFill),
             borderColor: active ? 'white' : unit.teamObj.raw,
             color: active ? 'white' : unit.teamObj.raw,
           }),
         }">
      <img v-if="unit.imagePath" class="hl-sprite" draggable="false"
           :src="teamSpriteHref(unit.imagePath, unit.teamObj?.raw, recolor)"/>
      <span v-else-if="showLetter" class="hl-letter"
            :style="{ fontFamily: rdr.font, fontSize: r+'px' }">{{ unitLabel(unit) }}</span>
      <span v-if="unit.badge != null" class="hl-badge"
            :style="{ background: unit.teamObj.raw, fontFamily: rdr.font }">{{ unit.badge }}</span>
    </div>

    <!-- Name label, stacked under the body — cities (badged tokens) only; regular units
         are identified well enough by their sprite + the roster/side panels. -->
    <div v-if="unit.badge != null" class="hl-name" :style="{ color: unit.teamObj.raw, fontFamily: rdr.font }">
      {{unit.name}}
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
.hl-unit--dim { opacity: 0.25; }
.hl-body { position: relative; display: flex; align-items: center; justify-content: center; box-sizing: border-box; flex: none; }
.hl-badge { position: absolute; right: -3px; bottom: -3px; min-width: 13px; height: 13px; padding: 0 2px; border-radius: 7px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; line-height: 1; color: #fff; border: 1px solid rgba(0,0,0,.5); pointer-events: none; }
.hl-name { font-size: 10px; font-weight: 700; line-height: 1; white-space: nowrap; text-shadow: 0 1px 2px rgba(0,0,0,.9), 0 0 4px rgba(0,0,0,.7); }
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
