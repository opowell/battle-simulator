<script setup>
// One token for the HTML isometric renderer (see HtmlIsoLayer.vue). Mirrors IsoLayer's
// 'token' unit style (civ2): an owner-tinted diamond base with the unit's sprite (or its
// initial) standing on it, plus the selection/active rings and an HP bar.
//
// The host anchors this at the unit's tile centre as a zero-size point (see HtmlIsoLayer's
// .hi-unit), so every piece here positions itself relative to that origin — negative
// offsets are normal and spilling outside the tile diamond is intended.
//
// The diamond base is a real square with a real border, rotated 45° and squashed to the
// tile's 2:1 aspect. Squashing a bordered square keeps the border joined at the corners
// (a clip-path diamond can't have a border at all), which is what the shape needs to read
// as a base ring rather than a blob.

const props = defineProps({
  unit:   Object,
  hw:     Number,     // tile half-width in px (hh = hw/2)
  rdr:    Object,
  spriteSrc: { type: String, default: null },   // resolved unit.imagePath, or null for a letter
  active:   Boolean,
  selected: Boolean,
  showHp:   { type: Boolean, default: true },
});

const hh = () => props.hw * 0.5;
// Side of the pre-transform square whose rotated+squashed diamond is `w` px wide.
const squareSide = w => w / Math.SQRT2;

function hpColor(frac, raw) {
  return frac > 0.5 ? raw : frac > 0.25 ? '#f2b441' : '#ff5f56';
}
const hpFrac = () => (props.unit.currentHp ?? props.unit.hpNow) / props.unit.hpMax;

// Sprite box, and the ring that surrounds the whole token — both keyed off the tile size
// with the same factors IsoLayer uses, so the two renderers agree on scale.
const spriteW = () => props.hw * 1.45;
const spriteTop = () => -spriteW() * 0.62;
</script>

<template>
  <!-- Dead: a faded X on the tile centre -->
  <div v-if="unit.dead" class="hi-unit hi-dead"
       :style="{ width: hw*0.8+'px', height: hw*0.8+'px', color: unit.teamObj.raw, fontSize: hw*0.7+'px' }">✕</div>

  <template v-else>
    <!-- Base diamond -->
    <div class="hi-base"
         :style="{ width: squareSide(hw*1.32)+'px', height: squareSide(hw*1.32)+'px',
                   top: hh()*0.12+'px', borderColor: unit.teamObj.raw }">
      <div class="hi-base-fill" :style="{ background: unit.teamObj.raw }"/>
    </div>

    <!-- Selection / active ring -->
    <div v-if="active || selected" class="hi-ring"
         :class="active ? 'hi-ring--active' : 'hi-ring--selected'"
         :style="{ width: hw*1.72+'px', height: hh()*1.72+'px' }"/>

    <!-- Sprite, else the unit's initial -->
    <img v-if="spriteSrc" class="hi-sprite" draggable="false" :src="spriteSrc"
         :style="{ width: spriteW()+'px', height: spriteW()+'px', left: -spriteW()/2+'px', top: spriteTop()+'px' }"/>
    <span v-else class="hi-letter"
          :style="{ color: unit.teamObj.raw, fontFamily: rdr.font, fontSize: hw*0.8+'px' }">
      {{ unit.name[0].toUpperCase() }}
    </span>

    <!-- HP bar, above the sprite. Full-health tokens are skipped by the host (civ clutter). -->
    <div v-if="showHp" class="hi-hp"
         :style="{ width: hw*1.4+'px', left: -hw*0.7+'px', top: spriteTop()-6+'px', background: rdr.hpTrack }">
      <div class="hi-hp-fill" :style="{ width: 100*hpFrac()+'%', background: hpColor(hpFrac(), unit.teamObj.raw) }"/>
    </div>
  </template>
</template>

<style scoped>
/* Everything hangs off the host's zero-size anchor at the tile centre. */
.hi-unit, .hi-base, .hi-ring, .hi-sprite, .hi-letter, .hi-hp { position: absolute; }

.hi-dead { left: 0; top: 0; transform: translate(-50%, -50%); display: grid; place-items: center; font-weight: 700; opacity: 0.4; }

.hi-base { left: 0; border: 2px solid; transform: translate(-50%, -50%) scaleY(0.5) rotate(45deg); }
.hi-base-fill { position: absolute; inset: 0; opacity: 0.28; }

.hi-ring { left: 0; top: 0; transform: translate(-50%, -50%); border-radius: 50%; }
.hi-ring--active   { border: 2.5px solid #fff; animation: hi-pulse 1.2s ease-in-out infinite; }
.hi-ring--selected { border: 1.5px dashed rgba(255,255,255,0.8); }

/* Fit inside the square box keeping the art's aspect, standing on its bottom edge —
   IsoLayer's preserveAspectRatio="xMidYMax meet". Without this an <img> given a width and
   a height just stretches to both, and the sprite comes out wider than it is. */
.hi-sprite { object-fit: contain; object-position: 50% 100%; image-rendering: pixelated; }
.hi-letter { left: 0; top: 0; transform: translate(-50%, -50%); font-weight: 800; line-height: 1; white-space: nowrap; }

.hi-hp { height: 3px; }
.hi-hp-fill { height: 100%; }

@keyframes hi-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
</style>
