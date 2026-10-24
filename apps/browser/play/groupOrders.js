// groupOrders.js — RTS-style group control on a continuous map: which tokens a dragged
// box picks up, and where each member of a picked-up group goes when one point on the
// map is clicked.
//
// Loaded as a classic global <script> in index.html, for the same reason as
// boardMoves.js (vue3-sfc-loader can't parse `import`/`export` in a plain .js).
// Everything here is pure, published on `GROUP`:
//   • browser — the classic <script> assigns window.GROUP; SFCs call GROUP.foo(...)
//   • node    — `await import('./groupOrders.js')` exposes globalThis.GROUP for the
//               unit tests (see groupOrders.test.js).
//
// Nothing here knows any game: a token is `{ id, x, y, team, dead?, moveRange? }` as
// Battlefield.vue's displayUnits carries it, in world units.
(function (root) {
  'use strict';

  /**
   * The ids of `team`'s live tokens whose centre lies inside the box, in token order.
   * Like StarCraft's drag-select, a box that catches any unit that can move takes only
   * those: sweeping an army that stands around a base picks up the army, not the
   * buildings (a token without a `moveRange` is something that never moves). A box
   * holding nothing but structures still takes the structures.
   * The box's corners can come in either order — it is wherever the drag went.
   */
  function boxPick(tokens, box, team) {
    const x0 = Math.min(box.x0, box.x1), x1 = Math.max(box.x0, box.x1);
    const y0 = Math.min(box.y0, box.y1), y1 = Math.max(box.y0, box.y1);
    const inside = tokens.filter(t => !t.dead && t.team === team
      && t.x >= x0 && t.x <= x1 && t.y >= y0 && t.y <= y1);
    const mobile = inside.filter(t => t.moveRange != null);
    return (mobile.length ? mobile : inside).map(t => t.id);
  }

  /**
   * One move order per group member for a click at `point`, as `[{ unitId, to: {x, y} }]`.
   *
   * The group keeps its shape: each unit heads for the click plus its own offset from
   * the group's centre, so a line of marines arrives as a line rather than all of them
   * trying to stand on one spot (which a map that won't let two units overlap would
   * refuse for all but one). A group spread wider than `maxSpread` is first drawn in to
   * that radius — two squads on opposite sides of the map, sent somewhere together,
   * should meet there, not stay a map apart.
   *
   * A unit can only go `moveRange` this turn, so a destination beyond it is pulled back
   * along the straight line toward it: the unit gets as close as it can, the way an
   * order to a far-off point plays out over several turns. A unit with no move left
   * (moveRange 0) or no moveRange at all gets no order. `bounds` ({ w, h }) keeps a
   * flank's offset from pushing its target off the map.
   */
  function formationTargets(tokens, point, { maxSpread = 3, bounds = null } = {}) {
    const movers = tokens.filter(t => !t.dead && t.moveRange > 0);
    if (!movers.length) return [];
    const cx = movers.reduce((s, t) => s + t.x, 0) / movers.length;
    const cy = movers.reduce((s, t) => s + t.y, 0) / movers.length;
    const spread = Math.max(...movers.map(t => Math.hypot(t.x - cx, t.y - cy)));
    const squeeze = spread > maxSpread ? maxSpread / spread : 1;
    const EDGE = 0.01;   // stay strictly inside the board
    return movers.map(t => {
      let x = point.x + (t.x - cx) * squeeze;
      let y = point.y + (t.y - cy) * squeeze;
      if (bounds) {
        x = Math.min(bounds.w - EDGE, Math.max(EDGE, x));
        y = Math.min(bounds.h - EDGE, Math.max(EDGE, y));
      }
      const d = Math.hypot(x - t.x, y - t.y);
      // Just inside the reach, not on it: the server measures with exact decimals and a
      // float that lands a hair past the radius would be refused.
      const reach = t.moveRange * 0.999;
      if (d > reach) {
        const f = reach / d;
        x = t.x + (x - t.x) * f;
        y = t.y + (y - t.y) * f;
      }
      return { unitId: t.id, to: { x, y } };
    });
  }

  root.GROUP = { boxPick, formationTargets };
})(typeof window !== 'undefined' ? window : globalThis);
