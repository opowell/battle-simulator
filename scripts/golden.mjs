// Writes every game's golden replays: games/<game>/golden.json.
//
//   node scripts/golden.mjs [game ...] [--check]
//
// A game gets one case per way it can be set up from the setup form: its default
// settings, each of its scenarios, every space × time × turns combination it
// offers (a `space` or `time` option), and fog the other way from its default
// when it has a fog switch. Each case is run twice before it is written, so a run
// that isn't reproducible is caught here rather than as a flaky test.
//
// The cases are built the way the Browser's setup form builds a session
// (apps/browser/play/gameDefaults.js: initGameOpts + scenarioOverrides), so a
// golden case is a session somebody could actually start.
//
// --check compares against the committed files instead of writing them (which is
// what each game's golden.test.js does, case by case, in a process of its own).
//
// See src/engine/golden.js for what a run is and what gets hashed.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runGolden } from '../src/engine/golden.js'
import { GAMES } from '../games/registry.js'
import { RogueGame } from '../games/rogue/index.js'
import { SimCityGame } from '../games/simcity/index.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const gamesDir = path.join(projectRoot, 'games')

// Not in the server's registry, but still games to carry over (see the plan's
// open decisions), seated as their own tests seat them.
const UNREGISTERED = {
  rogue:   { game: RogueGame,   defaultPlayers: [{ id: 'p1', name: 'Rogue' }] },
  simcity: { game: SimCityGame, defaultPlayers: [{ id: 'mayor', name: 'Mayor' }] },
}

// Engine steps per case. A step is one ply in sequential play, one we-go round,
// or one continuous-time window, so a game whose plies are cheap runs longer.
// Enough to get past the opening into fighting, but short enough that the whole
// suite stays a test and not a bench.
const STEPS = 200
const STEPS_BY_GAME = { combatmission: 8, cs: 10, sc1: 40 }

const SEED = 1

// Written beside a game's golden.json the first time, so its goldens are tested.
const TEST_FILE = `// This game's golden replays (golden.json, written by scripts/golden.mjs).
import { goldenTests } from '#core/engine/goldenTest.js';

goldenTests(import.meta.url);
`

/** Option defaults as the setup form starts them (gameDefaults.initGameOpts). */
function formDefaults(game) {
  const opts = {}
  for (const opt of game.gameOptions ?? []) {
    if (opt.type === 'ai-difficulty') {
      opts[opt.id] = opt.default ?? 25
      opts[opt.timeKey ?? 'aiTimeMs'] = null
      opts[opt.id + 'Mode'] = 'power'
    } else {
      const v = opt.default ?? (opt.type === 'boolean' ? false : opt.type === 'range' ? (opt.min ?? 0) : opt.type === 'integer' ? '' : opt.options?.[0]?.value ?? '')
      opts[opt.id] = v
    }
  }
  return { ...opts, ...(game.uiDefaults?.config ?? {}) }
}

/** Seats for `count` slots, as the server deals them (gameDefaults.seatIds). */
function seats(entry, count) {
  const defs = entry.defaultPlayers ?? []
  return Array.from({ length: count }, (_, i) => ({ id: defs[i]?.id ?? 'p' + (i + 1), name: defs[i]?.name ?? 'Player ' + (i + 1) }))
}

function casesFor(name, entry) {
  const { game } = entry
  const base = formDefaults(game)
  const defaultCount = game.uiDefaults?.players?.length ?? entry.defaultPlayers.length
  const cases = [{ id: 'default', players: seats(entry, defaultCount), config: base }]

  for (const sc of game.scenarios ?? []) {
    const { players = null, maxTurns, fog, fogOfWar, ...rest } = sc.config ?? {}
    const f = fog ?? fogOfWar
    cases.push({
      id: 'scenario:' + sc.id,
      players: seats(entry, players?.length ?? defaultCount),
      config: { ...base, ...rest, ...(f != null ? { fogOfWar: f } : {}), ...(maxTurns != null ? { maxTurns } : {}) },
    })
  }

  // Every space × time × turns quadrant the game offers.
  const values = (id) => game.gameOptions?.find(o => o.id === id && o.type === 'select')?.options?.map(o => o.value)
  const spaces = values('space'), times = values('time')
  if (spaces || times) {
    for (const space of spaces ?? [undefined]) for (const time of times ?? [undefined]) for (const sim of [false, true]) {
      const tag = [space, time, sim ? 'simultaneous' : 'sequential'].filter(Boolean).join('-')
      cases.push({
        id: 'mode:' + tag,
        players: seats(entry, defaultCount),
        config: { ...base, ...(space ? { space } : {}), ...(time ? { time } : {}), simultaneousTurns: sim },
      })
    }
  }

  const fogOpt = game.gameOptions?.find(o => o.id === 'fogOfWar')
  if (fogOpt) {
    const on = !(base.fogOfWar ?? game.defaultConfig?.fogOfWar ?? false)
    cases.push({ id: on ? 'fog-on' : 'fog-off', players: seats(entry, defaultCount), config: { ...base, fogOfWar: on } })
  }
  return cases
}

/** The file in games/<name>/ that exports `game`, and the name it's exported under. */
async function moduleOf(name, game) {
  const dir = path.join(gamesDir, name)
  const files = ['index.js', ...fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'index.js' && !f.endsWith('.test.js'))]
  for (const file of files) {
    if (!fs.existsSync(path.join(dir, file))) continue
    const mod = await import(pathToFileURL(path.join(dir, file)).href)
    const exp = Object.keys(mod).find(k => mod[k] === game)
    if (exp) return { module: './' + file, export: exp }
  }
  throw new Error(`${name}: no module in games/${name}/ exports its game definition`)
}

const args = process.argv.slice(2)
const check = args.includes('--check')
const all = { ...GAMES, ...UNREGISTERED }
const names = args.filter(a => !a.startsWith('--'))
for (const n of names) if (!all[n]) { console.error(`Unknown game: ${n}`); process.exit(2) }

let failed = 0
for (const name of names.length ? names : Object.keys(all)) {
  const entry = all[name]
  const file = path.join(gamesDir, name, 'golden.json')
  const steps = STEPS_BY_GAME[name] ?? STEPS
  const committed = check ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
  const out = { game: name, ...(await moduleOf(name, entry.game)), cases: [] }
  for (const c of casesFor(name, entry)) {
    const spec = { players: c.players, config: c.config, seed: SEED, steps }
    const t0 = performance.now()
    const run = await runGolden(entry.game, spec)
    const ms = Math.round(performance.now() - t0)
    const again = await runGolden(entry.game, spec)
    const tag = `${name} ${c.id}`.padEnd(40)
    if (JSON.stringify(run) !== JSON.stringify(again)) {
      console.log(`${tag} NOT REPRODUCIBLE`, JSON.stringify(run.hashes), JSON.stringify(again.hashes))
      failed++
      continue
    }
    if (check) {
      const want = committed.cases.find(x => x.id === c.id)
      const ok = want && JSON.stringify(want.hashes) === JSON.stringify(run.hashes)
      if (!ok) failed++
      console.log(`${tag} ${ok ? 'ok' : 'MISMATCH'} ${ms}ms`)
    } else {
      console.log(`${tag} ${ms}ms  ${run.ran} steps, ${run.plies} plies, turn ${run.turn}${run.result ? ', ' + (run.result.reason ?? run.result.outcome) : ''}${run.error ? ', ERROR ' + run.error : ''}`)
    }
    out.cases.push({ id: c.id, ...spec, ...run })
  }
  if (!check) {
    fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n')
    const testFile = path.join(gamesDir, name, 'golden.test.js')
    if (!fs.existsSync(testFile)) fs.writeFileSync(testFile, TEST_FILE)
  }
}
if (failed) { console.error(`${failed} case(s) failed`); process.exit(1) }
