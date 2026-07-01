// ---------------------------------------------------------------------------
// Shared heuristic leaf evaluations for the generic ObscuroAgent (see
// agents/ObscuroAgent.js and the `evaluateState` hook documented in
// games/types.js).
//
// Every helper returns a value to `playerId`: positive when the position
// favours that player, negative when it favours the opposition. The sign
// convention is "me vs everyone else", so the helpers work for 2- and
// N-player games alike.
// ---------------------------------------------------------------------------

/**
 * Sum `valueOf(entity)` with a +sign for the player's own entities and a
 * −sign for everyone else's. Dead (alive === false) and unowned entities are
 * skipped. `ownerOf` extracts the owner id (defaults to `ownerId` then `owner`,
 * covering units/cities/buildings and territories alike).
 */
export function sidesEval(entities, playerId, valueOf, ownerOf = e => e.ownerId ?? e.owner) {
  let score = 0;
  for (const e of entities ?? []) {
    if (e.alive === false) continue;
    const owner = ownerOf(e);
    if (owner == null) continue;
    score += owner === playerId ? valueOf(e) : -valueOf(e);
  }
  return score;
}

/**
 * Material evaluation for unit-elimination games: a living unit is worth its
 * current hp plus a flat survival bonus, so unit count matters beyond raw hp.
 */
export function unitStrengthEval(state, playerId, bonus = 10) {
  return sidesEval(state.units, playerId, u => (u.hp ?? 0) + bonus);
}
