// boardMoves.js — which tokens changed square between two boards, and therefore what
// the move animation has to play.
//
// Loaded as a classic global <script> in index.html (like keyBindings.js/vision.js) —
// this repo's no-bundler UI runs .vue files through vue3-sfc-loader, which CANNOT
// parse `import`/`export` inside a plain .js, so shared helper code lives on a global
// instead. Everything here is pure (no DOM, no live state), published on `MOVES`:
//   • browser — the classic <script> assigns window.MOVES; SFCs call MOVES.foo(...)
//   • node    — `await import('./boardMoves.js')` exposes globalThis.MOVES for the
//               unit tests (see boardMoves.test.js).
//
// Nothing here knows any game: a board is a grid as toGrid describes it.
(function (root) {
  'use strict';

  /**
   * Net position changes A→B between two grids, as `Map(unitId -> { from, to })`.
   * Net, not per-step: a unit that moved twice inside one bundled update collapses to
   * a single hop.
   *
   * Two shapes of board, matching buildField's two ways of placing a token:
   *   • continuous-location games (doom/cs/combatmission — see games/coord.js) carry
   *     real positions in a parallel `grid.units` channel;
   *   • everything else embeds its units in the cells, located by cell index.
   *
   * A token standing on a FIXTURE square is left out entirely. `cell.fixture` says the
   * square's art belongs to the square — civ1 draws a city there, not its garrison —
   * while `cell.unitId` still names the piece standing in it, so the token carries the
   * mover's id but is drawn as the thing that cannot move. Animating that hop walks
   * the city across the map behind the unit that just stepped into it (and, for a hop
   * still queued behind others, parks it on the mover's old square for the length of
   * the bundle). A piece that enters a fixture is simply absorbed by it, which is also
   * how the original games draw it.
   */
  function movedTokens(oldGrid, newGrid) {
    const moved = new Map();
    if (!oldGrid || !newGrid) return moved;

    if (newGrid.locationType === 'continuous') {
      const oldUnits = new Map((oldGrid.units ?? []).map(u => [u.id, u]));
      for (const nu of newGrid.units ?? []) {
        const ou = oldUnits.get(nu.id);
        if (!ou) continue;
        const from = { x: Number(ou.x), y: Number(ou.y) };
        const to   = { x: Number(nu.x), y: Number(nu.y) };
        if (from.x === to.x && from.y === to.y) continue;
        moved.set(nu.id, { from, to });
      }
      return moved;
    }

    const oldByUnit = new Map();
    for (const c of oldGrid.cells ?? []) if (c.unitId && !oldByUnit.has(c.unitId)) oldByUnit.set(c.unitId, c);
    for (const newCell of newGrid.cells ?? []) {
      if (!newCell.unitId) continue;
      if (newCell.fixture) continue;
      const oldCell = oldByUnit.get(newCell.unitId);
      if (!oldCell || (oldCell.x === newCell.x && oldCell.y === newCell.y)) continue;
      moved.set(newCell.unitId, { from: { x: oldCell.x, y: oldCell.y }, to: { x: newCell.x, y: newCell.y } });
    }
    return moved;
  }

  root.MOVES = { movedTokens };
})(typeof window !== 'undefined' ? window : globalThis);
