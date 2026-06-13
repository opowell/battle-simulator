export const TERRAIN = {
  FLOOR: '.',
  WALL: '#',
  LOW_COVER: 'c',
  HIGH_COVER: 'C',
};

// 14 wide × 12 tall
// Two horizontal interior walls (rows 4 and 7) each with two corridors (x=3,4 and x=9,10)
// XCOM deploys top-left, Aliens deploy bottom-right
const MAP_TEMPLATE = [
  '##############',
  '#............#',
  '#...c....c...#',
  '#............#',
  '###..####..###',
  '#............#',
  '#...CC..CC...#',
  '###..####..###',
  '#............#',
  '#...c....c...#',
  '#............#',
  '##############',
];

export const MAP_WIDTH  = 14;
export const MAP_HEIGHT = 12;

export function createMap() {
  return { width: MAP_WIDTH, height: MAP_HEIGHT, tiles: MAP_TEMPLATE.map(r => r.split('')) };
}

export function getTile(board, x, y) {
  if (x < 0 || x >= board.width || y < 0 || y >= board.height) return TERRAIN.WALL;
  return board.tiles[y][x];
}

export function isPassable(board, x, y) {
  return getTile(board, x, y) !== TERRAIN.WALL;
}

export function getCoverDefense(board, x, y) {
  const t = getTile(board, x, y);
  if (t === TERRAIN.LOW_COVER)  return 20;
  if (t === TERRAIN.HIGH_COVER) return 40;
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
