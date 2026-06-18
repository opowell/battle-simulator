// SC1 building definitions
// hp, shields: health (shields for Protoss)
// cost: { minerals, gas }
// buildTime: turns for a worker to construct (0 = starting building, pre-built)
// supplies: supply cap increase
// produces: unit types that can be queued here
// requirements: building types that must exist (at least one, alive) to build this
// onVespene: must be placed on a vespene geyser tile
// attack, range: if building has a weapon (turrets, bunkers, sunken/spore colonies)
// special: ability tags

export const BUILDINGS = {
  // ── TERRAN ──────────────────────────────────────────────────────────────────
  'command-center': {
    race:'terran', hp:1500, shields:0, cost:{minerals:400,gas:0},   buildTime:0,
    supplies:20, produces:['scv'],
    requirements:[], onVespene:false, attack:0, range:0, special:[],
  },
  'supply-depot': {
    race:'terran', hp:500,  shields:0, cost:{minerals:100,gas:0},   buildTime:4,
    supplies:8,  produces:[],
    requirements:[], onVespene:false, attack:0, range:0, special:[],
  },
  refinery: {
    race:'terran', hp:750,  shields:0, cost:{minerals:100,gas:0},   buildTime:3,
    supplies:0,  produces:[],
    requirements:[], onVespene:true, attack:0, range:0, special:['gas-extractor'],
  },
  barracks: {
    race:'terran', hp:1000, shields:0, cost:{minerals:150,gas:0},   buildTime:6,
    supplies:0,  produces:['marine','firebat','ghost'],
    requirements:[], onVespene:false, attack:0, range:0, special:[],
  },
  factory: {
    race:'terran', hp:1250, shields:0, cost:{minerals:200,gas:100}, buildTime:8,
    supplies:0,  produces:['vulture','siege-tank','goliath'],
    requirements:['barracks'], onVespene:false, attack:0, range:0, special:[],
  },
  starport: {
    race:'terran', hp:1300, shields:0, cost:{minerals:150,gas:100}, buildTime:8,
    supplies:0,  produces:['wraith','battlecruiser'],
    requirements:['factory'], onVespene:false, attack:0, range:0, special:[],
  },
  'engineering-bay': {
    race:'terran', hp:850,  shields:0, cost:{minerals:125,gas:0},   buildTime:5,
    supplies:0,  produces:[],
    requirements:[], onVespene:false, attack:0, range:0, special:[],
  },
  'missile-turret': {
    race:'terran', hp:200,  shields:0, cost:{minerals:75,gas:0},    buildTime:2,
    supplies:0,  produces:[],
    requirements:['engineering-bay'], onVespene:false,
    attack:12, range:7, special:['detector','anti-air'],
  },
  bunker: {
    race:'terran', hp:350,  shields:0, cost:{minerals:100,gas:0},   buildTime:3,
    supplies:0,  produces:[],
    requirements:['barracks'], onVespene:false,
    attack:6, range:5, special:['garrison'],
  },

  // ── ZERG ────────────────────────────────────────────────────────────────────
  hatchery: {
    race:'zerg', hp:1250, shields:0, cost:{minerals:300,gas:0},    buildTime:0,
    supplies:10, produces:['drone','zergling','hydralisk','overlord'],
    requirements:[], onVespene:false, attack:0, range:0, special:[],
  },
  lair: {
    race:'zerg', hp:1800, shields:0, cost:{minerals:150,gas:100},  buildTime:8,
    supplies:2,  produces:['drone','zergling','hydralisk','overlord','mutalisk','scourge','lurker'],
    requirements:['hatchery','spawning-pool'], onVespene:false, attack:0, range:0, special:['upgrade-from-hatchery'],
  },
  hive: {
    race:'zerg', hp:2500, shields:0, cost:{minerals:200,gas:150},  buildTime:10,
    supplies:2,  produces:['drone','zergling','hydralisk','overlord','mutalisk','scourge','lurker','ultralisk','queen','defiler'],
    requirements:['lair'], onVespene:false, attack:0, range:0, special:['upgrade-from-lair'],
  },
  extractor: {
    race:'zerg', hp:750,  shields:0, cost:{minerals:50,gas:0},     buildTime:3,
    supplies:0,  produces:[],
    requirements:[], onVespene:true, attack:0, range:0, special:['gas-extractor'],
  },
  'spawning-pool': {
    race:'zerg', hp:750,  shields:0, cost:{minerals:200,gas:0},    buildTime:5,
    supplies:0,  produces:[],
    requirements:[], onVespene:false, attack:0, range:0, special:[],
  },
  'hydralisk-den': {
    race:'zerg', hp:850,  shields:0, cost:{minerals:100,gas:50},   buildTime:4,
    supplies:0,  produces:[],
    requirements:['spawning-pool'], onVespene:false, attack:0, range:0, special:[],
  },
  spire: {
    race:'zerg', hp:900,  shields:0, cost:{minerals:200,gas:150},  buildTime:7,
    supplies:0,  produces:[],
    requirements:['lair'], onVespene:false, attack:0, range:0, special:[],
  },
  'sunken-colony': {
    race:'zerg', hp:300,  shields:0, cost:{minerals:75,gas:0},     buildTime:4,
    supplies:0,  produces:[],
    requirements:['spawning-pool'], onVespene:false,
    attack:40, range:7, special:['anti-ground'],
  },
  'spore-colony': {
    race:'zerg', hp:400,  shields:0, cost:{minerals:75,gas:0},     buildTime:4,
    supplies:0,  produces:[],
    requirements:['spawning-pool'], onVespene:false,
    attack:15, range:7, special:['detector','anti-air'],
  },
  'ultralisk-cavern': {
    race:'zerg', hp:600,  shields:0, cost:{minerals:150,gas:200},  buildTime:7,
    supplies:0,  produces:[],
    requirements:['hive'], onVespene:false, attack:0, range:0, special:[],
  },

  // ── PROTOSS ─────────────────────────────────────────────────────────────────
  nexus: {
    race:'protoss', hp:750,  shields:0, cost:{minerals:400,gas:0},   buildTime:0,
    supplies:9,  produces:['probe'],
    requirements:[], onVespene:false, attack:0, range:0, special:[],
  },
  pylon: {
    race:'protoss', hp:300,  shields:0, cost:{minerals:100,gas:0},   buildTime:3,
    supplies:8,  produces:[],
    requirements:[], onVespene:false, attack:0, range:0, special:[],
  },
  assimilator: {
    race:'protoss', hp:450,  shields:0, cost:{minerals:100,gas:0},   buildTime:2,
    supplies:0,  produces:[],
    requirements:[], onVespene:true, attack:0, range:0, special:['gas-extractor'],
  },
  gateway: {
    race:'protoss', hp:500,  shields:0, cost:{minerals:150,gas:0},   buildTime:5,
    supplies:0,  produces:['zealot','dragoon'],
    requirements:[], onVespene:false, attack:0, range:0, special:[],
  },
  'cybernetics-core': {
    race:'protoss', hp:500,  shields:0, cost:{minerals:200,gas:0},   buildTime:5,
    supplies:0,  produces:[],
    requirements:['gateway'], onVespene:false, attack:0, range:0, special:[],
  },
  forge: {
    race:'protoss', hp:550,  shields:0, cost:{minerals:150,gas:0},   buildTime:4,
    supplies:0,  produces:[],
    requirements:[], onVespene:false, attack:0, range:0, special:[],
  },
  'photon-cannon': {
    race:'protoss', hp:100,  shields:100,cost:{minerals:150,gas:0},  buildTime:3,
    supplies:0,  produces:[],
    requirements:['forge'], onVespene:false,
    attack:20, range:7, special:['detector'],
  },
  'templar-archives': {
    race:'protoss', hp:500,  shields:0, cost:{minerals:150,gas:200}, buildTime:6,
    supplies:0,  produces:[],
    requirements:['cybernetics-core'], onVespene:false, attack:0, range:0, special:[],
  },
  stargate: {
    race:'protoss', hp:600,  shields:0, cost:{minerals:150,gas:150}, buildTime:7,
    supplies:0,  produces:['scout','carrier','corsair','arbiter'],
    requirements:['cybernetics-core'], onVespene:false, attack:0, range:0, special:[],
  },
  'robotics-facility': {
    race:'protoss', hp:500,  shields:0, cost:{minerals:200,gas:200}, buildTime:7,
    supplies:0,  produces:[],
    requirements:['cybernetics-core'], onVespene:false, attack:0, range:0, special:[],
  },
};

// Derive which building types each race uses
export function raceBuildings(race) {
  return Object.entries(BUILDINGS).filter(([,b]) => b.race === race).map(([k]) => k);
}
