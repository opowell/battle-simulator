// Unit types for the base game: infantry, armor, artillery. Figures are the
// unit's "hit points" — a hit removes one figure, the last removed scores a
// victory medal for the attacker.

export const UNIT_TYPES = {
  infantry: {
    name: 'Infantry',
    figures: 4,
    // move 1 and battle, OR move 2 and do not battle (see moveThenBattle in the game).
    moveAndBattle: 1,
    moveMax: 2,
    // Attack dice by range index: 3 at range 1, 2 at range 2, 1 at range 3.
    diceByRange: [3, 2, 1],
    needsLOS: true,
    ignoresTerrain: false,
    canTakeGround: true,
    canOverrun: false,
    glyph: 'I',
  },
  armor: {
    name: 'Armor',
    figures: 3,
    moveAndBattle: 3,
    moveMax: 3,
    diceByRange: [3, 3, 3],
    needsLOS: true,
    ignoresTerrain: false,
    canTakeGround: true,
    canOverrun: true,
    glyph: 'A',
  },
  artillery: {
    name: 'Artillery',
    figures: 2,
    // Move 1 OR battle (never both) — enforced in the game via moveAndBattle: 0.
    moveAndBattle: 0,
    moveMax: 1,
    diceByRange: [3, 3, 2, 2, 1, 1],
    needsLOS: false,       // artillery ignores line of sight
    ignoresTerrain: true,  // artillery ignores terrain dice reductions
    canTakeGround: false,
    canOverrun: false,
    glyph: 'R', // "aRtillery" — I/A already taken
  },
};

export function unitStats(type) {
  return UNIT_TYPES[type];
}

// Dice rolled before terrain reductions, given range (1-based hex distance).
export function baseDice(type, range) {
  const stats = UNIT_TYPES[type];
  const idx = range - 1;
  return idx < stats.diceByRange.length ? stats.diceByRange[idx] : 0;
}

// Max attack range (hexes) for a unit type.
export function maxRange(type) {
  return UNIT_TYPES[type].diceByRange.length;
}
