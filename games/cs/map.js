// Tile types: 'wall' | 'floor' | 'bombsiteA' | 'bombsiteB' | 'ctSpawn' | 'tSpawn'
// y increases upward (y=0 = bottom row, y=H-1 = top row)
// All utility functions accept `tiles` as first argument.

import { forEachCell, pointInShape, shapeBBox, assertConvexPoly, segmentHitsSolid } from '../terrainShapes.js';
import { num, tileNum } from '../coord.js';

function k(x, y) { return `${x},${y}`; }

function buildBase(w, h) {
  const t = {};
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) t[k(x, y)] = 'floor';
  for (let x = 0; x < w; x++) { t[k(x, 0)] = 'wall'; t[k(x, h - 1)] = 'wall'; }
  for (let y = 0; y < h; y++) { t[k(0, y)] = 'wall'; t[k(w - 1, y)] = 'wall'; }
  return t;
}

// ── Shape-based (non-grid) maps ─────────────────────────────────────────────────
//
// These maps author terrain as an array of shapes (rectangles + ovals) rather than a
// hand-drawn tile grid. Each shape carries a `kind` that decides both how it rasterizes
// onto the mechanics grid (below) and how the client draws it as a layered SVG. Ovals
// give organic obstacles (pits, ponds, fountains) that a tile grid can only approximate.
//
// kind → { tile: what to stamp (null = leave floor), render: SVG style }

const CS_SHAPE_STYLES = {
  wall:      { tile: 'wall',      render: { fill: '#23262b', stroke: '#3a3f47' },                            name: 'Wall',       description: 'Impassable, blocks line of sight.' },
  building:  { tile: 'wall',      render: { fill: '#33373d', stroke: '#4a4f57' },                            name: 'Building',   description: 'Impassable, blocks line of sight.' },
  crate:     { tile: 'wall',      render: { fill: '#6f5533', stroke: '#8a6a3f' },                             name: 'Crates',     description: 'Impassable hard cover, blocks line of sight.' },
  pit:       { tile: 'wall',      render: { fill: '#7a3b1f', opacity: 0.9 },                                 name: 'Furnace pit',description: 'Impassable, blocks line of sight.' },
  water:     { tile: 'wall',      render: { fill: '#2f6d8f', opacity: 0.85 },                                name: 'Water',      description: 'Impassable, blocks line of sight.' },
  floor:     { tile: 'floor',     render: { fill: '#c8c0a8' },                                               name: 'Floor',      description: 'Open ground.' },
  bombsiteA: { tile: 'bombsiteA', render: { fill: '#d4a03a', opacity: 0.26, stroke: '#e0b24a' }, label: 'A', name: 'Bombsite A', description: 'Bomb can be planted or defused here.' },
  bombsiteB: { tile: 'bombsiteB', render: { fill: '#d4a03a', opacity: 0.26, stroke: '#e0b24a' }, label: 'B', name: 'Bombsite B', description: 'Bomb can be planted or defused here.' },
  ctSpawn:   { tile: null,        render: { fill: '#4a8fd4', opacity: 0.16 }, label: 'CT',                   name: 'CT Spawn',   description: 'Counter-Terrorist starting area.' },
  tSpawn:    { tile: null,        render: { fill: '#d4713a', opacity: 0.16 }, label: 'T',                    name: 'T Spawn',    description: 'Terrorist starting area.' },
  // ── Elevation workaround ──────────────────────────────────────────────────
  // Positions are flat (x, y) — there is no z-axis, so real height differences (boxes you
  // stand on, catwalks over tunnels, ramps) can't be modeled geometrically. `lowWall`
  // approximates the gameplay effect of low/waist-height cover instead of the geometry:
  // its tile is NOT 'wall', so csLosBlockers (belief.js) — which only opacifies
  // tile === 'wall' — never blocks sight or shots through it, while isWalkable/
  // isWalkableContinuous below explicitly still treat it as solid. Net effect: you can
  // see and shoot across/over it exactly like real elevated cover, but can't walk
  // through it. The complementary trick for actual elevated PATHS (e.g. a catwalk
  // overlooking a tunnel) is topological, not geometric: author them as a separate
  // parallel lane (its own walled-off corridor) rather than literally stacking on the
  // same (x, y) as the room below — no dedicated render kind needed, the wall layout
  // itself is what reads as elevated terrain.
  lowWall:   { tile: 'lowWall',   render: { fill: '#8a7a54', stroke: '#a5926a', opacity: 0.85 },              name: 'Low wall / ledge', description: 'Waist-high cover — blocks movement, but (unlike a wall) can be seen and shot across, standing in for a real elevation difference.' },
  // Small blocking prop — a crate/barrel variant sized for scattering many at once without
  // eating a whole tile of corridor width.
  debris:    { tile: 'wall',      render: { fill: '#6f5533', stroke: '#8a6a3f', opacity: 0.9 },               name: 'Debris',     description: 'Small impassable cover — a crate, barrel or pallet.' },
  // ── Purely-decorative kinds (tile: null → never rasterized, never a LOS blocker, skipped
  // by isWalkableContinuous, and — having no `name` — not click-selectable). They exist only
  // to give the SVG depth and texture (bevelled column tops, floor plates, drop shadows,
  // painted trim) so the map reads as architecture instead of flat blocks, WITHOUT changing
  // a single event or vision result — the mechanics see only the solid `wall`/`lowWall`/floor
  // shapes underneath. Ordering matters: author each decoration AFTER the solid shape it
  // dresses so it draws on top.
  cap:       { tile: null, render: { fill: '#454b55' } },                                                    // lit top face of a column/wall
  capLow:    { tile: null, render: { fill: '#9a8a60' } },                                                    // lit top face of a low ledge
  plate:     { tile: null, render: { fill: '#bfb597', opacity: 0.7 } },                                       // large floor slab, a hair off the base floor
  plateDark: { tile: null, render: { fill: '#b0a888', opacity: 0.7 } },                                       // recessed / worn floor slab
  trim:      { tile: null, render: { fill: '#565c66' } },                                                     // bright edge highlight along a wall run
  crateTop:  { tile: null, render: { fill: '#8a6a3f' } },                                                     // lit lid of a crate stack
  // A WINDOW in a building wall. tile 'lowWall' ⇒ movement is blocked (isWalkableContinuous)
  // but — like every lowWall — it's excluded from csLosBlockers (only 'wall' opacifies), so
  // sight and shots pass straight through the glass. The solid `building` wall on either side
  // still blocks LOS, so a window is a real, exactly-calculable firing slit.
  window:    { tile: 'lowWall',   render: { fill: '#6f95a3', opacity: 0.55, stroke: '#9fc0cd', strokeWidth: 1.2 }, name: 'Window', description: 'Glass — blocks movement, but you can see and shoot through it.' },
};

// Floor colour used for the (uniform) tile layer under a shape map — the terrain is
// conveyed entirely by the shapes, so the raster grid stays a plain backdrop.
export const CS_SHAPE_FLOOR = '#c8c0a8';

// The 4 border strips as bare LOS/render geometry (shape/x/y/w/h only) — shared by the
// render helper below and belief.js's csLosBlockers, which needs the same strips as sight
// occluders so vision (like movement) can't cross the map edge.
export function perimeterBlockShapes(W, H) {
  return [
    { shape: 'rect', x: 0,     y: 0,     w: W, h: 1 },
    { shape: 'rect', x: 0,     y: H - 1, w: W, h: 1 },
    { shape: 'rect', x: 0,     y: 0,     w: 1, h: H },
    { shape: 'rect', x: W - 1, y: 0,     w: 1, h: H },
  ];
}

// The map border is always solid (buildBase stamps 'wall' around the edge), but that was
// never given a render shape — only whatever a map's own terrain drew showed up, so the
// edge looked like open background. Draw it explicitly so every shape-based map reads as
// a walled arena. Render-only (buildBase/the boundary check in isWalkableContinuous
// already make it solid), so these aren't added to terrainShapes/tiles.
function perimeterWallShapes(W, H) {
  const render = CS_SHAPE_STYLES.wall.render;
  const info   = { name: CS_SHAPE_STYLES.wall.name, description: CS_SHAPE_STYLES.wall.description, label: null };
  return perimeterBlockShapes(W, H).map(s => ({ ...s, ...render, ...info }));
}

function buildFromShapes(def) {
  const { width: W, height: H, terrain, tSpawns, ctSpawns } = def;
  const t = buildBase(W, H);
  const shapes = [...perimeterWallShapes(W, H)];
  // Continuous-movement lookup: the authored shapes themselves (float x/y/w/h), each
  // tagged with the mechanics tile they rasterize to — used by isWalkableContinuous
  // below instead of the rasterized `tiles` dict, so free-form movement isn't limited
  // to the tile grid's precision.
  const terrainShapes = [];

  for (const s of terrain) {
    const style = CS_SHAPE_STYLES[s.kind] ?? CS_SHAPE_STYLES.wall;
    // Fail at module load, not mid-round: a poly that can't be resolved exactly (concave,
    // degenerate, <3 points) would otherwise only throw the first time a sightline happened
    // to be tested against it. Validated here so authoring errors surface immediately.
    if (s.shape === 'poly') assertConvexPoly(s.points, `${s.kind ?? 'poly'} shape at (${s.points?.[0]?.x}, ${s.points?.[0]?.y})`);
    if (style.tile) forEachCell(s, W, H, (x, y) => { t[k(x, y)] = style.tile; });
    // Geometry carried to the mechanics-facing terrainShapes (continuous walk/LOS) and to
    // the render shapes. Polys travel by their vertex list (+ a derived bbox so bbox-reading
    // code keeps working); rect/oval by their x/y/w/h. `rx` (rounded-rect corner radius) and
    // `strokeWidth` are render-only hints passed straight through when present.
    const bb = shapeBBox(s);
    const geom = s.shape === 'poly'
      ? { shape: 'poly', points: s.points, x: bb.x, y: bb.y, w: bb.w, h: bb.h }
      : { shape: s.shape ?? 'rect', x: s.x, y: s.y, w: s.w, h: s.h };
    terrainShapes.push({ ...geom, tile: style.tile });
    shapes.push({
      ...geom, ...(s.rx != null ? { rx: s.rx } : {}),
      ...style.render,
      // On-map text is reserved for gameplay-relevant zones (spawn/bombsite labels come
      // from the kind's own style, e.g. CS_SHAPE_STYLES.bombsiteA.label = 'A'). A per-shape
      // `s.label` (map-authoring callout names like "Xbox"/"Blue") is intentionally NOT
      // drawn on the map — it only replaces the generic kind name in the terrain-details
      // panel when that shape is selected (see Battlefield.vue's selectedTerrain).
      label: style.label ?? null,
      name: s.label ?? style.name, description: style.description,
    });
  }

  return { width: W, height: H, tiles: t, tSpawns, ctSpawns, shapes, terrainShapes };
}

// Continuous (non-rasterized) walkability — walls/crates/pits/water are tested
// directly against their authored shape geometry (later shapes win ties, matching
// the rasterization order above) rather than the tile grid. Shapes with no mechanics
// tile (tile == null: spawn zones and purely-decorative overlays like floor inlays,
// wall bevels or pillar caps) are skipped entirely, so drawing decoration on top of a
// wall can never flip it walkable — the wall underneath still decides. This is what
// keeps event/vision geometry exactly calculable regardless of any cosmetic layering.
export function isWalkableContinuous(map, x, y) {
  if (x <= 0 || y <= 0 || x >= map.width - 1 || y >= map.height - 1) return false;
  for (let i = map.terrainShapes.length - 1; i >= 0; i--) {
    const s = map.terrainShapes[i];
    if (s.tile == null) continue;
    if (pointInShape(s, x, y)) return s.tile !== 'wall' && s.tile !== 'lowWall';
  }
  return true;
}

// The material-bearing terrain of a map, bottom→top (inert `tile: null` overlays dropped),
// cached per map — the layer stack isWalkableContinuous and isPathClearContinuous share.
const solidLayers = new WeakMap();
function materialShapes(map) {
  let out = solidLayers.get(map);
  if (!out) { out = map.terrainShapes.filter(s => s.tile != null); solidLayers.set(map, out); }
  return out;
}

// EXACT straight-line walkability between two points: true iff no part of the segment lies
// in solid terrain. Replaces a sampled sweep (which could step over a wall thinner than its
// stride); uses the same topmost-shape-wins layering as isWalkableContinuous, so terrain
// carved out by a later `floor` shape stays passable. Endpoints are the caller's to validate.
export function isPathClearContinuous(map, x0, y0, x1, y1) {
  return !segmentHitsSolid(x0, y0, x1, y1, materialShapes(map),
                           s => s.tile === 'wall' || s.tile === 'lowWall');
}

// ── Shape-authoring helpers ─────────────────────────────────────────────────────
// Small constructors that build the convex polys the higher-fidelity maps are made of.
// Every poly they emit is CONVEX, which is what keeps ray-vs-poly LOS (terrainShapes
// rayPolyIv) and continuous walkability EXACT rather than approximate — see the note on
// rayPolyIv. They return plain terrain entries ({ shape, kind, points } / rect), so they
// drop straight into a map's `terrain` array (spread when a helper returns several).

// Regular octagon centred at (cx, cy) with circumradius r, flat-topped (a 22.5° twist).
// Used for columns/pillars and rounded corner posts — a shape a bare rect grid can't make.
function oct(cx, cy, r, kind = 'wall') {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    pts.push({ x: +(cx + r * Math.cos(a)).toFixed(3), y: +(cy + r * Math.sin(a)).toFixed(3) });
  }
  return { shape: 'poly', kind, points: pts };
}

// A full pillar: the solid octagon column plus a smaller lit octagon `cap` drawn on top,
// so a column reads as a 3-D shaft catching overhead light instead of a flat blob. The cap
// is decorative (tile: null) — only the column body is a wall. Spread into `terrain`.
function pillar(cx, cy, r = 1.15, kind = 'wall') {
  return [oct(cx, cy, r, kind), oct(cx, cy, r * 0.58, kind === 'lowWall' ? 'capLow' : 'cap')];
}

// A row/colonnade of pillars at every (x in xs, y in ys) — the "hallway with pillars".
function colonnade(xs, ys, r = 1.15, kind = 'wall') {
  const out = [];
  for (const y of ys) for (const x of xs) out.push(...pillar(x, y, r, kind));
  return out;
}

// A wall as a thick segment from (x1,y1) to (x2,y2): a convex parallelogram, so walls can
// run at ANY angle (diagonals, chamfers) instead of only axis-aligned rectangles. `kind`
// picks the material (building/wall/window/…). A thin lit `trim` quad along the near edge
// gives the wall a bevelled top unless trim:false.
function wallSeg(x1, y1, x2, y2, thick = 1.8, kind = 'building', trim = true) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (thick / 2), ny = (dx / len) * (thick / 2); // half-thickness normal
  const body = { shape: 'poly', kind, points: [
    { x: x1 + nx, y: y1 + ny }, { x: x2 + nx, y: y2 + ny },
    { x: x2 - nx, y: y2 - ny }, { x: x1 - nx, y: y1 - ny }] };
  const t = 0.5; // bevel depth as a fraction of the half-thickness
  const bevel = { shape: 'poly', kind: 'trim', points: [
    { x: x1 + nx, y: y1 + ny }, { x: x2 + nx, y: y2 + ny },
    { x: x2 + nx * (1 - t), y: y2 + ny * (1 - t) }, { x: x1 + nx * (1 - t), y: y1 + ny * (1 - t) }] };
  return trim ? [body, bevel] : [body];
}

// A straight wall RUN pierced by openings — the building block for rooms & hallways. Each
// opening is { from, to, kind } measured as distance along the run from (x1,y1): kind
// 'door' leaves a walkable, see-through gap (plain floor); kind 'window' fills the gap with
// a `window` (lowWall — shoot/see through, no walk). Everything else is solid `building`.
function wallRun(x1, y1, x2, y2, thick = 1.6, openings = []) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const pt = (d) => [x1 + ux * d, y1 + uy * d];
  const out = [];
  let cur = 0;
  for (const o of [...openings].sort((a, b) => a.from - b.from)) {
    if (o.from > cur) { const [ax, ay] = pt(cur), [bx, by] = pt(o.from); out.push(...wallSeg(ax, ay, bx, by, thick, 'building', false)); }
    if (o.kind === 'window') { const [ax, ay] = pt(o.from), [bx, by] = pt(o.to); out.push(...wallSeg(ax, ay, bx, by, thick, 'window', false)); }
    cur = Math.max(cur, o.to);
  }
  if (cur < len) { const [ax, ay] = pt(cur), [bx, by] = pt(len); out.push(...wallSeg(ax, ay, bx, by, thick, 'building', false)); }
  return out;
}

// A right-triangle corner chamfer with legs `leg` along +/-x and +/-y from (cx, cy): the
// trick that turns a hard 90° room corner into a clean 45° cut. `sx`/`sy` are ±1 for which
// quadrant the triangle fills (the solid corner side).
function chamfer(cx, cy, leg, sx, sy, kind = 'wall') {
  return { shape: 'poly', kind, points: [
    { x: cx, y: cy }, { x: cx + sx * leg, y: cy }, { x: cx, y: cy + sy * leg }] };
}

// A crate / crate-stack: a rounded rectangle (rx) with a lit inset lid so it reads as a
// box, not a painted square. `kind` is the solid part (crate/lowWall/debris).
function crate(x, y, w, h, kind = 'crate') {
  const r = Math.min(w, h) * 0.22;
  const inset = Math.min(w, h) * 0.2;
  return [
    { shape: 'rect', kind, x, y, w, h, rx: r },                             // box body
    { shape: 'rect', kind: kind === 'lowWall' ? 'capLow' : 'crateTop',      // lit lid
      x: x + inset, y: y + inset, w: w - inset * 2, h: h - inset * 2, rx: r * 0.6 },
  ];
}

// de_forge — a foundry split by a central oval furnace pit; two sites on opposite corners.
// Base layout is the original tripled 3x (22x14 -> 66x42); the original had no interior
// walls at all (just the pit + 4 loose crates), so the flanking west/east corridor walls
// below are new — they turn the open arena into a proper centre chamber with two hallways
// leading in, each with clear north/south bypass gaps so nothing gets sealed off.
const DE_FORGE = {
  width: 66, height: 42,
  terrain: [
    { shape: 'rect', x:  3, y: 15, w:  9, h: 12, kind: 'ctSpawn' },
    { shape: 'rect', x: 54, y: 15, w:  9, h: 12, kind: 'tSpawn'  },
    { shape: 'oval', x: 27, y: 15, w: 12, h: 12, kind: 'pit'     },
    { shape: 'rect', x: 21, y:  6, w:  6, h:  6, kind: 'crate'   },
    { shape: 'rect', x: 39, y: 30, w:  6, h:  6, kind: 'crate'   },
    { shape: 'rect', x: 21, y: 30, w:  6, h:  6, kind: 'crate'   },
    { shape: 'rect', x: 39, y:  6, w:  6, h:  6, kind: 'crate'   },
    { shape: 'rect', x: 12, y: 30, w: 12, h:  6, kind: 'bombsiteA' },
    { shape: 'rect', x: 42, y:  6, w: 12, h:  6, kind: 'bombsiteB' },
    // West/east corridor walls carving the pit chamber out of the open arena — gaps at
    // y6-9 (south) and y30-36 (north) keep both flanks connected around them.
    { shape: 'rect', x: 18, y:  9, w:  3, h: 21, kind: 'building' },
    { shape: 'rect', x: 45, y: 12, w:  3, h: 21, kind: 'building' },
    { shape: 'rect', x: 12, y: 18, w:  3, h:  3, kind: 'crate'   },
    { shape: 'rect', x: 48, y: 21, w:  3, h:  3, kind: 'lowWall' },
  ],
  ctSpawns: [{ x: 3, y: 18 }, { x: 6, y: 18 }, { x: 9, y: 18 }, { x: 6, y: 21 }, { x: 6, y: 24 }],
  tSpawns:  [{ x: 60, y: 18 }, { x: 57, y: 18 }, { x: 54, y: 18 }, { x: 57, y: 21 }, { x: 57, y: 24 }],
};

// de_pond — waterfront with two impassable oval ponds routing play around buildings.
// Tripled 3x from the original; the two ponds already forced a natural diagonal route
// around them, so the added detail is a new boathouse room in the gap between the ponds
// (with cover flanking it) rather than a full re-route.
const DE_POND = {
  width: 66, height: 42,
  terrain: [
    { shape: 'rect', x:  3, y: 30, w:  9, h:  9, kind: 'ctSpawn' },
    { shape: 'rect', x: 54, y:  3, w:  9, h:  9, kind: 'tSpawn'  },
    { shape: 'oval', x: 15, y:  9, w: 15, h:  9, kind: 'water'   },
    { shape: 'oval', x: 39, y: 24, w: 15, h:  9, kind: 'water'   },
    { shape: 'rect', x: 27, y:  6, w:  9, h:  6, kind: 'building' },
    { shape: 'rect', x: 30, y: 30, w:  9, h:  6, kind: 'building' },
    { shape: 'rect', x: 21, y: 21, w:  3, h:  3, kind: 'crate'   },
    { shape: 'rect', x: 42, y: 12, w:  3, h:  3, kind: 'crate'   },
    { shape: 'rect', x:  6, y:  6, w:  9, h:  6, kind: 'bombsiteA' },
    { shape: 'rect', x: 51, y: 30, w:  9, h:  6, kind: 'bombsiteB' },
    // New boathouse room in the neck between the two ponds, with cover on both approaches.
    { shape: 'rect', x: 33, y: 15, w:  6, h:  9, kind: 'building' },
    { shape: 'rect', x: 24, y: 21, w:  3, h:  3, kind: 'crate'   },
    { shape: 'rect', x: 39, y: 33, w:  3, h:  3, kind: 'lowWall' },
  ],
  ctSpawns: [{ x: 3, y: 33 }, { x: 6, y: 33 }, { x: 9, y: 33 }, { x: 6, y: 36 }, { x: 3, y: 36 }],
  tSpawns:  [{ x: 60, y: 6 }, { x: 57, y: 6 }, { x: 54, y: 6 }, { x: 57, y: 9 }, { x: 60, y: 9 }],
};

// de_plaza — an open plaza with a central fountain and market stalls; both sites
// sit on the pavement. Shows a walkable courtyard under an impassable fountain.
// Tripled 3x from the original; two small stall buildings flank the fountain to give the
// plaza some real internal structure without losing its open-courtyard feel.
const DE_PLAZA = {
  width: 66, height: 42,
  terrain: [
    { shape: 'rect', x:  3, y: 15, w:  9, h: 12, kind: 'ctSpawn' },
    { shape: 'rect', x: 54, y: 15, w:  9, h: 12, kind: 'tSpawn'  },
    { shape: 'oval', x: 30, y: 18, w:  6, h:  6, kind: 'water'   },
    { shape: 'rect', x: 27, y:  3, w: 12, h:  3, kind: 'building' },
    { shape: 'rect', x: 27, y: 36, w: 12, h:  3, kind: 'building' },
    { shape: 'rect', x: 21, y: 12, w:  3, h:  3, kind: 'crate'   },
    { shape: 'rect', x: 42, y: 12, w:  3, h:  3, kind: 'crate'   },
    { shape: 'rect', x: 21, y: 27, w:  3, h:  3, kind: 'crate'   },
    { shape: 'rect', x: 42, y: 27, w:  3, h:  3, kind: 'crate'   },
    { shape: 'rect', x: 21, y: 30, w:  9, h:  6, kind: 'bombsiteA' },
    { shape: 'rect', x: 36, y:  6, w:  9, h:  6, kind: 'bombsiteB' },
    // Market stalls flanking the fountain, each with a bit of cover beside it.
    { shape: 'rect', x: 18, y: 21, w:  6, h:  3, kind: 'building' },
    { shape: 'rect', x: 42, y: 21, w:  6, h:  3, kind: 'building' },
    { shape: 'rect', x: 15, y: 21, w:  3, h:  3, kind: 'crate'   },
    { shape: 'rect', x: 48, y: 21, w:  3, h:  3, kind: 'lowWall' },
  ],
  ctSpawns: [{ x: 3, y: 18 }, { x: 6, y: 18 }, { x: 9, y: 18 }, { x: 6, y: 21 }, { x: 6, y: 24 }],
  tSpawns:  [{ x: 60, y: 18 }, { x: 57, y: 18 }, { x: 54, y: 18 }, { x: 57, y: 21 }, { x: 57, y: 24 }],
};

// ── Classic maps, re-authored as shapes ──────────────────────────────────────────
// The originals were hand-laid tile grids; here they're rebuilt from rectangles and
// ovals so they render as clean layered SVGs (rounded crates, oval barrel stacks and
// courtyards) instead of one-cell blocks, while keeping their site/spawn layout.

// dust2 — two sites on the left, mid barrels, T-side cover; CT centre-left, T centre-right.
// Tripled 3x from the original. Adds a wall splitting the open B-side connector into a
// proper corridor, and a wall splitting the T-cover ovals into a distinct ramp chokepoint,
// each with cover — both leave the original top/bottom bypasses clear.
const DUST2 = {
  width: 66, height: 42,
  terrain: [
    { shape: 'rect', x:  3, y: 18, w:  9, h:  9, kind: 'ctSpawn'   },
    { shape: 'rect', x: 54, y: 18, w:  9, h:  9, kind: 'tSpawn'    },
    { shape: 'rect', x:  6, y: 27, w: 12, h:  9, kind: 'bombsiteA' },
    { shape: 'rect', x:  6, y:  6, w: 12, h:  9, kind: 'bombsiteB' },
    { shape: 'rect', x: 24, y: 33, w: 15, h:  3, kind: 'building'  }, // long-A wall
    { shape: 'rect', x: 24, y:  6, w: 15, h:  3, kind: 'building'  }, // long-B wall
    { shape: 'oval', x: 27, y: 15, w: 12, h: 12, kind: 'crate'     }, // mid barrels
    { shape: 'oval', x: 42, y: 24, w:  9, h:  9, kind: 'crate'     }, // upper T cover
    { shape: 'oval', x: 42, y:  9, w:  9, h:  9, kind: 'crate'     }, // lower T cover
    { shape: 'rect', x: 18, y: 15, w:  3, h: 12, kind: 'building'  }, // new B connector wall
    { shape: 'rect', x: 21, y: 21, w:  3, h:  3, kind: 'crate'     },
    { shape: 'rect', x: 45, y: 15, w:  3, h: 12, kind: 'building'  }, // new T ramp wall
    { shape: 'rect', x: 48, y: 21, w:  3, h:  3, kind: 'lowWall'   },
  ],
  ctSpawns: [{ x: 3, y: 21 }, { x: 6, y: 21 }, { x: 9, y: 21 }, { x: 6, y: 24 }, { x: 6, y: 18 }],
  tSpawns:  [{ x: 60, y: 21 }, { x: 57, y: 21 }, { x: 54, y: 21 }, { x: 57, y: 24 }, { x: 57, y: 18 }],
};

// de_dust — symmetric: two mid corridor walls funnel play past an oval barrel stack.
// Tripled 3x from the original, which already carved a central Mid chamber flanked by
// two fully open flanks; each flank now gets one splitting wall (+cover) to become a real
// two-lane corridor instead of open ground, still with clear top/bottom bypasses.
const DE_DUST = {
  width: 66, height: 42,
  terrain: [
    { shape: 'rect', x:  3, y: 15, w:  9, h: 12, kind: 'ctSpawn'   },
    { shape: 'rect', x: 54, y: 15, w:  9, h: 12, kind: 'tSpawn'    },
    { shape: 'rect', x:  6, y: 27, w: 12, h:  9, kind: 'bombsiteA' },
    { shape: 'rect', x:  6, y:  6, w: 12, h:  9, kind: 'bombsiteB' },
    { shape: 'rect', x: 24, y: 12, w:  3, h: 18, kind: 'building'  }, // west corridor wall
    { shape: 'rect', x: 42, y: 12, w:  3, h: 18, kind: 'building'  }, // east corridor wall
    { shape: 'oval', x: 30, y: 15, w:  9, h: 12, kind: 'crate'     }, // mid stack
    { shape: 'rect', x: 18, y: 30, w:  9, h:  3, kind: 'building'  }, // upper arch
    { shape: 'rect', x: 18, y:  9, w:  9, h:  3, kind: 'building'  }, // lower arch
    { shape: 'rect', x: 12, y: 18, w:  3, h:  9, kind: 'building'  }, // new west-flank split
    { shape: 'rect', x: 18, y: 21, w:  3, h:  3, kind: 'crate'     },
    { shape: 'rect', x: 51, y: 15, w:  3, h:  9, kind: 'building'  }, // new east-flank split
    { shape: 'rect', x: 45, y: 15, w:  3, h:  3, kind: 'lowWall'   },
  ],
  ctSpawns: [{ x: 6, y: 18 }, { x: 3, y: 18 }, { x: 6, y: 21 }, { x: 9, y: 18 }, { x: 6, y: 15 }],
  tSpawns:  [{ x: 57, y: 18 }, { x: 60, y: 18 }, { x: 57, y: 21 }, { x: 54, y: 18 }, { x: 57, y: 15 }],
};

// cs_siege — a walled compound (solid block with an oval courtyard carved out) holds both
// sites and the CTs; a single east gate lets the storming Ts in. Cover ovals sit outside.
// Tripled 3x from the original. A second (south) gate is cut into the compound wall,
// reachable via the open south field that already wraps around from the T side — giving
// attackers a real second route in instead of the single choke, plus a cover crate on it.
const CS_SIEGE = {
  width: 66, height: 42,
  terrain: [
    { shape: 'rect', x:  6, y:  6, w: 24, h: 30, kind: 'building'  }, // compound block
    { shape: 'oval', x:  9, y:  9, w: 18, h: 24, kind: 'floor'     }, // carved courtyard
    { shape: 'rect', x: 27, y: 18, w:  6, h:  6, kind: 'floor'     }, // east gate
    { shape: 'rect', x: 15, y:  6, w:  6, h:  6, kind: 'floor'     }, // south gate (new)
    { shape: 'rect', x: 12, y: 24, w:  9, h:  6, kind: 'bombsiteA' },
    { shape: 'rect', x: 12, y: 12, w:  9, h:  6, kind: 'bombsiteB' },
    { shape: 'rect', x: 12, y: 18, w:  6, h:  6, kind: 'ctSpawn'   },
    { shape: 'rect', x: 51, y: 18, w:  9, h:  9, kind: 'tSpawn'    },
    { shape: 'oval', x: 36, y:  9, w:  9, h:  9, kind: 'crate'     },
    { shape: 'oval', x: 36, y: 27, w:  9, h:  9, kind: 'crate'     },
    { shape: 'rect', x: 24, y:  3, w:  3, h:  3, kind: 'crate'     }, // cover on the new south approach
  ],
  ctSpawns: [{ x: 12, y: 18 }, { x: 15, y: 18 }, { x: 12, y: 21 }, { x: 15, y: 21 }, { x: 12, y: 15 }],
  tSpawns:  [{ x: 54, y: 21 }, { x: 57, y: 21 }, { x: 51, y: 21 }, { x: 54, y: 24 }, { x: 54, y: 18 }],
};

// cs_italy — village: CTs top-left, Ts bottom-right, two market buildings dividing the
// middle with an oval stall stack; A market (upper-right), B cellar (lower-left).
// Tripled 3x from the original, which already had a maze-like middle (2 buildings, an oval
// stall, 2 alley walls). Adds two more alley walls (+cover) to carve genuinely new nooks
// out of what would otherwise be open ground once tripled.
const CS_ITALY = {
  width: 66, height: 42,
  terrain: [
    { shape: 'rect', x:  3, y: 30, w:  9, h:  9, kind: 'ctSpawn'   },
    { shape: 'rect', x: 54, y:  3, w:  9, h:  9, kind: 'tSpawn'    },
    { shape: 'rect', x: 45, y: 30, w: 12, h:  9, kind: 'bombsiteA' }, // market
    { shape: 'rect', x:  6, y:  6, w: 12, h:  9, kind: 'bombsiteB' }, // wine cellar
    { shape: 'rect', x: 18, y: 24, w: 18, h:  9, kind: 'building'  }, // upper building
    { shape: 'rect', x: 33, y:  9, w: 18, h:  9, kind: 'building'  }, // lower building
    { shape: 'oval', x: 24, y: 15, w:  9, h:  9, kind: 'crate'     }, // stall stack
    { shape: 'rect', x: 15, y: 15, w:  3, h:  9, kind: 'building'  }, // left alley wall
    { shape: 'rect', x: 48, y: 18, w:  3, h:  9, kind: 'building'  }, // right alley wall
    { shape: 'rect', x: 36, y: 18, w:  3, h:  9, kind: 'building'  }, // new mid alley wall
    { shape: 'rect', x: 39, y: 21, w:  3, h:  3, kind: 'crate'     },
    { shape: 'rect', x: 42, y: 18, w:  3, h:  9, kind: 'building'  }, // new A-approach alley wall
    { shape: 'rect', x: 45, y: 27, w:  3, h:  3, kind: 'lowWall'   },
  ],
  ctSpawns: [{ x: 6, y: 33 }, { x: 3, y: 33 }, { x: 9, y: 33 }, { x: 6, y: 36 }, { x: 6, y: 30 }],
  tSpawns:  [{ x: 57, y: 6 }, { x: 60, y: 6 }, { x: 54, y: 6 }, { x: 57, y: 9 }, { x: 57, y: 3 }],
};

// de_dust2 — the flagship map, rebuilt as a real building complex. Four corner buildings —
// B site + CT spawn (west), A site + T spawn (east) — each an enclosed structure with an
// inner room (the site / the spawn), a HALLWAY, and WINDOWS overlooking the centre. Between
// them runs Mid: a pillared central hall. Every building's inner wall (facing Mid) is a
// `wallRun` pierced with doors (walkable, see-through) and windows (glass — see & shoot
// through, no walk), so the buildings are connected but each opening is a distinct fight.
//
// Routes: B-room → Gallery door (top) or Mid door → Mid → A the same way; CT-room →
// lower door → Mid → T; plus each site room's window gives a firing slit onto Mid without a
// walk-through. Fidelity is all convex geometry so events & vision stay exactly calculable:
// octagonal COLUMNS (`pillar`/`colonnade`), CHAMFERED corners (`chamfer`), rounded CRATES
// (`crate`), building walls with openings (`wallRun`), and inert `tile:null` decoration
// (floor plates, bevel trim, column caps). No z-axis, so waist-high shoot-over cover and
// window glass both use `lowWall` (blocks movement, excluded from LOS blocking in belief.js).
const DE_DUST2 = {
  width: 66, height: 42,
  terrain: [
    // ══ FLOOR PLATES (bottom layer — subtle slabs so rooms read as tiled floors) ══
    { shape: 'rect', kind: 'plateDark', x: 25, y:  2, w: 16, h: 38 }, // Mid hall
    { shape: 'rect', kind: 'plate',     x:  2, y:  2, w: 14, h: 10 }, // B site room
    { shape: 'rect', kind: 'plate',     x: 50, y:  2, w: 14, h: 10 }, // A site room
    { shape: 'rect', kind: 'plate',     x:  2, y: 25, w: 23, h: 15 }, // CT room
    { shape: 'rect', kind: 'plate',     x: 41, y: 25, w: 23, h: 15 }, // T room

    // ══ ZONES (site + spawn tints) ══
    { shape: 'rect', x:  3, y:  3, w: 12, h:  8, kind: 'bombsiteB' },
    { shape: 'rect', x: 51, y:  3, w: 12, h:  8, kind: 'bombsiteA' },
    { shape: 'rect', x:  4, y: 29, w: 13, h:  9, kind: 'ctSpawn'   },
    { shape: 'rect', x: 49, y: 29, w: 13, h:  9, kind: 'tSpawn'    },

    // ══ WEST BUILDING (B site + CT spawn) ═══════════════════════════════════════════
    // Inner wall facing Mid (x25): Gallery door · B window · Mid door · CT window · lower door
    ...wallRun(25, 2, 25, 40, 1.7, [
      { from:  2, to:  7, kind: 'door'   }, // Gallery entrance (B → Mid-top)
      { from:  9, to: 12, kind: 'window' }, // B site window onto Mid
      { from: 16, to: 22, kind: 'door'   }, // Mid door
      { from: 25, to: 28, kind: 'window' }, // CT window onto Mid
      { from: 31, to: 36, kind: 'door'   }, // lower Connector door (CT → Mid)
    ]),
    ...wallRun(2, 24, 25, 24, 1.5, [{ from: 7, to: 11, kind: 'door' }]), // B room ↔ CT room hallway door
    ...wallRun(16, 2, 16, 12, 1.3, [{ from: 6, to: 9, kind: 'window' }]), // B-site alcove wall + interior window
    ...pillar(25, 2, 1.2), ...pillar(25, 24, 1.2), ...pillar(25, 40, 1.2), // rounded wall-end columns
    ...pillar(21, 16, 0.9), ...pillar(21, 31, 0.9),                      // hallway pilasters
    chamfer(1, 1, 4, 1, 1, 'building'), chamfer(1, 41, 4, 1, -1, 'building'), // rounded building corners
    ...crate(4, 4, 3.5, 3.5), ...crate(10, 7, 3, 3),                     // B site cover
    ...crate(4, 8.5, 2.6, 2.2, 'lowWall'),                              // B ledge (shoot-over)
    ...crate(19, 26, 3, 3), ...crate(16, 34, 3, 3),                      // CT-room / hallway cover

    // ══ EAST BUILDING (A site + T spawn) — mirror of the west ════════════════════════
    ...wallRun(41, 2, 41, 40, 1.7, [
      { from:  2, to:  7, kind: 'door'   }, // Gallery entrance (A → Mid-top)
      { from:  9, to: 12, kind: 'window' }, // A site window onto Mid
      { from: 16, to: 22, kind: 'door'   }, // Mid door
      { from: 25, to: 28, kind: 'window' }, // T window onto Mid
      { from: 31, to: 36, kind: 'door'   }, // lower Connector door (T → Mid)
    ]),
    ...wallRun(41, 24, 64, 24, 1.5, [{ from: 12, to: 16, kind: 'door' }]), // A room ↔ T room hallway door
    ...wallRun(50, 2, 50, 12, 1.3, [{ from: 6, to: 9, kind: 'window' }]),  // A-site alcove wall + interior window
    ...pillar(41, 2, 1.2), ...pillar(41, 24, 1.2), ...pillar(41, 40, 1.2),
    ...pillar(45, 16, 0.9), ...pillar(45, 31, 0.9),                        // hallway pilasters
    chamfer(65, 1, 4, -1, 1, 'building'), chamfer(65, 41, 4, -1, -1, 'building'),
    ...crate(58.5, 4, 3.5, 3.5), ...crate(53, 7, 3, 3),                    // A site cover
    ...crate(59.4, 8.5, 2.6, 2.2, 'lowWall'),                            // A ledge (shoot-over)
    ...crate(44, 26, 3, 3), ...crate(47, 34, 3, 3),                        // T-room / hallway cover

    // ══ MID: a grand pillared hall between the two buildings ═════════════════════════
    ...colonnade([29, 37], [7, 14, 21, 28, 35], 1.1),  // double colonnade lining the hall
    ...crate(31, 17, 4, 4),                             // Mid boxes
    ...crate(31.5, 23, 3, 3, 'lowWall'),               // shoot-over box south of Mid boxes
  ],
  ctSpawns: [{ x: 5, y: 31 }, { x: 9, y: 31 }, { x: 13, y: 31 }, { x: 7, y: 35 }, { x: 11, y: 35 }],
  tSpawns:  [{ x: 61, y: 31 }, { x: 57, y: 31 }, { x: 53, y: 31 }, { x: 59, y: 35 }, { x: 55, y: 35 }],
};

// ── Map registry ──────────────────────────────────────────────────────────────

export const MAPS = {
  de_dust2: buildFromShapes(DE_DUST2),
  dust2:    buildFromShapes(DUST2),
  de_dust:  buildFromShapes(DE_DUST),
  cs_siege: buildFromShapes(CS_SIEGE),
  cs_italy: buildFromShapes(CS_ITALY),
  de_forge: buildFromShapes(DE_FORGE),
  de_pond:  buildFromShapes(DE_POND),
  de_plaza: buildFromShapes(DE_PLAZA),
};

// ── Utility functions (all take tiles as first argument) ──────────────────────

// Positions can be continuous (free-form movement); the discrete tile map is only
// keyed by integers, so snap to the tile a point sits in.
export function isBombsite(tiles, x, y) {
  const t = tiles[k(Math.floor(x), Math.floor(y))];
  return t === 'bombsiteA' || t === 'bombsiteB';
}

// Positions can be continuous (free-form movement); the discrete tile map is only
// keyed by integers, so snap to the tile a point sits in.
export function isWalkable(tiles, x, y) {
  const t = tiles[k(Math.floor(x), Math.floor(y))];
  return t !== undefined && t !== 'wall' && t !== 'lowWall';
}

// Bresenham LOS — returns false if any intermediate tile is a wall or in extraBlocked.
// Needs integer endpoints to terminate — unit positions can now be continuous
// (free-form movement), so snap to the tile each endpoint sits in.
export function hasLOS(tiles, x0, y0, x1, y1, extraBlocked = null) {
  x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.floor(x1); y1 = Math.floor(y1);
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let cx = x0, cy = y0;
  while (cx !== x1 || cy !== y1) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; cx += sx; }
    if (e2 < dx)  { err += dx; cy += sy; }
    if (cx === x1 && cy === y1) break;
    if (tiles[k(cx, cy)] === 'wall') return false;
    if (extraBlocked?.has(k(cx, cy))) return false;
  }
  return true;
}

export function euclidean(a, b) {
  return Math.sqrt((num(a.x) - num(b.x)) ** 2 + (num(a.y) - num(b.y)) ** 2);
}

// BFS reachable positions (4-directional, excludes occupied tiles). Still builds the
// AI's discrete candidate set even once positions are continuous (free-form
// movement), so it operates on the integer tile the unit's real position sits in.
export function getReachable(tiles, pos, range, units) {
  const startX = Math.floor(pos.x), startY = Math.floor(pos.y);
  const startKey = k(startX, startY);
  const occupied = new Set(
    units.filter(u => u.alive)
         .map(u => k(Math.floor(u.position.x), Math.floor(u.position.y)))
         .filter(uk => uk !== startKey)
  );
  const visited = new Set([startKey]);
  const queue   = [{ x: startX, y: startY, rem: range }];
  const result  = [];
  while (queue.length) {
    const { x, y, rem } = queue.shift();
    if (rem <= 0) continue;
    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nx = x + dx, ny = y + dy, nk = k(nx, ny);
      if (!visited.has(nk) && isWalkable(tiles, nx, ny) && !occupied.has(nk)) {
        visited.add(nk);
        result.push({ x: nx, y: ny });
        queue.push({ x: nx, y: ny, rem: rem - 1 });
      }
    }
  }
  return result;
}

const TILE_CHARS = { wall: '#', floor: '.', bombsiteA: 'A', bombsiteB: 'B', ctSpawn: 'c', tSpawn: 't', lowWall: '=' };

export function renderMap(state) {
  const { units, gameSpecific: { bomb, smokeZones = [], fireZones = [], map } } = state;
  const { tiles, width, height } = map;
  const posMap = {};
  for (const u of units) if (u.alive) posMap[k(tileNum(u.position.x), tileNum(u.position.y))] = u;

  const smokeSet = new Set();
  for (const sz of smokeZones) {
    const cx = tileNum(sz.x), cy = tileNum(sz.y);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        smokeSet.add(k(cx + dx, cy + dy));
  }

  const fireSet = new Set();
  for (const fz of fireZones) {
    const cx = tileNum(fz.x), cy = tileNum(fz.y);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        fireSet.add(k(cx + dx, cy + dy));
  }

  const rows = [];
  for (let y = height - 1; y >= 0; y--) {
    let row = '';
    for (let x = 0; x < width; x++) {
      const kk = k(x, y);
      const u = posMap[kk];
      if (u) {
        row += u.ownerId === 'T' ? 'T' : 'C';
      } else if (bomb?.planted && tileNum(bomb.plantedAt.x) === x && tileNum(bomb.plantedAt.y) === y) {
        row += '!';
      } else if (fireSet.has(kk)) {
        row += '*';
      } else if (smokeSet.has(kk)) {
        row += '@';
      } else {
        row += TILE_CHARS[tiles[kk]] ?? '?';
      }
    }
    rows.push(`${String(y).padStart(2)} ${row}`);
  }
  rows.push('   ' + Array.from({ length: width }, (_, i) => i % 10).join(''));
  return rows.join('\n');
}
