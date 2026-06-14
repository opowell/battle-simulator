// data.jsx — game catalog, sessions, battlefield datasets, engine math.
// Exports to window at the bottom.

/* ============================ GAME CATALOG ============================ */
// icon = glyph name resolved in ui.jsx <Icon/>; accent tints the card.
const GAMES = [
  { key:'cs',           name:'Counter-Strike',   icon:'crosshair', min:2, max:10, multi:true,  time:'continuous', grid:'free', cat:'Tactical FPS',   blurb:'5v5 bomb defusal. Continuous-time positions, sight lines, utility.' },
  { key:'sc2',          name:'StarCraft II',     icon:'zap',       min:2, max:8,  multi:true,  time:'continuous', grid:'free', cat:'RTS',            blurb:'Macro + micro. Economy, tech, and army control over open terrain.' },
  { key:'sc1',          name:'StarCraft',        icon:'zap',       min:2, max:8,  multi:true,  time:'continuous', grid:'free', cat:'RTS',            blurb:'The original. Three asymmetric factions, real-time engagements.' },
  { key:'xcom',         name:'XCOM',             icon:'shield',    min:1, max:2,  multi:false, time:'discrete',   grid:'square',cat:'Turn tactics',  blurb:'Squad-based grid combat. Cover, overwatch, percentage-to-hit.' },
  { key:'tactical',     name:'Tactical Combat',  icon:'grid',      min:2, max:4,  multi:true,  time:'discrete',   grid:'square',cat:'Turn tactics',  blurb:'Generic grid skirmish. Move, attack, hold the line.' },
  { key:'combatmission',name:'Combat Mission',   icon:'tank',      min:2, max:2,  multi:true,  time:'continuous', grid:'free', cat:'Wargame',        blurb:'WeGo orders. Real-time resolution of squad and armour orders.' },
  { key:'ffta',         name:'FFT Advance',      icon:'sword',     min:1, max:4,  multi:true,  time:'discrete',   grid:'square',cat:'Turn tactics',  blurb:'Job-class tactics on isometric grids. Action timers, terrain.' },
  { key:'chess',        name:'Chess',            icon:'crown',     min:2, max:2,  multi:true,  time:'discrete',   grid:'square',cat:'Abstract',       blurb:'The canonical perfect-information game. Two players, 64 squares.' },
  { key:'risk',         name:'Risk',             icon:'globe',     min:2, max:6,  multi:true,  time:'discrete',   grid:'region',cat:'Strategy',       blurb:'Territory control across a world map. Reinforce, attack, fortify.' },
  { key:'axisallies',   name:'Axis & Allies',    icon:'globe',     min:2, max:5,  multi:true,  time:'discrete',   grid:'region',cat:'Strategy',       blurb:'WWII grand strategy. Production, combined-arms, alliances.' },
  { key:'civ1',         name:'Civilization',     icon:'flag',      min:1, max:7,  multi:true,  time:'discrete',   grid:'square',cat:'4X',             blurb:'Found cities, research tech, build wonders across the ages.' },
  { key:'civ2',         name:'Civilization II',  icon:'flag',      min:1, max:7,  multi:true,  time:'discrete',   grid:'square',cat:'4X',             blurb:'Deeper diplomacy and combat on an isometric world.' },
  { key:'aow',          name:'Age of Wonders',   icon:'wand',      min:1, max:8,  multi:true,  time:'discrete',   grid:'hex',  cat:'4X',             blurb:'Fantasy empires, heroes, and tactical battles on hex maps.' },
  { key:'cardbattle',   name:'Card Battle',      icon:'cards',     min:2, max:2,  multi:true,  time:'discrete',   grid:'none', cat:'Card',           blurb:'Deck-driven duel. Play cards, manage resources, reduce HP to 0.' },
  { key:'doom',         name:'Doom',             icon:'flame',     min:1, max:4,  multi:true,  time:'continuous', grid:'free', cat:'Arena',          blurb:'First-person arena translated to a top-down sim. Rip and tear.' },
];

/* ============================ MATH ============================ */
const lerp = (a,b,u)=>a+(b-a)*u;
function samplePath(path, u){
  // u in [0,1] along a polyline of [x,y] points, arc-length parameterised.
  if(path.length===1) return { x:path[0][0], y:path[0][1], ang:0 };
  u=Math.max(0,Math.min(1,u));
  const segs=[]; let total=0;
  for(let i=0;i<path.length-1;i++){
    const d=Math.hypot(path[i+1][0]-path[i][0], path[i+1][1]-path[i][1]);
    segs.push(d); total+=d;
  }
  let dist=u*total;
  for(let i=0;i<segs.length;i++){
    if(dist<=segs[i]||i===segs.length-1){
      const t=segs[i]===0?0:dist/segs[i];
      const x=lerp(path[i][0],path[i+1][0],t), y=lerp(path[i][1],path[i+1][1],t);
      const ang=Math.atan2(path[i+1][1]-path[i][1], path[i+1][0]-path[i][0]);
      return { x, y, ang };
    }
    dist-=segs[i];
  }
  const n=path.length-1;
  return { x:path[n][0], y:path[n][1], ang:0 };
}
// world->screen fitter (letterbox a world WxH into a px box, with padding)
function makeFitter(world, box, pad){
  pad=pad||0;
  const bw=box.w-pad*2, bh=box.h-pad*2;
  const s=Math.min(bw/world.w, bh/world.h);
  const ox=pad+(bw-world.w*s)/2, oy=pad+(bh-world.h*s)/2;
  return {
    s,
    x:(wx)=>ox+wx*s,
    y:(wy)=>oy+wy*s,
    len:(w)=>w*s,
  };
}

/* ============================ BATTLEFIELDS ============================ */
// world: {w,h}. walls/zones in world coords. units carry a path + meta.
// position at time t (float turns) = samplePath(path, t/(turns-1)).

const CS = {
  game:'cs', label:'de_vertigo · Round 14', world:{ w:128, h:84 }, turns:8, grid:'free',
  teams:[
    { id:'ct', name:'Counter-Terrorists', color:'var(--teamA)', raw:'#4f9dff', score:7 },
    { id:'t',  name:'Terrorists',          color:'var(--teamB)', raw:'#ff5f56', score:6 },
  ],
  walls:[
    [10,8,8,30],[24,6,30,7],[20,30,16,6],[58,10,7,26],[70,40,30,7],
    [40,52,8,24],[78,58,30,7],[96,18,8,34],[54,62,16,7],[24,52,8,20],
  ],
  zones:[
    { x:84,y:10,w:38,h:30, kind:'site',  label:'BOMBSITE A' },
    { x:8,y:54,w:36,h:26,  kind:'site',  label:'BOMBSITE B' },
    { x:112,y:60,w:14,h:22,kind:'spawn', label:'CT' },
    { x:2,y:6,w:14,h:22,   kind:'spawn', label:'T' },
  ],
  units:[
    { id:'ct1', team:'ct', type:'rifler', name:'NiKo',   hp:100, path:[[120,66],[96,58],[70,60],[52,66]] },
    { id:'ct2', team:'ct', type:'awper',  name:'m0NESY', hp:100, path:[[118,72],[100,46],[88,30],[92,22]] },
    { id:'ct3', team:'ct', type:'rifler', name:'huNter', hp:80,  path:[[122,60],[104,64],[78,70],[46,70]] },
    { id:'ct4', team:'ct', type:'support',name:'nexa',   hp:100, path:[[116,78],[90,72],[60,70],[40,66]] },
    { id:'ct5', team:'ct', type:'rifler', name:'JACKZ',  hp:60,  path:[[120,68],[98,54],[74,46]], deathTurn:6 },
    { id:'t1',  team:'t',  type:'rifler', name:'s1mple', hp:100, path:[[6,12],[26,34],[30,52],[26,64]] },
    { id:'t2',  team:'t',  type:'awper',  name:'sh1ro',  hp:100, path:[[8,18],[24,24],[40,30],[58,26]] },
    { id:'t3',  team:'t',  type:'rifler', name:'Ax1Le',  hp:90,  path:[[5,22],[20,46],[18,62],[22,72]] },
    { id:'t4',  team:'t',  type:'entry',  name:'b1t',    hp:40,  path:[[7,16],[22,40],[28,56]], deathTurn:5 },
    { id:'t5',  team:'t',  type:'support',name:'Perfecto',hp:100,path:[[4,24],[16,40],[24,54],[30,66]] },
  ],
};

const SC2 = {
  game:'sc2', label:'Ladder · 1v1 · 8:24', world:{ w:160, h:104 }, turns:9, grid:'free',
  teams:[
    { id:'p1', name:'Terran (you)', color:'var(--teamA)', raw:'#4f9dff', score:0 },
    { id:'p2', name:'Zerg (AI)',     color:'var(--teamB)', raw:'#ff5f56', score:0 },
  ],
  walls:[ [70,0,8,28],[82,76,8,28],[40,48,12,8],[108,48,12,8],[74,46,12,12] ],
  zones:[
    { x:6,y:6,w:30,h:22,   kind:'resource', label:'MAIN ◇' },
    { x:124,y:76,w:30,h:22,kind:'resource', label:'MAIN ◇' },
    { x:64,y:42,w:32,h:20, kind:'objective',label:'XEL\u2019NAGA' },
    { x:18,y:74,w:26,h:18, kind:'resource', label:'NAT ◇' },
    { x:116,y:12,w:26,h:18,kind:'resource', label:'NAT ◇' },
  ],
  units:[
    { id:'m1', team:'p1', type:'marine', name:'Marine', hp:45, path:[[24,24],[60,44],[78,52]] },
    { id:'m2', team:'p1', type:'marine', name:'Marine', hp:45, path:[[28,28],[62,48],[80,54]] },
    { id:'m3', team:'p1', type:'marine', name:'Marine', hp:45, path:[[20,30],[58,50],[76,56]] },
    { id:'m4', team:'p1', type:'marauder',name:'Marauder',hp:125,path:[[26,34],[64,52],[82,58]] },
    { id:'m5', team:'p1', type:'medivac',name:'Medivac', hp:150,path:[[18,22],[52,40],[74,50]] },
    { id:'m6', team:'p1', type:'marine', name:'Marine', hp:30, path:[[30,26],[66,46],[80,50]], deathTurn:7 },
    { id:'z1', team:'p2', type:'ling',  name:'Zergling', hp:35, path:[[138,84],[100,60],[84,54]] },
    { id:'z2', team:'p2', type:'ling',  name:'Zergling', hp:35, path:[[140,80],[102,58],[86,52]] },
    { id:'z3', team:'p2', type:'ling',  name:'Zergling', hp:35, path:[[136,86],[98,62],[82,56]] },
    { id:'z4', team:'p2', type:'ling',  name:'Zergling', hp:20, path:[[142,82],[104,60],[88,54]], deathTurn:6 },
    { id:'z5', team:'p2', type:'roach', name:'Roach',    hp:145,path:[[144,88],[106,64],[90,58]] },
    { id:'z6', team:'p2', type:'roach', name:'Roach',    hp:145,path:[[138,90],[100,66],[86,60]] },
    { id:'z7', team:'p2', type:'bane',  name:'Baneling', hp:30, path:[[140,86],[102,62],[88,56]] },
  ],
};

const XCOM = {
  game:'xcom', label:'Operation Iron Veil · Turn 3', world:{ w:16, h:11 }, turns:6, grid:'square',
  teams:[
    { id:'sol', name:'XCOM Squad', color:'var(--teamA)', raw:'#4f9dff', score:0 },
    { id:'adv', name:'ADVENT',     color:'var(--teamB)', raw:'#ff5f56', score:0 },
  ],
  walls:[ [4,3,1,1],[5,3,1,1],[9,2,1,1],[10,6,1,1],[7,7,1,1],[3,7,1,1],[11,4,1,1],[6,5,1,1] ],
  zones:[
    { x:0,y:9,w:5,h:2,  kind:'spawn', label:'DEPLOY' },
    { x:12,y:0,w:4,h:2, kind:'objective', label:'OBJECTIVE' },
  ],
  units:[
    { id:'s1', team:'sol', type:'ranger',   name:'Cpl. Vasquez', hp:5, path:[[1,9],[4,6],[6,4]] },
    { id:'s2', team:'sol', type:'sharpshooter',name:'Sgt. Kovac',hp:4,path:[[2,10],[3,8],[4,7]] },
    { id:'s3', team:'sol', type:'grenadier',name:'Spc. Diaz',   hp:6, path:[[0,10],[2,8],[4,8]] },
    { id:'s4', team:'sol', type:'specialist',name:'Cpl. Okoro', hp:4, path:[[3,9],[5,7],[7,6]] },
    { id:'a1', team:'adv', type:'trooper',  name:'ADVENT Trooper',hp:4,path:[[14,1],[12,3],[10,4]] },
    { id:'a2', team:'adv', type:'trooper',  name:'ADVENT Trooper',hp:3,path:[[15,2],[13,4],[11,5]] },
    { id:'a3', team:'adv', type:'sectoid',  name:'Sectoid',       hp:6,path:[[13,0],[11,2],[9,3]] },
    { id:'a4', team:'adv', type:'trooper',  name:'ADVENT Trooper',hp:2,path:[[14,3],[12,5]], deathTurn:4 },
  ],
};

// Generic fallback skirmish for games without a bespoke battlefield.
function genericField(game, label){
  return {
    game, label:label||'Skirmish', world:{ w:20, h:13 }, turns:6, grid:'square',
    teams:[
      { id:'a', name:'Player 1', color:'var(--teamA)', raw:'#4f9dff', score:0 },
      { id:'b', name:'Player 2', color:'var(--teamB)', raw:'#ff5f56', score:0 },
    ],
    walls:[ [9,5,2,3],[5,2,1,2],[14,8,2,1],[6,9,2,1],[13,2,1,2] ],
    zones:[ { x:0,y:5,w:3,h:3,kind:'spawn',label:'P1'}, { x:17,y:5,w:3,h:3,kind:'spawn',label:'P2'} ],
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

const FIELDS = { cs:CS, sc2:SC2, sc1:SC2, xcom:XCOM };
function fieldFor(gameKey){
  if(FIELDS[gameKey]) return FIELDS[gameKey];
  const g = GAMES.find(x=>x.key===gameKey);
  return genericField(gameKey, g? g.name+' · Skirmish' : 'Skirmish');
}

/* ============================ SCENARIOS ============================ */
// Per-game starting presets. Selecting one seeds the session config
// (player count, turn cap, fog, time model) — all still overridable.
// fields: key,name,sub,blurb,players,(time?),(fog?),(maxTurns?)
const SCENARIOS = {
  cs: [
    { key:'vertigo', name:'de_vertigo',   sub:'Bomb defusal', blurb:'High-rise build site. Tight A, vertical mid into B.', players:10, maxTurns:30 },
    { key:'mirage',  name:'de_mirage',    sub:'Bomb defusal', blurb:'Desert classic. Whoever owns mid dictates the round.', players:10, maxTurns:30 },
    { key:'retake',  name:'A retake',     sub:'Custom drill', blurb:'Four CTs retake a planted bomb. 40-second fuse.', players:8, maxTurns:12, fog:false },
  ],
  sc2: [
    { key:'ladder',  name:'Ladder 1v1',   sub:'Standard', blurb:'Even spawns, full tech tree, macro to a timing push.', players:2, maxTurns:500 },
    { key:'allin',   name:'Proxy all-in',  sub:'Asymmetric', blurb:'One side commits to an early rush. No safety net.', players:2, maxTurns:200 },
    { key:'ffa4',    name:'4-way FFA',     sub:'Free-for-all', blurb:'Four mains, one map, last colony standing.', players:4, maxTurns:500 },
  ],
  sc1: [
    { key:'ladder',  name:'Lost Temple',  sub:'Standard', blurb:'The original four-spawn classic. Scout to find them.', players:4, maxTurns:500 },
    { key:'duel',    name:'1v1 duel',     sub:'Standard', blurb:'Two-player macro game on a mirrored map.', players:2, maxTurns:500 },
  ],
  xcom: [
    { key:'ironveil', name:'Iron Veil',    sub:'Story op', blurb:'Extract intel from an ADVENT blacksite before reinforcements.', players:2, maxTurns:40, fog:true },
    { key:'terror',   name:'Terror site',   sub:'Defense', blurb:'Hold a civilian block against waves. The clock is the enemy.', players:2, maxTurns:30, fog:true },
    { key:'ambush',   name:'Cold ambush',   sub:'Skirmish', blurb:'Squad caught in the open. Reach cover, turn it around.', players:2, maxTurns:24, fog:true },
  ],
  chess: [
    { key:'standard', name:'Standard',     sub:'Classical', blurb:'Full board, standard opening. Perfect information.', players:2, maxTurns:200, fog:false },
    { key:'960',      name:'Chess960',     sub:'Variant', blurb:'Back-rank shuffled. Memorised theory goes out the window.', players:2, maxTurns:200, fog:false },
    { key:'endgame',  name:'KQ vs KR',     sub:'Endgame drill', blurb:'Queen-and-king technique against a lone rook.', players:2, maxTurns:60, fog:false },
  ],
  risk: [
    { key:'world',    name:'World domination', sub:'Standard', blurb:'Classic six-continent map. Hold them all to win.', players:6, maxTurns:200 },
    { key:'capitals', name:'Capital conquest', sub:'Short', blurb:'Claim a capital each; take the rest to win early.', players:4, maxTurns:120 },
  ],
  doom: [
    { key:'invasion', name:'Hell on Earth', sub:'Survival', blurb:'Endless demon spawns. Outlast the horde.', players:1, maxTurns:120, time:'continuous' },
    { key:'deathmatch',name:'Deathmatch',    sub:'Arena', blurb:'Free-for-all frags in a tight arena. First to the cap.', players:4, maxTurns:80, time:'continuous' },
  ],
};
function scenariosFor(gameKey){
  if(SCENARIOS[gameKey]) return SCENARIOS[gameKey];
  const g = GAMES.find(x=>x.key===gameKey) || { min:2 };
  const base = Math.max(2, g.min);
  return [
    { key:'skirmish', name:'Open skirmish', sub:'Standard',   blurb:'Symmetric forces, balanced start, fair fight.', players:base },
    { key:'assault',  name:'Assault',       sub:'Asymmetric', blurb:'One side attacks a dug-in, fortified position.', players:base },
    { key:'laststand',name:'Last stand',    sub:'Endurance',  blurb:'Hold the line against escalating pressure.', players:base },
  ];
}

/* ============================ LIVE SESSIONS ============================ */
const SESSIONS = [
  { id:'9f2a-1c', game:'cs',   status:'your-turn', turn:14, max:30, time:'continuous',
    players:[
      {id:'ct',name:'You',         agent:'human', team:'ct', color:'var(--teamA)'},
      {id:'t', name:'NAVI-bot',    agent:'ai',    team:'t',  color:'var(--teamB)'},
    ], pending:'ct' },
  { id:'4b7e-22', game:'sc2',  status:'ai-thinking', turn:48, max:500, time:'continuous',
    players:[
      {id:'p1',name:'You',        agent:'human', team:'p1', color:'var(--teamA)'},
      {id:'p2',name:'Hard AI',    agent:'ai',    team:'p2', color:'var(--teamB)'},
    ], pending:'p2' },
  { id:'1d8c-07', game:'xcom',  status:'your-turn', turn:3, max:40, time:'discrete',
    players:[
      {id:'sol',name:'You',       agent:'human', team:'sol', color:'var(--teamA)'},
      {id:'adv',name:'Director',  agent:'ai',    team:'adv', color:'var(--teamB)'},
    ], pending:'sol' },
  { id:'7c30-aa', game:'risk',  status:'open', turn:0, max:200, time:'discrete',
    players:[
      {id:'p1',name:'Mara',       agent:'human', team:'p1', color:'var(--teamA)'},
      {id:'p2',name:'Open slot',  agent:'open',  team:'p2', color:'var(--teamB)'},
      {id:'p3',name:'Open slot',  agent:'open',  team:'p3', color:'var(--teamC)'},
    ], pending:null },
  { id:'2e91-5f', game:'chess', status:'finished', turn:41, max:200, time:'discrete',
    players:[
      {id:'w',name:'You',         agent:'human', team:'w', color:'var(--teamA)'},
      {id:'b',name:'Stockfish',   agent:'ai',    team:'b', color:'var(--teamB)'},
    ], pending:null, result:'You won · checkmate' },
];

const STATUS = {
  'your-turn':  { label:'Your turn',   color:'var(--ok)' },
  'ai-thinking':{ label:'AI thinking', color:'var(--warn)' },
  'open':       { label:'Open lobby',  color:'var(--accent)' },
  'finished':   { label:'Finished',    color:'var(--faint)' },
};

Object.assign(window, {
  GAMES, SESSIONS, STATUS, SCENARIOS, scenariosFor, fieldFor, samplePath, makeFitter, lerp,
});
