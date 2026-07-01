// ---------------------------------------------------------------------------
// Fog-of-war belief tracking for Combat Mission — mirrors xcom/belief.js.
//
// Each enemy starts at its known deployment position (startRoster).  Per turn:
//   1. expand   — unseen enemies may have spent a full turn moving (moveRange × ap tiles)
//   2. collapse — pin visible enemies to their exact tile; remove tiles we can
//                 now see from the possible sets of unseen enemies
//   3. sample   — draw worlds placing each unseen enemy from its possible set
// ---------------------------------------------------------------------------

import { getReachable } from './grid.js';
import { hasLOS } from './los.js';

const VISION       = 5;
const MAX_POSSIBLE = 40;
const THREAT_BIAS  = 3;

const k = (x, y) => `${x},${y}`;
const coords = key => key.split(',').map(Number);
const cheby = (x, y, p) => Math.max(Math.abs(x - p.x), Math.abs(y - p.y));

function weightedPick(items, weights, rng) {
  let total = 0;
  for (const w of weights) total += w;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

export class CombatMissionBelief {
  constructor(myId, enemyRoster, board) {
    this.myId = myId;
    this.board = board;
    this.pieces = new Map();
    for (const u of enemyRoster) {
      this.pieces.set(u.id, {
        ownerId: u.ownerId, type: u.type,
        possible: new Set([k(u.position.x, u.position.y)]),
        anchor: { ...u.position }, alive: true, seen: false,
        hp: u.hp ?? 1,
        reach: Math.max(1, (u.moveRange ?? 2) * (u.maxAP ?? 2)),
      });
    }
    this.lastTurn = null;
  }

  _visible(myUnits, x, y) {
    return myUnits.some(m =>
      cheby(x, y, m.position) <= VISION && hasLOS(this.board, m.position, { x, y }));
  }

  _expand() {
    const empty = [];
    for (const pc of this.pieces.values()) {
      if (!pc.alive) continue;
      const next = new Set(pc.possible);
      for (const key of pc.possible) {
        const [x, y] = coords(key);
        for (const t of getReachable(this.board, { x, y }, pc.reach, empty)) next.add(k(t.x, t.y));
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
    const myUnits = observation.units.filter(u => u.alive && u.ownerId === this.myId);
    const seenNow = new Set();
    for (const u of observation.units) {
      if (u.ownerId === this.myId) continue;
      const pc = this.pieces.get(u.id);
      if (!pc) continue;
      seenNow.add(u.id);
      pc.alive = u.alive;
      pc.hp = u.hp ?? pc.hp;
      pc.anchor = { ...u.position };
      pc.possible = new Set([k(u.position.x, u.position.y)]);
      pc.seen = true;
    }
    for (const [id, pc] of this.pieces) {
      if (seenNow.has(id)) continue;
      pc.seen = false;
      if (!pc.alive) continue;
      for (const key of [...pc.possible]) {
        const [x, y] = coords(key);
        if (this._visible(myUnits, x, y)) pc.possible.delete(key);
      }
      if (pc.possible.size === 0) {
        const reach = getReachable(this.board, pc.anchor, pc.reach, [])
          .map(t => k(t.x, t.y)).filter(key => { const [x, y] = coords(key); return !this._visible(myUnits, x, y); });
        pc.possible = new Set(reach.length ? reach : [k(pc.anchor.x, pc.anchor.y)]);
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

  sample(observation, n, rng, makeUnit) {
    const myUnits = observation.units.filter(u => u.alive && u.ownerId === this.myId);
    const seenIds = new Set(observation.units.filter(u => u.ownerId !== this.myId).map(u => u.id));

    const hidden = [];
    for (const [id, pc] of this.pieces) if (pc.alive && !seenIds.has(id)) hidden.push({ id, pc });
    if (hidden.length === 0) return [];

    const occupiedBase = new Set(observation.units.filter(u => u.alive).map(u => k(u.position.x, u.position.y)));
    const worlds = [];
    for (let p = 0; p < n; p++) {
      const used = new Set(occupiedBase);
      const placed = [];
      const order = [...hidden].sort((a, b) => a.pc.possible.size - b.pc.possible.size);
      for (const { id, pc } of order) {
        const cands = [...pc.possible].filter(key => {
          const [x, y] = coords(key);
          return !used.has(key) && !this._visible(myUnits, x, y);
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
      worlds.push({ ...observation, units: [...observation.units, ...placed] });
    }
    return worlds;
  }
}

// ---------------------------------------------------------------------------
// Per-game belief store, keyed by the (stable) players array.
// ---------------------------------------------------------------------------

const beliefStore = new WeakMap();

export function getCombatMissionBelief(state, myId) {
  let byPlayer = beliefStore.get(state.players);
  if (!byPlayer) { byPlayer = new Map(); beliefStore.set(state.players, byPlayer); }
  let belief = byPlayer.get(myId);
  if (!belief) {
    const roster = (state.gameSpecific.startRoster ?? []).filter(u => u.ownerId !== myId);
    belief = new CombatMissionBelief(myId, roster, state.board);
    byPlayer.set(myId, belief);
  }
  return belief;
}
