export const WEAPONS = {
  pistol: { name: 'Pistol',        damage: 30,  range: 6,  cost: 0    },
  deagle: { name: 'Desert Eagle',  damage: 55,  range: 7,  cost: 700  },
  mp5:    { name: 'MP5',           damage: 26,  range: 8,  cost: 1500 },
  ak47:   { name: 'AK-47',        damage: 35,  range: 9,  cost: 2700 },
  m4a4:   { name: 'M4A4',         damage: 33,  range: 9,  cost: 3100 },
  awp:    { name: 'AWP',           damage: 110, range: 14, cost: 4750 },
};

export const ARMOR_COST       = 650;
export const ARMOR_HP         = 100;
export const ARMOR_REDUCTION  = 0.4; // fraction of damage absorbed by armor

export const STARTING_MONEY   = 800;
export const WIN_REWARD       = 3250;
export const BASE_LOSS_REWARD = 1400;
export const KILL_REWARD      = 300;
export const MAX_MONEY        = 16000;

export function lossReward(consecutiveLosses) {
  return Math.min(BASE_LOSS_REWARD + consecutiveLosses * 500, 3400);
}
