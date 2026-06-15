<script setup>
import { computed } from 'vue';

const props = defineProps({
  field:      Object,
  fit:        Object,
  units:      Array,
  selectedId: String,
  fog:        Boolean,
  showRuler:  Boolean,
  rdr:        Object,
});
const emit = defineEmits(['select']);

const tr = computed(() => {
  const mult = props.field.grid === 'square' ? (props.field.world.w <= 10 ? 0.36 : 0.46) : 2.8;
  return Math.max(10, props.fit.len(mult));
});

const boardSquares = computed(() => {
  if (props.field.grid !== 'square' || props.field.world.w > 10) return [];
  const out = [];
  for (let y = 0; y < props.field.world.h; y++)
    for (let x = 0; x < props.field.world.w; x++)
      if ((x + y) % 2 === 1) out.push({ x, y });
  return out;
});

const fogMask = computed(() => {
  const friends = props.units.filter(u => u.friendly && !u.dead);
  if (!friends.length) return 'linear-gradient(black,black)';
  const r = props.fit.len(props.field.world.w * 0.22);
  return friends.map(u =>
    `radial-gradient(circle ${r}px at ${props.fit.x(u.x)}px ${props.fit.y(u.y)}px, transparent 0, transparent 55%, black 100%)`
  ).join(',');
});

function zoneColor(kind) {
  return kind === 'site'      ? '#f2b441'
       : kind === 'resource'  ? '#46d39a'
       : kind === 'objective' ? '#42c6e6'
       : '#8a96a1';
}

function isVisible(u) { return !props.fog || u.visible; }

function hasMoveIntent(u) {
  if (u.dead || !isVisible(u)) return false;
  const dx = props.fit.x(u.next.x) - props.fit.x(u.x);
  const dy = props.fit.y(u.next.y) - props.fit.y(u.y);
  return Math.hypot(dx, dy) >= 3;
}

function moveStyle(u) {
  const x1 = props.fit.x(u.x), y1 = props.fit.y(u.y);
  const dx = props.fit.x(u.next.x) - x1, dy = props.fit.y(u.next.y) - y1;
  const len = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx) * 180 / Math.PI;
  return {
    position: 'absolute',
    left: x1 + 'px',
    top:  (y1 - 1) + 'px',
    width: len + 'px',
    height: '2px',
    background: `repeating-linear-gradient(90deg,${u.teamObj.raw} 0 4px,transparent 4px 8px)`,
    opacity: '0.5',
    transform: `rotate(${ang}deg)`,
    transformOrigin: '0 50%',
    pointerEvents: 'none',
    zIndex: 1,
  };
}

function hpColor(frac, raw) {
  return frac > 0.5 ? raw : frac > 0.25 ? '#f2b441' : '#ff5f56';
}

function unitInitials(u) {
  return u.name.replace(/[^a-zA-Z0-9 ]/g, '').split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || '?';
}

function tokenBorderRadius(u) {
  const i = props.field.teams.findIndex(t => t.id === u.team);
  if (i === 0) return '50%';
  if (i === 1) return Math.max(3, props.rdr.wallRadius + 2) + 'px';
  return '4px';
}
</script>

<template>
  <div class="bf-layer" style="overflow:hidden"
       :style="{background: rdr.asset}"
       @click.self="emit('select', null)">

    <!-- Terrain (texture + base gradient layered) -->
    <div class="bf-layer" style="pointer-events:none"
         :style="{
           background: rdr.terrainTex + ',' + rdr.terrain,
           boxShadow: rdr.terrainInset,
         }"/>

    <!-- Board squares (chess / small square grids) -->
    <div v-for="(sq, i) in boardSquares" :key="'bs'+i"
         style="position:absolute;pointer-events:none"
         :style="{
           left:   fit.x(sq.x) + 'px',
           top:    fit.y(sq.y) + 'px',
           width:  fit.len(1) + 'px',
           height: fit.len(1) + 'px',
           background: 'rgba(0,0,0,0.22)',
         }"/>

    <!-- Zones -->
    <div v-for="(z, i) in field.zones" :key="'z'+i"
         style="position:absolute;pointer-events:none;box-sizing:border-box"
         :style="{
           left:   fit.x(z.x) + 'px',
           top:    fit.y(z.y) + 'px',
           width:  fit.len(z.w) + 'px',
           height: fit.len(z.h) + 'px',
           border: '1.5px dashed ' + zoneColor(z.kind),
           borderRadius: '3px',
           background: zoneColor(z.kind) + '18',
         }">
      <span style="position:absolute;top:3px;left:5px;font-size:9px;letter-spacing:.4px;padding:1px 5px;border-radius:2px"
            :style="{background: rdr.chip, color: zoneColor(z.kind), fontFamily: rdr.font}">
        {{z.label}}
      </span>
    </div>

    <!-- Walls -->
    <div v-for="(w, i) in field.walls" :key="'w'+i"
         style="position:absolute;box-sizing:border-box"
         :style="{
           left:   fit.x(w[0]) + 'px',
           top:    fit.y(w[1]) + 'px',
           width:  fit.len(w[2]) + 'px',
           height: fit.len(w[3]) + 'px',
           background: rdr.wallA,
           borderTop:    '1px solid ' + rdr.wallEdge,
           borderLeft:   '1px solid ' + rdr.wallEdge,
           borderRight:  '1px solid ' + rdr.wallEdge2,
           borderBottom: '1px solid ' + rdr.wallEdge2,
           boxShadow: rdr.wallShadow,
           borderRadius: rdr.wallRadius + 'px',
         }"/>

    <!-- Movement intent dashes -->
    <template v-for="u in units" :key="'mv'+u.id">
      <div v-if="hasMoveIntent(u)" :style="moveStyle(u)"/>
    </template>

    <!-- Unit tokens -->
    <template v-for="u in units" :key="u.id">
      <div v-if="isVisible(u)"
           style="position:absolute;cursor:pointer"
           :style="{
             left:      fit.x(u.x) + 'px',
             top:       fit.y(u.y) + 'px',
             transform: 'translate(-50%,-50%)',
             zIndex:    u.dead ? 1 : 2,
           }"
           @click.stop="emit('select', u.id)">

        <!-- Relative container (sizing context for chips / bars) -->
        <div style="position:relative"
             :style="{width: tr*2+'px', height: tr*2+'px'}">

          <!-- Selection ring -->
          <div v-if="u.id === selectedId"
               style="position:absolute;border-style:dashed;border-width:1.5px;border-radius:50%;pointer-events:none;z-index:3"
               :style="{
                 top:    '-6px', left:   '-6px',
                 right:  '-6px', bottom: '-6px',
                 borderColor: u.teamObj.raw,
               }"/>

          <!-- Token body -->
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center"
               :style="{
                 borderRadius: tokenBorderRadius(u),
                 background:   u.dead ? rdr.deadToken : rdr.token,
                 border:       '2px solid ' + u.teamObj.raw,
                 boxShadow:    '0 0 0 1px ' + rdr.tokenRing + ', 0 4px 8px -2px ' + rdr.tokenShadow,
                 opacity:      u.dead ? 0.45 : 1,
                 overflow:     'hidden',
               }">
            <img v-if="!u.dead && u.imagePath"
                 :src="u.imagePath" :alt="u.name"
                 style="width:90%;height:90%;object-fit:contain;image-rendering:pixelated;pointer-events:none"/>
            <span v-else-if="!u.dead"
                  style="font-size:11px;font-weight:700;line-height:1;user-select:none"
                  :style="{color: u.teamObj.raw, fontFamily: rdr.font}">
              {{unitInitials(u)}}
            </span>
            <svg v-else width="55%" height="55%" viewBox="0 0 10 10" style="opacity:0.65">
              <line x1="1" y1="1" x2="9" y2="9" :stroke="u.teamObj.raw" stroke-width="2"/>
              <line x1="9" y1="1" x2="1" y2="9" :stroke="u.teamObj.raw" stroke-width="2"/>
            </svg>
          </div>

          <!-- Name chip above (hidden for piece-letter units) -->
          <div v-if="!u.dead && u.name.length > 2"
               style="position:absolute;bottom:100%;left:50%;transform:translateX(-50%);margin-bottom:4px;white-space:nowrap;font-size:9px;letter-spacing:.4px;padding:1px 5px;border-radius:2px;pointer-events:none"
               :style="{background: rdr.chip, color: rdr.label, fontFamily: rdr.font}">
            {{u.name}}
          </div>

          <!-- HP bar below (hidden for piece-letter units) -->
          <div v-if="!u.dead && u.name.length > 2"
               style="position:absolute;top:100%;left:0;right:0;margin-top:3px;height:3px;border-radius:2px;overflow:hidden"
               :style="{background: rdr.hpTrack}">
            <div style="height:100%;border-radius:2px;transition:width .3s"
                 :style="{
                   width:      (u.hpNow / u.hpMax * 100) + '%',
                   background: hpColor(u.hpNow / u.hpMax, u.teamObj.raw),
                 }"/>
          </div>
        </div>
      </div>
    </template>

    <!-- Fog of war -->
    <div v-if="fog" class="bf-layer" style="pointer-events:none;z-index:4"
         :style="{
           background:              rdr.fogA,
           WebkitMaskImage:         fogMask,
           maskImage:               fogMask,
           WebkitMaskComposite:     'destination-in',
           maskComposite:           'intersect',
         }"/>

    <!-- Scanlines (military / retro) -->
    <div v-if="rdr.scan" class="bf-layer scanline" style="pointer-events:none;z-index:5"/>
  </div>
</template>
