// sessions.js — the POST /sessions body for a game, built one way wherever a
// session starts: the setup page's form (play/GamePage.vue), a scenario started in
// one click, a finished game's "play the next scenario".
//
// The seating and option rules are play/gameDefaults.js (loaded by index.html as
// window.gameDefaults), so a session started with a form left at its defaults is
// the session one click would have started.

const defaults = () => window.gameDefaults

const scenarioOf = (game, scenarioId) => game.scenarios?.find((s) => s.id === scenarioId) ?? null

/** The seats the form would open with: name and agent per seat. */
export function defaultSeats(game, scenarioId) {
  const overrides = defaults().scenarioOverrides(scenarioOf(game, scenarioId))
  return defaults().makeSlots(game, null, overrides.players).map(({ name, agent }) => ({ name, agent }))
}

/**
 * The body for a filled-in setup form.
 * @param game  a GET /games entry
 * @param form  { players: [{ name, agent }], gameOpts, maxTurns, scenario } —
 *              maxTurns is null when the turn limit is off
 */
export function formRequest(game, { players: seats, gameOpts = {}, maxTurns, scenario }) {
  const ids = defaults().seatIds(game, seats)
  const players = seats.map((seat, i) => ({
    id: ids[i],
    name: seat.name || game.defaultPlayers?.[i]?.name || `Player ${i + 1}`,
    agent: seat.agent === 'human' ? 'human' : seat.agent ?? 'random',
  }))
  return {
    game: game.name,
    players,
    config: {
      ...(maxTurns ? { maxTurns } : {}),
      fog: gameOpts.fogOfWar ?? false,
      ...gameOpts,
      scenario: scenario || undefined,
    },
  }
}

/**
 * The body for a scenario (or '' for none) with the form left at its defaults.
 * @param seats  [{ name, agent }] — defaultSeats(), possibly edited
 */
export function sessionRequest(game, scenarioId, seats) {
  const overrides = defaults().scenarioOverrides(scenarioOf(game, scenarioId))
  return formRequest(game, {
    players: seats,
    gameOpts: { ...defaults().initGameOpts(game), ...overrides.config },
    maxTurns: overrides.maxTurns,
    scenario: scenarioId,
  })
}

/**
 * An ANALYSIS BOARD: a study session with no opponent. Every seat is human (the
 * one person at the keyboard moves both sides), which is the condition the server
 * puts on the flag, and which is what lets the whole board be revealed and the game
 * database stay open while the session is still being played.
 *
 * Fog goes ON for a game that has one to offer: an analysis board with the fog
 * lifted is just a board, and the database's whole question — what did players who
 * could see what you can see go on to play — needs the fog to mean anything.
 * Everything else — scenario, options, turn limit — is taken from the form.
 */
export function analysisBoardRequest(game, form) {
  const fogged = (game.gameOptions ?? []).some((o) => o.id === 'fogOfWar')
  return formRequest(game, {
    ...form,
    gameOpts: { ...form.gameOpts, analysisBoard: true, ...(fogged ? { fogOfWar: true } : {}) },
    players: form.players.map((p) => ({ ...p, agent: 'human' })),
  })
}

/**
 * Another scenario of the same game — the one a finished game suggests next — set
 * up as the setup page would set it up: its own config and seats laid over the
 * settings `params` (a session's creation parameters) were played with. Starting
 * units belong to the map they were picked for, so they stay behind, as does the
 * old scenario's turn limit. Null when the game has no such scenario.
 */
export function nextScenarioRequest(game, params, scenarioId) {
  const sc = scenarioOf(game, scenarioId)
  if (!sc) return null
  const overrides = defaults().scenarioOverrides(sc)
  // `fog` is formRequest's copy of `fogOfWar`, made again from the merged options —
  // a stale one carried over would outvote the new scenario's own fog setting.
  const { startingUnits, scenario, maxTurns, fog, ...kept } = params.config ?? {}
  return formRequest(game, {
    gameOpts: { ...(fog != null ? { fogOfWar: fog } : {}), ...kept, ...overrides.config },
    maxTurns: overrides.maxTurns,
    scenario: sc.id,
    players: overrides.players ? defaults().makeSlots(game, null, overrides.players) : params.players,
  })
}
