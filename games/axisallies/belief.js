// ---------------------------------------------------------------------------
// Fog-of-war belief tracking for Axis & Allies — a stateful information-set
// tracker, sibling of tactical/belief.js (grid) and sc1/belief.js (dynamic
// registration of units placed mid-game via production).
//
// Axis & Allies has no hidden ownership — territory control is always public,
// same as the real board game. What a video-game-style fog variant hides is
// the *composition of enemy garrisons* sitting in territories you have no
// presence near: getVisibleState reveals your own units plus enemy units in
// any territory you occupy or that is adjacent (board.adj) to one you occupy.
//
// Instead of a tile grid, the possible-location set for each unseen enemy
// unit is a set of territory ids reached by BFS over the ADJACENCY graph,
// hopping `unit.moves` edges per elapsed turn (always over- rather than
// under-estimate reach, mirroring tactical/sc1).
//
//   1. expand   — an unseen enemy may have moved a full turn (moves hops),
//                 so grow its possible-territory set by one such move.
//   2. collapse — pin enemies in territories we can now see to that exact
//                 territory (updating hp, marking witnessed deaths); register
//                 any newly-sighted enemy unit we've never tracked before
//                 (mobilization places new units mid-game, sc1-style); drop
//                 from every unseen unit's set the territories we can see but
//                 don't find it in.
//   3. sample   — draw worlds, placing each believed-alive unseen enemy on a
//                 territory from its (localised) possible set.
// ---------------------------------------------------------------------------

import { UNITS } from './units.js';
import { ADJACENCY } from './territories.js';

const MAX_POSSIBLE = 30;  // cap a unit's possible-territory set so sampling stays cheap
const THREAT_BIAS   = 3;  // over-sample territories near our units

function weightedPick(items, weights, rng) {
  let total = 0;
  for (const w of weights) total += w;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

// BFS over the territory-adjacency graph, `hops` edges out from `start`.
// Domain isn't enforced here (fog tracking need only over-approximate reach;
// the sampled placement is a plausible garrison location, not a move it must
// legally be able to execute unaided).
function graphReachable(start, hops) {
  if (hops <= 0) return [start];
  const dist = new Map([[start, 0]]);
  const queue = [start];
  while (queue.length) {
    const t = queue.shift();
    const d = dist.get(t);
    if (d >= hops) continue;
    for (const adj of (ADJACENCY[t] || [])) {
      if (dist.has(adj)) continue;
      dist.set(adj, d + 1);
      queue.push(adj);
    }
  }
  return [...dist.keys()];
}

function movesOf(type) {
  return UNITS[type]?.moves ?? 1;
}

export class AxisAlliesBelief {
  constructor(myId, enemyRoster) {
    this.myId = myId;
    this.pieces = new Map(); // id -> { ownerId, type, possible:Set<territory>, anchor, alive, seen, hp }
    for (const u of enemyRoster) {
      this.pieces.set(u.id, {
        ownerId: u.ownerId, type: u.type,
        possible: new Set([u.territory]),
        anchor: u.territory, alive: true, seen: false,
        hp: u.hp ?? UNITS[u.type]?.hp ?? 1,
      });
    }
    this.lastTurn = null;
  }

  // A territory is visible to us if we occupy it or occupy one adjacent to it.
  _visibleSet(myTerritories) {
    const vis = new Set(myTerritories);
    for (const t of myTerritories) for (const adj of (ADJACENCY[t] || [])) vis.add(adj);
    return vis;
  }

  // 1. Expand: every unseen enemy may have moved a full turn (its `moves` stat).
  _expand() {
    for (const pc of this.pieces.values()) {
      if (!pc.alive) continue;
      const hops = movesOf(pc.type);
      const next = new Set(pc.possible); // staying put is always possible
      for (const t of pc.possible) for (const r of graphReachable(t, hops)) next.add(r);
      pc.possible = next.size > MAX_POSSIBLE
        ? new Set([...next].slice(0, MAX_POSSIBLE)) // arbitrary but bounded; anchor stays included via BFS order
        : next;
      pc.possible.add(pc.anchor);
    }
  }

  // 2. Collapse: reconcile the belief with what we actually observe this turn.
  _collapse(observation) {
    const myTerritories = [...new Set(
      observation.units.filter(u => u.alive && u.ownerId === this.myId).map(u => u.territory)
    )];
    const vis = this._visibleSet(myTerritories);

    const seenNow = new Set();
    for (const u of observation.units) {
      if (u.ownerId === this.myId) continue;
      seenNow.add(u.id);
      let pc = this.pieces.get(u.id);
      if (!pc) {
        // Newly sighted unit we've never tracked — e.g. mobilized mid-game.
        pc = { ownerId: u.ownerId, type: u.type, possible: new Set(), anchor: u.territory, alive: true, seen: false, hp: u.hp ?? 1 };
        this.pieces.set(u.id, pc);
      }
      pc.alive = u.alive;
      pc.hp = u.hp ?? pc.hp;
      pc.anchor = u.territory;
      pc.possible = new Set([u.territory]); // pinned exactly
      pc.seen = true;
    }
    for (const [id, pc] of this.pieces) {
      if (seenNow.has(id)) continue;
      pc.seen = false;
      if (!pc.alive) continue;
      // An unseen enemy is on no territory we can see (else we'd spot it).
      for (const t of [...pc.possible]) if (vis.has(t)) pc.possible.delete(t);
      if (pc.possible.size === 0) {
        const hops = movesOf(pc.type);
        const reach = graphReachable(pc.anchor, hops).filter(t => !vis.has(t));
        pc.possible = new Set(reach.length ? reach : [pc.anchor]);
      }
    }
  }

  beginTurn(observation) {
    if (observation.turnNumber !== this.lastTurn) {
      if (this.lastTurn !== null) this._expand(); // a turn has elapsed since we last looked
      this.lastTurn = observation.turnNumber;
    }
    this._collapse(observation);
  }

  /**
   * Draw up to `n` worlds. Each is the observed state plus a plausible
   * placement of every believed-alive, currently-unseen enemy unit, taken
   * from its possible-territory set (most-constrained first; territories
   * nearer our units favoured as more threatening / more likely garrisoned).
   * `makeUnit(id, ownerId, type, territory)` builds a full unit; we override
   * its hp with the last-seen value.
   */
  sample(observation, n, rng, makeUnit) {
    const myTerritories = [...new Set(
      observation.units.filter(u => u.alive && u.ownerId === this.myId).map(u => u.territory)
    )];
    const vis = this._visibleSet(myTerritories);
    const seenIds = new Set(observation.units.filter(u => u.ownerId !== this.myId).map(u => u.id));

    const hiddenEntries = [];
    for (const [id, pc] of this.pieces) if (pc.alive && !seenIds.has(id)) hiddenEntries.push({ id, pc });
    if (hiddenEntries.length === 0) return [];

    const worlds = [];
    for (let p = 0; p < n; p++) {
      const placed = [];
      const order = [...hiddenEntries].sort((a, b) => a.pc.possible.size - b.pc.possible.size);
      for (const { id, pc } of order) {
        const cands = [...pc.possible].filter(t => !vis.has(t) && ADJACENCY[t] !== undefined);
        if (cands.length === 0) continue;
        const weights = cands.map(t => {
          const near = myTerritories.some(m => (ADJACENCY[m] || []).includes(t) || m === t);
          return (t === pc.anchor ? 2 : 1) * (near ? THREAT_BIAS : 1);
        });
        const territory = weightedPick(cands, weights, rng);
        placed.push({ ...makeUnit(id, pc.ownerId, pc.type, territory), hp: pc.hp, alive: true });
      }
      worlds.push({ ...observation, units: [...observation.units, ...placed] });
    }
    return worlds;
  }
}

// ---------------------------------------------------------------------------
// Per-game belief store, keyed by the (stable) players array so each game —
// and each player within it — keeps its own belief, and a new game starts
// fresh.
// ---------------------------------------------------------------------------

const beliefStore = new WeakMap();

export function getAxisAlliesBelief(state, myId) {
  let byPlayer = beliefStore.get(state.players);
  if (!byPlayer) { byPlayer = new Map(); beliefStore.set(state.players, byPlayer); }
  let belief = byPlayer.get(myId);
  if (!belief) {
    const roster = (state.gameSpecific.startRoster ?? []).filter(u => u.ownerId !== myId);
    belief = new AxisAlliesBelief(myId, roster);
    byPlayer.set(myId, belief);
  }
  return belief;
}
