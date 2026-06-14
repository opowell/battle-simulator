// data.js — sets globals on window. Loaded as a plain <script> tag.

/* ==================== ICON PATHS ==================== */
const ICON_PATHS = {
  crosshair:'M12 2v4M12 18v4M2 12h4M18 12h4 M12 8a4 4 0 100 8 4 4 0 000-8z',
  zap:'M13 2L4 14h6l-1 8 9-12h-6z',
  shield:'M12 3l7 3v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6z',
  grid:'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  tank:'M3 14h18v4H3zM6 14v-3h10v3M9 8h4v3H9zM7 18l-1 3M17 18l1 3',
  sword:'M14 3h7v7l-9 9-3-3zM5 13l-2 2 4 4 2-2M14 10l-4 4',
  crown:'M4 18h16M4 18l-1-9 5 4 4-7 4 7 5-4-1 9',
  globe:'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  flag:'M5 21V4M5 4h11l-2 4 2 4H5',
  wand:'M15 4V2M15 10v-2M19 6h2M9 6h2M15 6l6 14M6 21l9-9',
  cards:'M8 6h10v12H8zM5 9v9h9M8 10h4M8 13h6',
  flame:'M12 3c1 4 5 5 5 9a5 5 0 01-10 0c0-2 1-3 2-4 0 1 1 2 2 2 0-3-1-5-1-7z',
  play:'M7 5l12 7-12 7z',
  pause:'M7 5h3v14H7zM14 5h3v14h-3z',
  step:'M5 5v14M9 12l9-7v14z',
  stepb:'M19 5v14M15 12L6 5v14z',
  back:'M15 5l-7 7 7 7',
  clock:'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
  plus:'M12 5v14M5 12h14',
  trash:'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13',
  fog:'M4 15h16M6 18h12M8 11a4 4 0 018 0M5 11h14',
  target:'M12 3a9 9 0 100 18 9 9 0 000-18zM12 8a4 4 0 100 8 4 4 0 000-8zM12 11a1 1 0 100 2 1 1 0 000-2',
  move:'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3',
  eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z',
  check:'M5 12l5 5 9-11',
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
    font:'IBM Plex Mono', scan:true,
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
    font:'IBM Plex Mono', scan:false,
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
    font:'Share Tech Mono', scan:true,
  },
};

/* ==================== GAME CATALOG ==================== */
const GAMES = [
  { key:'cs',           name:'Counter-Strike',   icon:'crosshair', min:2, max:10, multi:true,  time:'continuous', grid:'free', cat:'Tactical FPS',  blurb:'5v5 bomb defusal. Continuous-time positions, sight lines, utility.' },
  { key:'sc2',          name:'StarCraft II',     icon:'zap',       min:2, max:8,  multi:true,  time:'continuous', grid:'free', cat:'RTS',           blurb:'Macro + micro. Economy, tech, and army control over open terrain.' },
  { key:'sc1',          name:'StarCraft',        icon:'zap',       min:2, max:8,  multi:true,  time:'continuous', grid:'free', cat:'RTS',           blurb:'The original. Three asymmetric factions, real-time engagements.' },
  { key:'xcom',         name:'XCOM',             icon:'shield',    min:1, max:2,  multi:false, time:'discrete',   grid:'square', cat:'Turn tactics', blurb:'Squad-based grid combat. Cover, overwatch, percentage-to-hit.' },
  { key:'tactical',     name:'Tactical Combat',  icon:'grid',      min:2, max:4,  multi:true,  time:'discrete',   grid:'square', cat:'Turn tactics', blurb:'Generic grid skirmish. Move, attack, hold the line.' },
  { key:'combatmission',name:'Combat Mission',   icon:'tank',      min:2, max:2,  multi:true,  time:'continuous', grid:'free', cat:'Wargame',       blurb:'WeGo orders. Real-time resolution of squad and armour orders.' },
  { key:'ffta',         name:'FFT Advance',      icon:'sword',     min:1, max:4,  multi:true,  time:'discrete',   grid:'square', cat:'Turn tactics', blurb:'Job-class tactics on isometric grids. Action timers, terrain.' },
  { key:'chess',        name:'Chess',            icon:'crown',     min:2, max:2,  multi:true,  time:'discrete',   grid:'square', cat:'Abstract',      blurb:'The canonical perfect-information game. Two players, 64 squares.' },
  { key:'risk',         name:'Risk',             icon:'globe',     min:2, max:6,  multi:true,  time:'discrete',   grid:'region', cat:'Strategy',      blurb:'Territory control across a world map. Reinforce, attack, fortify.' },
  { key:'axisallies',   name:'Axis & Allies',    icon:'globe',     min:2, max:5,  multi:true,  time:'discrete',   grid:'region', cat:'Strategy',      blurb:'WWII grand strategy. Production, combined-arms, alliances.' },
  { key:'civ1',         name:'Civilization',     icon:'flag',      min:1, max:7,  multi:true,  time:'discrete',   grid:'square', cat:'4X',            blurb:'Found cities, research tech, build wonders across the ages.' },
  { key:'civ2',         name:'Civilization II',  icon:'flag',      min:1, max:7,  multi:true,  time:'discrete',   grid:'square', cat:'4X',            blurb:'Deeper diplomacy and combat on an isometric world.' },
  { key:'aow',          name:'Age of Wonders',   icon:'wand',      min:1, max:8,  multi:true,  time:'discrete',   grid:'hex',  cat:'4X',            blurb:'Fantasy empires, heroes, and tactical battles on hex maps.' },
  { key:'cardbattle',   name:'Card Battle',      icon:'cards',     min:2, max:2,  multi:true,  time:'discrete',   grid:'none', cat:'Card',          blurb:'Deck-driven duel. Play cards, manage resources, reduce HP to 0.' },
  { key:'doom',         name:'Doom',             icon:'flame',     min:1, max:4,  multi:true,  time:'continuous', grid:'free', cat:'Arena',         blurb:'First-person arena translated to a top-down sim. Rip and tear.' },
  { key:'kdice',        name:'KDice',            icon:'globe',     min:2, max:6,  multi:true,  time:'discrete',   grid:'region', cat:'Dice',         blurb:'Roll dice to conquer territories. Highest stack wins each attack.' },
  { key:'mudandblood',  name:'Mud and Blood',    icon:'shield',    min:1, max:1,  multi:false, time:'discrete',   grid:'square', cat:'Defense',      blurb:'Hold the trench line. German waves escalate until someone breaks.' },
];

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

function makeFitter(world, box, pad) {
  pad = pad || 0;
  const bw = box.w - pad*2, bh = box.h - pad*2;
  const s = Math.min(bw / world.w, bh / world.h);
  const ox = pad + (bw - world.w*s)/2, oy = pad + (bh - world.h*s)/2;
  return { s, x: (wx) => ox + wx*s, y: (wy) => oy + wy*s, len: (w) => w*s };
}

/* ==================== UNIT SIMULATION ==================== */
function computeUnits(field, t) {
  const T = field.turns - 1;
  const friendly = field.teams[0].id;
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
    return { ...u, x: here.x, y: here.y, ang: here.ang, next, dead, hpNow, hpMax: u.hp, teamObj: team, friendly: u.team === friendly };
  });
  const sight = field.world.w * 0.2;
  const friends = arr.filter(u => u.friendly && !u.dead);
  arr.forEach(u => {
    u.visible = u.friendly ? true : friends.some(f => Math.hypot(f.x-u.x, f.y-u.y) < sight);
  });
  return arr;
}

/* ==================== BATTLEFIELDS ==================== */
const CS_FIELD = {
  game:'cs', label:'de_mirage · Round 22 · 11v10', world:{ w:128, h:84 }, turns:8, grid:'free',
  teams:[
    { id:'ct', name:'Vitality (CT)', color:'var(--teamA)', raw:'#4f9dff', score:11 },
    { id:'t',  name:'NaVi (T)',      color:'var(--teamB)', raw:'#ff5f56', score:10 },
  ],
  walls:[
    [10,8,8,30],[24,6,30,7],[20,30,16,6],[58,10,7,26],
    [70,40,30,7],[40,52,8,24],[78,58,30,7],[96,18,8,34],
    [54,62,16,7],[24,52,8,20],[44,18,14,8],[66,62,10,6],
    [32,40,8,6],[86,52,8,8],
  ],
  zones:[
    { x:84,y:8, w:40,h:32, kind:'site',  label:'BOMBSITE A' },
    { x:4, y:52,w:38,h:28, kind:'site',  label:'BOMBSITE B' },
    { x:110,y:58,w:16,h:24,kind:'spawn', label:'CT Spawn' },
    { x:2, y:4, w:14,h:22, kind:'spawn', label:'T Spawn' },
    { x:48,y:32,w:28,h:18, kind:'objective', label:'MID / WINDOW' },
  ],
  units:[
    { id:'ct1', team:'ct', type:'rifler',  name:'ZywOo',   hp:100, path:[[112,62],[94,50],[78,44],[92,18]] },
    { id:'ct2', team:'ct', type:'rifler',  name:'apEX',    hp:100, path:[[114,68],[96,60],[72,56],[48,58]] },
    { id:'ct3', team:'ct', type:'awper',   name:'mezii',   hp:85,  path:[[116,72],[100,66],[82,68],[60,68]] },
    { id:'ct4', team:'ct', type:'support', name:'Spinx',   hp:100, path:[[118,66],[102,54],[80,50],[58,48]] },
    { id:'ct5', team:'ct', type:'entry',   name:'flameZ',  hp:55,  path:[[112,64],[90,46],[70,38]], deathTurn:6 },
    { id:'t1',  team:'t',  type:'awper',   name:'s1mple',  hp:100, path:[[6,10],[28,28],[50,38],[62,34]] },
    { id:'t2',  team:'t',  type:'rifler',  name:'electroNic',hp:100,path:[[8,14],[30,32],[44,44],[20,58]] },
    { id:'t3',  team:'t',  type:'entry',   name:'b1t',     hp:100, path:[[5,18],[22,38],[30,54],[16,66]] },
    { id:'t4',  team:'t',  type:'rifler',  name:'Ax1Le',   hp:40,  path:[[9,12],[32,34],[52,42]], deathTurn:5 },
    { id:'t5',  team:'t',  type:'support', name:'jL',      hp:100, path:[[6,22],[24,42],[28,60],[22,72]] },
  ],
};

const SC2_FIELD = {
  game:'sc2', label:'Cosmic Sapphire · 1v1 · 10:17', world:{ w:160, h:104 }, turns:9, grid:'free',
  teams:[
    { id:'p1', name:'Terran',  color:'var(--teamA)', raw:'#4f9dff', score:0 },
    { id:'p2', name:'Zerg',    color:'var(--teamB)', raw:'#ff5f56', score:0 },
  ],
  walls:[[70,0,8,28],[82,76,8,28],[40,48,12,8],[108,48,12,8],[74,46,12,12]],
  zones:[
    { x:4, y:4, w:32,h:24,   kind:'resource',  label:'TERRAN MAIN ◇' },
    { x:120,y:76,w:34,h:24,  kind:'resource',  label:'ZERG MAIN ◇' },
    { x:62,y:40,w:34,h:22,   kind:'objective', label:"XEL'NAGA TOWER" },
    { x:14,y:72,w:28,h:20,   kind:'resource',  label:'NAT ◇' },
    { x:114,y:10,w:28,h:20,  kind:'resource',  label:'NAT ◇' },
    { x:38,y:24,w:20,h:14,   kind:'resource',  label:'3rd ◇' },
  ],
  units:[
    { id:'m1', team:'p1', type:'marine',    name:'Marine',    hp:45,  path:[[28,22],[56,42],[74,52],[80,56]] },
    { id:'m2', team:'p1', type:'marine',    name:'Marine',    hp:45,  path:[[30,26],[58,46],[76,54],[82,58]] },
    { id:'m3', team:'p1', type:'marine',    name:'Marine',    hp:45,  path:[[24,28],[54,48],[72,56],[78,60]] },
    { id:'m4', team:'p1', type:'marine',    name:'Marine',    hp:45,  path:[[32,24],[60,44],[78,52],[84,56]] },
    { id:'m5', team:'p1', type:'marauder',  name:'Marauder',  hp:125, path:[[26,32],[62,50],[80,58],[86,62]] },
    { id:'m6', team:'p1', type:'marauder',  name:'Marauder',  hp:125, path:[[28,36],[64,54],[82,60]] },
    { id:'m7', team:'p1', type:'medivac',   name:'Medivac',   hp:150, path:[[18,20],[50,38],[70,48],[78,54]] },
    { id:'m8', team:'p1', type:'tank',      name:'Siege Tank',hp:175, path:[[22,26],[52,44],[68,54]] },
    { id:'m9', team:'p1', type:'marine',    name:'Marine',    hp:25,  path:[[34,22],[64,42],[80,50]], deathTurn:7 },
    { id:'z1', team:'p2', type:'ling',      name:'Zergling',  hp:35,  path:[[136,84],[104,64],[88,56],[82,54]] },
    { id:'z2', team:'p2', type:'ling',      name:'Zergling',  hp:35,  path:[[138,80],[106,62],[90,54],[84,52]] },
    { id:'z3', team:'p2', type:'ling',      name:'Zergling',  hp:35,  path:[[134,88],[102,66],[86,58],[80,56]] },
    { id:'z4', team:'p2', type:'ling',      name:'Zergling',  hp:35,  path:[[140,82],[108,60],[92,52]] },
    { id:'z5', team:'p2', type:'ling',      name:'Zergling',  hp:20,  path:[[142,78],[110,58],[94,50]], deathTurn:6 },
    { id:'z6', team:'p2', type:'bane',      name:'Baneling',  hp:30,  path:[[138,86],[106,66],[90,58],[84,54]] },
    { id:'z7', team:'p2', type:'bane',      name:'Baneling',  hp:30,  path:[[136,82],[104,62],[88,56]] },
    { id:'z8', team:'p2', type:'roach',     name:'Roach',     hp:145, path:[[144,88],[110,68],[94,60],[86,56]] },
    { id:'z9', team:'p2', type:'roach',     name:'Roach',     hp:145, path:[[140,90],[106,70],[90,62]] },
    { id:'z10',team:'p2', type:'hydra',     name:'Hydralisk', hp:80,  path:[[144,84],[114,64],[98,56],[88,52]] },
  ],
};

/* ==================== STARCRAFT 1 ==================== */
const SC1_FIELD = {
  game:'sc1', label:'Lost Temple · 1v1 · 6:42', world:{ w:144, h:96 }, turns:8, grid:'free',
  teams:[
    { id:'t',  name:'Terran',  color:'var(--teamA)', raw:'#4f9dff', score:0 },
    { id:'z',  name:'Zerg',    color:'var(--teamB)', raw:'#ff5f56', score:0 },
  ],
  walls:[
    [64,0,6,24],[74,72,6,24],[34,42,8,6],[102,48,8,6],[66,38,12,12],
    [20,18,10,6],[110,70,10,6],[44,60,8,6],[90,30,8,6],
  ],
  zones:[
    { x:4,  y:4,  w:36,h:26, kind:'resource',  label:'TERRAN MAIN ◇' },
    { x:104,y:66, w:36,h:26, kind:'resource',  label:'ZERG MAIN ◇' },
    { x:4,  y:66, w:28,h:24, kind:'resource',  label:'NAT EXP ◇' },
    { x:112,y:4,  w:28,h:24, kind:'resource',  label:'NAT EXP ◇' },
    { x:60, y:36, w:24,h:24, kind:'objective', label:'CENTER' },
    { x:60, y:6,  w:24,h:16, kind:'resource',  label:'12 o\'clock ◇' },
    { x:60, y:74, w:24,h:16, kind:'resource',  label:'6 o\'clock ◇' },
  ],
  units:[
    { id:'ter1', team:'t', type:'marine',    name:'Marine',     hp:40,  path:[[22,20],[48,36],[62,44],[68,46]] },
    { id:'ter2', team:'t', type:'marine',    name:'Marine',     hp:40,  path:[[24,24],[50,38],[64,46],[70,48]] },
    { id:'ter3', team:'t', type:'marine',    name:'Marine',     hp:40,  path:[[20,28],[46,40],[60,48],[66,50]] },
    { id:'ter4', team:'t', type:'marine',    name:'Marine',     hp:40,  path:[[26,22],[52,36],[66,44],[72,46]] },
    { id:'ter5', team:'t', type:'medic',     name:'Medic',      hp:60,  path:[[18,22],[44,38],[58,46],[64,48]] },
    { id:'ter6', team:'t', type:'vulture',   name:'Vulture',    hp:80,  path:[[28,18],[56,32],[70,40],[76,44]] },
    { id:'ter7', team:'t', type:'vulture',   name:'Vulture',    hp:80,  path:[[30,22],[58,34],[72,42]] },
    { id:'ter8', team:'t', type:'siege',     name:'Siege Tank', hp:150, path:[[16,18],[40,34],[54,42]] },
    { id:'ter9', team:'t', type:'marine',    name:'Marine',     hp:25,  path:[[22,26],[48,42],[62,50]], deathTurn:6 },
    { id:'trp1', team:'t', type:'dropship',  name:'Dropship',   hp:150, path:[[14,14],[38,30],[56,40],[66,46]] },
    { id:'zrg1', team:'z', type:'zergling',  name:'Zergling',   hp:35,  path:[[120,74],[94,58],[78,50],[72,48]] },
    { id:'zrg2', team:'z', type:'zergling',  name:'Zergling',   hp:35,  path:[[122,70],[96,56],[80,48],[74,46]] },
    { id:'zrg3', team:'z', type:'zergling',  name:'Zergling',   hp:35,  path:[[118,78],[92,60],[76,52],[70,50]] },
    { id:'zrg4', team:'z', type:'zergling',  name:'Zergling',   hp:35,  path:[[124,72],[98,54],[82,46]] },
    { id:'zrg5', team:'z', type:'zergling',  name:'Zergling',   hp:20,  path:[[120,76],[94,60],[78,54]], deathTurn:5 },
    { id:'hyd1', team:'z', type:'hydralisk', name:'Hydralisk',  hp:80,  path:[[124,78],[98,62],[82,54],[76,50]] },
    { id:'hyd2', team:'z', type:'hydralisk', name:'Hydralisk',  hp:80,  path:[[126,74],[100,58],[84,50],[78,48]] },
    { id:'hyd3', team:'z', type:'hydralisk', name:'Hydralisk',  hp:80,  path:[[122,80],[96,64],[80,56]] },
    { id:'mut1', team:'z', type:'mutalisk',  name:'Mutalisk',   hp:120, path:[[128,70],[108,52],[90,44],[78,42]] },
    { id:'mut2', team:'z', type:'mutalisk',  name:'Mutalisk',   hp:120, path:[[130,66],[110,48],[92,40],[80,38]] },
  ],
};

const XCOM_FIELD = {
  game:'xcom', label:'Operation Iron Veil · Turn 3', world:{ w:16, h:11 }, turns:7, grid:'square',
  teams:[
    { id:'sol', name:'XCOM Squad', color:'var(--teamA)', raw:'#4f9dff', score:0 },
    { id:'adv', name:'ADVENT',     color:'var(--teamB)', raw:'#ff5f56', score:0 },
  ],
  walls:[[4,3,1,1],[5,3,1,1],[9,2,1,1],[10,6,1,1],[7,7,1,1],[3,7,1,1],[11,4,1,1],[6,5,1,1],[8,8,1,1],[13,5,1,1]],
  zones:[
    { x:0, y:8,w:5,h:3,  kind:'spawn',     label:'DEPLOY ZONE' },
    { x:12,y:0,w:4,h:3,  kind:'objective', label:'PRIMARY OBJ' },
    { x:0, y:0,w:4,h:4,  kind:'objective', label:'FLANK ROUTE' },
    { x:6, y:4,w:4,h:3,  kind:'resource',  label:'OVERWATCH RIDGE' },
  ],
  units:[
    { id:'s1', team:'sol', type:'ranger',       name:'Cpl. Vasquez', hp:6, path:[[1,9],[3,7],[5,5],[7,4]] },
    { id:'s2', team:'sol', type:'sharpshooter', name:'Sgt. Kovac',   hp:4, path:[[2,10],[2,8],[2,6],[2,4]] },
    { id:'s3', team:'sol', type:'grenadier',    name:'Spc. Diaz',    hp:7, path:[[0,10],[1,8],[3,8],[5,7]] },
    { id:'s4', team:'sol', type:'specialist',   name:'Cpl. Okoro',   hp:5, path:[[3,9],[5,7],[7,6],[9,5]] },
    { id:'a1', team:'adv', type:'trooper',      name:'ADVENT Trooper',hp:4,path:[[14,1],[12,3],[10,4],[8,5]] },
    { id:'a2', team:'adv', type:'trooper',      name:'ADVENT Trooper',hp:4,path:[[15,2],[13,4],[11,5],[9,6]] },
    { id:'a3', team:'adv', type:'sectoid',      name:'Sectoid',       hp:6,path:[[13,0],[11,2],[9,3],[7,4]] },
    { id:'a4', team:'adv', type:'trooper',      name:'ADVENT Trooper',hp:3,path:[[14,3],[12,5],[10,6]], deathTurn:5 },
    { id:'a5', team:'adv', type:'viper',        name:'Viper',         hp:8,path:[[15,4],[13,5],[11,6],[9,7]] },
  ],
};

function genericField(gameKey, label) {
  return {
    game: gameKey, label: label || 'Skirmish', world:{ w:20, h:13 }, turns:6, grid:'square',
    teams:[
      { id:'a', name:'Player 1', color:'var(--teamA)', raw:'#4f9dff', score:0 },
      { id:'b', name:'Player 2', color:'var(--teamB)', raw:'#ff5f56', score:0 },
    ],
    walls:[[9,5,2,3],[5,2,1,2],[14,8,2,1],[6,9,2,1],[13,2,1,2]],
    zones:[{ x:0,y:5,w:3,h:3,kind:'spawn',label:'P1'}, { x:17,y:5,w:3,h:3,kind:'spawn',label:'P2'}],
    units:[
      { id:'a1',team:'a',type:'unit',name:'Unit 1',hp:10,path:[[2,4],[7,6],[10,7]] },
      { id:'a2',team:'a',type:'unit',name:'Unit 2',hp:10,path:[[2,7],[6,8],[9,8]] },
      { id:'a3',team:'a',type:'unit',name:'Unit 3',hp:8, path:[[1,6],[5,6],[8,6]] },
      { id:'b1',team:'b',type:'unit',name:'Unit 1',hp:10,path:[[18,7],[13,6],[10,5]] },
      { id:'b2',team:'b',type:'unit',name:'Unit 2',hp:10,path:[[18,5],[14,5],[11,6]] },
      { id:'b3',team:'b',type:'unit',name:'Unit 3',hp:6, path:[[19,6],[15,7],[12,7]],deathTurn:4 },
    ],
  };
}

/* ==================== CHESS ==================== */
const CHESS_FIELD = {
  // Sicilian Dragon · Yugoslav Attack · Move 18
  // Board coords: x=file (0=a … 7=h), y=rank (0=rank8 top … 7=rank1 bottom)
  // Position: White has launched the Yugoslav Attack, Rd1→d7 swinging in,
  // Qa3 bearing on a7, Ne5 centralised. Black counter-attacks with Nd4 and Qd7,
  // rooks on c8/f8, Dragon bishop on g7.
  game:'chess', label:'Sicilian Dragon · Move 18', world:{w:8,h:8}, turns:5, grid:'square',
  teams:[
    {id:'w',name:'White',color:'var(--teamA)',raw:'#4f9dff',score:0},
    {id:'b',name:'Black',color:'var(--teamB)',raw:'#ff5f56',score:0},
  ],
  walls:[],
  zones:[],
  units:[
    // ── White pieces ──────────────────────────────────────────────────────────
    {id:'wK', team:'w',type:'king',  name:'K',hp:1,path:[[6.5,7.5]]},
    {id:'wQ', team:'w',type:'queen', name:'Q',hp:9,path:[[0.5,5.5],[0.5,4.5],[0.5,5.5]]},
    {id:'wR1',team:'w',type:'rook',  name:'R',hp:5,path:[[3.5,7.5],[3.5,6.5],[3.5,3.5],[3.5,1.5]]},
    {id:'wR2',team:'w',type:'rook',  name:'R',hp:5,path:[[4.5,7.5],[4.5,6.5],[4.5,7.5]]},
    {id:'wB1',team:'w',type:'bishop',name:'B',hp:3,path:[[1.5,5.5]]},
    {id:'wN1',team:'w',type:'knight',name:'N',hp:3,path:[[4.5,3.5],[3.5,5.5],[4.5,3.5]]},
    {id:'wN2',team:'w',type:'knight',name:'N',hp:3,path:[[1.5,7.5],[2.5,5.5]]},
    {id:'wp1',team:'w',type:'pawn',  name:'p',hp:1,path:[[0.5,6.5]]},
    {id:'wp2',team:'w',type:'pawn',  name:'p',hp:1,path:[[1.5,6.5]]},
    {id:'wp3',team:'w',type:'pawn',  name:'p',hp:1,path:[[2.5,6.5]]},
    {id:'wp4',team:'w',type:'pawn',  name:'p',hp:1,path:[[3.5,4.5]]},
    {id:'wp5',team:'w',type:'pawn',  name:'p',hp:1,path:[[2.5,4.5]]},
    {id:'wp6',team:'w',type:'pawn',  name:'p',hp:1,path:[[5.5,6.5]]},
    {id:'wp7',team:'w',type:'pawn',  name:'p',hp:1,path:[[6.5,6.5]]},
    {id:'wp8',team:'w',type:'pawn',  name:'p',hp:1,path:[[7.5,6.5]]},
    // ── Black pieces ──────────────────────────────────────────────────────────
    {id:'bK', team:'b',type:'king',  name:'K',hp:1,path:[[6.5,0.5]]},
    {id:'bQ', team:'b',type:'queen', name:'Q',hp:9,path:[[3.5,0.5],[3.5,1.5],[3.5,0.5]]},
    {id:'bR1',team:'b',type:'rook',  name:'R',hp:5,path:[[2.5,0.5],[2.5,1.5],[2.5,0.5]]},
    {id:'bR2',team:'b',type:'rook',  name:'R',hp:5,path:[[5.5,0.5]]},
    {id:'bB1',team:'b',type:'bishop',name:'B',hp:3,path:[[6.5,1.5]]},
    {id:'bB2',team:'b',type:'bishop',name:'B',hp:3,path:[[1.5,1.5]]},
    {id:'bN1',team:'b',type:'knight',name:'N',hp:3,path:[[2.5,2.5],[3.5,4.5],[2.5,2.5]]},
    {id:'bN2',team:'b',type:'knight',name:'N',hp:3,path:[[5.5,0.5],[7.5,3.5]]},
    {id:'bp1',team:'b',type:'pawn',  name:'p',hp:1,path:[[0.5,1.5]]},
    {id:'bp2',team:'b',type:'pawn',  name:'p',hp:1,path:[[1.5,1.5]]},
    {id:'bp3',team:'b',type:'pawn',  name:'p',hp:1,path:[[2.5,3.5]]},
    {id:'bp4',team:'b',type:'pawn',  name:'p',hp:1,path:[[3.5,2.5]]},
    {id:'bp5',team:'b',type:'pawn',  name:'p',hp:1,path:[[5.5,1.5]]},
    {id:'bp6',team:'b',type:'pawn',  name:'p',hp:1,path:[[6.5,2.5]]},
    {id:'bp7',team:'b',type:'pawn',  name:'p',hp:1,path:[[7.5,1.5]]},
  ],
};

/* ==================== RISK ==================== */
const RISK_FIELD = {
  game:'risk', label:'World Domination · Turn 8', world:{w:120,h:80}, turns:8, grid:'free',
  teams:[
    {id:'r',name:'Red Empire',   color:'var(--teamA)',raw:'#ff5f56',score:11},
    {id:'b',name:'Blue Kingdom', color:'var(--teamB)',raw:'#4f9dff',score:12},
    {id:'g',name:'Green Republic',color:'var(--teamC)',raw:'#46d39a',score:9},
    {id:'y',name:'Yellow Horde', color:'var(--teamD)',raw:'#f2b441',score:10},
  ],
  walls:[],
  zones:[
    {x:2,  y:6,  w:32,h:30,kind:'resource',  label:'North America'},
    {x:6,  y:38, w:22,h:28,kind:'resource',  label:'South America'},
    {x:34, y:4,  w:24,h:26,kind:'resource',  label:'Europe'},
    {x:34, y:32, w:26,h:36,kind:'resource',  label:'Africa'},
    {x:58, y:2,  w:44,h:42,kind:'resource',  label:'Asia'},
    {x:84, y:48, w:32,h:28,kind:'resource',  label:'Australia'},
    // chokepoint objectives
    {x:22, y:2,  w:10,h:6, kind:'objective', label:'Alaska–Kamchatka'},
    {x:34, y:2,  w:10,h:6, kind:'objective', label:'Greenland–Iceland'},
    {x:50, y:34, w:12,h:6, kind:'objective', label:'Egypt–Middle East'},
    {x:84, y:44, w:12,h:6, kind:'objective', label:'Siam Gate'},
  ],
  units:[
    // Red Empire — controls N.America, pushing into Europe via Greenland
    {id:'r1',team:'r',type:'army',name:'10 inf',   hp:10,path:[[14,18],[16,20],[18,22]]},
    {id:'r2',team:'r',type:'army',name:'8 cav',    hp:8, path:[[26,10],[28,12],[30,14]]},
    {id:'r3',team:'r',type:'army',name:'6 art',    hp:6, path:[[8,48],[10,46],[12,44]]},
    {id:'r4',team:'r',type:'army',name:'9 inf',    hp:9, path:[[18,26],[20,22],[22,16],[24,8]]},
    // Blue Kingdom — holds Europe, probing Egypt and Africa
    {id:'b1',team:'b',type:'army',name:'12 armies',hp:12,path:[[42,12],[44,14],[46,16]]},
    {id:'b2',team:'b',type:'army',name:'8 cav',    hp:8, path:[[38,20],[40,22],[42,24]]},
    {id:'b3',team:'b',type:'army',name:'7 inf',    hp:7, path:[[50,36],[52,34],[54,32]]},
    {id:'b4',team:'b',type:'army',name:'9 inf',    hp:9, path:[[44,44],[48,38],[51,34]]},
    // Green Republic — controls Asia, pushing toward Europe and Egypt
    {id:'g1',team:'g',type:'army',name:'11 armies',hp:11,path:[[80,14],[78,16],[76,18]]},
    {id:'g2',team:'g',type:'army',name:'8 cav',    hp:8, path:[[68,8],[66,10],[64,12]]},
    {id:'g3',team:'g',type:'army',name:'7 art',    hp:7, path:[[92,18],[90,20],[88,22]]},
    {id:'g4',team:'g',type:'army',name:'5 inf',    hp:5, path:[[64,26],[62,28],[60,30]],deathTurn:6},
    // Yellow Horde — dominates Australia and SE Asia, surging north
    {id:'y1',team:'y',type:'army',name:'10 armies',hp:10,path:[[96,54],[94,52],[92,50]]},
    {id:'y2',team:'y',type:'army',name:'7 cav',    hp:7, path:[[106,62],[104,60],[102,58]]},
    {id:'y3',team:'y',type:'army',name:'6 inf',    hp:6, path:[[90,58],[92,54],[94,48]]},
    {id:'y4',team:'y',type:'army',name:'9 inf',    hp:9, path:[[102,46],[98,40],[94,34],[90,28]]},
  ],
};

/* ==================== AXIS & ALLIES ==================== */
const AXISALLIES_FIELD = {
  game:'axisallies', label:'1942.2 · Spring · Turn 4', world:{w:130,h:80}, turns:8, grid:'free',
  teams:[
    {id:'al',name:'Allies',color:'var(--teamA)',raw:'#4f9dff',score:0},
    {id:'ax',name:'Axis',  color:'var(--teamB)',raw:'#ff5f56',score:0},
  ],
  walls:[],
  zones:[
    {x:2, y:5, w:28,h:50,kind:'resource',  label:'Americas'},
    {x:30,y:5, w:35,h:28,kind:'objective', label:'Europe / Atlantic'},
    {x:30,y:33,w:28,h:36,kind:'resource',  label:'Africa'},
    {x:58,y:5, w:40,h:35,kind:'objective', label:'USSR / Eastern Front'},
    {x:80,y:32,w:28,h:26,kind:'resource',  label:'Middle East'},
    {x:95,y:4, w:34,h:50,kind:'resource',  label:'Pacific Theater'},
    // key objectives
    {x:50,y:6, w:14,h:8, kind:'objective', label:'Berlin ★'},
    {x:112,y:6,w:14,h:8, kind:'objective', label:'Tokyo ★'},
    {x:2, y:54,w:18,h:12,kind:'objective', label:'Pearl Harbor'},
    {x:106,y:42,w:20,h:16,kind:'objective',label:'Philippines'},
    {x:30,y:6, w:12,h:8, kind:'objective', label:'Atlantic Convoy'},
    {x:94,y:30,w:14,h:8, kind:'resource',  label:'Marianas'},
  ],
  units:[
    // Allies — counteroffensive momentum across all fronts
    {id:'al1',team:'al',type:'infantry',name:'US Marines',     hp:10,path:[[8,56],[12,52],[16,46],[20,40]]},
    {id:'al2',team:'al',type:'infantry',name:'UK Infantry',    hp:9, path:[[34,42],[36,38],[40,34],[44,30]]},
    {id:'al3',team:'al',type:'infantry',name:'Soviet 62nd',    hp:18,path:[[80,14],[76,16],[72,18],[68,22]]},
    {id:'al4',team:'al',type:'fleet',   name:'USN Pacific Fleet',hp:12,path:[[6,60],[10,56],[16,50],[22,44]]},
    {id:'al5',team:'al',type:'fleet',   name:'HMS Royal Navy',  hp:8, path:[[28,46],[30,42],[32,38],[34,34]]},
    {id:'al6',team:'al',type:'infantry',name:'UK N.Africa',    hp:8, path:[[38,50],[40,46],[44,42],[48,38]]},
    {id:'al7',team:'al',type:'armor',   name:'Soviet Armor',   hp:14,path:[[84,10],[80,12],[76,14],[72,16]]},
    // Axis — overstretched, falling back on two fronts; Japan still expanding
    {id:'ax1',team:'ax',type:'infantry',name:'Wehrmacht Ost',  hp:12,path:[[62,18],[60,22],[58,26],[56,30]]},
    {id:'ax2',team:'ax',type:'armor',   name:'6. Panzer-Armee',hp:10,path:[[68,10],[66,14],[64,18],[62,22]]},
    {id:'ax3',team:'ax',type:'armor',   name:'Africa Korps',   hp:8, path:[[50,36],[48,40],[46,44],[44,48]]},
    {id:'ax4',team:'ax',type:'fleet',   name:'IJN Kido Butai', hp:11,path:[[118,16],[116,22],[114,28],[112,34]]},
    {id:'ax5',team:'ax',type:'infantry',name:'IJA 25th Army',  hp:9, path:[[108,44],[110,48],[112,52],[114,56]]},
    {id:'ax6',team:'ax',type:'air',     name:'Luftwaffe',      hp:7, path:[[58,8],[56,12],[54,16],[52,20]]},
    {id:'ax7',team:'ax',type:'fleet',   name:'U-boat Wolf Pack',hp:6,path:[[32,18],[30,22],[28,26],[26,30]]},
    {id:'ax8',team:'ax',type:'fleet',   name:'IJN S.Pacific',  hp:5, path:[[116,52],[114,50],[112,48]],deathTurn:6},
  ],
};

/* ==================== COMBAT MISSION ==================== */
const COMBATMISSION_FIELD = {
  game:'combatmission', label:'Stalingrad · Oct 1942', world:{w:100,h:68}, turns:8, grid:'free',
  teams:[
    {id:'ger',name:'Wehrmacht',color:'var(--teamA)',raw:'#4f9dff',score:0},
    {id:'sov',name:'Red Army', color:'var(--teamB)',raw:'#ff5f56',score:0},
  ],
  walls:[
    [8,8,14,6],[8,14,4,18],[22,8,20,4],[44,6,6,22],[52,30,30,6],
    [16,38,10,8],[28,36,8,14],[38,48,18,6],[60,10,8,16],[70,20,12,6],
    [82,8,10,12],[58,50,20,8],[80,42,16,10],[6,50,10,12],[72,36,6,10],
  ],
  zones:[
    {x:0, y:28,w:12,h:12,kind:'spawn',     label:'GER start'},
    {x:88,y:28,w:12,h:12,kind:'spawn',     label:'SOV start'},
    {x:44,y:24,w:12,h:20,kind:'objective', label:'Depot'},
    {x:20,y:22,w:16,h:12,kind:'resource',  label:'Factory'},
    {x:60,y:32,w:14,h:12,kind:'resource',  label:'Ruins'},
    {x:30,y:10,w:10,h:8, kind:'objective', label:'MG Nest'},
    {x:62,y:48,w:10,h:8, kind:'resource',  label:"Sniper's Nest"},
  ],
  units:[
    {id:'g1',team:'ger',type:'rifleman',name:'Hans',    hp:3,path:[[10,30],[22,24],[38,26],[44,28]]},
    {id:'g2',team:'ger',type:'mg42',    name:'Klaus',   hp:3,path:[[12,34],[24,38],[38,38],[42,34]]},
    {id:'g3',team:'ger',type:'rifleman',name:'Werner',  hp:3,path:[[8,38],[18,44],[32,44],[40,40]]},
    {id:'g4',team:'ger',type:'sniper',  name:'Friedrich',hp:2,path:[[10,24],[26,18],[38,18]],deathTurn:6},
    {id:'g5',team:'ger',type:'pz4h',    name:'Pz.IVH', hp:10,path:[[6,30],[20,30],[36,28],[44,30]]},
    {id:'g6',team:'ger',type:'rifleman',name:'Dieter',  hp:3,path:[[11,36],[25,42],[40,42],[44,36]]},
    {id:'g7',team:'ger',type:'radioman',name:'Egon',    hp:2,path:[[8,26],[18,22],[30,22]],deathTurn:7},
    {id:'s1',team:'sov',type:'rifleman',name:'Ivan',    hp:3,path:[[90,32],[76,26],[60,26],[52,28]]},
    {id:'s2',team:'sov',type:'ppsh',    name:'Vasily',  hp:3,path:[[92,36],[78,42],[62,42],[54,36]]},
    {id:'s3',team:'sov',type:'rifleman',name:'Grigory', hp:3,path:[[90,40],[74,46],[58,46],[50,40]]},
    {id:'s4',team:'sov',type:'sniper',  name:'Dmitri',  hp:2,path:[[92,26],[78,20],[62,20]],deathTurn:5},
    {id:'s5',team:'sov',type:'t3485',   name:'T-34/85', hp:10,path:[[88,34],[72,34],[58,30],[50,32]]},
    {id:'s6',team:'sov',type:'rifleman',name:'Alexei',  hp:3,path:[[90,44],[76,50],[60,50],[52,44]]},
    {id:'s7',team:'sov',type:'mg',      name:'Nikolai', hp:3,path:[[92,30],[80,38],[64,38],[56,34]]},
  ],
};

/* ==================== FFTA ==================== */
const FFTA_FIELD = {
  game:'ffta', label:'Jagd Desert · Ch.5', world:{w:16,h:11}, turns:7, grid:'square',
  teams:[
    {id:'clan',name:'Clan Nutsy',  color:'var(--teamA)',raw:'#4f9dff',score:0},
    {id:'foe', name:'Clan Beoulve',color:'var(--teamB)',raw:'#ff5f56',score:0},
  ],
  walls:[[2,2,1,1],[6,3,1,1],[11,1,1,1],[1,6,1,1],[5,6,1,1],[12,5,1,1],[3,4,1,1],[9,5,1,1],[7,7,1,1],[13,3,1,1]],
  zones:[
    {x:0, y:7,w:4,h:4, kind:'spawn',     label:'Clan Nutsy'},
    {x:12,y:0,w:4,h:4, kind:'spawn',     label:'Clan Beoulve'},
    {x:6, y:4,w:4,h:3, kind:'objective', label:'Crystal Nexus'},
    {x:3, y:0,w:4,h:3, kind:'resource',  label:'Law Zone'},
    {x:9, y:7,w:4,h:3, kind:'resource',  label:'Judge Post'},
  ],
  units:[
    {id:'c1',team:'clan',type:'paladin',    name:'Marche',    hp:45,path:[[1,8],[3,6],[5,5],[7,5]]},
    {id:'c2',team:'clan',type:'wh mage',    name:'Ritz',      hp:30,path:[[0,9],[2,7],[4,6],[6,5]]},
    {id:'c3',team:'clan',type:'bl mage',    name:'Montblanc', hp:28,path:[[2,10],[4,8],[6,6],[8,5]]},
    {id:'c4',team:'clan',type:'warrior',    name:'Madue',     hp:38,path:[[1,9],[3,8],[4,7],[5,6]]},
    {id:'c5',team:'clan',type:'elementalist',name:'Shara',    hp:26,path:[[3,10],[5,9],[7,7],[8,6]]},
    {id:'f1',team:'foe', type:'assassin',   name:'Llednar',   hp:65,path:[[14,1],[12,3],[10,5],[8,6]]},
    {id:'f2',team:'foe', type:'sniper',     name:'Ezel',      hp:32,path:[[15,2],[13,4],[11,5],[9,6]]},
    {id:'f3',team:'foe', type:'bishop',     name:'Babus',     hp:28,path:[[14,3],[12,5],[10,6]]},
    {id:'f4',team:'foe', type:'dragoon',    name:'Bangaa Dg.',hp:40,path:[[13,1],[11,3],[9,5]],deathTurn:6},
  ],
};

/* ==================== AGE OF WONDERS ==================== */
const AOW_FIELD = {
  game:'aow', label:'Convergence · Turn 12', world:{w:26,h:18}, turns:8, grid:'hex',
  teams:[
    {id:'emp',name:'Empire',     color:'var(--teamA)',raw:'#4f9dff',score:18},
    {id:'dkf',name:'Dark Forest',color:'var(--teamB)',raw:'#ff5f56',score:14},
  ],
  walls:[[4,2,2,2],[9,4,2,2],[14,1,2,3],[18,6,2,2],[2,9,2,2],[16,9,2,3],[5,13,2,2],[20,3,2,2]],
  zones:[
    {x:0, y:0,  w:7,h:7,  kind:'spawn',     label:'Empire Citadel'},
    {x:19,y:11, w:7,h:7,  kind:'spawn',     label:'Shadowwood Lair'},
    {x:10,y:6,  w:6,h:6,  kind:'objective', label:'Ancient Wonder'},
    {x:0, y:10, w:5,h:5,  kind:'resource',  label:'Gold Mine'},
    {x:21,y:0,  w:5,h:5,  kind:'resource',  label:'Mana Node'},
    {x:11,y:0,  w:4,h:4,  kind:'resource',  label:'Watchtower'},
  ],
  units:[
    {id:'e1',team:'emp',type:'hero',      name:'Lord Ivar',  hp:90, path:[[2,4],[6,6],[10,7],[13,8]]},
    {id:'e2',team:'emp',type:'knight',    name:'Sir Leon',   hp:55, path:[[3,3],[7,5],[11,6],[13,7]]},
    {id:'e3',team:'emp',type:'knight',    name:'Sir Alric',  hp:55, path:[[1,5],[5,7],[9,8],[12,9]]},
    {id:'e4',team:'emp',type:'archer',    name:'Elwyn',      hp:30, path:[[4,2],[8,4],[12,6]]},
    {id:'e5',team:'emp',type:'drake',     name:'Emberstrike',hp:110,path:[[2,2],[7,4],[12,7],[14,8]]},
    {id:'e6',team:'emp',type:'catapult',  name:'Siege Eng.', hp:40, path:[[1,3],[5,5],[9,7]]},
    {id:'d1',team:'dkf',type:'skeleton',  name:'Boneguard',  hp:28, path:[[22,13],[18,11],[14,9],[12,8]]},
    {id:'d2',team:'dkf',type:'skeleton',  name:'Boneguard',  hp:28, path:[[23,14],[19,12],[15,10],[13,9]]},
    {id:'d3',team:'dkf',type:'shadow',    name:'Nightwhisper',hp:42,path:[[21,12],[17,10],[13,8],[11,7]]},
    {id:'d4',team:'dkf',type:'dark elf',  name:'Sylara',     hp:38, path:[[24,13],[20,11],[16,9]]},
    {id:'d5',team:'dkf',type:'warg',      name:'Deathjaw',   hp:32, path:[[22,15],[18,12],[14,10]]},
    {id:'d6',team:'dkf',type:'necromancer',name:'Malachar',  hp:60, path:[[23,12],[19,10],[15,8]],deathTurn:7},
  ],
};

/* ==================== DOOM ==================== */
const DOOM_FIELD = {
  game:'doom', label:'E1M7 · Computer Station', world:{w:96,h:64}, turns:8, grid:'free',
  teams:[
    {id:'marine',name:'Marine', color:'var(--teamA)',raw:'#4f9dff',score:0},
    {id:'demon', name:'Demons', color:'var(--teamB)',raw:'#ff5f56',score:0},
  ],
  walls:[
    // outer border
    [0,0,2,64],[94,0,2,64],[0,0,96,2],[0,62,96,2],
    // inner corridors and rooms
    [18,2,4,22],[18,28,4,14],[18,48,4,16],
    [74,2,4,22],[74,28,4,14],[74,48,4,16],
    [2,22,16,6],[26,22,44,6],[78,22,16,6],
    [2,36,16,6],[78,36,16,6],
    [38,36,20,4],[26,50,8,4],[62,50,8,4],
    [40,2,16,10],[40,52,16,10],
    [24,30,10,6],[62,30,10,6],
  ],
  zones:[
    {x:2,  y:2,  w:16,h:20, kind:'spawn',     label:'ENTRY'},
    {x:76, y:40, w:16,h:20, kind:'spawn',     label:'HELLGATE'},
    {x:40, y:28, w:16,h:10, kind:'objective', label:'CORE'},
    {x:2,  y:38, w:14,h:16, kind:'resource',  label:'ARMOR'},
    {x:80, y:2,  w:14,h:18, kind:'resource',  label:'PLASMA'},
    {x:40, y:44, w:16,h:8,  kind:'resource',  label:'HEALTH'},
    {x:22, y:10, w:14,h:10, kind:'resource',  label:'SHELLS'},
  ],
  units:[
    {id:'doomguy',team:'marine',type:'marine', name:'Doomguy',  hp:100,path:[[8,10],[20,18],[28,24],[36,30],[46,34],[54,30]]},
    {id:'imp1',   team:'demon', type:'imp',    name:'Imp',       hp:60, path:[[80,44],[66,38],[54,34],[46,34]]},
    {id:'imp2',   team:'demon', type:'imp',    name:'Imp',       hp:60, path:[[84,42],[70,36],[58,32],[48,32]]},
    {id:'imp3',   team:'demon', type:'imp',    name:'Imp',       hp:40, path:[[82,48],[68,40],[56,34]], deathTurn:5},
    {id:'pinky1', team:'demon', type:'pinky',  name:'Pinky',     hp:150,path:[[78,46],[64,40],[52,36],[44,34]]},
    {id:'pinky2', team:'demon', type:'pinky',  name:'Pinky',     hp:150,path:[[86,44],[72,38],[60,32],[50,30]]},
    {id:'caco1',  team:'demon', type:'caco',   name:'Cacodemon', hp:200,path:[[86,50],[74,42],[62,36],[52,32],[44,30]]},
    {id:'caco2',  team:'demon', type:'caco',   name:'Cacodemon', hp:200,path:[[90,46],[78,40],[66,34],[56,28]], deathTurn:7},
    {id:'baron',  team:'demon', type:'baron',  name:'Baron',     hp:400,path:[[88,52],[76,44],[64,38],[52,34],[42,30]]},
    {id:'revn1',  team:'demon', type:'revenant',name:'Revenant', hp:160,path:[[82,52],[70,46],[58,40],[48,36]]},
  ],
};

/* ==================== CIVILIZATION ==================== */
const CIV1_FIELD = {
  game:'civ1', label:'Ancient Era · 3000 BC', world:{w:36,h:22}, turns:8, grid:'square',
  teams:[
    {id:'rom',name:'Romans',   color:'var(--teamA)',raw:'#4f9dff',score:0},
    {id:'egy',name:'Egyptians',color:'var(--teamB)',raw:'#ff5f56',score:0},
  ],
  walls:[[14,4,2,2],[20,8,2,2],[9,13,2,2],[24,13,2,2],[15,11,2,2],[4,7,2,2],[28,4,2,2],[18,2,2,2],[6,16,2,2]],
  zones:[
    {x:0, y:0, w:12,h:11,kind:'resource', label:'Grassland'},
    {x:12,y:0, w:12,h:8, kind:'spawn',    label:'Plains'},
    {x:24,y:0, w:12,h:11,kind:'resource', label:'Desert'},
    {x:0, y:11,w:9, h:11,kind:'resource', label:'Forest'},
    {x:9, y:14,w:18,h:8, kind:'objective',label:'Hills (Contested)'},
    {x:27,y:11,w:9, h:11,kind:'resource', label:'Sea'},
    {x:0, y:16,w:8, h:6, kind:'resource', label:'Jungle'},
    {x:13,y:7, w:9, h:7, kind:'resource', label:'Mountains'},
    // cities — wider for visibility
    {x:2, y:1, w:6, h:4, kind:'objective',label:'Rome ★'},
    {x:27,y:1, w:6, h:4, kind:'objective',label:'Memphis ★'},
    // resource and neutral zones
    {x:2, y:13,w:6, h:4, kind:'resource', label:'River Tiber'},
    {x:27,y:13,w:5, h:4, kind:'resource', label:'River Nile'},
    {x:15,y:15,w:6, h:5, kind:'objective',label:'Barbarian Camp'},
  ],
  units:[
    // Romans — exploring outward from Rome, converging on the contested center
    {id:'rw1',team:'rom',type:'warrior', name:'Legio I',         hp:10,path:[[5,4],[8,6],[11,9],[14,12]]},
    {id:'rw2',team:'rom',type:'warrior', name:'Praetorian',      hp:10,path:[[5,5],[8,8],[11,10],[14,13]]},
    {id:'rs1',team:'rom',type:'settler', name:'Settler',         hp:5, path:[[4,3],[5,5],[7,7],[9,9]]},
    {id:'rh1',team:'rom',type:'horseman',name:'Equites',         hp:15,path:[[6,3],[10,5],[14,7],[17,10]]},
    // Egyptians — exploring outward from Memphis, units converging on the center
    {id:'ew1',team:'egy',type:'warrior', name:'Pharaoh Guard',   hp:10,path:[[30,3],[26,6],[22,9],[18,12]]},
    {id:'ew2',team:'egy',type:'warrior', name:'Nubian Spearman', hp:10,path:[[30,4],[26,7],[22,10],[19,13]]},
    {id:'es1',team:'egy',type:'settler', name:'Settler',         hp:5, path:[[32,5],[29,7],[26,9],[23,11]]},
    {id:'ec1',team:'egy',type:'chariot', name:'War Chariot',     hp:15,path:[[28,3],[24,5],[20,8],[17,11]]},
  ],
};

const CIV2_FIELD = {
  game:'civ2', label:'Medieval · 1200 AD', world:{w:40,h:26}, turns:8, grid:'square',
  teams:[
    {id:'eng',name:'English',color:'var(--teamA)',raw:'#4f9dff',score:0},
    {id:'fre',name:'French', color:'var(--teamB)',raw:'#ff5f56',score:0},
  ],
  walls:[[15,4,2,2],[22,11,2,2],[9,15,2,2],[28,6,2,2],[11,9,2,2],[18,17,2,2],[30,4,2,2],[26,15,2,2],[19,7,2,2],[13,19,2,2]],
  zones:[
    {x:0, y:0, w:13,h:13,kind:'resource', label:'English Forests'},
    {x:13,y:0, w:14,h:13,kind:'objective',label:'Crusade Route'},
    {x:27,y:0, w:13,h:13,kind:'resource', label:'French Plains'},
    {x:0, y:13,w:11,h:13,kind:'spawn',    label:'English Highlands'},
    {x:11,y:13,w:18,h:13,kind:'resource', label:'Lowland Farms'},
    {x:29,y:13,w:11,h:13,kind:'resource', label:'Ocean'},
    // cities — wider for visibility
    {x:2, y:1, w:7, h:5, kind:'objective',label:'London ★'},
    {x:31,y:1, w:7, h:5, kind:'objective',label:'Paris ★'},
    // channel chokepoint
    {x:16,y:1, w:8, h:4, kind:'resource', label:'English Channel'},
    // fortifications
    {x:3, y:7, w:7, h:5, kind:'objective',label:'Castle Walls'},
    {x:30,y:7, w:8, h:5, kind:'objective',label:'Fortified Paris'},
    {x:13,y:10,w:14,h:6, kind:'resource', label:'Road to Calais'},
  ],
  units:[
    // English — a slow medieval march eastward; Knight leads, archers fan out
    {id:'ek1',team:'eng',type:'knight',    name:'Black Prince',  hp:20,path:[[7,5],[11,6],[15,8],[19,10]]},
    {id:'el1',team:'eng',type:'longbow',   name:'Longbowman',    hp:14,path:[[5,7],[8,8],[11,9],[15,11]]},
    {id:'el2',team:'eng',type:'longbow',   name:'Longbowman',    hp:14,path:[[4,9],[7,10],[10,11],[14,12]]},
    {id:'et1',team:'eng',type:'trebuchet', name:'Trebuchet',     hp:12,path:[[3,6],[5,7],[8,8],[12,9]]},
    {id:'em1',team:'eng',type:'manatarms', name:'Man-at-Arms',   hp:15,path:[[5,11],[8,12],[11,13],[15,14]]},
    // French — pushing west; Chevalier fast, support slogs behind
    {id:'fk1',team:'fre',type:'chevalier', name:'Chevalier',     hp:22,path:[[33,4],[29,6],[25,8],[21,10]]},
    {id:'fx1',team:'fre',type:'crossbow',  name:'Crossbowman',   hp:12,path:[[35,6],[31,8],[27,10],[23,12]]},
    {id:'fx2',team:'fre',type:'crossbow',  name:'Crossbowman',   hp:12,path:[[36,8],[32,10],[28,12],[24,14]]},
    {id:'fm1',team:'fre',type:'mangonel',  name:'Mangonel',      hp:10,path:[[34,5],[30,7],[26,9],[22,11]]},
    {id:'fp1',team:'fre',type:'peasant',   name:'Peasant Levy',  hp:8, path:[[35,9],[31,11],[27,13],[23,15]],deathTurn:6},
  ],
};

/* ==================== CARD BATTLE ==================== */
const CARDBATTLE_FIELD = {
  // Climactic duel — P2 is winning on life (3 vs 14) despite P1 board advantage.
  // P2's Dragon and Demon are doing direct damage while P1 swings back.
  // A Lightning Bolt resolves this turn, killing P2's Demon (deathTurn:4).
  game:'cardbattle', label:'Duel · Turn 12 · Life 3v14', world:{w:24,h:16}, turns:6, grid:'none',
  teams:[
    {id:'p1',name:'Kira (P1)',color:'var(--teamA)',raw:'#4f9dff',score:3},
    {id:'p2',name:'Vael (P2)',color:'var(--teamB)',raw:'#ff5f56',score:14},
  ],
  walls:[],
  zones:[
    {x:0, y:0,  w:20,h:2,  kind:'spawn',     label:'P1 hand'},
    {x:0, y:14, w:20,h:2,  kind:'spawn',     label:'P2 hand'},
    {x:20,y:0,  w:4, h:7,  kind:'resource',  label:'Graveyard'},
    {x:0, y:2,  w:20,h:5,  kind:'resource',  label:'P1 battlefield'},
    {x:0, y:9,  w:20,h:5,  kind:'resource',  label:'P2 battlefield'},
    {x:0, y:7,  w:10,h:2,  kind:'objective', label:'P1 Life · 3'},
    {x:10,y:7,  w:10,h:2,  kind:'objective', label:'P2 Life · 14'},
  ],
  units:[
    // P1 creatures — thematic fantasy board, attacking toward center
    {id:'p1c1',team:'p1',type:'creature',name:'Dragon Whelp', hp:6, path:[[3,4],[3,7],[3,5]]},
    {id:'p1c2',team:'p1',type:'creature',name:'Siege Rhino',  hp:5, path:[[8,4],[8,7],[8,5]]},
    {id:'p1c3',team:'p1',type:'creature',name:'Storm Mage',   hp:3, path:[[13,4],[13,6],[13,4]]},
    {id:'p1c4',team:'p1',type:'creature',name:'Iron Golem',   hp:9, path:[[18,4]]},
    // P2 creatures — bigger and more threatening, explain why P1 is losing life
    {id:'p2c1',team:'p2',type:'creature',name:'Inferno Drake',hp:8, path:[[4,11],[4,8],[4,10]]},
    {id:'p2c2',team:'p2',type:'creature',name:'Shadow Demon', hp:5, path:[[10,11],[10,9],[10,11]],deathTurn:4},
    {id:'p2c3',team:'p2',type:'creature',name:'Lich Lord',    hp:7, path:[[16,11],[16,9],[16,11]]},
    {id:'p2c4',team:'p2',type:'creature',name:'Void Titan',   hp:11,path:[[19,11]]},
    // Graveyard — already-dead cards represented as ghosts
    {id:'gy1',team:'p1',type:'spell',   name:'Lightning Bolt',hp:1, path:[[22,2]],deathTurn:0},
    {id:'gy2',team:'p2',type:'creature',name:'Zombie Horde',  hp:1, path:[[22,4]],deathTurn:0},
  ],
};

/* ==================== TACTICAL ==================== */
const TACTICAL_FIELD = {
  // Urban Assault · Turn 3
  // Blue Force assaults a fortified Red position in a ruined town.
  // Blue: frontal push (AR x2, HMG, Medic) + right flank (Sniper, AT Launcher).
  // Red: 2 riflemen hold the objective building, 1 flanker, 1 sniper, mortar in rear.
  // One Red rifleman is cut down in the assault (deathTurn:3).
  game:'tactical', label:'Urban Assault · Turn 3', world:{w:22,h:14}, turns:6, grid:'square',
  teams:[
    {id:'a',name:'Blue Force', color:'var(--teamA)',raw:'#4f9dff',score:0},
    {id:'b',name:'Red Force',  color:'var(--teamB)',raw:'#ff5f56',score:0},
  ],
  // walls — building rubble and cover; Red side has denser fortifications
  walls:[
    // Central ruined building (objective)
    [10,4,3,2],[10,8,3,2],
    // Left-flank cover
    [3,2,1,3],[6,5,1,2],
    // Right-flank rubble
    [4,9,2,1],[7,11,1,2],
    // Red forward fortifications
    [14,3,2,2],[14,9,2,2],[16,6,1,3],
    // Red rear bunker walls
    [18,2,2,4],[18,8,2,4],
  ],
  zones:[
    {x:0, y:3, w:3,h:8,  kind:'spawn',     label:'Blue Staging'},
    {x:19,y:2, w:3,h:10, kind:'spawn',     label:'Red Rear'},
    {x:9, y:3, w:5,h:8,  kind:'objective', label:'Crossroads'},
    {x:5, y:0, w:7,h:3,  kind:'resource',  label:'Flank Route'},
    {x:5, y:11,w:7,h:3,  kind:'resource',  label:'Flank Route'},
    {x:13,y:5, w:4,h:4,  kind:'objective', label:'Red Defensive Line'},
  ],
  units:[
    // Blue Force — frontal assault element
    {id:'a1',team:'a',type:'assault_rifle',name:'Sgt. Torres',  hp:10,path:[[1,5],[5,6],[8,6],[10,6]]},
    {id:'a2',team:'a',type:'assault_rifle',name:'Cpl. Raines',  hp:10,path:[[1,8],[5,8],[8,8],[10,8]]},
    {id:'a3',team:'a',type:'hmg',          name:'PFC Osei',     hp:12,path:[[1,6],[4,6],[7,6]]},
    {id:'a4',team:'a',type:'medic',        name:'Doc Vela',     hp:7, path:[[1,7],[3,7],[6,7]]},
    // Blue Force — flanking element (right flank, approaches from south)
    {id:'a5',team:'a',type:'sniper',       name:'Cpl. Marz',    hp:8, path:[[1,12],[4,12],[7,11],[10,10]]},
    {id:'a6',team:'a',type:'at_launcher',  name:'Spc. Dunn',    hp:9, path:[[1,11],[4,11],[7,10],[9,9]]},
    // Red Force — defenders
    {id:'b1',team:'b',type:'rifleman',     name:'Pvt. Koval',   hp:10,path:[[15,6],[14,6],[15,6]]},
    {id:'b2',team:'b',type:'rifleman',     name:'Pvt. Brennan', hp:10,path:[[15,7],[14,7],[15,7]],deathTurn:3},
    {id:'b3',team:'b',type:'rifleman',     name:'Cpl. Sato',    hp:10,path:[[16,11],[15,10],[16,11]]},
    {id:'b4',team:'b',type:'sniper',       name:'Sgt. Voss',    hp:8, path:[[17,3],[17,4],[17,3]]},
    {id:'b5',team:'b',type:'mortar',       name:'Pvt. Holm',    hp:8, path:[[20,5],[20,6],[20,5]]},
  ],
};

/* ==================== KDICE ==================== */
const KDICE_FIELD = {
  game:'kdice', label:'World Conquest · Turn 6', world:{w:80,h:52}, turns:6, grid:'region',
  teams:[
    {id:'p1', name:'Blue',   color:'var(--teamA)', raw:'#4f9dff', score:8},
    {id:'p2', name:'Red',    color:'var(--teamB)', raw:'#ff5f56', score:6},
    {id:'p3', name:'Green',  color:'var(--teamC)', raw:'#46d39a', score:5},
    {id:'p4', name:'Yellow', color:'var(--teamD)', raw:'#f2b441', score:4},
  ],
  walls:[],
  zones:[
    {x:2,  y:2,  w:18,h:14, kind:'resource', label:'Northern Peaks'},
    {x:20, y:2,  w:16,h:12, kind:'resource', label:'Iron Coast'},
    {x:38, y:2,  w:14,h:12, kind:'resource', label:'Ember Vale'},
    {x:55, y:2,  w:24,h:14, kind:'resource', label:'Eastern Reach'},
    {x:2,  y:16, w:20,h:14, kind:'resource', label:'Westmarch'},
    {x:22, y:14, w:18,h:14, kind:'resource', label:'Heartlands'},
    {x:40, y:14, w:16,h:12, kind:'resource', label:'River Fords'},
    {x:56, y:16, w:22,h:12, kind:'resource', label:'Sunken Coast'},
    {x:2,  y:30, w:22,h:12, kind:'resource', label:'Southern Wilds'},
    {x:24, y:28, w:18,h:14, kind:'resource', label:'Dusty Plains'},
    {x:42, y:26, w:16,h:14, kind:'resource', label:'Scorched Moor'},
    {x:58, y:28, w:20,h:14, kind:'resource', label:'Twilight Shore'},
    {x:2,  y:42, w:26,h:8,  kind:'resource', label:'Deep South'},
    {x:28, y:42, w:22,h:8,  kind:'resource', label:'Barrens'},
    {x:50, y:42, w:28,h:8,  kind:'resource', label:'Far Reaches'},
  ],
  units:[
    // Blue — holds North and West
    {id:'u1', team:'p1', type:'stack', name:'6d', hp:6, path:[[11,9],[13,11]]},
    {id:'u2', team:'p1', type:'stack', name:'4d', hp:4, path:[[31,7],[29,9]]},
    {id:'u3', team:'p1', type:'stack', name:'7d', hp:7, path:[[12,23],[14,21]]},
    {id:'u4', team:'p1', type:'stack', name:'5d', hp:5, path:[[31,21],[33,23]]},
    // Red — holds East and South-East
    {id:'u5', team:'p2', type:'stack', name:'5d', hp:5, path:[[67,9],[65,11]]},
    {id:'u6', team:'p2', type:'stack', name:'3d', hp:3, path:[[47,8],[49,10]]},
    {id:'u7', team:'p2', type:'stack', name:'8d', hp:8, path:[[67,22],[65,20]]},
    {id:'u8', team:'p2', type:'stack', name:'2d', hp:2, path:[[65,35],[63,33]], deathTurn:4},
    // Green — holds Center and South
    {id:'u9',  team:'p3', type:'stack', name:'5d', hp:5, path:[[49,20],[51,22]]},
    {id:'u10', team:'p3', type:'stack', name:'6d', hp:6, path:[[13,36],[15,34]]},
    {id:'u11', team:'p3', type:'stack', name:'3d', hp:3, path:[[37,32],[39,34]]},
    {id:'u12', team:'p3', type:'stack', name:'4d', hp:4, path:[[37,47],[39,45]]},
    // Yellow — holds South-West and Far Reaches
    {id:'u13', team:'p4', type:'stack', name:'4d', hp:4, path:[[64,35],[62,37]]},
    {id:'u14', team:'p4', type:'stack', name:'7d', hp:7, path:[[64,47],[66,45]]},
    {id:'u15', team:'p4', type:'stack', name:'3d', hp:3, path:[[14,47],[16,45]]},
  ],
};

/* ==================== MUD AND BLOOD ==================== */
const MUDANDBLOOD_FIELD = {
  game:'mudandblood', label:'Hold the Line · Turn 4', world:{w:24,h:14}, turns:7, grid:'square',
  teams:[
    {id:'all', name:'Allies',  color:'var(--teamA)', raw:'#4f9dff', score:0},
    {id:'ger', name:'Germans', color:'var(--teamB)', raw:'#ff5f56', score:0},
  ],
  walls:[
    [3,4,1,6],
    [3,5,8,1],
    [3,9,8,1],
    [14,3,1,8],
    [14,4,4,1],
    [14,9,4,1],
  ],
  zones:[
    {x:0,  y:5,  w:3, h:4,  kind:'spawn',     label:'Trench'},
    {x:21, y:0,  w:3, h:14, kind:'spawn',     label:'German Entry'},
    {x:4,  y:5,  w:4, h:4,  kind:'objective', label:'Sandbags'},
    {x:10, y:4,  w:4, h:6,  kind:'objective', label:"No Man's Land"},
    {x:16, y:5,  w:4, h:4,  kind:'resource',  label:'Wire'},
  ],
  units:[
    // Allied units — holding the trench line
    {id:'al1', team:'all', type:'rifleman', name:'Tommy Cpl. Harris', hp:3, path:[[1,6],[1,7],[1,6]]},
    {id:'al2', team:'all', type:'rifleman', name:'Tommy Pvt. Miller', hp:3, path:[[2,8],[2,7],[2,8]]},
    {id:'al3', team:'all', type:'lewis',    name:'Lewis Gunner Webb', hp:3, path:[[6,7],[6,6],[6,7]]},
    {id:'al4', team:'all', type:'nco',      name:"NCO Sgt. O'Brien",  hp:4, path:[[5,6],[6,7],[5,6]]},
    {id:'al5', team:'all', type:'medic',    name:'Medic Pvt. Cross',  hp:2, path:[[1,7],[2,7],[1,7]]},
    // German units — attacking from the right
    {id:'ger1', team:'ger', type:'grenadier', name:'Schütze Braun',   hp:3, path:[[22,2],[19,4],[16,6],[13,7]]},
    {id:'ger2', team:'ger', type:'grenadier', name:'Uffz. Kraus',     hp:3, path:[[22,6],[19,6],[16,7],[13,8]]},
    {id:'ger3', team:'ger', type:'grenadier', name:'Obgfr. Wolff',    hp:3, path:[[22,10],[19,8],[16,9]], deathTurn:5},
    {id:'ger4', team:'ger', type:'mg42',      name:'MG42 Team Neumann',hp:4,path:[[22,4],[20,5],[18,6],[15,7]]},
    {id:'ger5', team:'ger', type:'feldwebel', name:'Fw. Fischer',     hp:4, path:[[22,8],[20,9],[18,8],[15,8]]},
    {id:'ger6', team:'ger', type:'grenadier', name:'Schütze Hahn',    hp:3, path:[[22,12],[20,11],[17,10],[14,9]]},
  ],
};

const BAKED_FIELDS = {
  cs:            CS_FIELD,
  sc2:           SC2_FIELD,
  sc1:           SC1_FIELD,
  xcom:          XCOM_FIELD,
  chess:         CHESS_FIELD,
  risk:          RISK_FIELD,
  axisallies:    AXISALLIES_FIELD,
  combatmission: COMBATMISSION_FIELD,
  ffta:          FFTA_FIELD,
  aow:           AOW_FIELD,
  doom:          DOOM_FIELD,
  civ1:          CIV1_FIELD,
  civ2:          CIV2_FIELD,
  cardbattle:    CARDBATTLE_FIELD,
  tactical:      TACTICAL_FIELD,
  kdice:         KDICE_FIELD,
  mudandblood:   MUDANDBLOOD_FIELD,
};

function fieldFor(gameKey) {
  if (BAKED_FIELDS[gameKey]) return BAKED_FIELDS[gameKey];
  const g = GAMES.find(x => x.key === gameKey);
  return genericField(gameKey, g ? g.name + ' · Skirmish' : 'Skirmish');
}

/* ==================== SCENARIOS ==================== */
const SCENARIOS = {
  cs:[
    { key:'vertigo', name:'de_vertigo',  sub:'Bomb defusal', blurb:'High-rise build site. Tight A, vertical mid into B.', players:10, maxTurns:30 },
    { key:'mirage',  name:'de_mirage',   sub:'Bomb defusal', blurb:'Desert classic. Whoever owns mid dictates the round.', players:10, maxTurns:30 },
    { key:'retake',  name:'A retake',    sub:'Custom drill', blurb:'Four CTs retake a planted bomb. 40-second fuse.',      players:8,  maxTurns:12, fog:false },
  ],
  sc2:[
    { key:'ladder', name:'Ladder 1v1',  sub:'Standard',   blurb:'Even spawns, full tech tree, macro to a timing push.', players:2, maxTurns:500 },
    { key:'allin',  name:'Proxy all-in',sub:'Asymmetric', blurb:'One side commits to an early rush. No safety net.',    players:2, maxTurns:200 },
    { key:'ffa4',   name:'4-way FFA',   sub:'Free-for-all',blurb:'Four mains, one map, last colony standing.',          players:4, maxTurns:500 },
  ],
  sc1:[
    { key:'ladder', name:'Lost Temple', sub:'Standard', blurb:'The original four-spawn classic. Scout to find them.', players:4, maxTurns:500 },
    { key:'duel',   name:'1v1 duel',    sub:'Standard', blurb:'Two-player macro game on a mirrored map.',             players:2, maxTurns:500 },
  ],
  xcom:[
    { key:'ironveil',name:'Iron Veil',  sub:'Story op', blurb:'Extract intel from an ADVENT blacksite before reinforcements.', players:2, maxTurns:40, fog:true },
    { key:'terror',  name:'Terror site',sub:'Defense',  blurb:'Hold a civilian block against waves. The clock is the enemy.',  players:2, maxTurns:30, fog:true },
    { key:'ambush',  name:'Cold ambush',sub:'Skirmish', blurb:'Squad caught in the open. Reach cover, turn it around.',        players:2, maxTurns:24, fog:true },
  ],
  chess:[
    { key:'standard',name:'Standard',  sub:'Classical',     blurb:'Full board, standard opening. Perfect information.', players:2, maxTurns:200, fog:false },
    { key:'960',     name:'Chess960',  sub:'Variant',        blurb:'Back-rank shuffled. Memorised theory goes out the window.', players:2, maxTurns:200, fog:false },
    { key:'endgame', name:'KQ vs KR',  sub:'Endgame drill',  blurb:'Queen-and-king technique against a lone rook.', players:2, maxTurns:60, fog:false },
  ],
  risk:[
    { key:'world',   name:'World domination',  sub:'Standard', blurb:'Classic six-continent map. Hold them all to win.', players:6, maxTurns:200 },
    { key:'capitals',name:'Capital conquest',  sub:'Short',    blurb:'Claim a capital each; take the rest to win early.', players:4, maxTurns:120 },
  ],
  doom:[
    { key:'invasion',  name:'Hell on Earth', sub:'Survival', blurb:'Endless demon spawns. Outlast the horde.', players:1, maxTurns:120, time:'continuous' },
    { key:'deathmatch',name:'Deathmatch',    sub:'Arena',    blurb:'Free-for-all frags in a tight arena. First to the cap.', players:4, maxTurns:80, time:'continuous' },
  ],
  kdice:[
    { key:'standard', name:'World Conquest', sub:'Standard',   blurb:'Balanced starting stacks. Spread across the globe and dominate.', players:4, maxTurns:60 },
    { key:'duel',     name:'1v1 Showdown',   sub:'Two player', blurb:'Head-to-head on a smaller map. Every territory matters.',         players:2, maxTurns:40 },
  ],
  mudandblood:[
    { key:'hold', name:'Hold the Line', sub:'Defense', blurb:'Survive 8 waves of escalating German pressure. No retreat.', players:1, maxTurns:80 },
    { key:'dawn', name:'Dawn Assault',  sub:'Hard',    blurb:'Larger waves, less supply. The fog is your only cover.',    players:1, maxTurns:60 },
  ],
};

function scenariosFor(gameKey) {
  if (SCENARIOS[gameKey]) return SCENARIOS[gameKey];
  const g = GAMES.find(x => x.key === gameKey) || { min: 2 };
  const base = Math.max(2, g.min);
  return [
    { key:'skirmish',  name:'Open skirmish', sub:'Standard',   blurb:'Symmetric forces, balanced start, fair fight.', players:base },
    { key:'assault',   name:'Assault',       sub:'Asymmetric', blurb:'One side attacks a dug-in, fortified position.', players:base },
    { key:'laststand', name:'Last stand',    sub:'Endurance',  blurb:'Hold the line against escalating pressure.', players:base },
  ];
}

/* ==================== LIVE SESSIONS ==================== */
const SESSIONS = [
  { id:'9f2a-1c', game:'cs',   status:'your-turn',   turn:14, max:30,  time:'continuous',
    players:[{id:'ct',name:'You',agent:'human',team:'ct',color:'var(--teamA)'},{id:'t',name:'NAVI-bot',agent:'ai',team:'t',color:'var(--teamB)'}], pending:'ct' },
  { id:'4b7e-22', game:'sc2',  status:'ai-thinking', turn:48, max:500, time:'continuous',
    players:[{id:'p1',name:'You',agent:'human',team:'p1',color:'var(--teamA)'},{id:'p2',name:'Hard AI',agent:'ai',team:'p2',color:'var(--teamB)'}], pending:'p2' },
  { id:'1d8c-07', game:'xcom', status:'your-turn',   turn:3,  max:40,  time:'discrete',
    players:[{id:'sol',name:'You',agent:'human',team:'sol',color:'var(--teamA)'},{id:'adv',name:'Director',agent:'ai',team:'adv',color:'var(--teamB)'}], pending:'sol' },
  { id:'7c30-aa', game:'risk', status:'open',        turn:0,  max:200, time:'discrete',
    players:[{id:'p1',name:'Mara',agent:'human',team:'p1',color:'var(--teamA)'},{id:'p2',name:'Open slot',agent:'open',team:'p2',color:'var(--teamB)'},{id:'p3',name:'Open slot',agent:'open',team:'p3',color:'var(--teamC)'}], pending:null },
  { id:'2e91-5f', game:'chess',status:'finished',    turn:41, max:200, time:'discrete',
    players:[{id:'w',name:'You',agent:'human',team:'w',color:'var(--teamA)'},{id:'b',name:'Stockfish',agent:'ai',team:'b',color:'var(--teamB)'}], pending:null, result:'You won · checkmate' },
];

const STATUS = {
  'your-turn':   { label:'Your turn',   color:'var(--ok)' },
  'ai-thinking': { label:'AI thinking', color:'var(--warn)' },
  'open':        { label:'Open lobby',  color:'var(--accent)' },
  'finished':    { label:'Finished',    color:'var(--faint)' },
};

/* ==================== EXPOSE GLOBALS ==================== */
Object.assign(window, {
  ICON_PATHS, RDR,
  GAMES, SESSIONS, SCENARIOS, STATUS,
  scenariosFor, fieldFor,
  computeUnits, makeFitter, samplePath, lerp,
});
