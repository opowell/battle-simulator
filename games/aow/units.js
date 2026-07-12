// The four soldier types of The Ancient Art of War. Squads are built out of any
// combination of these (up to 14 men — see squad.js). Combat is a rock-paper-scissors
// of counts: whichever men-type you field decides who you beat.
//
//   KNIGHT    — heavy, armoured, slow. Crushes barbarians. Weak to arrows.
//   BARBARIAN — no armour, fast and agile. Overruns archers. Weak to knights.
//   ARCHER    — deadly at range, helpless up close. Kills knights. Weak to barbarians.
//   SPY       — non-combatant scout. Doubles a squad's sighting range; fastest afoot.
//
// The counter each type beats forms the cycle knight → barbarian → archer → knight.
// `power` is a soldier's base contribution to a squad's strength; `speed` is how fast a
// man of this type marches (a squad marches at the pace of its slowest man — the original's
// rule that one knight slows the whole column).
export const UNITS = {
  knight: {
    power: 4, speed: 2.4, beats: 'barbarian', combatant: true, symbol: 'K',
    name: 'Knight', description: 'Armoured and strong. Beats barbarians; falls to archers.',
  },
  barbarian: {
    power: 3, speed: 4.2, beats: 'archer', combatant: true, symbol: 'B',
    name: 'Barbarian', description: 'Swift and fierce. Beats archers; falls to knights.',
  },
  archer: {
    power: 3, speed: 3.4, beats: 'knight', combatant: true, symbol: 'A',
    name: 'Archer', description: 'Deadly at range, defends forts. Beats knights; falls to barbarians.',
  },
  spy: {
    power: 0, speed: 5.0, beats: null, combatant: false, symbol: 'S',
    name: 'Spy', description: 'Sees twice as far; never fights.',
  },
};

export const UNIT_KEYS = Object.keys(UNITS);
export const COMBAT_TYPES = ['knight', 'barbarian', 'archer'];
