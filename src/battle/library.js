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
    for (const [id, m] of Object.entries(p.maps ?? {})) maps.set(`${game}/${id}`, { ...m, game, id, title: p.title ?? game, terrain: p.terrain ?? {} });
  }
}

/** Every library map, as [key ('civ1/earth'), map]. */
export const libraryMaps = () => [...maps.entries()];

/** The spec a library map is played as: its board, its terrain, its starts. */
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
    ...(m.units ? { units: m.units } : {}),
    ...(m.armies ? { armies: m.armies } : {}),
    ...(m.victory ? { victory: m.victory } : {}),
    ...(m.modes ? { modes: m.modes } : {}),
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
  }));
}
