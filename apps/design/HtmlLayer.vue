<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue';
import HtmlUnit from './battlefield/HtmlUnit.vue';
// Opt-in HTML/CSS renderer for square tile grids (the `htmlRenderer` game option, or the
// in-game menu toggle — see Battlefield.vue's renderer routing). A lighter alternative to
// SchematicLayer's SVG for the common square-grid case.
//
// The board is a real CSS grid whose container is sized to an EXACT whole number of pixels
// per cell (see cellPx/boardW below), so every cell edge lands on an integer. That matters
// because translucent fills can't be tiled at fractional edges: where two 82%-alpha fog
// cells meet at, say, x=53.7, the compositor blends both partial coverages into that pixel
// and it comes out lighter than either — a visible seam. Opaque tiles can hide this by
// overlapping a hair; translucent ones can't (an overlap double-darkens instead). Integer
// cells make one box own each pixel outright, so the problem disappears by construction
// rather than being papered over. The container is re-measured on viewport resize.
//
// Each cell paints its own stack: terrain colour + art, or the fog veil, plus any marker,
// highlight and the unit standing on it. Non-cell-aligned furniture (walls, zones, rulers,
// move arrows) stays absolutely positioned against the same integer origin.
//
// Not covered (these keep using the SVG SchematicLayer): hexes, non-grid shape maps,
// continuous-map radial fog, aiming overlays, drag-to-move ghosts, coast sprites and
// sprite-layer units. Globals (window.*) come from data.js / vision.js / teamSprite.js,
// loaded as classic <script>s in index.html — vue3-sfc-loader can't parse an ESM import
// of a plain .js.

const props = defineProps({
  field:        Object,
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
  aiming:          { type: Object, default: null },
});
const emit = defineEmits(['select', 'sq-click', 'set-marker']);
const imgSrc   = window.api.imgSrc;
const basePath = window.api.basePath;
const VISION   = window.VISION;

const W = computed(() => props.field.world.w);
const H = computed(() => props.field.world.h);

// ── integer-snapped board geometry ────────────────────────────────────────────
// Padding matches Battlefield's fitter, so the HTML board sits where the SVG one would.
const PAD = 24;
const rootEl = ref(null);
const boxW = ref(0), boxH = ref(0);
let ro = null;
onMounted(() => {
  ro = new ResizeObserver(([entry]) => {
    boxW.value = entry.contentRect.width;
    boxH.value = entry.contentRect.height;
  });
  if (rootEl.value) ro.observe(rootEl.value);
});
onUnmounted(() => ro?.disconnect());

// Whole pixels per cell — floored, so the board is never larger than the space it has.
const cellPx  = computed(() => Math.max(1, Math.floor(Math.min(
  (boxW.value - PAD * 2) / W.value,
  (boxH.value - PAD * 2) / H.value))));
const boardW  = computed(() => cellPx.value * W.value);
const boardH  = computed(() => cellPx.value * H.value);
const originX = computed(() => Math.round((boxW.value - boardW.value) / 2));
const originY = computed(() => Math.round((boxH.value - boardH.value) / 2));

// world → screen. Cell-aligned inputs land on exact integers by construction.
function px(wx)   { return originX.value + wx * cellPx.value; }
function py(wy)   { return originY.value + wy * cellPx.value; }
function plen(wl) { return wl * cellPx.value; }

const boardStyle = computed(() => ({
  position: 'absolute',
  left: originX.value + 'px', top: originY.value + 'px',
  width: boardW.value + 'px', height: boardH.value + 'px',
  display: 'grid',
  gridTemplateColumns: `repeat(${W.value}, ${cellPx.value}px)`,
  gridTemplateRows:    `repeat(${H.value}, ${cellPx.value}px)`,
}));

const highlightUnitId = computed(() => props.activeUnitId);
const blinkTargetId   = computed(() => props.field.ui?.freeSelection ? props.selectedId : props.activeUnitId);

// Team whose pieces project vision — the human (teams[0]); in reveal mode whoever is to
// move at the displayed ply, so fog flips as you step through. Mirrors SchematicLayer.
const viewerId = computed(() => props.revealAll
  ? props.viewerTeam
  : (props.field.teams?.[0]?.id ?? null));
const viewerIsBlack = computed(() => viewerId.value === props.field.teams?.[1]?.id);

// ── fog of war ────────────────────────────────────────────────────────────────
// Two square-grid fog styles, mirroring SchematicLayer:
//  • gridFog (chess): per-piece reach; hidden cells get a translucent veil on top.
//  • vision fog (tactical etc., via VISION): hidden tiles are painted with the fog colour
//    and their terrain art withheld — no separate veil.
const gridFogVisibleSet = computed(() => {
  if (!props.fog || !props.field.ui?.gridFog) return null;
  // Prefer the server's authoritative set (the filtered client board strips hidden
  // blockers and can't reproduce it). Reveal mode recomputes from the full board.
  if (!props.revealAll && props.field.fogVisible) return props.field.fogVisible;
  const w = W.value, h = H.value;
  const pDir      = viewerIsBlack.value ? 1 : -1;
  const pStartRow = viewerIsBlack.value ? 1 : 6;
  const visible = new Set();
  const occ = new Set();
  for (const u of props.units) if (!u.dead) occ.add(`${Math.floor(u.x)},${Math.floor(u.y)}`);
  const inB = (x, y) => x >= 0 && x < w && y >= 0 && y < h;
  const add = (x, y) => { if (inB(x, y)) visible.add(`${x},${y}`); };
  for (const u of props.units) {
    if (u.team !== viewerId.value || u.dead) continue;
    const gx = Math.floor(u.x), gy = Math.floor(u.y);
    const t = u.type; // 'k','q','r','b','n','p'
    add(gx, gy);
    if (t === 'p') {
      add(gx, gy + pDir);
      if (gy === pStartRow) add(gx, gy + pDir * 2);
      add(gx - 1, gy + pDir); add(gx + 1, gy + pDir);
    } else if (t === 'n') {
      for (const [dx, dy] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) add(gx + dx, gy + dy);
    } else if (t === 'k') {
      for (const [dx, dy] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) add(gx + dx, gy + dy);
    } else {
      const rDirs = [[0,1],[0,-1],[1,0],[-1,0]];
      const bDirs = [[1,1],[1,-1],[-1,1],[-1,-1]];
      const dirs = t === 'r' ? rDirs : t === 'b' ? bDirs : [...rDirs, ...bDirs];
      for (const [dx, dy] of dirs) {
        let cx = gx + dx, cy = gy + dy;
        while (inB(cx, cy)) { add(cx, cy); if (occ.has(`${cx},${cy}`)) break; cx += dx; cy += dy; }
      }
    }
  }
  return visible;
});

// Vision fog for non-chess square grids (union of every friendly unit's field of view —
// facing-aware, see vision.js). Continuous maps have no tiles to shade.
const squareFogVisibleSet = computed(() => {
  if (!props.fog || props.field.ui?.gridFog || props.field.grid !== 'square') return null;
  if (props.field.locationType === 'continuous') return null;
  return VISION.visibleTileSet(props.field, VISION.visionSources(props.units, viewerId.value, null));
});

// Tiles the selected unit sees specifically — outlined on top of the team-wide shading.
const selectedVisionSet = computed(() => {
  if (!squareFogVisibleSet.value) return null;
  const sel = props.revealAll ? null : props.selectedId;
  if (sel == null) return null;
  const sources = VISION.visionSources(props.units, viewerId.value, sel);
  if (sources.length !== 1 || sources[0].id !== sel) return null;
  return VISION.visibleTileSet(props.field, sources);
});

function isFogSquare(col, row) {
  if (gridFogVisibleSet.value)   return !gridFogVisibleSet.value.has(`${col},${row}`);
  if (squareFogVisibleSet.value) return !squareFogVisibleSet.value.has(`${col},${row}`);
  return false;
}

// ── fog markers (guesses on hidden cells; reveal-mode true positions) ──────────
const MARKER_CYCLE = ['p', 'n', 'b', 'r', 'q', 'k', null];
const enemyPrefix = computed(() => viewerIsBlack.value ? 'w' : 'b');
function markerImg(type) { return `${basePath}/images/chess/${enemyPrefix.value}${type.toUpperCase()}`; }
function markerSrc(m) { return imgSrc(m.img) ?? markerImg(m.type); }

const squareMarkerList = computed(() => {
  if (!props.fog || props.revealAll) return [];
  return (props.field.fogMarkers ?? []).map(m => ({ col: m.x, row: m.y, type: m.type, img: m.imagePath }));
});
const revealMarkerList = computed(() => {
  if (!props.revealAll) return [];
  const vis = gridFogVisibleSet.value;
  if (!vis) return [];
  const out = [];
  for (const u of props.units) {
    if (u.dead) continue;
    const col = Math.floor(u.x), row = Math.floor(u.y);
    if (!vis.has(`${col},${row}`)) out.push({ col, row, type: u.type, img: u.imagePath });
  }
  return out;
});
const displayMarkers = computed(() => props.revealAll ? revealMarkerList.value : squareMarkerList.value);

// ── per-unit presentation ─────────────────────────────────────────────────────
function isVisible(u) {
  if (!props.fog) return true;
  // Reveal mode: seen pieces render normally, the rest as translucent markers.
  if (props.revealAll) {
    const vis = gridFogVisibleSet.value;
    return !vis || vis.has(`${Math.floor(u.x)},${Math.floor(u.y)}`);
  }
  if (u.friendly) return true;
  if (gridFogVisibleSet.value) return gridFogVisibleSet.value.has(`${Math.floor(u.x)},${Math.floor(u.y)}`);
  return u.visible;
}

function unitR(u) {
  const mult = W.value <= 10 ? 0.36 : 0.42;
  // Bare sprites have no stroke eating into them, so let them fill more of the cell.
  return Math.max(5, (u?.imagePath ? mult * 1.25 : mult) * cellPx.value);
}
function unitShape(u) {
  return props.field.ui?.unitShapes?.[u.type] ?? 'square';
}

// Under vision fog a hidden tile is painted with the fog colour and its art withheld.
function tileFogged(tile) {
  return !!squareFogVisibleSet.value && !squareFogVisibleSet.value.has(`${tile.x},${tile.y}`);
}

// ── cells: one entry per board square, in row-major order for grid auto-placement ──
// Games that already colour their tiles as a checkerboard (chess) opt out — the synthetic
// darken-the-odd-squares overlay would just double-darken them (mirrors SchematicLayer).
const checkerOn = computed(() => !props.field.ui?.ownTileColors && W.value <= 10);
const cells = computed(() => {
  const tiles = new Map();
  for (const t of props.field.tiles ?? []) tiles.set(`${t.x},${t.y}`, t);
  const unitsAt = new Map();
  for (const u of props.units) {
    if (!isVisible(u)) continue;
    const k = `${Math.floor(u.x)},${Math.floor(u.y)}`;
    if (!unitsAt.has(k)) unitsAt.set(k, []);
    unitsAt.get(k).push(u);
  }
  const markers = new Map();
  for (const m of displayMarkers.value) markers.set(`${m.col},${m.row}`, m);
  const legal = new Set(props.legalSquares.map(([c, r]) => `${c},${r}`));
  const last  = new Set(props.lastMoveSquares.map(([c, r]) => `${c},${r}`));
  const vis   = selectedVisionSet.value;
  const sel   = selectedSquare.value;
  const selE  = props.selectedEmptySquare;
  const showLegal = !props.aiming && !props.field.ui?.aimedActionTypes?.includes('move');
  // Drop target: only highlighted while hovering a square the dragged piece may legally reach.
  const dragSq = (dragUnit.value && dragHoverSq.value
    && legal.has(`${dragHoverSq.value[0]},${dragHoverSq.value[1]}`)) ? dragHoverSq.value : null;

  const out = [];
  for (let y = 0; y < H.value; y++) {
    for (let x = 0; x < W.value; x++) {
      const k = `${x},${y}`;
      const tile = tiles.get(k) ?? null;
      out.push({
        k, x, y,
        color:   tile ? (tileFogged(tile) ? props.rdr.fogA : tile.color) : null,
        bg:      (tile && !tileFogged(tile) && tile.bgImage)      ? imgSrc(tile.bgImage)      : null,
        overlay: (tile && !tileFogged(tile) && tile.overlayImage) ? imgSrc(tile.overlayImage) : null,
        fogged:  !!gridFogVisibleSet.value && !gridFogVisibleSet.value.has(k),
        vision:  !!vis && vis.has(k),
        marker:  markers.get(k) ?? null,
        units:   unitsAt.get(k) ?? [],
        checker: checkerOn.value && (x + y) % 2 === 1,
        legal:   showLegal && legal.has(k),
        dragHover: !!dragSq && dragSq[0] === x && dragSq[1] === y,
        lastMove: last.has(k),
        selTint: !!sel  && sel.x  === x && sel.y  === y,
        selEmpty: !!selE && selE.x === x && selE.y === y,
      });
    }
  }
  return out;
});

// When ui.highlightSelectedSquare is set, tint the selected unit's cell instead of
// ringing the token itself.
const selectedSquare = computed(() => {
  if (!props.field.ui?.highlightSelectedSquare || !props.selectedId) return null;
  const u = props.units.find(u => u.id === props.selectedId);
  return u ? { x: Math.floor(u.x), y: Math.floor(u.y) } : null;
});

// ── board furniture (not cell content) ────────────────────────────────────────
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

function rect(x, y, w, h) {
  return { position: 'absolute', left: px(x) + 'px', top: py(y) + 'px',
           width: plen(w) + 'px', height: plen(h) + 'px' };
}

const rulerX = computed(() => props.showRuler
  ? Array.from({ length: W.value }, (_, x) => ({ label: props.field.xLabels?.[x] ?? x, pos: x + 0.5 })) : []);
const rulerY = computed(() => props.showRuler
  ? Array.from({ length: H.value }, (_, y) => ({ label: props.field.yLabels?.[y] ?? y, pos: y + 0.5 })) : []);
const xRulerTop = computed(() => props.field.ui?.gridLabelsBottom ? py(H.value) + 2 : py(0) - 12);

function hasMoveIntent(u) {
  if (u.dead || !isVisible(u)) return false;
  return Math.hypot(plen(u.next.x - u.x), plen(u.next.y - u.y)) >= 3;
}

// ── drag-to-move ──────────────────────────────────────────────────────────────
// Mirrors SchematicLayer's drag: press a piece, its ghost follows the cursor, release on
// a legal square to move. The ghost is the one thing here that genuinely can't live in a
// cell — it tracks the pointer, not the lattice — so it (alone) is absolutely positioned.
const dragUnit    = ref(null);
const dragPos     = ref(null);   // { x, y } in root-local px, for the ghost
const dragHoverSq = ref(null);   // [col, row] under the cursor, or null
// A drag ends with a native click on the two cells' common ancestor; swallow it so it
// isn't read as a fresh board click.
let dragJustEnded = false;

function _updateDragPos(clientX, clientY) {
  if (!rootEl.value) return;
  const r = rootEl.value.getBoundingClientRect();
  const x = clientX - r.left, y = clientY - r.top;
  dragPos.value = { x, y };
  const col = Math.floor((x - originX.value) / cellPx.value);
  const row = Math.floor((y - originY.value) / cellPx.value);
  dragHoverSq.value = (col >= 0 && col < W.value && row >= 0 && row < H.value) ? [col, row] : null;
}
function _onDragMove(e) { _updateDragPos(e.clientX, e.clientY); }
function _onDragEnd() {
  window.removeEventListener('mousemove', _onDragMove);
  window.removeEventListener('mouseup',   _onDragEnd);
  if (dragUnit.value && dragHoverSq.value) {
    const [col, row] = dragHoverSq.value;
    if (col !== Math.floor(dragUnit.value.x) || row !== Math.floor(dragUnit.value.y))
      emit('sq-click', col, row, col + 0.5, row + 0.5);
  }
  dragJustEnded = true;
  setTimeout(() => { dragJustEnded = false; }, 0);
  dragUnit.value = null; dragPos.value = null; dragHoverSq.value = null;
}
function handleUnitMousedown(e, u) {
  if (!props.dragToMove || u.dead) return;
  // A piece standing on a legal target square is a capture target — let the click through.
  if (props.legalSquares.some(([lc, lr]) => lc === Math.floor(u.x) && lr === Math.floor(u.y))) return;
  e.stopPropagation();
  emit('select', u.id);
  dragUnit.value = u;
  _updateDragPos(e.clientX, e.clientY);
  window.addEventListener('mousemove', _onDragMove);
  window.addEventListener('mouseup',   _onDragEnd);
}
onUnmounted(() => {
  window.removeEventListener('mousemove', _onDragMove);
  window.removeEventListener('mouseup',   _onDragEnd);
});

// ── clicks (same emit contract as SchematicLayer: select / sq-click / set-marker) ──
function handleCellClick(c) {
  if (dragJustEnded) return;
  // Clicking a hidden cell with nothing selected cycles a guess marker instead of moving.
  if (!props.revealAll && !props.selectedId && isFogSquare(c.x, c.y)) {
    const current = squareMarkerList.value.find(m => m.col === c.x && m.row === c.y)?.type ?? null;
    const next = MARKER_CYCLE[(MARKER_CYCLE.indexOf(current) + 1) % MARKER_CYCLE.length];
    emit('set-marker', c.x, c.y, next);
    return;
  }
  emit('sq-click', c.x, c.y, c.x + 0.5, c.y + 0.5);
}

function handleRootClick() {
  if (dragJustEnded) return;
  emit('select', null);
}

// Unhandled clicks fall through to the cell below (→ sq-click), matching SchematicLayer:
// aiming and legal-target clicks are "a click at that point", not a selection.
function handleUnitClick(e, u) {
  if (props.aiming) return;
  const isLegalTarget = props.legalSquares.some(([lc, lr]) => lc === Math.floor(u.x) && lr === Math.floor(u.y));
  if (isLegalTarget) return;
  // Drag mode already selected on mousedown; just don't let it read as a board click.
  if (props.dragToMove) { e.stopPropagation(); return; }
  e.stopPropagation();
  emit('select', u.id);
}
</script>

<template>
  <div ref="rootEl" class="bf-layer hl-root"
       :style="{ background: rdr.stage, cursor: dragUnit ? 'grabbing' : '' }"
       @click="handleRootClick">

    <!-- The board: an exact-pixel CSS grid, one cell per square -->
    <div class="hl-board" :style="boardStyle">
      <div v-for="c in cells" :key="c.k" class="hl-cell"
           :style="{ background: c.color }"
           @click.stop="handleCellClick(c)">
        <img v-if="c.bg"      class="hl-fill hl-pixel hl-cover" :src="c.bg" draggable="false"/>
        <img v-if="c.overlay" class="hl-fill hl-pixel hl-cover" :src="c.overlay" draggable="false"/>
        <div v-if="c.checker" class="hl-fill hl-checker"/>
        <!-- gridFog veil (vision fog is already baked into c.color) -->
        <div v-if="c.fogged"  class="hl-fill" :style="{ background: rdr.fogA }"/>
        <div v-if="c.vision"  class="hl-fill hl-vision"/>
        <img v-if="c.marker"  class="hl-marker-img" :src="markerSrc(c.marker)" draggable="false"/>
        <div v-if="c.selTint"  class="hl-fill hl-seltint"/>
        <div v-if="c.lastMove" class="hl-fill hl-lastmove"/>
        <div v-if="c.legal"    class="hl-fill hl-legal"/>
        <div v-if="c.dragHover" class="hl-fill hl-draghover"/>
        <div v-if="c.selEmpty" class="hl-fill hl-dashed"/>

        <HtmlUnit v-for="u in c.units" :key="u.id"
          :unit="u" :r="unitR(u)" :rdr="rdr" :shape="unitShape(u)"
          :showLetter="!field.ui?.showFacing" :showHp="field.ui?.showHpBars !== false"
          :recolor="field.ui?.recolorTeamSprites"
          :active="u.id === highlightUnitId && !field.ui?.blinkActiveUnit"
          :selected="u.id === selectedId && !field.ui?.highlightSelectedSquare"
          :hovered="u.id === hoveredId"
          :blink="u.id === blinkTargetId && !!field.ui?.blinkActiveUnit"
          :grab="dragToMove && !u.dead"
          :dim="dragUnit?.id === u.id"
          @click="handleUnitClick($event, u)"
          @mousedown="handleUnitMousedown($event, u)"/>
      </div>
    </div>

    <!-- Drag ghost: follows the cursor, so it's the one element that can't be a grid cell.
         The inner grid lets HtmlUnit's place-self:center work outside the board lattice. -->
    <div v-if="dragUnit && dragPos" class="hl-ghost"
         :style="{ left: dragPos.x+'px', top: dragPos.y+'px' }">
      <HtmlUnit :unit="dragUnit" :r="unitR(dragUnit)" :rdr="rdr" :shape="unitShape(dragUnit)"
        :showLetter="!field.ui?.showFacing" :showHp="false"
        :recolor="field.ui?.recolorTeamSprites"/>
    </div>

    <!-- Grid lines -->
    <template v-if="!field.ui?.hideGridLines">
      <div v-for="gx in gridLines.xs" :key="'gx'+gx" class="hl-noevents"
           :style="{ position:'absolute', left: px(gx)+'px', top: py(0)+'px',
                     width:'1px', height: boardH+'px', background: rdr.grid }"/>
      <div v-for="gy in gridLines.ys" :key="'gy'+gy" class="hl-noevents"
           :style="{ position:'absolute', left: px(0)+'px', top: py(gy)+'px',
                     width: boardW+'px', height:'1px', background: rdr.grid }"/>
    </template>

    <!-- Boundary -->
    <div class="hl-noevents" :style="{ ...rect(0, 0, W, H), border: '1.5px solid ' + rdr.bound }"/>

    <!-- Zones -->
    <div v-for="(z, i) in field.zones" :key="'z'+i" class="hl-noevents hl-zone"
         :style="{ ...rect(z.x, z.y, z.w, z.h),
                   border: '1.2px dashed ' + zoneColor(z.kind),
                   background: zoneColor(z.kind) + '10' }">
      <span class="hl-zone-label" :style="{ color: zoneColor(z.kind), fontFamily: rdr.font }">{{ z.label }}</span>
    </div>

    <!-- Walls -->
    <div v-for="(w, i) in field.walls" :key="'w'+i" class="hl-noevents"
         :style="{ ...rect(w[0], w[1], w[2], w[3]), background: rdr.wallS, border: '1px solid ' + rdr.wallS2 }"/>

    <!-- Movement intent arrows -->
    <template v-for="u in units" :key="'mv'+u.id">
      <div v-if="hasMoveIntent(u)" class="hl-noevents hl-intent"
           :style="{
             position:'absolute', left: px(u.x)+'px', top: py(u.y)+'px',
             width: Math.hypot(plen(u.next.x - u.x), plen(u.next.y - u.y))+'px',
             transform: `rotate(${Math.atan2(u.next.y - u.y, u.next.x - u.x)}rad)`,
             transformOrigin: '0 50%',
             borderTop: '1.4px dashed ' + u.teamObj.raw,
             opacity: 0.5,
           }"/>
    </template>

    <!-- Ruler labels -->
    <template v-if="showRuler">
      <span v-for="r in rulerX" :key="'rx'+r.label" class="hl-noevents hl-ruler"
            :style="{ left: px(r.pos)+'px', top: xRulerTop+'px', color: rdr.ruler,
                      fontFamily: rdr.font, transform:'translateX(-50%)' }">{{ r.label }}</span>
      <span v-for="r in rulerY" :key="'ry'+r.label" class="hl-noevents hl-ruler"
            :style="{ left: (px(0)-6)+'px', top: py(r.pos)+'px', color: rdr.ruler,
                      fontFamily: rdr.font, transform:'translate(-100%,-50%)' }">{{ r.label }}</span>
    </template>
  </div>
</template>

<style scoped>
/* Dragging across the board must never start a native text/image selection — the browser
   would paint its selection tint over whole cells and sprites (SchematicLayer's SVG is
   immune; real DOM is not). Images additionally opt out of native drag via draggable="false". */
.hl-root { position: absolute; inset: 0; overflow: hidden; user-select: none; }
.hl-noevents { pointer-events: none; }
.hl-pixel { image-rendering: pixelated; }
.hl-cover { object-fit: cover; }

/* Each cell is its own single-track grid, so every layer (terrain, fog, highlights, unit)
   is placed in the same track and spans the cell by default — no absolute positioning or
   inset needed. Overflow stays visible: unit rings/HP bars intentionally spill outwards. */
.hl-cell { display: grid; cursor: pointer; }
.hl-cell > * { grid-area: 1 / 1; }
.hl-fill { pointer-events: none; }

.hl-checker  { background: rgba(0,0,0,0.22); }
.hl-vision   { border: 1.5px solid rgba(255,255,255,0.55); }
.hl-seltint  { background: rgba(255,255,255,0.35); }
.hl-lastmove { background: rgba(242,180,65,0.35); }
.hl-legal    { background: rgba(66,198,230,0.28); border: 1.5px solid rgba(66,198,230,0.7); }
.hl-draghover { background: rgba(66,198,230,0.55); border: 2px solid rgba(66,198,230,0.9); }
.hl-dashed   { border: 2px dashed rgba(255,255,255,0.85); }
.hl-ghost { position: absolute; display: grid; transform: translate(-50%, -50%); pointer-events: none; z-index: 2; opacity: 0.9; }
.hl-marker-img { place-self: center; width: 80%; height: 80%; opacity: 0.55; image-rendering: pixelated; pointer-events: none; }

.hl-zone { border-radius: 2px; }
.hl-zone-label { position: absolute; left: 4px; top: 1px; font-size: 10px; letter-spacing: 0.5px; }
.hl-intent { height: 0; }
.hl-ruler { position: absolute; font-size: 8px; white-space: nowrap; }
</style>
