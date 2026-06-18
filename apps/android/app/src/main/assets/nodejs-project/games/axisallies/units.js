// Classic A&A unit stats (attack/defense values on d6: hit if roll <= value)
export const UNITS = {
  // Land
  infantry:   { cost:  3, attack: 1, defense: 2, moves: 1, domain: 'land', hp: 1, capacity: 0 },
  artillery:  { cost:  4, attack: 2, defense: 2, moves: 1, domain: 'land', hp: 1, capacity: 0 },
  tank:       { cost:  5, attack: 3, defense: 3, moves: 2, domain: 'land', hp: 1, capacity: 0 },
  // Air
  fighter:    { cost: 10, attack: 3, defense: 4, moves: 4, domain: 'air',  hp: 1, capacity: 0 },
  bomber:     { cost: 12, attack: 4, defense: 1, moves: 6, domain: 'air',  hp: 1, capacity: 0 },
  // Sea
  battleship: { cost: 20, attack: 4, defense: 4, moves: 2, domain: 'sea',  hp: 2, capacity: 0 },
  carrier:    { cost: 14, attack: 1, defense: 2, moves: 2, domain: 'sea',  hp: 2, capacity: 2 }, // holds 2 fighters
  destroyer:  { cost:  8, attack: 2, defense: 2, moves: 2, domain: 'sea',  hp: 1, capacity: 0 },
  submarine:  { cost:  6, attack: 2, defense: 1, moves: 2, domain: 'sea',  hp: 1, capacity: 0 },
  transport:  { cost:  7, attack: 0, defense: 1, moves: 2, domain: 'sea',  hp: 1, capacity: 2 }, // holds 2 land units
};
