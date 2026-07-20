// magSize = rounds per magazine, reserve = spare rounds carried beyond the magazine.
// Melee (knife) has neither — it's never bought or reloaded, every unit starts with one
// in its fixed 'melee' loadout slot (see CsGame.js's makeUnit/WEAPON_SLOT).
export const WEAPONS = {
  // ── Melee ────────────────────────────────────────────────────────────────────
  knife:     { name: 'Knife',               damage: 40,  range: 1,  cost: 0,    category: 'melee' },
  // ── Pistols ───────────────────────────────────────────────────────────────────
  pistol:    { name: 'Pistol',              damage: 30,  range: 6,  cost: 0,    category: 'pistol', magSize: 12, reserve: 24 },
  p250:      { name: 'P250',               damage: 38,  range: 7,  cost: 300,  category: 'pistol', magSize: 13, reserve: 26 },
  cz75:      { name: 'CZ75-Auto',          damage: 31,  range: 7,  cost: 500,  category: 'pistol', magSize: 12, reserve: 24 },
  tec9:      { name: 'Tec-9',              damage: 40,  range: 7,  cost: 500,  category: 'pistol', teams: ['T'],  magSize: 18, reserve: 54 },
  fiveseven: { name: 'Five-SeveN',         damage: 38,  range: 8,  cost: 500,  category: 'pistol', teams: ['CT'], magSize: 20, reserve: 100 },
  r8:        { name: 'R8 Revolver',        damage: 60,  range: 8,  cost: 600,  category: 'pistol', magSize: 8,  reserve: 8 },
  deagle:    { name: 'Desert Eagle',       damage: 55,  range: 8,  cost: 700,  category: 'pistol', magSize: 7,  reserve: 35 },
  // ── SMGs ─────────────────────────────────────────────────────────────────────
  mac10:     { name: 'MAC-10',             damage: 22,  range: 7,  cost: 1050, category: 'smg',     teams: ['T'],  magSize: 30, reserve: 90 },
  mp9:       { name: 'MP9',               damage: 23,  range: 7,  cost: 1250, category: 'smg',     teams: ['CT'], magSize: 30, reserve: 120 },
  ump45:     { name: 'UMP-45',             damage: 27,  range: 8,  cost: 1200, category: 'smg', magSize: 25, reserve: 100 },
  bizon:     { name: 'PP-Bizon',           damage: 24,  range: 8,  cost: 1400, category: 'smg', magSize: 64, reserve: 120 },
  mp5:       { name: 'MP5-SD',             damage: 26,  range: 8,  cost: 1500, category: 'smg', magSize: 30, reserve: 120 },
  mp7:       { name: 'MP7',               damage: 26,  range: 8,  cost: 1700, category: 'smg', magSize: 30, reserve: 120 },
  p90:       { name: 'P90',               damage: 26,  range: 9,  cost: 2350, category: 'smg', magSize: 50, reserve: 100 },
  // ── Shotguns ─────────────────────────────────────────────────────────────────
  nova:      { name: 'Nova',              damage: 52,  range: 3,  cost: 1050, category: 'shotgun', magSize: 8, reserve: 32 },
  sawedoff:  { name: 'Sawed-Off',          damage: 60,  range: 3,  cost: 1100, category: 'shotgun',  teams: ['T'],  magSize: 7, reserve: 32 },
  mag7:      { name: 'MAG-7',             damage: 52,  range: 4,  cost: 1300, category: 'shotgun',  teams: ['CT'], magSize: 5, reserve: 32 },
  xm1014:    { name: 'XM1014',            damage: 40,  range: 4,  cost: 2000, category: 'shotgun', magSize: 7, reserve: 32 },
  // ── Heavy ─────────────────────────────────────────────────────────────────────
  negev:     { name: 'Negev',             damage: 35,  range: 10, cost: 1700, category: 'heavy', magSize: 150, reserve: 200 },
  m249:      { name: 'M249',              damage: 32,  range: 10, cost: 5200, category: 'heavy', magSize: 100, reserve: 200 },
  // ── Rifles ───────────────────────────────────────────────────────────────────
  galil:     { name: 'Galil AR',          damage: 30,  range: 9,  cost: 1800, category: 'rifle',   teams: ['T'],  magSize: 35, reserve: 90 },
  famas:     { name: 'FAMAS',             damage: 30,  range: 9,  cost: 2250, category: 'rifle',   teams: ['CT'], magSize: 25, reserve: 90 },
  ak47:      { name: 'AK-47',             damage: 35,  range: 9,  cost: 2700, category: 'rifle',   teams: ['T'],  magSize: 30, reserve: 90 },
  m4a1s:     { name: 'M4A1-S',            damage: 33,  range: 10, cost: 2900, category: 'rifle',   teams: ['CT'], magSize: 20, reserve: 60 },
  sg553:     { name: 'SG 553',            damage: 33,  range: 10, cost: 3000, category: 'rifle',   teams: ['T'],  magSize: 30, reserve: 90 },
  m4a4:      { name: 'M4A4',              damage: 33,  range: 9,  cost: 3100, category: 'rifle',   teams: ['CT'], magSize: 30, reserve: 90 },
  aug:       { name: 'AUG',              damage: 32,  range: 10, cost: 3300, category: 'rifle',   teams: ['CT'], magSize: 30, reserve: 90 },
  // ── Snipers ───────────────────────────────────────────────────────────────────
  ssg08:     { name: 'SSG 08',            damage: 88,  range: 12, cost: 1700, category: 'sniper', magSize: 10, reserve: 90 },
  awp:       { name: 'AWP',              damage: 110, range: 14, cost: 4750, category: 'sniper', magSize: 10, reserve: 30 },
  g3sg1:     { name: 'G3SG1',            damage: 80,  range: 13, cost: 5000, category: 'sniper',  teams: ['T'],  magSize: 20, reserve: 90 },
  scar20:    { name: 'SCAR-20',           damage: 80,  range: 13, cost: 5000, category: 'sniper',  teams: ['CT'], magSize: 20, reserve: 90 },
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
// Extra damage reduction while crouched, stacks with armor. Lives here with the
// other two reduction terms (rather than privately in CsGame.js) because the
// Obscuro leaf evaluator has to reproduce calcDamage exactly to price a duel —
// a copied literal would silently drift from the engine.
export const CROUCH_DAMAGE_REDUCTION = 0.15;

export const STARTING_MONEY   = 800;
export const WIN_REWARD       = 3250;
export const BASE_LOSS_REWARD = 1400;
export const KILL_REWARD      = 300;
export const MAX_MONEY        = 16000;

// ── Round rules ───────────────────────────────────────────────────────────────
// Round-scoped constants (as opposed to the match-scoped scoring above). They live
// here, with the other rules constants, rather than privately inside CsGame.js
// because the Obscuro leaf evaluator (eval.js) has to price the round clock and the
// bomb timer, and importing them back out of CsGame.js would be a circular import
// (CsGame.js → eval.js → CsGame.js).
export const BOMB_TIMER     = 8;  // turns from plant to detonation
export const DEFUSE_NEEDED  = 2;  // consecutive defuse turns needed (1 with a kit)
export const ROUND_TURN_MAX = 24; // turns before an unplanted round times out (CT win)

export const GRENADE_THROW_RANGE = 16; // doubled alongside the 3x map/vision resize (2026-07-17) to keep grenades usable at the new scale
export const HE_RADIUS           = 2;
export const HE_DAMAGE           = 50;
export const FLASH_RADIUS        = 3;
export const FLASH_BLIND_TURNS   = 1;
// A smoke cloud is a DISC of this radius centred exactly on the thrown point.
// (It used to be described as "(2r+1)² tiles centred on target" — that wording
// predates continuous positions: a smoke is thrown to an exact point now, not a
// tile, so there is no tile square involved. See smokeOval below.)
export const SMOKE_RADIUS        = 1;
export const SMOKE_TURNS         = 5;

/**
 * The bounding box of one smoke cloud, as the shape helpers want it
 * ({x, y, w, h} of an oval). THE one definition — both the sight-blocking shape
 * (belief.js's csLosLayers) and the drawn shape (CsGame.js's renderState) derive
 * from it, so what you see is exactly what hides you.
 *
 * They used to be written out separately and had drifted apart: the blocker was
 * `w: 2*SMOKE_RADIUS` (a disc of radius r centred on the throw point — correct)
 * while the render was `w: 2*SMOKE_RADIUS + 1` (radius r+0.5, centred half a unit
 * down-right). The visible cloud was 50% wider than the one that actually blocked
 * line of sight, so a player standing in what looked like thick smoke was plainly
 * visible — and belief.js's whole premise is that the fog veil hides exactly what
 * the engine hides.
 */
export function smokeOval(cx, cy) {
  return { shape: 'oval', x: cx - SMOKE_RADIUS, y: cy - SMOKE_RADIUS, w: 2 * SMOKE_RADIUS, h: 2 * SMOKE_RADIUS };
}
export const FIRE_RADIUS         = 1;
export const FIRE_DAMAGE         = 10;
export const FIRE_TURNS          = 3;

export function lossReward(consecutiveLosses) {
  return Math.min(BASE_LOSS_REWARD + consecutiveLosses * 500, 3400);
}
