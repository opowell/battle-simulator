// SC1 unit definitions (turn-based scaled)
// hp, shields: health pools (shields regenerate +2/turn when not attacked, Protoss only)
// attack: damage per attack action
// armor: flat damage reduction (applied to hp damage; shields take full damage)
// range: Chebyshev attack range in tiles (1 = adjacent melee)
// moves: movement tiles per turn
// cost: { minerals, gas }
// supply: supply cost
// domain: 'ground' | 'air'
// buildingType: building that trains this unit
// buildTime: turns to train
// special: ability tags

export const UNITS = {
  // ── TERRAN ──────────────────────────────────────────────────────────────────
  scv: {
    race:'terran', hp:60,  shields:0, attack:5,  armor:0, range:1, moves:2,
    cost:{minerals:50,gas:0},   supply:1, domain:'ground',
    buildingType:'command-center', buildTime:4,
    special:['worker'],
  },
  marine: {
    race:'terran', hp:40,  shields:0, attack:6,  armor:0, range:4, moves:2,
    cost:{minerals:50,gas:0},   supply:1, domain:'ground',
    buildingType:'barracks', buildTime:3,
    special:[],
  },
  firebat: {
    race:'terran', hp:50,  shields:0, attack:16, armor:1, range:2, moves:2,
    cost:{minerals:50,gas:25},  supply:1, domain:'ground',
    buildingType:'barracks', buildTime:3,
    special:['splash'],
  },
  ghost: {
    race:'terran', hp:45,  shields:0, attack:10, armor:0, range:7, moves:3,
    cost:{minerals:25,gas:75},  supply:1, domain:'ground',
    buildingType:'barracks', buildTime:5,
    special:['cloak'],
  },
  vulture: {
    race:'terran', hp:80,  shields:0, attack:20, armor:0, range:5, moves:4,
    cost:{minerals:75,gas:0},   supply:2, domain:'ground',
    buildingType:'factory', buildTime:5,
    special:['spider-mines'],
  },
  'siege-tank': {
    race:'terran', hp:150, shields:0, attack:30, armor:1, range:5, moves:2,
    cost:{minerals:150,gas:100},supply:2, domain:'ground',
    buildingType:'factory', buildTime:6,
    special:['siege'],  // can toggle siege mode: range 8, attack 70, splash, immobile
  },
  goliath: {
    race:'terran', hp:125, shields:0, attack:12, armor:1, range:5, moves:2,
    cost:{minerals:100,gas:50}, supply:2, domain:'ground',
    buildingType:'factory', buildTime:5,
    special:['bonus-air-20'],  // +20 dmg vs air
  },
  wraith: {
    race:'terran', hp:120, shields:0, attack:8,  armor:0, range:5, moves:5,
    cost:{minerals:150,gas:100},supply:2, domain:'air',
    buildingType:'starport', buildTime:6,
    special:['cloak','bonus-ground-20'],
  },
  battlecruiser: {
    race:'terran', hp:500, shields:0, attack:25, armor:3, range:6, moves:2,
    cost:{minerals:400,gas:300},supply:6, domain:'air',
    buildingType:'starport', buildTime:10,
    special:['yamato'],  // once per game: deal 260 dmg to target
  },

  // ── ZERG ────────────────────────────────────────────────────────────────────
  drone: {
    race:'zerg', hp:40,  shields:0, attack:5,   armor:0, range:1, moves:2,
    cost:{minerals:50,gas:0},   supply:1, domain:'ground',
    buildingType:'hatchery', buildTime:3,
    special:['worker'],
  },
  zergling: {
    race:'zerg', hp:35,  shields:0, attack:5,   armor:0, range:1, moves:3,
    cost:{minerals:50,gas:0},   supply:1, domain:'ground',
    buildingType:'hatchery', buildTime:2,
    special:['pair'],  // 2 spawned per training slot
  },
  hydralisk: {
    race:'zerg', hp:80,  shields:0, attack:10,  armor:0, range:4, moves:2,
    cost:{minerals:75,gas:25},  supply:1, domain:'ground',
    buildingType:'hatchery', buildTime:4,
    special:[],
  },
  lurker: {
    race:'zerg', hp:125, shields:0, attack:20,  armor:1, range:6, moves:2,
    cost:{minerals:125,gas:125},supply:2, domain:'ground',
    buildingType:'hatchery', buildTime:5,
    special:['burrow-attack','splash'],  // must be burrowed to attack; cloaked when burrowed
  },
  mutalisk: {
    race:'zerg', hp:120, shields:0, attack:9,   armor:0, range:3, moves:5,
    cost:{minerals:100,gas:100},supply:2, domain:'air',
    buildingType:'hatchery', buildTime:5,
    special:['bounce'],  // bounces to 2 additional targets for 3 and 1 dmg
  },
  scourge: {
    race:'zerg', hp:25,  shields:0, attack:110, armor:0, range:1, moves:6,
    cost:{minerals:25,gas:75},  supply:1, domain:'air',
    buildingType:'hatchery', buildTime:2,
    special:['pair','self-destruct','anti-air'],
  },
  ultralisk: {
    race:'zerg', hp:400, shields:0, attack:20,  armor:2, range:1, moves:2,
    cost:{minerals:200,gas:200},supply:4, domain:'ground',
    buildingType:'hatchery', buildTime:8,
    special:['splash'],
  },
  overlord: {
    race:'zerg', hp:200, shields:0, attack:0,   armor:0, range:0, moves:2,
    cost:{minerals:100,gas:0},  supply:0, domain:'air',
    buildingType:'hatchery', buildTime:5,
    special:['supply-8','detector','transport-6'],
  },

  // ── PROTOSS ─────────────────────────────────────────────────────────────────
  probe: {
    race:'protoss', hp:20,  shields:20, attack:5,  armor:0, range:1, moves:2,
    cost:{minerals:50,gas:0},   supply:1, domain:'ground',
    buildingType:'nexus', buildTime:4,
    special:['worker'],
  },
  zealot: {
    race:'protoss', hp:100, shields:60, attack:8,  armor:1, range:1, moves:2,
    cost:{minerals:100,gas:0},  supply:2, domain:'ground',
    buildingType:'gateway', buildTime:4,
    special:[],
  },
  dragoon: {
    race:'protoss', hp:100, shields:80, attack:20, armor:1, range:4, moves:2,
    cost:{minerals:125,gas:50}, supply:2, domain:'ground',
    buildingType:'gateway', buildTime:5,
    special:[],
  },
  'high-templar': {
    race:'protoss', hp:40,  shields:40, attack:0,  armor:1, range:5, moves:2,
    cost:{minerals:50,gas:150}, supply:2, domain:'ground',
    buildingType:'gateway', buildTime:5,
    special:['psionic-storm'],  // deals 112 dmg to all in 3x3 area
  },
  'dark-templar': {
    race:'protoss', hp:80,  shields:40, attack:40, armor:1, range:1, moves:2,
    cost:{minerals:125,gas:100},supply:2, domain:'ground',
    buildingType:'gateway', buildTime:5,
    special:['permanent-cloak'],
  },
  archon: {
    race:'protoss', hp:10,  shields:350,attack:30, armor:0, range:2, moves:2,
    cost:{minerals:100,gas:300},supply:4, domain:'ground',
    buildingType:'gateway', buildTime:5,
    special:['splash'],
  },
  corsair: {
    race:'protoss', hp:100, shields:60, attack:5,  armor:0, range:5, moves:6,
    cost:{minerals:150,gas:100},supply:2, domain:'air',
    buildingType:'stargate', buildTime:6,
    special:['anti-air'],
  },
  carrier: {
    race:'protoss', hp:250, shields:150,attack:6,  armor:4, range:8, moves:3,
    cost:{minerals:350,gas:250},supply:6, domain:'air',
    buildingType:'stargate', buildTime:9,
    special:['interceptors'],  // attacks all enemies in range each turn
  },
  arbiter: {
    race:'protoss', hp:200, shields:150,attack:10, armor:2, range:5, moves:3,
    cost:{minerals:100,gas:350},supply:4, domain:'air',
    buildingType:'stargate', buildTime:8,
    special:['cloak-allies','recall'],
  },
};
