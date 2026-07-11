export const TERRAIN = {
  OPEN:    '.',
  WIRE:    '~',
  CRATER:  'o',
  SANDBAG: 's',
  TRENCH:  'T',
  BASE:    '#',
};

// 20 wide × 10 tall — a WWI no-man's-land assault.
// . = open mud, ~ = barbed wire (2 AP to enter), o = shell crater (+20 cover),
// s = sandbags (+35 cover), T = trench (+50 cover), # = Allied base (impassable).
// y=0: German spawn (top) · y=8: Allied trench — Axis wins on reaching it · y=9: base.
//
// The middle is now a real killing field: forward MG nests, a broken belt of barbed wire
// with three breach lanes (the Axis must funnel through them), a dense crater field for
// bounding cover, and a sandbag line with gaps just short of the trench. Allied units
// deploy on the sandbags/trench (y7-8), so those rows stay passable cover.
const MAP_TEMPLATE = [
  '....................',  // y=0 German spawn
  '...o.......o.....o..',  // y=1 shell craters
  '.....ss......ss.....',  // y=2 forward MG nests
  '~~~...~~~~~...~~~..~',  // y=3 barbed wire — 3 breach lanes
  '..o...o...o...o...o.',  // y=4 cratered mud
  '.oo..oo..oo..oo..oo.',  // y=5 crater field
  'o..soo..soo..soo..o.',  // y=6 craters + sandbag nests
  'ssss..ssssss..sssss.',  // y=7 sandbag line (gaps)
  'TTTTTTTTTTTTTTTTTTTT',  // y=8 Allied trench (win condition)
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
