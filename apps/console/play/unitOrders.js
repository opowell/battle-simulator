// unitOrders.js — which of the legal actions the Orders panel lists: the orders of
// the unit in hand, and whatever belongs to no unit at all (End Turn, playing a card).
//
// Loaded as a classic global <script> in index.html, for the same reason as
// boardMoves.js (vue3-sfc-loader can't parse `import`/`export` in a plain .js).
// Everything here is pure, published on `ORDERS`:
//   • browser — the classic <script> assigns window.ORDERS; SFCs call ORDERS.foo(...)
//   • node    — `await import('./unitOrders.js')` exposes globalThis.ORDERS for the
//               unit tests (see unitOrders.test.js).
//
// Nothing here knows any game: an action is whatever getLegalActions returned.
(function (root) {
  'use strict';

  // The id the games give the actions of the player as a whole (end-turn, end-buy…).
  const PLAYER = '__player__';

  /**
   * The unit an action is an order for, or null when it is the player's own. A
   * production building's order names it as `buildingId` (SC1's set-production),
   * since the building is a token on the board like any unit.
   *
   * `tokenIds` (a Set), when given, is every token the board draws: an order for a
   * unit that is not one of them counts as nobody's. A game whose squares carry no
   * unit ids (Mud and Blood) draws tokens the board names itself, which no action
   * can name, so picking one up could never reach its orders — those stay listed.
   */
  function orderOwner(action, tokenIds = null) {
    const owner = (action.unitId != null && action.unitId !== PLAYER)
      ? action.unitId : (action.buildingId ?? null);
    return owner != null && tokenIds && !tokenIds.has(owner) ? null : owner;
  }

  /**
   * The actions to list while `unitId` is the unit in hand: its own orders and the
   * player's. With no unit in hand (null) that is only the player's — every other
   * unit's orders wait until that unit is picked up, rather than turning the panel
   * into one long list of every unit's buttons at once.
   */
  function ordersFor(actions, unitId, tokenIds = null) {
    return actions.filter(a => {
      const owner = orderOwner(a, tokenIds);
      return owner == null || owner === unitId;
    });
  }

  /** Whether any of `actions` is an order for some unit other than `unitId`. */
  function othersHaveOrders(actions, unitId, tokenIds = null) {
    return actions.some(a => {
      const owner = orderOwner(a, tokenIds);
      return owner != null && owner !== unitId;
    });
  }

  root.ORDERS = { orderOwner, ordersFor, othersHaveOrders };
})(typeof window !== 'undefined' ? window : globalThis);
