// SC2 terrain definitions
// moveCost: movement points to enter
// defBonus: multiplier added to base defense
// passable: which domains can enter
// buildable: can a building be placed here
// resource: 'minerals' | 'gas' | null

export const TERRAIN = {
  open:     { moveCost:1, defBonus:0.00, passable:{ground:true,  air:true}, buildable:true,  symbol:'.', resource:null },
  elevated: { moveCost:1, defBonus:0.25, passable:{ground:true,  air:true}, buildable:true,  symbol:"'", resource:null },
  ramp:     { moveCost:2, defBonus:0.00, passable:{ground:true,  air:true}, buildable:false, symbol:'/', resource:null },
  minerals: { moveCost:0, defBonus:0.00, passable:{ground:false, air:true}, buildable:false, symbol:'*', resource:'minerals' },
  vespene:  { moveCost:0, defBonus:0.00, passable:{ground:false, air:true}, buildable:true,  symbol:'%', resource:'gas' },
  obstacle: { moveCost:0, defBonus:0.00, passable:{ground:false, air:false},buildable:false, symbol:'#', resource:null },
};
