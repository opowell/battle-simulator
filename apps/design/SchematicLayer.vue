<script setup>
import { computed } from 'vue';

const props = defineProps({
  field:        Object,
  fit:          Object,
  units:        Array,
  selectedId:   String,
  activeUnitId: { type: String, default: null },
  fog:          Boolean,
  showRuler:    Boolean,
  rdr:          Object,
  legalSquares: { type: Array, default: () => [] },
});
const emit = defineEmits(['select', 'sq-click']);

const gridX = computed(() => {
  const step = props.field.grid === 'square' ? 1 : Math.max(1, Math.round(props.field.world.w / 20));
  const out = [];
  for (let x = 0; x <= props.field.world.w; x += step) out.push(x);
  return out;
});

const gridY = computed(() => {
  const step = props.field.grid === 'square' ? 1 : Math.max(1, Math.round(props.field.world.h / 13));
  const out = [];
  for (let y = 0; y <= props.field.world.h; y += step) out.push(y);
  return out;
});

const rulerX = computed(() => {
  if (props.field.grid === 'square') {
    return Array.from({ length: props.field.world.w }, (_, x) => ({ label: props.field.xLabels?.[x] ?? x, pos: x + 0.5 }));
  }
  const step = Math.max(1, Math.round(props.field.world.w / 8));
  const out = [];
  for (let x = 0; x <= props.field.world.w; x += step) out.push({ label: x, pos: x });
  return out;
});

const rulerY = computed(() => {
  if (props.field.grid === 'square') {
    return Array.from({ length: props.field.world.h }, (_, y) => ({ label: props.field.yLabels?.[y] ?? y, pos: y + 0.5 }));
  }
  const step = Math.max(1, Math.round(props.field.world.h / 6));
  const out = [];
  for (let y = 0; y <= props.field.world.h; y += step) out.push({ label: y, pos: y });
  return out;
});

// X-axis ruler reads below the board for games like Chess (algebraic file letters);
// everything else keeps the original top placement.
const xRulerY = computed(() => props.field.ui?.gridLabelsBottom
  ? props.fit.y(props.field.world.h) + 11
  : props.fit.y(0) - 4);

const fogMask = computed(() => {
  const friends = props.units.filter(u => u.friendly && !u.dead);
  if (!friends.length) return 'linear-gradient(black,black)';
  const r = props.fit.len(props.field.world.w * 0.2);
  return friends.map(u =>
    `radial-gradient(circle ${r}px at ${props.fit.x(u.x)}px ${props.fit.y(u.y)}px, transparent 0, transparent 60%, black 100%)`
  ).join(',');
});

function zoneColor(kind) {
  if (kind === 'site')      return '#f2b441';
  if (kind === 'resource')  return '#46d39a';
  if (kind === 'objective') return '#42c6e6';
  return '#8a96a1';
}

function teamIdx(id) { return props.field.teams.findIndex(t => t.id === id); }

const boardSquares = computed(() => {
  if (props.field.grid !== 'square' || props.field.world.w > 10) return [];
  const out = [];
  for (let y = 0; y < props.field.world.h; y++)
    for (let x = 0; x < props.field.world.w; x++)
      if ((x + y) % 2 === 1) out.push({ x, y });
  return out;
});

function unitR(u) {
  const mult = props.field.grid === 'square' ? (props.field.world.w <= 10 ? 0.36 : 0.42) : 2.4;
  // Bare sprite images have no stroke/padding eating into them, so let them fill more of the cell.
  const boosted = u?.imagePath ? mult * 1.25 : mult;
  return Math.max(5, props.fit.len(boosted));
}

// Grid-based fog of war: compute per-square visibility from friendly pieces.
// Used when field.ui.gridFog is true. Piece types are lowercase glyph letters: k/q/r/b/n/p.
// Friendly pieces move up the board — decreasing y (y = 8 - rank).
const gridFogVisibleSet = computed(() => {
  if (!props.fog || !props.field.ui?.gridFog) return null;
  const W = props.field.world.w, H = props.field.world.h;
  const visible = new Set();
  const occ = new Set();
  for (const u of props.units)
    if (!u.dead) occ.add(`${Math.floor(u.x)},${Math.floor(u.y)}`);
  const inB = (x, y) => x >= 0 && x < W && y >= 0 && y < H;
  const add  = (x, y) => { if (inB(x, y)) visible.add(`${x},${y}`); };
  for (const u of props.units) {
    if (!u.friendly || u.dead) continue;
    const gx = Math.floor(u.x), gy = Math.floor(u.y);
    const t = u.type; // 'k','q','r','b','n','p'
    add(gx, gy);
    if (t === 'p') {
      add(gx, gy - 1);          // push forward (white moves up = y--)
      if (gy === 6) add(gx, gy - 2); // double push from starting rank
      add(gx - 1, gy - 1); add(gx + 1, gy - 1); // diagonal attacks
    } else if (t === 'n') {
      for (const [dx, dy] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]])
        add(gx + dx, gy + dy);
    } else if (t === 'k') {
      for (const [dx, dy] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]])
        add(gx + dx, gy + dy);
    } else {
      const rDirs = [[0,1],[0,-1],[1,0],[-1,0]];
      const bDirs = [[1,1],[1,-1],[-1,1],[-1,-1]];
      const dirs = t === 'r' ? rDirs : t === 'b' ? bDirs : [...rDirs, ...bDirs];
      for (const [dx, dy] of dirs) {
        let cx = gx + dx, cy = gy + dy;
        while (inB(cx, cy)) {
          add(cx, cy);
          if (occ.has(`${cx},${cy}`)) break; // see blocker but not beyond
          cx += dx; cy += dy;
        }
      }
    }
  }
  return visible;
});

const fogSquares = computed(() => {
  if (!gridFogVisibleSet.value) return [];
  const W = props.field.world.w, H = props.field.world.h;
  const out = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (!gridFogVisibleSet.value.has(`${x},${y}`)) out.push({ x, y });
  return out;
});

function unitShape(u) {
  const shapes = props.field.ui?.unitShapes;
  if (shapes) return shapes[u.type] || 'circle';
  return 'circle';
}

function handleBoardClick(e) {
  if (props.field.grid !== 'square') { emit('select', null); return; }
  const rect = e.currentTarget.getBoundingClientRect();
  const col = Math.floor((e.clientX - rect.left - props.fit.x(0)) / props.fit.s);
  const row = Math.floor((e.clientY - rect.top  - props.fit.y(0)) / props.fit.s);
  if (col >= 0 && col < props.field.world.w && row >= 0 && row < props.field.world.h) {
    emit('sq-click', col, row);
  } else {
    emit('select', null);
  }
}

function handleUnitClick(e, u) {
  const col = Math.floor(u.x), row = Math.floor(u.y);
  if (props.legalSquares.some(([lc, lr]) => lc === col && lr === row)) return; // legal target: bubble to sq-click
  e.stopPropagation();
  emit('select', u.id);
}

function hpColor(frac, raw) {
  return frac > 0.5 ? raw : frac > 0.25 ? '#f2b441' : '#ff5f56';
}

function isVisible(u) {
  if (!props.fog) return true;
  if (u.friendly) return true;
  if (gridFogVisibleSet.value) return gridFogVisibleSet.value.has(`${Math.floor(u.x)},${Math.floor(u.y)}`);
  return u.visible;
}

function hasMoveIntent(u) {
  if (u.dead || !isVisible(u)) return false;
  const dx = props.fit.x(u.next.x) - props.fit.x(u.x);
  const dy = props.fit.y(u.next.y) - props.fit.y(u.y);
  return Math.hypot(dx, dy) >= 3;
}

function facingArrow(u) {
  const r = unitR(u);
  const ang = u.ang;
  const len  = Math.max(6, r * 0.55);
  const half = Math.max(4, r * 0.32);
  const tx = Math.cos(ang) * (r + len);
  const ty = Math.sin(ang) * (r + len);
  const bx = Math.cos(ang) * r;
  const by = Math.sin(ang) * r;
  const lx = bx + Math.cos(ang + Math.PI / 2) * half;
  const ly = by + Math.sin(ang + Math.PI / 2) * half;
  const rx2 = bx - Math.cos(ang + Math.PI / 2) * half;
  const ry2 = by - Math.sin(ang + Math.PI / 2) * half;
  return `${tx},${ty} ${lx},${ly} ${rx2},${ry2}`;
}
</script>

<template>
  <div class="bf-layer" :style="{background: rdr.stage}">
    <svg width="100%" height="100%" style="display:block;position:absolute;inset:0"
         @click="handleBoardClick">

      <!-- Terrain tiles (per-cell color from game toGrid) -->
      <rect v-for="(tile, i) in (field.tiles ?? [])" :key="'t'+i"
            :x="fit.x(tile.x)" :y="fit.y(tile.y)"
            :width="fit.len(1)" :height="fit.len(1)"
            :fill="tile.color"/>

      <!-- Board squares (alternating pattern for small square grids) -->
      <rect v-for="(sq, i) in boardSquares" :key="'bs'+i"
            :x="fit.x(sq.x)" :y="fit.y(sq.y)"
            :width="fit.len(1)" :height="fit.len(1)"
            fill="rgba(0,0,0,0.22)"/>

      <!-- Fog of war squares (grid-aligned, from field.ui.gridFog) -->
      <rect v-for="(fs, i) in fogSquares" :key="'fs'+i"
            :x="fit.x(fs.x)" :y="fit.y(fs.y)"
            :width="fit.len(1)" :height="fit.len(1)"
            :fill="rdr.fogA"
            style="pointer-events:none"/>

      <!-- Legal move highlights -->
      <rect v-for="([lc, lr], i) in legalSquares" :key="'lm'+i"
            :x="fit.x(lc)" :y="fit.y(lr)"
            :width="fit.len(1)" :height="fit.len(1)"
            fill="rgba(66,198,230,0.28)" stroke="rgba(66,198,230,0.7)" stroke-width="1.5"
            style="cursor:pointer"/>

      <!-- Grid -->
      <line v-for="gx in gridX" :key="'gx'+gx"
            :x1="fit.x(gx)" :y1="fit.y(0)" :x2="fit.x(gx)" :y2="fit.y(field.world.h)"
            :stroke="rdr.grid" stroke-width="1"/>
      <line v-for="gy in gridY" :key="'gy'+gy"
            :x1="fit.x(0)" :y1="fit.y(gy)" :x2="fit.x(field.world.w)" :y2="fit.y(gy)"
            :stroke="rdr.grid" stroke-width="1"/>

      <!-- Boundary -->
      <rect :x="fit.x(0)" :y="fit.y(0)"
            :width="fit.len(field.world.w)" :height="fit.len(field.world.h)"
            fill="none" :stroke="rdr.bound" stroke-width="1.5"/>

      <!-- Zones -->
      <g v-for="(z, i) in field.zones" :key="'z'+i">
        <rect :x="fit.x(z.x)" :y="fit.y(z.y)" :width="fit.len(z.w)" :height="fit.len(z.h)"
              :fill="zoneColor(z.kind)" fill-opacity="0.06"
              :stroke="zoneColor(z.kind)" stroke-opacity="0.55" stroke-width="1.2"
              stroke-dasharray="5 4" rx="2"/>
        <text :x="fit.x(z.x)+5" :y="fit.y(z.y)+13"
              :fill="zoneColor(z.kind)" fill-opacity="0.9"
              font-size="10" :font-family="rdr.font" letter-spacing="0.5">{{z.label}}</text>
      </g>

      <!-- Walls -->
      <rect v-for="(w, i) in field.walls" :key="'w'+i"
            :x="fit.x(w[0])" :y="fit.y(w[1])" :width="fit.len(w[2])" :height="fit.len(w[3])"
            :fill="rdr.wallS" :stroke="rdr.wallS2" stroke-width="1"/>

      <!-- Movement intent arrows -->
      <template v-for="u in units" :key="'mv'+u.id">
        <line v-if="hasMoveIntent(u)"
              :x1="fit.x(u.x)" :y1="fit.y(u.y)" :x2="fit.x(u.next.x)" :y2="fit.y(u.next.y)"
              :stroke="u.teamObj.raw" stroke-opacity="0.5" stroke-width="1.4" stroke-dasharray="3 3"/>
      </template>

      <!-- Units -->
      <template v-for="u in units" :key="u.id">
      <g v-if="isVisible(u)"
         :style="{ transform: `translate(${fit.x(u.x)}px, ${fit.y(u.y)}px)`, transition: hasMoveIntent(u) ? 'transform 0.15s ease' : 'none', cursor: 'pointer' }"
         @click="handleUnitClick($event, u)">

        <!-- Dead: X marker -->
        <g v-if="u.dead" :opacity="0.4">
          <line :x1="-unitR(u)*.7" :y1="-unitR(u)*.7"
                :x2="unitR(u)*.7"  :y2="unitR(u)*.7"
                :stroke="u.teamObj.raw" stroke-width="1.6"/>
          <line :x1="-unitR(u)*.7" :y1="unitR(u)*.7"
                :x2="unitR(u)*.7"  :y2="-unitR(u)*.7"
                :stroke="u.teamObj.raw" stroke-width="1.6"/>
        </g>

        <!-- Live unit -->
        <g v-else>
          <!-- Active unit ring: white outer ring + inner glow ring -->
          <template v-if="u.id === activeUnitId">
            <circle cx="0" cy="0" :r="unitR(u)+11"
                    fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="6" class="active-ring"/>
            <circle cx="0" cy="0" :r="unitR(u)+7"
                    fill="none" stroke="white" stroke-width="2" class="active-ring"/>
          </template>
          <!-- Selected unit ring: dashed ring -->
          <circle v-if="u.id === selectedId && u.id !== activeUnitId"
                  cx="0" cy="0" :r="unitR(u)+6"
                  fill="none" stroke="rgba(255,255,255,0.75)" stroke-width="1.5" stroke-dasharray="3 3"/>
          <!-- Facing indicator: filled arrowhead on unit edge -->
          <polygon v-if="field.ui?.showFacing !== false"
                   :points="facingArrow(u)"
                   :fill="u.id === activeUnitId ? 'white' : u.teamObj.raw"
                   :stroke="rdr.stage" stroke-width="1"/>
          <!-- Body shape: active unit gets solid team-color fill (skipped when a sprite image is available) -->
          <circle v-if="!u.imagePath && unitShape(u)==='circle'"
                  cx="0" cy="0" :r="unitR(u)"
                  :fill="u.id === activeUnitId ? u.teamObj.raw : rdr.unitFill"
                  :stroke="u.id === activeUnitId ? 'white' : u.teamObj.raw" stroke-width="2"/>
          <polygon v-else-if="!u.imagePath && unitShape(u)==='triangle'"
                   :points="`0,${-unitR(u)} ${unitR(u)},${unitR(u)} ${-unitR(u)},${unitR(u)}`"
                   :fill="u.id === activeUnitId ? u.teamObj.raw : rdr.unitFill"
                   :stroke="u.id === activeUnitId ? 'white' : u.teamObj.raw" stroke-width="2"/>
          <rect v-else-if="!u.imagePath"
                :x="-unitR(u)" :y="-unitR(u)"
                :width="unitR(u)*2" :height="unitR(u)*2"
                :fill="u.id === activeUnitId ? u.teamObj.raw : rdr.unitFill"
                :stroke="u.id === activeUnitId ? 'white' : u.teamObj.raw" stroke-width="2"/>
          <!-- Sprite image or first letter of unit name -->
          <template v-if="u.imagePath">
            <!-- Invisible hit-area: the image itself has pointer-events:none so it doesn't block clicks on what's behind it -->
            <rect :x="-unitR(u)" :y="-unitR(u)"
                  :width="unitR(u)*2" :height="unitR(u)*2"
                  fill="transparent" style="pointer-events:all"/>
            <image :x="-unitR(u)" :y="-unitR(u)"
                   :width="unitR(u)*2" :height="unitR(u)*2"
                   :href="u.imagePath"
                   style="pointer-events:none;image-rendering:pixelated"/>
          </template>
          <text v-else x="0" y="0"
                :fill="u.id === activeUnitId ? 'white' : u.teamObj.raw" :font-family="rdr.font"
                :font-size="unitR(u)" font-weight="800"
                text-anchor="middle" dominant-baseline="central"
                style="user-select:none;pointer-events:none">{{u.name[0].toUpperCase()}}</text>
          <!-- HP bar -->
          <template v-if="field.ui?.showHpBars !== false">
            <rect :x="-unitR(u)" :y="unitR(u)+3" :width="unitR(u)*2" height="3" :fill="rdr.hpTrack"/>
            <rect :x="-unitR(u)" :y="unitR(u)+3"
                  :width="unitR(u)*2*((u.currentHp ?? u.hpNow)/u.hpMax)" height="3"
                  :fill="hpColor((u.currentHp ?? u.hpNow)/u.hpMax, u.teamObj.raw)"/>
          </template>
        </g>
      </g>
      </template>

      <!-- Ruler labels -->
      <template v-if="showRuler">
        <text v-for="r in rulerX" :key="'rx'+r.label"
              :x="fit.x(r.pos)" :y="xRulerY"
              :fill="rdr.ruler" font-size="8" :font-family="rdr.font" text-anchor="middle">{{r.label}}</text>
        <text v-for="r in rulerY" :key="'ry'+r.label"
              :x="fit.x(0)-6" :y="fit.y(r.pos)+3"
              :fill="rdr.ruler" font-size="8" :font-family="rdr.font" text-anchor="end">{{r.label}}</text>
      </template>
    </svg>

    <!-- Fog mask (radial gradient blobs, only when grid-based fog is not used) -->
    <div v-if="fog && !field.ui?.gridFog" class="bf-layer" style="pointer-events:none;z-index:3"
         :style="{
           background: rdr.fogS,
           WebkitMaskImage: fogMask,
           maskImage: fogMask,
           WebkitMaskComposite: 'destination-in',
           maskComposite: 'intersect',
         }"/>
  </div>
</template>

<style scoped>
@keyframes active-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.35; }
}
.active-ring {
  animation: active-pulse 1.2s ease-in-out infinite;
}
</style>
