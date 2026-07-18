// ---------------------------------------------------------------------------
// Fog-of-war belief tracking for CS — the stateful analogue of chess/belief.js.
//
// Under fog getVisibleState hands the agent only its own team plus enemies
// within sight. A naive sampler would scatter unseen enemies anywhere hidden;
// this instead maintains the *information set*: per enemy player, the set of
// tiles it could currently occupy, given everything we have legitimately
// observed (the common-knowledge round-start spawns, and every sighting since).
//
// Each of our turns we:
//   1. reset      — at the start of a new round every player respawns (common
//                   knowledge), so the belief collapses back to the spawns.
//   2. expand     — an unseen enemy may have moved one turn (up to MOVE_RANGE),
//                   so grow its possible-tile set by one BFS move of reach.
//   3. collapse   — reconcile with what we now see: pin enemies in view to their
//                   exact tile (and mark them dead if we see them die), and drop
//                   from every unseen enemy's set the tiles we can see but don't
//                   find it on.
//   4. sample     — draw concrete worlds, placing each believed-alive unseen
//                   enemy on a tile from its (now localised) possible set.
//
// Deaths we witness (a visible enemy at alive:false) are recorded; a death that
// happens entirely out of our sight cannot be confirmed under fog, so such an
// enemy stays in the belief — the residual over-estimation is bounded by the
// per-enemy possible-set cap and fades as the round resets.
// ---------------------------------------------------------------------------

import { isWalkable, getReachable, perimeterBlockShapes } from './map.js';
import { num, tilePos } from '../coord.js';
import { euclidean, seesPoint } from '../vision.js';
import { segmentClearOf } from '../terrainShapes.js';
import { SMOKE_RADIUS } from './weapons.js';

// Field-of-vision config, shared with CsGame.getVisibleState so the belief's visible set
// matches the observation exactly (see games/vision.js): Euclidean range (a circle,
// matching the design UI veil) + facing cone + line-of-sight blocked by walls (the
// authored wall shapes) and smoke clouds.
export const CS_VISION = { range: 4, fovDegrees: 90, metric: euclidean };

// The opaque shapes that block CS sight: the map border, its authored walls, and every
// active smoke cloud (an oval of SMOKE_RADIUS). Used both server-side and by the design
// UI's fog veil, so what the veil hides is exactly what the engine hides. The border strips
// matter because the map's perimeter wall is render-only (see map.js's perimeterWallShapes)
// — without them here, sight would carry on past the map edge into the void instead of
// stopping at it like movement already does (isWalkableContinuous).
export function csLosBlockers(map, smokeZones = []) {
  const out = [...perimeterBlockShapes(map.width, map.height)];
  for (const s of map.terrainShapes ?? [])
    if (s.tile === 'wall') out.push({ shape: s.shape, x: s.x, y: s.y, w: s.w, h: s.h });
  for (const sz of smokeZones) {
    const cx = num(sz.x), cy = num(sz.y);
    out.push({ shape: 'oval', x: cx - SMOKE_RADIUS, y: cy - SMOKE_RADIUS, w: 2 * SMOKE_RADIUS, h: 2 * SMOKE_RADIUS });
  }
  return out;
}

// CS_VISION plus a state-specific line-of-sight test (walls + smoke). Both getVisibleState
// and the belief sampler build this from the same map/smoke so they never drift.
export function csVisionCfg(map, smokeZones = []) {
  const blockers = csLosBlockers(map, smokeZones);
  return { ...CS_VISION, hasLOS: (ax, ay, bx, by) => segmentClearOf(ax, ay, bx, by, blockers) };
}

const FOG_VISION  = CS_VISION.range;   // matches getVisibleState
const MOVE_RANGE   = 4;  // a unit moves up to this far per turn
const MAX_POSSIBLE = 40; // cap a piece's possible-tile set so sampling stays cheap
const THREAT_BIAS  = 3;  // over-sample tiles near our players

const k = (x, y) => `${x},${y}`;
const coords = key => key.split(',').map(Number);
// `p` may be a belief tile ({x,y} Numbers) or a live unit position (BigNumbers), so
// read both coordinates in Number-space (see games/coord.js).
const cheby = (x, y, p) => Math.max(Math.abs(x - num(p.x)), Math.abs(y - num(p.y)));

function weightedPick(items, weights, rng) {
  let total = 0;
  for (const w of weights) total += w;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

export class CsBelief {
  constructor(myTeam, map) {
    this.myTeam = myTeam;
    this.enemyTeam = myTeam === 'T' ? 'CT' : 'T';
    this.map = map;
    this.pieces = new Map(); // id -> { possible:Set<key>, anchor:{x,y}, alive, seen }
    this.lastRound = null;
    this.lastTurn = null;
    this._seedSpawns();
  }

  _seedSpawns() {
    const spawns = this.enemyTeam === 'T' ? this.map.tSpawns : this.map.ctSpawns;
    this.pieces = new Map();
    spawns.forEach((p, i) => {
      this.pieces.set(`${this.enemyTeam}-${i}`, {
        possible: new Set([k(p.x, p.y)]), anchor: { x: p.x, y: p.y }, alive: true, seen: false,
      });
    });
  }

  // Tiles our team can currently see: within each live unit's Chebyshev range AND (once a
  // unit has a heading) its facing cone — the same seesPoint predicate getVisibleState uses.
  _visionSet(observation) {
    const vis = new Set();
    const cfg = csVisionCfg(this.map, observation.gameSpecific?.smokeZones ?? []);
    for (const m of observation.units) {
      if (!m.alive || m.ownerId !== this.myTeam) continue;
      const mt = tilePos(m.position);
      const viewer = { x: mt.x, y: mt.y, facing: m.facing, fov: m.fov, visionRange: m.visionRange };
      for (let dy = -FOG_VISION; dy <= FOG_VISION; dy++)
        for (let dx = -FOG_VISION; dx <= FOG_VISION; dx++) {
          const x = mt.x + dx, y = mt.y + dy;
          if (seesPoint(viewer, x, y, cfg)) vis.add(k(x, y));
        }
    }
    return vis;
  }

  // 2. Propagation: every unseen enemy may have advanced one move of reach.
  _expand() {
    for (const pc of this.pieces.values()) {
      if (!pc.alive) continue;
      const next = new Set(pc.possible); // staying put is always possible
      for (const key of pc.possible) {
        const [x, y] = coords(key);
        for (const t of getReachable(this.map.tiles, { x, y }, MOVE_RANGE, []))
          next.add(k(t.x, t.y));
      }
      pc.possible = next.size > MAX_POSSIBLE
        ? new Set([...next].sort((a, b) => {
            const [ax, ay] = coords(a), [bx, by] = coords(b);
            return cheby(ax, ay, pc.anchor) - cheby(bx, by, pc.anchor);
          }).slice(0, MAX_POSSIBLE))
        : next;
    }
  }

  // 3. Collapse: reconcile the belief with what we actually observe this turn.
  _collapse(observation) {
    const vis = this._visionSet(observation);
    const seenNow = new Set();
    for (const u of observation.units) {
      if (u.ownerId !== this.enemyTeam) continue;
      seenNow.add(u.id);
      const ut = tilePos(u.position); // belief lives in integer tile-space
      const pc = this.pieces.get(u.id) ?? { possible: new Set(), anchor: ut, alive: true, seen: false };
      pc.alive = u.alive;                                // we see it live or dead
      pc.anchor = ut;
      pc.possible = new Set([k(ut.x, ut.y)]);            // pinned to its tile
      pc.seen = true;
      this.pieces.set(u.id, pc);
    }
    for (const [id, pc] of this.pieces) {
      if (seenNow.has(id)) continue;
      pc.seen = false;
      if (!pc.alive) continue;
      // An unseen enemy is on no tile we can currently see (else we'd spot it).
      for (const key of [...pc.possible]) if (vis.has(key)) pc.possible.delete(key);
      if (pc.possible.size === 0) {
        // Belief contradiction (over-pruned): fall back to hidden tiles reachable
        // from its anchor, or the anchor itself.
        const reach = getReachable(this.map.tiles, pc.anchor, MOVE_RANGE, [])
          .map(t => k(t.x, t.y)).filter(key => !vis.has(key));
        pc.possible = new Set(reach.length ? reach : [k(pc.anchor.x, pc.anchor.y)]);
      }
    }
  }

  // Full per-turn update, run before the agent samples.
  beginTurn(observation) {
    const gs = observation.gameSpecific;
    if (gs.roundNumber !== this.lastRound) {
      this._seedSpawns();                 // 1. everyone respawned
      this.lastRound = gs.roundNumber;
      this.lastTurn = observation.turnNumber;
      this._collapse(observation);
      return;
    }
    if (observation.turnNumber !== this.lastTurn) {
      this._expand();                     // 2. one enemy turn has elapsed
      this.lastTurn = observation.turnNumber;
    }
    this._collapse(observation);          // 3.
  }

  /**
   * 4. Draw up to `n` concrete worlds. Each is the observed state plus a
   * plausible placement of every believed-alive, currently-unseen enemy, taken
   * from its possible-tile set — most-constrained enemies placed first, tiles
   * nearer their last sighting and threatening our players favoured. `makeUnit`
   * builds a full enemy unit (passed in to avoid a circular import).
   */
  sample(observation, n, rng, makeUnit) {
    const vis = this._visionSet(observation);
    const seenIds = new Set(observation.units.filter(u => u.ownerId === this.enemyTeam).map(u => u.id));
    const myUnits = observation.units.filter(u => u.alive && u.ownerId === this.myTeam);

    const hidden = [];
    for (const [id, pc] of this.pieces) if (pc.alive && !seenIds.has(id)) hidden.push({ id, pc });
    if (hidden.length === 0) return [];

    const occupiedBase = new Set(observation.units.filter(u => u.alive).map(u => { const t = tilePos(u.position); return k(t.x, t.y); }));
    const worlds = [];
    for (let p = 0; p < n; p++) {
      const used = new Set(occupiedBase);
      const placed = [];
      // Most-constrained enemies first, so tight beliefs claim their tile.
      const order = [...hidden].sort((a, b) => a.pc.possible.size - b.pc.possible.size);
      for (const { id, pc } of order) {
        const cands = [...pc.possible].filter(key => {
          const [x, y] = coords(key);
          return !vis.has(key) && !used.has(key) && isWalkable(this.map.tiles, x, y);
        });
        if (cands.length === 0) continue; // leave this enemy off this world
        const weights = cands.map(key => {
          const [x, y] = coords(key);
          const near = myUnits.some(m => cheby(x, y, m.position) <= FOG_VISION + 3);
          return (1 / (1 + cheby(x, y, pc.anchor))) * (near ? THREAT_BIAS : 1);
        });
        const key = weightedPick(cands, weights, rng);
        used.add(key);
        const [x, y] = coords(key);
        placed.push(makeUnit(id, this.enemyTeam, { x, y }));
      }
      worlds.push({ ...observation, units: [...observation.units, ...placed] });
    }
    return worlds;
  }
}

// ---------------------------------------------------------------------------
// Per-game belief store, keyed by the (stable) players array so each game — and
// each team within it — keeps its own belief, and a new game starts fresh.
// ---------------------------------------------------------------------------

const beliefStore = new WeakMap();

export function getCsBelief(state, myTeam) {
  let byTeam = beliefStore.get(state.players);
  if (!byTeam) { byTeam = new Map(); beliefStore.set(state.players, byTeam); }
  let belief = byTeam.get(myTeam);
  if (!belief) { belief = new CsBelief(myTeam, state.gameSpecific.map); byTeam.set(myTeam, belief); }
  return belief;
}
