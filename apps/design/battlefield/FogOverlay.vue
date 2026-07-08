<script setup>
// Continuous-map fog layer (see games/coord.js locationType==='continuous', e.g. doom/cs).
// There are no tiles to shade per-square, so fog is one semi-transparent veil drawn on
// TOP of the terrain/shapes/units, with each visible unit's vision region punched out via
// an SVG mask. Overlapping regions union correctly under a mask (white = fog, black =
// seen) — a single even/odd path would XOR overlaps back to solid, hence the mask.
// Rendered inside SchematicLayer's <svg>, so all coordinates are user-space pixels.
// Vision helpers come from the classic global VISION (apps/design/vision.js in index.html).
import { computed } from 'vue';

const props = defineProps({
  field:      Object,
  fit:        Object,
  units:      Array,
  rdr:        Object,
  viewerId:   { type: String, default: null },
  selectedId: { type: String, default: null },
});

// Vision shown: the selected friendly unit's own vision, else the whole player's union.
const regions = computed(() => {
  const sources = VISION.visionSources(props.units, props.viewerId, props.selectedId);
  return VISION.visionRegions(props.field, sources).map(r => {
    const cx = props.fit.x(r.cx), cy = props.fit.y(r.cy), pr = props.fit.len(r.r);
    if (r.kind === 'circle') return { kind: 'circle', cx, cy, r: pr };
    return { kind: 'sector', d: VISION.sectorPath(cx, cy, pr, r.ang, r.fov) };
  });
});

const board = computed(() => ({
  x: props.fit.x(0), y: props.fit.y(0),
  w: props.fit.len(props.field.world.w), h: props.fit.len(props.field.world.h),
}));
</script>

<template>
  <g style="pointer-events:none">
    <defs>
      <mask id="bfFogMask" maskUnits="userSpaceOnUse"
            :x="board.x" :y="board.y" :width="board.w" :height="board.h">
        <!-- White = fogged; black = a unit can see it -->
        <rect :x="board.x" :y="board.y" :width="board.w" :height="board.h" fill="white"/>
        <template v-for="(r, i) in regions" :key="'vr'+i">
          <circle v-if="r.kind === 'circle'" :cx="r.cx" :cy="r.cy" :r="r.r" fill="black"/>
          <path v-else :d="r.d" fill="black"/>
        </template>
      </mask>
    </defs>
    <rect :x="board.x" :y="board.y" :width="board.w" :height="board.h"
          :fill="rdr.fogA" opacity="0.66" mask="url(#bfFogMask)"/>
  </g>
</template>
