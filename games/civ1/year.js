// Civ1's calendar: which year a turn happens in.
//
// The original's clock is not linear — it accelerates as the game goes on, so that
// 4000 BC to 1 AD takes 200 turns at twenty years each while the twentieth century
// takes fifty turns at two. Anything linear reads wrong immediately: musketeers in
// 3000 BC, or the space race arriving in the year 12000.
//
// The schedule below is CivOne's Common.TurnToYear (github.com/SWY1985/CivOne, CC0),
// which is the faithful reconstruction of the 1991 original's table:
//
//   turns   0-199  : 20 years/turn, 4000 BC → 20 BC
//   turn      200  : 1 AD           (the table has no year zero, hence the special case)
//   turns 201-249  : 20 years/turn, 20 AD → 980 AD
//   turns 250-299  : 10 years/turn, 1000 → 1490
//   turns 300-349  : 5  years/turn, 1500 → 1745
//   turns 350-399  : 2  years/turn, 1750 → 1848
//   turns 400+     : 1  year /turn, 1850 onward
//
// CivOne counts turns from zero; this engine's state.turnNumber counts from one, so
// turn 1 is 4000 BC.

export function turnYear(turnNumber) {
  const t = Math.max(0, (turnNumber ?? 1) - 1);
  if (t < 200) return -(200 - t) * 20;
  if (t === 200) return 1;
  if (t < 250) return (t - 200) * 20;
  if (t < 300) return (t - 250) * 10 + 1000;
  if (t < 350) return (t - 300) * 5 + 1500;
  if (t < 400) return (t - 350) * 2 + 1750;
  return (t - 400) + 1850;
}

// "4000 BC" / "1492 AD" — the string the header shows. AD is kept explicit rather
// than dropped after 1000: the label sits next to a turn counter, and a bare "1492"
// next to "Turn 299" reads as a second number rather than a date.
export function yearLabel(turnNumber) {
  const y = turnYear(turnNumber);
  return y < 0 ? `${-y} BC` : `${y} AD`;
}
