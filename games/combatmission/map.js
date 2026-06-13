export const TERRAIN = {
  FLOOR:  '.',
  WALL:   '#',  // building / border — impassable, blocks LOS
  HEDGE:  'w',  // wall/hedge — passable, cover, transparent
  TREE:   'T',  // trees — passable, blocks LOS, light cover
  ROAD:   'r',  // road — passable
};

export const MAP_WIDTH  = 20;
export const MAP_HEIGHT = 16;

export function createMap() {
  const tiles = Array.from({ length: MAP_HEIGHT }, (_, y) =>
    Array.from({ length: MAP_WIDTH }, (_, x) =>
      (x === 0 || x === MAP_WIDTH - 1 || y === 0 || y === MAP_HEIGHT - 1)
        ? TERRAIN.WALL : TERRAIN.FLOOR
    )
  );

  const set = (x, y, t) => {
    if (x > 0 && x < MAP_WIDTH - 1 && y > 0 && y < MAP_HEIGHT - 1) tiles[y][x] = t;
  };

  // Village building (Allied side): x=3..6, y=3..5
  for (let y = 3; y <= 5; y++) for (let x = 3; x <= 6; x++) set(x, y, TERRAIN.WALL);

  // Farmhouse (Axis side): x=13..16, y=10..12
  for (let y = 10; y <= 12; y++) for (let x = 13; x <= 16; x++) set(x, y, TERRAIN.WALL);

  // Treeline (Allied side, central)
  for (const [x, y] of [[8,2],[9,2],[10,2],[11,2],[9,3],[10,3]]) set(x, y, TERRAIN.TREE);

  // Treeline (Axis side, central)
  for (const [x, y] of [[8,12],[9,12],[10,12],[11,12],[9,13],[10,13]]) set(x, y, TERRAIN.TREE);

  // Hedgerows (scattered, none on road row y=7)
  for (const [x, y] of [[2,5],[2,6],[17,5],[17,6],[7,9],[7,10],[2,9],[2,10]])
    set(x, y, TERRAIN.HEDGE);

  // Road (horizontal, y=7)
  for (let x = 1; x <= 18; x++) set(x, 7, TERRAIN.ROAD);

  return { width: MAP_WIDTH, height: MAP_HEIGHT, tiles };
}

export function getTile(board, x, y) {
  if (x < 0 || x >= board.width || y < 0 || y >= board.height) return TERRAIN.WALL;
  return board.tiles[y][x];
}

export function isPassable(board, x, y) {
  return getTile(board, x, y) !== TERRAIN.WALL;
}

export function blocksLOS(tile) {
  return tile === TERRAIN.WALL || tile === TERRAIN.TREE;
}

// Returns defense bonus % subtracted from attacker's hit chance
export function getCoverBonus(board, x, y) {
  const t = getTile(board, x, y);
  if (t === TERRAIN.HEDGE) return 30;
  if (t === TERRAIN.TREE)  return 20;
  return 0;
}

export function renderMap(board, units) {
  const posMap = {};
  for (const u of units) {
    if (u.alive) posMap[`${u.position.x},${u.position.y}`] = u;
  }
  const rows = [];
  for (let y = 0; y < board.height; y++) {
    let row = `${String(y).padStart(2)} `;
    for (let x = 0; x < board.width; x++) {
      const u = posMap[`${x},${y}`];
      row += u ? u.attrs.symbol : board.tiles[y][x];
    }
    rows.push(row);
  }
  rows.push('    ' + Array.from({ length: board.width }, (_, i) => i % 10).join(''));
  return rows.join('\n');
}
