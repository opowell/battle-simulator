// 12 wide × 10 tall tactical map
// # = wall (impassable rock), . = grass (h0), 1 = elevated (h1), 2 = high ground (h2)
// P1 deploys top-left (x1-4, y1-2), P2 deploys bottom-right (x7-10, y6-8) — kept flat.
//
// A terraced central massif (h1 dirt slopes rising to an h2 rock crown) is the contested
// high ground — attacking downhill from it grants +20%/level damage (see FFTAGame combat).
// Two rock outcrops (#) pinch the approaches into flanking lanes, and the layout is 180°
// rotationally symmetric so neither deploy corner has the terrain advantage. The iso
// renderer draws the elevation as real cliffs, so the ridge reads as a mountain pass.
const MAP_TEMPLATE = [
  '############',
  '#....2.....#',
  '#...1211.#.#',
  '#..12#21...#',
  '#.1.222.11.#',
  '#.11.222.1.#',
  '#...12#21..#',
  '#.#.1121...#',
  '#.....2....#',
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
