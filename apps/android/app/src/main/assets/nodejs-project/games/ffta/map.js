// 12 wide × 10 tall tactical map
// # = wall, . = grass (h0), 1 = elevated (h1), 2 = high ground (h2)
// P1 deploys top-left, P2 deploys bottom-right
const MAP_TEMPLATE = [
  '############',
  '#..11......#',
  '#..1.......#',
  '#..........#',
  '#....2.....#',
  '#.....2....#',
  '#.......1..#',
  '#.......11.#',
  '#..........#',
  '############',
];

export const MAP_WIDTH  = 12;
export const MAP_HEIGHT = 10;

function tileHeight(ch) {
  if (ch === '1') return 1;
  if (ch === '2') return 2;
  return 0;
}

export function createMap() {
  const tiles = {};
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const ch = MAP_TEMPLATE[y][x];
      tiles[`${x},${y}`] = {
        ch,
        passable: ch !== '#',
        height: tileHeight(ch),
      };
    }
  }
  return { width: MAP_WIDTH, height: MAP_HEIGHT, tiles };
}

export function getTile(board, x, y) {
  return board.tiles[`${x},${y}`] ?? { ch: '#', passable: false, height: 0 };
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
      if (u) {
        row += u.ownerId.includes('1') ? u.symbol.toUpperCase() : u.symbol.toLowerCase();
      } else {
        row += board.tiles[`${x},${y}`]?.ch ?? '#';
      }
    }
    rows.push(row);
  }
  rows.push('    ' + Array.from({ length: board.width }, (_, i) => i % 10).join(''));
  return rows.join('\n');
}
