// ---------------------------------------------------------------------------
// Fog-of-war belief tracking for StarCraft 2.
//
// Under fog, getVisibleState reveals only our own units/buildings plus enemies
// within VISION (Chebyshev) of any friendly unit or building. This tracks:
//
//   • units    — per-unit possible-tile sets, expanded by moveRange each turn.
//   • buildings — pinned exactly once spotted (they can't move); their state
//                 (hp, constructTurns) is updated on each subsequent sighting.
//
//   1. expand   — unseen units may have moved a full turn; BFS over passable
//                 ground from every tile in the current possible set.
//   2. collapse — pin visible enemies to their exact tile; erase from unseen
//                 units' sets any tile we can see but find empty.
//                 Record spotted buildings exactly (they don't move).
//   3. sample   — draw worlds placing unseen units from their possible sets and
//                 re-inserting known-but-hidden enemy buildings.
// ---------------------------------------------------------------------------

import { TERRAIN } from './terrain.js';
import { UNITS } from './units.js';
import { BUILDINGS } from './buildings.js';

const VISION       = 3;   // matches getVisibleState (Chebyshev, no LOS)
const MAX_POSSIBLE = 40;
const THREAT_BIAS  = 3;

const k      = (x, y) => `${x},${y}`;
const coords = key   => key.split(',').map(Number);
const cheby  = (x, y, p) => Math.max(Math.abs(x - p.x), Math.abs(y - p.y));

function weightedPick(items, weights, rng) {
  let total = 0;
  for (const w of weights) total += w;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

// BFS over ground-passable tiles from `pos` up to `range` move points.
function groundReachable(board, pos, range) {
  const { tiles, width, height } = board;
  const best = new Map([[k(pos.x, pos.y), range]]);
  const queue = [{ x: pos.x, y: pos.y, ml: range }];
  const result = [];
  while (queue.length) {
    queue.sort((a, b) => b.ml - a.ml);
    const { x, y, ml } = queue.shift();
    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const tile = tiles[k(nx, ny)];
      if (!tile) continue;
      const td = TERRAIN[tile.terrain];
      if (!td?.passable.ground) continue;
      const cost = td.moveCost || 1;
      if (ml < cost) continue;
      const remaining = ml - cost;
      const key = k(nx, ny);
      if ((best.get(key) ?? -1) >= remaining) continue;
      best.set(key, remaining);
      result.push({ x: nx, y: ny });
      if (remaining > 0) queue.push({ x: nx, y: ny, ml: remaining });
    }
  }
  return result;
}

export class Sc2Belief {
  // enemyUnits/enemyBuildings: snapshots from startRoster, filtered to enemy side.
  constructor(myId, board, enemyUnits, enemyBuildings) {
    this.myId  = myId;
    this.board = board;
    // id -> { ownerId, type, possible:Set<key>, anchor, alive, seen, hp, moves }
    this.unitPieces = new Map();
    // id -> { ownerId, type, position, alive, hp, shields, maxHp, maxShields, constructTurns }
    this.bldgPieces = new Map();

    for (const u of enemyUnits) {
      this.unitPieces.set(u.id, {
        ownerId: u.ownerId, type: u.type,
        possible: new Set([k(u.position.x, u.position.y)]),
        anchor: { ...u.position }, alive: true, seen: false,
        hp: u.hp ?? 1,
        moves: UNITS[u.type]?.moves ?? 2,
      });
    }
    for (const b of enemyBuildings) {
      const bdef = BUILDINGS[b.type] ?? {};
      this.bldgPieces.set(b.id, {
        ownerId: b.ownerId, type: b.type,
        position: { ...b.position },
        alive: true, seen: false,
        hp: b.hp ?? bdef.hp ?? 100,
        shields: b.shields ?? bdef.shields ?? 0,
        maxHp: b.maxHp ?? bdef.hp ?? 100,
        maxShields: b.maxShields ?? bdef.shields ?? 0,
        constructTurns: b.constructTurns ?? 0,
      });
    }
    this.lastTurn = null;
  }

  _visible(myUnits, myBldgs, x, y) {
    return myUnits.some(m => cheby(x, y, m.position) <= VISION)
        || myBldgs.some(b => cheby(x, y, b.position) <= VISION);
  }

  // 1. Expand: every unseen unit may have moved a full turn.
  _expand() {
    for (const pc of this.unitPieces.values()) {
      if (!pc.alive) continue;
      const next = new Set(pc.possible);
      for (const key of pc.possible) {
        const [x, y] = coords(key);
        for (const t of groundReachable(this.board, { x, y }, pc.moves)) next.add(k(t.x, t.y));
      }
      pc.possible = next.size > MAX_POSSIBLE
        ? new Set([...next].sort((a, b) => {
            const [ax, ay] = coords(a), [bx, by] = coords(b);
            return cheby(ax, ay, pc.anchor) - cheby(bx, by, pc.anchor);
          }).slice(0, MAX_POSSIBLE))
        : next;
    }
  }

  // 2. Collapse: reconcile belief with what we observe this turn.
  _collapse(observation) {
    const myUnits = observation.units.filter(u => u.alive && u.ownerId === this.myId);
    const myBldgs = (observation.buildings ?? []).filter(b => b.alive && b.ownerId === this.myId);

    // Units —
    const seenUnitIds = new Set();
    for (const u of observation.units) {
      if (u.ownerId === this.myId) continue;
      seenUnitIds.add(u.id);
      let pc = this.unitPieces.get(u.id);
      if (!pc) {
        pc = {
          ownerId: u.ownerId, type: u.type,
          possible: new Set(), anchor: { ...u.position },
          alive: true, seen: false, hp: u.hp ?? 1,
          moves: UNITS[u.type]?.moves ?? 2,
        };
        this.unitPieces.set(u.id, pc);
      }
      pc.alive  = u.alive;
      pc.hp     = u.hp ?? pc.hp;
      pc.anchor = { ...u.position };
      pc.possible = new Set([k(u.position.x, u.position.y)]);
      pc.seen   = true;
    }
    for (const [id, pc] of this.unitPieces) {
      if (seenUnitIds.has(id)) continue;
      pc.seen = false;
      if (!pc.alive) continue;
      for (const key of [...pc.possible]) {
        const [x, y] = coords(key);
        if (this._visible(myUnits, myBldgs, x, y)) pc.possible.delete(key);
      }
      if (pc.possible.size === 0) {
        const hidden = groundReachable(this.board, pc.anchor, pc.moves)
          .map(t => k(t.x, t.y))
          .filter(key => { const [x, y] = coords(key); return !this._visible(myUnits, myBldgs, x, y); });
        pc.possible = new Set(hidden.length ? hidden : [k(pc.anchor.x, pc.anchor.y)]);
      }
    }

    // Buildings — pinned once spotted, never move.
    for (const b of (observation.buildings ?? [])) {
      if (b.ownerId === this.myId) continue;
      let pb = this.bldgPieces.get(b.id);
      if (!pb) {
        const bdef = BUILDINGS[b.type] ?? {};
        pb = {
          ownerId: b.ownerId, type: b.type,
          position: { ...b.position },
          alive: true, seen: false,
          hp: b.hp ?? bdef.hp ?? 100,
          shields: b.shields ?? bdef.shields ?? 0,
          maxHp: b.maxHp ?? bdef.hp ?? 100,
          maxShields: b.maxShields ?? bdef.shields ?? 0,
          constructTurns: b.constructTurns ?? 0,
        };
        this.bldgPieces.set(b.id, pb);
      }
      pb.alive         = b.alive;
      pb.hp            = b.hp ?? pb.hp;
      pb.shields       = b.shields ?? pb.shields;
      pb.constructTurns = b.constructTurns ?? 0;
      pb.seen          = true;
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
   * Draw up to `n` worlds: place unseen enemy units from their possible sets
   * (most-constrained first, threat-biased), and re-insert known-but-hidden
   * enemy buildings. Returns [] when nothing is hidden.
   */
  sample(observation, n, rng, makeUnit) {
    const myUnits    = observation.units.filter(u => u.alive && u.ownerId === this.myId);
    const myBldgs    = (observation.buildings ?? []).filter(b => b.alive && b.ownerId === this.myId);
    const seenUnitIds = new Set(observation.units.filter(u => u.ownerId !== this.myId).map(u => u.id));
    const seenBldgIds = new Set((observation.buildings ?? []).filter(b => b.ownerId !== this.myId).map(b => b.id));

    const hidden = [];
    for (const [id, pc] of this.unitPieces) if (pc.alive && !seenUnitIds.has(id)) hidden.push({ id, pc });

    // Known enemy buildings we've previously spotted but can't see right now.
    const hiddenBldgs = [];
    for (const [id, pb] of this.bldgPieces) {
      if (pb.alive && !seenBldgIds.has(id)) hiddenBldgs.push({ id, pb });
    }

    if (hidden.length === 0 && hiddenBldgs.length === 0) return [];

    const occupiedBase = new Set(observation.units.filter(u => u.alive).map(u => k(u.position.x, u.position.y)));
    const worlds = [];

    for (let p = 0; p < n; p++) {
      const used   = new Set(occupiedBase);
      const placed = [];
      const order  = [...hidden].sort((a, b) => a.pc.possible.size - b.pc.possible.size);
      for (const { id, pc } of order) {
        const cands = [...pc.possible].filter(key => {
          const [x, y] = coords(key);
          return !used.has(key) && !this._visible(myUnits, myBldgs, x, y);
        });
        if (cands.length === 0) continue;
        const weights = cands.map(key => {
          const [x, y] = coords(key);
          const near = myUnits.some(m => cheby(x, y, m.position) <= VISION + 3);
          return (1 / (1 + cheby(x, y, pc.anchor))) * (near ? THREAT_BIAS : 1);
        });
        const key = weightedPick(cands, weights, rng);
        used.add(key);
        const [x, y] = coords(key);
        placed.push({ ...makeUnit(id, pc.ownerId, pc.type, x, y), hp: pc.hp, alive: true });
      }

      const placedBldgs = hiddenBldgs.map(({ id, pb }) => ({
        id, ownerId: pb.ownerId, type: pb.type,
        position: { ...pb.position },
        alive: true,
        hp: pb.hp, maxHp: pb.maxHp,
        shields: pb.shields, maxShields: pb.maxShields,
        constructTurns: pb.constructTurns ?? 0,
        queue: null, domain: 'ground', attrs: {},
      }));

      worlds.push({
        ...observation,
        units:     [...observation.units, ...placed],
        buildings: [...(observation.buildings ?? []), ...placedBldgs],
      });
    }
    return worlds;
  }
}

// ---------------------------------------------------------------------------
// Per-game belief store, keyed by the (stable) players array.
// ---------------------------------------------------------------------------

const beliefStore = new WeakMap();

export function getSc2Belief(state, myId) {
  let byPlayer = beliefStore.get(state.players);
  if (!byPlayer) { byPlayer = new Map(); beliefStore.set(state.players, byPlayer); }
  let belief = byPlayer.get(myId);
  if (!belief) {
    const roster = state.gameSpecific.startRoster ?? { units: [], buildings: [] };
    const enemyUnits     = (roster.units     ?? []).filter(u => u.ownerId !== myId);
    const enemyBuildings = (roster.buildings ?? []).filter(b => b.ownerId !== myId);
    belief = new Sc2Belief(myId, state.board, enemyUnits, enemyBuildings);
    byPlayer.set(myId, belief);
  }
  return belief;
}
