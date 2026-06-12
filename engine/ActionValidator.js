function canonicalKey(action) {
  const sorted = {};
  for (const k of Object.keys(action).sort()) sorted[k] = action[k];
  return JSON.stringify(sorted);
}

/**
 * Verify that `action` is structurally equal to one entry in `legalActions`.
 * Throws if not found.
 * @param {import('../interfaces/types.js').Action} action
 * @param {import('../interfaces/types.js').Action[]} legalActions
 */
export function validate(action, legalActions) {
  const key = canonicalKey(action);
  if (!legalActions.some(a => canonicalKey(a) === key)) {
    throw new Error(`Illegal action: ${JSON.stringify(action)}`);
  }
}
