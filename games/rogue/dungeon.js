export const MAP_W = 70;
export const MAP_H = 22;

const COLS = 3;
const ROWS = 3;
const SEC_W = Math.floor(MAP_W / COLS);  // 23
const SEC_H = Math.floor(MAP_H / ROWS);  // 7

const TRAP_TYPES = ['bear','teleport','arrow','sleep','aggravate','dart','trapdoor'];

function ri(a, b, rng) {
  return a + Math.floor(rng() * (b - a + 1));
}

export function generateFloor(rng, dungeonLevel = 1) {
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

  // Horizontal corridors
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS - 1; col++) {
      const a = rooms[row * COLS + col];
      const b = rooms[row * COLS + col + 1];
      const ax = a.x + Math.floor(a.w / 2), ay = a.y + Math.floor(a.h / 2);
      const bx = b.x + Math.floor(b.w / 2), by = b.y + Math.floor(b.h / 2);
      for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) tiles[`${x},${ay}`] = '.';
      for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) tiles[`${bx},${y}`] = '.';
    }
  }

  // Vertical corridors
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS - 1; row++) {
      const a = rooms[row * COLS + col];
      const b = rooms[(row + 1) * COLS + col];
      const ax = a.x + Math.floor(a.w / 2), ay = a.y + Math.floor(a.h / 2);
      const bx = b.x + Math.floor(b.w / 2), by = b.y + Math.floor(b.h / 2);
      for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) tiles[`${ax},${y}`] = '.';
      for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) tiles[`${x},${by}`] = '.';
    }
  }

  // Hero starts top-left of room 0; stairs down in a far room
  const heroPos    = { x: rooms[0].x + 1, y: rooms[0].y + 1 };
  const downRoom   = rooms[ri(4, 8, rng)];
  const stairsDown = {
    x: downRoom.x + Math.floor(downRoom.w / 2),
    y: downRoom.y + Math.floor(downRoom.h / 2),
  };

  // Stairs up exist on all floors except level 1
  let stairsUp = null;
  if (dungeonLevel > 1) {
    const upRoom = rooms[ri(1, 3, rng)];
    stairsUp = {
      x: upRoom.x + Math.floor(upRoom.w / 2),
      y: upRoom.y + Math.floor(upRoom.h / 2),
    };
  }

  // Traps: 1–3 hidden on floor, more on deeper levels
  const trapCount = 1 + Math.floor(rng() * Math.min(3, 1 + Math.floor(dungeonLevel / 3)));
  const trapSet   = new Set([
    `${stairsDown.x},${stairsDown.y}`,
    `${heroPos.x},${heroPos.y}`,
  ]);
  const traps = [];
  let trapAttempts = 0;
  while (traps.length < trapCount && trapAttempts < 100) {
    trapAttempts++;
    const room = rooms[1 + Math.floor(rng() * (rooms.length - 1))];
    const x    = room.x + Math.floor(rng() * room.w);
    const y    = room.y + Math.floor(rng() * room.h);
    const key  = `${x},${y}`;
    if (trapSet.has(key)) continue;
    trapSet.add(key);
    const type = TRAP_TYPES[Math.floor(rng() * TRAP_TYPES.length)];
    traps.push({ x, y, type, hidden: true });
  }

  return { tiles, rooms, heroPos, stairsDown, stairsUp, traps };
}
