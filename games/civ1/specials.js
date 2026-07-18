// Civ1 special resources.
//
// Specials aren't stored on the map — the original computes them from the tile's
// coordinates, so the same square always carries the same resource. This is the
// game's own rule, taken from its disassembled logic (JCivED's dd.civ.logic.port
// .CivLogic.isSpecialResource), not an approximation:
//
//   y must be 2..47 (the polar rows never carry specials), and
//   ((x&3)<<2) + (y&3) == (((x>>2)*13 + (y>>2)*11 + k) & 15)
//
// The left side enumerates the 16 squares of a 4x4 block; the right side hashes the
// block. So exactly one square per 4x4 block is special (~1 tile in 16), and `k`
// shifts which one — it is the game's per-world offset.
const SPECIAL_K = 0;

export function isSpecialResource(x, y, k = SPECIAL_K) {
  if (y <= 1 || y >= 48) return false;
  return (((x & 3) << 2) + (y & 3)) === ((((x >> 2) * 13) + ((y >> 2) * 11) + k) & 15);
}

// Per terrain: the resource's name and its icon, plus the yield it adds. The deltas
// are the difference between the original's special and normal yields for that
// terrain (e.g. ocean 1/0/2 -> 3/0/2 with fish, so +2 food), read out of the game's
// own terrain table. Grassland's special is the shield, which the original draws
// into the tile art and which changes no yield; river squares have no special.
export const SPECIALS = {
  desert:    { name: 'Oasis',    icon: 'special_oasis', food: 3, shields: 0, trade: 0 },
  plains:    { name: 'Horses',   icon: 'special_horse', food: 0, shields: 2, trade: 0 },
  forest:    { name: 'Pheasant', icon: 'special_game',  food: 2, shields: 0, trade: 0 },
  hills:     { name: 'Coal',     icon: 'special_coal',  food: 0, shields: 2, trade: 0 },
  mountains: { name: 'Gold',     icon: 'special_gold',  food: 0, shields: 0, trade: 6 },
  tundra:    { name: 'Game',     icon: 'special_doe',   food: 2, shields: 0, trade: 0 },
  arctic:    { name: 'Seals',    icon: 'special_seal',  food: 2, shields: 0, trade: 0 },
  swamp:     { name: 'Peat',     icon: 'special_peat',  food: 0, shields: 4, trade: 0 },
  jungle:    { name: 'Gems',     icon: 'special_gems',  food: 0, shields: 0, trade: 4 },
  ocean:     { name: 'Fish',     icon: 'special_fish',  food: 2, shields: 0, trade: 0 },
};

// The special this square carries, or null. Terrains with no special (grassland)
// and squares the rule skips return null.
export function specialAt(x, y, terrain, k = SPECIAL_K) {
  if (!isSpecialResource(x, y, k)) return null;
  return SPECIALS[terrain] ?? null;
}

// "Shield grassland". TERRAIN's grassland carries the table's base of 1 shield; the
// original zeroes it on half of grassland/river squares by this coordinate rule
// (from the same disassembled logic — computeMapSquareResources):
//   if (terrain is grassland/river) and ((7x + 11y) & 2) != 0 -> shields = 0
// The squares that keep it are the ones the game marks with a shield.
export function hasGrasslandShield(x, y) {
  return (((7 * x) + (11 * y)) & 2) === 0;
}

// A square's yield after the original's positional rules. `base` is the TERRAIN entry.
export function tileYield(base, terrain, x, y, k = SPECIAL_K) {
  const sp = specialAt(x, y, terrain, k);
  let { food, shields, trade } = base;
  if ((terrain === 'grassland' || terrain === 'river') && !hasGrasslandShield(x, y)) shields = 0;
  return {
    food: food + (sp?.food ?? 0),
    shields: shields + (sp?.shields ?? 0),
    trade: trade + (sp?.trade ?? 0),
  };
}
