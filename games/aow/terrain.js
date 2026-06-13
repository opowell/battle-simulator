export const TERRAIN = {
  plains:    { moveCost: 1,   defBonus: 0.00, passable: true,  symbol: '.' },
  forest:    { moveCost: 2,   defBonus: 0.50, passable: true,  symbol: 'f' },
  hills:     { moveCost: 2,   defBonus: 0.75, passable: true,  symbol: 'n' },
  mountains: { moveCost: 999, defBonus: 0.00, passable: false, symbol: '^' },
};
