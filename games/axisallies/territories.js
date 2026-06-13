// --- Territory definitions ---
// isLand: true=land territory, false=sea zone
// factory: can produce units (land only)
// ipc: income per turn when controlled
export const TERRITORIES = {
  // Americas
  'western-usa':       { ipc: 10, isLand: true,  factory: true  },
  'eastern-usa':       { ipc: 12, isLand: true,  factory: true  },
  // Europe / Atlantic
  'uk':                { ipc:  8, isLand: true,  factory: true  },
  'france':            { ipc:  6, isLand: true,  factory: false },
  'germany':           { ipc: 10, isLand: true,  factory: true  },
  'scandinavia':       { ipc:  4, isLand: true,  factory: false },
  'eastern-europe':    { ipc:  3, isLand: true,  factory: false },
  'southern-europe':   { ipc:  4, isLand: true,  factory: true  },
  'north-africa':      { ipc:  2, isLand: true,  factory: false },
  // USSR
  'moscow':            { ipc:  6, isLand: true,  factory: true  },
  'karelia':           { ipc:  2, isLand: true,  factory: false },
  'ukraine':           { ipc:  2, isLand: true,  factory: false },
  'caucasus':          { ipc:  4, isLand: true,  factory: true  },
  // Asia / Pacific
  'india':             { ipc:  3, isLand: true,  factory: true  },
  'china':             { ipc:  3, isLand: true,  factory: false },
  'manchuria':         { ipc:  3, isLand: true,  factory: false },
  'japan':             { ipc:  8, isLand: true,  factory: true  },
  'philippines':       { ipc:  3, isLand: true,  factory: false },
  'dutch-east-indies': { ipc:  4, isLand: true,  factory: false },
  'australia':         { ipc:  2, isLand: true,  factory: false },
  // Sea zones
  'sz-north-sea':      { ipc:  0, isLand: false, factory: false },
  'sz-north-atlantic': { ipc:  0, isLand: false, factory: false },
  'sz-mediterranean':  { ipc:  0, isLand: false, factory: false },
  'sz-north-pacific':  { ipc:  0, isLand: false, factory: false },
  'sz-south-pacific':  { ipc:  0, isLand: false, factory: false },
  'sz-indian-ocean':   { ipc:  0, isLand: false, factory: false },
};

export const ADJACENCY = {
  // ── Land territories ──────────────────────────────────────────────────────
  'western-usa':       ['eastern-usa', 'sz-north-pacific'],
  'eastern-usa':       ['western-usa', 'sz-north-atlantic'],
  'uk':                ['sz-north-sea', 'sz-north-atlantic'],
  'france':            ['germany', 'southern-europe', 'sz-north-sea', 'sz-mediterranean'],
  'germany':           ['france', 'eastern-europe', 'scandinavia', 'southern-europe', 'sz-north-sea'],
  'scandinavia':       ['germany', 'karelia', 'sz-north-sea'],
  'eastern-europe':    ['germany', 'southern-europe', 'ukraine', 'karelia', 'moscow'],
  'southern-europe':   ['germany', 'eastern-europe', 'france', 'sz-mediterranean'],
  'north-africa':      ['sz-mediterranean', 'sz-north-atlantic', 'sz-indian-ocean'],
  'moscow':            ['karelia', 'eastern-europe', 'ukraine', 'caucasus'],
  'karelia':           ['scandinavia', 'eastern-europe', 'moscow', 'sz-north-sea'],
  'ukraine':           ['eastern-europe', 'moscow', 'caucasus'],
  'caucasus':          ['moscow', 'ukraine', 'sz-indian-ocean'],
  'india':             ['china', 'sz-indian-ocean'],
  'china':             ['manchuria', 'india', 'dutch-east-indies'],
  'manchuria':         ['china', 'japan', 'sz-north-pacific'],
  // Japan is island; connects to Manchuria via Korea Strait and two sea zones
  'japan':             ['manchuria', 'sz-north-pacific', 'sz-south-pacific'],
  'philippines':       ['dutch-east-indies', 'sz-south-pacific'],
  'dutch-east-indies': ['china', 'philippines', 'australia', 'sz-south-pacific', 'sz-indian-ocean'],
  'australia':         ['dutch-east-indies', 'sz-south-pacific', 'sz-indian-ocean'],
  // ── Sea zones ─────────────────────────────────────────────────────────────
  'sz-north-sea':      ['uk', 'germany', 'france', 'scandinavia', 'karelia', 'sz-north-atlantic', 'sz-mediterranean'],
  'sz-north-atlantic': ['uk', 'eastern-usa', 'north-africa', 'sz-north-sea'],
  'sz-mediterranean':  ['france', 'southern-europe', 'north-africa', 'sz-north-sea', 'sz-indian-ocean'],
  'sz-north-pacific':  ['western-usa', 'manchuria', 'japan', 'sz-south-pacific'],
  'sz-south-pacific':  ['japan', 'philippines', 'dutch-east-indies', 'australia', 'sz-north-pacific', 'sz-indian-ocean'],
  'sz-indian-ocean':   ['north-africa', 'caucasus', 'india', 'dutch-east-indies', 'australia', 'sz-mediterranean', 'sz-south-pacific'],
};

// Starting territory owners (representing ~1942 situation)
export const STARTING_OWNERS = {
  'western-usa':       'allies',
  'eastern-usa':       'allies',
  'uk':                'allies',
  'france':            'axis',
  'germany':           'axis',
  'scandinavia':       'axis',
  'eastern-europe':    'axis',
  'southern-europe':   'axis',
  'north-africa':      'allies',
  'moscow':            'allies',
  'karelia':           'allies',
  'ukraine':           'axis',
  'caucasus':          'allies',
  'india':             'allies',
  'china':             'axis',
  'manchuria':         'axis',
  'japan':             'axis',
  'philippines':       'axis',
  'dutch-east-indies': 'axis',
  'australia':         'allies',
};

// Starting unit setup  ({ ownerId, type, territory, count })
export const STARTING_UNITS = [
  // ── Allies land ──────────────────────────────────────────────────────────
  { ownerId: 'allies', type: 'infantry',  territory: 'eastern-usa',       count: 4 },
  { ownerId: 'allies', type: 'artillery', territory: 'eastern-usa',       count: 1 },
  { ownerId: 'allies', type: 'tank',      territory: 'eastern-usa',       count: 1 },
  { ownerId: 'allies', type: 'infantry',  territory: 'western-usa',       count: 2 },
  { ownerId: 'allies', type: 'infantry',  territory: 'uk',                count: 4 },
  { ownerId: 'allies', type: 'artillery', territory: 'uk',                count: 1 },
  { ownerId: 'allies', type: 'infantry',  territory: 'north-africa',      count: 3 },
  { ownerId: 'allies', type: 'tank',      territory: 'north-africa',      count: 1 },
  { ownerId: 'allies', type: 'infantry',  territory: 'moscow',            count: 8 },
  { ownerId: 'allies', type: 'artillery', territory: 'moscow',            count: 3 },
  { ownerId: 'allies', type: 'tank',      territory: 'moscow',            count: 3 },
  { ownerId: 'allies', type: 'infantry',  territory: 'karelia',           count: 4 },
  { ownerId: 'allies', type: 'artillery', territory: 'karelia',           count: 2 },
  { ownerId: 'allies', type: 'infantry',  territory: 'caucasus',          count: 3 },
  { ownerId: 'allies', type: 'infantry',  territory: 'india',             count: 3 },
  { ownerId: 'allies', type: 'artillery', territory: 'india',             count: 1 },
  { ownerId: 'allies', type: 'infantry',  territory: 'australia',         count: 2 },
  // ── Allies air ───────────────────────────────────────────────────────────
  { ownerId: 'allies', type: 'fighter',   territory: 'western-usa',       count: 1 },
  { ownerId: 'allies', type: 'fighter',   territory: 'uk',                count: 3 },
  { ownerId: 'allies', type: 'bomber',    territory: 'uk',                count: 2 },
  { ownerId: 'allies', type: 'fighter',   territory: 'moscow',            count: 2 },
  // ── Allies sea ───────────────────────────────────────────────────────────
  { ownerId: 'allies', type: 'battleship',territory: 'sz-north-atlantic', count: 1 },
  { ownerId: 'allies', type: 'destroyer', territory: 'sz-north-atlantic', count: 2 },
  { ownerId: 'allies', type: 'transport', territory: 'sz-north-atlantic', count: 2 },
  { ownerId: 'allies', type: 'destroyer', territory: 'sz-north-sea',      count: 1 },
  { ownerId: 'allies', type: 'transport', territory: 'sz-north-sea',      count: 1 },
  { ownerId: 'allies', type: 'battleship',territory: 'sz-north-pacific',  count: 1 },
  { ownerId: 'allies', type: 'destroyer', territory: 'sz-north-pacific',  count: 1 },
  { ownerId: 'allies', type: 'transport', territory: 'sz-south-pacific',  count: 1 },
  { ownerId: 'allies', type: 'destroyer', territory: 'sz-indian-ocean',   count: 1 },
  { ownerId: 'allies', type: 'transport', territory: 'sz-indian-ocean',   count: 1 },
  // ── Axis land ────────────────────────────────────────────────────────────
  { ownerId: 'axis', type: 'infantry',  territory: 'germany',             count: 4 },
  { ownerId: 'axis', type: 'artillery', territory: 'germany',             count: 1 },
  { ownerId: 'axis', type: 'tank',      territory: 'germany',             count: 1 },
  { ownerId: 'axis', type: 'infantry',  territory: 'france',              count: 3 },
  { ownerId: 'axis', type: 'artillery', territory: 'france',              count: 1 },
  { ownerId: 'axis', type: 'infantry',  territory: 'scandinavia',         count: 2 },
  { ownerId: 'axis', type: 'infantry',  territory: 'eastern-europe',      count: 3 },
  { ownerId: 'axis', type: 'tank',      territory: 'eastern-europe',      count: 1 },
  { ownerId: 'axis', type: 'infantry',  territory: 'southern-europe',     count: 2 },
  { ownerId: 'axis', type: 'infantry',  territory: 'ukraine',             count: 4 },
  { ownerId: 'axis', type: 'tank',      territory: 'ukraine',             count: 1 },
  { ownerId: 'axis', type: 'infantry',  territory: 'japan',               count: 4 },
  { ownerId: 'axis', type: 'artillery', territory: 'japan',               count: 1 },
  { ownerId: 'axis', type: 'tank',      territory: 'japan',               count: 1 },
  { ownerId: 'axis', type: 'infantry',  territory: 'manchuria',           count: 3 },
  { ownerId: 'axis', type: 'tank',      territory: 'manchuria',           count: 1 },
  { ownerId: 'axis', type: 'infantry',  territory: 'china',               count: 3 },
  { ownerId: 'axis', type: 'infantry',  territory: 'philippines',         count: 2 },
  { ownerId: 'axis', type: 'infantry',  territory: 'dutch-east-indies',   count: 2 },
  // ── Axis air ─────────────────────────────────────────────────────────────
  { ownerId: 'axis', type: 'fighter',   territory: 'germany',             count: 2 },
  { ownerId: 'axis', type: 'bomber',    territory: 'germany',             count: 1 },
  { ownerId: 'axis', type: 'fighter',   territory: 'japan',               count: 3 },
  { ownerId: 'axis', type: 'bomber',    territory: 'japan',               count: 1 },
  // ── Axis sea ─────────────────────────────────────────────────────────────
  { ownerId: 'axis', type: 'battleship',territory: 'sz-north-sea',        count: 1 },
  { ownerId: 'axis', type: 'carrier',   territory: 'sz-north-sea',        count: 1 },
  { ownerId: 'axis', type: 'destroyer', territory: 'sz-north-sea',        count: 2 },
  { ownerId: 'axis', type: 'submarine', territory: 'sz-north-sea',        count: 2 },
  { ownerId: 'axis', type: 'transport', territory: 'sz-north-sea',        count: 1 },
  { ownerId: 'axis', type: 'battleship',territory: 'sz-north-pacific',    count: 1 },
  { ownerId: 'axis', type: 'carrier',   territory: 'sz-north-pacific',    count: 2 },
  { ownerId: 'axis', type: 'destroyer', territory: 'sz-north-pacific',    count: 2 },
  { ownerId: 'axis', type: 'submarine', territory: 'sz-north-pacific',    count: 2 },
  { ownerId: 'axis', type: 'transport', territory: 'sz-north-pacific',    count: 3 },
  { ownerId: 'axis', type: 'destroyer', territory: 'sz-south-pacific',    count: 1 },
  { ownerId: 'axis', type: 'transport', territory: 'sz-south-pacific',    count: 1 },
];

// Capitals: capture the enemy capital to win
export const CAPITALS = {
  axis:   'germany',
  allies: 'moscow',
};
