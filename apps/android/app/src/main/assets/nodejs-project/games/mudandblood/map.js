export const TERRAIN = {
  OPEN:    '.',
  WIRE:    '~',
  CRATER:  'o',
  SANDBAG: 's',
  TRENCH:  'T',
  BASE:    '#',
};

// 20 wide × 10 tall
// y=0: German spawn zone (top)
// y=8: Allied trench — if Germans reach here, Axis wins
// y=9: Allied base (impassable)
const MAP_TEMPLATE = [
  '....................',  // y=0 German spawn
  '....................',  // y=1 open
  '....................',  // y=2 open
  '~~~~~~~~~~~~~~~~~~~~',  // y=3 barbed wire (2 AP to enter)
  '....................',  // y=4 no-man's land
  '.oo..oo..oo..oo..oo.',  // y=5 craters (low cover)
  'o...oo...oo...oo....',  // y=6 craters (low cover)
  'ssssssssssssssssssss',  // y=7 sandbags (high cover)
  'TTTTTTTTTTTTTTTTTTTT',  // y=8 Allied trench (max cover / win condition)
  '####################',  // y=9 Allied base (impassable)
];

export const MAP_WIDTH  = 20;
export const MAP_HEIGHT = 10;

export function createMap() {
  return { width: MAP_WIDTH, height: MAP_HEIGHT, tiles: MAP_TEMPLATE.map(r => r.split('')) };
}

export function getTile(board, x, y) {
  if (x < 0 || x >= board.width || y < 0 || y >= board.height) return TERRAIN.BASE;
  return board.tiles[y][x];
}

export function isPassable(board, x, y) {
  return getTile(board, x, y) !== TERRAIN.BASE;
}

export function moveCost(board, x, y) {
  return getTile(board, x, y) === TERRAIN.WIRE ? 2 : 1;
}

export function getCoverDefense(board, x, y) {
  const t = getTile(board, x, y);
  if (t === TERRAIN.TRENCH)  return 50;
  if (t === TERRAIN.SANDBAG) return 35;
  if (t === TERRAIN.CRATER)  return 20;
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
