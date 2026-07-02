// ---------------------------------------------------------------------------
// Fog-of-war belief tracking for Civ2 — a stateful information-set tracker,
// sibling of tactical/belief.js and sc1/belief.js.
//
// Under fog getVisibleState hands the agent only its own units/cities plus
// enemies within VISION. This tracks:
//
//   • units  — per-unit possible-tile sets, expanded by `moves` each turn.
//   • cities — pinned exactly once spotted (they can't move, but can change
//              owner on capture); their size/shields/production are updated
//              on each subsequent sighting.
//
//   1. expand   — unseen units may have moved a full turn; flood-fill over
//                 domain-passable tiles (flat cost — a safe over-estimate,
//                 since roads/railroads only ever make movement cheaper).
//   2. collapse — pin visible enemies to their exact tile; erase from unseen
//                 units' sets any tile we can see but find empty; forget any
//                 tracked city we now hold ourselves (captured).
//   3. sample   — draw worlds placing unseen units from their possible sets
//                 and re-inserting known-but-currently-hidden enemy cities.
// ---------------------------------------------------------------------------

import { TERRAIN } from './terrain.js';
import { UNITS } from './units.js';

const VISION       = 2;   // matches getVisibleState
const MAX_POSSIBLE = 30;
const THREAT_BIAS  = 3;
const DIRS = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];

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

// Flood-fill up to `moves` steps over tiles passable for `domain`. Ignores
// terrain move-cost and roads (both only ever make real movement cheaper),
// so this is always a safe over-estimate of true reach.
function reachable(board, pos, moves, domain) {
  const seen = new Set([k(pos.x, pos.y)]);
  let frontier = [pos];
  const result = [];
  for (let step = 0; step < moves; step++) {
    const next = [];
    for (const { x, y } of frontier) {
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= board.width || ny < 0 || ny >= board.height) continue;
        const key = k(nx, ny);
        if (seen.has(key)) continue;
        const tile = board.tiles[key];
        const td = tile && TERRAIN[tile.terrain];
        if (!td?.passable?.[domain]) continue;
        seen.add(key);
        result.push({ x: nx, y: ny });
        next.push({ x: nx, y: ny });
      }
    }
    frontier = next;
  }
  return result;
}

export class Civ2Belief {
  // enemyUnits/enemyCities: snapshots from startRoster, filtered to enemy side.
  constructor(myId, board, enemyUnits, enemyCities) {
    this.myId  = myId;
    this.board = board;
    this.unitPieces = new Map(); // id -> { ownerId, type, possible:Set, anchor, alive, seen, hp }
    this.cityPieces = new Map(); // id -> { ownerId, name, position, size, shields, production, seen }

    for (const u of enemyUnits) {
      this.unitPieces.set(u.id, {
        ownerId: u.ownerId, type: u.type,
        possible: new Set([k(u.position.x, u.position.y)]),
        anchor: { ...u.position }, alive: true, seen: false,
        hp: u.hp ?? UNITS[u.type]?.hp ?? 1,
      });
    }
    for (const c of enemyCities) {
      this.cityPieces.set(c.id, {
        ownerId: c.ownerId, name: c.name, position: { ...c.position },
        size: c.size ?? 1, shields: c.shields ?? 0, production: c.production, seen: false,
      });
    }
    this.lastTurn = null;
  }

  _visible(myUnits, myCities, x, y) {
    return myUnits.some(m => cheby(x, y, m.position) <= VISION)
        || myCities.some(c => cheby(x, y, c.position) <= VISION);
  }

  _expand() {
    for (const pc of this.unitPieces.values()) {
      if (!pc.alive) continue;
      const stats  = UNITS[pc.type];
      const moves  = stats?.moves ?? 2;
      const domain = stats?.domain ?? 'land';
      const next = new Set(pc.possible);
      for (const key of pc.possible) {
        const [x, y] = coords(key);
        for (const t of reachable(this.board, { x, y }, moves, domain)) next.add(k(t.x, t.y));
      }
      pc.possible = next.size > MAX_POSSIBLE
        ? new Set([...next].sort((a, b) => {
            const [ax, ay] = coords(a), [bx, by] = coords(b);
            return cheby(ax, ay, pc.anchor) - cheby(bx, by, pc.anchor);
          }).slice(0, MAX_POSSIBLE))
        : next;
    }
  }

  _collapse(observation) {
    const myUnits  = observation.units.filter(u => u.alive && u.ownerId === this.myId);
    const myCities = observation.cities.filter(c => c.ownerId === this.myId);

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
        };
        this.unitPieces.set(u.id, pc);
      }
      pc.alive    = u.alive;
      pc.hp       = u.hp ?? pc.hp;
      pc.anchor   = { ...u.position };
      pc.possible = new Set([k(u.position.x, u.position.y)]);
      pc.seen     = true;
    }
    for (const [id, pc] of this.unitPieces) {
      if (seenUnitIds.has(id)) continue;
      pc.seen = false;
      if (!pc.alive) continue;
      for (const key of [...pc.possible]) {
        const [x, y] = coords(key);
        if (this._visible(myUnits, myCities, x, y)) pc.possible.delete(key);
      }
      if (pc.possible.size === 0) {
        const stats  = UNITS[pc.type];
        const hidden = reachable(this.board, pc.anchor, stats?.moves ?? 2, stats?.domain ?? 'land')
          .map(t => k(t.x, t.y))
          .filter(key => { const [x, y] = coords(key); return !this._visible(myUnits, myCities, x, y); });
        pc.possible = new Set(hidden.length ? hidden : [k(pc.anchor.x, pc.anchor.y)]);
      }
    }

    // Cities — pinned once spotted, never move; forget any we now hold ourselves.
    for (const c of observation.cities) {
      if (c.ownerId === this.myId) { this.cityPieces.delete(c.id); continue; }
      let pcty = this.cityPieces.get(c.id);
      if (!pcty) {
        pcty = { ownerId: c.ownerId, name: c.name, position: { ...c.position }, size: c.size, shields: c.shields, production: c.production, seen: false };
        this.cityPieces.set(c.id, pcty);
      }
      pcty.ownerId    = c.ownerId; // reflects capture by the other side
      pcty.size       = c.size ?? pcty.size;
      pcty.shields    = c.shields ?? pcty.shields;
      pcty.production = c.production ?? pcty.production;
      pcty.seen       = true;
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
   * enemy cities. `makeUnit(id, ownerId, type, x, y)` builds a full unit.
   */
  sample(observation, n, rng, makeUnit) {
    const myUnits  = observation.units.filter(u => u.alive && u.ownerId === this.myId);
    const myCities = observation.cities.filter(c => c.ownerId === this.myId);
    const seenUnitIds = new Set(observation.units.filter(u => u.ownerId !== this.myId).map(u => u.id));
    const seenCityIds = new Set(observation.cities.filter(c => c.ownerId !== this.myId).map(c => c.id));

    const hidden = [];
    for (const [id, pc] of this.unitPieces) if (pc.alive && !seenUnitIds.has(id)) hidden.push({ id, pc });

    const hiddenCities = [];
    for (const [id, pcty] of this.cityPieces) if (!seenCityIds.has(id)) hiddenCities.push({ id, pcty });

    if (hidden.length === 0 && hiddenCities.length === 0) return [];

    const occupiedBase = new Set(observation.units.filter(u => u.alive).map(u => k(u.position.x, u.position.y)));
    const worlds = [];

    for (let p = 0; p < n; p++) {
      const used   = new Set(occupiedBase);
      const placed = [];
      const order  = [...hidden].sort((a, b) => a.pc.possible.size - b.pc.possible.size);
      for (const { id, pc } of order) {
        const cands = [...pc.possible].filter(key => {
          const [x, y] = coords(key);
          return !used.has(key) && !this._visible(myUnits, myCities, x, y);
        });
        if (cands.length === 0) continue;
        const weights = cands.map(key => {
          const [x, y] = coords(key);
          const near = myUnits.some(m => cheby(x, y, m.position) <= VISION + 2);
          return (1 / (1 + cheby(x, y, pc.anchor))) * (near ? THREAT_BIAS : 1);
        });
        const key = weightedPick(cands, weights, rng);
        used.add(key);
        const [x, y] = coords(key);
        placed.push({ ...makeUnit(id, pc.ownerId, pc.type, x, y), hp: pc.hp, alive: true });
      }

      const placedCities = hiddenCities.map(({ id, pcty }) => ({
        id, name: pcty.name, ownerId: pcty.ownerId, position: { ...pcty.position },
        size: pcty.size, shields: pcty.shields, food: 0, production: pcty.production,
      }));

      worlds.push({
        ...observation,
        units:  [...observation.units, ...placed],
        cities: [...observation.cities, ...placedCities],
      });
    }
    return worlds;
  }
}

// ---------------------------------------------------------------------------
// Per-game belief store, keyed by the (stable) players array.
// ---------------------------------------------------------------------------

const beliefStore = new WeakMap();

export function getCiv2Belief(state, myId) {
  let byPlayer = beliefStore.get(state.players);
  if (!byPlayer) { byPlayer = new Map(); beliefStore.set(state.players, byPlayer); }
  let belief = byPlayer.get(myId);
  if (!belief) {
    const roster = state.gameSpecific.startRoster ?? { units: [], cities: [] };
    const enemyUnits  = (roster.units  ?? []).filter(u => u.ownerId !== myId);
    const enemyCities = (roster.cities ?? []).filter(c => c.ownerId !== myId);
    belief = new Civ2Belief(myId, state.board, enemyUnits, enemyCities);
    byPlayer.set(myId, belief);
  }
  return belief;
}
