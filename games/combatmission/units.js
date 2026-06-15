export const UNIT_DEFS = {
  // Allied (US)
  'rifle-squad':   { hp: 10, attack:  5, range:  5, moveRange: 2, ap: 2, armor: 0, symbol: 'R', label: 'Rifle Sqd' },
  'mg-team':       { hp:  5, attack:  8, range:  7, moveRange: 1, ap: 2, armor: 0, symbol: 'G', label: 'MG Team'   },
  'sniper':        { hp:  3, attack: 12, range: 12, moveRange: 1, ap: 2, armor: 0, symbol: 'N', label: 'Sniper'    },
  'bazooka-team':  { hp:  4, attack: 20, range:  3, moveRange: 1, ap: 2, armor: 0, symbol: 'Z', label: 'Bazooka'   },
  'mortar-team':   { hp:  5, attack:  8, range: 10, moveRange: 1, ap: 2, armor: 0, symbol: 'O', label: 'Mortar'    },
  'sherman':       { hp: 20, attack: 12, range:  7, moveRange: 3, ap: 2, armor: 4, symbol: 'S', label: 'Sherman'   },
  'stuart':        { hp: 12, attack:  7, range:  5, moveRange: 4, ap: 2, armor: 2, symbol: 'U', label: 'Stuart'    },
  // Axis (German)
  'volks-squad':   { hp: 10, attack:  5, range:  5, moveRange: 2, ap: 2, armor: 0, symbol: 'V', label: 'Volks Sqd' },
  'mg42-team':     { hp:  5, attack:  9, range:  8, moveRange: 1, ap: 2, armor: 0, symbol: 'M', label: 'MG-42'     },
  'german-sniper': { hp:  3, attack: 13, range: 13, moveRange: 1, ap: 2, armor: 0, symbol: 'X', label: 'G.Sniper'  },
  'panzerschreck': { hp:  4, attack: 22, range:  3, moveRange: 1, ap: 2, armor: 0, symbol: 'P', label: 'Pzschreck' },
  'mortar-ger':    { hp:  5, attack:  9, range: 10, moveRange: 1, ap: 2, armor: 0, symbol: 'Q', label: 'G.Mortar'  },
  'panzer-iv':     { hp: 18, attack: 11, range:  7, moveRange: 3, ap: 2, armor: 3, symbol: 'F', label: 'Panzer IV' },
  'tiger':         { hp: 25, attack: 15, range:  8, moveRange: 2, ap: 2, armor: 7, symbol: 'K', label: 'Tiger'     },
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
