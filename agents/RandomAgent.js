/**
 * Picks uniformly at random from the legal action list. For continuous-location
 * games (cs/doom/combatmission/surviv — see games/coord.js) some action families
 * (e.g. CS grenade throws) only advertise one representative per mover in
 * `getLegalActions`, since a concrete aim point can't be pre-enumerated — so this
 * samples from the same continuous-lattice search actions ObscuroAgent uses
 * (game.getSearchActions) instead of picking a representative it couldn't apply.
 *
 * Gated on `game.isActionLegal` rather than merely `game.getSearchActions`: that's
 * the hook ActionValidator falls back to when an action isn't a structural match
 * in `legalActions` (see engine/ActionValidator.js), and it's only defined on the
 * continuous-location games above. A discrete game can define getSearchActions
 * too (civ1 does, for its own AI-search pruning — see games/civ1/searchActions.js)
 * without its output being validator-compatible with the real getLegalActions —
 * picking from it there produced actions the validator rejected as illegal,
 * ending the game early.
 */
export const RandomAgent = {
  id: 'random',
  chooseAction(state, legalActions, game) {
    const actions = game?.isActionLegal && game?.getSearchActions
      ? game.getSearchActions(state, state.activePlayers[0])
      : legalActions;
    return actions[Math.floor(Math.random() * actions.length)];
  },
};
