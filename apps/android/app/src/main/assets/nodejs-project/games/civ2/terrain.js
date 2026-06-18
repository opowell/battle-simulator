// Civ2 terrain definitions
// moveCost: movement points consumed entering this tile (road=1/3, railroad=0)
// defBonus: multiplier added to base defense (0.5 = +50%)
// passable: which unit domains can enter
export const TERRAIN = {
  ocean:     { food:1, shields:0, trade:2, moveCost:1,  defBonus:0.00, passable:{land:false, sea:true,  air:true}, symbol:'~' },
  arctic:    { food:0, shields:0, trade:0, moveCost:2,  defBonus:0.00, passable:{land:true,  sea:false, air:true}, symbol:'^' },
  tundra:    { food:1, shields:0, trade:0, moveCost:1,  defBonus:0.00, passable:{land:true,  sea:false, air:true}, symbol:'t' },
  desert:    { food:0, shields:1, trade:0, moveCost:1,  defBonus:0.00, passable:{land:true,  sea:false, air:true}, symbol:'d' },
  plains:    { food:1, shields:1, trade:1, moveCost:1,  defBonus:0.00, passable:{land:true,  sea:false, air:true}, symbol:'.' },
  grassland: { food:2, shields:0, trade:0, moveCost:1,  defBonus:0.00, passable:{land:true,  sea:false, air:true}, symbol:',' },
  forest:    { food:1, shields:2, trade:0, moveCost:2,  defBonus:0.50, passable:{land:true,  sea:false, air:true}, symbol:'f' },
  hills:     { food:1, shields:2, trade:0, moveCost:3,  defBonus:1.00, passable:{land:true,  sea:false, air:true}, symbol:'n' },
  mountains: { food:0, shields:1, trade:0, moveCost:3,  defBonus:2.00, passable:{land:true,  sea:false, air:true}, symbol:'A' },
  swamp:     { food:1, shields:0, trade:0, moveCost:2,  defBonus:0.00, passable:{land:true,  sea:false, air:true}, symbol:'s' },
  jungle:    { food:1, shields:0, trade:0, moveCost:2,  defBonus:0.50, passable:{land:true,  sea:false, air:true}, symbol:'j' },
};

// Special resources available on each terrain type
export const TERRAIN_SPECIALS = {
  ocean:     ['fish',     'whales'  ],
  arctic:    ['ivory',    'oil'     ],
  tundra:    ['game',     'furs'    ],
  desert:    ['oasis',    'oil'     ],
  plains:    ['horse',    'wheat'   ],
  grassland: ['shield',   null      ], // 'shield' = extra production square
  forest:    ['pheasant', 'silk'    ],
  hills:     ['coal',     'wine'    ],
  mountains: ['gold',     'iron'    ],
  swamp:     ['oil',      'peat'    ],
  jungle:    ['gems',     'ivory'   ],
};

// Yield bonuses from special resources
export const SPECIAL_BONUSES = {
  fish:     { food:+2 },
  whales:   { food:+1, trade:+2 },
  ivory:    { trade:+4 },
  oil:      { shields:+3 },
  game:     { food:+2 },
  furs:     { trade:+3 },
  oasis:    { food:+3 },
  horse:    { shields:+2 },
  wheat:    { food:+2 },
  shield:   { shields:+1 },
  pheasant: { food:+2 },
  silk:     { trade:+3 },
  coal:     { shields:+2 },
  wine:     { trade:+3 },
  gold:     { trade:+4 },
  iron:     { shields:+2 },
  gems:     { trade:+4 },
  peat:     { shields:+2 },
};
