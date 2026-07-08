<script setup>
import { computed, ref, watch, onUnmounted } from 'vue';
import UnitFx from './battlefield/UnitFx.vue';
import FogOverlay from './battlefield/FogOverlay.vue';
// Vision/fog helpers come from the classic global VISION (apps/design/vision.js, loaded as
// a <script> in index.html) — vue3-sfc-loader can't parse an ESM `import` of a plain .js.

const props = defineProps({
  field:        Object,
  fit:          Object,
  units:        Array,
  // Transient combat flashes keyed by unit id (see App.vue's unitFx). Drawn at a
  // captured board square so a killing blow still flashes after its victim is gone.
  unitFx:       { type: Object, default: () => ({}) },
  selectedId:   String,
  activeUnitId: { type: String, default: null },
  fog:          Boolean,
  showRuler:    Boolean,
  rdr:          Object,
  legalSquares:    { type: Array, default: () => [] },
  lastMoveSquares: { type: Array, default: () => [] },
  dragToMove:      { type: Boolean, default: false },
  // Reveal-all (finished fog games): show every piece's true position. Hidden enemies
  // render as translucent markers and fog is drawn from `viewerTeam`'s perspective.
  revealAll:       { type: Boolean, default: false },
  viewerTeam:      { type: String, default: null },
  // Empty square selected for its terrain info (see Battlefield.vue's selectedSquare).
  // Distinct from `selectedSquare` below, which tints a *unit's* square.
  selectedEmptySquare: { type: Object, default: null },
  // Selected terrain shape (non-grid maps) — outlined to show what the info panel describes.
  selectedShape: { type: Object, default: null },
});
const emit = defineEmits(['select', 'sq-click', 'set-marker']);

// Team whose pieces project vision. Normally the human (teams[0]); in reveal mode it
// follows whoever is to move at the displayed ply, so fog flips as you step through.
const viewerId = computed(() => props.revealAll
  ? props.viewerTeam
  : (props.field.teams?.[0]?.id ?? null));
const viewerIsBlack = computed(() => viewerId.value === props.field.teams?.[1]?.id);

// Which unit should blink when `ui.blinkActiveUnit` is set. In free-selection games
// (e.g. civ1) there's no turn-scoped activeUnitId, so blink whichever unit is clicked.
const blinkTargetId = computed(() => props.field.ui?.freeSelection ? props.selectedId : props.activeUnitId);

// When `ui.highlightSelectedSquare` is set, the selected unit's square gets a background
// tint instead of the dashed ring drawn around the unit itself.
const selectedSquare = computed(() => {
  if (!props.field.ui?.highlightSelectedSquare || !props.selectedId) return null;
  const u = props.units.find(u => u.id === props.selectedId);
  return u ? { x: Math.floor(u.x), y: Math.floor(u.y) } : null;
});

// Continuous-location maps (see games/coord.js) have no tile grid visually, so showing
// legal moves as a lattice of unit-cell squares looks wrong — draw the reachable area as
// a single movement-radius circle around the selected unit instead. On these maps
// movement is a continuous straight-line slide to wherever's clicked (see Battlefield.vue's
// handleSqClick), so the radius is the unit's real move budget.
const legalMoveCircle = computed(() => {
  if (props.field.locationType !== 'continuous' || !props.legalSquares.length) return null;
  const u = props.units.find(u => u.id === props.selectedId);
  if (!u) return null;
  if (u.moveRange != null) return { cx: u.x, cy: u.y, r: u.moveRange };
  let r = 0;
  for (const [lc, lr] of props.legalSquares) {
    r = Math.max(r, Math.hypot((lc + 0.5) - u.x, (lr + 0.5) - u.y));
  }
  return { cx: u.x, cy: u.y, r };
});

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
  // Prefer the server's authoritative visibility set: the client cannot reproduce it from
  // the filtered board, where hidden enemies (which block sliders and occupy push squares)
  // have been stripped and would wrongly read as empty + visible (e.g. a hidden pawn on e5).
  // In reveal mode we always recompute: the board is full (every blocker present) so the
  // derivation is accurate, and we need the viewer's perspective, not the server's white set.
  if (!props.revealAll && props.field.fogVisible) return props.field.fogVisible;
  const W = props.field.world.w, H = props.field.world.h;
  // Pawns advance toward rank 8 (lower y) for white, toward rank 1 (higher y) for black.
  const pDir     = viewerIsBlack.value ? 1 : -1;
  const pStartRow = viewerIsBlack.value ? 1 : 6;
  const visible = new Set();
  const occ = new Set();
  for (const u of props.units)
    if (!u.dead) occ.add(`${Math.floor(u.x)},${Math.floor(u.y)}`);
  const inB = (x, y) => x >= 0 && x < W && y >= 0 && y < H;
  const add  = (x, y) => { if (inB(x, y)) visible.add(`${x},${y}`); };
  for (const u of props.units) {
    if (u.team !== viewerId.value || u.dead) continue;
    const gx = Math.floor(u.x), gy = Math.floor(u.y);
    const t = u.type; // 'k','q','r','b','n','p'
    add(gx, gy);
    if (t === 'p') {
      add(gx, gy + pDir);                       // push forward
      if (gy === pStartRow) add(gx, gy + pDir * 2); // double push from starting rank
      add(gx - 1, gy + pDir); add(gx + 1, gy + pDir); // diagonal attacks
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

// Field-of-vision tile set for square-grid fog (non-chess). Facing-aware: a unit sees a
// full disc (no facing) or a heading-limited cone (see vision.js). When a friendly unit is
// selected only its own vision is shown; otherwise the player's vision (the union of all
// their units). Continuous maps have no tiles to shade — they use FogOverlay instead.
const squareFogVisibleSet = computed(() => {
  if (!props.fog || props.field.ui?.gridFog || props.field.grid !== 'square') return null;
  if (props.field.locationType === 'continuous') return null;
  const sel = props.revealAll ? null : props.selectedId;
  return VISION.visibleTileSet(props.field, VISION.visionSources(props.units, viewerId.value, sel));
});

function tileColor(tile) {
  if (squareFogVisibleSet.value && !squareFogVisibleSet.value.has(`${tile.x},${tile.y}`))
    return props.rdr.fogA;
  return tile.color;
}

function tileBgImage(tile) {
  if (!tile.bgImage) return null;
  if (squareFogVisibleSet.value && !squareFogVisibleSet.value.has(`${tile.x},${tile.y}`)) return null;
  return tile.bgImage;
}

// Design rule: grid-based games get a square marker (a game can override per unit
// type via ui.unitShapes, e.g. chess); non-grid (continuous, see field.locationType)
// games get a circle, matching there being no cell for a square to align to.
function unitShape(u) {
  const shapes = props.field.ui?.unitShapes;
  if (shapes?.[u.type]) return shapes[u.type];
  return props.field.locationType === 'continuous' ? 'circle' : 'square';
}

// Design rule: a unit shows either its facing arrow (when ui.showFacing is on) or its
// type letter — never both. A static letter drawn under a rotating-looking arrow reads
// as broken, so facing-enabled games get an accent-colored marker instead, shaped per
// unit type (markerShapeFor/markerGlyph, see data.js) so types stay distinguishable.
const facingActive = computed(() => props.field.ui?.showFacing !== false);
function markerR(u) { return Math.max(2, unitR(u) * 0.3); }
function markerSpec(u) { return markerGlyph(markerShapeFor(u.type), markerR(u)); }

// ── square markers (user annotations on unseen squares) ──────────────────────
const MARKER_CYCLE = ['p', 'n', 'b', 'r', 'q', 'k', null];
// Enemy piece colour from the viewer's perspective, so manual markers use the
// opponent's actual sprite set rather than always assuming the enemy is black.
const enemyPrefix = computed(() => viewerIsBlack.value ? 'w' : 'b');
function markerImg(type) { return `/images/chess/${enemyPrefix.value}${type.toUpperCase()}`; }

function isFogSquare(col, row) {
  if (gridFogVisibleSet.value) return !gridFogVisibleSet.value.has(`${col},${row}`);
  if (squareFogVisibleSet.value) return !squareFogVisibleSet.value.has(`${col},${row}`);
  return false;
}

// Server-persisted fog markers (see ChessGame.js `markers`/`fogMarkers`): one value per
// currently-hidden square, seeded from the last real sighting the instant it went out of
// view and freely re-cyclable by the viewer from there — there's no separate "confirmed"
// vs "guessed" state. Kept in game state so a reload or another viewer sees the same
// markers immediately — there's no local copy here, `field.fogMarkers` is the only
// source of truth.
const squareMarkerList = computed(() => {
  if (!props.fog || props.revealAll) return [];
  return (props.field.fogMarkers ?? []).map(m => ({ col: m.x, row: m.y, type: m.type, img: m.imagePath }));
});

// Reveal mode: every piece the viewer can't see is drawn as a translucent marker at its
// true square (using its own colour's sprite), so hidden positions are exposed.
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

// ── drag-to-move ──────────────────────────────────────────────────────────────
const svgEl       = ref(null);
const dragUnit    = ref(null);
const dragSvgPos  = ref(null);   // { x, y } in SVG-local pixels
const dragHoverSq = ref(null);   // [col, row] under cursor, or null

function _updateDragPos(clientX, clientY) {
  if (!svgEl.value) return;
  const rect = svgEl.value.getBoundingClientRect();
  dragSvgPos.value = { x: clientX - rect.left, y: clientY - rect.top };
  const col = Math.floor((clientX - rect.left - props.fit.x(0)) / props.fit.s);
  const row = Math.floor((clientY - rect.top  - props.fit.y(0)) / props.fit.s);
  dragHoverSq.value =
    col >= 0 && col < props.field.world.w && row >= 0 && row < props.field.world.h
      ? [col, row] : null;
}

function _onDragMove(e)  { _updateDragPos(e.clientX, e.clientY); }

function _onDragEnd(e) {
  window.removeEventListener('mousemove', _onDragMove);
  window.removeEventListener('mouseup',   _onDragEnd);
  if (dragUnit.value && dragHoverSq.value && dragSvgPos.value) {
    const [col, row] = dragHoverSq.value;
    const unitCol = Math.floor(dragUnit.value.x);
    const unitRow = Math.floor(dragUnit.value.y);
    if (col !== unitCol || row !== unitRow) {
      const x = (dragSvgPos.value.x - props.fit.x(0)) / props.fit.s;
      const y = (dragSvgPos.value.y - props.fit.y(0)) / props.fit.s;
      emit('sq-click', col, row, x, y);
    }
  }
  dragUnit.value   = null;
  dragSvgPos.value = null;
  dragHoverSq.value = null;
}

function handleUnitMousedown(e, u) {
  if (!props.dragToMove || u.dead) return;
  // If this unit sits on a legal target square, let the click fall through to sq-click instead.
  const col = Math.floor(u.x), row = Math.floor(u.y);
  if (props.legalSquares.some(([lc, lr]) => lc === col && lr === row)) return;
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

// ── board / unit click ────────────────────────────────────────────────────────
function handleBoardClick(e) {
  if (dragUnit.value) return; // drag ended; sq-click already emitted in _onDragEnd
  if (props.field.grid !== 'square') { emit('select', null); return; }
  const rect = e.currentTarget.getBoundingClientRect();
  const x = (e.clientX - rect.left - props.fit.x(0)) / props.fit.s;
  const y = (e.clientY - rect.top  - props.fit.y(0)) / props.fit.s;
  const col = Math.floor(x), row = Math.floor(y);
  if (col >= 0 && col < props.field.world.w && row >= 0 && row < props.field.world.h) {
    if (!props.revealAll && !props.selectedId && isFogSquare(col, row)) {
      const current = squareMarkerList.value.find(m => m.col === col && m.row === row)?.type ?? null;
      const idx = MARKER_CYCLE.indexOf(current);
      const next = MARKER_CYCLE[(idx + 1) % MARKER_CYCLE.length];
      emit('set-marker', col, row, next);
      return;
    }
    // For shape (non-grid) maps, also pass the exact continuous click point (x, y) —
    // Battlefield.vue uses it as the literal move destination instead of snapping to
    // a grid cell (see handleSqClick).
    emit('sq-click', col, row, x, y);
  } else {
    emit('select', null);
  }
}

function handleUnitClick(e, u) {
  const col = Math.floor(u.x), row = Math.floor(u.y);
  const isLegalTarget = props.legalSquares.some(([lc, lr]) => lc === col && lr === row);
  if (props.dragToMove) {
    // Drag mode: let legal-target clicks bubble to handleBoardClick; block everything else.
    if (!isLegalTarget) e.stopPropagation();
    return;
  }
  if (isLegalTarget) return; // legal target: bubble to sq-click
  e.stopPropagation();
  emit('select', u.id);
}

function hpColor(frac, raw) {
  return frac > 0.5 ? raw : frac > 0.25 ? '#f2b441' : '#ff5f56';
}

function isVisible(u) {
  if (!props.fog) return true;
  // Reveal mode: pieces the viewer can see render normally; the rest are drawn as
  // translucent markers (see revealMarkerList), so hide their normal token here.
  if (props.revealAll) {
    const vis = gridFogVisibleSet.value;
    return !vis || vis.has(`${Math.floor(u.x)},${Math.floor(u.y)}`);
  }
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

// ── combat flashes ──────────────────────────────────────────────────────────────
// Sized to sit just outside a token; drawn from captured board squares (not the
// live unit list) so a fatal hit still flashes at the victim's last position.
// Shapes are drawn in array order, so later entries sit visually on top of earlier
// ones (e.g. the mountain border strips drawn after — and over — interior forest/hill
// ovals). The selected shape's outline must follow that same stacking: its own edge
// where nothing covers it, plus the covering shapes' edges where they cut into it —
// otherwise the dashed outline draws a full oval/rect that ignores the terrain actually
// visible on screen.
const selectedShapeIndex = computed(() => {
  const s = props.selectedShape;
  if (!s || !props.field.shapes) return -1;
  return props.field.shapes.findIndex(sh =>
    sh.shape === s.shape && sh.x === s.x && sh.y === s.y && sh.w === s.w && sh.h === s.h);
});
const coveringShapes = computed(() => {
  const idx = selectedShapeIndex.value;
  if (idx < 0) return [];
  const s = props.selectedShape;
  return props.field.shapes.slice(idx + 1)
    .filter(cs => s.x < cs.x + cs.w && s.x + s.w > cs.x && s.y < cs.y + cs.h && s.y + s.h > cs.y);
});

const fxList = computed(() => Object.entries(props.unitFx ?? {}).map(([id, fx]) => ({ id, ...fx })));
const fxR = computed(() => Math.max(6, props.fit.len(props.field.grid === 'square'
  ? (props.field.world.w <= 10 ? 0.42 : 0.5)
  : 2.8)));
</script>

<template>
  <div class="bf-layer" :style="{background: rdr.stage}">
    <svg ref="svgEl" width="100%" height="100%"
         :style="{ display:'block', position:'absolute', inset:0, cursor: dragUnit ? 'grabbing' : '' }"
         @click="handleBoardClick">

      <!-- Terrain: on ordinary tile-grid maps, one <rect> per cell (per-cell color from
           game toGrid; fog applied per-tile). Non-grid (shape) maps have no real tile grid
           to show — every cell shares one uniform ground color there (terrain is conveyed
           by the shapes below instead), so draw that as a single backdrop rect rather than
           a lattice of unit-cell squares. -->
      <rect v-if="field.shapes?.length && field.tiles?.length"
            :x="fit.x(0)" :y="fit.y(0)"
            :width="fit.len(field.world.w)" :height="fit.len(field.world.h)"
            :fill="tileColor(field.tiles[0])"/>
      <template v-else>
        <rect v-for="(tile, i) in (field.tiles ?? [])" :key="'t'+i"
              :x="fit.x(tile.x)" :y="fit.y(tile.y)"
              :width="fit.len(1)" :height="fit.len(1)"
              shape-rendering="crispEdges"
              :fill="tileColor(tile)"/>
        <!-- Terrain images (overlaid on color; absent when fogged) -->
        <template v-for="(tile, i) in (field.tiles ?? [])" :key="'ti'+i">
          <image v-if="tileBgImage(tile)"
                 :x="fit.x(tile.x)" :y="fit.y(tile.y)"
                 :width="fit.len(1)" :height="fit.len(1)"
                 :href="tileBgImage(tile)"
                 preserveAspectRatio="xMidYMid slice"
                 style="pointer-events:none;image-rendering:pixelated"/>
        </template>
      </template>

      <!-- Non-grid terrain: layered shapes (rectangles + ovals) drawn as the map itself.
           Emitted by a game's toGrid instead of per-tile colours (see field.shapes). -->
      <template v-for="(s, i) in (field.shapes ?? [])" :key="'shp'+i">
        <ellipse v-if="s.shape === 'oval'"
                 :cx="fit.x(s.x + s.w/2)" :cy="fit.y(s.y + s.h/2)"
                 :rx="fit.len(s.w/2)" :ry="fit.len(s.h/2)"
                 :fill="s.fill" :fill-opacity="s.opacity ?? 1"
                 :stroke="s.stroke ?? 'none'" :stroke-width="s.stroke ? 1.5 : 0"
                 style="pointer-events:none"/>
        <rect v-else
              :x="fit.x(s.x)" :y="fit.y(s.y)"
              :width="fit.len(s.w)" :height="fit.len(s.h)"
              :rx="s.round ? fit.len(0.25) : 0"
              :fill="s.fill" :fill-opacity="s.opacity ?? 1"
              :stroke="s.stroke ?? 'none'" :stroke-width="s.stroke ? 1.5 : 0"
              style="pointer-events:none"/>
        <text v-if="s.label"
              :x="fit.x(s.x + s.w/2)" :y="fit.y(s.y + s.h/2)"
              :fill="s.labelColor ?? 'rgba(255,255,255,0.85)'"
              :font-family="rdr.font" font-size="13" font-weight="700"
              text-anchor="middle" dominant-baseline="central"
              style="pointer-events:none;user-select:none">{{s.label}}</text>
      </template>

      <!-- Selected terrain shape outline (non-grid maps). Punched by any higher-layer
           shapes drawn over it (see coveringShapes) so the dashed line follows the
           actually-visible edge instead of the shape's full, possibly-covered bounds. -->
      <template v-if="selectedShape">
        <defs>
          <mask id="selShapeMask" maskUnits="userSpaceOnUse" x="-100%" y="-100%" width="300%" height="300%">
            <ellipse v-if="selectedShape.shape === 'oval'"
                     :cx="fit.x(selectedShape.x + selectedShape.w/2)" :cy="fit.y(selectedShape.y + selectedShape.h/2)"
                     :rx="fit.len(selectedShape.w/2)" :ry="fit.len(selectedShape.h/2)" fill="white"/>
            <rect v-else
                  :x="fit.x(selectedShape.x)" :y="fit.y(selectedShape.y)"
                  :width="fit.len(selectedShape.w)" :height="fit.len(selectedShape.h)" fill="white"/>
            <template v-for="(cs, ci) in coveringShapes" :key="'covm'+ci">
              <ellipse v-if="cs.shape === 'oval'"
                       :cx="fit.x(cs.x + cs.w/2)" :cy="fit.y(cs.y + cs.h/2)"
                       :rx="fit.len(cs.w/2)" :ry="fit.len(cs.h/2)" fill="black"/>
              <rect v-else
                    :x="fit.x(cs.x)" :y="fit.y(cs.y)"
                    :width="fit.len(cs.w)" :height="fit.len(cs.h)" fill="black"/>
            </template>
          </mask>
          <clipPath id="selShapeClip" clipPathUnits="userSpaceOnUse">
            <ellipse v-if="selectedShape.shape === 'oval'"
                     :cx="fit.x(selectedShape.x + selectedShape.w/2)" :cy="fit.y(selectedShape.y + selectedShape.h/2)"
                     :rx="fit.len(selectedShape.w/2)" :ry="fit.len(selectedShape.h/2)"/>
            <rect v-else
                  :x="fit.x(selectedShape.x)" :y="fit.y(selectedShape.y)"
                  :width="fit.len(selectedShape.w)" :height="fit.len(selectedShape.h)"/>
          </clipPath>
        </defs>
        <!-- The shape's own edge, hidden wherever a covering shape sits on top of it -->
        <ellipse v-if="selectedShape.shape === 'oval'"
                 :cx="fit.x(selectedShape.x + selectedShape.w/2)" :cy="fit.y(selectedShape.y + selectedShape.h/2)"
                 :rx="fit.len(selectedShape.w/2)" :ry="fit.len(selectedShape.h/2)"
                 fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="2" stroke-dasharray="4,3"
                 mask="url(#selShapeMask)" style="pointer-events:none"/>
        <rect v-else
              :x="fit.x(selectedShape.x)" :y="fit.y(selectedShape.y)"
              :width="fit.len(selectedShape.w)" :height="fit.len(selectedShape.h)"
              fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="2" stroke-dasharray="4,3"
              mask="url(#selShapeMask)" style="pointer-events:none"/>
        <!-- Each covering shape's own edge, kept only where it cuts across the selected
             shape — this is the "new" boundary the selection now traces there. -->
        <template v-for="(cs, ci) in coveringShapes" :key="'covo'+ci">
          <ellipse v-if="cs.shape === 'oval'"
                   :cx="fit.x(cs.x + cs.w/2)" :cy="fit.y(cs.y + cs.h/2)"
                   :rx="fit.len(cs.w/2)" :ry="fit.len(cs.h/2)"
                   fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="2" stroke-dasharray="4,3"
                   clip-path="url(#selShapeClip)" style="pointer-events:none"/>
          <rect v-else
                :x="fit.x(cs.x)" :y="fit.y(cs.y)"
                :width="fit.len(cs.w)" :height="fit.len(cs.h)"
                fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="2" stroke-dasharray="4,3"
                clip-path="url(#selShapeClip)" style="pointer-events:none"/>
        </template>
      </template>

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

      <!-- Square markers: user annotations on unseen squares, or (reveal mode) true piece positions -->
      <image v-for="m in displayMarkers" :key="'sm'+m.col+','+m.row"
             :x="fit.x(m.col) + fit.len(0.1)" :y="fit.y(m.row) + fit.len(0.1)"
             :width="fit.len(0.8)" :height="fit.len(0.8)"
             :href="m.img ?? markerImg(m.type)"
             opacity="0.55"
             style="pointer-events:none"/>

      <!-- Selected square highlight (used instead of a ring on the unit when ui.highlightSelectedSquare is set) -->
      <rect v-if="selectedSquare"
            :x="fit.x(selectedSquare.x)" :y="fit.y(selectedSquare.y)"
            :width="fit.len(1)" :height="fit.len(1)"
            fill="rgba(255,255,255,0.35)"
            style="pointer-events:none"/>

      <!-- Selected empty square (terrain info) -->
      <rect v-if="selectedEmptySquare"
            :x="fit.x(selectedEmptySquare.x)" :y="fit.y(selectedEmptySquare.y)"
            :width="fit.len(1)" :height="fit.len(1)"
            fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="2" stroke-dasharray="4,3"
            style="pointer-events:none"/>

      <!-- Last move highlights -->
      <rect v-for="([lc, lr], i) in lastMoveSquares" :key="'lmv'+i"
            :x="fit.x(lc)" :y="fit.y(lr)"
            :width="fit.len(1)" :height="fit.len(1)"
            fill="rgba(242,180,65,0.35)"
            style="pointer-events:none"/>

      <!-- Legal move highlights: a single radius circle on non-grid (shape) maps, or
           per-cell squares on ordinary tile-grid maps. -->
      <circle v-if="legalMoveCircle"
              :cx="fit.x(legalMoveCircle.cx)" :cy="fit.y(legalMoveCircle.cy)" :r="fit.len(legalMoveCircle.r)"
              fill="rgba(66,198,230,0.22)" stroke="rgba(66,198,230,0.7)" stroke-width="1.5"
              style="cursor:pointer"/>
      <rect v-else v-for="([lc, lr], i) in legalSquares" :key="'lm'+i"
            :x="fit.x(lc)" :y="fit.y(lr)"
            :width="fit.len(1)" :height="fit.len(1)"
            fill="rgba(66,198,230,0.28)" stroke="rgba(66,198,230,0.7)" stroke-width="1.5"
            style="cursor:pointer"/>

      <!-- Grid -->
      <template v-if="!field.ui?.hideGrid">
        <line v-for="gx in gridX" :key="'gx'+gx"
              :x1="fit.x(gx)" :y1="fit.y(0)" :x2="fit.x(gx)" :y2="fit.y(field.world.h)"
              :stroke="rdr.grid" stroke-width="1"/>
        <line v-for="gy in gridY" :key="'gy'+gy"
              :x1="fit.x(0)" :y1="fit.y(gy)" :x2="fit.x(field.world.w)" :y2="fit.y(gy)"
              :stroke="rdr.grid" stroke-width="1"/>
      </template>

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
         :style="{
           transform: `translate(${fit.x(u.x)}px, ${fit.y(u.y)}px)`,
           transition: hasMoveIntent(u) ? 'transform 0.15s ease' : 'none',
           cursor: dragToMove && !u.dead ? 'grab' : 'pointer',
           opacity: dragUnit && dragUnit.id === u.id ? 0.25 : 1,
         }"
         @click="handleUnitClick($event, u)"
         @mousedown="handleUnitMousedown($event, u)">

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
        <g v-else :class="{ 'unit-blink': u.id === blinkTargetId && field.ui?.blinkActiveUnit }">
          <!-- Active unit ring: white outer ring + inner glow ring (skipped when the game blinks the unit instead) -->
          <template v-if="u.id === activeUnitId && !field.ui?.blinkActiveUnit">
            <circle cx="0" cy="0" :r="unitR(u)+11"
                    fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="6" class="active-ring"/>
            <circle cx="0" cy="0" :r="unitR(u)+7"
                    fill="none" stroke="white" stroke-width="2" class="active-ring"/>
          </template>
          <!-- Selected unit ring: dashed ring (skipped when blinking, or when the game highlights the square instead) -->
          <circle v-if="u.id === selectedId && u.id !== activeUnitId && !(u.id === blinkTargetId && field.ui?.blinkActiveUnit) && !field.ui?.highlightSelectedSquare"
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
                   :href="teamSpriteHref(u.imagePath, u.teamObj?.raw, field.ui?.recolorTeamSprites)"
                   style="pointer-events:none;image-rendering:pixelated"/>
          </template>
          <template v-else-if="facingActive">
            <circle v-if="markerSpec(u).kind === 'circle'" cx="0" cy="0" :r="markerSpec(u).r"
                    :fill="u.id === activeUnitId ? 'white' : u.teamObj.raw" style="pointer-events:none"/>
            <template v-else-if="markerSpec(u).kind === 'ring'">
              <circle cx="0" cy="0" :r="markerSpec(u).rOuter" fill="none"
                      :stroke="u.id === activeUnitId ? 'white' : u.teamObj.raw" stroke-width="1.6"
                      style="pointer-events:none"/>
              <circle cx="0" cy="0" :r="markerSpec(u).rInner"
                      :fill="u.id === activeUnitId ? 'white' : u.teamObj.raw" style="pointer-events:none"/>
            </template>
            <polygon v-else :points="markerSpec(u).points"
                     :fill="u.id === activeUnitId ? 'white' : u.teamObj.raw" style="pointer-events:none"/>
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

      <!-- Continuous-map fog: a single semi-transparent veil with each shown unit's vision
           punched out (base terrain → shapes → units → fog). Square grids shade per-tile
           instead (fogSquares above), so this only runs for continuous maps. -->
      <FogOverlay v-if="fog && field.locationType === 'continuous'"
                  :field="field" :fit="fit" :units="units" :rdr="rdr"
                  :viewerId="viewerId" :selectedId="revealAll ? null : selectedId"/>

      <!-- Combat flashes (damage / heal numbers, action pulse) drawn above units -->
      <g v-for="fx in fxList" :key="'fx'+fx.key"
         :style="{ transform: `translate(${fit.x(fx.x)}px, ${fit.y(fx.y)}px)` }">
        <UnitFx :fx="fx" :r="fxR"/>
      </g>

      <!-- Ruler labels -->
      <template v-if="showRuler">
        <text v-for="r in rulerX" :key="'rx'+r.label"
              :x="fit.x(r.pos)" :y="xRulerY"
              :fill="rdr.ruler" font-size="8" :font-family="rdr.font" text-anchor="middle">{{r.label}}</text>
        <text v-for="r in rulerY" :key="'ry'+r.label"
              :x="fit.x(0)-6" :y="fit.y(r.pos)+3"
              :fill="rdr.ruler" font-size="8" :font-family="rdr.font" text-anchor="end">{{r.label}}</text>
      </template>

      <!-- Drag: hover square highlight (only when over a legal target) -->
      <rect v-if="dragUnit && dragHoverSq && legalSquares.some(([c,r]) => c===dragHoverSq[0] && r===dragHoverSq[1])"
            :x="fit.x(dragHoverSq[0])" :y="fit.y(dragHoverSq[1])"
            :width="fit.len(1)" :height="fit.len(1)"
            fill="rgba(66,198,230,0.55)" stroke="rgba(66,198,230,0.9)" stroke-width="2"
            style="pointer-events:none"/>

      <!-- Drag: ghost piece following cursor -->
      <g v-if="dragUnit && dragSvgPos"
         :style="{ transform: `translate(${dragSvgPos.x}px, ${dragSvgPos.y}px)` }"
         style="pointer-events:none;opacity:0.75">
        <circle v-if="!dragUnit.imagePath && unitShape(dragUnit)==='circle'"
                cx="0" cy="0" :r="unitR(dragUnit)"
                :fill="dragUnit.teamObj.raw" stroke="white" stroke-width="2"/>
        <polygon v-else-if="!dragUnit.imagePath && unitShape(dragUnit)==='triangle'"
                 :points="`0,${-unitR(dragUnit)} ${unitR(dragUnit)},${unitR(dragUnit)} ${-unitR(dragUnit)},${unitR(dragUnit)}`"
                 :fill="dragUnit.teamObj.raw" stroke="white" stroke-width="2"/>
        <rect v-else-if="!dragUnit.imagePath"
              :x="-unitR(dragUnit)" :y="-unitR(dragUnit)"
              :width="unitR(dragUnit)*2" :height="unitR(dragUnit)*2"
              :fill="dragUnit.teamObj.raw" stroke="white" stroke-width="2"/>
        <image v-if="dragUnit.imagePath"
               :x="-unitR(dragUnit)" :y="-unitR(dragUnit)"
               :width="unitR(dragUnit)*2" :height="unitR(dragUnit)*2"
               :href="dragUnit.imagePath"
               style="image-rendering:pixelated"/>
        <template v-else-if="facingActive">
          <circle v-if="markerSpec(dragUnit).kind === 'circle'" cx="0" cy="0" :r="markerSpec(dragUnit).r" fill="white"/>
          <template v-else-if="markerSpec(dragUnit).kind === 'ring'">
            <circle cx="0" cy="0" :r="markerSpec(dragUnit).rOuter" fill="none" stroke="white" stroke-width="1.6"/>
            <circle cx="0" cy="0" :r="markerSpec(dragUnit).rInner" fill="white"/>
          </template>
          <polygon v-else :points="markerSpec(dragUnit).points" fill="white"/>
        </template>
        <text v-else x="0" y="0"
              fill="white" :font-family="rdr.font"
              :font-size="unitR(dragUnit)" font-weight="800"
              text-anchor="middle" dominant-baseline="central"
              style="user-select:none">{{dragUnit.name[0].toUpperCase()}}</text>
      </g>
    </svg>

    <!-- Fog mask (radial gradient blobs, only for non-square non-chess-fog games) -->
    <div v-if="fog && !field.ui?.gridFog && field.grid !== 'square'" class="bf-layer" style="pointer-events:none;z-index:3"
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
@keyframes unit-blink {
  0%, 49%  { opacity: 1; }
  50%, 100% { opacity: 0; }
}
.unit-blink {
  animation: unit-blink 0.6s steps(1, end) infinite;
}
</style>
