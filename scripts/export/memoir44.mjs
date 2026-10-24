// Memoir '44's terrain and scenario boards in the core's board format
// (scripts/export-pack.mjs). Hexes in the same odd-row-shifted offset layout the
// game uses. Its terrain effects are dice removed from an attack; the core reads
// that as cover, one die as +50%.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export default async function exportBoards(dir) {
  const { TERRAIN } = await import(pathToFileURL(path.join(dir, 'terrain.js')).href);
  const { SCENARIOS } = await import(pathToFileURL(path.join(dir, 'scenarios.js')).href);
  const { BOARD_COLS, BOARD_ROWS } = await import(pathToFileURL(path.join(dir, 'hex.js')).href);
  const terrain = {};
  for (const [id, t] of Object.entries(TERRAIN)) {
    const blocked = t.impassable === 'all';
    terrain[id] = {
      name: t.name, color: t.color, description: '',
      cost: blocked ? { land: Infinity, sea: 1, air: 1 } : { land: t.moveStop ? 2 : t.enterMax ? 2 : 1, air: 1 },
      passable: blocked ? { land: false, sea: true, air: true } : { land: true, sea: false, air: true },
      cover: (t.def?.infantry ?? 0) * 50,
      blocksSight: !!t.blocksLOS,
      ...(t.lowerOnly ? { elevation: 1 } : {}),
    };
  }
  const maps = {};
  for (const sc of SCENARIOS) {
    maps[sc.id] = {
      name: sc.name,
      description: sc.description,
      board: { topology: 'hex', width: BOARD_COLS, height: BOARD_ROWS, terrain: Object.fromEntries(Object.entries(sc.terrain).filter(([, k]) => k !== 'grass')) },
      units: sc.units.map(u => ({ type: u.type, seat: u.player, at: [u.col, u.row] })),
      features: (sc.objectives ?? []).map(o => ({ kind: 'objective', at: [o.col, o.row] })),
    };
  }
  return {
    terrain: { ...terrain, open: { ...terrain.grass } },
    maps,
    omitted: [
      'command cards, medals and dice: the core has none',
      'must-stop terrain (forest, hedgerow, town) is read as costing double; a beach\'s two-hex cap likewise',
      'a bunker only infantry may enter: any land unit may here',
      'a hill only shelters from lower ground: read as one level of elevation',
    ],
  };
}
