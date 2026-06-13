// level = attacker bonus for to-hit rolls; defense = threshold to beat
export const MONSTER_DEFS = {
  bat:        { symbol: 'B', hp: 6,   attack: [1,3],  level: 1, defense: 8,  xp: 1,   vision: 6, minFloor: 1 },
  kobold:     { symbol: 'k', hp: 5,   attack: [1,4],  level: 1, defense: 10, xp: 1,   vision: 5, minFloor: 1 },
  snake:      { symbol: 's', hp: 8,   attack: [1,3],  level: 2, defense: 9,  xp: 2,   vision: 5, minFloor: 1 },
  ice_monster:{ symbol: 'I', hp: 12,  attack: [1,8],  level: 3, defense: 11, xp: 5,   vision: 4, minFloor: 3 },
  hobgoblin:  { symbol: 'H', hp: 15,  attack: [1,8],  level: 3, defense: 13, xp: 3,   vision: 6, minFloor: 3 },
  orc:        { symbol: 'o', hp: 18,  attack: [1,8],  level: 4, defense: 14, xp: 5,   vision: 5, minFloor: 4 },
  zombie:     { symbol: 'Z', hp: 24,  attack: [2,4],  level: 5, defense: 14, xp: 7,   vision: 4, minFloor: 5 },
  centipede:  { symbol: 'C', hp: 20,  attack: [1,6],  level: 6, defense: 15, xp: 9,   vision: 5, minFloor: 6 },
  troll:      { symbol: 'T', hp: 55,  attack: [2,6],  level: 7, defense: 16, xp: 25,  vision: 6, minFloor: 7 },
  medusa:     { symbol: 'M', hp: 64,  attack: [3,4],  level: 9, defense: 20, xp: 200, vision: 7, minFloor: 9 },
  dragon:     { symbol: 'D', hp: 100, attack: [3,8],  level:10, defense: 23, xp: 5000,vision: 8, minFloor:10 },
};

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
      armor: 'none',
      armorClass: 1,
      strength: 16,
      heroLevel: 1,
      inventory: [],
      gold: 0,
    },
  };
}

export function createMonster(id, type, pos) {
  const def = MONSTER_DEFS[type];
  return {
    id,
    ownerId: 'dungeon',
    type,
    position: pos,
    alive: true,
    hp: def.hp, maxHp: def.hp,
    perTurn: {},
    attrs: {
      symbol:  def.symbol,
      attack:  def.attack,
      defense: def.defense,
      level:   def.level,
      xp:      def.xp,
      vision:  def.vision,
      asleep:  true,
    },
  };
}

export function spawnMonsters(rooms, dungeonLevel, existingUnits, rng) {
  const eligible = Object.entries(MONSTER_DEFS)
    .filter(([, def]) => def.minFloor <= dungeonLevel)
    .map(([type]) => type);

  const count = 2 + Math.floor(dungeonLevel * 1.5);
  const occupied = new Set(existingUnits.map(u => `${u.position.x},${u.position.y}`));

  const monsters = [];
  let attempts = 0;
  while (monsters.length < count && attempts < 200) {
    attempts++;
    // Avoid room 0 (hero's starting room)
    const room = rooms[1 + Math.floor(rng() * (rooms.length - 1))];
    const x = room.x + Math.floor(rng() * room.w);
    const y = room.y + Math.floor(rng() * room.h);
    const key = `${x},${y}`;
    if (occupied.has(key)) continue;
    occupied.add(key);
    const type = eligible[Math.floor(rng() * eligible.length)];
    monsters.push(createMonster(`m-${dungeonLevel}-${monsters.length}`, type, { x, y }));
  }
  return monsters;
}
