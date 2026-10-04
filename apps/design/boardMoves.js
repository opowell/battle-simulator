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
   * A token standing on a FIXTURE square is left out entirely, and so is a fixture
   * riding in a square's `stack` (civ1's city, drawn under the garrison standing on top
   * of it). `cell.fixture` says the square's art belongs to the square — civ1 draws a
   * city there, not its garrison — while `cell.unitId` still names the piece standing
   * in it, so the token carries the mover's id but is drawn as the thing that cannot
   * move. Animating that hop walks the city across the map behind the unit that just
   * stepped into it (and, for a hop still queued behind others, parks it on the mover's
   * old square for the length of the bundle). A piece that ends up inside a fixture
   * has no token of its own to move — enteredFixtures, below, is how its walk in is
   * still shown.
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

    const oldByUnit = tokensById(oldGrid);
    for (const t of cellTokens(newGrid)) {
      if (t.fixture) continue;
      const was = oldByUnit.get(t.id);
      if (!was || (was.x === t.x && was.y === t.y)) continue;
      moved.set(t.id, { from: { x: was.x, y: was.y }, to: { x: t.x, y: t.y } });
    }
    return moved;
  }

  // Every piece a cell stands for: the one it draws, plus any sharing the square
  // under it (civ1 stacks units — see Civ1Game's toGrid `stack`, and buildField,
  // which gives each of those a token too). Without the stack a unit that steps
  // under an escort, or out from under one, would arrive with no hop at all.
  // `src` is the token as the grid gives it, for whoever has to draw it again.
  function cellTokens(grid) {
    return (grid.cells ?? []).flatMap(c => [
      ...(c.stack ?? []).map(s => ({ id: s.unitId, x: c.x, y: c.y, fixture: !!s.fixture, src: s })),
      ...(c.unitId ? [{ id: c.unitId, x: c.x, y: c.y, fixture: !!c.fixture, src: c }] : []),
    ]);
  }
  function tokensById(grid) {
    const byId = new Map();
    for (const t of cellTokens(grid)) if (!byId.has(t.id)) byId.set(t.id, t);
    return byId;
  }

  /**
   * The pieces that walked INTO a fixture between two boards (a unit stepping into a
   * civ1 city, its own or one it is taking), as `Map(unitId -> { from, to, token })`.
   *
   * movedTokens leaves these out, because on the new board the piece's id is carried by
   * the fixture — the city is what is drawn there — and moving that token would walk
   * the city. But the walk still happened, and it is the one move the player most
   * wants to see: so it is played by the piece as the OLD board drew it (`token`, the
   * grid's own token for it), a stand-in that walks into the square and is gone once
   * it arrives. Only a piece the old board drew as itself has a stand-in: one that
   * was already inside a fixture (a garrison moving city to city) has nothing to show.
   * Square grids only — a continuous board has no fixtures.
   */
  function enteredFixtures(oldGrid, newGrid) {
    const entered = new Map();
    if (!oldGrid || !newGrid || newGrid.locationType === 'continuous') return entered;
    const oldByUnit = tokensById(oldGrid);
    const drawnNow = new Set(cellTokens(newGrid).filter(t => !t.fixture).map(t => t.id));
    for (const t of cellTokens(newGrid)) {
      if (!t.fixture || drawnNow.has(t.id) || entered.has(t.id)) continue;
      const was = oldByUnit.get(t.id);
      if (!was || was.fixture || (was.x === t.x && was.y === t.y)) continue;
      entered.set(t.id, { from: { x: was.x, y: was.y }, to: { x: t.x, y: t.y }, token: was.src });
    }
    return entered;
  }

  /**
   * The fixture drawn on square (x, y) of a board — the cell itself, or one riding in
   * its `stack` under the piece on top — or null. How a square LOOKED before a piece
   * walked into it: a city taken by that walk changes colours on the new board at
   * once, and has to keep its old ones until the walk is seen to arrive.
   */
  function fixtureAt(grid, x, y) {
    const c = (grid?.cells ?? []).find(c => c.x === x && c.y === y);
    if (!c) return null;
    return c.fixture ? c : (c.stack ?? []).find(s => s.fixture) ?? null;
  }

  /**
   * The fights in `newGrid.battles` that `oldGrid` had not shown yet, oldest first.
   *
   * A game keeps a short running record of recent fights on the board (see a game's
   * toGrid `battles`: `{ id, from, at, won, attacker, defender }`, ids counting up),
   * because one update can carry a whole bundle of turns and a fogged viewer's log
   * leaves out the opponent's moves entirely — the record is how the fights in
   * between get shown at all. "Not shown yet" is "numbered past anything the last
   * board had", not "absent from it": a fight that was out of sight on the last
   * board and has since come into view is old news, not a new fight.
   */
  function newBattles(oldGrid, newGrid) {
    const seen = Math.max(0, ...(oldGrid?.battles ?? []).map(b => b.id));
    return (newGrid?.battles ?? []).filter(b => b.id > seen).sort((a, b) => a.id - b.id);
  }

  root.MOVES = { movedTokens, enteredFixtures, fixtureAt, newBattles };
})(typeof window !== 'undefined' ? window : globalThis);
