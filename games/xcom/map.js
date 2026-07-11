export const TERRAIN = {
  FLOOR: '.',
  WALL: '#',
  LOW_COVER: 'c',
  HIGH_COVER: 'C',
};

// 14 wide × 12 tall urban raid map. # = wall, . = floor, c = low cover (+20 def),
// C = high cover (+40 def). XCOM deploys top-left (x1-2, y1-2), Aliens bottom-right
// (x11-12, y9-10) — both corners kept clear.
//
// A gutted central building (roof-capped walls, open to the south) anchors the map and
// splits it into a west and an east approach; low/high cover is layered around it and
// along the flanks so every advance has a piece of cover to break for. Every floor tile
// stays reachable and both deploy corners are kept clear.
const MAP_TEMPLATE = [
  '##############',
  '#............#',
  '#..c..CC..c..#',
  '#....####....#',
  '#.C..#..#..C.#',
  '#..c.#..#.c..#',
  '#....#..#....#',
  '#.cc.#..#.cc.#',
  '#....#..#..C.#',
  '#..c......c..#',
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
