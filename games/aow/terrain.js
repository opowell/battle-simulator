// Terrain in The Ancient Art of War (1984). Each terrain affects three things:
//   speed    — multiplier on a squad's marching speed (flatlands fast, mountains crawl)
//   defBonus — fighting advantage for a squad defending on it (hills give downhill momentum)
//   forage   — passive supply the land yields per turn to a squad standing on it. Open,
//              fertile ground feeds a squad a little; barren mountains and water starve it
//              (negative), so a squad caught in the wrong terrain bleeds supply. Villages
//              and forts (map features, not terrain) are the real food sources.
//   passable — mountains and deep water block marching entirely.
//
// See games/aow/README.md for the strategy rationale.
export const TERRAIN = {
  plains: {
    speed: 1.00, defBonus: 0.00, forage: +3, passable: true,
    moveCost: 1, symbol: '.', color: '#b8a860', name: 'Plains',
    description: 'Open ground. Fast marching; small forage; no cover.',
  },
  forest: {
    speed: 0.55, defBonus: 0.35, forage: +1, passable: true,
    moveCost: 2, symbol: 'f', color: '#2a6830', name: 'Forest',
    description: 'Slow marching, tires men; +35% defence; light forage.',
  },
  hills: {
    speed: 0.65, defBonus: 0.60, forage: 0, passable: true,
    moveCost: 2, symbol: 'n', color: '#9a8050', name: 'Hills',
    description: 'Slow but commanding; +60% defence from downhill momentum.',
  },
  water: {
    speed: 0.35, defBonus: -0.40, forage: -4, passable: true,
    moveCost: 3, symbol: '~', color: '#28506e', name: 'Shallows',
    description: 'Fordable but perilous — slow, exposed, and men may drown.',
  },
  mountains: {
    speed: 0.20, defBonus: 0.00, forage: -6, passable: false,
    moveCost: 999, symbol: '^', color: '#706050', name: 'Mountains',
    description: 'Impassable ridge.',
  },
};

export const TERRAIN_KEYS = Object.keys(TERRAIN);
