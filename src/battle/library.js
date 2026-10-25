// ---------------------------------------------------------------------------
// library.js (battle) — the library's maps, as battles: each map a game left in
// library/<game>/maps/ is a spec a BattleGame can play, with the units of every
// game in the library on it. src/server/library.js hands the packs over at
// startup (registerMaps); the engine itself reads no files.
// ---------------------------------------------------------------------------

const maps = new Map();   // 'game/map' → { game, id, name, description, terrain, board, starts, features, title }

/** Make the library's maps known: { game: { title, terrain, maps: { id: map } } }. */
export function registerMaps(packs) {
  maps.clear();
  for (const [game, p] of Object.entries(packs ?? {})) {
    for (const [id, m] of Object.entries(p.maps ?? {})) maps.set(`${game}/${id}`, { ...m, game, id, title: p.title ?? game, terrain: p.terrain ?? {}, scale: p.scale ?? null });
  }
}

/** Every library map, as [key ('civ1/earth'), map]. */
export const libraryMaps = () => [...maps.entries()];

// The rules a map may bring of its own, beyond its board: a game the core can
// play outright (chess's pieces and check) says so here, in the spec's own terms.
const RULE_KEYS = ['unitTypes', 'attributes', 'abilities', 'strike', 'formulas', 'turn', 'forward', 'orientation', 'display'];

/**
 * The spec a library map is played as: its board, its terrain, and the units it
 * opens with — its own game's, from the library, unless the map brings its own
 * unit types (then those are its units, and play by its rules). Distances are
 * its game's: `scale` is how far one of that game's cells reaches, so every
 * library unit's range and move convert into this map's cells.
 */
export function librarySpec(id) {
  const key = String(id).replace(/^library:/, '');
  const m = maps.get(key);
  if (!m) return null;
  return {
    id: `library:${key}`,
    name: `${m.title}: ${m.name ?? m.id}`,
    description: m.description ?? '',
    terrain: m.terrain,
    board: m.board,
    ...(m.scale ? { scale: { range: m.scale.range, move: m.scale.move } } : {}),
    ...(m.features ? { features: m.features } : {}),
    ...(m.units ? { units: m.units.map(u => (m.unitTypes?.[u.type] ? u : { game: m.game, ...u })) } : {}),
    ...(m.armies ? { armies: m.armies } : {}),
    ...(m.victory ? { victory: m.victory } : {}),
    ...(m.modes ? { modes: m.modes } : {}),
    ...Object.fromEntries(RULE_KEYS.filter(k => m[k] != null).map(k => [k, m[k]])),
  };
}

/** A scenario for every library map. */
export function libraryScenarios() {
  return [...maps.entries()].map(([key, m]) => ({
    id: `library:${key}`,
    name: `${m.title}: ${m.name ?? m.id}`,
    description: m.description ?? `${m.title}'s map, any units`,
    group: 'Library maps',
    config: { spec: `library:${key}`, ...(m.modes ?? {}) },
    // How it is shown, so a setup form can say so before it starts (display.js).
    ...(m.display ? { display: m.display } : {}),
  }));
}
