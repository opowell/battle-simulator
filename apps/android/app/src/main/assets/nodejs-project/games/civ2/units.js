// Civ2 unit definitions
// attack, defense: base combat strength
// moves: movement points per turn
// hp: hit points (10 = standard, 20/30/40 = veteran/elite/etc. in original; here reflects unit size)
// firepower: damage per combat hit (1 standard, 2 advanced, 3 missiles)
// cost: production shields required
// domain: 'land' | 'sea' | 'air'
// special: array of ability tags

export const UNITS = {
  // ── Terrain Improvement ──────────────────────────────────────────────────
  settlers:        { attack:0,  defense:1,  moves:1, hp:20, firepower:1, cost:40,  domain:'land', special:['found-city','build-road','irrigate','mine','transform'] },
  workers:         { attack:0,  defense:1,  moves:1, hp:10, firepower:1, cost:30,  domain:'land', special:['build-road','irrigate','mine','transform'] },
  engineers:       { attack:0,  defense:2,  moves:2, hp:20, firepower:1, cost:50,  domain:'land', special:['build-road','irrigate','mine','transform','build-fortress','build-railroad','double-work'] },

  // ── Diplomacy / Espionage ────────────────────────────────────────────────
  diplomat:        { attack:0,  defense:0,  moves:2, hp:10, firepower:1, cost:30,  domain:'land', special:['diplomacy','bribe','sabotage'] },
  spy:             { attack:0,  defense:0,  moves:3, hp:10, firepower:1, cost:30,  domain:'land', special:['espionage','bribe','sabotage','steal-tech','incite-revolt'] },
  explorer:        { attack:0,  defense:1,  moves:1, hp:10, firepower:1, cost:30,  domain:'land', special:['explore'] },

  // ── Ancient Land ─────────────────────────────────────────────────────────
  warriors:        { attack:1,  defense:1,  moves:1, hp:10, firepower:1, cost:10,  domain:'land', special:[] },
  phalanx:         { attack:1,  defense:2,  moves:1, hp:10, firepower:1, cost:25,  domain:'land', special:[] },
  archers:         { attack:3,  defense:2,  moves:1, hp:10, firepower:1, cost:30,  domain:'land', special:[] },
  legion:          { attack:3,  defense:3,  moves:1, hp:10, firepower:1, cost:30,  domain:'land', special:[] },
  catapult:        { attack:6,  defense:4,  moves:1, hp:10, firepower:1, cost:60,  domain:'land', special:['bombard'] },

  // ── Ancient Mounted ──────────────────────────────────────────────────────
  horsemen:        { attack:2,  defense:1,  moves:2, hp:10, firepower:1, cost:20,  domain:'land', special:['mounted'] },
  chariot:         { attack:3,  defense:1,  moves:2, hp:10, firepower:1, cost:40,  domain:'land', special:['mounted'] },

  // ── Medieval Land ────────────────────────────────────────────────────────
  pikemen:         { attack:1,  defense:2,  moves:1, hp:10, firepower:1, cost:25,  domain:'land', special:['anti-mounted'] },
  knights:         { attack:5,  defense:2,  moves:2, hp:10, firepower:1, cost:40,  domain:'land', special:['mounted'] },
  crusaders:       { attack:5,  defense:1,  moves:2, hp:10, firepower:1, cost:40,  domain:'land', special:['mounted'] },

  // ── Renaissance Land ─────────────────────────────────────────────────────
  musketeers:      { attack:2,  defense:3,  moves:1, hp:20, firepower:1, cost:50,  domain:'land', special:[] },
  cannon:          { attack:7,  defense:2,  moves:1, hp:20, firepower:1, cost:40,  domain:'land', special:['bombard'] },
  dragoons:        { attack:5,  defense:2,  moves:2, hp:20, firepower:1, cost:50,  domain:'land', special:['mounted'] },

  // ── Industrial Land ──────────────────────────────────────────────────────
  riflemen:        { attack:3,  defense:5,  moves:1, hp:20, firepower:1, cost:60,  domain:'land', special:[] },
  cavalry:         { attack:8,  defense:3,  moves:3, hp:20, firepower:1, cost:60,  domain:'land', special:['mounted'] },
  artillery:       { attack:12, defense:2,  moves:2, hp:20, firepower:1, cost:60,  domain:'land', special:['bombard'] },

  // ── Modern Land ──────────────────────────────────────────────────────────
  infantry:        { attack:5,  defense:5,  moves:1, hp:20, firepower:1, cost:50,  domain:'land', special:[] },
  'mech-infantry': { attack:6,  defense:6,  moves:3, hp:30, firepower:1, cost:50,  domain:'land', special:[] },
  armor:           { attack:10, defense:5,  moves:3, hp:30, firepower:1, cost:80,  domain:'land', special:['blitz'] },
  howitzer:        { attack:12, defense:2,  moves:2, hp:30, firepower:1, cost:70,  domain:'land', special:['bombard','ignore-walls'] },

  // ── Special Land ─────────────────────────────────────────────────────────
  partisans:       { attack:4,  defense:4,  moves:1, hp:20, firepower:1, cost:50,  domain:'land', special:['guerrilla'] },
  fanatics:        { attack:5,  defense:5,  moves:1, hp:20, firepower:1, cost:20,  domain:'land', special:['fundamentalism-only'] },
  marines:         { attack:8,  defense:5,  moves:1, hp:30, firepower:1, cost:50,  domain:'land', special:['amphibious'] },
  paratroopers:    { attack:6,  defense:4,  moves:1, hp:30, firepower:1, cost:60,  domain:'land', special:['paradrop'] },
  'alpine-troops': { attack:6,  defense:6,  moves:1, hp:30, firepower:1, cost:60,  domain:'land', special:['mountain-bonus'] },

  // ── Air ──────────────────────────────────────────────────────────────────
  fighter:         { attack:4,  defense:2,  moves:10, hp:20, firepower:2, cost:60,  domain:'air', special:['intercept','escort'] },
  bomber:          { attack:12, defense:1,  moves:8,  hp:20, firepower:2, cost:120, domain:'air', special:['strategic-bomb'] },
  helicopter:      { attack:6,  defense:3,  moves:6,  hp:20, firepower:2, cost:60,  domain:'air', special:['hover'] },
  'stealth-fighter':  { attack:8,  defense:4,  moves:14, hp:20, firepower:2, cost:80,  domain:'air', special:['stealth','intercept','escort'] },
  'stealth-bomber':   { attack:14, defense:3,  moves:12, hp:20, firepower:2, cost:160, domain:'air', special:['stealth','strategic-bomb'] },
  awacs:           { attack:0,  defense:1,  moves:11, hp:20, firepower:1, cost:80,  domain:'air', special:['radar'] },
  'cruise-missile':   { attack:18, defense:0,  moves:12, hp:10, firepower:3, cost:60,  domain:'air', special:['one-use','missile'] },
  'nuclear-missile':  { attack:99, defense:0,  moves:16, hp:10, firepower:1, cost:160, domain:'air', special:['one-use','nuclear','missile'] },

  // ── Sea ──────────────────────────────────────────────────────────────────
  trireme:         { attack:1,  defense:1,  moves:3, hp:10, firepower:1, cost:40,  domain:'sea', special:['coastal-only','transport-1'] },
  caravel:         { attack:2,  defense:1,  moves:3, hp:10, firepower:1, cost:40,  domain:'sea', special:['transport-3'] },
  galleon:         { attack:0,  defense:2,  moves:4, hp:20, firepower:1, cost:40,  domain:'sea', special:['transport-4'] },
  frigate:         { attack:4,  defense:2,  moves:3, hp:20, firepower:1, cost:50,  domain:'sea', special:['bombard'] },
  ironclad:        { attack:4,  defense:4,  moves:4, hp:20, firepower:1, cost:60,  domain:'sea', special:[] },
  destroyer:       { attack:4,  defense:4,  moves:6, hp:30, firepower:1, cost:60,  domain:'sea', special:['submarine-attack'] },
  cruiser:         { attack:6,  defense:6,  moves:6, hp:30, firepower:2, cost:80,  domain:'sea', special:['bombard'] },
  battleship:      { attack:12, defense:12, moves:4, hp:40, firepower:2, cost:160, domain:'sea', special:['bombard'] },
  carrier:         { attack:1,  defense:12, moves:5, hp:40, firepower:2, cost:160, domain:'sea', special:['carries-air-8'] },
  submarine:       { attack:8,  defense:2,  moves:3, hp:20, firepower:2, cost:50,  domain:'sea', special:['stealth','anti-ship'] },
  transport:       { attack:0,  defense:3,  moves:4, hp:20, firepower:1, cost:50,  domain:'sea', special:['transport-8'] },
  'aegis-cruiser': { attack:8,  defense:8,  moves:6, hp:30, firepower:2, cost:100, domain:'sea', special:['bombard','anti-air','anti-missile'] },
};
