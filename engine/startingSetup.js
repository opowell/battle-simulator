/**
 * startingSetup.js — customising the units a game STARTS with, for every game.
 *
 * A game definition builds one canonical opening position (createInitialState).
 * This module lets a session override the roster that position ships with: which
 * units each seat begins with, and where each of them stands. It is completely
 * game-agnostic — it only relies on the universal `state.units` contract from
 * games/types.js (id / ownerId / type / position) — so a game gets the feature
 * without writing a line of code. The one thing nearly every game keeps a second
 * copy of, `gameSpecific.startRoster` (fog belief's common knowledge), is rebuilt
 * here generically; a game that derives anything else from its opening units
 * (chess's `board`, civ1's seeded exploration) says so with `applyStartingUnits`.
 *
 * The override lives in the session config as `config.startingUnits`, an array of
 * { id?, ownerId, type, position } entries — the WHOLE opening roster, not a diff.
 * That matters for replay: `config` is what the api-server keeps and what every
 * state reconstruction (replayStateAtPly) starts from, so a game customised at
 * setup time rebuilds identically for analysis, undo and the scrub bar. Nothing
 * here is stored on the state itself.
 *
 * How a roster entry becomes a unit:
 *   • `id` naming a unit of the same owner and type in the game's own opening
 *     position → THAT unit, moved to `position`. Keeping the original object
 *     (and its id) is what lets "I just dragged my knight one square" leave every
 *     other field — hp, ammo, per-unit attrs, anything the game hung off it —
 *     exactly as the game built it.
 *   • anything else (a unit the player ADDED) → a fresh clone of a template of
 *     that type, with a new id. The template is another unit of the same type in
 *     the opening position: same owner if there is one, else any owner's. A game
 *     that can mint a unit of a type it doesn't happen to open with implements
 *     `createSetupUnit` and is asked first, which is how chess can add a second
 *     queen and civ1 a cavalry it has not researched yet.
 *
 * Positions are opaque game values ('e4', {x,y}, {col,row}, …). `cellMapper`
 * translates between them and grid cells for the UI, without any game knowing.
 *
 * An entry may also name a unit of ANOTHER game — { ownerId, type: 'marine',
 * game: 'sc1', position } — which then plays under this game's rules as the
 * closest of its own types, with its stats converted by each game's conversion
 * factor (engine/foreignUnits.js). On the board it reads back the same way.
 */

import { foreignEntryError, foreignKey, mintForeign, nameOfGame, originOf, dressGrid, foreignCatalog } from './foreignUnits.js';

/** Config key carrying the custom roster. */
export const SETUP_KEY = 'startingUnits';

/**
 * The opening position, with `config.startingUnits` applied when it's there.
 * Every path that builds a starting state goes through this (GameEngine._init,
 * the api-server's replays), so a session's opening is the same everywhere.
 */
export function buildInitialState(game, players, config = {}) {
  const state = game.createInitialState(players, config);
  const roster = config?.[SETUP_KEY];
  if (!Array.isArray(roster) || !roster.length) return state;
  return applyRoster(game, state, roster, config);
}

/**
 * The customisable roster of a state: every live unit, in board order.
 * `id` is the handle a caller sends back to say "this same unit". A unit from
 * another game is named the way it was asked for — its own game and type, not
 * the chassis it plays as here.
 */
export function rosterFromState(state) {
  return (state?.units ?? [])
    .filter(u => u && u.alive !== false)
    .map((u) => {
      const origin = originOf(u);
      return origin
        ? { id: u.id, ownerId: u.ownerId, type: origin.type, game: origin.game, position: u.position ?? null }
        : { id: u.id, ownerId: u.ownerId, type: u.type, position: u.position ?? null };
    });
}

/** Whether a roster entry names a unit of another game than `game`. */
const isForeign = (game, entry) => entry?.game != null && entry.game !== nameOfGame(game);

/** Whether `unit` is the one `entry` describes: same owner, same kind of unit. */
function sameKind(game, unit, entry) {
  if (unit.ownerId !== entry.ownerId) return false;
  const origin = originOf(unit);
  if (isForeign(game, entry)) return !!origin && origin.game === entry.game && origin.type === entry.type;
  return !origin && unit.type === entry.type;
}

/**
 * Every unit type of the game's OWN a roster may name: the ones the game opens
 * with, plus any the game offers. (Units of other games are listed apart — see
 * describeSetup's `foreign`.)
 */
export function setupUnitTypes(game, state) {
  const offered = typeof game?.setupUnitTypes === 'function' ? game.setupUnitTypes(state) : null;
  const present = [...new Set((state?.units ?? []).filter(u => u && u.alive !== false && !originOf(u)).map(u => u.type))];
  return [...new Set([...(offered ?? []), ...present])];
}

/**
 * Every side that owns units in `base`. Usually the seats, but not always: a game
 * may own units under a name of its own (cs's 'T'/'CT' teams, doom's 'demon'), and
 * a roster is allowed to name any of those as well as the seats themselves.
 */
function owners(base, players) {
  return new Set([
    ...(players ?? []).map(p => p.id),
    ...(base?.units ?? []).filter(u => u && u.alive !== false).map(u => u.ownerId),
  ]);
}

/**
 * Why `roster` cannot be built on top of `base`, or '' when it can. Checked before
 * a session is created so a bad roster is a 400 with a reason, not a broken game.
 */
export function rosterError(game, base, roster, players = base?.players ?? []) {
  if (!Array.isArray(roster)) return 'startingUnits must be an array';
  if (!roster.length) return 'startingUnits must name at least one unit';
  const sides = owners(base, players);
  const types = new Set(setupUnitTypes(game, base));
  for (const [i, e] of roster.entries()) {
    if (!e || typeof e !== 'object') return `startingUnits[${i}] must be an object`;
    if (!sides.has(e.ownerId)) return `startingUnits[${i}]: "${e.ownerId}" owns nothing in this game`;
    if (isForeign(game, e)) {
      const problem = foreignEntryError(game, base, e);
      if (problem) return `startingUnits[${i}]: ${problem}`;
      continue;
    }
    if (!types.has(e.type)) return `startingUnits[${i}]: "${e.type}" is not a starting unit type of this game`;
  }
  // Wiping a side out entirely isn't a handicap, it's a game that can't be played:
  // plenty of definitions assume every side they dealt in still has something on
  // the board (they read units[0], or end the game on turn 0).
  const left = new Set(roster.map(e => e.ownerId));
  for (const o of new Set((base?.units ?? []).filter(u => u && u.alive !== false).map(u => u.ownerId))) {
    if (!left.has(o)) return `startingUnits: ${o} must start with at least one unit`;
  }
  return '';
}

/**
 * `base` (a game's own opening position) rebuilt around `roster`.
 * Pure: `base` is never mutated.
 *
 * `midGame` says `base` is a game in progress rather than an opening — units added
 * or taken off the board while it is being played (engine/reconfigure.js). It is
 * passed on to the game's `applyStartingUnits`, so what the game re-derives from
 * its units can build on what the game has accumulated instead of starting it
 * over (civ1's explored map, chess's castling rights).
 */
export function applyRoster(game, base, roster, config = {}, { midGame = false } = {}) {
  const problem = rosterError(game, base, roster);
  if (problem) throw new Error(problem);

  const byId = new Map((base.units ?? []).map(u => [u.id, u]));
  const claimed = new Set();
  // Fresh ids can't collide with the game's own, nor with each other.
  const taken = new Set(byId.keys());
  let seq = 0;
  const freshId = (type) => {
    let id;
    do { id = `setup-${type}-${seq++}`; } while (taken.has(id));
    taken.add(id);
    return id;
  };

  const units = roster.map((entry) => {
    const kept = entry.id != null && !claimed.has(entry.id) ? byId.get(entry.id) : undefined;
    if (kept && sameKind(game, kept, entry)) {
      claimed.add(entry.id);
      return place(kept, entry.position);
    }
    if (isForeign(game, entry)) {
      const id = freshId(foreignKey(entry.game, entry.type).replace(':', '-'));
      return place(mintForeign(game, base, entry, id, (spec, chassis) => build(game, base, spec, chassis)), entry.position);
    }
    return place(mint(game, base, entry, freshId), entry.position);
  });

  const next = withStartRoster({ ...base, units });
  // Anything else a game derives from its opening units — chess's `board`, civ1's
  // seeded exploration — is rebuilt by the game itself, from the units already in
  // place on `next`.
  return game.applyStartingUnits ? game.applyStartingUnits(next, config, { midGame }) : next;
}

/**
 * `gameSpecific.startRoster` re-derived from the state's units.
 *
 * Nearly every game here records its opening deployment there — it is what fog
 * belief treats as common knowledge (everyone knows what everyone STARTED with,
 * see each game's belief.js) — either as a plain array of units or as
 * { units, cities, … }. Left alone it would still describe the game's own default
 * army, so every belief tracker would spend the game hunting units that were never
 * dealt. Rebuilt generically, by projecting each unit onto the same fields the
 * game's own entries carry, so no game has to know this feature exists.
 */
function withStartRoster(state) {
  const roster = state.gameSpecific?.startRoster;
  const list = Array.isArray(roster) ? roster : (Array.isArray(roster?.units) ? roster.units : null);
  if (!list) return state;
  const fields = Object.keys(list[0] ?? { id: 1, ownerId: 1, type: 1, position: 1 });
  const rebuilt = state.units
    .filter(u => u.alive !== false)
    .map(u => Object.fromEntries(fields.map(f => [f, structuredClone(u[f] ?? null)])));
  return {
    ...state,
    gameSpecific: {
      ...state.gameSpecific,
      startRoster: Array.isArray(roster) ? rebuilt : { ...roster, units: rebuilt },
    },
  };
}

/** A unit the roster added: the game's own if it can make one, else a clone of a same-type unit. */
function mint(game, base, entry, freshId) {
  // The id is minted HERE and imposed on whatever comes back: a game's factory is
  // free to ignore the one it is offered, and two units sharing an id would break
  // everything downstream that addresses a unit by it.
  const id = freshId(entry.type);
  return { ...build(game, base, { ...entry, id }, entry.type), id, ownerId: entry.ownerId, type: entry.type, alive: true };
}

/**
 * One unit for `spec` ({ id, ownerId, type, position }): the game's own factory's,
 * else a copy of a live `templateType` unit already on the board — the owner's own
 * if it has one. `templateType` is the spec's type for a unit of the game's own,
 * and the chassis for one from another game (whose spec names the foreign type the
 * game's table now knows, which no unit on the board is yet).
 */
function build(game, base, spec, templateType) {
  const made = game.createSetupUnit?.(base, spec);
  if (made) return { ...made, id: spec.id, ownerId: spec.ownerId, alive: true };
  const live = (base.units ?? []).filter(u => u && u.alive !== false && u.type === templateType && !originOf(u));
  const template = live.find(u => u.ownerId === spec.ownerId) ?? live[0];
  if (!template) throw new Error(`startingUnits: no way to build a "${spec.type}" for ${spec.ownerId}`);
  return { ...structuredClone(template), id: spec.id, ownerId: spec.ownerId, alive: true };
}

/** `unit` standing at `position` — keeping whatever else its own position carried. */
function place(unit, position) {
  if (position == null) return { ...unit };
  const merged = (position && typeof position === 'object' && unit.position && typeof unit.position === 'object')
    ? { ...unit.position, ...position }
    : position;
  return { ...unit, position: merged };
}

// ---------------------------------------------------------------------------
// Positions ⇄ board cells
// ---------------------------------------------------------------------------

/**
 * How this game's unit positions relate to the [col,row] cells of its `toGrid`
 * board, worked out from the positions it actually opens with:
 *
 *   • a `gridToSquare(col,row)` hook (chess's algebraic 'e4') — the grid is
 *     enumerated once to invert it. Only while the units actually stand on
 *     squares: the same game in continuous space (chess's sliding bodies) keeps
 *     points, and those are mapped as the next case;
 *   • {x,y} or {col,row} — used directly, keeping numbers or numeric strings
 *     as the game writes them, so a placed unit's position is the same SHAPE
 *     the game's own rules compare against. Where any unit stands BETWEEN cells
 *     (continuous space) the convention is games/spacetime.js's: a point is in
 *     the cell it floors to, and a unit put on a cell stands at its centre;
 *   • anything else (a card, a territory, no position at all) — `placeable` is
 *     false: the roster can still be edited, only not dragged around a board.
 *
 * `grid` is the game's toGrid(state) output (or just { width, height }).
 */
export function cellMapper(game, state, grid = null) {
  const live = (state?.units ?? []).filter(u => u && u.alive !== false && u.position != null);
  const sample = live[0]?.position;
  const atPoints = !!sample && typeof sample === 'object';

  if (typeof game?.gridToSquare === 'function' && grid?.width && grid?.height && !atPoints) {
    const cells = new Map();
    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        const sq = game.gridToSquare(col, row);
        if (sq != null) cells.set(String(sq), [col, row]);
      }
    }
    return {
      placeable: true,
      toCell: (pos) => cells.get(String(pos)) ?? null,
      fromCell: (col, row) => game.gridToSquare(col, row) ?? null,
    };
  }

  const axes = sample && typeof sample === 'object'
    ? (sample.x != null && sample.y != null ? ['x', 'y'] : (sample.col != null && sample.row != null ? ['col', 'row'] : null))
    : null;
  if (!axes) return { placeable: false, toCell: () => null, fromCell: () => null };

  const [ax, ay] = axes;
  // Games that carry coordinates as strings ("61") keep getting strings.
  const asString = typeof sample[ax] === 'string';
  const continuous = live.some(u => {
    const p = u.position;
    return p && typeof p === 'object' && [p[ax], p[ay]].some(v => !Number.isInteger(Number(v)));
  });
  const num = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return continuous ? Math.floor(n) : Math.round(n);
  };
  const out = (v) => (asString ? String(v) : v);
  return {
    placeable: true,
    toCell: (pos) => {
      if (!pos || typeof pos !== 'object') return null;
      const col = num(pos[ax]); const row = num(pos[ay]);
      return col == null || row == null ? null : [col, row];
    },
    fromCell: (col, row) => (continuous
      ? { [ax]: out(col + 0.5), [ay]: out(row + 0.5) }
      : { [ax]: out(col), [ay]: out(row) }),
  };
}

/**
 * Everything a setup screen needs to edit the opening roster of `game`:
 * the board it is laid out on, the roster itself annotated with board cells,
 * and the unit types that may be added.
 *
 * `config` is echoed back RESOLVED — a game that would otherwise roll something
 * random per call (civ1's map seed) pins it here, so the session that is finally
 * created lays the customised units out on the very board they were placed on.
 */
export function setupPreview(game, players, config = {}) {
  const resolved = game.resolveSetupConfig ? game.resolveSetupConfig(config) : config;
  const base = game.createInitialState(players, resolved);
  return describeSetup(game, base, { config: resolved });
}

/**
 * What the setup editor draws for any position `base` — an opening (setupPreview),
 * or a game in progress laid out under settings being edited
 * (engine/reconfigure.js livePreview). `extraTypes` are unit types a roster may
 * name beyond the ones `base` has units of — the new settings' opening types, for
 * a game whose last knight has been taken.
 */
export function describeSetup(game, base, { config = {}, extraTypes = [] } = {}) {
  const resolved = config;
  let grid = null;
  try { grid = game.toGrid ? game.toGrid(base) : null; } catch { grid = null; }
  const map = cellMapper(game, base, grid);
  grid = dressGrid(game, base, grid, map.toCell);
  // A game's renderer says where a unit's art is in one of three ways: a cell that
  // names it, an entry in a positioned `units` list, or simply the cell it stands
  // on (glyph + owner, no id). All three are read, in that order of precision.
  const cellById = new Map();
  const cellByXY = new Map();
  for (const c of grid?.cells ?? []) {
    if (c.unitId) cellById.set(c.unitId, c);
    if (c.x != null && c.y != null) cellByXY.set(`${c.x},${c.y}`, c);
  }
  for (const u of grid?.units ?? []) if (u.id) cellById.set(u.id, u);

  const roster = rosterFromState(base).map((entry) => {
    const at = map.toCell(entry.position);
    const cell = cellById.get(entry.id) ?? (at ? cellByXY.get(`${at[0]},${at[1]}`) : null);
    return {
      ...entry,
      cell: at,
      // What this unit looks like, straight out of the game's own renderer, so the
      // editor can draw a real token without knowing anything about the game.
      imagePath: cell?.portraitPath ?? cell?.imagePath ?? null,
      glyph: cell?.glyph ?? null,
      label: cell?.unitName ?? entry.type,
    };
  });

  return {
    config: resolved,
    placeable: map.placeable,
    unitTypes: [...new Set([...setupUnitTypes(game, base), ...extraTypes])],
    // Units of the other games this one can take in, grouped by game, each with
    // the chassis it would play as here and its stats converted to this game's
    // numbers (engine/foreignUnits.js). Empty for a game that takes none.
    foreign: foreignCatalog(game, base),
    roster,
    // Only the board's shape, its colours — the editor draws its own tokens from
    // the roster, so the (potentially large) per-cell payload stays lean — and the
    // POSITION each cell stands for. That last field is what lets the editor put a
    // unit on an empty square: without it, a client would have to guess how this
    // game names a square it has never seen a unit on, which for a game like chess
    // ('e4', not {x,y}) it simply cannot do.
    board: grid ? {
      width: grid.width ?? 0,
      height: grid.height ?? 0,
      cells: (grid.cells ?? []).map(c => ({
        x: c.x, y: c.y, color: c.color ?? null,
        bgImage: typeof c.bgImage === 'string' ? c.bgImage : (c.bgImage?.image ?? null),
        pos: map.placeable ? map.fromCell(c.x, c.y) : null,
      })),
    } : null,
  };
}
