export const UNIT_DEFS = {
  // Allied squad
  rifleman:  { maxHP: 8,  aim: 75, maxAP: 2, moveRange: 2, maxRange: 10, damage: [3, 5], symbol: 'R', canHeal: false, suppressive: false, isOfficer: false },
  mg:        { maxHP: 7,  aim: 70, maxAP: 2, moveRange: 1, maxRange: 8,  damage: [4, 7], symbol: 'M', canHeal: false, suppressive: true,  isOfficer: false },
  sniper:    { maxHP: 6,  aim: 90, maxAP: 2, moveRange: 1, maxRange: 20, damage: [5, 8], symbol: 'S', canHeal: false, suppressive: false, isOfficer: false },
  medic:     { maxHP: 6,  aim: 60, maxAP: 2, moveRange: 2, maxRange: 7,  damage: [2, 4], symbol: '+', canHeal: true,  suppressive: false, isOfficer: false },
  // Axis infantry
  grenadier: { maxHP: 6,  aim: 65, maxAP: 2, moveRange: 2, maxRange: 8,  damage: [3, 5], symbol: 'g', canHeal: false, suppressive: false, isOfficer: false },
  mg42:      { maxHP: 8,  aim: 60, maxAP: 2, moveRange: 1, maxRange: 10, damage: [4, 6], symbol: 'm', canHeal: false, suppressive: true,  isOfficer: false },
  officer:   { maxHP: 7,  aim: 70, maxAP: 2, moveRange: 2, maxRange: 8,  damage: [3, 5], symbol: 'o', canHeal: false, suppressive: false, isOfficer: true  },
};

export function createUnit(id, type, ownerId, position) {
  const def = UNIT_DEFS[type];
  return {
    id, ownerId, type, position,
    alive: true,
    hp: def.maxHP,
    maxHp: def.maxHP,
    suppression: 0,
    attrs: {
      aim:        def.aim,
      damage:     def.damage,
      maxAP:      def.maxAP,
      moveRange:  def.moveRange,
      maxRange:   def.maxRange,
      symbol:     def.symbol,
      canHeal:    def.canHeal,
      suppressive: def.suppressive,
      isOfficer:  def.isOfficer,
    },
    perTurn: { ap: def.maxAP },
  };
}
