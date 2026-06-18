export const UNIT_DEFS = {
  // XCOM squad
  soldier: { maxHP: 8,  aim: 75, maxAP: 2, moveRange: 3, damage: [3, 5], symbol: 'S' },
  heavy:   { maxHP: 12, aim: 65, maxAP: 2, moveRange: 2, damage: [5, 8], symbol: 'H' },
  sniper:  { maxHP: 6,  aim: 85, maxAP: 2, moveRange: 4, damage: [4, 7], symbol: 'N' },
  support: { maxHP: 8,  aim: 70, maxAP: 2, moveRange: 3, damage: [3, 5], symbol: 'P' },
  // Aliens
  sectoid: { maxHP: 4,  aim: 65, maxAP: 2, moveRange: 3, damage: [2, 4], symbol: 'z' },
  floater: { maxHP: 6,  aim: 60, maxAP: 2, moveRange: 4, damage: [3, 5], symbol: 'f' },
  muton:   { maxHP: 10, aim: 70, maxAP: 2, moveRange: 2, damage: [4, 7], symbol: 'm' },
};

export function createUnit(id, type, ownerId, position) {
  const def = UNIT_DEFS[type];
  return {
    id,
    ownerId,
    type,
    position,
    alive: true,
    hp: def.maxHP,
    attrs: {
      aim: def.aim,
      damage: def.damage,
      maxAP: def.maxAP,
      moveRange: def.moveRange,
      symbol: def.symbol,
    },
    perTurn: { ap: def.maxAP },
  };
}
