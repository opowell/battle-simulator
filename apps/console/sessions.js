// sessions.js — the POST /sessions body for a game (and optionally one of its
// scenarios), built the way the play UI's setup form builds it.
//
// The seating and option rules are the play UI's own (apps/design/gameDefaults.js,
// loaded by index.html as window.gameDefaults), so a session started here is the
// session the play UI would have started with its form left at the defaults.

const defaults = () => window.gameDefaults

const scenarioOf = (game, scenarioId) => game.scenarios?.find((s) => s.id === scenarioId) ?? null

/** The seats the form would open with: name and agent per seat. */
export function defaultSeats(game, scenarioId) {
  const overrides = defaults().scenarioOverrides(scenarioOf(game, scenarioId))
  return defaults().makeSlots(game, null, overrides.players).map(({ name, agent }) => ({ name, agent }))
}

/**
 * @param game        a GET /games entry
 * @param scenarioId  one of its scenarios, or '' for none
 * @param seats       [{ name, agent }] — defaultSeats(), possibly edited
 */
export function sessionRequest(game, scenarioId, seats) {
  const overrides = defaults().scenarioOverrides(scenarioOf(game, scenarioId))
  const options = { ...defaults().initGameOpts(game), ...overrides.config }
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
      ...(overrides.maxTurns ? { maxTurns: overrides.maxTurns } : {}),
      fog: options.fogOfWar ?? false,
      ...options,
      scenario: scenarioId || undefined,
    },
  }
}
