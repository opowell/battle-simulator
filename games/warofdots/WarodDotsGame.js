import { getWarodDotsBelief } from './belief.js';
import { forEachCell } from '../terrainShapes.js';

const T = 28;
const COLS = 40;
const ROWS = 26;
const MAP_W = COLS * T;
const MAP_H = ROWS * T;

const TERRAIN = { PLAINS: 0, FOREST: 1, HILLS: 2, WATER: 3, MOUNTAINS: 4, SAND: 5, CITY: 6, CAPITAL: 7, BRIDGE: 8 };

const TERRAIN_COLOR = [
  '#3a6e28', // PLAINS
  '#1e4010', // FOREST
  '#7a6040', // HILLS
  '#0e3d5c', // WATER
  '#50504a', // MOUNTAINS
  '#b09050', // SAND
  '#3a6e28', // CITY
  '#3a6e28', // CAPITAL
  '#5a4a30', // BRIDGE
];

const UNIT_DEF = {
  light: { cost: 200, hp: 60,  speed: 75, dmg: 6,  atkRate: 0.9, range: 38, moraleDmg: 3 },
  heavy: { cost: 400, hp: 150, speed: 35, dmg: 16, atkRate: 0.5, range: 38, moraleDmg: 8 },
};

const GOLD_PER_SEC = 18;
const UNIT_UPKEEP  = 0.8;
const CITY_CAP     = 5;
const CAPTURE_TIME = 3.0;
const TICK_SECONDS = 5.0;
const SIM_DT       = 0.05;

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Map generation ────────────────────────────────────────────────────────────

function generateMap(players, rng) {
  const grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(TERRAIN.PLAINS));

  for (let i = 0; i < 4; i++) {
    const r0 = Math.floor(rng() * ROWS * 0.7 + ROWS * 0.15);
    const c0 = Math.floor(rng() * COLS * 0.7 + COLS * 0.15);
    const len = Math.floor(rng() * 8 + 4);
    const dir = rng() < 0.5 ? 'h' : 'v';
    for (let j = 0; j < len; j++) {
      const r = r0 + (dir === 'v' ? j : Math.floor((rng() - 0.5) * 2));
      const c = c0 + (dir === 'h' ? j : Math.floor((rng() - 0.5) * 2));
      if (r >= 1 && r < ROWS - 1 && c >= 1 && c < COLS - 1) {
        grid[r][c] = TERRAIN.WATER;
        if (rng() < 0.5 && r + 1 < ROWS - 1) grid[r + 1][c] = TERRAIN.WATER;
      }
    }
  }

  for (let i = 0; i < 6; i++) {
    const r0 = Math.floor(rng() * (ROWS - 4) + 2);
    const c0 = Math.floor(rng() * (COLS - 4) + 2);
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        if (rng() < 0.55) {
          const r = r0 + dr, c = c0 + dc;
          if (r >= 0 && r < ROWS && c >= 0 && c < COLS && grid[r][c] === TERRAIN.PLAINS)
            grid[r][c] = TERRAIN.FOREST;
        }
      }
    }
  }

  for (let i = 0; i < 5; i++) {
    const r0 = Math.floor(rng() * (ROWS - 2) + 1);
    const c0 = Math.floor(rng() * (COLS - 2) + 1);
    for (let dr = -1; dr <= 2; dr++) {
      for (let dc = -1; dc <= 2; dc++) {
        if (rng() < 0.6) {
          const r = r0 + dr, c = c0 + dc;
          if (r >= 0 && r < ROWS && c >= 0 && c < COLS && grid[r][c] === TERRAIN.PLAINS)
            grid[r][c] = TERRAIN.HILLS;
        }
      }
    }
  }

  for (let i = 0; i < 3; i++) {
    const r0 = Math.floor(rng() * ROWS);
    const c0 = Math.floor(rng() * COLS);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = r0 + dr, c = c0 + dc;
        if (r > 1 && r < ROWS - 2 && c > 1 && c < COLS - 2 && grid[r][c] === TERRAIN.HILLS)
          grid[r][c] = TERRAIN.MOUNTAINS;
      }
    }
  }

  for (let r = 1; r < ROWS - 1; r++) {
    for (let c = 1; c < COLS - 1; c++) {
      if (grid[r][c] === TERRAIN.WATER && rng() < 0.04) grid[r][c] = TERRAIN.BRIDGE;
    }
  }

  function clearForCity(row, col) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = row + dr, c = col + dc;
        if (r >= 0 && r < ROWS && c >= 0 && c < COLS) grid[r][c] = TERRAIN.PLAINS;
      }
    }
  }

  const cityDefs = [];
  const capL = { col: Math.floor(rng() * 3) + 2,          row: Math.floor(ROWS / 2 + (rng() - 0.5) * 4) };
  const capR = { col: COLS - Math.floor(rng() * 3) - 3,   row: Math.floor(ROWS / 2 + (rng() - 0.5) * 4) };

  clearForCity(capL.row, capL.col); grid[capL.row][capL.col] = TERRAIN.CAPITAL;
  clearForCity(capR.row, capR.col); grid[capR.row][capR.col] = TERRAIN.CAPITAL;
  cityDefs.push({ col: capL.col, row: capL.row, owner: players[0].id, isCapital: true });
  cityDefs.push({ col: capR.col, row: capR.row, owner: players[1].id, isCapital: true });

  let attempts = 0;
  while (cityDefs.length < 9 && attempts < 500) {
    attempts++;
    const c = Math.floor(rng() * (COLS - 4)) + 2;
    const r = Math.floor(rng() * (ROWS - 4)) + 2;
    if (grid[r][c] === TERRAIN.WATER || grid[r][c] === TERRAIN.MOUNTAINS) continue;
    if (cityDefs.some(cp => Math.abs(cp.col - c) + Math.abs(cp.row - r) < 5)) continue;
    clearForCity(r, c); grid[r][c] = TERRAIN.CITY;
    cityDefs.push({ col: c, row: r, owner: 'neutral', isCapital: false });
  }

  const cities = cityDefs.map((cp, i) => ({
    id: i,
    col: cp.col, row: cp.row,
    cx: cp.col * T + T / 2, cy: cp.row * T + T / 2,
    owner: cp.owner,
    isCapital: cp.isCapital,
    captureProgress: 0,
    capturer: null,
    queue: [],
    buildTimer: 0,
  }));

  return { grid, cities };
}

// ── Shape-based (non-grid) maps ─────────────────────────────────────────────────
//
// Instead of the random tile generator, a scenario can author terrain as an array of
// shapes (rectangles + ovals) — see games/terrainShapes.js. Each shape's `kind` decides
// the terrain it stamps onto the grid, so it feeds straight into the existing simulation
// (speedMod / dmgMod / getTerrainAt): oval lakes slow and drown units, forests and hills
// slow them and blunt heavy fire, mountains are impassable. The same shapes are handed to
// the client to draw as layered SVGs. Cities are placed at authored positions.

const WOD_SHAPE_STYLES = {
  water:     { terrain: TERRAIN.WATER,     render: { fill: '#0e3d5c' },              name: 'Water',     description: 'Slows units and drowns them over time.' },
  forest:    { terrain: TERRAIN.FOREST,    render: { fill: '#1e4010' },              name: 'Forest',    description: 'Slows movement; cover from heavy fire.' },
  hills:     { terrain: TERRAIN.HILLS,     render: { fill: '#7a6040', opacity: 0.9 },name: 'Hills',     description: 'Slows movement; cover from heavy fire.' },
  mountains: { terrain: TERRAIN.MOUNTAINS, render: { fill: '#50504a' },              name: 'Mountains', description: 'Impassable.' },
  sand:      { terrain: TERRAIN.SAND,      render: { fill: '#b09050', opacity: 0.85 },name: 'Sand',     description: 'Slows light units.' },
  bridge:    { terrain: TERRAIN.BRIDGE,    render: { fill: '#5a4a30' },              name: 'Bridge',    description: 'Fast crossing over water.' },
};

function buildShapeMap(def, players) {
  const grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(TERRAIN.PLAINS));

  for (const s of def.terrain) {
    const terrain = WOD_SHAPE_STYLES[s.kind]?.terrain;
    if (terrain == null) continue;
    forEachCell(s, COLS, ROWS, (c, r) => { grid[r][c] = terrain; });
  }

  const clearForCity = (row, col) => {
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const r = row + dr, c = col + dc;
        if (r >= 0 && r < ROWS && c >= 0 && c < COLS) grid[r][c] = TERRAIN.PLAINS;
      }
  };

  const cityDefs = def.cities.map(c => {
    const owner = c.role === 'capL' ? players[0].id
                : c.role === 'capR' ? players[1].id
                : 'neutral';
    const isCapital = c.role === 'capL' || c.role === 'capR';
    clearForCity(c.row, c.col);
    grid[c.row][c.col] = isCapital ? TERRAIN.CAPITAL : TERRAIN.CITY;
    return { col: c.col, row: c.row, owner, isCapital };
  });

  const cities = cityDefs.map((cp, i) => ({
    id: i,
    col: cp.col, row: cp.row,
    cx: cp.col * T + T / 2, cy: cp.row * T + T / 2,
    owner: cp.owner,
    isCapital: cp.isCapital,
    captureProgress: 0,
    capturer: null,
    queue: [],
    buildTimer: 0,
  }));

  const shapes = def.terrain.map(s => {
    const style = WOD_SHAPE_STYLES[s.kind];
    return {
      shape: s.shape ?? 'rect', x: s.x, y: s.y, w: s.w, h: s.h,
      ...style.render, name: style.name, description: style.description,
    };
  });

  return { grid, cities, shapes };
}

// lakelands — open plains broken by two oval lakes, forest and hill masses, and a small
// impassable mountain. Cities ring the map with a contested one at centre.
const WOD_LAKELANDS = {
  cities: [
    { col:  3, row: 13, role: 'capL' },
    { col: 36, row: 13, role: 'capR' },
    { col: 12, row:  5, role: 'neutral' }, { col: 20, row:  4, role: 'neutral' },
    { col: 28, row:  5, role: 'neutral' }, { col: 12, row: 21, role: 'neutral' },
    { col: 20, row: 22, role: 'neutral' }, { col: 28, row: 21, role: 'neutral' },
    { col: 20, row: 13, role: 'neutral' },
  ],
  terrain: [
    { shape: 'oval', x:  7, y:  8, w:  8, h:  6, kind: 'water'     },
    { shape: 'oval', x: 25, y: 12, w:  9, h:  6, kind: 'water'     },
    { shape: 'oval', x: 21, y:  1, w:  9, h:  5, kind: 'forest'    },
    { shape: 'oval', x:  5, y: 16, w:  9, h:  6, kind: 'forest'    },
    { shape: 'oval', x: 29, y:  6, w:  7, h:  6, kind: 'hills'     },
    { shape: 'oval', x:  4, y:  4, w:  6, h:  5, kind: 'hills'     },
    { shape: 'oval', x: 17, y: 17, w:  5, h:  4, kind: 'mountains' },
  ],
};

// divide — a north-south river splits the map; two bridges are the only fast crossings
// (units can wade the river but take damage). Forests and hills cluster on each bank.
const WOD_DIVIDE = {
  cities: [
    { col:  3, row: 13, role: 'capL' },
    { col: 36, row: 13, role: 'capR' },
    { col: 10, row:  4, role: 'neutral' }, { col: 10, row: 13, role: 'neutral' },
    { col: 10, row: 21, role: 'neutral' }, { col: 29, row:  4, role: 'neutral' },
    { col: 29, row: 13, role: 'neutral' }, { col: 29, row: 21, role: 'neutral' },
  ],
  terrain: [
    { shape: 'rect', x: 19, y:  0, w:  2, h: 26, kind: 'water'  },
    { shape: 'rect', x: 18, y:  6, w:  4, h:  2, kind: 'bridge' },
    { shape: 'rect', x: 18, y: 18, w:  4, h:  2, kind: 'bridge' },
    { shape: 'oval', x:  5, y:  8, w:  7, h:  5, kind: 'forest' },
    { shape: 'oval', x: 28, y: 14, w:  7, h:  5, kind: 'forest' },
    { shape: 'oval', x: 13, y: 18, w:  6, h:  5, kind: 'hills'  },
    { shape: 'oval', x: 22, y:  3, w:  6, h:  5, kind: 'hills'  },
  ],
};

const WOD_SHAPE_SCENARIOS = { lakelands: WOD_LAKELANDS, divide: WOD_DIVIDE };

// ── Unit / terrain helpers ────────────────────────────────────────────────────

function makeUnit(id, type, owner, x, y) {
  const def = UNIT_DEF[type];
  return {
    id, type, owner,
    x, y, tx: x, ty: y,
    hp: def.hp, maxHp: def.hp,
    morale: 100,
    speed: def.speed,
    dmg: def.dmg,
    atkRate: def.atkRate,
    range: def.range,
    atkCooldown: 0,
    state: 'idle',
    attackMove: false,
    waterTimer: 0,
  };
}

function getTerrainAt(grid, x, y) {
  const c = Math.floor(x / T), r = Math.floor(y / T);
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return TERRAIN.PLAINS;
  return grid[r][c];
}

function speedMod(terrain, type) {
  if (terrain === TERRAIN.MOUNTAINS) return 0;
  if (terrain === TERRAIN.WATER) return 0.45;
  if (terrain === TERRAIN.FOREST || terrain === TERRAIN.HILLS) return type === 'heavy' ? 0.5 : 0.78;
  if (terrain === TERRAIN.SAND && type === 'light') return 0.65;
  if (terrain === TERRAIN.BRIDGE) return 0.9;
  return 1.0;
}

function dmgMod(terrain, type) {
  if (terrain === TERRAIN.WATER) return 0.6;
  if ((terrain === TERRAIN.FOREST || terrain === TERRAIN.HILLS) && type === 'heavy') return 0.65;
  return 1.0;
}

// ── Simulation step ───────────────────────────────────────────────────────────

function simStep(state, dt, rng) {
  const { board: { grid } } = state;
  let units = state.units;

  // Economy
  const players = state.players.map(p => {
    const ownedCount = state.board.cities.filter(c => c.owner === p.id).length;
    let gold = p.gold + ownedCount * GOLD_PER_SEC * dt;
    const myCount = units.filter(u => u.owner === p.id).length;
    if (myCount > ownedCount * CITY_CAP) gold -= (myCount - ownedCount * CITY_CAP) * UNIT_UPKEEP * dt;
    return { ...p, gold: Math.max(0, gold) };
  });

  // Upkeep kills (bankrupt player loses weakest unit)
  for (const p of players) {
    if (p.gold > 0) continue;
    const myUnits = units.filter(u => u.owner === p.id);
    const ownedCount = state.board.cities.filter(c => c.owner === p.id).length;
    if (myUnits.length > ownedCount * CITY_CAP) {
      const victim = [...myUnits].sort((a, b) => a.hp - b.hp)[0];
      units = units.map(u => u.id === victim.id ? { ...u, hp: 0 } : u);
    }
  }
  units = units.filter(u => u.hp > 0);

  // City capture
  let cities = state.board.cities.map(city => {
    const nearby = units.filter(u => Math.hypot(u.x - city.cx, u.y - city.cy) < T * 1.2);
    const counts = {};
    for (const u of nearby) counts[u.owner] = (counts[u.owner] || 0) + 1;
    const owners = Object.keys(counts);

    if (owners.length === 1 && owners[0] !== city.owner) {
      const progress = city.captureProgress + dt / CAPTURE_TIME;
      if (progress >= 1) return { ...city, owner: owners[0], captureProgress: 0, capturer: null, queue: [] };
      return { ...city, capturer: owners[0], captureProgress: progress };
    }
    if (owners.length === 0 && city.capturer) {
      const progress = Math.max(0, city.captureProgress - dt / CAPTURE_TIME);
      return { ...city, captureProgress: progress, capturer: progress <= 0 ? null : city.capturer };
    }
    return city;
  });

  // City production
  let nextId = state.gameSpecific.nextUnitId;
  cities = cities.map(city => {
    if (!city.queue.length || city.owner === 'neutral') return city;
    const type = city.queue[0];
    const buildTime = type === 'light' ? 4 : 7;
    const timer = city.buildTimer + dt;
    if (timer >= buildTime) {
      const angle = rng() * Math.PI * 2;
      units = [...units, makeUnit(`u${nextId++}`, type, city.owner,
        city.cx + Math.cos(angle) * T * 0.8,
        city.cy + Math.sin(angle) * T * 0.8)];
      return { ...city, buildTimer: 0, queue: city.queue.slice(1) };
    }
    return { ...city, buildTimer: timer };
  });

  // Unit movement and combat (two-pass: compute attacks, then apply damage)
  const attacks = [];
  const snapshot = units; // targeting uses positions before this step

  const movedUnits = units.map(u => {
    let nu = { ...u };
    const terrain = getTerrainAt(grid, nu.x, nu.y);

    // Water damage
    if (terrain === TERRAIN.WATER) {
      nu.waterTimer += dt;
      if (nu.waterTimer > 1) nu.hp -= 2 * dt;
    } else {
      nu.waterTimer = 0;
    }

    // Heal when idle or moving near a friendly city
    if (nu.state !== 'combat' && nu.hp < nu.maxHp) {
      const inCity = cities.some(c => c.owner === nu.owner && Math.hypot(nu.x - c.cx, nu.y - c.cy) < T);
      nu.hp = Math.min(nu.maxHp, nu.hp + (inCity ? 6 : 2) * dt);
    }

    // Find nearest enemy in snapshot
    let nearestEnemy = null, nearestDist = Infinity;
    for (const e of snapshot) {
      if (e.owner !== nu.owner) {
        const d = Math.hypot(e.x - nu.x, e.y - nu.y);
        if (d < nearestDist) { nearestDist = d; nearestEnemy = e; }
      }
    }

    // Attack
    nu.atkCooldown -= dt;
    if (nearestEnemy && nearestDist < nu.range) {
      nu.state = 'combat';
      if (nu.atkCooldown <= 0) {
        nu.atkCooldown = 1 / nu.atkRate;
        attacks.push({
          targetId: nearestEnemy.id,
          damage: nu.dmg * dmgMod(terrain, nu.type) * (0.6 + 0.4 * nu.morale / 100),
          moraleDmg: UNIT_DEF[nu.type].moraleDmg,
        });
      }
    } else {
      if (nu.state === 'combat') nu.state = 'idle';
    }

    // Morale recovery when not in combat
    if (nu.state !== 'combat') nu.morale = Math.min(100, nu.morale + 8 * dt);

    // Flee on very low morale
    if (nu.morale < 20 && nu.state !== 'flee') {
      nu.state = 'flee';
      if (nearestEnemy) {
        const dx = nu.x - nearestEnemy.x, dy = nu.y - nearestEnemy.y;
        const len = Math.hypot(dx, dy) || 1;
        const cap = cities.find(c => c.owner === nu.owner && c.isCapital);
        nu.tx = cap?.cx ?? nu.x + (dx / len) * 100;
        nu.ty = cap?.cy ?? nu.y + (dy / len) * 100;
      }
    }

    // Attack-move: chase nearest enemy when in range
    if (nu.state === 'moving' && nu.attackMove && nearestEnemy && nearestDist < 180) {
      nu.tx = nearestEnemy.x; nu.ty = nearestEnemy.y;
    }

    // Movement
    if (nu.state === 'moving' || nu.state === 'flee') {
      const dx = nu.tx - nu.x, dy = nu.ty - nu.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 3) {
        nu.x = nu.tx; nu.y = nu.ty;
        if (nu.state === 'flee') nu.morale = Math.min(100, nu.morale + 20);
        nu.state = 'idle';
      } else {
        const spd = nu.speed * speedMod(terrain, nu.type);
        const move = Math.min(spd * dt, dist);
        nu.x = Math.max(2, Math.min(MAP_W - 2, nu.x + (dx / dist) * move));
        nu.y = Math.max(2, Math.min(MAP_H - 2, nu.y + (dy / dist) * move));
      }
    }

    return nu;
  });

  // Apply accumulated attack damage
  const finalUnits = movedUnits.map(u => {
    const hits = attacks.filter(a => a.targetId === u.id);
    if (!hits.length) return u;
    const dmg = hits.reduce((s, a) => s + a.damage, 0);
    const mor = hits.reduce((s, a) => s + a.moraleDmg, 0);
    return { ...u, hp: u.hp - dmg, morale: Math.max(0, u.morale - mor) };
  }).filter(u => u.hp > 0);

  return {
    ...state,
    players,
    units: finalUnits,
    board: { ...state.board, cities },
    gameSpecific: { ...state.gameSpecific, nextUnitId: nextId },
  };
}

// ── Game definition ───────────────────────────────────────────────────────────

export const WarodDotsGame = {
  name: 'War of Dots',

  ui: {
    help: {
      title: 'War of Dots',
      sections: [
        {
          heading: 'Objective',
          text: 'Capture the enemy capital and control at least 80% of all cities on the map to win. Alternatively, wipe out all enemy units and cities.',
        },
        {
          heading: 'Each Turn',
          text: 'Issue move orders to your units (select a unit → select a destination city) and queue unit purchases at your cities. Then end your turn — 5 seconds of real-time simulation play out, units fight and move automatically.',
        },
        {
          heading: 'Units',
          text: 'Light units (L) are fast and cheap (200g). Heavy units (H) are slow, durable, and hit hard (400g). Buy them at any city you own.',
        },
        {
          heading: 'Cities & Gold',
          text: 'You earn gold over time from every city you own. Move a unit onto a neutral or enemy city to begin capturing it — takes 3 seconds of uncontested presence. Capitals are marked ★.',
        },
        {
          heading: 'Combat',
          text: 'Units in the same area fight automatically. Units also take morale damage — a unit that loses all morale routs and becomes vulnerable. Use terrain: forests and hills slow movement but provide cover.',
        },
      ],
    },
  },

  scenarios: [
    { id: 'standard',  name: 'Standard',  description: '40×26 map — capture the capital + 80% of cities', config: {} },
    { id: 'lakelands', name: 'Lakelands', description: 'Shape terrain — oval lakes, forests and hills; a contested centre city', config: { scenario: 'lakelands' } },
    { id: 'divide',    name: 'The Divide', description: 'Shape terrain — a river splits the map; two bridges are the only fast crossings', config: { scenario: 'divide' } },
  ],

  createInitialState(players, config = {}) {
    const rng = config.rng ?? mulberry32((Date.now() ^ 0xdeadbeef) >>> 0);
    const shapeScen = config.scenario && WOD_SHAPE_SCENARIOS[config.scenario];
    const mapData = shapeScen ? buildShapeMap(shapeScen, players) : generateMap(players, rng);
    const { grid, cities, shapes } = mapData;

    let nextId = 1;
    const units = [];
    for (const player of players) {
      const cap = cities.find(c => c.isCapital && c.owner === player.id);
      if (!cap) continue;
      for (let i = 0; i < 3; i++) {
        const angle = (i / 3) * Math.PI * 2;
        units.push(makeUnit(`u${nextId++}`, 'light', player.id,
          cap.cx + Math.cos(angle) * T * 0.8,
          cap.cy + Math.sin(angle) * T * 0.8));
      }
    }

    return {
      gameName: 'warofdots',
      turnNumber: 1,
      currentPhase: 'play',
      activePlayers: [players[0].id],
      players: players.map(p => ({ ...p, gold: 300 })),
      units,
      board: { grid, cities, cols: COLS, rows: ROWS, ...(shapes ? { shapes } : {}) },
      lastActions: [],
      gameSpecific: {
        nextUnitId: nextId,
        fogOfWar: config.fogOfWar ?? false,
        // Snapshot of starting units — seeds the fog belief tracker.
        startRoster: units.map(u => ({ ...u })),
      },
    };
  },

  getLegalActions(state, playerId) {
    const player = state.players.find(p => p.id === playerId);
    if (!player) return [{ type: 'end-turn' }];

    const myUnits = state.units.filter(u => u.owner === playerId);
    const myCities = state.board.cities.filter(c => c.owner === playerId);
    const actions = [];

    // Move each unit to any city center (attack-move toward enemy/neutral cities)
    for (const unit of myUnits) {
      for (const city of state.board.cities) {
        const ownerLabel = city.owner === playerId ? 'friendly' : city.owner === 'neutral' ? 'neutral' : 'enemy';
        actions.push({
          type: 'move',
          unitId: unit.id,
          tx: city.cx,
          ty: city.cy,
          to: { x: city.col, y: city.row },
          attackMove: city.owner !== playerId,
          label: `Move to ${ownerLabel} ${city.isCapital ? 'capital' : 'city'} (${city.col},${city.row})`,
        });
      }
    }

    // Buy units at owned cities (queue limit 3)
    for (const city of myCities) {
      if (city.queue.length >= 3) continue;
      for (const [unitType, def] of Object.entries(UNIT_DEF)) {
        if (player.gold >= def.cost) {
          actions.push({
            type: 'buy',
            cityId: city.id,
            unitType,
            label: `Buy ${unitType} at ${city.isCapital ? 'capital' : 'city'} (${city.col},${city.row}) — ${def.cost}g`,
          });
        }
      }
    }

    actions.push({ type: 'end-turn', label: 'End Turn' });
    return actions;
  },

  applyActions(state, playerActions, rng = Math.random) {
    const { playerId, action } = playerActions[0];
    const playerIds = state.players.map(p => p.id);
    const currentIdx = playerIds.indexOf(playerId);

    if (action.type === 'move') {
      const units = state.units.map(u =>
        u.id === action.unitId
          ? { ...u, tx: action.tx, ty: action.ty, state: 'moving', attackMove: action.attackMove }
          : u
      );
      return { ...state, units, lastActions: playerActions };
    }

    if (action.type === 'buy') {
      const player = state.players.find(p => p.id === playerId);
      const def = UNIT_DEF[action.unitType];
      if (!player || player.gold < def.cost) return state;
      const players = state.players.map(p =>
        p.id === playerId ? { ...p, gold: p.gold - def.cost } : p
      );
      const cities = state.board.cities.map(c =>
        c.id === action.cityId ? { ...c, queue: [...c.queue, action.unitType] } : c
      );
      return { ...state, players, board: { ...state.board, cities }, lastActions: playerActions };
    }

    if (action.type === 'end-turn') {
      let s = state;
      const steps = Math.round(TICK_SECONDS / SIM_DT);
      for (let i = 0; i < steps; i++) s = simStep(s, SIM_DT, rng);
      const nextIdx = (currentIdx + 1) % playerIds.length;
      const newTurn = nextIdx === 0 ? s.turnNumber + 1 : s.turnNumber;
      return { ...s, activePlayers: [playerIds[nextIdx]], turnNumber: newTurn, lastActions: playerActions };
    }

    return state;
  },

  getResult(state) {
    const { players, units, board: { cities } } = state;
    const total = cities.length;
    const threshold = Math.floor(total * 0.8);

    for (const player of players) {
      const pid = player.id;
      const owned = cities.filter(c => c.owner === pid).length;
      const enemies = players.filter(p => p.id !== pid);

      // Win: all enemy capitals captured AND own 80%+ of cities
      const allEnemyCapsLost = enemies.every(e => !cities.some(c => c.isCapital && c.owner === e.id));
      if (allEnemyCapsLost && owned >= threshold) {
        return { outcome: 'win', winnerId: pid, reason: 'capital-captured' };
      }

      // Annihilation: no cities and no units
      if (owned === 0 && !units.some(u => u.owner === pid)) {
        const winner = enemies[0];
        return { outcome: 'win', winnerId: winner?.id ?? null, reason: 'annihilated' };
      }
    }
    return null;
  },

  renderState(state) {
    const { turnNumber, activePlayers, players, units, board: { cities } } = state;
    const lines = [
      '═'.repeat(52),
      `  WAR OF DOTS  ·  Turn ${turnNumber}  ·  ${activePlayers[0]}'s move`,
      '═'.repeat(52),
    ];
    for (const p of players) {
      const pCities = cities.filter(c => c.owner === p.id).length;
      const pUnits  = units.filter(u => u.owner === p.id).length;
      const mark = p.id === activePlayers[0] ? ' ◄' : '';
      lines.push(`  ${p.name}: ${pCities} cities, ${pUnits} units, ${Math.floor(p.gold)}g${mark}`);
    }
    const neutral = cities.filter(c => c.owner === 'neutral').length;
    lines.push(`  Neutral: ${neutral} cities`);
    lines.push('═'.repeat(52));
    return lines.join('\n');
  },

  getVisibleState(state, playerId) {
    const myUnits = state.units.filter(u => u.owner === playerId);
    const VISION_PX = 5 * T;
    return {
      ...state,
      units: state.units.filter(u =>
        u.owner === playerId ||
        myUnits.some(m => Math.hypot(m.x - u.x, m.y - u.y) <= VISION_PX)
      ),
    };
  },

  sampleWorlds(observation, playerId, n, rng = Math.random) {
    if (!observation.gameSpecific.fogOfWar) return [];
    const belief = getWarodDotsBelief(observation, playerId);
    belief.beginTurn(observation);
    return belief.sample(observation, n, rng, makeUnit);
  },

  toGrid(state) {
    const { board: { grid, cities, shapes }, units } = state;
    const shapeMap = !!shapes;
    const pidIdx = {};
    state.players.forEach((p, i) => { pidIdx[p.id] = i + 1; });

    // Snap units to grid cells (strongest unit wins each cell)
    const unitMap = {};
    for (const u of units) {
      const col = Math.max(0, Math.min(COLS - 1, Math.floor(u.x / T)));
      const row = Math.max(0, Math.min(ROWS - 1, Math.floor(u.y / T)));
      const key = `${col},${row}`;
      if (!unitMap[key] || u.hp > unitMap[key].hp) unitMap[key] = u;
    }

    const cityMap = {};
    for (const city of cities) cityMap[`${city.col},${city.row}`] = city;

    const cells = [];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const terrain = grid[row][col];
        const key = `${col},${row}`;
        const unit = unitMap[key];
        const city = cityMap[key];

        let glyph = '', owner = 0, hp, maxHp, unitId, unitName, isActive;
        if (unit) {
          glyph = unit.type === 'heavy' ? 'H' : 'L';
          unitName = unit.type === 'heavy' ? 'Heavy Infantry' : 'Light Infantry';
          owner = pidIdx[unit.owner] ?? 0;
          hp = unit.hp; maxHp = unit.maxHp;
          unitId = unit.id;
          isActive = state.activePlayers.includes(unit.owner);
        } else if (city) {
          glyph = city.isCapital ? '★' : '●';
          owner = pidIdx[city.owner] ?? 0;
        }

        // On a shape map the terrain is drawn by the SVG shapes below, so the tile layer
        // stays a uniform plains backdrop; the random-generator map keeps per-tile colours.
        const color = shapeMap ? TERRAIN_COLOR[TERRAIN.PLAINS] : (TERRAIN_COLOR[terrain] ?? '#3a6e28');
        cells.push({ x: col, y: row, glyph, owner, color, hp, maxHp, unitId, unitName, isActive });
      }
    }

    const gridOut = { width: COLS, height: ROWS, cells };
    if (shapeMap) {
      gridOut.shapes = shapes;
      gridOut.ui = { hideGrid: true };
    }
    return gridOut;
  },
};
