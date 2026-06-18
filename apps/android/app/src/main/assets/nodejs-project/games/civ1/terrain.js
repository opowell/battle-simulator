// Civ1 terrain definitions (faithful to 1991 original)
// Civ 1 had no railroads — only roads reduce movement cost to 1/3
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
