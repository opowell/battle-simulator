// data.js — UI icons, renderer palettes, simulation math. Loaded as a plain <script> tag.

/* ==================== ICON PATHS ==================== */
const ICON_PATHS = {
  crosshair:'M12 2v4M12 18v4M2 12h4M18 12h4 M12 8a4 4 0 100 8 4 4 0 000-8z',
  zap:'M13 2L4 14h6l-1 8 9-12h-6z',
  shield:'M12 3l7 3v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6z',
  grid:'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  flag:'M5 21V4M5 4h11l-2 4 2 4H5',
  play:'M7 5l12 7-12 7z',
  pause:'M7 5h3v14H7zM14 5h3v14h-3z',
  step:'M5 5v14M9 12l9-7v14z',
  stepb:'M19 5v14M15 12L6 5v14z',
  back:'M15 5l-7 7 7 7',
  clock:'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
  plus:'M12 5v14M5 12h14',
  trash:'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13',
  fog:'M4 15h16M6 18h12M8 11a4 4 0 018 0M5 11h14',
  move:'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3',
  eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z',
  check:'M5 12l5 5 9-11',
  sliders:'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M11 15v6',
  search:'M11 4a7 7 0 100 14 7 7 0 000-14zM16 16l4 4',
  undo:'M4 9h11a5 5 0 010 10h-6M4 9l4-4M4 9l4 4',
  zoomin:'M11 4a7 7 0 100 14 7 7 0 000-14zM16 16l4 4M11 8v6M8 11h6',
  zoomout:'M11 4a7 7 0 100 14 7 7 0 000-14zM16 16l4 4M8 11h6',
};

/* ==================== RENDERER PALETTES ==================== */
const RDR = {
  military:{
    stage:'#080b0e', asset:'radial-gradient(circle at 50% 40%,#11161b,#070a0d 85%)',
    grid:'#141c24', bound:'#26313b', wallS:'#1d262e', wallS2:'#384450',
    unitFill:'#0b1117', label:'#8a96a1', ruler:'#3a4754', hpTrack:'#1a222a', hpTrackA:'#0a0e12',
    terrain:'linear-gradient(135deg,#1b2228,#10161b)',
    terrainTex:'repeating-linear-gradient(45deg,rgba(255,255,255,.015) 0 2px,transparent 2px 6px),radial-gradient(circle at 30% 20%,rgba(66,198,230,.05),transparent 60%)',
    terrainInset:'inset 0 0 0 1px #2a343d, inset 0 0 60px rgba(0,0,0,.6)',
    wallA:'linear-gradient(180deg,#2c3640,#1a222a)', wallEdge:'#3d4954', wallEdge2:'#11161b',
    wallShadow:'0 3px 8px -2px rgba(0,0,0,.6)', wallRadius:3,
    token:'radial-gradient(circle at 38% 32%,#222c34,#0c1116)', deadToken:'#14191e',
    tokenRing:'#00000088', tokenShadow:'#000', chip:'rgba(10,14,18,.8)',
    fogS:'repeating-linear-gradient(45deg,rgba(4,7,10,.86) 0 3px,rgba(4,7,10,.78) 3px 6px)', fogA:'rgba(5,8,11,.82)',
    font:'IBM Plex Mono', scan:true, mapPlaceholder:'Drop top-down map art',
  },
  minimal:{
    stage:'#eef1f4', asset:'#f5f7f9',
    grid:'#e2e6eb', bound:'#cbd2da', wallS:'#e6eaef', wallS2:'#c4ccd5',
    unitFill:'#ffffff', label:'#7b8590', ruler:'#aeb6bf', hpTrack:'#dde3ea', hpTrackA:'#eef2f6',
    terrain:'linear-gradient(135deg,#f1f4f7,#e9edf1)',
    terrainTex:'repeating-linear-gradient(45deg,rgba(0,0,0,.012) 0 2px,transparent 2px 7px)',
    terrainInset:'inset 0 0 0 1px #dfe4ea',
    wallA:'linear-gradient(180deg,#e4e9ef,#d3dae2)', wallEdge:'#f0f3f7', wallEdge2:'#c2cad3',
    wallShadow:'0 2px 5px -2px rgba(40,55,75,.18)', wallRadius:5,
    token:'#ffffff', deadToken:'#e8ecf0',
    tokenRing:'rgba(40,55,75,.12)', tokenShadow:'rgba(40,55,75,.22)', chip:'rgba(255,255,255,.88)',
    fogS:'repeating-linear-gradient(45deg,rgba(214,220,227,.94) 0 3px,rgba(214,220,227,.84) 3px 6px)', fogA:'rgba(226,231,236,.86)',
    font:'IBM Plex Mono', scan:false, mapPlaceholder:'Drop top-down map art',
  },
  retro:{
    stage:'#020803', asset:'#020803',
    grid:'#0b2a16', bound:'#1c5230', wallS:'#06200f', wallS2:'#1f8a4d',
    unitFill:'#03150a', label:'#36b86a', ruler:'#1f7a45', hpTrack:'#0b2a16', hpTrackA:'#03120a',
    terrain:'#030f07',
    terrainTex:'repeating-linear-gradient(0deg,rgba(57,255,136,.07) 0 1px,transparent 1px 3px)',
    terrainInset:'inset 0 0 0 1px #145c30, inset 0 0 40px rgba(0,0,0,.7)',
    wallA:'linear-gradient(180deg,#0a2c16,#04140a)', wallEdge:'#1f8a4d', wallEdge2:'#031008',
    wallShadow:'0 0 6px -1px rgba(57,255,136,.3)', wallRadius:0,
    token:'#03150a', deadToken:'#08180e',
    tokenRing:'rgba(57,255,136,.3)', tokenShadow:'rgba(0,0,0,.8)', chip:'rgba(2,8,3,.82)',
    fogS:'repeating-linear-gradient(0deg,rgba(2,8,3,.9) 0 2px,rgba(2,8,3,.78) 2px 4px)', fogA:'rgba(2,8,3,.85)',
    font:'Share Tech Mono', scan:true, mapPlaceholder:'> DROP MAP FEED',
  },
};

/* ==================== MATH ==================== */
function lerp(a, b, u) { return a + (b - a) * u; }

function samplePath(path, u) {
  if (path.length === 1) return { x: path[0][0], y: path[0][1], ang: 0 };
  u = Math.max(0, Math.min(1, u));
  const segs = []; let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const d = Math.hypot(path[i+1][0]-path[i][0], path[i+1][1]-path[i][1]);
    segs.push(d); total += d;
  }
  let dist = u * total;
  for (let i = 0; i < segs.length; i++) {
    if (dist <= segs[i] || i === segs.length - 1) {
      const t = segs[i] === 0 ? 0 : dist / segs[i];
      const x = lerp(path[i][0], path[i+1][0], t), y = lerp(path[i][1], path[i+1][1], t);
      const ang = Math.atan2(path[i+1][1]-path[i][1], path[i+1][0]-path[i][0]);
      return { x, y, ang };
    }
    dist -= segs[i];
  }
  const n = path.length - 1;
  return { x: path[n][0], y: path[n][1], ang: 0 };
}

// world → screen transform. By default the whole world is scaled to fit the padded box and
// centred in it. `opts.scale` (px per world unit) and `opts.center` (the world point to put
// at the box's middle) override that for the zoom/pan controls — see Battlefield.vue.
function makeFitter(world, box, pad, opts) {
  pad = pad || 0;
  const bw = box.w - pad*2, bh = box.h - pad*2;
  const s = (opts && opts.scale) || Math.min(bw / world.w, bh / world.h);
  const cx = opts && opts.center ? opts.center.x : world.w/2;
  const cy = opts && opts.center ? opts.center.y : world.h/2;
  const ox = pad + bw/2 - cx*s, oy = pad + bh/2 - cy*s;
  return { s, x: (wx) => ox + wx*s, y: (wy) => oy + wy*s, len: (w) => w*s };
}

/* ==================== UNIT MARKER SHAPES ==================== */
// Generic markers (see SchematicLayer/IsoLayer's facingActive — shown instead of a letter
// once a game's facing arrow is on) still need to tell unit types apart at a glance. Hashing
// the type name into a small shape palette does that with zero per-game configuration,
// instead of hand-authoring a shape table per game (see feedback_generic_difficulty: prefer
// one generic algorithm over per-case special-casing).
const MARKER_SHAPES = ['dot', 'square', 'diamond', 'triangle', 'star', 'ring', 'hex'];

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

function markerShapeFor(type) {
  return MARKER_SHAPES[hashStr(String(type)) % MARKER_SHAPES.length];
}

// Vertices of a regular polygon centred on the origin, `rotationDeg` pointing the first
// vertex (default: straight up, matching how a triangle/star/hex "point" reads visually).
function regularPolygonPoints(r, sides, rotationDeg) {
  const rot = ((rotationDeg ?? -90) * Math.PI) / 180;
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = rot + (i * 2 * Math.PI) / sides;
    pts.push(`${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

function starPoints(rOuter, rInner, points) {
  points = points ?? 5;
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    pts.push(`${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

// Render spec for a marker shape at bounding radius `r`: a single <circle> ('circle'), an
// outer ring + inner dot ('ring'), or a single <polygon> ('polygon', points precomputed).
function markerGlyph(shape, r) {
  if (shape === 'ring')     return { kind: 'ring', rOuter: r, rInner: r * 0.42 };
  if (shape === 'square')   return { kind: 'polygon', points: regularPolygonPoints(r * 0.95, 4, 45) };
  if (shape === 'diamond')  return { kind: 'polygon', points: regularPolygonPoints(r, 4, -90) };
  if (shape === 'triangle') return { kind: 'polygon', points: regularPolygonPoints(r * 1.05, 3, -90) };
  if (shape === 'hex')      return { kind: 'polygon', points: regularPolygonPoints(r, 6, -90) };
  if (shape === 'star')     return { kind: 'polygon', points: starPoints(r * 1.15, r * 0.48, 5) };
  return { kind: 'circle', r };
}

/* ==================== UNIT SIMULATION ==================== */
// `viewerTeamId` (optional) is the team seen as "friendly" — normally the local
// player (teams[0]), but an observer watching through another player's eyes passes
// that player's id so vision/visibility resolve from their perspective instead.
function computeUnits(field, t, viewerTeamId) {
  const T = field.turns - 1;
  const friendly = viewerTeamId ?? field.teams[0].id;
  const ft = Math.floor(Math.min(t, T));
  const arr = field.units.map(u => {
    const here = samplePath(u.path, t / T);
    const next  = samplePath(u.path, Math.min(ft+1, T) / T);
    const dead = u.deathTurn != null && t >= u.deathTurn;
    let hpNow = u.hp;
    if (dead) hpNow = 0;
    else if (u.deathTurn != null && t > u.deathTurn - 2)
      hpNow = Math.max(4, u.hp * (1 - (t - (u.deathTurn-2)) / 2));
    const team = field.teams.find(tm => tm.id === u.team);
    const ang = u.path.length === 1 && u.facing != null ? u.facing : here.ang;
    return { ...u, x: here.x, y: here.y, ang, next, dead, hpNow, hpMax: u.hp, teamObj: team, friendly: u.team === friendly };
  });
  const sight = field.world.w * 0.2;
  const friends = arr.filter(u => u.friendly && !u.dead);
  arr.forEach(u => {
    u.visible = u.friendly ? true : friends.some(f => Math.hypot(f.x-u.x, f.y-u.y) < sight);
  });
  return arr;
}

/* ==================== EXPOSE GLOBALS ==================== */
Object.assign(window, {
  ICON_PATHS, RDR,
  computeUnits, makeFitter, samplePath, lerp,
  markerShapeFor, markerGlyph,
});
