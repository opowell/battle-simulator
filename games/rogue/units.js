// level = attacker bonus for to-hit; defense = threshold to beat
// specialAbility: applied on a successful hit (see combat.js / RogueGame.js)
export const MONSTER_DEFS = {
  // A – rusts armor (no direct damage)
  aquator:     { symbol: 'A', hp: 20,  attack: [0,0],   level: 5, defense: 12, xp: 20,   vision: 5, minFloor: 5,  specialAbility: 'rust' },
  // B – erratic movement
  bat:         { symbol: 'B', hp: 6,   attack: [1,3],   level: 1, defense: 8,  xp: 1,    vision: 6, minFloor: 1,  specialAbility: 'random_move' },
  // C – fast, two-attack horse-man
  centaur:     { symbol: 'C', hp: 25,  attack: [2,5],   level: 4, defense: 14, xp: 15,   vision: 6, minFloor: 4 },
  // D – fire-breathing dragon
  dragon:      { symbol: 'D', hp: 100, attack: [3,8],   level:10, defense: 23, xp: 5000, vision: 8, minFloor:10 },
  // E – weak but fast
  emu:         { symbol: 'E', hp: 2,   attack: [1,2],   level: 1, defense: 7,  xp: 2,    vision: 5, minFloor: 1 },
  // F – holds hero in place (no damage)
  flytrap:     { symbol: 'F', hp: 34,  attack: [0,0],   level: 8, defense: 13, xp: 80,   vision: 3, minFloor: 7,  specialAbility: 'hold' },
  // G – regenerates HP each turn
  griffin:     { symbol: 'G', hp: 50,  attack: [4,3],   level:13, defense: 18, xp: 2000, vision: 8, minFloor:12,  specialAbility: 'regen' },
  // H – basic tough fighter
  hobgoblin:   { symbol: 'H', hp: 15,  attack: [1,8],   level: 3, defense: 13, xp: 3,    vision: 6, minFloor: 3 },
  // I – freezes hero for 2 turns (no damage)
  ice_monster: { symbol: 'I', hp: 12,  attack: [0,0],   level: 3, defense: 11, xp: 5,    vision: 4, minFloor: 3,  specialAbility: 'freeze' },
  // J – enormously powerful late-game monster
  jabberwock:  { symbol: 'J', hp: 132, attack: [2,12],  level:15, defense: 18, xp: 3000, vision: 7, minFloor:13 },
  // K – tiny and swift
  kestrel:     { symbol: 'K', hp: 1,   attack: [1,1],   level: 1, defense: 7,  xp: 1,    vision: 7, minFloor: 1 },
  // L – steals gold then teleports (no damage)
  leprechaun:  { symbol: 'L', hp: 10,  attack: [0,0],   level: 3, defense: 8,  xp: 10,   vision: 5, minFloor: 3,  specialAbility: 'steal_gold' },
  // M – confuses hero with its gaze
  medusa:      { symbol: 'M', hp: 64,  attack: [3,4],   level: 9, defense: 20, xp: 200,  vision: 7, minFloor: 9,  specialAbility: 'confuse' },
  // N – steals a random item then teleports (no damage)
  nymph:       { symbol: 'N', hp: 18,  attack: [0,0],   level: 9, defense: 9,  xp: 100,  vision: 5, minFloor: 8,  specialAbility: 'steal_item' },
  // O – brutish fighter
  orc:         { symbol: 'O', hp: 18,  attack: [1,8],   level: 4, defense: 14, xp: 5,    vision: 5, minFloor: 4 },
  // P – invisible until adjacent
  phantom:     { symbol: 'P', hp: 30,  attack: [4,4],   level: 8, defense: 13, xp: 120,  vision: 5, minFloor: 7,  specialAbility: 'invisible' },
  // Q – tough mid-game brute
  quagga:      { symbol: 'Q', hp: 15,  attack: [1,5],   level: 3, defense: 12, xp: 15,   vision: 5, minFloor: 3 },
  // R – drains hero strength on hit
  rattlesnake: { symbol: 'R', hp: 9,   attack: [1,6],   level: 2, defense: 13, xp: 9,    vision: 5, minFloor: 2,  specialAbility: 'drain_str' },
  // S – basic snake
  snake:       { symbol: 'S', hp: 8,   attack: [1,3],   level: 2, defense: 9,  xp: 2,    vision: 5, minFloor: 1 },
  // T – regenerates HP each turn
  troll:       { symbol: 'T', hp: 55,  attack: [2,6],   level: 7, defense: 16, xp: 25,   vision: 6, minFloor: 7,  specialAbility: 'regen' },
  // U – powerful magic-using demon
  ur_vile:     { symbol: 'U', hp: 30,  attack: [1,10],  level: 7, defense: 12, xp: 190,  vision: 5, minFloor: 7 },
  // V – drains hero max HP on hit
  vampire:     { symbol: 'V', hp: 40,  attack: [1,10],  level: 8, defense: 11, xp: 350,  vision: 6, minFloor: 8,  specialAbility: 'drain_hp' },
  // W – drains hero experience level on hit
  wraith:      { symbol: 'W', hp: 20,  attack: [1,6],   level: 5, defense: 14, xp: 55,   vision: 5, minFloor: 5,  specialAbility: 'drain_level' },
  // X – disguises as an item; revealed when attacked
  xeroc:       { symbol: 'X', hp: 16,  attack: [4,4],   level: 7, defense: 7,  xp: 100,  vision: 4, minFloor: 6,  specialAbility: 'mimic' },
  // Y – freezes hero like ice monster
  yeti:        { symbol: 'Y', hp: 20,  attack: [1,6],   level: 4, defense: 6,  xp: 50,   vision: 5, minFloor: 5,  specialAbility: 'freeze' },
  // Z – slow undead shambler
  zombie:      { symbol: 'Z', hp: 24,  attack: [2,4],   level: 5, defense: 14, xp: 7,    vision: 4, minFloor: 5 },
};

const MIMIC_CHARS = ['%','!','?',')',']','*'];

export function createHero(playerId, pos) {
  return {
    id: 'hero',
    ownerId: playerId,
    type: 'rogue',
    position: pos,
    alive: true,
    hp: 12, maxHp: 12,
    perTurn: {},
    attrs: {
      symbol: '@',
      weapon: 'dagger',
      weaponDmg: [1, 4],
      weaponEnchant: 0,
      armor: 'none',
      armorClass: 1,
      armorEnchant: 0,
      strength: 16,
      heroLevel: 1,
      inventory: [],
      gold: 0,
      leftRing: null,
      rightRing: null,
      // status effect durations (turns remaining)
      effects: {
        confused: 0,
        blind: 0,
        haste: 0,
        held: 0,
        frozen: 0,
        levitate: 0,
        see_invisible: 0,
        poisoned: false,
      },
    },
  };
}

export function createMonster(id, type, pos, rng) {
  const def = MONSTER_DEFS[type];
  const attrs = {
    symbol:         def.symbol,
    attack:         def.attack,
    defense:        def.defense,
    level:          def.level,
    xp:             def.xp,
    vision:         def.vision,
    asleep:         true,
    specialAbility: def.specialAbility ?? null,
  };
  // Xeroc picks a random item char to disguise as
  if (def.specialAbility === 'mimic' && rng) {
    attrs.mimicChar = MIMIC_CHARS[Math.floor(rng() * MIMIC_CHARS.length)];
    attrs.revealed  = false;
  }
  return {
    id,
    ownerId: 'dungeon',
    type,
    position: pos,
    alive: true,
    hp: def.hp, maxHp: def.hp,
    perTurn: {},
    attrs,
  };
}

export function spawnMonsters(rooms, dungeonLevel, existingUnits, rng) {
  const eligible = Object.entries(MONSTER_DEFS)
    .filter(([, def]) => def.minFloor <= dungeonLevel)
    .map(([type]) => type);

  const count    = 2 + Math.floor(dungeonLevel * 1.5);
  const occupied = new Set(existingUnits.map(u => `${u.position.x},${u.position.y}`));

  const monsters = [];
  let attempts   = 0;
  while (monsters.length < count && attempts < 200) {
    attempts++;
    const room = rooms[1 + Math.floor(rng() * (rooms.length - 1))];
    const x    = room.x + Math.floor(rng() * room.w);
    const y    = room.y + Math.floor(rng() * room.h);
    const key  = `${x},${y}`;
    if (occupied.has(key)) continue;
    occupied.add(key);
    const type = eligible[Math.floor(rng() * eligible.length)];
    monsters.push(createMonster(`m-${dungeonLevel}-${monsters.length}`, type, { x, y }, rng));
  }
  return monsters;
}
