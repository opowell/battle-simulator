// magSize = rounds per magazine, reserve = spare rounds carried beyond the magazine.
// tier: loot rarity (1=common ... 4=rare) — drives which LOOT_SPAWNS bucket a weapon
// can appear in (see map.js) and lets a pickup only replace a strictly worse weapon
// (see SurvivGame.js's loot handler). Melee weapons have no tier (always held, never
// looted) and no ammo (magSize/reserve are null — see fullAmmo/isMelee).
export const WEAPONS = {
  // ── Melee (starting weapon; never runs out of "ammo") ─────────────────────────
  fists: { name: 'Fists', damage: 14, range: 0.9, category: 'melee', magSize: null, reserve: null },
  knife: { name: 'Combat Knife', damage: 26, range: 0.9, category: 'melee', magSize: null, reserve: null },
  // ── Pistols ─────────────────────────────────────────────────────────────────
  colt45: { name: 'Colt 1911', damage: 22, range: 6, category: 'pistol', magSize: 7, reserve: 21, tier: 1 },
  deagle: { name: 'Desert Eagle', damage: 44, range: 7, category: 'pistol', magSize: 7, reserve: 21, tier: 2 },
  // ── SMG ─────────────────────────────────────────────────────────────────────
  vector: { name: 'Vector', damage: 16, range: 7, category: 'smg', magSize: 25, reserve: 75, tier: 2 },
  // ── Shotguns ────────────────────────────────────────────────────────────────
  mp220: { name: 'MP220', damage: 68, range: 3, category: 'shotgun', magSize: 2, reserve: 10, tier: 1 },
  m1014: { name: 'M1014', damage: 56, range: 4, category: 'shotgun', magSize: 7, reserve: 21, tier: 2 },
  // ── Rifles ──────────────────────────────────────────────────────────────────
  famas: { name: 'FAMAS', damage: 24, range: 8, category: 'rifle', magSize: 30, reserve: 90, tier: 2 },
  m4a1:  { name: 'M4A1', damage: 25, range: 9, category: 'rifle', magSize: 30, reserve: 90, tier: 3 },
  scar:  { name: 'SCAR-H', damage: 34, range: 9, category: 'rifle', magSize: 20, reserve: 60, tier: 3 },
  // ── Snipers ─────────────────────────────────────────────────────────────────
  mosin: { name: 'Mosin-Nagant', damage: 75, range: 12, category: 'sniper', magSize: 5, reserve: 15, tier: 3 },
  awc:   { name: 'AWM-S', damage: 140, range: 14, category: 'sniper', magSize: 5, reserve: 15, tier: 4 },
};

// SVG source canvas size (see games/surviv/images/weapons/*.svg) — used by toGrid to
// scale each gun's held sprite to a consistent on-body length while preserving its own
// width/length ratio. Melee weapons render at a fixed square size instead (see toGrid).
export const WEAPON_SVG_SIZE = {
  colt45: { w: 56, h: 232 }, deagle: { w: 56, h: 232 }, vector: { w: 48, h: 208 },
  mp220: { w: 40, h: 128 }, m1014: { w: 56, h: 232 }, famas: { w: 48, h: 208 },
  m4a1: { w: 48, h: 196 }, scar: { w: 56, h: 196 }, mosin: { w: 70, h: 232 }, awc: { w: 60, h: 236 },
  knife: { w: 128, h: 128 },
};

export const GRENADES = {
  frag: { name: 'Frag Grenade', maxStack: 3 },
};

// Vest/helmet tiers, both 1-3. Reduction is the fraction of incoming damage absorbed;
// helmet and vest stack additively (see calcDamage in SurvivGame.js).
export const VEST_REDUCTION   = { 1: 0.15, 2: 0.25, 3: 0.35 };
export const HELMET_REDUCTION = { 1: 0.08, 2: 0.14, 3: 0.20 };

export const STARTING_HP  = 100;
export const MOVE_RANGE   = 4;   // per-turn continuous move budget (see SurvivGame.js MOVE_EPS)
export const PICKUP_RANGE = 0.6; // must be within this of a loot point to loot it
export const SHOOT_ACC_MAX = 0.90;
export const SHOOT_ACC_MIN = 0.50;

export const GRENADE_THROW_RANGE = 8;
export const FRAG_RADIUS = 2;
export const FRAG_DAMAGE = 55;

// Barrels explode when broken (see SurvivGame.js's 'break' action) — weaker than a
// frag grenade but free damage against anyone (either team) camping next to one.
export const BARREL_BLAST_RADIUS = 2;
export const BARREL_BLAST_DAMAGE = 45;

// Concealment: a unit standing in a bush is invisible to enemies beyond this range,
// even if it would otherwise be within normal vision range/cone/LOS (see belief.js).
export const BUSH_SPOT_RANGE = 1.6;

export function isMelee(weaponId) {
  return WEAPONS[weaponId]?.category === 'melee';
}

export function fullAmmo(weaponId) {
  const w = WEAPONS[weaponId];
  return isMelee(weaponId) ? { mag: 0, reserve: 0 } : { mag: w.magSize, reserve: w.reserve };
}
