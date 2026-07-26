// Terrain tiles and their combat / movement effects, per the base-game terrain
// reference (Memoir '44 v4.2, sheet 3). Effects modeled:
//
//   def          {infantry, armor}  battle dice removed from an attack against a
//                                   unit standing on this hex. Artillery ignores
//                                   all terrain reductions (units.js ignoresTerrain).
//   moveStop     boolean            a unit entering must stop; it may not battle
//                                   the turn it enters ("no battle on entry"), for
//                                   every unit type — but it may still Take Ground.
//   blocksLOS    boolean            blocks line of sight drawn through the hex.
//   impassable   'all' | 'infantry' nobody may enter / only infantry may enter.
//   ignoreFlag   boolean            the defender may ignore the first flag rolled.
//   lowerOnly    boolean            (hills) the dice reduction only applies when the
//                                   attacker is on lower ground — i.e. not itself on
//                                   a hill hex of the same feature.
//   enterMax     number             caps total movement when entering this hex
//                                   (beaches: 2).

export const TERRAIN = {
  grass:    { name: 'Open ground', color: '#8fae5d' },
  forest:   { name: 'Forest',      color: '#2f6b34', def: { infantry: 1, armor: 2 }, moveStop: true, blocksLOS: true },
  hedgerow: { name: 'Hedgerow',    color: '#4f7a3a', def: { infantry: 1, armor: 2 }, moveStop: true, blocksLOS: true },
  town:     { name: 'Town',        color: '#a8a29a', def: { infantry: 1, armor: 2 }, moveStop: true, blocksLOS: true },
  hill:     { name: 'Hill',        color: '#b08d57', def: { infantry: 1, armor: 1 }, blocksLOS: true, lowerOnly: true },
  sandbags: { name: 'Sandbags',    color: '#c9b979', def: { infantry: 1, armor: 1 }, ignoreFlag: true },
  bunker:   { name: 'Bunker',      color: '#7a7268', def: { infantry: 1, armor: 2 }, impassable: 'infantry', ignoreFlag: true },
  river:    { name: 'River',       color: '#3d78c4', impassable: 'all' },
  bridge:   { name: 'Bridge',      color: '#9c6b3f' },
  beach:    { name: 'Beach',       color: '#e2d4a0', enterMax: 2 },
  ocean:    { name: 'Ocean',       color: '#245b9c', impassable: 'all' },
};

export function terrainAt(board, col, row) {
  return board.terrain?.[`${col},${row}`] ?? 'grass';
}

export function terrainInfo(type) {
  return TERRAIN[type] ?? TERRAIN.grass;
}

// Dice removed from an attack against a defender of `unitType` standing on `type`.
// `attackerElevated` cancels a hill's protection (attacker on higher/equal ground).
export function defenseReduction(type, unitType, attackerElevated = false) {
  const t = TERRAIN[type];
  if (!t?.def) return 0;
  if (t.lowerOnly && attackerElevated) return 0;
  return t.def[unitType] ?? 0;
}

export function ignoresFirstFlag(type) {
  return !!TERRAIN[type]?.ignoreFlag;
}

// Can a unit of `unitType` enter a hex of `type`?
export function passable(type, unitType) {
  const t = TERRAIN[type];
  if (!t?.impassable) return true;
  if (t.impassable === 'infantry') return unitType === 'infantry';
  return false; // 'all'
}

export function blocksLOS(type) {
  return !!TERRAIN[type]?.blocksLOS;
}

export function mustStopOn(type) {
  return !!TERRAIN[type]?.moveStop;
}

export function enterMax(type) {
  return TERRAIN[type]?.enterMax ?? Infinity;
}

export function isHill(type) {
  return !!TERRAIN[type]?.lowerOnly;
}
