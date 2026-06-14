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
  paladin: {
    race: 'human',
    stats: { hp: 30, mp: 16, atk: 10, def: 11, mag: 7, res: 8, spd: 6 },
    moveRange: 3,
    abilities: ['attack', 'holy-blade', 'shieldbearer'],
    symbol: 'P',
  },
  ninja: {
    race: 'human',
    stats: { hp: 18, mp: 16, atk: 12, def: 4, mag: 5, res: 4, spd: 13 },
    moveRange: 4,
    abilities: ['attack', 'throw', 'shadowstitch'],
    symbol: 'N',
  },
  dragoon: {
    race: 'bangaa',
    stats: { hp: 34, mp: 8, atk: 14, def: 8, mag: 3, res: 3, spd: 7 },
    moveRange: 3,
    abilities: ['attack', 'jump'],
    symbol: 'D',
  },
  elementalist: {
    race: 'viera',
    stats: { hp: 18, mp: 36, atk: 4, def: 4, mag: 10, res: 9, spd: 7 },
    moveRange: 3,
    abilities: ['attack', 'flood', 'gust'],
    symbol: 'L',
  },
  redMage: {
    race: 'viera',
    stats: { hp: 22, mp: 28, atk: 8, def: 5, mag: 8, res: 7, spd: 8 },
    moveRange: 3,
    abilities: ['attack', 'fire', 'cure'],
    symbol: 'R',
  },
  timeMage: {
    race: 'nu-mou',
    stats: { hp: 14, mp: 38, atk: 3, def: 3, mag: 11, res: 9, spd: 5 },
    moveRange: 3,
    abilities: ['attack', 'slow', 'haste'],
    symbol: 'M',
  },
  summoner: {
    race: 'nu-mou',
    stats: { hp: 14, mp: 44, atk: 3, def: 3, mag: 13, res: 8, spd: 5 },
    moveRange: 3,
    abilities: ['attack', 'eidolon'],
    symbol: 'U',
  },
  illusionist: {
    race: 'human',
    stats: { hp: 16, mp: 40, atk: 4, def: 4, mag: 12, res: 7, spd: 5 },
    moveRange: 3,
    abilities: ['attack', 'phantasm'],
    symbol: 'I',
  },
  assassin: {
    race: 'viera',
    stats: { hp: 20, mp: 14, atk: 11, def: 5, mag: 6, res: 5, spd: 12 },
    moveRange: 4,
    abilities: ['attack', 'rockseal'],
    symbol: 'X',
  },

  // ── Bangaa ────────────────────────────────────────────────────────────────
  warrior: {
    race: 'bangaa',
    stats: { hp: 38, mp: 6, atk: 15, def: 11, mag: 2, res: 2, spd: 5 },
    moveRange: 3,
    abilities: ['attack', 'bash', 'battle-cry'],
    symbol: 'V',
  },
  whiteMonk: {
    race: 'bangaa',
    stats: { hp: 32, mp: 16, atk: 13, def: 8, mag: 5, res: 7, spd: 7 },
    moveRange: 3,
    abilities: ['attack', 'chakra', 'air-render'],
    symbol: 'K',
  },
  bishop: {
    race: 'bangaa',
    stats: { hp: 22, mp: 32, atk: 5, def: 5, mag: 9, res: 11, spd: 5 },
    moveRange: 3,
    abilities: ['attack', 'holy', 'cura', 'esuna'],
    symbol: 'G',
  },
  templar: {
    race: 'bangaa',
    stats: { hp: 40, mp: 14, atk: 12, def: 13, mag: 6, res: 9, spd: 5 },
    moveRange: 3,
    abilities: ['attack', 'magic-hammer', 'saint-cross'],
    symbol: 'Q',
  },

  // ── Nu Mou ────────────────────────────────────────────────────────────────
  alchemist: {
    race: 'nu-mou',
    stats: { hp: 16, mp: 36, atk: 3, def: 4, mag: 10, res: 10, spd: 6 },
    moveRange: 3,
    abilities: ['attack', 'hi-potion', 'esuna'],
    symbol: 'C',
  },
  morpher: {
    race: 'nu-mou',
    stats: { hp: 20, mp: 28, atk: 7, def: 6, mag: 8, res: 7, spd: 7 },
    moveRange: 3,
    abilities: ['attack', 'call-beast', 'wild-boar'],
    symbol: 'H',
  },

  // ── Viera ─────────────────────────────────────────────────────────────────
  fencer: {
    race: 'viera',
    stats: { hp: 20, mp: 20, atk: 10, def: 5, mag: 7, res: 6, spd: 10 },
    moveRange: 4,
    abilities: ['attack', 'lunge', 'feather-blow'],
    symbol: 'E',
  },
  sniper: {
    race: 'viera',
    stats: { hp: 22, mp: 10, atk: 12, def: 5, mag: 5, res: 5, spd: 9 },
    moveRange: 3,
    abilities: ['attack', 'long-range', 'last-breath'],
    symbol: 'Z',
  },

  // ── Human ─────────────────────────────────────────────────────────────────
  blueMage: {
    race: 'human',
    stats: { hp: 20, mp: 32, atk: 6, def: 5, mag: 9, res: 7, spd: 7 },
    moveRange: 3,
    abilities: ['attack', 'bad-breath', 'aqua-breath', 'magic-hammer'],
    symbol: 'Y',
  },
  hunter: {
    race: 'human',
    stats: { hp: 24, mp: 12, atk: 11, def: 7, mag: 5, res: 5, spd: 9 },
    moveRange: 4,
    abilities: ['attack', 'aim-plus', 'net', 'hunt'],
    symbol: 'J',
  },

  // ── Moogle ────────────────────────────────────────────────────────────────
  mogKnight: {
    race: 'moogle',
    stats: { hp: 28, mp: 14, atk: 12, def: 8, mag: 5, res: 5, spd: 7 },
    moveRange: 3,
    abilities: ['attack', 'mog-attack', 'mog-rush'],
    symbol: 'O',
  },
  juggler: {
    race: 'moogle',
    stats: { hp: 18, mp: 20, atk: 9, def: 4, mag: 6, res: 5, spd: 10 },
    moveRange: 4,
    abilities: ['attack', 'toss-item', 'smile'],
    symbol: '@',
  },
  animist: {
    race: 'moogle',
    stats: { hp: 20, mp: 24, atk: 6, def: 5, mag: 8, res: 7, spd: 8 },
    moveRange: 3,
    abilities: ['attack', 'chocobo-rush', 'moogle-eye', 'sheep-count'],
    symbol: '$',
  },
  gunner: {
    race: 'moogle',
    stats: { hp: 20, mp: 12, atk: 10, def: 4, mag: 5, res: 4, spd: 9 },
    moveRange: 3,
    abilities: ['attack', 'burst-shot', 'fireshot', 'sootshot'],
    symbol: '&',
  },
};

export function createUnit(id, job, ownerId, position, facing = 0) {
  const def = JOB_DEFS[job];
  return {
    id,
    ownerId,
    job,
    race: def.race,
    position,
    facing,
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
    preMovedPosition: null,
  };
}
