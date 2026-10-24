/**
 * Shallow-freeze a state object so the engine boundary is immutable.
 * Games build fresh objects in applyActions; the engine freezes the result.
 * @param {object} state
 * @returns {object}
 */
export function freeze(state) {
  return Object.freeze(state);
}

/**
 * Shallow-clone a state for tests or manual manipulation.
 * @param {object} state
 * @returns {object}
 */
export function clone(state) {
  return { ...state };
}
