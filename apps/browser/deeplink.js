// deeplink.js — a link that STARTS a session rather than opening one:
//
//   #/new/<game>[/<scenario>][?seats=…&<option>=…&maxTurns=…]
//
// Left at that, it is the session the scenario's one-click Play would start (its
// seats and options as the setup page opens with them). The query changes what
// it names, and only that:
//
//   seats=human,obscuro     one agent per seat, in seat order; as many seats as
//                           are named. `cpu` is the game's default AI; an entry
//                           `agent:Name` names the seat too (a comma or colon in
//                           a name escaped, as %2C and %3A).
//   <option id>=<value>     any of the game's gameOptions: a boolean takes
//                           true/false/on/off/1/0, a range a number, an integer
//                           digits (or nothing, for unset), a select one of its
//                           values. An ai-difficulty option
//                           takes a power level under its own id, or a per-move
//                           time in ms under its timeKey (aiTimeMs).
//   fog=on                  short for the game's fogOfWar option.
//   maxTurns=N              a turn limit (none unless the scenario has one);
//                           maxTurns=off for none where the scenario has one.
//
// Anything else is refused by name, so a typo in a link is an error rather than a
// session quietly started without it. App.vue reads the link (openFromHash); the
// setup page's Copy link writes one (newSessionLink).

import { defaultSeats, formRequest, sessionRequest } from './sessions.js'

/**
 * The link's parts, or null for a hash that is not one: { game, scenario, query,
 * seats }. `seats` is the seat list as [agent, name] pairs, split before it is
 * unescaped, so a name may hold the separators.
 */
export function parseNewSessionLink(hash) {
  const [, path, search = ''] = hash.match(/^#\/new\/([^?]+)(?:\?(.*))?$/) ?? []
  if (!path) return null
  const [game, scenario = ''] = path.split('/').map(decodeURIComponent)
  if (!game) return null
  const [, rawSeats] = search.match(/(?:^|&)seats=([^&]*)/) ?? []
  const unescape = (part) => decodeURIComponent(part.replace(/\+/g, ' '))
  const seats = rawSeats == null ? null
    : rawSeats.split(',').map((entry) => entry.split(':').map(unescape)).map(([agent, ...name]) => [agent.trim(), name.join(':')])
  return { game, scenario, query: new URLSearchParams(search), seats }
}

const TRUE = new Set(['true', 'on', '1', 'yes'])
const FALSE = new Set(['false', 'off', '0', 'no'])

function optionValue(opt, raw) {
  if (opt.type === 'boolean') {
    const v = raw.toLowerCase()
    if (TRUE.has(v)) return true
    if (FALSE.has(v)) return false
    throw new Error(`${opt.id} is on or off, not "${raw}"`)
  }
  if (opt.type === 'integer') {
    // As the setup form sends it: the digits typed, '' for none.
    if (!/^\d*$/.test(raw)) throw new Error(`${opt.id} is a whole number, not "${raw}"`)
    return raw
  }
  if (opt.type === 'range' || opt.type === 'ai-difficulty') {
    const n = Number(raw)
    if (raw === '' || !Number.isFinite(n)) throw new Error(`${opt.id} is a number, not "${raw}"`)
    if (opt.type === 'range' && (n < (opt.min ?? 0) || n > (opt.max ?? 100))) {
      throw new Error(`${opt.id} runs from ${opt.min ?? 0} to ${opt.max ?? 100}, not ${n}`)
    }
    return n
  }
  if (opt.type === 'select') {
    // A select's values may be numbers; the link's are always text.
    const hit = (opt.options ?? []).find((o) => String(o.value) === raw)
    if (!hit) throw new Error(`${opt.id} is one of ${(opt.options ?? []).map((o) => o.value).join(', ')}, not "${raw}"`)
    return hit.value
  }
  return raw
}

function seatsOf(game, scenario, pairs) {
  const defaults = defaultSeats(game, scenario)
  if (pairs == null) return defaults
  const agents = new Set(['human', ...(game.agents ?? []).map((a) => a.id)])
  const seats = pairs.map(([agent, name], i) => {
    const id = agent === 'cpu' ? window.gameDefaults.defaultCpuAgent(game) : agent
    if (!agents.has(id)) throw new Error(`${game.name} has no agent "${agent}" (it has ${[...agents].join(', ')})`)
    // The setup page's names ("You", "CPU 1") go with its agents; a seat given
    // another falls back to the game's own name for it.
    const kept = defaults[i]?.agent === id ? defaults[i].name : ''
    return { name: name || kept, agent: id }
  })
  if (!seats.length) throw new Error('seats names no seat')
  return seats
}

/**
 * The POST /sessions body a link asks for.
 * @param game  the GET /games entry the link names
 * @param link  parseNewSessionLink()
 */
export function newSessionRequest(game, { scenario, query, seats }) {
  if (scenario && !game.scenarios?.some((s) => s.id === scenario)) {
    throw new Error(`${game.name} has no scenario "${scenario}"`)
  }
  const body = sessionRequest(game, scenario, seatsOf(game, scenario, seats))
  const options = new Map((game.gameOptions ?? []).map((o) => [o.id, o]))
  const timeKeys = new Map((game.gameOptions ?? []).filter((o) => o.type === 'ai-difficulty').map((o) => [o.timeKey ?? 'aiTimeMs', o]))
  for (const [key, raw] of query) {
    if (key === 'seats') continue
    if (key === 'maxTurns') {
      if (FALSE.has(raw.toLowerCase())) { delete body.config.maxTurns; continue }
      const n = Number(raw)
      if (!Number.isInteger(n) || n < 1) throw new Error(`maxTurns is a whole number of turns, not "${raw}"`)
      body.config.maxTurns = n
      continue
    }
    const id = key === 'fog' && options.has('fogOfWar') ? 'fogOfWar' : key
    const opt = options.get(id)
    const timed = timeKeys.get(key)
    if (timed) {
      // A time limit, which is the other of the difficulty's two modes.
      body.config[key] = optionValue(timed, raw)
      body.config[timed.id] = null
      body.config[`${timed.id}Mode`] = 'time'
    } else if (opt) {
      body.config[id] = optionValue(opt, raw)
      if (opt.type === 'ai-difficulty') {
        body.config[opt.timeKey ?? 'aiTimeMs'] = null
        body.config[`${id}Mode`] = 'power'
      }
    } else {
      const known = ['seats', 'maxTurns', ...options.keys(), ...timeKeys.keys()]
      throw new Error(`${game.name} has no setting "${key}" (it has ${known.join(', ')})`)
    }
  }
  // formRequest's own copy of the fog switch, which the server reads.
  if ('fogOfWar' in body.config) body.config.fog = body.config.fogOfWar
  return body
}

// A query value as typed: escaped, but for the separators a seat list reads by.
const enc = (v) => encodeURIComponent(v).replace(/%2C/g, ',').replace(/%3A/g, ':')
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

function optionParam(opt, value, config) {
  if (opt.type === 'ai-difficulty') {
    const timeKey = opt.timeKey ?? 'aiTimeMs'
    return config[`${opt.id}Mode`] === 'time' ? [timeKey, config[timeKey]] : [opt.id, value]
  }
  return [opt.id, opt.type === 'boolean' ? (value ? 'on' : 'off') : value ?? '']
}

/**
 * The link for a filled-in setup form: only what differs from the bare link for
 * its scenario, so an untouched form is `#/new/<game>/<scenario>`.
 * @param form  as for formRequest
 * @returns {{ hash: string, omitted: string[] }}  `omitted`: the settings of the
 *   form the link cannot carry (edited starting units), which a session started
 *   from it will have at their defaults instead
 */
export function newSessionLink(game, form) {
  const scenario = form.scenario || ''
  const want = formRequest(game, form)
  delete want.config.startingUnits
  const base = newSessionRequest(game, { scenario, query: new URLSearchParams() })
  const params = []

  const defaults = defaultSeats(game, scenario)
  const seatsDiffer = want.players.length !== base.players.length
    || want.players.some((p, i) => p.agent !== base.players[i].agent || p.name !== base.players[i].name)
  if (seatsDiffer) {
    // A seat's name goes in only where the link would not arrive at it by itself.
    const seats = want.players.map((p, i) => {
      const kept = defaults[i]?.agent === p.agent ? defaults[i].name : ''
      const implied = kept || game.defaultPlayers?.[i]?.name || `Player ${i + 1}`
      return p.name === implied ? p.agent : `${p.agent}:${encodeURIComponent(p.name)}`
    })
    params.push(['seats', seats.join(','), 'escaped'])
  }
  for (const opt of game.gameOptions ?? []) {
    const timeKey = opt.timeKey ?? 'aiTimeMs'
    const differs = opt.type === 'ai-difficulty'
      ? ![opt.id, timeKey, `${opt.id}Mode`].every((k) => same(want.config[k], base.config[k]))
      : !same(want.config[opt.id], base.config[opt.id])
    if (differs) params.push(optionParam(opt, want.config[opt.id], want.config))
  }
  if (!same(want.config.maxTurns, base.config.maxTurns)) params.push(['maxTurns', want.config.maxTurns ?? 'off'])

  const path = [game.name, scenario].filter(Boolean).map(encodeURIComponent).join('/')
  const query = params.map(([k, v, escaped]) => `${enc(k)}=${escaped ? v : enc(String(v))}`).join('&')
  const hash = `#/new/${path}${query ? `?${query}` : ''}`

  // Read back, the link is the form — except for what it has no way to say.
  const got = newSessionRequest(game, parseNewSessionLink(hash))
  const keys = new Set([...Object.keys(want.config), ...Object.keys(got.config), 'startingUnits'])
  const omitted = [...keys].filter((k) => (k === 'startingUnits' ? form.gameOpts?.startingUnits : !same(want.config[k], got.config[k])))
  if (!same(want.players, got.players)) omitted.push('players')
  return { hash, omitted }
}
