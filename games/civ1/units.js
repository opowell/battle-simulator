// Civ1 unit definitions (faithful to 1991 original Civilization)
// All units have firepower:1 — Civ 1 had no firepower multiplier system
// HP: 10 standard, 20 for tougher Renaissance/Industrial units
// cost: production shields required

export const UNITS = {
  // ── Terrain Improvement ──────────────────────────────────────────────────
  settlers: { attack:0, defense:1, moves:1, hp:20, firepower:1, cost:40, domain:'land', special:['found-city','build-road','irrigate','mine'] },

  // ── Diplomacy ────────────────────────────────────────────────────────────
  diplomat: { attack:0, defense:0, moves:2, hp:10, firepower:1, cost:30, domain:'land', special:['diplomacy','bribe','sabotage'] },

  // ── Ancient Land ─────────────────────────────────────────────────────────
  militia:     { attack:1,  defense:1,  moves:1, hp:10, firepower:1, cost:10,  domain:'land', special:[] },
  phalanx:     { attack:1,  defense:2,  moves:1, hp:10, firepower:1, cost:20,  domain:'land', special:[] },
  archers:     { attack:3,  defense:2,  moves:1, hp:10, firepower:1, cost:30,  domain:'land', special:[] },
  legion:      { attack:3,  defense:3,  moves:1, hp:10, firepower:1, cost:30,  domain:'land', special:[] },
  catapult:    { attack:6,  defense:1,  moves:1, hp:10, firepower:1, cost:60,  domain:'land', special:['bombard'] },

  // ── Ancient Mounted ──────────────────────────────────────────────────────
  cavalry:     { attack:2,  defense:1,  moves:2, hp:10, firepower:1, cost:20,  domain:'land', special:['mounted'] },
  chariot:     { attack:4,  defense:1,  moves:2, hp:10, firepower:1, cost:40,  domain:'land', special:['mounted'] },

  // ── Medieval Land ────────────────────────────────────────────────────────
  knights:     { attack:5,  defense:2,  moves:2, hp:10, firepower:1, cost:40,  domain:'land', special:['mounted'] },
  crusaders:   { attack:5,  defense:1,  moves:2, hp:10, firepower:1, cost:40,  domain:'land', special:['mounted'] },

  // ── Renaissance Land ─────────────────────────────────────────────────────
  musketeers:  { attack:2,  defense:3,  moves:1, hp:20, firepower:1, cost:30,  domain:'land', special:[] },
  cannon:      { attack:8,  defense:5,  moves:1, hp:20, firepower:1, cost:40,  domain:'land', special:['bombard'] },

  // ── Industrial Land ──────────────────────────────────────────────────────
  riflemen:    { attack:3,  defense:5,  moves:1, hp:20, firepower:1, cost:30,  domain:'land', special:[] },
  'cav-modern':{ attack:8,  defense:3,  moves:2, hp:20, firepower:1, cost:60,  domain:'land', special:['mounted'] },
  artillery:   { attack:12, defense:2,  moves:2, hp:20, firepower:1, cost:60,  domain:'land', special:['bombard'] },

  // ── Modern Land ──────────────────────────────────────────────────────────
  infantry:    { attack:5,  defense:6,  moves:1, hp:20, firepower:1, cost:30,  domain:'land', special:[] },
  armor:       { attack:10, defense:5,  moves:3, hp:30, firepower:1, cost:80,  domain:'land', special:[] },
  'mech-inf':  { attack:6,  defense:6,  moves:3, hp:30, firepower:1, cost:50,  domain:'land', special:[] },
  paratroopers:{ attack:6,  defense:4,  moves:1, hp:20, firepower:1, cost:60,  domain:'land', special:['paradrop'] },
  marines:     { attack:8,  defense:5,  moves:1, hp:20, firepower:1, cost:60,  domain:'land', special:['amphibious'] },

  // ── Air ──────────────────────────────────────────────────────────────────
  fighter:     { attack:4,  defense:2,  moves:10, hp:20, firepower:1, cost:60,  domain:'air', special:['intercept'] },
  bomber:      { attack:12, defense:1,  moves:8,  hp:20, firepower:1, cost:120, domain:'air', special:['strategic-bomb'] },
  helicopter:  { attack:6,  defense:3,  moves:6,  hp:20, firepower:1, cost:60,  domain:'air', special:['hover'] },

  // ── Sea ──────────────────────────────────────────────────────────────────
  trireme:     { attack:1,  defense:1,  moves:3, hp:10, firepower:1, cost:40,  domain:'sea', special:['coastal-only','transport-2'] },
  sail:        { attack:1,  defense:1,  moves:3, hp:10, firepower:1, cost:40,  domain:'sea', special:['transport-3'] },
  frigate:     { attack:2,  defense:2,  moves:3, hp:10, firepower:1, cost:40,  domain:'sea', special:['bombard'] },
  ironclad:    { attack:4,  defense:4,  moves:4, hp:20, firepower:1, cost:60,  domain:'sea', special:[] },
  destroyer:   { attack:4,  defense:4,  moves:6, hp:20, firepower:1, cost:60,  domain:'sea', special:[] },
  submarine:   { attack:8,  defense:2,  moves:3, hp:20, firepower:1, cost:50,  domain:'sea', special:['stealth'] },
  transport:   { attack:0,  defense:3,  moves:4, hp:20, firepower:1, cost:50,  domain:'sea', special:['transport-8'] },
  cruiser:     { attack:6,  defense:6,  moves:6, hp:20, firepower:1, cost:80,  domain:'sea', special:['bombard'] },
  battleship:  { attack:18, defense:17, moves:4, hp:40, firepower:1, cost:160, domain:'sea', special:['bombard'] },
  carrier:     { attack:1,  defense:12, moves:5, hp:40, firepower:1, cost:160, domain:'sea', special:['carries-air-8'] },
};
