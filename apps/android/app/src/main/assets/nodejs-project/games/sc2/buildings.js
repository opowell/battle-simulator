// SC2 building definitions
// hp, shields: health pools
// cost: { minerals, gas }
// buildTime: turns for a worker to construct (0 = starting / pre-built / morphed)
// supplies: supply cap increase provided
// produces: unit types that can be queued here
// requirements: building types that must exist (alive, completed) to build/use this
// onVespene: must be placed on a vespene geyser tile
// attack, range: if building has a weapon
// special: ability tags
//   gas-extractor  detector  anti-air  anti-ground  garrison
//   warp-produces: list (on warp-gate) — units warped in instantly

export const BUILDINGS = {
  // ── TERRAN ──────────────────────────────────────────────────────────────────
  'command-center': {
    race:'terran', hp:1500, shields:0, cost:{minerals:400,gas:0},   buildTime:0,
    supplies:10, produces:['scv'],
    requirements:[], onVespene:false, attack:0, range:0, special:[],
  },
  'supply-depot': {
    race:'terran', hp:400,  shields:0, cost:{minerals:100,gas:0},   buildTime:4,
    supplies:8,  produces:[],
    requirements:[], onVespene:false, attack:0, range:0, special:[],
  },
  refinery: {
    race:'terran', hp:500,  shields:0, cost:{minerals:75,gas:0},    buildTime:3,
    supplies:0,  produces:[],
    requirements:[], onVespene:true, attack:0, range:0, special:['gas-extractor'],
  },
  barracks: {
    race:'terran', hp:1000, shields:0, cost:{minerals:150,gas:0},   buildTime:6,
    supplies:0,  produces:['marine','marauder','reaper','ghost'],
    requirements:[], onVespene:false, attack:0, range:0, special:[],
  },
  factory: {
    race:'terran', hp:1250, shields:0, cost:{minerals:150,gas:100}, buildTime:8,
    supplies:0,  produces:['hellion','siege-tank','thor'],
    requirements:['barracks'], onVespene:false, attack:0, range:0, special:[],
  },
  starport: {
    race:'terran', hp:1300, shields:0, cost:{minerals:150,gas:100}, buildTime:8,
    supplies:0,  produces:['medivac','viking','banshee','battlecruiser'],
    requirements:['factory'], onVespene:false, attack:0, range:0, special:[],
  },
  'engineering-bay': {
    race:'terran', hp:850,  shields:0, cost:{minerals:125,gas:0},   buildTime:5,
    supplies:0,  produces:[],
    requirements:[], onVespene:false, attack:0, range:0, special:[],
  },
  armory: {
    race:'terran', hp:750,  shields:0, cost:{minerals:150,gas:100}, buildTime:6,
    supplies:0,  produces:[],
    requirements:['factory'], onVespene:false, attack:0, range:0, special:[],
  },
  'ghost-academy': {
    race:'terran', hp:650,  shields:0, cost:{minerals:150,gas:50},  buildTime:5,
    supplies:0,  produces:[],
    requirements:['barracks'], onVespene:false, attack:0, range:0, special:[],
  },
  'fusion-core': {
    race:'terran', hp:750,  shields:0, cost:{minerals:150,gas:150}, buildTime:7,
    supplies:0,  produces:[],
    requirements:['starport'], onVespene:false, attack:0, range:0, special:[],
  },
  'missile-turret': {
    race:'terran', hp:200,  shields:0, cost:{minerals:100,gas:0},   buildTime:2,
    supplies:0,  produces:[],
    requirements:['engineering-bay'], onVespene:false,
    attack:12, range:7, special:['detector','anti-air'],
  },
  bunker: {
    race:'terran', hp:400,  shields:0, cost:{minerals:100,gas:0},   buildTime:3,
    supplies:0,  produces:[],
    requirements:['barracks'], onVespene:false,
    attack:6, range:6, special:['garrison'],
  },

  // ── ZERG ────────────────────────────────────────────────────────────────────
  hatchery: {
    race:'zerg', hp:1250, shields:0, cost:{minerals:300,gas:0},    buildTime:0,
    supplies:6,  produces:['drone','zergling','baneling','roach','ravager','hydralisk',
                           'lurker','infestor','queen','swarmhost','ultralisk',
                           'mutalisk','corruptor','broodlord','overlord'],
    requirements:[], onVespene:false, attack:0, range:0, special:[],
  },
  lair: {
    race:'zerg', hp:1800, shields:0, cost:{minerals:150,gas:100},  buildTime:8,
    supplies:8,  produces:['drone','zergling','baneling','roach','ravager','hydralisk',
                           'lurker','infestor','queen','swarmhost','ultralisk',
                           'mutalisk','corruptor','broodlord','overlord'],
    requirements:['hatchery','spawning-pool'], onVespene:false, attack:0, range:0,
    special:['upgrade-from-hatchery'],
  },
  hive: {
    race:'zerg', hp:2500, shields:0, cost:{minerals:200,gas:150},  buildTime:10,
    supplies:10, produces:['drone','zergling','baneling','roach','ravager','hydralisk',
                           'lurker','infestor','queen','swarmhost','ultralisk',
                           'mutalisk','corruptor','broodlord','overlord'],
    requirements:['lair'], onVespene:false, attack:0, range:0,
    special:['upgrade-from-lair'],
  },
  extractor: {
    race:'zerg', hp:500,  shields:0, cost:{minerals:25,gas:0},     buildTime:3,
    supplies:0,  produces:[],
    requirements:[], onVespene:true, attack:0, range:0, special:['gas-extractor'],
  },
  'spawning-pool': {
    race:'zerg', hp:750,  shields:0, cost:{minerals:200,gas:0},    buildTime:5,
    supplies:0,  produces:[],
    requirements:[], onVespene:false, attack:0, range:0, special:[],
  },
  'roach-warren': {
    race:'zerg', hp:850,  shields:0, cost:{minerals:150,gas:0},    buildTime:4,
    supplies:0,  produces:[],
    requirements:['spawning-pool'], onVespene:false, attack:0, range:0, special:[],
  },
  'baneling-nest': {
    race:'zerg', hp:750,  shields:0, cost:{minerals:100,gas:50},   buildTime:4,
    supplies:0,  produces:[],
    requirements:['spawning-pool'], onVespene:false, attack:0, range:0, special:[],
  },
  'hydralisk-den': {
    race:'zerg', hp:850,  shields:0, cost:{minerals:100,gas:100},  buildTime:5,
    supplies:0,  produces:[],
    requirements:['hatchery'], onVespene:false, attack:0, range:0, special:[],
  },
  'lurker-den': {
    race:'zerg', hp:850,  shields:0, cost:{minerals:100,gas:150},  buildTime:5,
    supplies:0,  produces:[],
    requirements:['hydralisk-den'], onVespene:false, attack:0, range:0, special:[],
  },
  'infestation-pit': {
    race:'zerg', hp:800,  shields:0, cost:{minerals:100,gas:100},  buildTime:6,
    supplies:0,  produces:[],
    requirements:['lair'], onVespene:false, attack:0, range:0, special:[],
  },
  spire: {
    race:'zerg', hp:900,  shields:0, cost:{minerals:200,gas:200},  buildTime:7,
    supplies:0,  produces:[],
    requirements:['lair'], onVespene:false, attack:0, range:0, special:[],
  },
  'greater-spire': {
    race:'zerg', hp:1000, shields:0, cost:{minerals:100,gas:150},  buildTime:6,
    supplies:0,  produces:[],
    requirements:['hive','spire'], onVespene:false, attack:0, range:0,
    special:['upgrade-from-spire'],
  },
  'ultralisk-cavern': {
    race:'zerg', hp:600,  shields:0, cost:{minerals:150,gas:200},  buildTime:7,
    supplies:0,  produces:[],
    requirements:['hive'], onVespene:false, attack:0, range:0, special:[],
  },
  'evolution-chamber': {
    race:'zerg', hp:750,  shields:0, cost:{minerals:75,gas:0},     buildTime:4,
    supplies:0,  produces:[],
    requirements:[], onVespene:false, attack:0, range:0, special:[],
  },
  'spine-crawler': {
    race:'zerg', hp:300,  shields:0, cost:{minerals:100,gas:0},    buildTime:4,
    supplies:0,  produces:[],
    requirements:['spawning-pool'], onVespene:false,
    attack:25, range:7, special:['anti-ground'],
  },
  'spore-crawler': {
    race:'zerg', hp:400,  shields:0, cost:{minerals:75,gas:0},     buildTime:3,
    supplies:0,  produces:[],
    requirements:['spawning-pool'], onVespene:false,
    attack:15, range:7, special:['detector','anti-air'],
  },

  // ── PROTOSS ─────────────────────────────────────────────────────────────────
  nexus: {
    race:'protoss', hp:1000, shields:0, cost:{minerals:400,gas:0},   buildTime:0,
    supplies:10, produces:['probe'],
    requirements:[], onVespene:false, attack:0, range:0, special:[],
  },
  pylon: {
    race:'protoss', hp:200,  shields:0, cost:{minerals:100,gas:0},   buildTime:3,
    supplies:8,  produces:[],
    requirements:[], onVespene:false, attack:0, range:0, special:['power-source'],
  },
  assimilator: {
    race:'protoss', hp:450,  shields:0, cost:{minerals:75,gas:0},    buildTime:2,
    supplies:0,  produces:[],
    requirements:[], onVespene:true, attack:0, range:0, special:['gas-extractor'],
  },
  gateway: {
    race:'protoss', hp:550,  shields:0, cost:{minerals:150,gas:0},   buildTime:5,
    supplies:0,  produces:['zealot','stalker','sentry','adept','high-templar','dark-templar','archon'],
    requirements:[], onVespene:false, attack:0, range:0, special:[],
  },
  'warp-gate': {
    race:'protoss', hp:550,  shields:0, cost:{minerals:0,gas:0},     buildTime:0,
    supplies:0,  produces:[],
    requirements:[], onVespene:false, attack:0, range:0,
    special:['warp-produces'],
    // warp-in units: zealot stalker sentry adept high-templar dark-templar archon
    // tracked in game logic; cooldown stored in building.attrs.cooldown
  },
  'cybernetics-core': {
    race:'protoss', hp:500,  shields:0, cost:{minerals:150,gas:0},   buildTime:5,
    supplies:0,  produces:[],
    requirements:['gateway'], onVespene:false, attack:0, range:0, special:[],
  },
  forge: {
    race:'protoss', hp:550,  shields:0, cost:{minerals:150,gas:0},   buildTime:4,
    supplies:0,  produces:[],
    requirements:[], onVespene:false, attack:0, range:0, special:[],
  },
  'twilight-council': {
    race:'protoss', hp:500,  shields:0, cost:{minerals:150,gas:100}, buildTime:5,
    supplies:0,  produces:[],
    requirements:['cybernetics-core'], onVespene:false, attack:0, range:0, special:[],
  },
  'robotics-facility': {
    race:'protoss', hp:450,  shields:0, cost:{minerals:200,gas:100}, buildTime:6,
    supplies:0,  produces:['immortal','colossus'],
    requirements:['cybernetics-core'], onVespene:false, attack:0, range:0, special:[],
  },
  'robotics-bay': {
    race:'protoss', hp:500,  shields:0, cost:{minerals:200,gas:200}, buildTime:6,
    supplies:0,  produces:[],
    requirements:['robotics-facility'], onVespene:false, attack:0, range:0, special:[],
  },
  stargate: {
    race:'protoss', hp:600,  shields:0, cost:{minerals:150,gas:150}, buildTime:7,
    supplies:0,  produces:['phoenix','void-ray','carrier','tempest'],
    requirements:['cybernetics-core'], onVespene:false, attack:0, range:0, special:[],
  },
  'fleet-beacon': {
    race:'protoss', hp:500,  shields:0, cost:{minerals:300,gas:200}, buildTime:7,
    supplies:0,  produces:[],
    requirements:['stargate'], onVespene:false, attack:0, range:0, special:[],
  },
  'templar-archives': {
    race:'protoss', hp:500,  shields:0, cost:{minerals:150,gas:200}, buildTime:6,
    supplies:0,  produces:[],
    requirements:['twilight-council'], onVespene:false, attack:0, range:0, special:[],
  },
  'dark-shrine': {
    race:'protoss', hp:500,  shields:0, cost:{minerals:150,gas:150}, buildTime:5,
    supplies:0,  produces:[],
    requirements:['twilight-council'], onVespene:false, attack:0, range:0, special:[],
  },
  'photon-cannon': {
    race:'protoss', hp:200,  shields:100,cost:{minerals:150,gas:0},  buildTime:3,
    supplies:0,  produces:[],
    requirements:['forge'], onVespene:false,
    attack:20, range:7, special:['detector'],
  },
  'shield-battery': {
    race:'protoss', hp:200,  shields:0, cost:{minerals:100,gas:0},   buildTime:3,
    supplies:0,  produces:[],
    requirements:['gateway'], onVespene:false, attack:0, range:0, special:['shield-restore'],
  },
};

export function raceBuildings(race) {
  return Object.entries(BUILDINGS).filter(([,b]) => b.race === race).map(([k]) => k);
}
