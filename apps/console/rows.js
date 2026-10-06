// rows.js — the catalog's records as appfr rows, one list per entity.
//
// A row is `{ id, entityKey, entityLabel, fields }`; `fields` holds whatever the
// entity's columns and facets in schema.js read. `record` keeps the catalog
// record itself, which is what a detail panel opens.

import { asset } from './api.js'
import { SETTINGS, settingText } from './settings.js'

const players = (list) => list.map((p) => p.name).join(' v ') || 'no players'

const outcome = (result, list) => {
  if (!result) return null
  if (result.outcome === 'draw') return 'Draw'
  const winner = list.find((p) => p.id === result.winnerId)
  return `${winner?.name ?? result.winnerId} won`
}

/** @param values  the settings' current values (settings.js) */
export function buildRows(catalog, values) {
  const title = new Map(catalog.games.map((g) => [g.name, g.title]))
  const gameTitle = (game) => (Array.isArray(game) ? 'every game' : title.get(game) ?? game)
  // A game's picture is its preview asset; the art cell falls back to a letter
  // for a game that has none.
  const gameArt = (game) => ({ src: asset(`/images/${game}/preview_asset`), glyph: gameTitle(game)?.[0] ?? '?' })
  const live = new Map(catalog.sessions.map((s) => [s.id, s]))

  // A session or recording names its scenario by the scenario's own id; the
  // `scenario` field carries it as the scenario's row id, which is what a
  // narrowed query's term holds. A game carries every one of its own, so a game
  // stays the game of a scenario narrowed to (and drops out of the cards, as
  // the record the query names).
  const scenarioOf = (r) => (r.scenario ? `${r.game}/${r.scenario}` : undefined)
  const scenariosOf = new Map()
  for (const s of catalog.scenarios) scenariosOf.set(s.game, [...(scenariosOf.get(s.game) ?? []), s.id])
  const sessionsOf = new Map()
  for (const s of catalog.sessions) {
    const key = scenarioOf(s)
    if (key) sessionsOf.set(key, (sessionsOf.get(key) ?? 0) + 1)
  }

  // A game row's id IS its key: appfr narrows to a record by putting its id in
  // the scope term (`game:"chess"`), which every other row matches on `game`.
  // A scenario's is too (`scenario:"civ1/siege"`, matched on `scenario`), and
  // has a slash no game key has. Every other kind is prefixed, so ids stay
  // distinct across the whole corpus.
  const bare = new Set(['games', 'scenarios'])
  const row = (entityKey, entityLabel, record, fields) => ({
    id: bare.has(entityKey) ? record.id : `${entityKey}:${record.id}`,
    entityKey,
    entityLabel,
    record,
    fields: { game: record.game, gameTitle: gameTitle(record.game), ...fields },
  })

  return {
    games: catalog.games.map((g) => row('games', 'Game', g, {
      name: g.title,
      ref: g.name,
      art: gameArt(g.name),
      players: g.minPlayers === g.maxPlayers ? String(g.minPlayers) : `${g.minPlayers}–${g.maxPlayers}`,
      maxPlayers: g.maxPlayers,
      sessions: g.sessions,
      scenarios: g.scenarios,
      units: g.units,
      recordings: g.recordings,
      files: g.files,
      playing: g.sessions > 0,
      fog: g.fog,
      status: g.live ? 'loaded' : 'restart',
      scenario: scenariosOf.get(g.name) ?? [],
    })),

    sessions: catalog.sessions.map((s) => {
      const waiting = s.players.find((p) => p.id === s.pendingPlayer && p.agent === 'human')
      return row('sessions', 'Session', s, {
        name: `${gameTitle(s.game)}: ${players(s.players)}`,
        ref: s.id.slice(0, 8),
        art: gameArt(s.game),
        turn: s.turn ?? 0,
        humans: s.humans,
        updated: s.createdAt,
        status: s.status,
        waiting: !!waiting && s.status === 'active',
        fog: s.fog,
        outcome: outcome(s.result, s.players),
        scenario: scenarioOf(s),
      })
    }),

    recordings: catalog.recordings.map((r) => row('recordings', 'Recording', r, {
      name: `${gameTitle(r.game)}: ${players(r.players)}`,
      ref: r.file,
      art: gameArt(r.game),
      moves: r.moves,
      size: r.size,
      updated: r.createdAt,
      status: r.status,
      live: r.live && live.has(r.id),
      outcome: outcome(r.result, r.players),
      scenario: scenarioOf(r),
    })),

    // `order` is the catalog's: game by game, each game's scenarios as it lists them
    // (civ1's battles first, easiest to hardest). Padded, as it sorts as text.
    scenarios: catalog.scenarios.map((s, i) => row('scenarios', 'Scenario', s, {
      order: String(i).padStart(5, '0'),
      name: s.name,
      ref: s.description,
      art: gameArt(s.game),
      players: s.players,
      fog: s.fog,
      sessions: sessionsOf.get(s.id) ?? 0,
      scenario: s.id,
    })),

    units: catalog.units.map((u) => row('units', 'Unit', u, {
      name: u.label,
      ref: u.type,
      art: { src: asset(u.imagePath), glyph: u.glyph ?? u.label[0] },
      starting: u.starting,
      onBoard: u.starting > 0,
      sides: u.owners.join(', '),
    })),

    sides: catalog.sides.map((s) => row('sides', 'Side', s, {
      name: s.name,
      ref: s.side,
      art: gameArt(s.game),
      seat: s.seat,
    })),

    agents: catalog.agents.map((a) => row('agents', 'Agent', a, {
      name: a.name,
      // A game's own agent can share a builtin's name (chess's Obscuro), so it
      // says whose it is.
      ref: a.own ? `${a.game[0]} · ${a.agent}` : a.agent,
      kind: a.own ? 'game-specific' : 'built-in',
      gameCount: a.game.length,
      gameTitle: a.own ? gameTitle(a.game[0]) : 'every game',
      analysis: a.analyzable ? 'yes' : '',
      analyzable: a.analyzable,
    })),

    options: catalog.options.map((o) => row('options', 'Option', o, {
      name: o.name,
      ref: o.option,
      level: o.engine ? 'engine' : 'game',
      type: o.type,
      default: o.default == null ? '' : typeof o.default === 'object' ? JSON.stringify(o.default) : String(o.default),
    })),

    files: catalog.files.map((f) => row('files', 'File', f, {
      name: f.path,
      ref: gameTitle(f.game),
      ext: f.path.split('.').pop(),
      size: f.size,
      nonTest: !/\.test\.[cm]?js$/.test(f.path),
    })),

    // Not about any game: an empty `game` keeps them out of a narrowed query.
    settings: SETTINGS.map((def) => ({
      id: `settings:${def.key}`,
      entityKey: 'settings',
      entityLabel: 'Setting',
      record: def,
      fields: { game: [], gameTitle: '', name: def.label, ref: settingText(def, values[def.key]), description: def.description },
    })),
  }
}
