/**
 * reconfigure.js — changing a game's settings while it is being played, for
 * every game, without any game knowing.
 *
 * A setting reaches a game in one of three ways, and each needs something
 * different done to a game in progress:
 *
 *   • the engine reads it on every step (simultaneous turns, fog filtering) —
 *     the config changes, and nothing else needs to;
 *   • the game COPIED it into its state when it was created (chess keeps
 *     `fogOfWar`, `difficulty`, `aiTimeMs` in gameSpecific) — those fields are
 *     patched into the live position, and everything else stands;
 *   • it decides what the world IS (a different space or time model, a map, a
 *     board size) — the position is rebuilt under the new settings, with every
 *     unit carried over to where it stands now.
 *
 * Which of the three a change is gets worked out the only way that needs no
 * game's cooperation: build the game's opening twice, under settings that differ
 * in nothing but the change, and see what differs. Only gameSpecific → a patch of
 * exactly those fields. Anything else (units, board, …) → a rebuild. Nothing →
 * the engine's alone. Anything that differs between two builds under the SAME
 * settings is the game's own randomness, not the setting, and is left out.
 *
 * A rebuild carries units across by board cell (startingSetup.js cellMapper), so
 * a knight on e4 of a discrete board lands at the centre of e4 on a continuous
 * one and back again; then they are laid out exactly as a customised opening is
 * (applyRoster), and the turn — whose move it is, which turn it is, and each
 * unit's remaining hit points — carries over too. What does not carry is
 * whatever a game keeps outside its units (castling rights, a civ's cities and
 * research): a rebuilt position starts that from the new settings' defaults.
 */

import { applyRoster, cellMapper, describeSetup, rosterError, rosterFromState, setupUnitTypes, SETUP_KEY } from './startingSetup.js';

/** The keys whose values differ between two configs, ignoring the roster. */
export function changedKeys(from = {}, to = {}) {
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  keys.delete(SETUP_KEY);
  return [...keys].filter(k => JSON.stringify(from[k] ?? null) !== JSON.stringify(to[k] ?? null));
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Top-level keys of two states that differ, gameSpecific aside, and the gameSpecific keys that do. */
function stateDiff(a, b) {
  const top = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  top.delete('gameSpecific');
  // The seats are the session's, not a setting's — and are rebuilt per call.
  top.delete('players');
  const gsKeys = new Set([...Object.keys(a?.gameSpecific ?? {}), ...Object.keys(b?.gameSpecific ?? {})]);
  return {
    world: [...top].filter(k => !same(a?.[k], b?.[k])),
    gameSpecific: [...gsKeys].filter(k => !same(a?.gameSpecific?.[k], b?.gameSpecific?.[k])),
  };
}

function withoutRoster(config) {
  const { [SETUP_KEY]: _roster, ...rest } = config ?? {};
  return rest;
}

/**
 * What changing `from` → `to` takes on a game in progress.
 *
 * @returns {{ kind: 'none'|'engine'|'patch'|'rebuild', keys: string[], gameSpecific?: object, world?: string[] }}
 *   `none` — nothing changed; `engine` — only the config moves; `patch` — set
 *   `gameSpecific` into the live state; `rebuild` — the world itself changed
 *   (`world` names the parts of the state that did).
 */
export function planReconfigure(game, players, from = {}, to = {}) {
  const keys = changedKeys(from, to);
  if (!keys.length) return { kind: 'none', keys };

  // Settings a game would otherwise roll fresh per call (civ1's map seed) are
  // pinned ONCE and shared by every build below, so a fog switch is not mistaken
  // for a new map.
  const base = withoutRoster(from);
  const resolved = game.resolveSetupConfig ? game.resolveSetupConfig({ ...base }) : base;
  const pins = Object.fromEntries(Object.entries(resolved).filter(([k]) => !(k in base)));
  const before = { ...resolved };
  const after = { ...pins, ...withoutRoster(to) };

  const seats = () => players.map(p => ({ id: p.id, name: p.name ?? p.id }));
  const a = game.createInitialState(seats(), before);
  const a2 = game.createInitialState(seats(), before);
  const b = game.createInitialState(seats(), after);

  const noise = stateDiff(a, a2);
  const diff = stateDiff(a, b);
  const world = diff.world.filter(k => !noise.world.includes(k));
  const gs = diff.gameSpecific.filter(k => !noise.gameSpecific.includes(k));

  if (world.length) return { kind: 'rebuild', keys, world };
  if (gs.length) return { kind: 'patch', keys, gameSpecific: Object.fromEntries(gs.map(k => [k, b.gameSpecific[k]])) };
  return { kind: 'engine', keys };
}

/**
 * Where every live unit of `state` stands on the board `config` would build: the
 * same cell, in that board's own kind of position. A game whose units are not on
 * a board at all keeps each position as it is.
 */
export function carriedRoster(game, state, players, config) {
  const target = game.createInitialState(players.map(p => ({ id: p.id, name: p.name ?? p.id })), withoutRoster(config));
  const gridOf = (s) => { try { return game.toGrid ? game.toGrid(s) : null; } catch { return null; } };
  const from = cellMapper(game, state, gridOf(state));
  const to = cellMapper(game, target, gridOf(target));
  return rosterFromState(state).map((entry) => {
    if (!from.placeable || !to.placeable) return entry;
    const cell = from.toCell(entry.position);
    const position = cell ? to.fromCell(cell[0], cell[1]) : null;
    return position == null ? entry : { ...entry, position };
  });
}

/**
 * The units of a game in progress put as `roster` says — added, removed, moved —
 * with everything else about the game exactly as it stands: turn, cities,
 * research, explored map, castling rights already lost. For a units edit that
 * leaves the world's settings alone, where starting over from an opening would
 * throw all of that away (and, for a game that rolls its world, the world too).
 *
 * Throws with a reason when the roster cannot be built there.
 */
export function editedState(game, current, players, config, roster) {
  const seats = players.map(p => ({ id: p.id, name: p.name ?? p.id }));
  const problem = rosterError(game, current, roster, seats);
  if (problem) throw new Error(problem.replace(/^startingUnits/, 'units'));
  return applyRoster(game, current, roster, config, { midGame: true });
}

/**
 * The position a game in progress is rebuilt to under `config`: `roster` (the
 * units as they should stand — carriedRoster's, or one the player edited) laid
 * out on the new settings' opening, with the turn carried over from `current`.
 *
 * Throws with a reason when the roster cannot be built there.
 */
export function rebuiltState(game, current, players, config, roster) {
  const seats = players.map(p => ({ id: p.id, name: p.name ?? p.id }));
  const opening = game.createInitialState(seats, withoutRoster(config));
  const problem = rosterError(game, opening, roster, seats);
  if (problem) throw new Error(problem.replace(/^startingUnits/, 'units'));
  let next = applyRoster(game, opening, roster, config);

  // Hit points ride along with the unit they belong to — a roster entry and the
  // unit built from it share a place in the list.
  const hpById = new Map((current.units ?? []).filter(u => typeof u.hp === 'number').map(u => [u.id, u.hp]));
  if (next.units?.length === roster.length) {
    next = {
      ...next,
      units: next.units.map((u, i) => {
        const hp = roster[i].id != null ? hpById.get(roster[i].id) : undefined;
        return hp != null && typeof u.hp === 'number' ? { ...u, hp: Math.min(hp, u.maxHp ?? hp) } : u;
      }),
    };
  }

  // Whose move it is carries over where the turn is shaped the same way (one
  // seat to move, or the same number of them): a black-to-move game stays
  // black-to-move. A change that reshapes the turn itself (discrete → continuous
  // time, where every seat acts at once) takes the new model's own.
  const seatIds = new Set(seats.map(p => p.id));
  const active = (current.activePlayers ?? []).filter(id => seatIds.has(id));
  if (active.length && active.length === (next.activePlayers ?? []).length) next = { ...next, activePlayers: active };
  if (typeof current.turnNumber === 'number') next = { ...next, turnNumber: current.turnNumber };
  return next;
}

/**
 * What the in-game settings editor draws for the units: the game in progress as
 * it would stand under `to` — carried onto the new board if `to` changes the
 * world, as it is otherwise — in the same shape the setup screen's preview has
 * (startingSetup.js describeSetup), so one editor serves both.
 *
 * `config` comes back RESOLVED, as setupPreview's does: a world the new settings
 * would roll at random is pinned here, so the change applied is the one previewed.
 */
export function livePreview(game, current, players, from = {}, to = {}) {
  const seats = players.map(p => ({ id: p.id, name: p.name ?? p.id }));
  const plan = planReconfigure(game, players, from, to);
  let config = withoutRoster(to);
  let state = current;
  let carried = null;
  let pins = {};
  if (plan.kind === 'rebuild') {
    const asked = config;
    config = game.resolveSetupConfig ? game.resolveSetupConfig({ ...config }) : config;
    pins = Object.fromEntries(Object.entries(config).filter(([k]) => !(k in asked)));
    carried = carriedRoster(game, current, players, config);
    state = rebuiltState(game, current, players, config, carried);
  } else if (plan.kind === 'patch') {
    state = { ...current, gameSpecific: { ...current.gameSpecific, ...plan.gameSpecific } };
  }
  const opening = game.createInitialState(seats, config);
  const preview = describeSetup(game, state, { config, extraTypes: setupUnitTypes(game, opening) });
  // Units rebuilt onto a new world may come out under new ids (chess names its
  // pieces differently per board model). Each is handed out under the id of the
  // unit it was carried from instead — ids here are only handles for "this same
  // unit", and the game in progress is what they have to match: for fog, and for
  // the roster that comes back.
  if (carried && preview.roster.length === carried.length) {
    preview.roster = preview.roster.map((u, i) => ({ ...u, id: carried[i].id }));
  }
  // `pins` are the only settings the server CHOSE (a seed for a rolled world):
  // what the editor carries into the change so the world applied is the one shown.
  return { ...preview, rebuild: plan.kind === 'rebuild', pins };
}
