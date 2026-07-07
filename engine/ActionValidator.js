function canonicalKey(action) {
  const sorted = {};
  for (const k of Object.keys(action).sort()) sorted[k] = action[k];
  return JSON.stringify(sorted);
}

/**
 * Verify that `action` is structurally equal to one entry in `legalActions`, or —
 * for games that expose a geometric `isActionLegal` check — that it passes that check.
 * Continuous-location games (doom/cs/combatmission, see games/coord.js) let a player
 * move (and, for CS, throw) to any exact point they click; such destinations can't be
 * pre-enumerated into `legalActions` for an exact structural match, so the game
 * validates them geometrically instead. Throws if neither holds.
 * @param {import('../games/types.js').Action} action
 * @param {import('../games/types.js').Action[]} legalActions
 * @param {import('../games/types.js').GameDefinition} [game]
 * @param {*} [state]
 * @param {string} [playerId]
 */
export function validate(action, legalActions, game, state, playerId) {
  const key = canonicalKey(action);
  if (legalActions.some(a => canonicalKey(a) === key)) return;
  if (game?.isActionLegal?.(state, playerId, action)) return;
  throw new Error(`Illegal action: ${JSON.stringify(action)}`);
}
