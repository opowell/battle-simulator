// planQueue.js — a player-level queue of moves for a TURN-BASED game: the moves
// you have already decided to make on your next turns, committed before those
// turns arrive. Chess players call it a premove; the mechanic is not chess's.
//
// This is the discrete-time counterpart of a per-piece order queue. Which of the
// two a game wants follows from its clock, and the difference is not cosmetic:
//
//   • CONTINUOUS time — a player may act at any instant, so planning IS acting.
//     An order given now that resolves later is an ordinary game action, it
//     belongs to the piece it commands, and every piece has a queue of its own.
//     (games/chess/spacetime.js.)
//   • DISCRETE time — a player may only act on their own turn, so a move meant
//     for a LATER turn cannot be an action of this one. It is out-of-band state,
//     like a map annotation: set whenever the player likes, including while the
//     opponent is thinking, which is exactly when a plan is worth making.
//     That's this module.
//
// Out-of-band is what makes it safe as well as useful. A queued move that fires
// the moment your turn opens is only reasonable if you can call it off at any
// time, and you cannot call anything off through an action when it isn't your
// turn. So a plan is carried on the state, edited through its own channel (see
// api-server's /sessions/:id/plan, which mirrors the fog-marker channel), and
// never appears in the legal-action list at all — no agent has to know it exists,
// and no search has to reason about a move that changes nothing it can see.
//
// The plan is a plan against a FROZEN OPPONENT: each queued move is enumerated in
// the position left by the ones before it, with the other side standing still.
// That is the only position available to plan in, and saying so out loud is also
// what makes the failure mode obvious — the opponent moves, the plan's first move
// stops being legal, and the whole plan goes (`pruneForTurn`), because everything
// behind it was reasoned from a position that will now never happen.
//
// A game wires this in by
//   1. keeping `{ [playerId]: action[] }` somewhere in its state,
//   2. writing an `applyOne` adapter (below) and a `sameMove` equality,
//   3. calling `pruneForTurn` when a turn arrives and `afterMove` when a move is
//      played, and
//   4. exposing `setPlan` (validated via `buildPlan`) and `planFrontier`.
// See games/chess/ChessGame.js for a worked example.

/**
 * How many moves deep a plan may go. Bounded because a plan is a commitment made
 * without seeing the replies, and every move past the first is one more thing the
 * opponent gets to invalidate for free.
 */
export const MAX_PLAN = 6;

/**
 * @typedef {Object} PlanAdapter
 * @property {(state: object, playerId: string, action: object) => object} applyOne
 *   Apply one planned move and hand back a position that is still `playerId`'s to
 *   move in. The game owns whatever that takes — forcing `activePlayers` back,
 *   clearing per-move side state (chess's en-passant target belongs to the
 *   opponent's reply, and there is no opponent in a plan).
 * @property {(state: object, playerId: string) => object[]} baseActions
 *   The game's real move list for a position — the plain one, NOT the list this
 *   module contributes to, or enumerating a plan would recurse.
 * @property {(a: object, b: object) => boolean} sameMove
 *   Whether two moves are the same move (chess: same from/to/promotion).
 */

/**
 * The position a plan leaves behind: `playerId`'s queued moves applied in order,
 * the opponent never moving. Returns `null` if the plan stops being playable part
 * way through — which can happen at any time, since the real board moves on
 * underneath a plan that was made against an older one.
 */
export function planPosition(state, playerId, plan, { applyOne, baseActions, sameMove }) {
  let cur = state;
  for (const move of plan ?? []) {
    if (!baseActions(cur, playerId).some((a) => sameMove(a, move))) return null;
    cur = applyOne(cur, playerId, move);
  }
  return cur;
}

/**
 * The moves that could be added to the END of the plan — the legal moves of the
 * position the plan leaves behind. Empty once the plan is full or has gone stale.
 */
export function planFrontier(state, playerId, plan, adapter, max = MAX_PLAN) {
  if ((plan?.length ?? 0) >= max) return [];
  const at = planPosition(state, playerId, plan, adapter);
  return at ? adapter.baseActions(at, playerId) : [];
}

/**
 * Validate a whole proposed plan, move by move, each against the position the
 * ones before it leave. Returns the plan as the GAME's own action objects (the
 * caller may have sent thin descriptors), or throws with the move that failed.
 *
 * Validating the whole thing rather than just the new tail is deliberate: a plan
 * arrives from a client that may have been looking at a stale board, and half a
 * plan is worse than none.
 *
 * @param {object[]} wanted  moves as sent, matched against real ones by `sameMove`
 */
export function buildPlan(state, playerId, wanted, adapter, max = MAX_PLAN) {
  const plan = [];
  let cur = state;
  for (const want of wanted ?? []) {
    if (plan.length >= max) throw new Error(`A plan may hold at most ${max} moves`);
    const real = adapter.baseActions(cur, playerId).find((a) => adapter.sameMove(a, want));
    if (!real) throw new Error(`Move ${describe(want)} is not legal at that point in the plan`);
    plan.push(real);
    cur = adapter.applyOne(cur, playerId, real);
  }
  return plan;
}

const describe = (m) => `${m?.from ?? '?'}→${m?.to ?? '?'}`;

/**
 * What a plan is worth after its owner has actually moved. Playing the move at
 * the head advances the plan; playing anything else abandons it, because every
 * move behind the head was reasoned from a position the player has just declined
 * to reach.
 */
export function afterMove(plan, played, sameMove) {
  if (!plan?.length) return [];
  return sameMove(plan[0], played) ? plan.slice(1) : [];
}

/**
 * What a plan is worth when its owner's turn arrives. The head has to be legal
 * NOW — the opponent has moved since it was queued, and may have taken the piece,
 * blocked the square, or given check. If it isn't, the whole plan goes.
 */
export function pruneForTurn(state, playerId, plan, { baseActions, sameMove }) {
  if (!plan?.length) return [];
  return baseActions(state, playerId).some((a) => sameMove(a, plan[0])) ? plan : [];
}
