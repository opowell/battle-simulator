// schema.js — the console's appfr DomainSchema: one entity per kind of object.
//
// Every entity's rows carry a `game` field (the game's key; a list for agents and
// engine options, which several games offer), and `games` declares it as its
// scope. So pressing a game narrows the whole corpus to that game, and its
// numbers (Sessions 3, Units 6, …) drill into exactly those rows. Scenarios do
// the same on `scenario`, and units on `unit` (rows.js says which rows carry
// one); every other kind of row opens instead.
//
// Sorting: each entity lists its own sorts, the first being its default, and
// every sort reads in the order its name says when ascending (the console's
// default direction) — names A→Z, numbers low→high, and `age` youngest first.

import { SETTINGS } from './settings.js'

const chips = (key, label, options, extra = {}) => ({ kind: 'chips', key, label, options, ...extra })
const toggle = (key, label, text) => ({ kind: 'toggle', key, label, text })
const range = (key, label, min, max) => ({ kind: 'range', key, label, min, max })

const ordinal = { key: 'ordinal', kind: 'ordinal', label: '#', width: '48px' }
const identity = (label, extra = {}) => ({ key: 'name', role: 'identity', label, sort: 'name', activate: true, ...extra })
const reference = (label, extra = {}) => ({ key: 'ref', role: 'reference', label, truncate: true, ...extra })
const gameColumn = { key: 'gameTitle', label: 'Game', width: '130px', sort: 'game', hideBelow: 620 }
const metric = (key, label, extra = {}) => ({ key, role: 'metric', kind: 'number', label, sort: key, width: '84px', align: 'right', format: String, ...extra })
const state = { key: 'status', role: 'state', kind: 'status', label: 'State', width: '112px' }
const started = { key: 'updated', role: 'updated', kind: 'date', label: 'Started', sort: 'age', width: '96px', hideBelow: 760 }

const kb = (value) => (value == null ? '' : `${Math.max(1, Math.round(Number(value) / 1024))} KB`)
const count = (n) => n.toLocaleString('en')
const distinct = (values) => [...new Set(values.filter((v) => v != null && v !== ''))].sort()

/**
 * @param {object} catalog  GET /catalog
 * @param {object} parts    host components the columns render: { Art }
 */
export function buildSchema(catalog, { Art }) {
  // The `image` role is what puts the picture on a record's card; in the table
  // the cell is still Art, which falls back to a letter where there is none.
  const art = { key: 'art', role: 'image', kind: 'component', component: Art, width: '44px', value: (row) => row.fields.art?.src ?? '' }
  const gameNames = catalog.games.map((g) => g.name)
  const byGame = chips('game', 'Game', gameNames)

  const entities = [
    {
      key: 'games',
      label: 'Games',
      count: count(catalog.games.length),
      scope: 'game',
      create: 'New game…',
      // A game's card is its picture and its name; the key, the counts and the
      // state are the table's.
      card: 'picture',
      columns: [
        ordinal,
        art,
        identity('Game', { scope: true }),
        reference('Key', { mono: true, width: '120px' }),
        { key: 'players', label: 'Players', width: '80px', hideBelow: 760 },
        metric('sessions', 'Sessions', { drill: 'sessions' }),
        metric('scenarios', 'Scenarios', { drill: 'scenarios' }),
        metric('units', 'Units', { drill: 'units', hideBelow: 620 }),
        metric('recordings', 'Recordings', { drill: 'recordings', width: '96px', hideBelow: 900 }),
        metric('files', 'Files', { drill: 'files', hideBelow: 1100 }),
        state,
      ],
      sorts: [
        { key: 'name', label: 'name' },
        { key: 'sessions', label: 'sessions' },
        { key: 'scenarios', label: 'scenarios' },
        { key: 'units', label: 'units' },
        { key: 'recordings', label: 'recordings' },
      ],
      facets: [
        toggle('playing', 'Being played', 'Only games with a live session'),
        toggle('fog', 'Fog of war', 'Only games with fog of war'),
        range('maxPlayers', 'Most players', 2, Math.max(2, ...catalog.games.map((g) => g.maxPlayers ?? 2))),
      ],
    },
    {
      key: 'sessions',
      label: 'Sessions',
      count: count(catalog.sessions.length),
      create: 'New session…',
      columns: [
        ordinal,
        art,
        identity('Session'),
        reference('Id', { mono: true, width: '96px' }),
        gameColumn,
        metric('turn', 'Turn'),
        metric('humans', 'Humans', { hideBelow: 900 }),
        started,
        state,
      ],
      sorts: [
        { key: 'age', label: 'age' },
        { key: 'name', label: 'name' },
        { key: 'game', label: 'game' },
        { key: 'turn', label: 'turn' },
      ],
      facets: [
        chips('status', 'State', ['active', 'done', 'error', 'closed']),
        byGame,
        toggle('waiting', 'Your move', 'Only sessions waiting on a human'),
        toggle('fog', 'Fog of war', 'Only fog-of-war sessions'),
      ],
    },
    {
      key: 'recordings',
      label: 'Recordings',
      count: count(catalog.recordings.length),
      columns: [
        ordinal,
        art,
        identity('Recording'),
        reference('File', { mono: true, hideBelow: 900 }),
        gameColumn,
        metric('moves', 'Moves'),
        metric('size', 'Size', { format: kb, hideBelow: 760 }),
        started,
        state,
      ],
      sorts: [
        { key: 'age', label: 'age' },
        { key: 'name', label: 'name' },
        { key: 'game', label: 'game' },
        { key: 'moves', label: 'moves' },
        { key: 'size', label: 'size' },
      ],
      facets: [
        chips('status', 'State', ['done', 'interrupted', 'active', 'error', 'closed']),
        byGame,
        toggle('live', 'Live', 'Only recordings of sessions still running'),
      ],
    },
    {
      key: 'scenarios',
      label: 'Scenarios',
      count: count(catalog.scenarios.length),
      // Pressing a scenario narrows to it, as pressing a game does: its sessions
      // and recordings, under a card of its own (ScenarioSummaryCards).
      scope: 'scenario',
      // The ordinal column carries the `order` sort (it still shows the row number):
      // the order the games list their own scenarios in, a campaign's in sequence.
      columns: [
        { ...ordinal, sort: 'order', field: 'order' },
        art,
        identity('Scenario', { scope: true }),
        reference('Description'),
        gameColumn,
        metric('players', 'Players'),
        metric('sessions', 'Sessions', { drill: 'sessions', hideBelow: 760 }),
      ],
      sorts: [{ key: 'order', label: 'order' }, { key: 'game', label: 'game' }, { key: 'name', label: 'name' }, { key: 'players', label: 'players' }, { key: 'sessions', label: 'sessions' }],
      facets: [byGame, toggle('fog', 'Fog of war', 'Only fog-of-war scenarios')],
    },
    {
      key: 'units',
      label: 'Units',
      count: count(catalog.units.length),
      // A unit's card is its picture and its name, like a game's; the type,
      // the game and the starting count are the table's.
      card: 'picture',
      // Pressing a unit narrows to it: its game and the sides that start with
      // it, under a card of its own (UnitSummaryCards).
      scope: 'unit',
      columns: [
        ordinal,
        art,
        identity('Unit', { scope: true }),
        reference('Type', { mono: true, width: '140px' }),
        gameColumn,
        metric('starting', 'At start'),
        { key: 'sides', label: 'Sides', hideBelow: 760 },
      ],
      sorts: [{ key: 'game', label: 'game' }, { key: 'name', label: 'name' }, { key: 'starting', label: 'at start' }],
      facets: [byGame, toggle('onBoard', 'At start', 'Only units a side starts with')],
    },
    {
      key: 'sides',
      label: 'Sides',
      count: count(catalog.sides.length),
      columns: [ordinal, art, identity('Side'), reference('Id', { mono: true }), gameColumn, metric('seat', 'Seat')],
      sorts: [{ key: 'game', label: 'game' }, { key: 'name', label: 'name' }],
      facets: [byGame],
    },
    {
      key: 'agents',
      label: 'Agents',
      count: count(catalog.agents.length),
      columns: [
        ordinal,
        identity('Agent'),
        reference('Id', { mono: true, width: '140px' }),
        { key: 'kind', label: 'Kind', width: '120px' },
        metric('gameCount', 'Games'),
        { key: 'analysis', label: 'Analysis', width: '90px', hideBelow: 620 },
      ],
      sorts: [{ key: 'name', label: 'name' }, { key: 'gameCount', label: 'games' }],
      facets: [
        chips('kind', 'Kind', ['built-in', 'game-specific']),
        chips('game', 'Game', gameNames, { multiple: true }),
        toggle('analyzable', 'Analysis', 'Only agents that can analyse a position'),
      ],
    },
    {
      key: 'options',
      label: 'Options',
      count: count(catalog.options.length),
      columns: [
        ordinal,
        identity('Option'),
        reference('Id', { mono: true, width: '150px' }),
        gameColumn,
        { key: 'type', label: 'Type', width: '96px', hideBelow: 760 },
        { key: 'default', label: 'Default', mono: true, width: '120px', hideBelow: 900 },
      ],
      sorts: [{ key: 'game', label: 'game' }, { key: 'name', label: 'name' }],
      facets: [
        chips('level', 'Level', ['game', 'engine']),
        chips('type', 'Type', distinct(catalog.options.map((o) => o.type))),
        chips('game', 'Game', gameNames, { multiple: true }),
      ],
    },
    {
      key: 'files',
      label: 'Files',
      count: count(catalog.files.length),
      columns: [
        ordinal,
        identity('File', { mono: true }),
        reference('Game'),
        { key: 'ext', label: 'Type', width: '72px', hideBelow: 620 },
        metric('size', 'Size', { format: kb }),
      ],
      sorts: [{ key: 'game', label: 'game' }, { key: 'name', label: 'path' }, { key: 'size', label: 'size' }],
      facets: [
        byGame,
        chips('ext', 'Type', distinct(catalog.files.map((f) => f.path.split('.').pop()))),
        toggle('nonTest', 'Tests', 'Hide test files'),
      ],
    },
    {
      // The console's own preferences (settings.js), kept in this browser.
      key: 'settings',
      label: 'Settings',
      count: count(SETTINGS.length),
      columns: [
        ordinal,
        identity('Setting'),
        reference('Value', { width: '90px' }),
        { key: 'description', label: 'What it does', hideBelow: 760 },
      ],
      sorts: [{ key: 'name', label: 'name' }],
      facets: [],
    },
  ]

  for (const entity of entities) {
    entity.tabs = ['Information']
    entity.samples = []
  }

  return {
    key: 'battle-simulator',
    label: 'Battle Simulator',
    kicker: 'Games, sessions and everything they define',
    placeholder: 'game:chess fog:true   ·   status:active   ·   starting>4',
    // The mixed result set: what every kind of record has in common.
    columns: [
      ordinal,
      art,
      { key: 'entityLabel', label: 'Kind', width: '110px', when: 'everything' },
      identity('Name', { scope: true }),
      reference('Detail', { hideBelow: 760 }),
      gameColumn,
      { ...started, label: 'Date' },
      state,
    ],
    entities,
  }
}
