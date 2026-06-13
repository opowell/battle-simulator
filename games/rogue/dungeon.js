export const MAP_W = 70;
export const MAP_H = 22;

const COLS = 3;
const ROWS = 3;
const SEC_W = Math.floor(MAP_W / COLS);  // 23
const SEC_H = Math.floor(MAP_H / ROWS);  // 7

function ri(a, b, rng) {
  return a + Math.floor(rng() * (b - a + 1));
}

export function generateFloor(rng) {
  const tiles = {};
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++)
      tiles[`${x},${y}`] = '#';

  const rooms = [];

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const sx = col * SEC_W + 1;
      const sy = row * SEC_H + 1;
      const maxW = SEC_W - 2;
      const maxH = SEC_H - 2;
      const rw = ri(4, Math.min(10, maxW), rng);
      const rh = ri(3, Math.min(5, maxH), rng);
      const rx = sx + ri(0, Math.max(0, maxW - rw), rng);
      const ry = sy + ri(0, Math.max(0, maxH - rh), rng);
      const room = { x: rx, y: ry, w: rw, h: rh };
      rooms.push(room);
      for (let y = ry; y < ry + rh; y++)
        for (let x = rx; x < rx + rw; x++)
          tiles[`${x},${y}`] = '.';
    }
  }

  // Horizontal corridors: connect col N to col N+1 in each row
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS - 1; col++) {
      const a = rooms[row * COLS + col];
      const b = rooms[row * COLS + col + 1];
      const ax = a.x + Math.floor(a.w / 2);
      const ay = a.y + Math.floor(a.h / 2);
      const bx = b.x + Math.floor(b.w / 2);
      const by = b.y + Math.floor(b.h / 2);
      for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) tiles[`${x},${ay}`] = '.';
      for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) tiles[`${bx},${y}`] = '.';
    }
  }

  // Vertical corridors: connect row N to row N+1 in each column
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS - 1; row++) {
      const a = rooms[row * COLS + col];
      const b = rooms[(row + 1) * COLS + col];
      const ax = a.x + Math.floor(a.w / 2);
      const ay = a.y + Math.floor(a.h / 2);
      const bx = b.x + Math.floor(b.w / 2);
      const by = b.y + Math.floor(b.h / 2);
      for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) tiles[`${ax},${y}`] = '.';
      for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) tiles[`${x},${by}`] = '.';
    }
  }

  // Hero starts top-left of room 0; stairs down in a far room (4-8)
  const heroPos   = { x: rooms[0].x + 1, y: rooms[0].y + 1 };
  const downRoom  = rooms[ri(4, 8, rng)];
  const stairsDown = {
    x: downRoom.x + Math.floor(downRoom.w / 2),
    y: downRoom.y + Math.floor(downRoom.h / 2),
  };

  return { tiles, rooms, heroPos, stairsDown };
}
