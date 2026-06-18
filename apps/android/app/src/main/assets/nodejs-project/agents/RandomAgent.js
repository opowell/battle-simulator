/** Picks uniformly at random from the legal action list. */
export const RandomAgent = {
  id: 'random',
  chooseAction(_state, legalActions) {
    return legalActions[Math.floor(Math.random() * legalActions.length)];
  },
};
