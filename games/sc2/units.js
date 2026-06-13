// SC2 unit definitions (turn-based scaled)
// hp: health; shields: shield pool (regenerate +1/turn, Protoss)
// attack: base damage per attack; armor: flat HP damage reduction
// range: Chebyshev attack range (1 = adjacent melee)
// moves: movement tiles per turn
// cost: { minerals, gas }; supply: supply cost
// domain: 'ground' | 'air'
// buildingType: default producer building
// buildTime: turns to train
// special: ability tags
//
// Bonus tags:  bonus-armored-N  bonus-light-N  bonus-air-N  bonus-ground-N
// Domain tags: anti-air (can only hit air), anti-ground (can only hit ground)
// Bio tag: bio (healed by medivac, empd by ghost)
// Passive: regenerate (regen HP each turn), supply-N (provides N supply)
// Active:  stim, blink, siege, burrow-attack, self-destruct, assault-mode
//          inject-larva, fungal-growth, psionic-storm, spawn-broodlings
//          interceptors (attacks all targets in range), yamato (once: 260 dmg)

export const UNITS = {
  // ── TERRAN ──────────────────────────────────────────────────────────────────
  scv: {
    race:'terran', hp:45,  shields:0, attack:5,  armor:0, range:1, moves:2,
    cost:{minerals:50,gas:0},    supply:1, domain:'ground',
    buildingType:'command-center', buildTime:4,
    special:['worker','bio'],
  },
  marine: {
    race:'terran', hp:45,  shields:0, attack:6,  armor:0, range:4, moves:2,
    cost:{minerals:50,gas:0},    supply:1, domain:'ground',
    buildingType:'barracks', buildTime:3,
    special:['bio','stim'],  // stim: -10 hp → +1 move +3 attack this turn
  },
  marauder: {
    race:'terran', hp:125, shields:0, attack:10, armor:1, range:4, moves:2,
    cost:{minerals:100,gas:25},  supply:2, domain:'ground',
    buildingType:'barracks', buildTime:4,
    special:['bio','stim','bonus-armored-10'],  // stim: -20 hp → +1 move +5 attack
  },
  reaper: {
    race:'terran', hp:60,  shields:0, attack:4,  armor:0, range:4, moves:3,
    cost:{minerals:50,gas:50},   supply:1, domain:'ground',
    buildingType:'barracks', buildTime:3,
    special:['bio','regenerate','bonus-light-5'],
  },
  ghost: {
    race:'terran', hp:100, shields:0, attack:10, armor:0, range:6, moves:2,
    cost:{minerals:150,gas:125}, supply:2, domain:'ground',
    buildingType:'barracks', buildTime:5,
    special:['bio','cloak','emp'],  // emp: removes shields/energy from all in range 2
  },
  hellion: {
    race:'terran', hp:90,  shields:0, attack:8,  armor:0, range:5, moves:4,
    cost:{minerals:100,gas:0},   supply:2, domain:'ground',
    buildingType:'factory', buildTime:4,
    special:['bonus-light-6'],
  },
  'siege-tank': {
    race:'terran', hp:175, shields:0, attack:15, armor:1, range:5, moves:2,
    cost:{minerals:150,gas:125}, supply:3, domain:'ground',
    buildingType:'factory', buildTime:5,
    special:['siege'],  // siege mode: range 9, attack 40, splash, immobile
  },
  thor: {
    race:'terran', hp:400, shields:0, attack:30, armor:2, range:7, moves:2,
    cost:{minerals:300,gas:200}, supply:6, domain:'ground',
    buildingType:'factory', buildTime:8,
    special:['bonus-air-15','massive'],
  },
  medivac: {
    race:'terran', hp:150, shields:0, attack:0,  armor:1, range:0, moves:3,
    cost:{minerals:100,gas:100}, supply:2, domain:'air',
    buildingType:'starport', buildTime:5,
    special:['heal','transport-8'],  // heal: restores 2 hp to adjacent bio unit each turn
  },
  viking: {
    race:'terran', hp:125, shields:0, attack:12, armor:0, range:9, moves:4,
    cost:{minerals:150,gas:75},  supply:2, domain:'air',
    buildingType:'starport', buildTime:5,
    special:['anti-air','assault-mode'],  // can land: ground form attack 10 range 1
  },
  banshee: {
    race:'terran', hp:140, shields:0, attack:12, armor:0, range:6, moves:4,
    cost:{minerals:150,gas:100}, supply:3, domain:'air',
    buildingType:'starport', buildTime:6,
    special:['cloak','anti-ground'],  // can only attack ground
  },
  battlecruiser: {
    race:'terran', hp:550, shields:0, attack:25, armor:3, range:6, moves:2,
    cost:{minerals:400,gas:300}, supply:6, domain:'air',
    buildingType:'starport', buildTime:10,
    special:['yamato','massive'],  // yamato: once per game, 240 dmg to target
  },

  // ── ZERG ────────────────────────────────────────────────────────────────────
  drone: {
    race:'zerg', hp:40,  shields:0, attack:5,  armor:0, range:1, moves:2,
    cost:{minerals:50,gas:0},    supply:1, domain:'ground',
    buildingType:'hatchery', buildTime:3,
    special:['worker'],
  },
  zergling: {
    race:'zerg', hp:35,  shields:0, attack:5,  armor:0, range:1, moves:4,
    cost:{minerals:25,gas:0},    supply:1, domain:'ground',
    buildingType:'hatchery', buildTime:2,
    special:['pair','light'],  // 2 spawned per slot
  },
  baneling: {
    race:'zerg', hp:30,  shields:0, attack:20, armor:0, range:1, moves:3,
    cost:{minerals:25,gas:25},   supply:1, domain:'ground',
    buildingType:'hatchery', buildTime:2,
    special:['pair','self-destruct','splash','bonus-light-15','light'],
  },
  roach: {
    race:'zerg', hp:145, shields:0, attack:16, armor:1, range:4, moves:2,
    cost:{minerals:75,gas:25},   supply:2, domain:'ground',
    buildingType:'hatchery', buildTime:3,
    special:['regenerate','armored'],  // +3 hp per turn when not at max
  },
  ravager: {
    race:'zerg', hp:120, shields:0, attack:16, armor:1, range:6, moves:2,
    cost:{minerals:100,gas:100}, supply:3, domain:'ground',
    buildingType:'hatchery', buildTime:4,
    special:['corrosive-bile','armored'],  // bile: 60 dmg AoE at target position
  },
  hydralisk: {
    race:'zerg', hp:90,  shields:0, attack:12, armor:0, range:5, moves:2,
    cost:{minerals:100,gas:50},  supply:2, domain:'ground',
    buildingType:'hatchery', buildTime:4,
    special:[],
  },
  lurker: {
    race:'zerg', hp:200, shields:0, attack:20, armor:1, range:8, moves:2,
    cost:{minerals:150,gas:150}, supply:3, domain:'ground',
    buildingType:'hatchery', buildTime:5,
    special:['burrow-attack','splash'],  // must burrow to attack; line splash
  },
  infestor: {
    race:'zerg', hp:90,  shields:0, attack:0,  armor:0, range:0, moves:2,
    cost:{minerals:100,gas:150}, supply:2, domain:'ground',
    buildingType:'hatchery', buildTime:6,
    special:['fungal-growth','neural-parasite'],
  },
  queen: {
    race:'zerg', hp:175, shields:0, attack:9,  armor:1, range:5, moves:2,
    cost:{minerals:150,gas:0},   supply:2, domain:'ground',
    buildingType:'hatchery', buildTime:5,
    special:['inject-larva','transfuse','anti-air'],
  },
  swarmhost: {
    race:'zerg', hp:160, shields:0, attack:0,  armor:2, range:0, moves:2,
    cost:{minerals:200,gas:100}, supply:3, domain:'ground',
    buildingType:'hatchery', buildTime:6,
    special:['spawn-locusts'],  // spawns 2 locust units (temporary) each turn
  },
  ultralisk: {
    race:'zerg', hp:500, shields:0, attack:35, armor:2, range:1, moves:2,
    cost:{minerals:300,gas:200}, supply:6, domain:'ground',
    buildingType:'hatchery', buildTime:8,
    special:['splash','massive','armored'],
  },
  mutalisk: {
    race:'zerg', hp:120, shields:0, attack:9,  armor:0, range:3, moves:6,
    cost:{minerals:100,gas:100}, supply:2, domain:'air',
    buildingType:'hatchery', buildTime:5,
    special:['bounce','light'],  // bounces to 2 further targets for 3 and 1 dmg
  },
  corruptor: {
    race:'zerg', hp:200, shields:0, attack:14, armor:2, range:6, moves:4,
    cost:{minerals:150,gas:100}, supply:2, domain:'air',
    buildingType:'hatchery', buildTime:5,
    special:['anti-air','armored'],
  },
  broodlord: {
    race:'zerg', hp:225, shields:0, attack:20, armor:1, range:9, moves:2,
    cost:{minerals:300,gas:250}, supply:4, domain:'air',
    buildingType:'hatchery', buildTime:7,
    special:['spawn-broodlings','massive','armored'],
  },
  overlord: {
    race:'zerg', hp:200, shields:0, attack:0,  armor:0, range:0, moves:2,
    cost:{minerals:100,gas:0},   supply:0, domain:'air',
    buildingType:'hatchery', buildTime:5,
    special:['supply-8','transport-8'],
  },

  // ── PROTOSS ─────────────────────────────────────────────────────────────────
  probe: {
    race:'protoss', hp:20,  shields:20,  attack:5,  armor:0, range:1, moves:2,
    cost:{minerals:50,gas:0},    supply:1, domain:'ground',
    buildingType:'nexus', buildTime:4,
    special:['worker'],
  },
  zealot: {
    race:'protoss', hp:100, shields:50,  attack:8,  armor:1, range:1, moves:2,
    cost:{minerals:100,gas:0},   supply:2, domain:'ground',
    buildingType:'gateway', buildTime:4,
    special:['charge','light'],  // charge: +2 move bonus when dashing toward enemy
  },
  stalker: {
    race:'protoss', hp:80,  shields:80,  attack:13, armor:1, range:6, moves:2,
    cost:{minerals:125,gas:50},  supply:2, domain:'ground',
    buildingType:'gateway', buildTime:4,
    special:['blink','armored'],  // blink: teleport to any tile within 8 range
  },
  sentry: {
    race:'protoss', hp:40,  shields:40,  attack:6,  armor:1, range:5, moves:2,
    cost:{minerals:50,gas:100},  supply:2, domain:'ground',
    buildingType:'gateway', buildTime:3,
    special:['guardian-shield','light'],  // guardian shield: -2 ranged dmg to nearby allies
  },
  adept: {
    race:'protoss', hp:70,  shields:70,  attack:10, armor:1, range:4, moves:2,
    cost:{minerals:100,gas:25},  supply:2, domain:'ground',
    buildingType:'gateway', buildTime:4,
    special:['bonus-light-12','light'],
  },
  immortal: {
    race:'protoss', hp:200, shields:100, attack:20, armor:1, range:5, moves:2,
    cost:{minerals:275,gas:100}, supply:4, domain:'ground',
    buildingType:'robotics-facility', buildTime:6,
    special:['hardened-shield','bonus-armored-30','armored'],
    // hardened-shield: attacks >10 dmg vs shields are capped at 10
  },
  colossus: {
    race:'protoss', hp:200, shields:150, attack:10, armor:1, range:7, moves:2,
    cost:{minerals:300,gas:200}, supply:6, domain:'ground',
    buildingType:'robotics-facility', buildTime:7,
    special:['colossus-laser','massive'],
    // colossus-laser: attacks all units in a line from target, +10 vs light
  },
  'high-templar': {
    race:'protoss', hp:40,  shields:40,  attack:0,  armor:1, range:0, moves:2,
    cost:{minerals:50,gas:150},  supply:2, domain:'ground',
    buildingType:'gateway', buildTime:5,
    special:['psionic-storm','light'],  // storm: 80 dmg spread over 4 turns in AoE
  },
  'dark-templar': {
    race:'protoss', hp:40,  shields:80,  attack:45, armor:1, range:1, moves:2,
    cost:{minerals:125,gas:125}, supply:2, domain:'ground',
    buildingType:'gateway', buildTime:5,
    special:['permanent-cloak','light'],
  },
  archon: {
    race:'protoss', hp:10,  shields:350, attack:25, armor:0, range:3, moves:2,
    cost:{minerals:100,gas:300}, supply:4, domain:'ground',
    buildingType:'gateway', buildTime:5,
    special:['splash','massive'],
  },
  phoenix: {
    race:'protoss', hp:120, shields:60,  attack:5,  armor:0, range:4, moves:6,
    cost:{minerals:150,gas:100}, supply:2, domain:'air',
    buildingType:'stargate', buildTime:5,
    special:['anti-air','light'],
  },
  'void-ray': {
    race:'protoss', hp:150, shields:100, attack:6,  armor:0, range:6, moves:4,
    cost:{minerals:250,gas:150}, supply:4, domain:'air',
    buildingType:'stargate', buildTime:6,
    special:['armored','prismatic-beam'],  // deals double vs armored when targeting same unit 2nd time
  },
  carrier: {
    race:'protoss', hp:300, shields:150, attack:5,  armor:2, range:8, moves:3,
    cost:{minerals:350,gas:250}, supply:6, domain:'air',
    buildingType:'stargate', buildTime:9,
    special:['interceptors','massive'],  // attacks all enemies in range via interceptors
  },
  tempest: {
    race:'protoss', hp:300, shields:200, attack:40, armor:2, range:14, moves:2,
    cost:{minerals:300,gas:200}, supply:4, domain:'air',
    buildingType:'stargate', buildTime:8,
    special:['massive','armored'],
  },

  // ── TEMPORARY ────────────────────────────────────────────────────────────────
  locust: {
    race:'zerg', hp:50, shields:0, attack:10, armor:0, range:3, moves:4,
    cost:{minerals:0,gas:0}, supply:0, domain:'ground',
    buildingType:'hatchery', buildTime:0,
    special:['light','temporary'],  // temporary: removed at end of turn
  },
};
