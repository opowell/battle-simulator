const BASE = '/images/civ2';

function t(name) {
  return [
    `${BASE}/terrain/${name}`,
    `${BASE}/terrain/${name}_variant1`,
    `${BASE}/terrain/${name}_variant2`,
    `${BASE}/terrain/${name}_variant3`,
    `${BASE}/terrain/${name}_variant4`,
  ];
}

const ERA_THRESHOLDS = [
  [1,   'bronze_age'],
  [21,  'classical'],
  [41,  'medieval'],
  [61,  'renaissance'],
  [81,  'industrial'],
  [101, 'modern'],
  [121, 'futuristic'],
];

export function cityImg(turnNumber, size) {
  let era = 'bronze_age';
  for (const [turn, name] of ERA_THRESHOLDS) {
    if (turnNumber >= turn) era = name;
  }
  const tier = size >= 7 ? 'metropolis' : size >= 5 ? 'large_city' : size >= 3 ? 'city' : size >= 2 ? 'town' : 'village';
  return `${BASE}/cities/${era}_${tier}`;
}

export const assets = {
  terrain: {
    ocean:     { emoji: '🌊', color: '#0d3d5c', imgs: t('ocean') },
    arctic:    { emoji: '🧊', color: '#c0d4d8', imgs: t('arctic') },
    tundra:    { emoji: '❄️',  color: '#8898a0', imgs: t('tundra') },
    desert:    { emoji: '🏜️', color: '#c09428', imgs: t('desert') },
    plains:    { emoji: '🌾', color: '#a09050', imgs: t('prairie') },
    grassland: { emoji: '🌿', color: '#246818', imgs: t('grassland') },
    forest:    { emoji: '🌲', color: '#174c14', imgs: t('forest') },
    hills:     { emoji: '⛰️',  color: '#7a6030', imgs: t('hills') },
    mountains: { emoji: '🗻', color: '#504838', imgs: t('mountains') },
    swamp:     { emoji: '🌿', color: '#304828', imgs: t('swamp') },
    jungle:    { emoji: '🌴', color: '#0c3810', imgs: t('jungle') },
  },

  units: {
    // terrain improvement
    settlers:          { emoji: '🏗️', img: `${BASE}/units/settlers` },
    workers:           { emoji: '🔨' },
    engineers:         { emoji: '⚙️',  img: `${BASE}/units/engineers` },
    // diplomacy / espionage
    diplomat:          { emoji: '📜', img: `${BASE}/units/diplomat` },
    spy:               { emoji: '🕵️', img: `${BASE}/units/spy` },
    explorer:          { emoji: '🧭', img: `${BASE}/units/explorer` },
    // ancient land
    warriors:          { emoji: '⚔️',  img: `${BASE}/units/warriors` },
    phalanx:           { emoji: '🛡️', img: `${BASE}/units/phalanx` },
    archers:           { emoji: '🏹', img: `${BASE}/units/archers` },
    legion:            { emoji: '🗡️', img: `${BASE}/units/legion` },
    catapult:          { emoji: '💣', img: `${BASE}/units/catapult` },
    // ancient mounted
    horsemen:          { emoji: '🐴', img: `${BASE}/units/horsemen` },
    chariot:           { emoji: '🏇', img: `${BASE}/units/chariot` },
    // medieval
    pikemen:           { emoji: '🔱', img: `${BASE}/units/pikemen` },
    knights:           { emoji: '🗡️', img: `${BASE}/units/knights` },
    crusaders:         { emoji: '✝️',  img: `${BASE}/units/crusaders` },
    // renaissance
    musketeers:        { emoji: '🔫', img: `${BASE}/units/musketeers` },
    cannon:            { emoji: '💣', img: `${BASE}/units/cannon` },
    dragoons:          { emoji: '🐎', img: `${BASE}/units/dragoons` },
    // industrial
    riflemen:          { emoji: '🎯', img: `${BASE}/units/riflemen` },
    cavalry:           { emoji: '🐎', img: `${BASE}/units/cavalry` },
    artillery:         { emoji: '💥', img: `${BASE}/units/artillery` },
    // modern land
    infantry:          { emoji: '🪖', img: `${BASE}/units/infantry` },
    'mech-infantry':   { emoji: '🤖', img: `${BASE}/units/mech_infantry` },
    armor:             { emoji: '🛡️', img: `${BASE}/units/armor` },
    howitzer:          { emoji: '💥', img: `${BASE}/units/howitzer` },
    // special land
    partisans:         { emoji: '🌿', img: `${BASE}/units/partisans` },
    fanatics:          { emoji: '🔥', img: `${BASE}/units/fanatics` },
    marines:           { emoji: '⚓', img: `${BASE}/units/marines` },
    paratroopers:      { emoji: '🪂', img: `${BASE}/units/paratroopers` },
    'alpine-troops':   { emoji: '🏔️', img: `${BASE}/units/alpine_troops` },
    // air
    fighter:           { emoji: '✈️',  img: `${BASE}/units/fighter` },
    bomber:            { emoji: '💣', img: `${BASE}/units/bomber` },
    helicopter:        { emoji: '🚁', img: `${BASE}/units/helicopter` },
    'stealth-fighter': { emoji: '🛩️', img: `${BASE}/units/stealth_fighter` },
    'stealth-bomber':  { emoji: '🌑', img: `${BASE}/units/stealth_bomber` },
    awacs:             { emoji: '📡' },
    'cruise-missile':  { emoji: '🚀', img: `${BASE}/units/cruise_missile` },
    'nuclear-missile': { emoji: '☢️',  img: `${BASE}/units/nuclear_missile` },
    // sea
    trireme:           { emoji: '⛵', img: `${BASE}/units/trireme` },
    caravel:           { emoji: '⛵', img: `${BASE}/units/caravel` },
    galleon:           { emoji: '🚢', img: `${BASE}/units/galleon` },
    frigate:           { emoji: '⚓', img: `${BASE}/units/frigate` },
    ironclad:          { emoji: '🛡️', img: `${BASE}/units/ironclad` },
    destroyer:         { emoji: '🚢', img: `${BASE}/units/destroyer` },
    cruiser:           { emoji: '🚢', img: `${BASE}/units/cruiser` },
    battleship:        { emoji: '🛳️', img: `${BASE}/units/battleship` },
    carrier:           { emoji: '🛳️', img: `${BASE}/units/carrier` },
    submarine:         { emoji: '🤿', img: `${BASE}/units/submarine` },
    transport:         { emoji: '🚢', img: `${BASE}/units/transport` },
    'aegis-cruiser':   { emoji: '⚓', img: `${BASE}/units/aegis_cruiser` },
  },

  city: { emoji: '🏛️' },
};
