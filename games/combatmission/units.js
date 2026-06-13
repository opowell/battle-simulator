export const UNIT_DEFS = {
  // Allied (US)
  'rifle-squad': { hp: 10, attack: 5,  range: 5, moveRange: 2, ap: 2, symbol: 'R', label: 'Rifle Sqd' },
  'mg-team':     { hp:  5, attack: 8,  range: 7, moveRange: 1, ap: 2, symbol: 'G', label: 'MG Team'   },
  'sherman':     { hp: 20, attack: 12, range: 7, moveRange: 3, ap: 2, symbol: 'S', label: 'Sherman'   },
  // Axis (German)
  'volks-squad': { hp: 10, attack: 5,  range: 5, moveRange: 2, ap: 2, symbol: 'V', label: 'Volks Sqd' },
  'mg42-team':   { hp:  5, attack: 9,  range: 8, moveRange: 1, ap: 2, symbol: 'M', label: 'MG-42'     },
  'tiger':       { hp: 25, attack: 15, range: 8, moveRange: 2, ap: 2, symbol: 'K', label: 'Tiger'     },
};

export function createUnit(id, type, ownerId, position) {
  const def = UNIT_DEFS[type];
  return {
    id,
    ownerId,
    type,
    position,
    alive: true,
    hp: def.hp,
    maxHp: def.hp,
    suppression: 0,
    attrs: { symbol: def.symbol },
    perTurn: { ap: def.ap },
  };
}
