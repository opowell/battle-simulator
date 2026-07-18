// Civ1 unit definitions (faithful to 1991 original Civilization)
// All units have firepower:1 — Civ 1 had no firepower multiplier system
// HP: 10 standard, 20 for tougher Renaissance/Industrial units
// cost: production shields required
// tech: the advance that must be researched before a city may build this unit
//   (null = available from the start). Units the 1991 roster did not actually have
//   (e.g. archers, marines) are gated at the nearest plausible advance so the tech
//   progression stays sensible.

export const UNITS = {
  // ── Terrain Improvement ──────────────────────────────────────────────────
  settlers: { attack:0, defense:1, moves:1, hp:20, firepower:1, cost:40, domain:'land', tech:null, special:['found-city','build-road','irrigate','mine'] },

  // ── Diplomacy ────────────────────────────────────────────────────────────
  diplomat: { attack:0, defense:0, moves:2, hp:10, firepower:1, cost:30, domain:'land', tech:'writing', special:['diplomacy','bribe','sabotage'] },

  // ── Ancient Land ─────────────────────────────────────────────────────────
  militia:     { attack:1,  defense:1,  moves:1, hp:10, firepower:1, cost:10,  domain:'land', tech:null,               special:[] },
  phalanx:     { attack:1,  defense:2,  moves:1, hp:10, firepower:1, cost:20,  domain:'land', tech:'bronze-working',   special:[] },
  archers:     { attack:3,  defense:2,  moves:1, hp:10, firepower:1, cost:30,  domain:'land', tech:'iron-working',     special:[] },
  legion:      { attack:3,  defense:3,  moves:1, hp:10, firepower:1, cost:30,  domain:'land', tech:'iron-working',     special:[] },
  catapult:    { attack:6,  defense:1,  moves:1, hp:10, firepower:1, cost:60,  domain:'land', tech:'mathematics',      special:['bombard'] },

  // ── Ancient Mounted ──────────────────────────────────────────────────────
  cavalry:     { attack:2,  defense:1,  moves:2, hp:10, firepower:1, cost:20,  domain:'land', tech:'horseback-riding', special:['mounted'] },
  chariot:     { attack:4,  defense:1,  moves:2, hp:10, firepower:1, cost:40,  domain:'land', tech:'the-wheel',        special:['mounted'] },

  // ── Medieval Land ────────────────────────────────────────────────────────
  knights:     { attack:5,  defense:2,  moves:2, hp:10, firepower:1, cost:40,  domain:'land', tech:'chivalry',         special:['mounted'] },
  crusaders:   { attack:5,  defense:1,  moves:2, hp:10, firepower:1, cost:40,  domain:'land', tech:'feudalism',        special:['mounted'] },

  // ── Renaissance Land ─────────────────────────────────────────────────────
  musketeers:  { attack:2,  defense:3,  moves:1, hp:20, firepower:1, cost:30,  domain:'land', tech:'gunpowder',        special:[] },
  cannon:      { attack:8,  defense:5,  moves:1, hp:20, firepower:1, cost:40,  domain:'land', tech:'metallurgy',       special:['bombard'] },

  // ── Industrial Land ──────────────────────────────────────────────────────
  riflemen:    { attack:3,  defense:5,  moves:1, hp:20, firepower:1, cost:30,  domain:'land', tech:'conscription',     special:[] },
  'cav-modern':{ attack:8,  defense:3,  moves:2, hp:20, firepower:1, cost:60,  domain:'land', tech:'conscription',     special:['mounted'] },
  artillery:   { attack:12, defense:2,  moves:2, hp:20, firepower:1, cost:60,  domain:'land', tech:'robotics',         special:['bombard'] },

  // ── Modern Land ──────────────────────────────────────────────────────────
  infantry:    { attack:5,  defense:6,  moves:1, hp:20, firepower:1, cost:30,  domain:'land', tech:'conscription',     special:[] },
  armor:       { attack:10, defense:5,  moves:3, hp:30, firepower:1, cost:80,  domain:'land', tech:'automobile',       special:[] },
  'mech-inf':  { attack:6,  defense:6,  moves:3, hp:30, firepower:1, cost:50,  domain:'land', tech:'labor-union',      special:[] },
  paratroopers:{ attack:6,  defense:4,  moves:1, hp:20, firepower:1, cost:60,  domain:'land', tech:'the-corporation',  special:['paradrop'] },
  marines:     { attack:8,  defense:5,  moves:1, hp:20, firepower:1, cost:60,  domain:'land', tech:'combustion',       special:['amphibious'] },

  // ── Air ──────────────────────────────────────────────────────────────────
  fighter:     { attack:4,  defense:2,  moves:10, hp:20, firepower:1, cost:60,  domain:'air', tech:'flight',           special:['intercept'] },
  bomber:      { attack:12, defense:1,  moves:8,  hp:20, firepower:1, cost:120, domain:'air', tech:'advanced-flight',  special:['strategic-bomb'] },
  helicopter:  { attack:6,  defense:3,  moves:6,  hp:20, firepower:1, cost:60,  domain:'air', tech:'advanced-flight',  special:['hover'] },

  // ── Sea ──────────────────────────────────────────────────────────────────
  trireme:     { attack:1,  defense:1,  moves:3, hp:10, firepower:1, cost:40,  domain:'sea', tech:'mapmaking',         special:['coastal-only','transport-2'] },
  sail:        { attack:1,  defense:1,  moves:3, hp:10, firepower:1, cost:40,  domain:'sea', tech:'navigation',        special:['transport-3'] },
  frigate:     { attack:2,  defense:2,  moves:3, hp:10, firepower:1, cost:40,  domain:'sea', tech:'magnetism',         special:['bombard'] },
  ironclad:    { attack:4,  defense:4,  moves:4, hp:20, firepower:1, cost:60,  domain:'sea', tech:'steam-engine',      special:[] },
  destroyer:   { attack:4,  defense:4,  moves:6, hp:20, firepower:1, cost:60,  domain:'sea', tech:'electronics',       special:[] },
  submarine:   { attack:8,  defense:2,  moves:3, hp:20, firepower:1, cost:50,  domain:'sea', tech:'mass-production',   special:['stealth'] },
  transport:   { attack:0,  defense:3,  moves:4, hp:20, firepower:1, cost:50,  domain:'sea', tech:'industrialization', special:['transport-8'] },
  cruiser:     { attack:6,  defense:6,  moves:6, hp:20, firepower:1, cost:80,  domain:'sea', tech:'combustion',        special:['bombard'] },
  battleship:  { attack:18, defense:17, moves:4, hp:40, firepower:1, cost:160, domain:'sea', tech:'steel',             special:['bombard'] },
  carrier:     { attack:1,  defense:12, moves:5, hp:40, firepower:1, cost:160, domain:'sea', tech:'advanced-flight',   special:['carries-air-8'] },
};
