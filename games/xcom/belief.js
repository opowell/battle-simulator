// ---------------------------------------------------------------------------
// Fog-of-war belief tracking for X-Com — a stateful information-set tracker,
// sibling of chess/belief.js, cs/belief.js and tactical/belief.js.
//
// Under fog getVisibleState reveals only our own units plus enemies within
// VISION *and* line of sight. This maintains, per enemy unit, the set of tiles
// it could occupy given the common-knowledge starting deployment
// (gameSpecific.startRoster) and every sighting since.
//
//   1. expand   — an unseen enemy may have spent a whole turn moving; with maxAP
//                 activations of moveRange each, grow its possible set by that
//                 full reach (we over- rather than under-estimate, so the agent
//                 stays wary of an unseen flank).
//   2. collapse — pin enemies in view to their exact tile (updating hp, marking
//                 witnessed deaths), and drop from every unseen enemy's set the
//                 tiles we can currently see (VISION + LOS) but don't find it on.
//   3. sample   — draw worlds, placing each believed-alive unseen enemy from its
//                 localised possible set.
// ---------------------------------------------------------------------------

import { getReachable } from './grid.js';
import { hasLOS } from './los.js';

const VISION       = 5;   // matches getVisibleState
const MAX_POSSIBLE = 40;  // cap a unit's possible-tile set so sampling stays cheap
const THREAT_BIAS  = 3;   // over-sample tiles near our units

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

export class XcomBelief {
  constructor(myId, enemyRoster, board) {
    this.myId = myId;
    this.board = board;
    this.pieces = new Map(); // id -> { ownerId, type, possible:Set, anchor, alive, seen, hp, reach }
    for (const u of enemyRoster) {
      this.pieces.set(u.id, {
        ownerId: u.ownerId, type: u.type,
        possible: new Set([k(u.position.x, u.position.y)]),
        anchor: { ...u.position }, alive: true, seen: false,
        hp: u.hp ?? 1,
        reach: Math.max(1, (u.moveRange ?? 3) * (u.maxAP ?? 2)), // full per-turn travel
      });
    }
    this.lastTurn = null;
  }

  // A tile is visible to us if some live unit is within VISION and has LOS to it.
  _visible(myUnits, x, y) {
    return myUnits.some(m =>
      cheby(x, y, m.position) <= VISION && hasLOS(this.board, m.position, { x, y }));
  }

  // 1. Propagation: every unseen enemy may have moved a full turn of reach.
  _expand() {
    const empty = [];
    for (const pc of this.pieces.values()) {
      if (!pc.alive) continue;
      const next = new Set(pc.possible); // staying put is always possible
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

  // 2. Collapse: reconcile the belief with what we actually observe this turn.
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

  /**
   * Draw up to `n` worlds; place every believed-alive, unseen enemy from its
   * possible set (most-constrained first; tiles nearer the last sighting and
   * threatening our units favoured). `makeUnit(id, ownerId, type, x, y)` builds
   * a full unit; we override its hp with the last-seen value.
   */
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

export function getXcomBelief(state, myId) {
  let byPlayer = beliefStore.get(state.players);
  if (!byPlayer) { byPlayer = new Map(); beliefStore.set(state.players, byPlayer); }
  let belief = byPlayer.get(myId);
  if (!belief) {
    const roster = (state.gameSpecific.startRoster ?? []).filter(u => u.ownerId !== myId);
    belief = new XcomBelief(myId, roster, state.board);
    byPlayer.set(myId, belief);
  }
  return belief;
}
