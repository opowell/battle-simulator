import { MAP_W, MAP_H } from './dungeon.js';

export { MAP_W, MAP_H };

const k = (x, y) => `${x},${y}`;

export function isWalkable(tiles, x, y) {
  return tiles[k(x, y)] === '.';
}

export function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function getReachable(tiles, pos, range, units) {
  const occupied = new Set(
    units.filter(u => u.alive && !(u.position.x === pos.x && u.position.y === pos.y))
         .map(u => k(u.position.x, u.position.y))
  );
  const visited = new Set([k(pos.x, pos.y)]);
  const queue   = [{ x: pos.x, y: pos.y, rem: range }];
  const result  = [];
  while (queue.length) {
    const { x, y, rem } = queue.shift();
    if (rem === 0) continue;
    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nx = x + dx, ny = y + dy, nk = k(nx, ny);
      if (!visited.has(nk) && isWalkable(tiles, nx, ny) && !occupied.has(nk)) {
        visited.add(nk);
        result.push({ x: nx, y: ny });
        queue.push({ x: nx, y: ny, rem: rem - 1 });
      }
    }
  }
  return result;
}

export function stepToward(tiles, from, to, units) {
  const occupied = new Set(
    units.filter(u => u.alive && !(u.position.x === from.x && u.position.y === from.y))
         .map(u => k(u.position.x, u.position.y))
  );
  const visited = new Set([k(from.x, from.y)]);
  const queue   = [{ x: from.x, y: from.y, first: null }];
  while (queue.length) {
    const { x, y, first } = queue.shift();
    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nx = x + dx, ny = y + dy, nk = k(nx, ny);
      if (nx === to.x && ny === to.y) return first ?? { x: nx, y: ny };
      if (!visited.has(nk) && isWalkable(tiles, nx, ny) && !occupied.has(nk)) {
        visited.add(nk);
        queue.push({ x: nx, y: ny, first: first ?? { x: nx, y: ny } });
      }
    }
  }
  return null;
}

// Random walkable adjacent step (for confused/bat movement)
export function stepRandom(tiles, from, units, rng) {
  const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
  const shuffled = dirs.sort(() => rng() - 0.5);
  const occupied = new Set(
    units.filter(u => u.alive && !(u.position.x === from.x && u.position.y === from.y))
         .map(u => k(u.position.x, u.position.y))
  );
  for (const [dx, dy] of shuffled) {
    const nx = from.x + dx, ny = from.y + dy;
    if (isWalkable(tiles, nx, ny) && !occupied.has(k(nx, ny))) return { x: nx, y: ny };
  }
  return null;
}

// Random walkable position in any room
export function randomFloorPos(tiles, rooms, rng, excluded = new Set()) {
  for (let attempts = 0; attempts < 200; attempts++) {
    const room = rooms[Math.floor(rng() * rooms.length)];
    const x    = room.x + Math.floor(rng() * room.w);
    const y    = room.y + Math.floor(rng() * room.h);
    if (isWalkable(tiles, x, y) && !excluded.has(k(x, y))) return { x, y };
  }
  return null;
}

export function hasLOS(tiles, x0, y0, x1, y1) {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1,  sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, cx = x0, cy = y0;
  while (cx !== x1 || cy !== y1) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; cx += sx; }
    if (e2 <  dx) { err += dx; cy += sy; }
    if (cx === x1 && cy === y1) break;
    if (tiles[k(cx, cy)] !== '.') return false;
  }
  return true;
}

function itemChar(type) {
  if (type === 'food')           return '%';
  if (type.startsWith('potion')) return '!';
  if (type.startsWith('scroll')) return '?';
  if (type.startsWith('weapon')) return ')';
  if (type.startsWith('armor'))  return ']';
  if (type.startsWith('ring'))   return '=';
  if (type.startsWith('wand'))   return '/';
  if (type === 'gold')           return '*';
  return '?';
}

export function renderMap(state) {
  const { board: { tiles }, units, gameSpecific: gs } = state;
  const hero = units.find(u => u.type === 'rogue' && u.alive);
  const seeInvisible = hero && ((hero.attrs.effects?.see_invisible ?? 0) > 0 ||
                                 hero.attrs.leftRing?.effect  === 'see_invisible' ||
                                 hero.attrs.rightRing?.effect === 'see_invisible');
  const blind = hero && (hero.attrs.effects?.blind ?? 0) > 0;

  // Build position map; invisible/mimic monsters need special handling
  const posMap = {};
  for (const u of units) {
    if (!u.alive) continue;
    const ability = u.attrs.specialAbility;
    const pos     = u.position;
    const dist    = hero ? manhattan(pos, hero.position) : 999;

    if (ability === 'invisible' && !seeInvisible && dist > 1) continue; // phantoms hidden unless adjacent
    if (ability === 'mimic' && !u.attrs.revealed) {
      // Show mimic as the item it's disguising as
      posMap[k(pos.x, pos.y)] = { ...u, attrs: { ...u.attrs, symbol: u.attrs.mimicChar ?? '?' } };
      continue;
    }
    posMap[k(pos.x, pos.y)] = u;
  }

  const itemMap = {};
  for (const it of (gs.items ?? [])) if (!it.pickedUp) itemMap[k(it.x, it.y)] = it;

  const sdK  = gs.stairsDown ? k(gs.stairsDown.x, gs.stairsDown.y) : null;
  const suK  = gs.stairsUp   ? k(gs.stairsUp.x,   gs.stairsUp.y)   : null;
  const amK  = gs.amuletPos && !gs.hasAmulet ? k(gs.amuletPos.x, gs.amuletPos.y) : null;

  // Revealed traps
  const trapMap = {};
  for (const tr of (gs.traps ?? [])) {
    if (!tr.hidden) trapMap[k(tr.x, tr.y)] = tr;
  }

  const rows = [];
  for (let y = 0; y < MAP_H; y++) {
    let row = '';
    for (let x = 0; x < MAP_W; x++) {
      const kk = k(x, y);
      if (blind && (!hero || manhattan({ x, y }, hero.position) > 1)) {
        row += tiles[kk] === '.' ? ' ' : '#';
      } else if (posMap[kk]) {
        row += posMap[kk].attrs.symbol;
      } else if (kk === amK)  { row += '"'; }
      else if (kk === sdK)    { row += '>'; }
      else if (kk === suK)    { row += '<'; }
      else if (itemMap[kk])   { row += itemChar(itemMap[kk].type); }
      else if (trapMap[kk])   { row += '^'; }
      else                    { row += tiles[kk] === '.' ? '.' : '#'; }
    }
    rows.push(row);
  }
  return rows.join('\n');
}
