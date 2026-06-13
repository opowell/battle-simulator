export const JOB_DEFS = {
  soldier: {
    race: 'human',
    stats: { hp: 28, mp: 10, atk: 10, def: 8, mag: 4, res: 4, spd: 7 },
    moveRange: 3,
    abilities: ['attack', 'shieldbearer', 'rend-armor'],
    symbol: 'S',
  },
  whiteMage: {
    race: 'human',
    stats: { hp: 20, mp: 30, atk: 5, def: 5, mag: 9, res: 10, spd: 6 },
    moveRange: 3,
    abilities: ['attack', 'cure', 'protect'],
    symbol: 'W',
  },
  blackMage: {
    race: 'nu-mou',
    stats: { hp: 16, mp: 40, atk: 4, def: 4, mag: 12, res: 8, spd: 5 },
    moveRange: 3,
    abilities: ['attack', 'fire', 'thunder', 'blizzard'],
    symbol: 'B',
  },
  archer: {
    race: 'viera',
    stats: { hp: 22, mp: 12, atk: 9, def: 5, mag: 6, res: 6, spd: 9 },
    moveRange: 4,
    abilities: ['attack', 'aim', 'blind'],
    symbol: 'A',
  },
  thief: {
    race: 'human',
    stats: { hp: 20, mp: 16, atk: 8, def: 5, mag: 5, res: 5, spd: 11 },
    moveRange: 4,
    abilities: ['attack', 'steal', 'mug'],
    symbol: 'T',
  },
  fighter: {
    race: 'bangaa',
    stats: { hp: 32, mp: 8, atk: 13, def: 9, mag: 3, res: 3, spd: 6 },
    moveRange: 3,
    abilities: ['attack', 'powerbreak', 'shatter'],
    symbol: 'F',
  },
};

export function createUnit(id, job, ownerId, position) {
  const def = JOB_DEFS[job];
  return {
    id,
    ownerId,
    job,
    race: def.race,
    position,
    alive: true,
    hp: def.stats.hp,
    maxHp: def.stats.hp,
    mp: def.stats.mp,
    maxMp: def.stats.mp,
    stats: { ...def.stats },
    abilities: [...def.abilities],
    symbol: def.symbol,
    moved: false,
    acted: false,
    statusEffects: [],
  };
}
