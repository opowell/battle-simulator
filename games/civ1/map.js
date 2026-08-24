import { TERRAIN } from './terrain.js';
import { UNITS } from './units.js';

export function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Wrap an x coordinate into [0, width) — the world is a cylinder that wraps
// horizontally (east/west), so the left and right edges are the same seam.
export function wrapX(x, width) { return ((x % width) + width) % width; }

// ── Original Civ1 map generation ───────────────────────────────────────────
//
// A faithful port of the algorithm the 1991 game used, as reverse-engineered
// and documented at:
//   https://forums.civfanatics.com/threads/civ1-map-generation-explained.498630/
//
// The original works on a fixed 80×50 grid; here the reference coordinates and
// counts are scaled to whatever (width, height) the caller asks for. The seven
// steps are: (A) land mass via random "corner-brush" walks, (B) latitude/
// temperature base terrain, (C) a two-pass climate water cycle, (D) age/erosion
// randomisation, (E) rivers, (F) — map-data bookkeeping the original did here
// but which this engine computes elsewhere, so it is omitted — and (G) poles.
//
// Four parameters (0..2, default 1) drive the shape of the world:
//   land    — total land mass (more land at higher values)
//   temp    — how far deserts spread from the equator
//   climate — how wet the world is (more grassland/jungle/swamp when higher)
//   age     — erosion amount (more hills/mountains reshuffled when higher)

const REF_W = 80, REF_H = 50;

// 8-neighbour direction vectors indexed 0=N,1=NE,2=E,3=SE,4=S,5=SW,6=W,7=NW —
// this ordering is what the river direction arithmetic in step E relies on.
const DIRS8 = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

export function generateMap(width, height, rng, opts = {}) {
  const land    = opts.land    ?? 1;
  const temp    = opts.temp    ?? 1;
  const climate = opts.climate ?? 1;
  const age     = opts.age     ?? 1;

  const rnd = (n) => Math.floor(rng() * n);
  const area = width * height;
  const idx = (x, y) => y * width + x;
  // Reference-coordinate → this-map scaling.
  const sx = width / REF_W, sy = height / REF_H;
  const scaleX = (rx) => Math.round(rx * sx);
  const scaleY = (ry) => Math.round(ry * sy);
  // Map a row to the original 0..49 latitude space and to a 0..24 "half"
  // latitude used by the climate water cycle (equator ≈ 12).
  const y50Of = (y) => y * (REF_H - 1) / (height - 1);

  // ── A. Land mass ─────────────────────────────────────────────────────────
  // Accumulate land by stamping many small "chunks". Each chunk is a random
  // walk that paints a 3-pixel corner brush at every step; overlapping chunks
  // reinforce each other so blobs grow into continents.
  const geo = new Int16Array(area);       // land accumulation (0 = ocean)
  const stencil = new Uint8Array(area);   // scratch for one chunk

  const minX = scaleX(3),  maxX = scaleX(76);
  const minY = scaleY(3),  maxY = scaleY(45);
  const startX0 = scaleX(4), startXR = Math.max(1, scaleX(71) - scaleX(4));
  const startY0 = scaleY(8), startYR = Math.max(1, scaleY(33) - scaleY(8));

  const stamp = (x, y) => {
    if (y < 0 || y >= height) return;
    stencil[idx(wrapX(x, width), y)] = 1;
  };
  const paintChunk = () => {
    stencil.fill(0);
    let x = startX0 + rnd(startXR + 1);
    let y = startY0 + rnd(startYR + 1);
    let len = 1 + rnd(64);
    while (len > 0) {
      // Corner-shaped 3-pixel brush: this tile plus its east and south sides.
      stamp(x, y); stamp(x + 1, y); stamp(x, y + 1);
      len--;
      const dir = rnd(4);
      if (dir === 0) y--; else if (dir === 1) x++; else if (dir === 2) y++; else x--;
      if (x < minX || x > maxX || y < minY || y > maxY) break;
    }
    for (let i = 0; i < area; i++) if (stencil[i]) geo[i]++;
  };

  // Keep spawning chunks until enough land exists. Original threshold is
  // (land + 2) × 320 squares on the 80×50 grid; scale it to this map's area.
  const landTarget = Math.round((land + 2) * 320 * area / (REF_W * REF_H));
  const countLand = () => { let n = 0; for (let i = 0; i < area; i++) if (geo[i]) n++; return n; };
  for (let guard = 0; guard < 4000 && countLand() < landTarget; guard++) paintChunk();

  // Narrow-passage fix: dissolve 2×2 diagonal checkerboards of land/ocean so
  // continents don't touch only at a corner (which pathfinding can't cross).
  const isL = (x, y) => geo[idx(x, y)] > 0;
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const a = isL(x, y), b = isL(x + 1, y), c = isL(x, y + 1), d = isL(x + 1, y + 1);
      if (a && d && !b && !c) { geo[idx(x + 1, y)] = 1; }        // fill NE corner
      else if (b && c && !a && !d) { geo[idx(x, y)] = 1; }       // fill NW corner
    }
  }

  // Terrain grid held as strings (matches TERRAIN keys). Ocean everywhere land
  // is absent; land starts blank and is filled by the temperature step.
  const terr = new Array(area);
  for (let i = 0; i < area; i++) terr[i] = geo[i] ? null : 'ocean';

  // ── B. Temperature: latitude-based base terrain ──────────────────────────
  // Deserts hug the equator, arctic hugs the poles. The +rnd(0..7) jitter (from
  // the original) frays the latitude bands so they aren't dead-straight lines.
  for (let y = 0; y < height; y++) {
    const y50 = y50Of(y);
    for (let x = 0; x < width; x++) {
      const i = idx(x, y);
      if (terr[i] === 'ocean') continue;
      // Original: latitude = |y - 29 + rand(0..7) + (1 - temp)| then / 6 + 1,
      // bucketed desert(<2) / plains(<4) / tundra(<6) / arctic. This makes a
      // wide desert belt at the equator, plains through the temperate zone, and
      // tundra toward the poles; true arctic is essentially only the pole rows.
      const lat = Math.abs(y50 - 29 + rnd(8) + (1 - temp)) / 6 + 1;
      terr[i] = lat < 2 ? 'desert' : lat < 4 ? 'plains' : lat < 6 ? 'tundra' : 'arctic';
    }
  }

  // ── C. Climate: two-pass water cycle ─────────────────────────────────────
  // Each row is swept W→E then E→W. Oceans feed a running "wetness" (clouds);
  // land squares consume it as rainfall and, when the row is still wet, shift
  // one step wetter along the terrain succession.
  const rainMax = Math.max(1, 8 - climate * 2);
  for (let y = 0; y < height; y++) {
    const lat24 = y50Of(y) / 2; // 0..24, equator ≈ 12

    // West-to-East.
    let wet = 0;
    for (let x = 0; x < width; x++) {
      const i = idx(x, y);
      if (terr[i] === 'ocean') {
        if (Math.abs(lat24 - 12) + climate * 4 > wet) wet++;
      } else {
        if (wet > 0) {
          const t = terr[i];
          if (t === 'plains') terr[i] = 'grassland';
          else if (t === 'tundra') terr[i] = 'arctic';
          else if (t === 'hills') terr[i] = 'forest';
          else if (t === 'desert') terr[i] = 'plains';
          else if (t === 'mountains') wet -= 3;
        }
        wet -= rnd(rainMax);
      }
    }

    // East-to-West.
    wet = 0;
    for (let x = width - 1; x >= 0; x--) {
      const i = idx(x, y);
      if (terr[i] === 'ocean') {
        if (lat24 / 2 + climate > wet) wet++;
      } else {
        if (wet > 0) {
          const t = terr[i];
          if (t === 'grassland') { terr[i] = lat24 < 10 ? 'jungle' : 'swamp'; wet -= 2; }
          else if (t === 'mountains') { terr[i] = 'forest'; wet -= 3; }
          else if (t === 'desert') terr[i] = 'plains';
        }
        wet -= rnd(rainMax);
      }
    }
  }

  // ── D. Age / erosion ─────────────────────────────────────────────────────
  // Nudge random squares (and random neighbours of them) one step along an
  // erosion succession, giving the tidy latitude/climate bands a weathered feel.
  const erodeSteps = Math.round(800 * (1 + age) * area / (REF_W * REF_H));
  let px = 0, py = 0;
  for (let step = 0; step < erodeSteps; step++) {
    let x, y;
    if (step % 2 === 0) { x = rnd(width); y = rnd(height); }
    else {
      const [dx, dy] = DIRS8[rnd(8)];
      x = wrapX(px + dx, width); y = py + dy;
      if (y < 0 || y >= height) { y = py; }
    }
    px = x; py = y;
    const i = idx(x, y);
    switch (terr[i]) {
      case 'forest':    terr[i] = 'jungle'; break;
      case 'swamp':     terr[i] = 'grassland'; break;
      case 'plains':    terr[i] = 'hills'; break;
      case 'tundra':    terr[i] = 'hills'; break;
      case 'grassland': terr[i] = 'forest'; break;
      case 'jungle':    terr[i] = 'swamp'; break;
      case 'hills':     terr[i] = 'mountains'; break;
      case 'desert':    terr[i] = 'plains'; break;
      case 'arctic':    terr[i] = 'mountains'; break;
      case 'mountains': {
        // Mountains erode to ocean only when they still border land, so we
        // don't punch lone holes in the open sea.
        let landNbr = false;
        for (const [dx, dy] of DIRS8) {
          const ny = y + dy; if (ny < 0 || ny >= height) continue;
          if (terr[idx(wrapX(x + dx, width), ny)] !== 'ocean') { landNbr = true; break; }
        }
        if (landNbr) { terr[i] = 'ocean'; geo[i] = 0; }
        break;
      }
    }
  }

  // Build the tiles map now so rivers can read/write hasRiver directly.
  const tiles = {};
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      tiles[`${x},${y}`] = {
        terrain: terr[idx(x, y)] ?? 'ocean',
        hasRoad: false, hasRail: false, hasRiver: false, fortress: false,
      };
    }
  }

  // ── E. Rivers ────────────────────────────────────────────────────────────
  generateRivers(tiles, terr, width, height, land, climate, rnd);

  // ── G. Poles ─────────────────────────────────────────────────────────────
  // Solid arctic on the top and bottom rows, then scatter a little tundra into
  // the two outermost rows at each pole to break the straight ice edge.
  for (let x = 0; x < width; x++) {
    tiles[`${x},0`].terrain = 'arctic';
    tiles[`${x},${height - 1}`].terrain = 'arctic';
  }
  const poleRows = [0, 1, height - 2, height - 1].filter((r) => r >= 0 && r < height);
  for (let n = 0; n < 20; n++) {
    const y = poleRows[rnd(poleRows.length)];
    const x = rnd(width);
    const t = tiles[`${x},${y}`];
    if (t.terrain !== 'ocean') t.terrain = 'tundra';
  }

  return tiles;
}

// Step E: grow rivers from hills down to the sea using the original's
// direction-turning walk. A river is kept only if it reaches ocean after at
// least 5 tiles and never crosses an existing river or mountains.
function generateRivers(tiles, terr, width, height, land, climate, rnd) {
  const idx = (x, y) => y * width + x;
  const hills = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 0; x < width; x++) if (terr[idx(x, y)] === 'hills') hills.push({ x, y });
  }
  if (!hills.length) return;

  const riverTarget = (climate + land) * 2 + 6;
  let rivers = 0;
  for (let attempt = 0; attempt < 256 && rivers <= riverTarget; attempt++) {
    const src = hills[rnd(hills.length)];
    let x = src.x, y = src.y, len = 0;
    let A = rnd(4) * 2; // start on a cardinal direction {0,2,4,6}
    const path = [];
    let reachedSea = false, blocked = false;

    for (let step = 0; step < 256; step++) {
      path.push({ x, y });
      len++;
      const C = rnd(2);
      A = (((C - (len % 2)) * 2 + A) & 7);
      const [dx, dy] = DIRS8[A];
      const nx = wrapX(x + dx, width), ny = y + dy;
      if (ny < 0 || ny >= height) { blocked = true; break; }
      const t = tiles[`${nx},${ny}`];
      if (t.terrain === 'ocean') { reachedSea = len >= 5; break; }
      if (t.hasRiver || t.terrain === 'mountains') { blocked = true; break; }
      x = nx; y = ny;
    }

    if (reachedSea && !blocked) {
      for (const p of path) tiles[`${p.x},${p.y}`].hasRiver = true;
      rivers++;
    }
  }
}

export function findStartPos(tiles, width, height, xRange, rng) {
  const preferred = [], fallback = [];
  for (let y = 2; y < height - 2; y++) {
    for (let x = xRange[0]; x < xRange[1]; x++) {
      const t = tiles[`${x},${y}`];
      if (!t || t.terrain === 'ocean' || t.terrain === 'arctic' || t.terrain === 'mountains') continue;
      if (['grassland', 'plains'].includes(t.terrain)) preferred.push({ x, y });
      else fallback.push({ x, y });
    }
  }
  const pool = preferred.length ? preferred : fallback;
  if (!pool.length) return { x: Math.floor((xRange[0] + xRange[1]) / 2), y: Math.floor(height / 2) };
  return pool[Math.floor(rng() * pool.length)];
}

export function findAdjacentFree(pos, board, units) {
  const occupied = new Set(units.filter(u => u.alive).map(u => `${u.position.x},${u.position.y}`));
  for (const [dx, dy] of [[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]) {
    const nx = wrapX(pos.x + dx, board.width), ny = pos.y + dy;
    if (ny < 0 || ny >= board.height) continue;
    const k = `${nx},${ny}`;
    const t = board.tiles[k];
    if (!t || t.terrain === 'ocean') continue;
    if (occupied.has(k)) continue;
    return { x: nx, y: ny };
  }
  return null;
}

// ── Zones of control ─────────────────────────────────────────────────────────
//
// Civ1's blockade rule. Every unit projects a zone over the eight squares around
// it, and a land unit may not step straight from one square an enemy covers to
// another square *that same enemy* covers. Two enemies standing side by side
// therefore seal the lane between them: to get past you attack through, walk
// around, or duck into a city.
//
// The exact shape of the rule — including the quirks — follows the original, as
// reproduced by CivOne (CC0) in BaseUnit.MoveTo:
//   https://github.com/SWY1985/CivOne/blob/master/src/Units/BaseUnit.cs
//
//   * Only land units are bound by it. Ships and aircraft move as they please.
//   * Diplomats and Caravans slip through — the 'ignore-zoc' tag in units.js,
//     which is how any future unit joins them.
//   * A city square at *either* end of the step lifts the rule, whoever owns it,
//     and so does an ocean square — an amphibious landing is never blockaded.
//   * It takes ONE enemy covering both squares. Stepping out of unit A's zone
//     and into unit B's is legal, which is why a blockade needs a real line and
//     not just scattered pickets.
//   * Attacking is never blocked, because attacking is not a move — Civ1Game
//     enumerates 'attack' separately and never consults this.
//   * The projecting unit's own domain doesn't matter: a trireme lying offshore
//     covers the coastal squares beside it, as in the original.
//
// Note this is about *enemies*: `playerId` is the mover's side, and everyone
// else — rival civs and barbarians alike — projects against them.

const ZOC_DIRS = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];

/**
 * Builds the zone-of-control test for one board position, with the enemy coverage
 * stamped out once up front — this sits inside the movement flood fill, and the
 * search calls that thousands of times a turn.
 *
 * @returns {(unit: object, from: {x:number,y:number}, to: {x:number,y:number}) => boolean}
 *   true if the rule forbids `unit` stepping `from` → `to`.
 */
export function makeZoneOfControl(board, allUnits, cities, playerId) {
  // tile key -> the enemy tile keys whose zone reaches it. Built by stamping each
  // enemy's eight neighbours rather than by scanning tiles, so the cost is in the
  // number of enemies on the board, not the size of the map.
  const coverage = new Map();
  for (const u of allUnits) {
    if (!u.alive || u.ownerId === playerId) continue;
    const src = `${u.position.x},${u.position.y}`;
    for (const [dx, dy] of ZOC_DIRS) {
      const ny = u.position.y + dy;
      if (ny < 0 || ny >= board.height) continue;
      const k = `${wrapX(u.position.x + dx, board.width)},${ny}`;
      let at = coverage.get(k);
      if (!at) coverage.set(k, at = new Set());
      at.add(src);
    }
  }
  if (coverage.size === 0) return () => false;   // nobody about: nothing to check

  const cityPos = new Set((cities ?? []).map(c => `${c.position.x},${c.position.y}`));
  // A square that lifts the rule for any step touching it.
  const exempt = (k) => cityPos.has(k) || board.tiles[k]?.terrain === 'ocean';

  return (unit, from, to) => {
    const stats = UNITS[unit.type];
    if (stats?.domain !== 'land') return false;
    if (stats.special?.includes('ignore-zoc')) return false;

    const toK = `${to.x},${to.y}`;
    const covering = coverage.get(toK);
    if (!covering) return false;                 // walking into open ground

    const fromK = `${from.x},${from.y}`;
    if (exempt(fromK) || exempt(toK)) return false;

    const leaving = coverage.get(fromK);
    if (!leaving) return false;                  // stepping *into* a zone is fine

    for (const enemy of leaving) if (covering.has(enemy)) return true;
    return false;
  };
}

/**
 * Every tile `unit` may move to this turn: a best-first flood fill over civ1's
 * terrain/road move costs, routing around every unit on the board and obeying
 * zones of control (makeZoneOfControl above) step by step.
 *
 * `cities` feeds the zone-of-control city exemption only; omitting it just means
 * no square counts as a city, which is what the callers that have no city list
 * (an agent reasoning over its own fogged view) want anyway.
 */
export function getReachableTiles(unit, board, allUnits, playerId, cities = []) {
  const stats = UNITS[unit.type];
  const { domain } = stats;
  const key = p => `${p.x},${p.y}`;

  const enemyPos = new Set(allUnits.filter(u => u.alive && u.ownerId !== playerId).map(u => key(u.position)));
  const friendlyPos = new Set(allUnits.filter(u => u.alive && u.ownerId === playerId && u.id !== unit.id).map(u => key(u.position)));
  const zocBlocks = makeZoneOfControl(board, allUnits, cities, playerId);

  const best = new Map([[key(unit.position), unit.movesLeft]]);
  const queue = [{ pos: unit.position, ml: unit.movesLeft }];
  const reachable = [];

  while (queue.length) {
    queue.sort((a, b) => b.ml - a.ml);
    const { pos, ml } = queue.shift();

    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]) {
      const ny = pos.y + dy;
      if (ny < 0 || ny >= board.height) continue;
      const next = { x: wrapX(pos.x + dx, board.width), y: ny };
      const k = key(next);

      const tile = board.tiles[k];
      if (!tile) continue;

      const td = TERRAIN[tile.terrain];
      if (!td) continue;

      // Never route through the dark. On the true board there is no such square; on an
      // agent's own observation (civ1SearchActions calls this with the fogged board)
      // it is ground the mover has never seen, and a move onto what turns out to be
      // ocean would be thrown out by the engine as illegal — a plan silently replaced
      // by a fallback. Single steps are unaffected, since a unit sees all eight of its
      // neighbours, so exploration still walks the map open one square at a time.
      if (tile.terrain === 'unknown') continue;

      if (domain === 'land' && !td.passable.land) continue;
      if (domain === 'sea'  && !td.passable.sea)  continue;

      if (domain === 'land' && enemyPos.has(k)) continue;
      if (friendlyPos.has(k)) continue;

      // Zones of control, applied to the step actually being taken (`pos` is the
      // square the unit is standing on at this point in the fill, `next` the one
      // it would step onto) — a blockade has to stop a long march at the line, not
      // merely refuse its final destination.
      if (zocBlocks(unit, pos, next)) continue;

      // Civ1 movement costs: railroad is free, road is 1/3, otherwise the terrain's
      // own cost. Must stay in step with moveCost in Civ1Game.js — this enumerates
      // where a unit may go, that one charges for the step actually taken.
      let cost;
      if (domain === 'air') {
        cost = 1;
      } else if (tile.hasRail) {
        cost = 0;
      } else if (tile.hasRoad) {
        cost = 1 / 3;
      } else {
        cost = td.moveCost;
      }

      if (ml <= 0) continue;
      const remaining = Math.max(0, ml - cost);

      if ((best.get(k) ?? -1) >= remaining) continue;
      best.set(k, remaining);
      reachable.push(next);
      if (remaining > 0) queue.push({ pos: next, ml: remaining });
    }
  }

  return reachable;
}

export function renderMap(state) {
  const { board, units, cities } = state;
  const { width, height } = board;

  const cityMap = {};
  for (const c of cities) cityMap[`${c.position.x},${c.position.y}`] = c;

  const unitMap = {};
  for (const u of units) {
    if (!u.alive) continue;
    const k = `${u.position.x},${u.position.y}`;
    if (!unitMap[k] || u.ownerId === state.players[0].id) unitMap[k] = u;
  }

  const p1Id = state.players[0].id;
  // Anything owned by a non-seat faction — the barbarians (see barbarians.js). This
  // one-char map has only "P1 or not" to say, so without a mark of their own raiders
  // would read as the second civ's units.
  const seatIds = new Set(state.players.map(p => p.id));
  const unseated = ownerId => !seatIds.has(ownerId);

  const header = '    ' + Array.from({ length: width }, (_, i) => String(i).padStart(2)).join('');
  const rows = [header];

  for (let y = height - 1; y >= 0; y--) {
    let row = String(y).padStart(2) + ' |';
    for (let x = 0; x < width; x++) {
      const k = `${x},${y}`;
      const tile = board.tiles[k];
      const city = cityMap[k];
      const unit = unitMap[k];

      if (city) {
        const mark = unseated(city.ownerId) ? '%' : city.ownerId === p1Id ? '1' : '2';
        row += ` ${mark}`;
      } else if (unit) {
        const sym = unit.type[0];
        row += ` ${unseated(unit.ownerId) ? '*' : unit.ownerId === p1Id ? sym.toUpperCase() : sym.toLowerCase()}`;
      } else {
        const sym = tile ? (TERRAIN[tile.terrain]?.symbol ?? '?') : ' ';
        row += ` ${sym}`;
      }
    }
    rows.push(row);
  }

  return rows.join('\n');
}
