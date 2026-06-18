export const WEAPONS = {
  // ── Pistols ───────────────────────────────────────────────────────────────────
  pistol:    { name: 'Pistol',              damage: 30,  range: 6,  cost: 0,    category: 'pistol' },
  p250:      { name: 'P250',               damage: 38,  range: 7,  cost: 300,  category: 'pistol' },
  cz75:      { name: 'CZ75-Auto',          damage: 31,  range: 7,  cost: 500,  category: 'pistol' },
  tec9:      { name: 'Tec-9',              damage: 40,  range: 7,  cost: 500,  category: 'pistol', teams: ['T'] },
  fiveseven: { name: 'Five-SeveN',         damage: 38,  range: 8,  cost: 500,  category: 'pistol', teams: ['CT'] },
  r8:        { name: 'R8 Revolver',        damage: 60,  range: 8,  cost: 600,  category: 'pistol' },
  deagle:    { name: 'Desert Eagle',       damage: 55,  range: 8,  cost: 700,  category: 'pistol' },
  // ── SMGs ─────────────────────────────────────────────────────────────────────
  mac10:     { name: 'MAC-10',             damage: 22,  range: 7,  cost: 1050, category: 'smg',     teams: ['T'] },
  mp9:       { name: 'MP9',               damage: 23,  range: 7,  cost: 1250, category: 'smg',     teams: ['CT'] },
  ump45:     { name: 'UMP-45',             damage: 27,  range: 8,  cost: 1200, category: 'smg' },
  bizon:     { name: 'PP-Bizon',           damage: 24,  range: 8,  cost: 1400, category: 'smg' },
  mp5:       { name: 'MP5-SD',             damage: 26,  range: 8,  cost: 1500, category: 'smg' },
  mp7:       { name: 'MP7',               damage: 26,  range: 8,  cost: 1700, category: 'smg' },
  p90:       { name: 'P90',               damage: 26,  range: 9,  cost: 2350, category: 'smg' },
  // ── Shotguns ─────────────────────────────────────────────────────────────────
  nova:      { name: 'Nova',              damage: 52,  range: 3,  cost: 1050, category: 'shotgun' },
  sawedoff:  { name: 'Sawed-Off',          damage: 60,  range: 3,  cost: 1100, category: 'shotgun',  teams: ['T'] },
  mag7:      { name: 'MAG-7',             damage: 52,  range: 4,  cost: 1300, category: 'shotgun',  teams: ['CT'] },
  xm1014:    { name: 'XM1014',            damage: 40,  range: 4,  cost: 2000, category: 'shotgun' },
  // ── Heavy ─────────────────────────────────────────────────────────────────────
  negev:     { name: 'Negev',             damage: 35,  range: 10, cost: 1700, category: 'heavy' },
  m249:      { name: 'M249',              damage: 32,  range: 10, cost: 5200, category: 'heavy' },
  // ── Rifles ───────────────────────────────────────────────────────────────────
  galil:     { name: 'Galil AR',          damage: 30,  range: 9,  cost: 1800, category: 'rifle',   teams: ['T'] },
  famas:     { name: 'FAMAS',             damage: 30,  range: 9,  cost: 2250, category: 'rifle',   teams: ['CT'] },
  ak47:      { name: 'AK-47',             damage: 35,  range: 9,  cost: 2700, category: 'rifle',   teams: ['T'] },
  m4a1s:     { name: 'M4A1-S',            damage: 33,  range: 10, cost: 2900, category: 'rifle',   teams: ['CT'] },
  sg553:     { name: 'SG 553',            damage: 33,  range: 10, cost: 3000, category: 'rifle',   teams: ['T'] },
  m4a4:      { name: 'M4A4',              damage: 33,  range: 9,  cost: 3100, category: 'rifle',   teams: ['CT'] },
  aug:       { name: 'AUG',              damage: 32,  range: 10, cost: 3300, category: 'rifle',   teams: ['CT'] },
  // ── Snipers ───────────────────────────────────────────────────────────────────
  ssg08:     { name: 'SSG 08',            damage: 88,  range: 12, cost: 1700, category: 'sniper' },
  awp:       { name: 'AWP',              damage: 110, range: 14, cost: 4750, category: 'sniper' },
  g3sg1:     { name: 'G3SG1',            damage: 80,  range: 13, cost: 5000, category: 'sniper',  teams: ['T'] },
  scar20:    { name: 'SCAR-20',           damage: 80,  range: 13, cost: 5000, category: 'sniper',  teams: ['CT'] },
};

export const GRENADES = {
  he:         { name: 'HE Grenade',          cost: 300, maxStack: 1 },
  flash:      { name: 'Flashbang',           cost: 200, maxStack: 2 },
  smoke:      { name: 'Smoke Grenade',       cost: 300, maxStack: 1 },
  molotov:    { name: 'Molotov',             cost: 400, maxStack: 1, teams: ['T'] },
  incendiary: { name: 'Incendiary Grenade',  cost: 600, maxStack: 1, teams: ['CT'] },
  decoy:      { name: 'Decoy Grenade',       cost:  50, maxStack: 1 },
};

export const EQUIPMENT = {
  helmet:    { name: 'Helmet',     cost: 350 },
  defusekit: { name: 'Defuse Kit', cost: 400, teams: ['CT'] },
};

export const ARMOR_COST             = 650;
export const ARMOR_HP               = 100;
export const ARMOR_REDUCTION        = 0.40;
export const HELMET_EXTRA_REDUCTION = 0.10; // stacks with ARMOR_REDUCTION → 50% total

export const STARTING_MONEY   = 800;
export const WIN_REWARD       = 3250;
export const BASE_LOSS_REWARD = 1400;
export const KILL_REWARD      = 300;
export const MAX_MONEY        = 16000;

export const GRENADE_THROW_RANGE = 8;
export const HE_RADIUS           = 2;
export const HE_DAMAGE           = 50;
export const FLASH_RADIUS        = 3;
export const FLASH_BLIND_TURNS   = 1;
export const SMOKE_RADIUS        = 1;  // smoke covers (2r+1)² tiles centred on target
export const SMOKE_TURNS         = 5;
export const FIRE_RADIUS         = 1;
export const FIRE_DAMAGE         = 10;
export const FIRE_TURNS          = 3;

export function lossReward(consecutiveLosses) {
  return Math.min(BASE_LOSS_REWARD + consecutiveLosses * 500, 3400);
}
