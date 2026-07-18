// Civ1 terrain definitions — yields/movement/defence read out of the original game's
// own terrain table (JCivED's dd.civ.data.game.types.TerrainType, which ports the
// 1991 data), not from memory. defBonus is defenseRatio/2 - 1 (the table stores it in
// half-steps: 2 = none, 3 = +50%, 4 = +100%, 6 = +200%).
//
// Grassland's `shields:1` is the table's base. The original then zeroes it on half of
// grassland/river squares via a coordinate rule — see hasGrasslandShield in specials.js
// — which is the familiar "shield grassland".
// Civ 1 had no railroads — only roads reduce movement cost to 1/3
export const TERRAIN = {
  ocean:     { food:1, shields:0, trade:2, moveCost:1,  defBonus:0.00, passable:{land:false, sea:true,  air:true}, symbol:'~' },
  arctic:    { food:0, shields:0, trade:0, moveCost:2,  defBonus:0.00, passable:{land:true,  sea:false, air:true}, symbol:'^' },
  tundra:    { food:1, shields:0, trade:0, moveCost:1,  defBonus:0.00, passable:{land:true,  sea:false, air:true}, symbol:'t' },
  desert:    { food:0, shields:1, trade:0, moveCost:1,  defBonus:0.00, passable:{land:true,  sea:false, air:true}, symbol:'d' },
  plains:    { food:1, shields:1, trade:0, moveCost:1,  defBonus:0.00, passable:{land:true,  sea:false, air:true}, symbol:'.' },
  grassland: { food:2, shields:1, trade:0, moveCost:1,  defBonus:0.00, passable:{land:true,  sea:false, air:true}, symbol:',' },
  forest:    { food:1, shields:2, trade:0, moveCost:2,  defBonus:0.50, passable:{land:true,  sea:false, air:true}, symbol:'f' },
  hills:     { food:1, shields:0, trade:0, moveCost:2,  defBonus:1.00, passable:{land:true,  sea:false, air:true}, symbol:'n' },
  mountains: { food:0, shields:1, trade:0, moveCost:3,  defBonus:2.00, passable:{land:true,  sea:false, air:true}, symbol:'A' },
  swamp:     { food:1, shields:0, trade:0, moveCost:2,  defBonus:0.50, passable:{land:true,  sea:false, air:true}, symbol:'s' },
  jungle:    { food:1, shields:0, trade:0, moveCost:2,  defBonus:0.50, passable:{land:true,  sea:false, air:true}, symbol:'j' },
};
