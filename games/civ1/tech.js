// Civ1 technology tree — the full set of 68 advances and their prerequisites,
// transcribed from the CivFanatics reference chart (civ1techchart.htm), which ports
// the 1991 game's own data. Each advance needs zero, one, or two other advances.
//
// What each advance *enables* (units, improvements, wonders, governments) is not
// stored here — the enabled thing carries its own `tech` field (see units.js,
// improvements.js, governments.js). This file is purely the prerequisite graph.

export const TECHS = {
  'alphabet':          { name: 'Alphabet',            prereqs: [] },
  'bronze-working':    { name: 'Bronze Working',      prereqs: [] },
  'ceremonial-burial': { name: 'Ceremonial Burial',   prereqs: [] },
  'horseback-riding':  { name: 'Horseback Riding',    prereqs: [] },
  'masonry':           { name: 'Masonry',             prereqs: [] },
  'pottery':           { name: 'Pottery',             prereqs: [] },
  'the-wheel':         { name: 'The Wheel',           prereqs: [] },

  'code-of-laws':      { name: 'Code of Laws',        prereqs: ['alphabet'] },
  'currency':          { name: 'Currency',            prereqs: ['bronze-working'] },
  'iron-working':      { name: 'Iron Working',        prereqs: ['bronze-working'] },
  'mapmaking':         { name: 'Map Making',          prereqs: ['alphabet'] },
  'mathematics':       { name: 'Mathematics',         prereqs: ['alphabet', 'masonry'] },
  'mysticism':         { name: 'Mysticism',           prereqs: ['ceremonial-burial'] },
  'writing':           { name: 'Writing',             prereqs: ['alphabet'] },

  'monarchy':          { name: 'Monarchy',            prereqs: ['ceremonial-burial', 'code-of-laws'] },
  'trade':             { name: 'Trade',               prereqs: ['currency', 'code-of-laws'] },
  'literacy':          { name: 'Literacy',            prereqs: ['writing', 'code-of-laws'] },
  'construction':      { name: 'Construction',        prereqs: ['masonry', 'currency'] },
  'astronomy':         { name: 'Astronomy',           prereqs: ['mysticism', 'mathematics'] },
  'bridge-building':   { name: 'Bridge Building',     prereqs: ['iron-working', 'alphabet'] },

  'the-republic':      { name: 'The Republic',        prereqs: ['code-of-laws', 'literacy'] },
  'feudalism':         { name: 'Feudalism',           prereqs: ['masonry', 'monarchy'] },
  'philosophy':        { name: 'Philosophy',          prereqs: ['mysticism', 'literacy'] },
  'chivalry':          { name: 'Chivalry',            prereqs: ['feudalism', 'horseback-riding'] },
  'university':        { name: 'University',          prereqs: ['mathematics', 'philosophy'] },
  'navigation':        { name: 'Navigation',          prereqs: ['mapmaking', 'astronomy'] },
  'medicine':          { name: 'Medicine',            prereqs: ['philosophy', 'trade'] },
  'engineering':       { name: 'Engineering',         prereqs: ['the-wheel', 'construction'] },
  'democracy':         { name: 'Democracy',           prereqs: ['philosophy', 'literacy'] },
  'religion':          { name: 'Religion',            prereqs: ['philosophy', 'writing'] },

  'banking':           { name: 'Banking',             prereqs: ['trade', 'the-republic'] },
  'physics':           { name: 'Physics',             prereqs: ['mathematics', 'navigation'] },
  'invention':         { name: 'Invention',           prereqs: ['engineering', 'literacy'] },
  'gunpowder':         { name: 'Gunpowder',           prereqs: ['invention', 'iron-working'] },
  'magnetism':         { name: 'Magnetism',           prereqs: ['navigation', 'physics'] },
  'theory-of-gravity': { name: 'Theory of Gravity',   prereqs: ['astronomy', 'university'] },
  'steam-engine':      { name: 'Steam Engine',        prereqs: ['physics', 'invention'] },
  'metallurgy':        { name: 'Metallurgy',          prereqs: ['gunpowder', 'university'] },
  'atomic-theory':     { name: 'Atomic Theory',       prereqs: ['theory-of-gravity', 'physics'] },
  'electricity':       { name: 'Electricity',         prereqs: ['magnetism', 'metallurgy'] },
  'chemistry':         { name: 'Chemistry',           prereqs: ['university', 'medicine'] },
  'railroad':          { name: 'Railroad',            prereqs: ['steam-engine', 'bridge-building'] },

  'explosives':        { name: 'Explosives',          prereqs: ['gunpowder', 'chemistry'] },
  'electronics':       { name: 'Electronics',         prereqs: ['electricity'] },
  'conscription':      { name: 'Conscription',        prereqs: ['the-republic', 'explosives'] },
  'industrialization': { name: 'Industrialization',   prereqs: ['railroad', 'banking'] },
  'the-corporation':   { name: 'The Corporation',     prereqs: ['banking', 'industrialization'] },
  'refining':          { name: 'Refining',            prereqs: ['chemistry', 'the-corporation'] },
  'steel':             { name: 'Steel',               prereqs: ['metallurgy', 'industrialization'] },
  'combustion':        { name: 'Combustion',          prereqs: ['refining', 'explosives'] },
  'communism':         { name: 'Communism',           prereqs: ['philosophy', 'industrialization'] },
  'computers':         { name: 'Computers',           prereqs: ['mathematics', 'electronics'] },

  'automobile':        { name: 'Automobile',          prereqs: ['combustion', 'steel'] },
  'flight':            { name: 'Flight',              prereqs: ['combustion', 'physics'] },
  'mass-production':   { name: 'Mass Production',      prereqs: ['automobile', 'the-corporation'] },
  'advanced-flight':   { name: 'Advanced Flight',     prereqs: ['flight', 'electricity'] },
  'rocketry':          { name: 'Rocketry',            prereqs: ['advanced-flight', 'electronics'] },
  'nuclear-fission':   { name: 'Nuclear Fission',     prereqs: ['mass-production', 'atomic-theory'] },
  'recycling':         { name: 'Recycling',           prereqs: ['mass-production', 'democracy'] },
  'labor-union':       { name: 'Labor Union',         prereqs: ['mass-production', 'communism'] },
  'genetic-engineering': { name: 'Genetic Engineering', prereqs: ['medicine', 'the-corporation'] },
  'space-flight':      { name: 'Space Flight',        prereqs: ['computers', 'rocketry'] },
  'nuclear-power':     { name: 'Nuclear Power',       prereqs: ['nuclear-fission', 'electronics'] },

  'plastics':          { name: 'Plastics',            prereqs: ['refining', 'space-flight'] },
  'robotics':          { name: 'Robotics',            prereqs: ['plastics', 'computers'] },
  'superconductor':    { name: 'Superconductor',      prereqs: ['plastics', 'mass-production'] },
  'fusion-power':      { name: 'Fusion Power',        prereqs: ['nuclear-power', 'superconductor'] },
  'future-tech':       { name: 'Future Tech',         prereqs: ['fusion-power'] },
};

export const ALL_TECH_IDS = Object.keys(TECHS);

// The advances that unlock nothing on their own in the 1991 game — they exist purely
// to connect other advances in the graph. Everything NOT in this set must enable at
// least one unit, improvement, wonder, government, spaceship part, or engine rule;
// tech.test.js asserts exactly that, so an advance can never quietly go dead again.
//
// Two of these are load-bearing in the original despite unlocking nothing buildable
// and so are absent from the list: Philosophy (the first civ to discover it gets a
// free advance, see economy.js) and Bridge Building (Settlers may road a river
// square, see Civ1Game.js). Fusion Power's original effect — removing the Nuclear
// Plant meltdown risk — has nothing to attach to here, since this engine models
// neither pollution nor meltdowns, so it stays a connector.
export const PURE_PREREQ = new Set([
  'alphabet', 'medicine', 'engineering', 'physics', 'atomic-theory',
  'electricity', 'chemistry', 'explosives', 'fusion-power',
]);

// A tech is researchable when every prerequisite is already known and it is not
// already known. `known` is a Set of tech ids.
export function isResearchable(id, known) {
  const t = TECHS[id];
  if (!t || known.has(id)) return false;
  return t.prereqs.every(p => known.has(p));
}

// Every tech the civ could pick to research next, given what it already knows.
// Future Tech stays researchable forever (it is repeatable in the original).
export function researchableTechs(known) {
  return ALL_TECH_IDS.filter(id => id === 'future-tech'
    ? known.has('fusion-power')
    : isResearchable(id, known));
}

// Bulbs (accumulated science) needed for the next advance. The original scales cost
// with how many advances the civ already has, so each is dearer than the last; this
// is a compact version of that curve, kept low enough that a game actually moves
// through the tree.
//
// `numKnown` counts repeats of Future Tech too (civ.futureTechs in economy.js). It has
// to: Future Tech is the one advance that never enters the `known` Set a second time,
// so counting the Set alone would leave a civ that has finished the tree buying an
// endless run of advances at one frozen price.
export function techCost(numKnown) {
  return 10 + numKnown * 8;
}
