/**
 * Picks uniformly at random from the legal action list. For continuous-location
 * games (cs/doom/combatmission — see games/coord.js) some action families (e.g.
 * CS grenade throws) only advertise one representative per mover in
 * `getLegalActions`, since a concrete aim point can't be pre-enumerated — so this
 * samples from the same continuous-lattice search actions ObscuroAgent uses
 * (game.getSearchActions) instead of picking a representative it couldn't apply.
 */
export const RandomAgent = {
  id: 'random',
  chooseAction(state, legalActions, game) {
    const actions = game?.getSearchActions
      ? game.getSearchActions(state, state.activePlayers[0])
      : legalActions;
    return actions[Math.floor(Math.random() * actions.length)];
  },
};
