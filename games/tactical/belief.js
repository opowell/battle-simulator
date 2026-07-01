// ---------------------------------------------------------------------------
// Fog-of-war belief tracking for Tactical — a stateful information-set tracker,
// sibling of chess/belief.js and cs/belief.js.
//
// Under fog getVisibleState hands the agent only its own units plus enemies
// within VISION. This maintains, per enemy unit, the set of tiles it could
// currently occupy given everything we have observed: the common-knowledge
// starting deployment (gameSpecific.startRoster) and every sighting since.
//
// Each of our turns we:
//   1. expand   — an unseen enemy may have moved one turn (up to its moveRange),
//                 so grow its possible-tile set by one move of reach.
//   2. collapse — reconcile with what we now see: pin enemies in view to their
//                 exact tile (updating their hp, and marking them dead if we see
//                 them die), and drop from every unseen enemy's set the tiles we
//                 can see but don't find it on.
//   3. sample   — draw concrete worlds, placing each believed-alive unseen enemy
//                 on a tile from its (localised) possible set.
//
// There are no rounds/respawns, so unlike CS the belief simply accumulates over
// the single battle. A death witnessed in view is recorded; a death entirely
// out of sight cannot be confirmed under fog (bounded by the possible-set cap).
// ---------------------------------------------------------------------------

import { reachableSquares } from './grid.js';
import { UNIT_STATS } from './combat.js';

const VISION       = 2;   // matches getVisibleState
const MAX_POSSIBLE = 30;  // cap a unit's possible-tile set so sampling stays cheap
const THREAT_BIAS  = 3;   // over-sample tiles near our units

const k = (x, y) => `${x},${y}`;
const coords = key => key.split(',').map(Number);
const cheby = (x, y, p) => Math.max(Math.abs(x - p.x), Math.abs(y - p.y));
const moveRangeOf = type => UNIT_STATS[type]?.moveRange ?? 2;

function weightedPick(items, weights, rng) {
  let total = 0;
  for (const w of weights) total += w;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

export class TacticalBelief {
  constructor(myId, enemyRoster, board) {
    this.myId = myId;
    this.board = board;
    this.pieces = new Map(); // id -> { ownerId, type, possible:Set, anchor, alive, seen, hp }
    for (const u of enemyRoster) {
      this.pieces.set(u.id, {
        ownerId: u.ownerId, type: u.type,
        possible: new Set([k(u.position.x, u.position.y)]),
        anchor: { ...u.position }, alive: true, seen: false,
        hp: u.hp ?? UNIT_STATS[u.type]?.maxHp ?? 1,
      });
    }
    this.lastTurn = null;
  }

  _visionSet(observation) {
    const vis = new Set();
    for (const m of observation.units) {
      if (!m.alive || m.ownerId !== this.myId) continue;
      for (let dy = -VISION; dy <= VISION; dy++)
        for (let dx = -VISION; dx <= VISION; dx++)
          vis.add(k(m.position.x + dx, m.position.y + dy));
    }
    return vis;
  }

  // 1. Propagation: every unseen enemy may have advanced one move of reach.
  _expand() {
    const empty = new Set();
    for (const pc of this.pieces.values()) {
      if (!pc.alive) continue;
      const range = moveRangeOf(pc.type);
      const next = new Set(pc.possible); // staying put is always possible
      for (const key of pc.possible) {
        const [x, y] = coords(key);
        for (const t of reachableSquares({ x, y }, range, this.board, empty)) next.add(k(t.x, t.y));
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
    const vis = this._visionSet(observation);
    const seenNow = new Set();
    for (const u of observation.units) {
      if (u.ownerId === this.myId) continue;
      const pc = this.pieces.get(u.id);
      if (!pc) continue; // not part of the known roster
      seenNow.add(u.id);
      pc.alive = u.alive;
      pc.hp = u.hp ?? pc.hp;
      pc.anchor = { ...u.position };
      pc.possible = new Set([k(u.position.x, u.position.y)]); // pinned exactly
      pc.seen = true;
    }
    for (const [id, pc] of this.pieces) {
      if (seenNow.has(id)) continue;
      pc.seen = false;
      if (!pc.alive) continue;
      // An unseen enemy is on no tile we can see (else we'd spot it).
      for (const key of [...pc.possible]) if (vis.has(key)) pc.possible.delete(key);
      if (pc.possible.size === 0) {
        const reach = reachableSquares(pc.anchor, moveRangeOf(pc.type), this.board, new Set())
          .map(t => k(t.x, t.y)).filter(key => !vis.has(key));
        pc.possible = new Set(reach.length ? reach : [k(pc.anchor.x, pc.anchor.y)]);
      }
    }
  }

  beginTurn(observation) {
    if (observation.turnNumber !== this.lastTurn) {
      if (this.lastTurn !== null) this._expand(); // an enemy turn has elapsed
      this.lastTurn = observation.turnNumber;
    }
    this._collapse(observation);
  }

  /**
   * Draw up to `n` worlds. Each is the observed state plus a plausible placement
   * of every believed-alive, currently-unseen enemy, taken from its possible-tile
   * set (most-constrained first; tiles nearer the last sighting and threatening
   * our units favoured). `makeUnit(id, ownerId, type, x, y)` builds a full unit;
   * we override its hp with the last-seen value.
   */
  sample(observation, n, rng, makeUnit) {
    const vis = this._visionSet(observation);
    const seenIds = new Set(observation.units.filter(u => u.ownerId !== this.myId).map(u => u.id));
    const myUnits = observation.units.filter(u => u.alive && u.ownerId === this.myId);

    const hiddenEntries = [];
    for (const [id, pc] of this.pieces) if (pc.alive && !seenIds.has(id)) hiddenEntries.push({ id, pc });
    if (hiddenEntries.length === 0) return [];

    const occupiedBase = new Set(observation.units.filter(u => u.alive).map(u => k(u.position.x, u.position.y)));
    const worlds = [];
    for (let p = 0; p < n; p++) {
      const used = new Set(occupiedBase);
      const placed = [];
      const order = [...hiddenEntries].sort((a, b) => a.pc.possible.size - b.pc.possible.size);
      for (const { id, pc } of order) {
        const cands = [...pc.possible].filter(key => !vis.has(key) && !used.has(key));
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
// Per-game belief store, keyed by the (stable) players array so each game — and
// each player within it — keeps its own belief, and a new game starts fresh.
// ---------------------------------------------------------------------------

const beliefStore = new WeakMap();

export function getTacticalBelief(state, myId) {
  let byPlayer = beliefStore.get(state.players);
  if (!byPlayer) { byPlayer = new Map(); beliefStore.set(state.players, byPlayer); }
  let belief = byPlayer.get(myId);
  if (!belief) {
    const roster = (state.gameSpecific.startRoster ?? []).filter(u => u.ownerId !== myId);
    belief = new TacticalBelief(myId, roster, state.board);
    byPlayer.set(myId, belief);
  }
  return belief;
}
