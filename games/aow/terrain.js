export const TERRAIN = {
  plains:    { moveCost: 1,   defBonus: 0.00, passable: true,  symbol: '.', color: '#b8a860', name: 'Plains',    description: 'Open ground.' },
  forest:    { moveCost: 2,   defBonus: 0.50, passable: true,  symbol: 'f', color: '#2a6830', name: 'Forest',    description: 'Passable; +50% defense.' },
  hills:     { moveCost: 2,   defBonus: 0.75, passable: true,  symbol: 'n', color: '#9a8050', name: 'Hills',     description: 'Passable; +75% defense.' },
  mountains: { moveCost: 999, defBonus: 0.00, passable: false, symbol: '^', color: '#706050', name: 'Mountains', description: 'Impassable.' },
};
