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

function regionToShape(r) {
  if (r.kind === 'circle')
    return { kind: 'circle', cx: props.fit.x(r.cx), cy: props.fit.y(r.cy), r: props.fit.len(r.r) };
  // 'sector' (open cone) or 'polyarc' (exact wall-occluded region) → one SVG path.
  return { kind: 'path', d: VISION.regionPath(r, props.fit) };
}

// Fog always shows the whole player's vision (union of every friendly unit's region) —
// selection never narrows what's punched out of the veil.
const regions = computed(() => {
  const sources = VISION.visionSources(props.units, props.viewerId, null);
  return VISION.visionRegions(props.field, sources).map(regionToShape);
});

// When a unit is selected, its own vision region is additionally traced as a highlighted
// outline on top of the fog/units, so a player can tell what THAT unit specifically sees
// within the broader team vision.
const highlightRegion = computed(() => {
  if (props.selectedId == null) return null;
  const sources = VISION.visionSources(props.units, props.viewerId, props.selectedId);
  if (sources.length !== 1 || sources[0].id !== props.selectedId) return null;
  return regionToShape(VISION.unitVisionRegion(props.field, sources[0]));
});

const board = computed(() => ({
  x: props.fit.x(0), y: props.fit.y(0),
  w: props.fit.len(props.field.world.w), h: props.fit.len(props.field.world.h),
}));
</script>

<template>
  <g class="fog-layer">
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
      <!-- unitVisionRegion's sector/polyarc is occluded by walls but not clipped to the
           board rect itself, so a unit near the edge draws a cone (or its dashed outline
           below) that overshoots the map — clip both to the actual board bounds. -->
      <clipPath id="bfBoardClip" clipPathUnits="userSpaceOnUse">
        <rect :x="board.x" :y="board.y" :width="board.w" :height="board.h"/>
      </clipPath>
    </defs>
    <rect :x="board.x" :y="board.y" :width="board.w" :height="board.h"
          :fill="rdr.fogA" opacity="0.66" mask="url(#bfFogMask)"/>
    <!-- Selected unit's own vision region, traced on top so it reads distinctly from the
         team's shared vision underneath (which already includes it). -->
    <template v-if="highlightRegion">
      <circle v-if="highlightRegion.kind === 'circle'" class="selected-vision"
              :cx="highlightRegion.cx" :cy="highlightRegion.cy" :r="highlightRegion.r"
              clip-path="url(#bfBoardClip)"/>
      <path v-else class="selected-vision" :d="highlightRegion.d" clip-path="url(#bfBoardClip)"/>
    </template>
  </g>
</template>

<style scoped>
.fog-layer { pointer-events: none; }
.selected-vision { fill: none; stroke: rgba(255,255,255,0.85); stroke-width: 1.5; stroke-dasharray: 4 3; }
</style>
