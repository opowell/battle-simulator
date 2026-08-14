<script setup>
// A badged token for the HTML board renderer: the presentation for a unit whose
// `badge` count is the whole point of it — a settlement rather than a piece (civ1
// cities are the case this exists for; any game whose toGrid sets `badge` gets it).
//
// It is drawn as a plaque filling its cell, not as a small marker: an owner-coloured
// block, the token's sprite stamped over it, the count centred on top, and the name
// underneath. That is what a settlement looks like on a strategy map — the square IS
// the settlement, and its size is the number you read off it at a glance.
//
// The sprite is used untinted (no team recolouring): the plaque behind it already
// carries the owner colour, and these sprites are line art meant to read as black over
// it. The count reads on top of that art, ringed in the plaque's own colour so the two
// stay apart. Rings/tween/click handling stay with HtmlUnit — this is only the body and
// its label.

defineProps({
  unit: Object,
  size: Number,     // plaque edge in px (the cell, near enough)
  rdr:  Object,
  // Selection state, drawn here in the plaque's own idiom: '' | hover | selected | active
  state: { type: String, default: '' },
});

// Ink for the count: the plaque is a solid block of the owner colour, so pick whichever
// of black/white stays readable on it (sRGB relative luminance, the usual 0.55 cut).
function ink(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '');
  if (!m) return '#000';
  const [r, g, b] = [1, 2, 3].map(i => parseInt(m[i], 16) / 255);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 0.55 ? '#000' : '#fff';
}

// A ring of the plaque's own colour around the digits, so they stay readable where the
// sprite's line art runs behind them without punching a hole in it.
function haloRing(hex, w) {
  return [[w, 0], [-w, 0], [0, w], [0, -w], [w, w], [-w, w], [w, -w], [-w, -w]]
    .map(([dx, dy]) => `${dx}px ${dy}px 0 ${hex}`).join(', ');
}
</script>

<template>
  <div class="bt-plaque" :class="state && 'bt-plaque--' + state"
       :style="{ width: size + 'px', height: size + 'px', background: unit.teamObj.raw }">
    <img v-if="unit.imagePath" class="bt-sprite" :src="unit.imagePath" draggable="false"/>
    <span class="bt-count"
          :style="{ color: ink(unit.teamObj.raw), fontFamily: rdr.font,
                    fontSize: Math.round(size * 0.55) + 'px',
                    textShadow: haloRing(unit.teamObj.raw, Math.max(1, Math.round(size * 0.05))) }">
      {{ unit.badge }}
    </span>
    <!-- Name under the plaque. Absolute, so a long one neither resizes the token nor
         pushes it off the centre of its square — it just overhangs into the squares
         either side, the way a map label does. -->
    <div class="bt-name"
         :style="{ color: unit.teamObj.raw, fontFamily: rdr.font,
                   fontSize: Math.max(8, Math.min(13, Math.round(size * 0.28))) + 'px' }">
      {{ unit.badgeLabel ?? unit.name }}
    </div>
  </div>
</template>

<style scoped>
/* Bevelled block: light on the top/left edges, dark on the bottom/right ones, over a
   hard black outline — the 3D box the era's own map art drew settlements as. */
.bt-plaque {
  position: relative; flex: none; box-sizing: border-box;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid rgba(0,0,0,.85);
  box-shadow: inset 1px 1px 0 rgba(255,255,255,.5), inset -1px -1px 0 rgba(0,0,0,.45),
              1px 1px 0 rgba(0,0,0,.45);
}
/* Selection states, in the plaque's own terms — the outline hugs the block rather than
   ringing it at a distance the way a small marker's does. */
.bt-plaque--hover    { outline: 1.5px solid rgba(255,255,255,.5); outline-offset: 1px; }
.bt-plaque--selected { outline: 1.5px dashed rgba(255,255,255,.8); outline-offset: 1px; }
.bt-plaque--active   { border-color: #fff; outline: 2px solid #fff; outline-offset: 1px;
                       animation: bt-pulse 1.4s ease-in-out infinite; }
@keyframes bt-pulse { 0%,100% { outline-color: rgba(255,255,255,.45); } 50% { outline-color: #fff; } }

/* The sprite is the plaque's texture, not its subject — held back a little so the count
   sitting on top of it stays the thing you read first. */
.bt-sprite { position: absolute; inset: 0; width: 100%; height: 100%; opacity: .62;
             image-rendering: pixelated; pointer-events: none; }
/* The count reads over the sprite rather than through a hole in it (the original art
   works the same way: thin line art, fat digits) — haloRing keeps the two apart. */
.bt-count {
  position: relative; font-weight: 700; line-height: 1; letter-spacing: -0.04em;
  pointer-events: none;
}
.bt-name {
  position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
  margin-top: 2px; font-weight: 700; line-height: 1; white-space: nowrap; pointer-events: none;
  text-shadow: 1px 0 0 #000, -1px 0 0 #000, 0 1px 0 #000, 0 -1px 0 #000, 1px 1px 0 #000, -1px 1px 0 #000;
}
</style>
