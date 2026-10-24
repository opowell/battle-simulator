import { test } from 'node:test'
import assert from 'node:assert/strict'
// The seating rules are classic browser scripts that hang off window.
globalThis.window = globalThis
await import('./play/teamPalette.js')
await import('./play/gameDefaults.js')
const { newSessionLink, newSessionRequest, parseNewSessionLink } = await import('./deeplink.js')

const game = {
  name: 'chess',
  defaultPlayers: [{ id: 'white', name: 'White' }, { id: 'black', name: 'Black' }],
  agents: [{ id: 'obscuro' }, { id: 'random' }],
  gameOptions: [
    { id: 'fogOfWar', type: 'boolean', default: false },
    { id: 'width', type: 'range', min: 4, max: 12, default: 8 },
    { id: 'variant', type: 'select', options: [{ value: 'classic' }, { value: 3 }] },
    { id: 'difficulty', type: 'ai-difficulty', default: 25 },
    { id: 'delay', type: 'integer' },
  ],
  scenarios: [{ id: 'endgame', config: { maxTurns: 40, fogOfWar: true } }],
}
const request = (hash) => newSessionRequest(game, parseNewSessionLink(hash))

test('only a #/new/ link is one', () => {
  assert.equal(parseNewSessionLink('#/session/abc'), null)
  assert.equal(parseNewSessionLink('#/new/'), null)
  assert.deepEqual({ ...parseNewSessionLink('#/new/chess/endgame?seats=human,random:Bo%2C+b'), query: undefined },
    { game: 'chess', scenario: 'endgame', query: undefined, seats: [['human', ''], ['random', 'Bo, b']] })
})

test('a bare link is the one-click start: default seats and options', () => {
  const body = request('#/new/chess')
  assert.equal(body.game, 'chess')
  assert.deepEqual(body.players.map((p) => p.id), ['white', 'black'])
  assert.equal(body.config.fogOfWar, false)
  assert.equal(body.config.width, 8)
  assert.equal(body.config.difficultyMode, 'power')
})

test('a scenario brings its own settings', () => {
  const body = request('#/new/chess/endgame')
  assert.equal(body.config.scenario, 'endgame')
  assert.equal(body.config.maxTurns, 40)
  assert.equal(body.config.fog, true)
})

test('seats name the agents, cpu the default AI, and a seat its name', () => {
  const body = request('#/new/chess?seats=human:Ann,cpu,random')
  assert.deepEqual(body.players.map(({ id, name, agent }) => [id, name, agent]),
    [['white', 'Ann', 'human'], ['black', 'CPU 1', 'obscuro'], ['p3', 'Player 3', 'random']])
  // "You" is the human seat's name; a seat handed to an AI takes the game's own.
  assert.deepEqual(request('#/new/chess?seats=cpu,human').players.map((p) => p.name), ['White', 'Black'])
})

test('options are read by their type', () => {
  const body = request('#/new/chess?fog=on&width=10&variant=3&maxTurns=60')
  assert.equal(body.config.fogOfWar, true)
  assert.equal(body.config.fog, true)
  assert.equal(body.config.width, 10)
  assert.equal(body.config.variant, 3)
  assert.equal(body.config.maxTurns, 60)
})

test('a difficulty is a power level, or a time limit under its time key', () => {
  assert.deepEqual(pick(request('#/new/chess?difficulty=70')), [70, null, 'power'])
  assert.deepEqual(pick(request('#/new/chess?aiTimeMs=2000')), [null, 2000, 'time'])
  function pick({ config }) { return [config.difficulty, config.aiTimeMs, config.difficultyMode] }
})

test('a link naming what the game does not have is refused by name', () => {
  assert.throws(() => request('#/new/chess?colour=red'), /no setting "colour"/)
  assert.throws(() => request('#/new/chess?seats=human,stockfish'), /no agent "stockfish"/)
  assert.throws(() => request('#/new/chess/nope'), /no scenario "nope"/)
  assert.throws(() => request('#/new/chess?width=40'), /runs from 4 to 12/)
  assert.throws(() => request('#/new/chess?fog=maybe'), /on or off/)
  assert.throws(() => request('#/new/chess?variant=x'), /one of classic, 3/)
})

// The setup form as it opens on a scenario (GameSetupFields), to be edited.
function form(scenario = '') {
  const ov = window.gameDefaults.scenarioOverrides(game.scenarios.find((s) => s.id === scenario))
  return {
    scenario,
    players: window.gameDefaults.makeSlots(game, null, ov.players),
    gameOpts: { ...window.gameDefaults.initGameOpts(game), ...ov.config },
    maxTurns: ov.maxTurns,
  }
}
const roundTrip = (f) => {
  const { hash, omitted } = newSessionLink(game, f)
  assert.deepEqual(omitted, [])
  assert.deepEqual(request(hash), formRequest(game, f))
  return hash
}
const { formRequest } = await import('./sessions.js')

test('an untouched form is the bare link', () => {
  assert.equal(roundTrip(form()), '#/new/chess')
  assert.equal(roundTrip(form('endgame')), '#/new/chess/endgame')
})

test('a link names only what the form changed, and reads back as the form', () => {
  const f = form('endgame')
  f.players[0].name = 'Ann, Lee: 1'
  f.players[1].agent = 'random'
  Object.assign(f.gameOpts, { fogOfWar: false, width: 10, variant: 3, delay: '250', difficulty: null, aiTimeMs: 2000, difficultyMode: 'time' })
  f.maxTurns = null
  // The form keeps a seat's name when its agent changes; the link has to say it.
  assert.equal(roundTrip(f),
    '#/new/chess/endgame?seats=human:Ann%2C%20Lee%3A%201,random:CPU%201&fogOfWar=off&width=10&variant=3&aiTimeMs=2000&delay=250&maxTurns=off')
})

test('edited starting units are what a link cannot carry', () => {
  const f = form()
  f.gameOpts.startingUnits = { white: [] }
  assert.deepEqual(newSessionLink(game, f).omitted, ['startingUnits'])
})
