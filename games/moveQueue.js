// Generic "goto queue" mechanic for turn-based, per-unit-movement games: once a unit
// has spent this turn's moves, further destinations are queued instead of applied
// immediately, then replayed automatically — oldest first — as its moves refresh on
// each of its future turns (see civ1's original request: "plan multiple moves ahead").
//
// Opt-in per game, not automatic: a game wires this in by
//   1. giving each unit a `queue` array ({x,y}[], oldest first, starts empty),
//   2. splicing `queueMoveActions`/`queuePopAction` into its own getLegalActions,
//   3. handling the 'queue-move' / 'queue-pop' action types in applyActions via
//      `enqueueWaypoint`/`dequeueLastWaypoint`, and
//   4. calling `runQueuedMoves` once a player's units' moves refresh for a new turn
//      (typically from the game's own 'end-turn' handling).
// See Civ1Game.js for a worked example — its own movement cost, terrain/occupancy
// legality, and side effects (e.g. capturing a city) stay entirely in its adapter
// callbacks; this module only tracks the queue itself and when to advance it.
//
// The client side (apps/design) renders any unit.queue it finds and gates its own
// affordances (the goto-path overlay, the side-panel list, Backspace/"undo last
// queued move") behind `field.ui?.moveQueue !== false` — on by default, so a game
// that adopts this module gets the UI for free; set `ui: { moveQueue: false }` to
// suppress it (e.g. a game that reuses the `queue` field name for something else).

/**
 * Legal 'queue-move' destinations for `unit`, once it has 0 moves left this turn:
 * the tiles reachable with a full fresh turn's moves, computed from wherever the
 * queue currently ends (so repeated calls chain a route further into the future).
 * Returns [] while the unit still has moves — queuing only kicks in once it's out.
 *
 * @param {object} unit - must have .position, .movesLeft, .queue
 * @param {string} playerId - the unit's controller
 * @param {number} movesPerTurn - this unit's full per-turn move budget (its `moves` stat)
 * @param {(virtualUnit: object, playerId: string) => {x:number,y:number}[]} reachableTiles
 *   the game's own movement-range flood fill, called with a *hypothetical* unit (real
 *   id, moves reset to `movesPerTurn`, position at the queue's tail) standing in for
 *   "this unit, next turn"
 */
export function queueMoveActions(unit, playerId, movesPerTurn, reachableTiles) {
  if (unit.movesLeft > 0) return [];
  const tail = unit.queue.length ? unit.queue[unit.queue.length - 1] : unit.position;
  const virtualUnit = { ...unit, position: tail, movesLeft: movesPerTurn };
  return reachableTiles(virtualUnit, playerId).map(to => ({ type: 'queue-move', unitId: unit.id, to }));
}

/** A 'queue-pop' ("undo last queued move") action for `unit`, or null if its queue is empty. */
export function queuePopAction(unit) {
  return unit.queue.length ? { type: 'queue-pop', unitId: unit.id } : null;
}

/** Appends `to` to `unitId`'s queue. Handles the 'queue-move' action in applyActions. */
export function enqueueWaypoint(units, unitId, to) {
  return units.map(u => u.id === unitId ? { ...u, queue: [...u.queue, to] } : u);
}

/** Drops the most recently queued waypoint. Handles the 'queue-pop' action in applyActions. */
export function dequeueLastWaypoint(units, unitId) {
  return units.map(u => u.id === unitId ? { ...u, queue: u.queue.slice(0, -1) } : u);
}

/**
 * Call once a player's units' moves refresh for a new turn (typically from the
 * game's 'end-turn' handling): consumes each of that player's units' queues, oldest
 * waypoint first, until moves run out or a waypoint is no longer legal — in which
 * case the rest of that unit's queue is left for a future turn (the obstacle may
 * clear on its own).
 *
 * @param {object[]} units - the authoritative units array
 * @param {string} playerId - whose units are refreshing
 * @param {(to: {x:number,y:number}, unit: object, playerId: string, units: object[]) => boolean} isTargetLegal
 *   re-validate a queued waypoint at execution time (occupancy may have changed
 *   since it was planned); `units` is always the current, in-progress array
 * @param {(units: object[], playerId: string, unit: object, to: {x:number,y:number}) => object[]} applyMove
 *   perform one step of real movement (deduct cost, move the unit) and return the
 *   updated units array; may close over and update other state the caller owns
 *   (e.g. a city captured by walking onto it)
 * @returns {object[]} the updated units array
 */
export function runQueuedMoves(units, playerId, isTargetLegal, applyMove) {
  const queuedIds = units
    .filter(u => u.alive !== false && u.ownerId === playerId && u.queue?.length)
    .map(u => u.id);
  for (const id of queuedIds) {
    let unit = units.find(u => u.id === id);
    while (unit && unit.movesLeft > 0 && unit.queue.length > 0) {
      const to = unit.queue[0];
      if (!isTargetLegal(to, unit, playerId, units)) break;
      units = applyMove(units, playerId, unit, to);
      units = units.map(u => u.id === id ? { ...u, queue: u.queue.slice(1) } : u);
      unit = units.find(u => u.id === id);
    }
  }
  return units;
}
