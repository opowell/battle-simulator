// Civ1 city improvements and Wonders of the World.
//
// Costs/upkeep/prerequisites are the 1991 game's values (cross-checked against the
// CivFanatics and civ.games references). Each entry carries plain effect fields that
// the city economy (city.js) reads directly rather than a scripting layer:
//
//   sciBonus / taxBonus / shieldBonus  — +fraction to that city output, summed
//   content                            — unhappy citizens turned content
//   contentDoubledBy                   — tech id that doubles `content` (Oracle also does)
//   defenseBonus                       — added to terrain defence multiplier vs land
//   granary                            — keep half the food box on growth
//   aqueduct                           — city may grow past size 8
//   corruptionReduce                   — fraction of corruption removed
//   capital                            — the palace (zero corruption here)
//   requires                           — id of an improvement that must exist first
//
// Wonders are one-per-world buildings with civ-wide or one-shot effects; their
// `effect` string is read by city.js / Civ1Game.js where it changes the rules.

export const IMPROVEMENTS = {
  palace:          { name: 'Palace',            cost: 100, maint: 0, tech: 'masonry',          capital: true, corruptionReduce: 1 },
  barracks:        { name: 'Barracks',          cost: 40,  maint: 1, tech: null,               veteran: true },
  granary:         { name: 'Granary',           cost: 60,  maint: 1, tech: 'pottery',          granary: true },
  temple:          { name: 'Temple',            cost: 40,  maint: 1, tech: 'ceremonial-burial', content: 1, contentDoubledBy: 'mysticism' },
  marketplace:     { name: 'Marketplace',       cost: 80,  maint: 1, tech: 'currency',         taxBonus: 0.5 },
  library:         { name: 'Library',           cost: 80,  maint: 1, tech: 'writing',          sciBonus: 0.5 },
  courthouse:      { name: 'Courthouse',        cost: 80,  maint: 1, tech: 'code-of-laws',     corruptionReduce: 0.5, content: 1 },
  'city-walls':    { name: 'City Walls',        cost: 120, maint: 0, tech: 'masonry',          defenseBonus: 2 },
  aqueduct:        { name: 'Aqueduct',          cost: 120, maint: 2, tech: 'construction',     aqueduct: true },
  colosseum:       { name: 'Colosseum',         cost: 100, maint: 4, tech: 'construction',     content: 3 },
  cathedral:       { name: 'Cathedral',         cost: 160, maint: 3, tech: 'religion',         content: 3 },
  bank:            { name: 'Bank',              cost: 120, maint: 3, tech: 'banking',          taxBonus: 0.5, requires: 'marketplace' },
  university:      { name: 'University',        cost: 160, maint: 3, tech: 'university',       sciBonus: 0.5, requires: 'library' },
  factory:         { name: 'Factory',           cost: 200, maint: 4, tech: 'industrialization', shieldBonus: 0.5 },
  'power-plant':   { name: 'Power Plant',       cost: 160, maint: 4, tech: 'refining',         shieldBonus: 0.5, requires: 'factory', pollution: true },
  'hydro-plant':   { name: 'Hydro Plant',       cost: 240, maint: 4, tech: 'electronics',      shieldBonus: 0.5, requires: 'factory' },
  'nuclear-plant': { name: 'Nuclear Plant',     cost: 160, maint: 2, tech: 'nuclear-power',    shieldBonus: 0.5, requires: 'factory' },
  'mfg-plant':     { name: 'Mfg. Plant',        cost: 320, maint: 6, tech: 'robotics',         shieldBonus: 0.5, requires: 'factory' },
  'mass-transit':  { name: 'Mass Transit',      cost: 160, maint: 4, tech: 'mass-production',  reducesPollution: true },
  'recycling-center': { name: 'Recycling Center', cost: 200, maint: 2, tech: 'recycling',      reducesPollution: true },
  'sdi-defense':   { name: 'SDI Defense',       cost: 200, maint: 4, tech: 'superconductor',   sdi: true },
};

export const WONDERS = {
  pyramids:        { name: 'Pyramids',                  cost: 200, tech: 'masonry',            effect: 'negate-despotism-penalty' },
  'hanging-gardens': { name: 'Hanging Gardens',         cost: 200, tech: 'pottery',            effect: 'content-all', content: 1 },
  colossus:        { name: 'Colossus',                  cost: 200, tech: 'bronze-working',     effect: 'trade-bonus-city' },
  lighthouse:      { name: 'Lighthouse',                cost: 200, tech: 'mapmaking',          effect: 'naval-veteran' },
  'great-library': { name: 'Great Library',             cost: 300, tech: 'literacy',           effect: 'free-known-techs' },
  oracle:          { name: 'Oracle',                    cost: 300, tech: 'mysticism',          effect: 'double-temples' },
  'great-wall':    { name: 'Great Wall',                cost: 300, tech: 'masonry',            effect: 'walls-all' },
  'marco-polo':    { name: "Marco Polo's Embassy",      cost: 200, tech: 'trade',              effect: 'embassy-all' },
  michelangelo:    { name: "Michelangelo's Chapel",     cost: 300, tech: 'religion',           effect: 'cathedral-all', content: 3 },
  copernicus:      { name: "Copernicus' Observatory",   cost: 300, tech: 'astronomy',          effect: 'science-city', sciBonus: 0.5 },
  magellan:        { name: "Magellan's Expedition",     cost: 400, tech: 'navigation',         effect: 'naval-move' },
  leonardo:        { name: "Leonardo's Workshop",       cost: 400, tech: 'invention',          effect: 'auto-upgrade' },
  'js-bach':       { name: "J.S. Bach's Cathedral",     cost: 400, tech: 'religion',           effect: 'content-all', content: 2 },
  newton:          { name: "Isaac Newton's College",    cost: 400, tech: 'theory-of-gravity',  effect: 'science-city', sciBonus: 1 },
  darwin:          { name: "Darwin's Voyage",           cost: 400, tech: 'railroad',           effect: 'free-techs-2' },
  'womens-suffrage': { name: "Women's Suffrage",        cost: 600, tech: 'industrialization',  effect: 'police-all' },
  'hoover-dam':    { name: 'Hoover Dam',                cost: 600, tech: 'electronics',        effect: 'power-all', shieldBonus: 0.5 },
  manhattan:       { name: 'Manhattan Project',         cost: 600, tech: 'nuclear-fission',    effect: 'enable-nukes' },
  'united-nations': { name: 'United Nations',           cost: 600, tech: 'communism',          effect: 'content-all', content: 1 },
  seti:            { name: 'SETI Program',              cost: 600, tech: 'computers',          effect: 'science-all', sciBonus: 0.5 },
  apollo:          { name: 'Apollo Program',            cost: 600, tech: 'space-flight',       effect: 'reveal-map' },
  'cure-for-cancer': { name: 'Cure for Cancer',         cost: 600, tech: 'genetic-engineering', effect: 'happy-all', happy: 1 },
};

// Spaceship parts. Unlike buildings these are not one-per-city — each completed part
// adds to the owner's spaceship (economy.js tracks the running count in civ.spaceship).
// Buildable only once the Apollo Program exists in the world and the part's advance is
// known; `cap` limits how many of each a complete ship needs.
export const SPACESHIP = {
  'ss-structural': { name: 'Space Structural', cost: 80,  tech: 'space-flight',   part: 'structural', cap: 8 },
  'ss-component':  { name: 'Space Component',  cost: 160, tech: 'superconductor', part: 'component',  cap: 6 },
  'ss-module':     { name: 'Space Module',     cost: 320, tech: 'robotics',       part: 'module',     cap: 4 },
};

// Minimum parts a spaceship needs before it can be launched.
export const SPACESHIP_MIN = { structural: 4, component: 3, module: 2 };

// Combined lookup: given any buildable id return its definition and whether it is a
// wonder. Units and spaceship parts are not here — the caller checks those separately.
export function improvementDef(id) {
  if (IMPROVEMENTS[id]) return { def: IMPROVEMENTS[id], wonder: false };
  if (WONDERS[id]) return { def: WONDERS[id], wonder: true };
  return null;
}

// Whether a specific wonder has been built anywhere in the world (wonders are unique,
// but some — Manhattan Project, Apollo Program — unlock things for every civ).
export function wonderBuiltInWorld(cities, wonderId) {
  for (const c of cities ?? []) if ((c.buildings ?? []).includes(wonderId)) return true;
  return false;
}

export const ALL_IMPROVEMENT_IDS = Object.keys(IMPROVEMENTS);
export const ALL_WONDER_IDS = Object.keys(WONDERS);

// True when `owner` has a wonder with the given effect. `wondersByEffect` is built
// once per turn from all cities' `buildings` (see city.js gatherWonders).
export function ownerHasEffect(wonderSet, effect) {
  for (const id of wonderSet) if (WONDERS[id]?.effect === effect) return true;
  return false;
}

// The set of wonder effects an owner currently has, read straight from their cities'
// buildings. A light helper for callers (combat, movement, fog) that only need the
// effects and not the full economy context.
export function wonderEffectsFor(cities, ownerId) {
  const s = new Set();
  for (const c of cities ?? []) {
    if (c.ownerId !== ownerId) continue;
    for (const b of c.buildings ?? []) { const e = WONDERS[b]?.effect; if (e) s.add(e); }
  }
  return s;
}
