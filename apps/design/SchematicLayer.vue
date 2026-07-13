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
  // Territory-wide flash keyed by territoryId (see App.vue's territoryFx): every
  // hex belonging to the territory flashes white and fades, instead of a single
  // circle on its capital hex — used by kdice's attack animation.
  territoryFx:  { type: Object, default: () => ({}) },
  selectedId:   String,
  hoveredId:    { type: String, default: null },
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
  // Set while the player is aiming a "button → pick a spot on the map" action (see
  // Battlefield.vue) — replaces the normal legal-move highlight with a same-shape
  // reach arc at `aiming.range`, plus a throw's blast-radius preview or a shoot's
  // aim ray, both following the cursor.
  aiming: { type: Object, default: null },
});
const emit = defineEmits(['select', 'sq-click', 'set-marker']);
const imgSrc = window.api.imgSrc;

// Team whose pieces project vision. Normally the human (teams[0]); in reveal mode it
// follows whoever is to move at the displayed ply, so fog flips as you step through.
const viewerId = computed(() => props.revealAll
  ? props.viewerTeam
  : (props.field.teams?.[0]?.id ?? null));
const viewerIsBlack = computed(() => viewerId.value === props.field.teams?.[1]?.id);

// Which unit should blink when `ui.blinkActiveUnit` is set. In free-selection games
// (e.g. civ1) there's no turn-scoped activeUnitId, so blink whichever unit is clicked.
const blinkTargetId = computed(() => props.field.ui?.freeSelection ? props.selectedId : props.activeUnitId);

// While aiming a button-picked action (CS lists every unit's actions at once, so the
// clicked "Move…"/"Shoot…" button may belong to a unit other than activeUnitId — see
// aimUnit below), the glow/fill highlight should follow the unit actually being aimed,
// not whichever was last selected.
const highlightUnitId = computed(() => props.aiming?.unitId ?? props.activeUnitId);

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
// A continuous straight-line slide can only reach points on an unobstructed straight
// line, so on maps with wall blockers (field.los) the reachable area is the exact
// wall-occluded region (VISION.reachRegion), not a plain circle bleeding through walls —
// same geometry as omnidirectional vision. Returns a region descriptor ('circle' or
// 'polyarc'); the template draws a <circle> or a <path> accordingly.
// Games that list 'move' in field.ui.aimedActionTypes (CS) drive movement through the
// explicit "Move…" button + aiming overlay below instead of an always-on ambient
// circle — the ambient one would make the map look clickable-to-move even before
// the player has picked the Move action.
const legalMoveCircle = computed(() => {
  if (props.field.locationType !== 'continuous' || !props.legalSquares.length) return null;
  if (props.field.ui?.aimedActionTypes?.includes('move')) return null;
  const u = props.units.find(u => u.id === props.selectedId);
  if (!u) return null;
  let r = u.moveRange;
  if (r == null) {
    r = 0;
    for (const [lc, lr] of props.legalSquares)
      r = Math.max(r, Math.hypot((lc + 0.5) - u.x, (lr + 0.5) - u.y));
  }
  return VISION.reachRegion(props.field, u.x, u.y, r);
});
const legalMovePathD = computed(() =>
  legalMoveCircle.value && legalMoveCircle.value.kind !== 'circle'
    ? VISION.regionPath(legalMoveCircle.value, props.fit) : null);

// ── aiming overlay (throw/shoot: pick a button, then a spot on the map) ──────────
// Keyed by aiming.unitId, not selectedId — a squad game (CS) can list every
// not-yet-acted unit's actions together, so the aimed button's owner isn't
// necessarily the currently-selected unit (see Battlefield.vue's startAim).
const aimUnit = computed(() => props.aiming ? props.units.find(u => u.id === props.aiming.unitId) : null);

// Same reach-region geometry as legalMoveCircle (wall-occluded arc, not a plain
// circle bleeding through walls), just at the aimed action's own range.
const aimRegion = computed(() => {
  if (!aimUnit.value || props.aiming?.range == null) return null;
  return VISION.reachRegion(props.field, aimUnit.value.x, aimUnit.value.y, props.aiming.range);
});
const aimRegionPathD = computed(() =>
  aimRegion.value && aimRegion.value.kind !== 'circle' ? VISION.regionPath(aimRegion.value, props.fit) : null);

// Cursor position in world coordinates while aiming (null off-board or not aiming).
const hoverWorld = ref(null);
function handleBoardMouseMove(e) {
  if (!props.aiming) return;
  const rect = e.currentTarget.getBoundingClientRect();
  hoverWorld.value = {
    x: (e.clientX - rect.left - props.fit.x(0)) / props.fit.s,
    y: (e.clientY - rect.top  - props.fit.y(0)) / props.fit.s,
  };
}
function handleBoardMouseLeave() { hoverWorld.value = null; }

// Shoot's aim ray, clipped to the weapon's range so it reads as the actual reach
// rather than an arbitrary line to the cursor. Rotate reuses this (no `range` on a
// rotate aiming object, so the ray always runs the full distance to the cursor —
// facing has no reach limit).
//
// A shoot with no `range` at all (see DoomGame.js) has no max distance — the real
// shot travels in a straight line until it hits a wall or a unit, so the preview
// should too: extend the ray past the cursor to whichever comes first, instead of
// stopping exactly at the clicked point (a location has no special meaning here,
// only the bearing does).
const shootRayEnd = computed(() => {
  if (!['shoot', 'rotate', 'punch'].includes(props.aiming?.type) || !aimUnit.value || !hoverWorld.value) return null;
  const u = aimUnit.value, h = hoverWorld.value;
  const dx = h.x - u.x, dy = h.y - u.y;
  const dist = Math.hypot(dx, dy);
  if (!dist) return h;
  const range = props.aiming.range;
  if (range != null) {
    if (dist <= range) return h;
    const t = range / dist;
    return { x: u.x + dx * t, y: u.y + dy * t };
  }
  if (props.aiming.type !== 'shoot') return h;

  const dirx = dx / dist, diry = dy / dist;
  const ang  = Math.atan2(dy, dx);
  const BIG  = 2 * Math.max(props.field.world?.w ?? 0, props.field.world?.h ?? 0, dist);
  const los  = props.field.los;
  let wallDist = BIG;
  if (los?.openShapes)       wallDist = VISION._internal.shapeExit(u.x, u.y, ang, los.openShapes,  BIG, 'open' )?.dist ?? BIG;
  else if (los?.blockShapes) wallDist = VISION._internal.shapeExit(u.x, u.y, ang, los.blockShapes, BIG, 'block')?.dist ?? BIG;

  const HIT_RADIUS = 0.6;
  let unitDist = BIG;
  for (const other of props.units) {
    if (other.dead || other.id === u.id) continue;
    const along = (other.x - u.x) * dirx + (other.y - u.y) * diry;
    if (along < 0 || along >= unitDist) continue;
    const px = u.x + dirx * along, py = u.y + diry * along;
    if (Math.hypot(other.x - px, other.y - py) > HIT_RADIUS) continue;
    unitDist = along;
  }

  const stop = Math.min(wallDist, unitDist);
  return { x: u.x + dirx * stop, y: u.y + diry * stop };
});

// Per-unit outcome preview while aiming — a small "-NN" / "BLIND" badge over each
// unit the current cursor position would hit, using whatever damage/blind info the
// game attached to the aimed action (see CsGame.js's grenadePreview/shoot damage
// fields) and each unit's own damageReduction. Approximate — e.g. it ignores LOS for
// a flashbang's blind check — the server re-checks everything for real at apply time.
const aimPreviewList = computed(() => {
  if (!props.aiming || !hoverWorld.value) return [];
  const dmgAgainst = (u, raw) => Math.round(raw * (1 - (u.damageReduction ?? 0)));

  if (props.aiming.type === 'throw') {
    const { previewKind, damage, blastRadius } = props.aiming;
    if (!previewKind || previewKind === 'none') return [];
    const h = hoverWorld.value;
    const out = [];
    for (const u of props.units) {
      if (u.dead || Math.hypot(u.x - h.x, u.y - h.y) > (blastRadius ?? 0)) continue;
      if (previewKind === 'blind') {
        if (u.friendly) continue; // a flashbang only blinds enemies (see applyActions)
        out.push({ id: u.id, x: u.x, y: u.y, text: 'BLIND' });
      } else if (previewKind === 'damage') {
        out.push({ id: u.id, x: u.x, y: u.y, text: `-${dmgAgainst(u, damage)}` });
      }
    }
    return out;
  }

  if (props.aiming.type === 'shoot' && aimUnit.value) {
    const u = aimUnit.value, h = hoverWorld.value;
    const candidates = props.aiming.candidates
      .map(c => { const t = props.units.find(un => un.id === c.targetId); return t && { ...c, x: t.x, y: t.y, damageReduction: t.damageReduction }; })
      .filter(Boolean);
    const target = VISION.nearestBearing(u.x, u.y, h.x, h.y, candidates);
    if (!target) return [];
    const pct = target.accuracy != null ? ` (${Math.round(target.accuracy * 100)}%)` : '';
    return [{ id: target.targetId, x: target.x, y: target.y, text: `-${dmgAgainst(target, target.damage ?? 0)}${pct}` }];
  }

  // Punch's blast always lands at the fixed clipped ray endpoint (shootRayEnd), not
  // the raw cursor — same "-NN" preview as a thrown grenade, just at that fixed spot.
  if (props.aiming.type === 'punch' && shootRayEnd.value) {
    const c = shootRayEnd.value;
    const out = [];
    for (const u of props.units) {
      if (u.dead || Math.hypot(u.x - c.x, u.y - c.y) > (props.aiming.blastRadius ?? 0)) continue;
      out.push({ id: u.id, x: u.x, y: u.y, text: `-${dmgAgainst(u, props.aiming.damage ?? 0)}` });
    }
    return out;
  }

  return [];
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
  const mult = props.field.grid === 'square' ? (props.field.world.w <= 10 ? 0.36 : 0.42)
    : props.field.grid === 'hexagon' ? (props.field.hexSize ?? 1) * 0.55
    : 2.4;
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
// full disc (no facing) or a heading-limited cone (see vision.js). Always the whole
// player's vision (the union of all their units) — selection never narrows it, it only
// adds a highlight (see selectedVisionTileSet below). Continuous maps have no tiles to
// shade — they use FogOverlay instead.
const squareFogVisibleSet = computed(() => {
  if (!props.fog || props.field.ui?.gridFog || props.field.grid !== 'square') return null;
  if (props.field.locationType === 'continuous') return null;
  return VISION.visibleTileSet(props.field, VISION.visionSources(props.units, viewerId.value, null));
});

// Tiles seen by the selected unit specifically — rendered as a highlight outline on top
// of the base fog shading so a player can tell what THAT unit sees within team vision.
const selectedVisionTileSet = computed(() => {
  if (!squareFogVisibleSet.value) return null;
  const sel = props.revealAll ? null : props.selectedId;
  if (sel == null) return null;
  const sources = VISION.visionSources(props.units, viewerId.value, sel);
  if (sources.length !== 1 || sources[0].id !== sel) return null;
  return VISION.visibleTileSet(props.field, sources);
});

// Tiles seen by the selected unit specifically, for the highlight outline drawn in the
// template (square-grid analogue of FogOverlay's continuous-map highlightRegion).
const selectedVisionTiles = computed(() => {
  if (!selectedVisionTileSet.value) return [];
  const W = props.field.world.w, H = props.field.world.h;
  const out = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (selectedVisionTileSet.value.has(`${x},${y}`)) out.push({ x, y });
  return out;
});

// While a territory is flashing after a conquest, its hexes keep showing the
// pre-attack owner (see App.vue's territoryFx.holdOwner) — the new owner's
// colour only appears once the flash finishes and the entry is removed.
function heldOwner(territoryId) {
  if (territoryId == null) return null;
  const fx = props.territoryFx?.[territoryId];
  return fx && fx.holdOwner != null ? fx.holdOwner : null;
}

function tileColor(tile) {
  if (squareFogVisibleSet.value && !squareFogVisibleSet.value.has(`${tile.x},${tile.y}`))
    return props.rdr.fogA;
  // 'team' is a sentinel (see kdice's toGrid): the server can't know the client's
  // team palette, so it defers to whichever colour the client already assigned
  // this tile's owner (same trick as layerColor for sprite-layer units).
  // Lightened for the fill (matches the original K.Dice board's pastel look) —
  // the border segments (see segBorderColor) carry the darker, saturated shade
  // instead, so the blob still reads as clearly bounded.
  if (tile.color === 'team') {
    const owner = heldOwner(tile.territoryId) ?? tile.owner;
    return lighten(props.field.teams[owner - 1]?.raw ?? '#8a96a1', 0.35);
  }
  return tile.color;
}

// Hex polygon points for a pointy-top hex tile centered at (tile.x, tile.y),
// sized by field.hexSize (world units) — see games/mapTypes/hexagon.js's
// hexCorners, mirrored here so the renderer doesn't need a server round-trip
// to know a hex's corners.
function hexPoints(tile) {
  const size = props.field.hexSize ?? 1;
  const cx = props.fit.x(tile.x), cy = props.fit.y(tile.y);
  // A hair of overlap beyond the true hex radius so two adjacent same-territory
  // fills overdraw their shared edge instead of butting exactly against it —
  // without it, SVG anti-aliasing leaves a faint background-colored seam along
  // every hex-to-hex edge that reads as a spurious internal grid line.
  const r = props.fit.len(size) + 0.75;
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const ang = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${cx + r * Math.cos(ang)},${cy + r * Math.sin(ang)}`);
  }
  return pts.join(' ');
}

// ── hex-territory colour helpers (kdice) ─────────────────────────────────
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
function lighten(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex([r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt]);
}
function darken(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex([r * (1 - amt), g * (1 - amt), b * (1 - amt)]);
}

// A border segment sits between exactly two territories (or one territory and
// the map's edge — see games/mapTypes/hexagon.js territoryBorders, which emits
// each shared edge only once, tagged with both sides via aId/bId). It reads as
// "selected" if either bordering territory is the one selected, so a shared
// edge always recolors correctly regardless of which side asks — drawing each
// side's own independent copy (the old per-territory scheme) let whichever
// copy painted last silently win the pixel, making the highlight look randomly
// incomplete around exactly the loser's edges.
function isSegSelected(seg) {
  const sel = props.selectedId ?? props.activeUnitId;
  return sel != null && (seg.aId === sel || seg.bId === sel);
}
// Unselected borders read as a dark shade of the segment's own territory
// colour (same-colour-as-fill would vanish into it — see hexPoints/tileColor
// — so darkening, not matching, is what makes the outline read against the
// fill it's tracing); selected borders turn white to stand out unambiguously.
function segBorderColor(seg) {
  if (isSegSelected(seg)) return '#ffffff';
  const useA = !!seg.aOwner;
  const owner = heldOwner(useA ? seg.aId : seg.bId) ?? (useA ? seg.aOwner : seg.bOwner);
  const raw = props.field.teams[owner - 1]?.raw ?? '#8a96a1';
  return darken(raw, 0.55);
}

// Optional per-tile coastline dither (see Civ1Game.toGrid): a run-length-merged
// list of {x,y,w,h,color} sub-rects in fractional tile coords, painted over the
// flat colour rect to break a water tile's hard square edge into a pixel stipple.
// Hidden under fog like the tile's own colour.
function tileDither(tile) {
  if (!tile.dither) return null;
  if (squareFogVisibleSet.value && !squareFogVisibleSet.value.has(`${tile.x},${tile.y}`)) return null;
  return tile.dither;
}

function tileBgImage(tile) {
  if (!tile.bgImage) return null;
  if (squareFogVisibleSet.value && !squareFogVisibleSet.value.has(`${tile.x},${tile.y}`)) return null;
  return imgSrc(tile.bgImage);
}

// A second sprite drawn on top of the terrain (e.g. a river overlay whose art is
// transparent except for the feature itself). Fogged the same as the base tile.
function tileOverlayImage(tile) {
  if (!tile.overlayImage) return null;
  if (squareFogVisibleSet.value && !squareFogVisibleSet.value.has(`${tile.x},${tile.y}`)) return null;
  return imgSrc(tile.overlayImage);
}

// Design rule: grid-based games get a square marker (a game can override per unit
// type via ui.unitShapes, e.g. chess); non-grid (continuous, see field.locationType)
// games get a circle, matching there being no cell for a square to align to.
// A spriteLayers() layer's fill/stroke is normally a literal CSS color, but games
// with dynamic (owner-index-based) team palettes can't know that color server-side
// (see apps/design/App.vue's TEAM_RAWS) — passing the sentinel 'team' instead defers
// to the same u.teamObj.raw the plain-shape body already uses.
function layerColor(u, val) {
  return val === 'team' ? (u.id === highlightUnitId.value ? 'white' : u.teamObj.raw) : val;
}

function unitShape(u) {
  const shapes = props.field.ui?.unitShapes;
  if (shapes?.[u.type]) return shapes[u.type];
  return props.field.locationType === 'continuous' ? 'circle' : 'square';
}

// Design rule: a unit shows either its facing arrow (when ui.showFacing is on) or its
// type letter — never both. A static letter drawn under a rotating-looking arrow reads
// as broken, so facing-enabled games get an accent-colored marker instead, shaped per
// unit type (markerShapeFor/markerGlyph, see data.js) so types stay distinguishable.
// Fog games hide the arrow entirely (not even a marker) since facing would leak intel
// about an enemy's aim through the fog — reappears once a finished game reveals all.
const facingActive = computed(() => props.field.ui?.showFacing !== false && (!props.fog || props.revealAll));
function markerR(u) { return Math.max(2, unitR(u) * 0.3); }
function markerSpec(u) { return markerGlyph(markerShapeFor(u.type), markerR(u)); }

// ── square markers (user annotations on unseen squares) ──────────────────────
const MARKER_CYCLE = ['p', 'n', 'b', 'r', 'q', 'k', null];
// Enemy piece colour from the viewer's perspective, so manual markers use the
// opponent's actual sprite set rather than always assuming the enemy is black.
const enemyPrefix = computed(() => viewerIsBlack.value ? 'w' : 'b');
function markerImg(type) { return `${window.api.basePath}/images/chess/${enemyPrefix.value}${type.toUpperCase()}`; }

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
  if (props.field.grid === 'hexagon') {
    // No integer col/row on a hex board — pass the raw world point and let
    // Battlefield.vue resolve it to a hex/territory (nearest tile center).
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left - props.fit.x(0)) / props.fit.s;
    const y = (e.clientY - rect.top  - props.fit.y(0)) / props.fit.s;
    emit('sq-click', null, null, x, y);
    return;
  }
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
  // Aiming mode: clicking any unit token (e.g. the enemy you're shooting at) is just
  // a click at that point — let it bubble to handleBoardClick like bare ground would.
  if (props.aiming) return;
  // Territory-click games (kdice): a territory's marker sits on one hex among many,
  // and clicking it must go through the same select-then-attack resolution as
  // clicking any other hex in its blob — let it bubble to handleBoardClick instead
  // of short-circuiting into a plain select.
  if (props.field.ui?.territoryClick) return;
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
// Axis-aligned bounding box of a shape, regardless of its kind — rect/oval already carry
// one as x/y/w/h; poly derives it from the min/max of its points.
function shapeBBox(s) {
  if (s.shape !== 'poly') return s;
  const xs = s.points.map(p => p.x), ys = s.points.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
// Shapes are re-created on every toGrid call, so the selected shape is rarely the exact
// same object reference as its counterpart in a fresh field.shapes — compare by geometry
// instead (points array for poly, x/y/w/h for rect/oval).
function shapesEqual(a, b) {
  if (a.shape !== b.shape) return false;
  if (a.shape === 'poly')
    return a.points.length === b.points.length && a.points.every((p, i) => p.x === b.points[i].x && p.y === b.points[i].y);
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}
const selectedShapeIndex = computed(() => {
  const s = props.selectedShape;
  if (!s || !props.field.shapes) return -1;
  return props.field.shapes.findIndex(sh => shapesEqual(sh, s));
});
const coveringShapes = computed(() => {
  const idx = selectedShapeIndex.value;
  if (idx < 0) return [];
  const s = shapeBBox(props.selectedShape);
  return props.field.shapes.slice(idx + 1)
    .filter(cs => { const b = shapeBBox(cs); return s.x < b.x + b.w && s.x + s.w > b.x && s.y < b.y + b.h && s.y + s.h > b.y; });
});

const fxList = computed(() => Object.entries(props.unitFx ?? {}).map(([id, fx]) => ({ id, ...fx })));

// Every hex whose territoryId is currently flashing (see App.vue's territoryFx),
// tagged with that flash's key (so retriggering a still-blinking territory — a
// second attack before the first finishes — restarts from a fresh element) and
// its blink count (3 for an attack, 1 for a placed reinforcement — see App.vue).
// blinks: 0 entries (a bundled-turn colour hold with no attack playing yet — see
// App.vue's bundleHold) are excluded: they should keep the old colour via
// heldOwner below, but draw no white overlay since nothing is actually flashing.
const flashingHexes = computed(() => {
  const fx = props.territoryFx;
  if (!fx || !Object.keys(fx).length) return [];
  return (props.field.tiles ?? [])
    .filter(t => t.territoryId != null && fx[t.territoryId]?.blinks > 0)
    .map(t => ({ tile: t, fxKey: fx[t.territoryId].key, blinks: fx[t.territoryId].blinks }));
});
const fxR = computed(() => Math.max(6, props.fit.len(props.field.grid === 'square'
  ? (props.field.world.w <= 10 ? 0.42 : 0.5)
  : 2.8)));
</script>

<template>
  <div class="bf-layer" :style="{background: rdr.stage}">
    <svg ref="svgEl" width="100%" height="100%"
         :style="{ display:'block', position:'absolute', inset:0, cursor: dragUnit ? 'grabbing' : (aiming ? 'crosshair' : '') }"
         @click="handleBoardClick"
         @mousemove="handleBoardMouseMove"
         @mouseleave="handleBoardMouseLeave">

      <!-- Terrain: on ordinary tile-grid maps, one <rect> per cell (per-cell color from
           game toGrid; fog applied per-tile). Non-grid (shape) maps have no real tile grid
           to show — every cell shares one uniform ground color there (terrain is conveyed
           by the shapes below instead), so draw that as a single backdrop rect rather than
           a lattice of unit-cell squares. -->
      <rect v-if="field.shapes?.length && field.tiles?.length"
            :x="fit.x(0)" :y="fit.y(0)"
            :width="fit.len(field.world.w)" :height="fit.len(field.world.h)"
            :fill="tileColor(field.tiles[0])"/>
      <!-- Hexagon-grid maps: one hex polygon per cell, multiple hexes sharing a
           territory's colour form the visible territory "blob" (see KDiceGame.toGrid
           and games/mapTypes/hexagon.js). Click hit-testing is handled separately
           in handleBoardClick (nearest hex center), not per-polygon click handlers. -->
      <template v-else-if="field.grid === 'hexagon'">
        <!-- Fill only, no per-hex stroke — hexes within the same territory read as one
             solid blob; the outline (below, drawn from field.hexBorders) traces just
             the blob's outer edge instead of a honeycomb lattice. -->
        <polygon v-for="(tile, i) in (field.tiles ?? [])" :key="'hx'+i"
                 :points="hexPoints(tile)"
                 :fill="tileColor(tile)"/>
        <!-- Territory attack flash: an all-white overlay hex per flashing tile, hard
             blinking on/off (see .territory-flash-hex below and App.vue's territoryFx —
             blink count/timing must match App.vue's TERRITORY_BLINK_MS). -->
        <polygon v-for="fh in flashingHexes" :key="'hxfx'+fh.tile.territoryId+'-'+fh.fxKey"
                 :points="hexPoints(fh.tile)"
                 :style="{ animationIterationCount: fh.blinks }"
                 class="territory-flash-hex sl-noevents"/>
        <line v-for="(seg, si) in (field.hexBorders ?? [])" :key="'hb'+si"
              :x1="fit.x(seg.p1[0])" :y1="fit.y(seg.p1[1])"
              :x2="fit.x(seg.p2[0])" :y2="fit.y(seg.p2[1])"
              :stroke="segBorderColor(seg)"
              :stroke-width="isSegSelected(seg) ? 4 : 2.25"
              stroke-linecap="round" class="sl-noevents"/>
      </template>
      <template v-else>
        <!-- A hair of overlap on the right/bottom edges so adjacent tiles overdraw
             their shared edge instead of butting exactly against it — without it,
             SVG anti-aliasing leaves a faint background-coloured seam along every
             tile edge that reads as a spurious terrain grid. Both the colour layer
             and the (typically opaque) terrain sprite are extended so neither shows
             a seam; the river overlay below keeps its exact size so its channel art
             lines up edge-to-edge with its neighbours. -->
        <rect v-for="(tile, i) in (field.tiles ?? [])" :key="'t'+i"
              :x="fit.x(tile.x)" :y="fit.y(tile.y)"
              :width="fit.len(1) + 0.75" :height="fit.len(1) + 0.75"
              shape-rendering="crispEdges"
              :fill="tileColor(tile)"/>
        <!-- Coastline dither: sub-tile stipple rects painted over the flat colour
             layer (games opt in via tile.dither, e.g. civ1's water shoreline). -->
        <template v-for="(tile, i) in (field.tiles ?? [])" :key="'td'+i">
          <rect v-for="(d, di) in (tileDither(tile) ?? [])" :key="'td'+i+'-'+di"
                :x="fit.x(tile.x) + fit.len(d.x)" :y="fit.y(tile.y) + fit.len(d.y)"
                :width="fit.len(d.w) + 0.75" :height="fit.len(d.h) + 0.75"
                shape-rendering="crispEdges" :fill="d.color"
                class="sl-noevents"/>
        </template>
        <!-- Terrain images (overlaid on color; absent when fogged) -->
        <template v-for="(tile, i) in (field.tiles ?? [])" :key="'ti'+i">
          <image v-if="tileBgImage(tile)"
                 :x="fit.x(tile.x)" :y="fit.y(tile.y)"
                 :width="fit.len(1) + 0.75" :height="fit.len(1) + 0.75"
                 :href="tileBgImage(tile)"
                 preserveAspectRatio="xMidYMid slice"
                 class="sl-noevents sl-pixel"/>
        </template>
        <!-- Terrain overlay sprites (e.g. rivers) drawn on top of the base terrain -->
        <template v-for="(tile, i) in (field.tiles ?? [])" :key="'to'+i">
          <image v-if="tileOverlayImage(tile)"
                 :x="fit.x(tile.x)" :y="fit.y(tile.y)"
                 :width="fit.len(1)" :height="fit.len(1)"
                 :href="tileOverlayImage(tile)"
                 preserveAspectRatio="xMidYMid slice"
                 class="sl-noevents sl-pixel"/>
        </template>
      </template>

      <!-- Non-grid terrain: layered shapes (rectangles + ovals) drawn as the map itself.
           Emitted by a game's toGrid instead of per-tile colours (see field.shapes). -->
      <template v-for="(s, i) in (field.shapes ?? [])" :key="'shp'+i">
        <ellipse v-if="s.shape === 'oval'"
                 :cx="fit.x(s.x + s.w/2)" :cy="fit.y(s.y + s.h/2)"
                 :rx="fit.len(s.w/2)" :ry="fit.len(s.h/2)"
                 :fill="s.fill" :fill-opacity="s.opacity ?? 1"
                 :stroke="s.stroke ?? 'none'" :stroke-width="s.stroke ? (s.strokeWidth ?? 1.5) : 0"
                 class="sl-noevents"/>
        <!-- Free-form primitive: points are world coords (see a game's toGrid, e.g. aow's
             mountains/trees/forts, or doom's merged same-kind decor panels). Inspectable
             like any other shape when it carries a `name` (see Battlefield's pointInShape
             and coveringShapes/selectedShapeIndex above). -->
        <polygon v-else-if="s.shape === 'poly'"
                 :points="s.points.map(p => fit.x(p.x) + ',' + fit.y(p.y)).join(' ')"
                 :fill="s.fill" :fill-opacity="s.opacity ?? 1"
                 :stroke="s.stroke ?? 'none'" :stroke-width="s.stroke ? (s.strokeWidth ?? 1.5) : 0"
                 stroke-linejoin="round" class="sl-noevents"/>
        <line v-else-if="s.shape === 'line'"
              :x1="fit.x(s.x1)" :y1="fit.y(s.y1)" :x2="fit.x(s.x2)" :y2="fit.y(s.y2)"
              :stroke="s.stroke ?? s.fill" :stroke-width="s.strokeWidth ?? 1"
              stroke-linecap="round" class="sl-noevents"/>
        <rect v-else
              :x="fit.x(s.x)" :y="fit.y(s.y)"
              :width="fit.len(s.w)" :height="fit.len(s.h)"
              :fill="s.fill" :fill-opacity="s.opacity ?? 1"
              :stroke="s.stroke ?? 'none'" :stroke-width="s.stroke ? (s.strokeWidth ?? 1.5) : 0"
              class="sl-noevents"/>
        <text v-if="s.label"
              :x="fit.x(s.x + s.w/2)" :y="fit.y(s.y + s.h/2)"
              :fill="s.labelColor ?? 'rgba(255,255,255,0.85)'"
              :font-family="rdr.font" font-size="13" font-weight="700"
              text-anchor="middle" dominant-baseline="central"
              class="sl-noevents sl-noselect">{{s.label}}</text>
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
            <polygon v-else-if="selectedShape.shape === 'poly'"
                     :points="selectedShape.points.map(p => fit.x(p.x) + ',' + fit.y(p.y)).join(' ')" fill="white"/>
            <rect v-else
                  :x="fit.x(selectedShape.x)" :y="fit.y(selectedShape.y)"
                  :width="fit.len(selectedShape.w)" :height="fit.len(selectedShape.h)" fill="white"/>
            <template v-for="(cs, ci) in coveringShapes" :key="'covm'+ci">
              <ellipse v-if="cs.shape === 'oval'"
                       :cx="fit.x(cs.x + cs.w/2)" :cy="fit.y(cs.y + cs.h/2)"
                       :rx="fit.len(cs.w/2)" :ry="fit.len(cs.h/2)" fill="black"/>
              <polygon v-else-if="cs.shape === 'poly'"
                       :points="cs.points.map(p => fit.x(p.x) + ',' + fit.y(p.y)).join(' ')" fill="black"/>
              <rect v-else
                    :x="fit.x(cs.x)" :y="fit.y(cs.y)"
                    :width="fit.len(cs.w)" :height="fit.len(cs.h)" fill="black"/>
            </template>
          </mask>
          <clipPath id="selShapeClip" clipPathUnits="userSpaceOnUse">
            <ellipse v-if="selectedShape.shape === 'oval'"
                     :cx="fit.x(selectedShape.x + selectedShape.w/2)" :cy="fit.y(selectedShape.y + selectedShape.h/2)"
                     :rx="fit.len(selectedShape.w/2)" :ry="fit.len(selectedShape.h/2)"/>
            <polygon v-else-if="selectedShape.shape === 'poly'"
                     :points="selectedShape.points.map(p => fit.x(p.x) + ',' + fit.y(p.y)).join(' ')"/>
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
                 mask="url(#selShapeMask)" class="sl-noevents"/>
        <polygon v-else-if="selectedShape.shape === 'poly'"
                 :points="selectedShape.points.map(p => fit.x(p.x) + ',' + fit.y(p.y)).join(' ')"
                 fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="2" stroke-dasharray="4,3"
                 mask="url(#selShapeMask)" class="sl-noevents"/>
        <rect v-else
              :x="fit.x(selectedShape.x)" :y="fit.y(selectedShape.y)"
              :width="fit.len(selectedShape.w)" :height="fit.len(selectedShape.h)"
              fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="2" stroke-dasharray="4,3"
              mask="url(#selShapeMask)" class="sl-noevents"/>
        <!-- Each covering shape's own edge, kept only where it cuts across the selected
             shape — this is the "new" boundary the selection now traces there. -->
        <template v-for="(cs, ci) in coveringShapes" :key="'covo'+ci">
          <ellipse v-if="cs.shape === 'oval'"
                   :cx="fit.x(cs.x + cs.w/2)" :cy="fit.y(cs.y + cs.h/2)"
                   :rx="fit.len(cs.w/2)" :ry="fit.len(cs.h/2)"
                   fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="2" stroke-dasharray="4,3"
                   clip-path="url(#selShapeClip)" class="sl-noevents"/>
          <polygon v-else-if="cs.shape === 'poly'"
                   :points="cs.points.map(p => fit.x(p.x) + ',' + fit.y(p.y)).join(' ')"
                   fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="2" stroke-dasharray="4,3"
                   clip-path="url(#selShapeClip)" class="sl-noevents"/>
          <rect v-else
                :x="fit.x(cs.x)" :y="fit.y(cs.y)"
                :width="fit.len(cs.w)" :height="fit.len(cs.h)"
                fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="2" stroke-dasharray="4,3"
                clip-path="url(#selShapeClip)" class="sl-noevents"/>
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
            class="sl-noevents"/>

      <!-- Selected unit's own vision, traced on top of the team-wide fog shading above -->
      <rect v-for="(sv, i) in selectedVisionTiles" :key="'sv'+i"
            :x="fit.x(sv.x)" :y="fit.y(sv.y)"
            :width="fit.len(1)" :height="fit.len(1)"
            fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="1.5"
            class="sl-noevents"/>

      <!-- Square markers: user annotations on unseen squares, or (reveal mode) true piece positions -->
      <image v-for="m in displayMarkers" :key="'sm'+m.col+','+m.row"
             :x="fit.x(m.col) + fit.len(0.1)" :y="fit.y(m.row) + fit.len(0.1)"
             :width="fit.len(0.8)" :height="fit.len(0.8)"
             :href="imgSrc(m.img) ?? markerImg(m.type)"
             opacity="0.55"
             class="sl-noevents"/>

      <!-- Selected square highlight (used instead of a ring on the unit when ui.highlightSelectedSquare is set) -->
      <rect v-if="selectedSquare"
            :x="fit.x(selectedSquare.x)" :y="fit.y(selectedSquare.y)"
            :width="fit.len(1)" :height="fit.len(1)"
            fill="rgba(255,255,255,0.35)"
            class="sl-noevents"/>

      <!-- Selected empty square (terrain info) -->
      <rect v-if="selectedEmptySquare"
            :x="fit.x(selectedEmptySquare.x)" :y="fit.y(selectedEmptySquare.y)"
            :width="fit.len(1)" :height="fit.len(1)"
            fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="2" stroke-dasharray="4,3"
            class="sl-noevents"/>

      <!-- Last move highlights -->
      <rect v-for="([lc, lr], i) in lastMoveSquares" :key="'lmv'+i"
            :x="fit.x(lc)" :y="fit.y(lr)"
            :width="fit.len(1)" :height="fit.len(1)"
            fill="rgba(242,180,65,0.35)"
            class="sl-noevents"/>

      <!-- Legal move highlights: on non-grid (shape) maps a single reachable region —
           a plain radius circle, or an exact wall-occluded area on maps with walls (so it
           doesn't promise movement through walls) — else per-cell squares on tile grids.
           Swapped out for the aiming overlay below while a throw/shoot is being aimed. -->
      <template v-if="!aiming">
        <path v-if="legalMovePathD" :d="legalMovePathD"
              fill="rgba(66,198,230,0.22)" stroke="rgba(66,198,230,0.7)" stroke-width="1.5"
              class="sl-clickable"/>
        <circle v-else-if="legalMoveCircle"
                :cx="fit.x(legalMoveCircle.cx)" :cy="fit.y(legalMoveCircle.cy)" :r="fit.len(legalMoveCircle.r)"
                fill="rgba(66,198,230,0.22)" stroke="rgba(66,198,230,0.7)" stroke-width="1.5"
                class="sl-clickable"/>
        <rect v-else-if="!field.ui?.aimedActionTypes?.includes('move')" v-for="([lc, lr], i) in legalSquares" :key="'lm'+i"
              :x="fit.x(lc)" :y="fit.y(lr)"
              :width="fit.len(1)" :height="fit.len(1)"
              fill="rgba(66,198,230,0.28)" stroke="rgba(66,198,230,0.7)" stroke-width="1.5"
              class="sl-clickable"/>
      </template>

      <!-- Grid -->
      <template v-if="!field.ui?.hideGridLines">
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
          <!-- Active unit ring: white outer ring + inner glow ring (skipped when the game blinks the unit instead,
               or on territory-click maps — there the whole territory blob is already outlined in white by
               field.hexBorders (see kdice's segBorderColor), so a second pulsing ring around just the
               dice-count badge would be a redundant, visually-competing indicator). -->
          <template v-if="u.id === highlightUnitId && !field.ui?.blinkActiveUnit && !field.ui?.territoryClick">
            <circle cx="0" cy="0" :r="unitR(u)+11"
                    fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="6" class="active-ring"/>
            <circle cx="0" cy="0" :r="unitR(u)+7"
                    fill="none" stroke="white" stroke-width="2" class="active-ring"/>
          </template>
          <!-- Selected unit ring: dashed ring (skipped when blinking, when the game highlights the square instead,
               or on territory-click maps for the same reason as the active-unit ring above). -->
          <circle v-if="u.id === selectedId && u.id !== highlightUnitId && !(u.id === blinkTargetId && field.ui?.blinkActiveUnit) && !field.ui?.highlightSelectedSquare && !field.ui?.territoryClick"
                  cx="0" cy="0" :r="unitR(u)+6"
                  fill="none" stroke="rgba(255,255,255,0.75)" stroke-width="1.5" stroke-dasharray="3 3"/>
          <!-- Roster-hovered unit ring: soft solid ring, hidden once the unit is active/selected -->
          <circle v-if="u.id === hoveredId && u.id !== highlightUnitId && u.id !== selectedId"
                  cx="0" cy="0" :r="unitR(u)+6"
                  fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="1.5"/>
          <!-- Facing indicator: filled arrowhead on unit edge (hidden under fog) -->
          <polygon v-if="facingActive"
                   :points="facingArrow(u)"
                   :fill="u.id === highlightUnitId ? 'white' : u.teamObj.raw"
                   :stroke="rdr.stage" stroke-width="1"/>
          <!-- Body shape: active unit gets solid team-color fill (skipped when a sprite image or a
               layered composite sprite is available) -->
          <circle v-if="!u.imagePath && !u.spriteLayers && unitShape(u)==='circle'"
                  cx="0" cy="0" :r="unitR(u)"
                  :fill="u.id === highlightUnitId ? u.teamObj.raw : rdr.unitFill"
                  :stroke="u.id === highlightUnitId ? 'white' : u.teamObj.raw" stroke-width="2"/>
          <polygon v-else-if="!u.imagePath && !u.spriteLayers && unitShape(u)==='triangle'"
                   :points="`0,${-unitR(u)} ${unitR(u)},${unitR(u)} ${-unitR(u)},${unitR(u)}`"
                   :fill="u.id === highlightUnitId ? u.teamObj.raw : rdr.unitFill"
                   :stroke="u.id === highlightUnitId ? 'white' : u.teamObj.raw" stroke-width="2"/>
          <rect v-else-if="!u.imagePath && !u.spriteLayers"
                :x="-unitR(u)" :y="-unitR(u)"
                :width="unitR(u)*2" :height="unitR(u)*2"
                :fill="u.id === highlightUnitId ? u.teamObj.raw : rdr.unitFill"
                :stroke="u.id === highlightUnitId ? 'white' : u.teamObj.raw" stroke-width="2"/>
          <!-- Layered composite sprite: an ordered stack of independently offset/rotated images
               OR primitive shapes (body, hands, held weapon, ring, equipment badges — see a
               game's toGrid, e.g. games/surviv/SurvivGame.js's spriteLayers()). Each layer's
               dx/dy/rot are precomputed server-side (already rotated for facing), so this stays
               a dumb draw loop: any game can opt in by putting `spriteLayers` on a unit instead
               of `imagePath`. A layer with `shape: 'circle'|'rect'` draws a flat-color primitive
               (fill/stroke/strokeWidth, circle uses rFrac, rect reuses wFrac/hFrac/anchorX/anchorY)
               instead of an `<image>` — see games/cs/CsGame.js's spriteLayers() for a
               surviv.io-style all-primitive unit (no sourced art at all). -->
          <template v-if="u.spriteLayers">
            <!-- u.hitRFrac (default 1) lets a game widen the clickable area past the body
                 radius when a sprite layer draws outside it (e.g. CS's armor ring). -->
            <rect :x="-unitR(u)*(u.hitRFrac??1)" :y="-unitR(u)*(u.hitRFrac??1)"
                  :width="unitR(u)*2*(u.hitRFrac??1)" :height="unitR(u)*2*(u.hitRFrac??1)"
                  fill="transparent" class="sl-allevents"/>
            <g v-for="(layer, li) in u.spriteLayers" :key="'sp'+li"
               :transform="`translate(${unitR(u)*layer.dx}, ${unitR(u)*layer.dy}) rotate(${layer.rot||0})`"
               class="sl-noevents">
              <circle v-if="layer.shape==='circle'" cx="0" cy="0" :r="unitR(u)*(layer.rFrac??0.5)"
                      :fill="layerColor(u, layer.fill)||'#888'" :stroke="layerColor(u, layer.stroke)||'none'" :stroke-width="layer.strokeWidth||0"/>
              <rect v-else-if="layer.shape==='rect'"
                    :x="-unitR(u)*layer.wFrac*(layer.anchorX??0.5)" :y="-unitR(u)*layer.hFrac*(layer.anchorY??0.5)"
                    :width="unitR(u)*layer.wFrac" :height="unitR(u)*layer.hFrac"
                    :rx="unitR(u)*(layer.rxFrac??0)"
                    :fill="layerColor(u, layer.fill)||'#888'" :stroke="layerColor(u, layer.stroke)||'none'" :stroke-width="layer.strokeWidth||0"/>
              <text v-else-if="layer.shape==='text'" x="0" y="0"
                    :font-size="unitR(u)*(layer.rFrac??0.9)" font-weight="800" :font-family="rdr.font"
                    text-anchor="middle" dominant-baseline="central" class="sl-noselect" paint-order="stroke"
                    :fill="layerColor(u, layer.fill)||'#fff'"
                    :stroke="layerColor(u, layer.stroke)||'none'" :stroke-width="layer.strokeWidth||0">{{layer.text}}</text>
              <image v-else :x="-unitR(u)*layer.wFrac*(layer.anchorX??0.5)" :y="-unitR(u)*layer.hFrac*(layer.anchorY??0.5)"
                     :width="unitR(u)*layer.wFrac" :height="unitR(u)*layer.hFrac"
                     :href="imgSrc(layer.src)"/>
            </g>
          </template>
          <!-- Sprite image or first letter of unit name -->
          <template v-else-if="u.imagePath">
            <!-- Invisible hit-area: the image itself has pointer-events:none so it doesn't block clicks on what's behind it -->
            <rect :x="-unitR(u)" :y="-unitR(u)"
                  :width="unitR(u)*2" :height="unitR(u)*2"
                  fill="transparent" class="sl-allevents"/>
            <image :x="-unitR(u)" :y="-unitR(u)"
                   :width="unitR(u)*2" :height="unitR(u)*2"
                   :href="teamSpriteHref(u.imagePath, u.teamObj?.raw, field.ui?.recolorTeamSprites)"
                   class="sl-noevents sl-pixel"/>
          </template>
          <template v-else-if="facingActive">
            <circle v-if="markerSpec(u).kind === 'circle'" cx="0" cy="0" :r="markerSpec(u).r"
                    :fill="u.id === highlightUnitId ? 'white' : u.teamObj.raw" class="sl-noevents"/>
            <template v-else-if="markerSpec(u).kind === 'ring'">
              <circle cx="0" cy="0" :r="markerSpec(u).rOuter" fill="none"
                      :stroke="u.id === highlightUnitId ? 'white' : u.teamObj.raw" stroke-width="1.6"
                      class="sl-noevents"/>
              <circle cx="0" cy="0" :r="markerSpec(u).rInner"
                      :fill="u.id === highlightUnitId ? 'white' : u.teamObj.raw" class="sl-noevents"/>
            </template>
            <polygon v-else :points="markerSpec(u).points"
                     :fill="u.id === highlightUnitId ? 'white' : u.teamObj.raw" class="sl-noevents"/>
          </template>
          <text v-else x="0" y="0"
                :fill="u.id === highlightUnitId ? 'white' : u.teamObj.raw" :font-family="rdr.font"
                :font-size="unitR(u)" font-weight="800"
                text-anchor="middle" dominant-baseline="central"
                class="sl-noselect sl-noevents">{{u.name[0].toUpperCase()}}</text>
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

      <!-- Aiming overlay: same-shape reach arc as the move highlight, but at the aimed
           action's own range (throw range / weapon range), colored to read as a distinct
           mode. A throw adds a blast-radius preview at the cursor; a shoot adds an aim ray
           from the unit to the cursor, clipped to weapon range. Drawn after terrain/walls/
           units (not alongside the legal-move highlight above) so the shading and outcome
           badges read on top of the map instead of being covered by it. -->
      <template v-if="aiming">
        <path v-if="aimRegionPathD" :d="aimRegionPathD"
              fill="rgba(242,180,65,0.16)" stroke="rgba(242,180,65,0.65)" stroke-width="1.5"
              class="sl-noevents"/>
        <circle v-else-if="aimRegion"
                :cx="fit.x(aimRegion.cx)" :cy="fit.y(aimRegion.cy)" :r="fit.len(aimRegion.r)"
                fill="rgba(242,180,65,0.16)" stroke="rgba(242,180,65,0.65)" stroke-width="1.5"
                class="sl-noevents"/>
        <circle v-if="aiming.type === 'throw' && hoverWorld"
                :cx="fit.x(hoverWorld.x)" :cy="fit.y(hoverWorld.y)" :r="fit.len(aiming.blastRadius || 0)"
                fill="rgba(255,110,40,0.28)" stroke="rgba(255,110,40,0.75)" stroke-width="1.5"
                class="sl-noevents"/>
        <line v-if="aiming.type === 'shoot' && shootRayEnd && aimUnit"
              :x1="fit.x(aimUnit.x)" :y1="fit.y(aimUnit.y)"
              :x2="fit.x(shootRayEnd.x)" :y2="fit.y(shootRayEnd.y)"
              stroke="rgba(255,210,60,0.85)" stroke-width="2" stroke-dasharray="3 3"
              class="sl-noevents"/>
        <line v-if="aiming.type === 'rotate' && shootRayEnd && aimUnit"
              :x1="fit.x(aimUnit.x)" :y1="fit.y(aimUnit.y)"
              :x2="fit.x(shootRayEnd.x)" :y2="fit.y(shootRayEnd.y)"
              stroke="rgba(120,200,255,0.85)" stroke-width="2" stroke-dasharray="3 3"
              class="sl-noevents"/>
        <line v-if="aiming.type === 'punch' && shootRayEnd && aimUnit"
              :x1="fit.x(aimUnit.x)" :y1="fit.y(aimUnit.y)"
              :x2="fit.x(shootRayEnd.x)" :y2="fit.y(shootRayEnd.y)"
              stroke="rgba(255,110,40,0.85)" stroke-width="2" stroke-dasharray="3 3"
              class="sl-noevents"/>
        <circle v-if="aiming.type === 'punch' && shootRayEnd"
                :cx="fit.x(shootRayEnd.x)" :cy="fit.y(shootRayEnd.y)" :r="fit.len(aiming.blastRadius || 0)"
                fill="rgba(255,110,40,0.28)" stroke="rgba(255,110,40,0.75)" stroke-width="1.5"
                class="sl-noevents"/>

        <!-- Expected-outcome badges: "-NN" damage or "BLIND", over every unit the
             current cursor position would hit (see aimPreviewList) -->
        <g v-for="p in aimPreviewList" :key="'aimprev'+p.id"
           :style="{ transform: `translate(${fit.x(p.x)}px, ${fit.y(p.y) - unitR(units.find(u => u.id === p.id) ?? {}) - 12}px)` }"
           class="sl-noevents">
          <rect :x="-14" y="-9" width="28" height="14" rx="3"
                fill="rgba(20,10,8,0.8)" :stroke="p.text === 'BLIND' ? '#8ad0e6' : '#ff6b57'" stroke-width="1"/>
          <text x="0" y="1.5" text-anchor="middle" dominant-baseline="middle"
                :fill="p.text === 'BLIND' ? '#8ad0e6' : '#ff6b57'"
                :font-family="rdr.font" font-size="9" font-weight="700">{{p.text}}</text>
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
            class="sl-noevents"/>

      <!-- Drag: ghost piece following cursor -->
      <g v-if="dragUnit && dragSvgPos"
         :style="{ transform: `translate(${dragSvgPos.x}px, ${dragSvgPos.y}px)` }"
         class="sl-drag">
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
               :href="imgSrc(dragUnit.imagePath)"
               class="sl-pixel"/>
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
              class="sl-noselect">{{dragUnit.name[0].toUpperCase()}}</text>
      </g>
    </svg>

    <!-- Fog mask (radial gradient blobs, only for non-square non-chess-fog games).
         Hexagon territory maps (kdice) encode fog directly in each hex's colour
         (see KDiceGame.toGrid) rather than a radial-vision overlay, so skip it there. -->
    <div v-if="fog && !field.ui?.gridFog && field.grid !== 'square' && field.grid !== 'hexagon'" class="bf-layer sl-fog"
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
/* kdice territory flash: whole territory hard-blinks white — a plain on/off cut
   (steps(1,end), no easing/fade) so it reads as a snap rather than a glow. One
   cycle is 0.3s, matching App.vue's TERRITORY_BLINK_MS; :style sets how many
   cycles play (animation-iteration-count — see the polygon above). Ends on the
   "off" frame (forwards) so it never flashes a stray extra frame before the
   element is removed once App.vue's timer clears the flash. */
@keyframes territory-flash {
  0%, 49.9% { opacity: 0.85; fill: #ffffff; }
  50%, 100% { opacity: 0; fill: #ffffff; }
}
.territory-flash-hex { animation-name: territory-flash; animation-duration: 0.3s; animation-timing-function: steps(1, end); animation-fill-mode: forwards; }
.sl-noevents { pointer-events: none; }
.sl-allevents { pointer-events: all; }
.sl-clickable { cursor: pointer; }
.sl-pixel { image-rendering: pixelated; }
.sl-noselect { user-select: none; }
.sl-drag { pointer-events: none; opacity: 0.75; }
.sl-fog { pointer-events: none; z-index: 3; }
</style>
