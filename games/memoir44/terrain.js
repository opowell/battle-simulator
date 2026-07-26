// Terrain tiles and their combat / movement effects — a focused subset of the
// base game covering the terrain the bundled scenarios use.
//
// Effect fields:
//   battleReduce   {infantry, armor}   dice removed when a unit of that type
//                                      BATTLES OUT of this hex (cover). Artillery
//                                      ignores all terrain (units.js ignoresTerrain).
//   defReduce      {infantry, armor}   dice removed from an attack against a unit
//                                      standing on this hex (protection). Most base
//                                      terrain uses defReduce; sandbags use it too.
//   moveStop       boolean             a unit entering must stop (ends movement) and
//                                      may not battle this turn if it just moved in.
//   blocksLOS      boolean             blocks line of sight through the hex (units
//                                      on it are still visible; the hex behind is not).
//   impassable     'all' | 'vehicle'   nobody / no armor may enter.
//   isBaseline     used only for board edges (not a real tile).

export const TERRAIN = {
  grass:     { name: 'Open ground', color: '#8fae5d' },
  forest:    { name: 'Forest',      color: '#2f6b34', defReduce: { infantry: 1, armor: 2 }, moveStop: true, blocksLOS: true },
  hedgerow:  { name: 'Hedgerow',    color: '#4f7a3a', defReduce: { infantry: 1, armor: 1 }, moveStop: true, blocksLOS: true },
  town:      { name: 'Town',        color: '#a8a29a', defReduce: { infantry: 1, armor: 2 }, moveStop: true, blocksLOS: true },
  hill:      { name: 'Hill',        color: '#b08d57', defReduce: { infantry: 1, armor: 1 }, moveStop: true, blocksLOS: true },
  sandbags:  { name: 'Sandbags',    color: '#c9b979', defReduce: { infantry: 1, armor: 1 } },
  river:     { name: 'River',       color: '#3d78c4', impassable: 'all' },
  bridge:    { name: 'Bridge',      color: '#9c6b3f' },
  beach:     { name: 'Beach',       color: '#e2d4a0' },
  ocean:     { name: 'Ocean',       color: '#245b9c', impassable: 'all' },
};

export function terrainAt(board, col, row) {
  return board.terrain?.[`${col},${row}`] ?? 'grass';
}

export function terrainInfo(type) {
  return TERRAIN[type] ?? TERRAIN.grass;
}

// Dice removed from an attack against a defender standing on `type`.
export function defenseReduction(type, unitType) {
  if (unitType === 'artillery') return 0; // handled by caller, but be safe
  const t = TERRAIN[type];
  return t?.defReduce?.[unitType] ?? 0;
}

// Can a unit of `unitType` enter a hex of `type`?
export function passable(type, unitType) {
  const t = TERRAIN[type];
  if (!t?.impassable) return true;
  if (t.impassable === 'all') return type === 'bridge' ? true : false;
  if (t.impassable === 'vehicle') return unitType !== 'armor';
  return true;
}

export function blocksLOS(type) {
  return !!TERRAIN[type]?.blocksLOS;
}

export function mustStopOn(type) {
  return !!TERRAIN[type]?.moveStop;
}
