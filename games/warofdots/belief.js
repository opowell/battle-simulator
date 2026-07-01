// ---------------------------------------------------------------------------
// Fog-of-war belief tracking for War of Dots.
//
// Units move continuously in pixel space; for belief purposes we bucket them
// to tile coordinates (col = floor(x/T), row = floor(y/T)) and track per-unit
// possible (col,row) sets. Vision is Euclidean in pixel space around each
// friendly unit. Cities are not hidden — their positions and ownership are
// common-knowledge map features that both sides can always observe.
//
//   1. expand   — each turn an unseen unit can move up to speed*TICK_SECONDS
//                 pixels; in tile space that's ceil(speed*TICK/T) tiles of
//                 Chebyshev reach (mountains are skipped in the BFS).
//   2. collapse — pin visible enemies to their current tile; remove tiles
//                 inside our vision from unseen units' possible sets.
//   3. sample   — place each hidden unit at a tile-center pixel from its
//                 possible set, reconstructing the full unit via makeUnit.
// ---------------------------------------------------------------------------

const T            = 28;
const TICK_SECONDS = 5.0;
const COLS         = 40;
const ROWS         = 26;
const VISION_PX    = 5 * T;   // 140 px Euclidean radius
const MAX_POSSIBLE = 80;
const THREAT_BIAS  = 3;
const MOUNTAINS    = 4;        // matches TERRAIN.MOUNTAINS in WarodDotsGame.js

// Speeds from UNIT_DEF (inlined to avoid circular dep)
const UNIT_SPEED = { light: 75, heavy: 35 };

const k      = (col, row) => `${col},${row}`;
const coords = key         => key.split(',').map(Number);
const cheby  = (col, row, anchor) => Math.max(Math.abs(col - anchor.col), Math.abs(row - anchor.row));

const tileOf  = (x, y)   => ({ col: Math.max(0, Math.min(COLS - 1, Math.floor(x / T))), row: Math.max(0, Math.min(ROWS - 1, Math.floor(y / T))) });
const pixelOf = (col, row) => ({ x: col * T + T / 2, y: row * T + T / 2 });

function weightedPick(items, weights, rng) {
  let total = 0;
  for (const w of weights) total += w;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

function visiblePx(myUnits, col, row) {
  const { x, y } = pixelOf(col, row);
  return myUnits.some(m => Math.hypot(m.x - x, m.y - y) <= VISION_PX);
}

// BFS in tile space from every tile in `possible`, blocked by mountains.
function expandTiles(possible, reach, grid) {
  const next = new Set(possible);
  for (const startKey of possible) {
    const [sc, sr] = coords(startKey);
    // Simple BFS from each starting tile
    const seen = new Map([[startKey, reach]]);
    const queue = [{ col: sc, row: sr, ml: reach }];
    while (queue.length) {
      queue.sort((a, b) => b.ml - a.ml);
      const { col, row, ml } = queue.shift();
      for (const [dc, dr] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]) {
        const nc = col + dc, nr = row + dr;
        if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
        if ((grid[nr]?.[nc] ?? 0) === MOUNTAINS) continue;
        const remaining = ml - 1;
        const key = k(nc, nr);
        if ((seen.get(key) ?? -1) >= remaining) continue;
        seen.set(key, remaining);
        next.add(key);
        if (remaining > 0) queue.push({ col: nc, row: nr, ml: remaining });
      }
    }
  }
  return next;
}

export class WarodDotsBelief {
  // enemyUnits: snapshot from startRoster, filtered to enemy side.
  constructor(myId, grid, enemyUnits) {
    this.myId = myId;
    this.grid = grid;   // board.grid[row][col] — needed for mountain avoidance
    // id -> { owner, type, possible:Set<key>, anchor:{col,row}, alive, seen, hp, reach }
    this.pieces = new Map();

    for (const u of enemyUnits) {
      const { col, row } = tileOf(u.x, u.y);
      this.pieces.set(u.id, {
        owner: u.owner, type: u.type,
        possible: new Set([k(col, row)]),
        anchor: { col, row }, alive: true, seen: false,
        hp: u.hp,
        reach: Math.ceil((UNIT_SPEED[u.type] ?? 75) * TICK_SECONDS / T),
      });
    }
    this.lastTurn = null;
  }

  // 1. Expand: every unseen unit may have moved a full tick.
  _expand() {
    for (const pc of this.pieces.values()) {
      if (!pc.alive) continue;
      let next = expandTiles(pc.possible, pc.reach, this.grid);
      if (next.size > MAX_POSSIBLE) {
        next = new Set([...next].sort((a, b) => {
          const [ac, ar] = coords(a), [bc, br] = coords(b);
          return cheby(ac, ar, pc.anchor) - cheby(bc, br, pc.anchor);
        }).slice(0, MAX_POSSIBLE));
      }
      pc.possible = next;
    }
  }

  // 2. Collapse: reconcile belief with observation.
  _collapse(observation) {
    const myUnits = observation.units.filter(u => u.owner === this.myId);

    const seenIds = new Set();
    for (const u of observation.units) {
      if (u.owner === this.myId) continue;
      seenIds.add(u.id);
      let pc = this.pieces.get(u.id);
      if (!pc) {
        const { col, row } = tileOf(u.x, u.y);
        pc = {
          owner: u.owner, type: u.type,
          possible: new Set(), anchor: { col, row },
          alive: true, seen: false, hp: u.hp,
          reach: Math.ceil((UNIT_SPEED[u.type] ?? 75) * TICK_SECONDS / T),
        };
        this.pieces.set(u.id, pc);
      }
      const { col, row } = tileOf(u.x, u.y);
      pc.alive  = true;
      pc.hp     = u.hp;
      pc.anchor = { col, row };
      pc.possible = new Set([k(col, row)]);
      pc.seen   = true;
    }

    for (const [id, pc] of this.pieces) {
      if (seenIds.has(id)) continue;
      pc.seen = false;
      if (!pc.alive) continue;
      for (const key of [...pc.possible]) {
        const [col, row] = coords(key);
        if (visiblePx(myUnits, col, row)) pc.possible.delete(key);
      }
      if (pc.possible.size === 0) {
        // Fallback: tiles reachable from anchor that are outside our vision.
        const fallback = [...expandTiles(new Set([k(pc.anchor.col, pc.anchor.row)]), pc.reach, this.grid)]
          .filter(key => { const [col, row] = coords(key); return !visiblePx(myUnits, col, row); });
        pc.possible = new Set(fallback.length ? fallback : [k(pc.anchor.col, pc.anchor.row)]);
      }
    }
  }

  beginTurn(observation) {
    if (observation.turnNumber !== this.lastTurn) {
      if (this.lastTurn !== null) this._expand();
      this.lastTurn = observation.turnNumber;
    }
    this._collapse(observation);
  }

  /**
   * Draw up to `n` worlds placing hidden enemy units from their possible sets.
   * `makeUnit(id, type, owner, x, y)` builds a full unit; we override hp with
   * the last-seen value. Returns [] when nothing is hidden.
   */
  sample(observation, n, rng, makeUnit) {
    const myUnits = observation.units.filter(u => u.owner === this.myId);
    const seenIds = new Set(observation.units.filter(u => u.owner !== this.myId).map(u => u.id));

    const hidden = [];
    for (const [id, pc] of this.pieces) if (pc.alive && !seenIds.has(id)) hidden.push({ id, pc });
    if (hidden.length === 0) return [];

    // Occupied tiles (one unit per tile is a soft constraint to avoid overlap)
    const occupiedBase = new Set(observation.units.map(u => {
      const { col, row } = tileOf(u.x, u.y);
      return k(col, row);
    }));

    const worlds = [];
    for (let p = 0; p < n; p++) {
      const used   = new Set(occupiedBase);
      const placed = [];
      const order  = [...hidden].sort((a, b) => a.pc.possible.size - b.pc.possible.size);
      for (const { id, pc } of order) {
        const cands = [...pc.possible].filter(key => {
          const [col, row] = coords(key);
          return !used.has(key) && !visiblePx(myUnits, col, row);
        });
        if (cands.length === 0) continue;
        const weights = cands.map(key => {
          const [col, row] = coords(key);
          const { x, y } = pixelOf(col, row);
          const near = myUnits.some(m => Math.hypot(m.x - x, m.y - y) <= VISION_PX * 2);
          return (1 / (1 + cheby(col, row, pc.anchor))) * (near ? THREAT_BIAS : 1);
        });
        const key = weightedPick(cands, weights, rng);
        used.add(key);
        const [col, row] = coords(key);
        const { x, y } = pixelOf(col, row);
        placed.push({ ...makeUnit(id, pc.type, pc.owner, x, y), hp: pc.hp });
      }
      worlds.push({ ...observation, units: [...observation.units, ...placed] });
    }
    return worlds;
  }
}

// ---------------------------------------------------------------------------
// Per-game belief store, keyed by the (stable) players array.
// ---------------------------------------------------------------------------

const beliefStore = new WeakMap();

export function getWarodDotsBelief(state, myId) {
  let byPlayer = beliefStore.get(state.players);
  if (!byPlayer) { byPlayer = new Map(); beliefStore.set(state.players, byPlayer); }
  let belief = byPlayer.get(myId);
  if (!belief) {
    const roster = state.gameSpecific.startRoster ?? [];
    const enemyUnits = roster.filter(u => u.owner !== myId);
    belief = new WarodDotsBelief(myId, state.board.grid, enemyUnits);
    byPlayer.set(myId, belief);
  }
  return belief;
}
