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
//                           `agent:Name` names the seat too.
//   <option id>=<value>     any of the game's gameOptions: a boolean takes
//                           true/false/on/off/1/0, a range or an integer a number,
//                           a select one of its values. An ai-difficulty option
//                           takes a power level under its own id, or a per-move
//                           time in ms under its timeKey (aiTimeMs).
//   fog=on                  short for the game's fogOfWar option.
//   maxTurns=N              a turn limit (none unless the scenario has one).
//
// Anything else is refused by name, so a typo in a link is an error rather than a
// session quietly started without it. App.vue reads the link (openFromHash).

import { defaultSeats, sessionRequest } from './sessions.js'

/** The link's parts, or null for a hash that is not one: { game, scenario, query }. */
export function parseNewSessionLink(hash) {
  const [, path, search = ''] = hash.match(/^#\/new\/([^?]+)(?:\?(.*))?$/) ?? []
  if (!path) return null
  const [game, scenario = ''] = path.split('/').map(decodeURIComponent)
  if (!game) return null
  return { game, scenario, query: new URLSearchParams(search) }
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
  if (opt.type === 'range' || opt.type === 'integer' || opt.type === 'ai-difficulty') {
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

function seatsOf(game, scenario, raw) {
  const defaults = defaultSeats(game, scenario)
  if (raw == null) return defaults
  const agents = new Set(['human', ...(game.agents ?? []).map((a) => a.id)])
  const seats = raw.split(',').map((entry, i) => {
    const [agent, ...name] = entry.trim().split(':')
    const id = agent === 'cpu' ? window.gameDefaults.defaultCpuAgent(game) : agent
    if (!agents.has(id)) throw new Error(`${game.name} has no agent "${agent}" (it has ${[...agents].join(', ')})`)
    // The setup page's names ("You", "CPU 1") go with its agents; a seat given
    // another falls back to the game's own name for it.
    const kept = defaults[i]?.agent === id ? defaults[i].name : ''
    return { name: name.join(':') || kept, agent: id }
  })
  if (!seats.length) throw new Error('seats names no seat')
  return seats
}

/**
 * The POST /sessions body a link asks for.
 * @param game  the GET /games entry the link names
 * @param link  parseNewSessionLink()
 */
export function newSessionRequest(game, { scenario, query }) {
  if (scenario && !game.scenarios?.some((s) => s.id === scenario)) {
    throw new Error(`${game.name} has no scenario "${scenario}"`)
  }
  const body = sessionRequest(game, scenario, seatsOf(game, scenario, query.get('seats')))
  const options = new Map((game.gameOptions ?? []).map((o) => [o.id, o]))
  const timeKeys = new Map((game.gameOptions ?? []).filter((o) => o.type === 'ai-difficulty').map((o) => [o.timeKey ?? 'aiTimeMs', o]))
  for (const [key, raw] of query) {
    if (key === 'seats') continue
    if (key === 'maxTurns') {
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
