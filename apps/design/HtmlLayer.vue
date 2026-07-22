<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue';
import HtmlUnit from './battlefield/HtmlUnit.vue';
import FogOverlay from './battlefield/FogOverlay.vue';
// HTML/CSS renderer for square tile grids with cell-placeable units — used automatically
// wherever it can fully draw the board (see Battlefield.vue's useHtmlRenderer). A lighter
// renderer than SchematicLayer's SVG for the common square-grid case; boards it can't draw
// (positioned units, vision cones, shapes, hex) fall to SVG. There is no user toggle.
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
// aiming overlays and full multi-layer sprite composites (only a spriteLayers `text`
// glyph is read, for the unit's marker label — see HtmlUnit's unitLabel). Continuous-map
// radial fog is covered: FogOverlay (an SVG component built for SchematicLayer) is
// dropped in as a borderless overlay using this renderer's own px/py/plen as its `fit`.
// Globals (window.*) come from data.js / vision.js / teamSprite.js,
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
  showHpBars:   { type: Boolean, default: true },
  rdr:          Object,
  legalSquares:    { type: Array, default: () => [] },
  lastMoveSquares: { type: Array, default: () => [] },
  dragToMove:      { type: Boolean, default: false },
  revealAll:       { type: Boolean, default: false },
  viewerTeam:      { type: String, default: null },
  // An observer watching through one player's eyes: fog is cast from this team
  // instead of the local player (teams[0]). null = default/local perspective.
  viewerOverride:  { type: String, default: null },
  selectedEmptySquare: { type: Object, default: null },
  // Persistent-vision games (field.ui.persistentFog, e.g. civ1): every "x,y" tile any of
  // the viewer's units has EVER seen this game (see Battlefield.vue's exploredTileSet).
  // Null when the game doesn't remember terrain, so tiles re-fog every turn as before.
  exploredTiles:   { type: Set, default: null },
  aiming:          { type: Object, default: null },
  // Zoom/pan overrides (the `mapZoom` game option, driven from Battlefield): tile size in
  // screen px, and the world point to hold at the middle of the stage. Null = fit + centre.
  zoomPx:          { type: Number, default: null },
  center:          { type: Object, default: null },
  // Analysis-panel move suggestions (Battlefield.vue's suggestionArrows): ranked
  // [{ from: [col,row], to: [col,row], rank, hovered }], drawn as chess.com-style
  // arrows between cell centres — see AnalysisPanel.vue.
  suggestionArrows: { type: Array, default: () => [] },
});
const emit = defineEmits(['select', 'sq-click', 'set-marker']);
const imgSrc   = window.api.imgSrc;
const basePath = window.api.basePath;
const VISION   = window.VISION;

const W = computed(() => props.field.world.w);
const H = computed(() => props.field.world.h);
// A horizontally-wrapping map (civ1 — see Civ1Game.toGrid) has no real east/west edge, so
// once panning brings the seam into view this renders extra copies of the columns nearest
// it on both sides (wrapPad below) instead of leaving blank stage past column 0 / W-1.
const wrap = computed(() => !!props.field.world.wrap);
// Continuously-positioned units (field.positioned, e.g. csmini): NOT filed into a grid
// cell — drawn as absolutely-placed HTML tokens at their exact point (see absUnits), so
// they sit and slide anywhere on the grid, with facing shown via CSS rotate.
const positioned = computed(() => !!props.field.positioned);
const showFacing = computed(() => props.field.ui?.showFacing === true && (!props.fog || props.revealAll));

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
// A zoomPx override is rounded rather than floored (it's a chosen size, not a fit), keeping
// the integer-cell invariant this renderer is built on either way.
const cellPx  = computed(() => props.zoomPx
  ? Math.max(1, Math.round(props.zoomPx))
  : Math.max(1, Math.floor(Math.min(
      (boxW.value - PAD * 2) / W.value,
      (boxH.value - PAD * 2) / H.value))));
const boardW  = computed(() => cellPx.value * W.value);
const boardH  = computed(() => cellPx.value * H.value);
// Panned: hold props.center at the middle of the box. Otherwise centre the whole board.
const originX = computed(() => props.center
  ? Math.round(boxW.value / 2 - props.center.x * cellPx.value)
  : Math.round((boxW.value - boardW.value) / 2));
const originY = computed(() => props.center
  ? Math.round(boxH.value / 2 - props.center.y * cellPx.value)
  : Math.round((boxH.value - boardH.value) / 2));

// world → screen. Cell-aligned inputs land on exact integers by construction. These stay
// defined purely in terms of world x (not the padded render columns wrapPad adds below),
// so every other consumer (units, arrows, rulers, drag hit-testing) keeps working unchanged.
function px(wx)   { return originX.value + wx * cellPx.value; }
function py(wy)   { return originY.value + wy * cellPx.value; }
function plen(wl) { return wl * cellPx.value; }

// How many extra columns of wrap must be drawn past column 0 / W-1 to cover whatever the
// stage currently shows there — derived from how far the visible screen range actually
// reaches past the map's true edge, so it's 0 whenever the seam isn't in view (including
// non-wrapping games and the initial fitted, uncentred view). Capped so duplicate copies
// can never overlap the primary one on a very narrow map at extreme zoom-out.
const wrapPad = computed(() => {
  if (!wrap.value || !props.center || !cellPx.value) return 0;
  const leftWorldX  = (0 - originX.value) / cellPx.value;
  const rightWorldX = (boxW.value - originX.value) / cellPx.value;
  const pad = Math.max(0, Math.ceil(-leftWorldX), Math.ceil(rightWorldX - W.value));
  return Math.min(pad, Math.floor((W.value - 1) / 2));
});

const boardStyle = computed(() => {
  const pad = wrapPad.value;
  return {
    position: 'absolute',
    left: px(-pad) + 'px', top: originY.value + 'px',
    width: plen(W.value + pad * 2) + 'px', height: boardH.value + 'px',
    display: 'grid',
    gridTemplateColumns: `repeat(${W.value + pad * 2}, ${cellPx.value}px)`,
    gridTemplateRows:    `repeat(${H.value}, ${cellPx.value}px)`,
  };
});

const highlightUnitId = computed(() => props.activeUnitId);
const blinkTargetId   = computed(() => props.field.ui?.freeSelection ? props.selectedId : props.activeUnitId);

// Team whose pieces project vision — the human (teams[0]); in reveal mode whoever is to
// move at the displayed ply, so fog flips as you step through. Mirrors SchematicLayer.
const viewerId = computed(() => props.revealAll
  ? props.viewerTeam
  : (props.viewerOverride ?? props.field.teams?.[0]?.id ?? null));
const viewerIsBlack = computed(() => viewerId.value === props.field.teams?.[1]?.id);

// ── fog of war ────────────────────────────────────────────────────────────────
// Two square-grid fog styles, mirroring SchematicLayer:
//  • gridFog (chess): per-piece reach; hidden cells get a translucent veil on top.
//  • vision fog (tactical etc., via VISION): hidden tiles are painted with the fog colour
//    and their terrain art withheld — no separate veil.
const gridFogVisibleSet = computed(() => {
  // Reveal mode shows the true board with no fog shading at all.
  if (!props.fog || !props.field.ui?.gridFog || props.revealAll) return null;
  // Prefer the server's authoritative set (the filtered client board strips hidden
  // blockers and can't reproduce it).
  if (props.field.fogVisible) return props.field.fogVisible;
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
  if (props.revealAll) return null; // reveal mode: no fog shading at all
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

// Continuous-map fog (see FogOverlay.vue): a single veil with each visible unit's vision
// region punched out, drawn in an SVG dropped on top of the board. It needs a `fit`
// (world → screen) — this renderer's own px/py/plen already are one, in the same
// integer-snapped coordinate space every other absolutely-positioned layer here uses.
const continuousFogOn = computed(() => props.fog && props.field.locationType === 'continuous' && !props.revealAll);
const fit = { x: px, y: py, len: plen };

function isFogSquare(col, row) {
  if (gridFogVisibleSet.value)   return !gridFogVisibleSet.value.has(`${col},${row}`);
  if (squareFogVisibleSet.value) {
    const key = `${col},${row}`;
    if (squareFogVisibleSet.value.has(key)) return false;
    return !(props.exploredTiles?.has(key));
  }
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
// Reveal mode shows every piece at its true position directly (no fog, see isVisible), so
// no markers are needed there.
const displayMarkers = computed(() => props.revealAll ? [] : squareMarkerList.value);

// ── per-unit presentation ─────────────────────────────────────────────────────
function isVisible(u) {
  if (!props.fog || props.revealAll) return true; // reveal mode: every piece shown, no fog
  if (u.friendly) return true;
  if (gridFogVisibleSet.value) return gridFogVisibleSet.value.has(`${Math.floor(u.x)},${Math.floor(u.y)}`);
  return u.visible;
}

function unitR(u) {
  const mult = W.value <= 10 ? 0.36 : 0.42;
  // Bare sprites have no stroke eating into them, so let them fill more of the cell.
  return Math.max(5, (u?.imagePath ? mult * 1.25 : mult) * cellPx.value);
}
// Continuous-space games default to a circle marker (matching SchematicLayer's SVG
// renderer); grid games keep the classic square unless the game overrides it per type.
function unitShape(u) {
  return props.field.ui?.unitShapes?.[u.type]
    ?? (props.field.locationType === 'continuous' ? 'circle' : 'square');
}
// A playback tween's sub-cell shift, converted from tiles to pixels at the current
// zoom. Null for every unit that isn't mid-slide, which is all of them outside
// history playback — HtmlUnit then adds no transform at all.
function unitTween(u) {
  if (!u.tweenDx && !u.tweenDy) return null;
  return { dx: (u.tweenDx ?? 0) * cellPx.value, dy: (u.tweenDy ?? 0) * cellPx.value };
}

// Under vision fog a hidden tile is painted with the fog colour and its art withheld.
// Persistent-vision games (see exploredTiles prop, e.g. civ1) remember any tile ever
// seen — only units/cities re-fog when out of current sight (handled server-side).
function tileFogged(tile) {
  if (!squareFogVisibleSet.value) return false;
  const key = `${tile.x},${tile.y}`;
  if (squareFogVisibleSet.value.has(key)) return false;
  return !(props.exploredTiles?.has(key));
}

// Sprites drawn on top of the terrain, each transparent except for the feature itself.
// `overlayImage` may be a single path or a list painted in order — civ1 stacks a river
// plus one segment per road direction (see SchematicLayer's tileOverlayImages).
function tileOverlays(tile) {
  if (!tile || !tile.overlayImage || tileFogged(tile)) return [];
  const list = Array.isArray(tile.overlayImage) ? tile.overlayImage : [tile.overlayImage];
  return list.map(imgSrc);
}

// ── cells: one entry per board square, in row-major order for grid auto-placement ──
// Games that already colour their tiles as a checkerboard (chess) opt out — the synthetic
// darken-the-odd-squares overlay would just double-darken them (mirrors SchematicLayer).
const checkerOn = computed(() => !props.field.ui?.ownTileColors && W.value <= 10);
const cells = computed(() => {
  const tiles = new Map();
  for (const t of props.field.tiles ?? []) tiles.set(`${t.x},${t.y}`, t);
  const unitsAt = new Map();
  // Positioned games draw their units in the absolute overlay (absUnits), not in cells.
  if (!positioned.value) for (const u of props.units) {
    if (!isVisible(u)) continue;
    // baseX/baseY when a playback tween is sliding this unit: it stays filed under
    // the square it left until it arrives, so the cell it renders in doesn't flip
    // mid-slide (see Battlefield's renderUnits).
    const k = `${Math.floor(u.baseX ?? u.x)},${Math.floor(u.baseY ?? u.y)}`;
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
  const pad = wrapPad.value;
  for (let y = 0; y < H.value; y++) {
    for (let rx = -pad; rx < W.value + pad; rx++) {
      // rx is the render column (may fall outside [0, W) in the duplicated fringe); x is
      // its true world column, wrapped back into range, used for every data lookup below
      // and emitted on click — rx only ever drives this cell's screen/grid position.
      const x = pad ? ((rx % W.value) + W.value) % W.value : rx;
      const k = `${x},${y}`;
      const tile = tiles.get(k) ?? null;
      out.push({
        rk: `${rx},${y}`, k, x, y,
        color:   tile ? (tileFogged(tile) ? props.rdr.fogA : tile.color) : null,
        // Painted in SchematicLayer's order: flat colour, then the coastline tile, then
        // terrain art, then any overlays stacked on top.
        coast:   (tile && !tileFogged(tile) && tile.coastSprite) ? imgSrc(tile.coastSprite.image) : null,
        bg:      (tile && !tileFogged(tile) && tile.bgImage)     ? imgSrc(tile.bgImage)           : null,
        overlays: tileOverlays(tile),
        fogged:  !!gridFogVisibleSet.value && !gridFogVisibleSet.value.has(k),
        vision:  !!vis && vis.has(k),
        marker:  markers.get(k) ?? null,
        units:   unitsAt.get(k) ?? [],
        checker: checkerOn.value && (rx + y) % 2 === 1,
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

// Absolute-overlay units for positioned games (see `positioned`): each placed at its
// exact pixel point (px/py of its continuous x/y — which already carries any playback
// slide), sized like a cell unit, with the facing angle for the CSS-rotated arrow.
const absUnits = computed(() => {
  if (!positioned.value) return [];
  return props.units.filter(isVisible).map(u => ({
    u, r: unitR(u), left: px(u.x), top: py(u.y),
    facingDeg: (u.ang ?? 0) * 180 / Math.PI,
  }));
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
  const pad = wrapPad.value;
  const xs = [], ys = [];
  for (let x = -pad; x <= W.value + pad; x++) xs.push(x);
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

// Analysis suggestion arrows: lichess-style thick shafts with a triangular
// head, scaled to the board's cell size. Between two cell CENTRES (+0.5)
// since these aren't tied to a unit's actual sub-cell position. The shaft
// (a rotated zero-height div, same trick as the movement intent arrow above)
// is shortened by the head's length so it ends at the head's base rather
// than poking out past its point; the head is a CSS border-triangle rotated
// around its own tip (transform-origin 100% 50%) so that tip lands exactly
// on the destination cell centre regardless of angle.
const suggestionArrowGeom = computed(() => props.suggestionArrows.map(a => {
  const fx = a.from[0] + 0.5, fy = a.from[1] + 0.5;
  const tx = a.to[0] + 0.5, ty = a.to[1] + 0.5;
  const fullLen  = Math.hypot(plen(tx - fx), plen(ty - fy));
  const rotDeg   = Math.atan2(ty - fy, tx - fx) * 180 / Math.PI;
  const thick    = Math.max(4, cellPx.value * (a.rank === 1 ? 0.16 : 0.11));
  const headLen  = Math.max(9, cellPx.value * (a.rank === 1 ? 0.34 : 0.26));
  const headHalf = headLen * 0.62;
  return {
    key: `${a.from.join(',')}-${a.to.join(',')}-${a.rank}`,
    rank: a.rank, hovered: a.hovered,
    shaftLeft: px(fx), shaftTop: py(fy), rotDeg,
    shaftLen: Math.max(0, fullLen - headLen * 0.7), thick,
    tipX: px(tx), tipY: py(ty), headLen, headHalf,
  };
}));

// ── queued move waypoints (the generic goto-queue mechanic, games/moveQueue.js) ──
// Shown for every unit (not just the selected one) so a plan stays visible on the
// board turn to turn — a dashed segment per hop plus a numbered dot at each stop,
// chained from the unit's current square through its queue in order. On by default
// (ui.moveQueue !== false); a game can opt out if it reuses `queue` for something else.
const moveQueueOn = computed(() => props.field.ui?.moveQueue !== false);
const queueSegments = computed(() => {
  if (!moveQueueOn.value) return [];
  const segs = [];
  for (const u of props.units) {
    if (u.dead || !u.queue?.length || !isVisible(u)) continue;
    let prev = { x: u.x, y: u.y };
    u.queue.forEach((wp, i) => {
      const cur = { x: wp.x + 0.5, y: wp.y + 0.5 };
      segs.push({ key: `${u.id}-${i}`, from: prev, to: cur, color: u.teamObj?.raw ?? '#fff' });
      prev = cur;
    });
  }
  return segs;
});
const queueDots = computed(() => {
  if (!moveQueueOn.value) return [];
  const dots = [];
  for (const u of props.units) {
    if (u.dead || !u.queue?.length || !isVisible(u)) continue;
    u.queue.forEach((wp, i) => {
      dots.push({ key: `${u.id}-${i}`, x: wp.x + 0.5, y: wp.y + 0.5, n: i + 1, color: u.teamObj?.raw ?? '#fff' });
    });
  }
  return dots;
});

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
  let col = Math.floor((x - originX.value) / cellPx.value);
  const row = Math.floor((y - originY.value) / cellPx.value);
  // Over the duplicated fringe near the seam, the raw column falls outside [0, W) — wrap
  // it back to the true column the same way the cells it's hovering were looked up.
  if (wrap.value) col = ((col % W.value) + W.value) % W.value;
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
      <div v-for="c in cells" :key="c.rk" class="hl-cell"
           :style="{ background: c.color }"
           @click.stop="handleCellClick(c)">
        <!-- Coastline tile (civ1 oceans) under the terrain art, then any stacked overlays -->
        <img v-if="c.coast" class="hl-fill hl-pixel hl-cover" :src="c.coast" draggable="false"/>
        <img v-if="c.bg"    class="hl-fill hl-pixel hl-cover" :src="c.bg" draggable="false"/>
        <img v-for="(ov, oi) in c.overlays" :key="'ov'+oi"
             class="hl-fill hl-pixel hl-cover" :src="ov" draggable="false"/>
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
          :tween="unitTween(u)"
          :showHp="showHpBars"
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

    <!-- Positioned units (field.positioned, e.g. csmini): absolutely-placed HTML tokens at
         their exact continuous point — which already carries any playback slide — each with
         a CSS-rotated facing arrow. The token itself is the same HtmlUnit as the cell games. -->
    <template v-if="positioned">
      <div v-for="a in absUnits" :key="a.u.id" class="hl-abs-unit"
           :style="{ left: a.left+'px', top: a.top+'px', color: a.u.teamObj?.raw }">
        <div v-if="showFacing && !a.u.dead" class="hl-facing" :style="{ transform: 'rotate('+a.facingDeg+'deg)' }">
          <span class="hl-facing-tri"
                :style="{ left: (a.r*0.85)+'px', borderWidth: (a.r*0.34)+'px 0 '+(a.r*0.34)+'px '+(a.r*0.6)+'px' }"/>
        </div>
        <div class="hl-abs-token">
          <HtmlUnit :unit="a.u" :r="a.r" :rdr="rdr" :shape="unitShape(a.u)"
            :showHp="showHpBars" :recolor="field.ui?.recolorTeamSprites"
            :active="a.u.id === highlightUnitId && !field.ui?.blinkActiveUnit"
            :selected="a.u.id === selectedId"
            :hovered="a.u.id === hoveredId"
            :blink="a.u.id === blinkTargetId && !!field.ui?.blinkActiveUnit"
            @click="handleUnitClick($event, a.u)"/>
        </div>
      </div>
    </template>

    <!-- Continuous-map fog veil, drawn over the board+units (see continuousFogOn above) -->
    <svg v-if="continuousFogOn" class="hl-noevents" :width="boxW" :height="boxH"
         style="position: absolute; inset: 0;">
      <FogOverlay :field="field" :fit="fit" :units="units" :rdr="rdr"
                  :viewerId="viewerId" :selectedId="selectedId"/>
    </svg>

    <!-- Drag ghost: follows the cursor, so it's the one element that can't be a grid cell.
         The inner grid lets HtmlUnit's place-self:center work outside the board lattice. -->
    <div v-if="dragUnit && dragPos" class="hl-ghost"
         :style="{ left: dragPos.x+'px', top: dragPos.y+'px' }">
      <HtmlUnit :unit="dragUnit" :r="unitR(dragUnit)" :rdr="rdr" :shape="unitShape(dragUnit)"
        :showHp="false"
        :recolor="field.ui?.recolorTeamSprites"/>
    </div>

    <!-- Grid lines -->
    <template v-if="!field.ui?.hideGridLines">
      <div v-for="gx in gridLines.xs" :key="'gx'+gx" class="hl-noevents"
           :style="{ position:'absolute', left: px(gx)+'px', top: py(0)+'px',
                     width:'1px', height: boardH+'px', background: rdr.grid }"/>
      <div v-for="gy in gridLines.ys" :key="'gy'+gy" class="hl-noevents"
           :style="{ position:'absolute', left: px(-wrapPad)+'px', top: py(gy)+'px',
                     width: plen(W + wrapPad*2)+'px', height:'1px', background: rdr.grid }"/>
    </template>

    <!-- Boundary: a wrapping map has no real east/west edge, so once the duplicated
         fringe (wrapPad) is showing, only the top/bottom edges are drawn — a left/right
         border would just be a stray line through the middle of seamless terrain. -->
    <div v-if="!wrapPad" class="hl-noevents" :style="{ ...rect(0, 0, W, H), border: '1.5px solid ' + rdr.bound }"/>
    <template v-else>
      <div class="hl-noevents" :style="{ position:'absolute', left: px(-wrapPad)+'px', top: py(0)+'px', width: plen(W + wrapPad*2)+'px', height:'1.5px', background: rdr.bound }"/>
      <div class="hl-noevents" :style="{ position:'absolute', left: px(-wrapPad)+'px', top: (py(H)-1.5)+'px', width: plen(W + wrapPad*2)+'px', height:'1.5px', background: rdr.bound }"/>
    </template>

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

    <!-- Analysis suggestion arrows (AnalysisPanel.vue): ranked candidate moves,
         rank 1 drawn thicker/brighter, the hovered candidate emphasised. Shaft
         + triangular head, lichess-style (see suggestionArrowGeom above). -->
    <template v-for="a in suggestionArrowGeom" :key="'sg'+a.key">
      <div class="hl-noevents hl-suggest" :class="{ 'hl-suggest--top': a.rank === 1, 'hl-suggest--hovered': a.hovered }"
           :style="{
             position:'absolute', left: a.shaftLeft+'px', top: a.shaftTop+'px',
             width: a.shaftLen+'px', height: a.thick+'px', marginTop: (-a.thick/2)+'px',
             transform: `rotate(${a.rotDeg}deg)`, transformOrigin: '0 50%',
           }"/>
      <div class="hl-noevents hl-suggest-head" :class="{ 'hl-suggest--top': a.rank === 1, 'hl-suggest--hovered': a.hovered }"
           :style="{
             position:'absolute', left: (a.tipX - a.headLen)+'px', top: (a.tipY - a.headHalf)+'px',
             borderWidth: a.headHalf+'px '+0+' '+a.headHalf+'px '+a.headLen+'px',
             transform: `rotate(${a.rotDeg}deg)`, transformOrigin: (a.headLen)+'px '+a.headHalf+'px',
           }"/>
    </template>

    <!-- Queued move waypoints (civ1 goto orders): dashed hop + numbered stop, per unit -->
    <template v-for="seg in queueSegments" :key="'q'+seg.key">
      <div class="hl-noevents hl-queue-line"
           :style="{
             position:'absolute', left: px(seg.from.x)+'px', top: py(seg.from.y)+'px',
             width: Math.hypot(plen(seg.to.x - seg.from.x), plen(seg.to.y - seg.from.y))+'px',
             transform: `rotate(${Math.atan2(seg.to.y - seg.from.y, seg.to.x - seg.from.x)}rad)`,
             transformOrigin: '0 50%',
             borderTop: '1.4px dashed ' + seg.color,
           }"/>
    </template>
    <div v-for="dot in queueDots" :key="'qd'+dot.key" class="hl-noevents hl-queue-dot"
         :style="{ left: px(dot.x)+'px', top: py(dot.y)+'px', borderColor: dot.color, color: dot.color }">
      {{dot.n}}
    </div>

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

/* Positioned units (field.positioned): a zero-size anchor at the unit's exact pixel point,
   with the token centred on it and a facing arrow rotated around it. */
.hl-abs-unit { position: absolute; width: 0; height: 0; z-index: 2; }
.hl-abs-token { position: absolute; left: 0; top: 0; transform: translate(-50%, -50%); }
.hl-facing { position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none; }
/* A right-pointing CSS triangle (colored left border, transparent top/bottom); the parent's
   rotate() aims it along the unit's facing. Vertically centred on the anchor point. */
.hl-facing-tri { position: absolute; top: 0; transform: translateY(-50%);
  width: 0; height: 0; border-style: solid;
  border-color: transparent transparent transparent currentColor; }
.hl-pixel { image-rendering: pixelated; }
.hl-cover { object-fit: cover; }

/* Each cell is its own single-track grid, so every layer (terrain, fog, highlights, unit)
   is placed in the same track and spans the cell by default — no absolute positioning or
   inset needed. Overflow stays visible: unit rings/HP bars intentionally spill outwards. */
.hl-cell { display: grid; cursor: pointer; }
.hl-cell > * { grid-area: 1 / 1; }
.hl-fill { pointer-events: none; }
/* Images must be sized explicitly rather than left to the grid's default `stretch`:
   per CSS Box Alignment, stretch behaves as `start` for a replaced element with an
   intrinsic aspect ratio, so an <img> draws at its native size instead of filling the
   cell. Every browser does this. It's easy to miss because civ1's tiles are 16px and a
   fitted board often lands near that — the art only looks obviously wrong once the cell
   grows past the sprite (a big window, or zoomed in). */
img.hl-fill { display: block; width: 100%; height: 100%; }

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
/* Lichess-style suggestion arrow: a thick coloured shaft (a solid block, its
   height set inline per-arrow) plus a CSS border-triangle head (see
   suggestionArrowGeom's comment in the script for the geometry). Both pieces
   share one colour/opacity via border-color/background so rank/hover
   styling only needs to be set in one place per variant below. */
.hl-suggest { background: rgba(66,198,230,0.55); border-radius: 2px; opacity: 0.85; }
.hl-suggest-head { width: 0; height: 0; border-style: solid; border-color: transparent transparent transparent rgba(66,198,230,0.55); opacity: 0.85; }
.hl-suggest--top { background: rgba(66,198,230,0.85); opacity: 1; }
.hl-suggest-head.hl-suggest--top { border-left-color: rgba(66,198,230,0.85); background: none; opacity: 1; }
.hl-suggest--hovered { background: rgba(242,180,65,0.95); opacity: 1; }
.hl-suggest-head.hl-suggest--hovered { border-left-color: rgba(242,180,65,0.95); background: none; opacity: 1; }
.hl-queue-line { height: 0; opacity: 0.85; }
.hl-queue-dot {
  position: absolute; transform: translate(-50%, -50%);
  width: 14px; height: 14px; border-radius: 50%; border: 1.4px solid;
  background: rgba(10,12,16,0.65);
  display: flex; align-items: center; justify-content: center;
  font-size: 8px; font-weight: 700; font-family: var(--mono);
}
.hl-ruler { position: absolute; font-size: 8px; white-space: nowrap; }
</style>
