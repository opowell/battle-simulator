// ---------------------------------------------------------------------------
// Fog-of-war belief tracking for Final Fantasy Tactics Advance — a stateful
// information-set tracker, sibling of tactical/belief.js and aow/belief.js.
//
// Under fog getVisibleState hands the agent only its own units plus enemies
// within VISION. This maintains, per enemy unit, the set of tiles it could
// currently occupy given the common-knowledge starting deployment
// (gameSpecific.startRoster) and every sighting since.
//
//   1. expand   — an unseen enemy may have moved one turn, so grow its
//                 possible-tile set by one move of reach (4-directional,
//                 flat cost — a safe over-estimate since real movement also
//                 pays extra for climbing height).
//   2. collapse — pin enemies in view to their exact tile (updating hp,
//                 marking deaths), and drop tiles we can see but don't find
//                 them on from every unseen enemy's set.
//   3. sample   — draw concrete worlds, placing each believed-alive unseen
//                 enemy on a tile from its (localised) possible set.
// ---------------------------------------------------------------------------

import { getTile } from './map.js';
import { JOB_DEFS } from './units.js';
import { chebyshev, seesPoint } from '../vision.js';

// Field-of-vision config, shared with FFTAGame.getVisibleState. FFTA units always carry a
// cardinal `facing` (used for attack-direction bonuses too), so vision is a 90° cone by
// default — see games/vision.js.
export const FFTA_VISION = { range: 2, fovDegrees: 90, metric: chebyshev };

const VISION       = FFTA_VISION.range;   // matches getVisibleState
const MAX_POSSIBLE = 30;
const THREAT_BIAS  = 3;
const DIRS = [[-1,0],[1,0],[0,-1],[0,1]]; // orthogonal only, matches grid.js

const k      = (x, y) => `${x},${y}`;
const coords = key   => key.split(',').map(Number);
const cheby  = (x, y, p) => Math.max(Math.abs(x - p.x), Math.abs(y - p.y));
const moveRangeOf = job => JOB_DEFS[job]?.moveRange ?? 3;

function weightedPick(items, weights, rng) {
  let total = 0;
  for (const w of weights) total += w;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

// Flood-fill up to `range` orthogonal steps over passable tiles. Ignores the
// extra height-climb cost real movement pays, so this always over-estimates
// true reach.
function reachable(board, pos, range) {
  const seen = new Set([k(pos.x, pos.y)]);
  let frontier = [pos];
  const result = [];
  for (let step = 0; step < range; step++) {
    const next = [];
    for (const { x, y } of frontier) {
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        const key = k(nx, ny);
        if (seen.has(key)) continue;
        if (!getTile(board, nx, ny).passable) continue;
        seen.add(key);
        result.push({ x: nx, y: ny });
        next.push({ x: nx, y: ny });
      }
    }
    frontier = next;
  }
  return result;
}

export class FftaBelief {
  constructor(myId, enemyRoster, board) {
    this.myId = myId;
    this.board = board;
    this.pieces = new Map(); // id -> { ownerId, job, possible:Set, anchor, alive, seen, hp }
    for (const u of enemyRoster) {
      this.pieces.set(u.id, {
        ownerId: u.ownerId, job: u.job,
        possible: new Set([k(u.position.x, u.position.y)]),
        anchor: { ...u.position }, alive: true, seen: false,
        hp: u.hp ?? JOB_DEFS[u.job]?.stats?.hp ?? 1,
      });
    }
    this.lastTurn = null;
  }

  _visionSet(observation) {
    const vis = new Set();
    for (const m of observation.units) {
      if (!m.alive || m.ownerId !== this.myId) continue;
      const viewer = { x: m.position.x, y: m.position.y, facing: m.facing, fov: m.fov, visionRange: m.visionRange };
      for (let dy = -VISION; dy <= VISION; dy++)
        for (let dx = -VISION; dx <= VISION; dx++) {
          const x = m.position.x + dx, y = m.position.y + dy;
          if (seesPoint(viewer, x, y, FFTA_VISION)) vis.add(k(x, y));
        }
    }
    return vis;
  }

  _expand() {
    for (const pc of this.pieces.values()) {
      if (!pc.alive) continue;
      const range = moveRangeOf(pc.job);
      const next = new Set(pc.possible);
      for (const key of pc.possible) {
        const [x, y] = coords(key);
        for (const t of reachable(this.board, { x, y }, range)) next.add(k(t.x, t.y));
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
    const vis = this._visionSet(observation);
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
      for (const key of [...pc.possible]) if (vis.has(key)) pc.possible.delete(key);
      if (pc.possible.size === 0) {
        const range = moveRangeOf(pc.job);
        const reach = reachable(this.board, pc.anchor, range)
          .map(t => k(t.x, t.y)).filter(key => !vis.has(key));
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
   * Draw up to `n` worlds. `makeUnit(id, job, ownerId, position)` builds a
   * full unit; we override its hp with the last-seen value.
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
        placed.push({ ...makeUnit(id, pc.job, pc.ownerId, { x, y }), hp: pc.hp, alive: true });
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

export function getFftaBelief(state, myId) {
  let byPlayer = beliefStore.get(state.players);
  if (!byPlayer) { byPlayer = new Map(); beliefStore.set(state.players, byPlayer); }
  let belief = byPlayer.get(myId);
  if (!belief) {
    const roster = (state.gameSpecific.startRoster ?? []).filter(u => u.ownerId !== myId);
    belief = new FftaBelief(myId, roster, state.board);
    byPlayer.set(myId, belief);
  }
  return belief;
}
