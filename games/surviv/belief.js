// ---------------------------------------------------------------------------
// Fog-of-war belief tracking for surviv — adapted from games/cs/belief.js (see that
// file's header for the general seed/expand/collapse/sample recipe). Two differences
// from CS:
//   1. No rounds — surviv is one continuous life-or-death match, so the belief seeds
//      spawns once (at construction) and only ever expands/collapses, never resets.
//   2. Bush concealment — a unit standing in a bush is invisible beyond
//      BUSH_SPOT_RANGE even to a viewer whose range/cone/LOS would otherwise spot it
//      (see isInBush in map.js). getVisibleState and the belief's spot-set MUST agree
//      on this or the Obscuro AI hallucinates/loses enemies at bush edges (the same
//      "phantom enemy" crash class CS's belief.js header describes) — both build from
//      survivVisionCfg + the same bush check below.
// ---------------------------------------------------------------------------

import { isWalkable, getReachable, isInBush } from './map.js';
import { num, tilePos } from '../coord.js';
import { euclidean, seesPoint, viewersOf } from '../vision.js';
import { segmentClearOf } from '../terrainShapes.js';
import { BUSH_SPOT_RANGE, MOVE_RANGE } from './weapons.js';

export const SURVIV_VISION = { range: 5, fovDegrees: 110, metric: euclidean };

// The opaque shapes that block surviv sight: forest, buildings, crates, barrels, water —
// every terrain shape whose tile is 'wall'. Bushes are deliberately excluded (they're
// walkable and don't block sight of what's past them — only conceal a unit inside).
export function survivLosBlockers(map) {
  const out = [];
  for (const s of map.terrainShapes ?? [])
    if (s.tile === 'wall') out.push({ shape: s.shape, x: s.x, y: s.y, w: s.w, h: s.h });
  return out;
}

export function survivVisionCfg(map) {
  const blockers = survivLosBlockers(map);
  return { ...SURVIV_VISION, hasLOS: (ax, ay, bx, by) => segmentClearOf(ax, ay, bx, by, blockers) };
}

// True when `viewer` would actually spot a unit standing at (x, y): normal seesPoint
// (range + cone + LOS) AND, if that point is inside a bush, close enough to see through
// the concealment. Both getVisibleState (SurvivGame.js) and the belief below call this
// exact function so observation and belief can never disagree about a bush.
export function spotsPoint(viewer, x, y, cfg, map) {
  if (!seesPoint(viewer, x, y, cfg)) return false;
  if (!isInBush(map, x, y)) return true;
  return Math.hypot(viewer.x - x, viewer.y - y) <= BUSH_SPOT_RANGE;
}

// getVisibleState helper: own units + any enemy any own unit actually spots (see
// spotsPoint). Mirrors games/vision.js's filterVisibleUnits, with the bush wrinkle.
export function survivFilterVisibleUnits(units, teamId, cfg, map, numXY) {
  const viewers = viewersOf(units, teamId, cfg, numXY);
  return units.filter(u => {
    if (u.ownerId === teamId) return true;
    const [x, y] = numXY(u.position);
    return viewers.some(v => spotsPoint(v, x, y, cfg, map));
  });
}

const FOG_VISION   = SURVIV_VISION.range;
const MAX_POSSIBLE = 40;
const THREAT_BIAS  = 3;

const k = (x, y) => `${x},${y}`;
const coords = key => key.split(',').map(Number);
const cheby = (x, y, p) => Math.max(Math.abs(x - num(p.x)), Math.abs(y - num(p.y)));

function weightedPick(items, weights, rng) {
  let total = 0;
  for (const w of weights) total += w;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

export class SurvivBelief {
  constructor(myTeam, map) {
    this.myTeam = myTeam;
    this.enemyTeam = myTeam === 'red' ? 'blue' : 'red';
    this.map = map;
    this.pieces = new Map(); // id -> { possible:Set<key>, anchor:{x,y}, alive, seen }
    this.lastTurn = null;
    const spawns = this.enemyTeam === 'red' ? map.redSpawns : map.blueSpawns;
    spawns.forEach((p, i) => {
      this.pieces.set(`${this.enemyTeam}-${i}`, {
        possible: new Set([k(p.x, p.y)]), anchor: { x: p.x, y: p.y }, alive: true, seen: false,
      });
    });
  }

  // Tiles our team can actually spot right now (range + cone + LOS + bush check).
  _spotSet(observation) {
    const spot = new Set();
    const cfg = survivVisionCfg(this.map);
    for (const m of observation.units) {
      if (!m.alive || m.ownerId !== this.myTeam) continue;
      const mt = tilePos(m.position);
      const viewer = { x: mt.x, y: mt.y, facing: m.facing, fov: m.fov, visionRange: m.visionRange };
      for (let dy = -FOG_VISION; dy <= FOG_VISION; dy++)
        for (let dx = -FOG_VISION; dx <= FOG_VISION; dx++) {
          const x = mt.x + dx, y = mt.y + dy;
          if (spotsPoint(viewer, x, y, cfg, this.map)) spot.add(k(x, y));
        }
    }
    return spot;
  }

  // Every unseen enemy may have advanced one move of reach since our last turn.
  _expand() {
    for (const pc of this.pieces.values()) {
      if (!pc.alive) continue;
      const next = new Set(pc.possible);
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

  // Reconcile the belief with what we actually observe this turn.
  _collapse(observation) {
    const spot = this._spotSet(observation);
    const seenNow = new Set();
    for (const u of observation.units) {
      if (u.ownerId !== this.enemyTeam) continue;
      seenNow.add(u.id);
      const ut = tilePos(u.position);
      const pc = this.pieces.get(u.id) ?? { possible: new Set(), anchor: ut, alive: true, seen: false };
      pc.alive = u.alive;
      pc.anchor = ut;
      pc.possible = new Set([k(ut.x, ut.y)]);
      pc.seen = true;
      this.pieces.set(u.id, pc);
    }
    for (const [id, pc] of this.pieces) {
      if (seenNow.has(id)) continue;
      pc.seen = false;
      if (!pc.alive) continue;
      for (const key of [...pc.possible]) if (spot.has(key)) pc.possible.delete(key);
      if (pc.possible.size === 0) {
        const reach = getReachable(this.map.tiles, pc.anchor, MOVE_RANGE, [])
          .map(t => k(t.x, t.y)).filter(key => !spot.has(key));
        pc.possible = new Set(reach.length ? reach : [k(pc.anchor.x, pc.anchor.y)]);
      }
    }
  }

  beginTurn(observation) {
    if (observation.turnNumber !== this.lastTurn) {
      if (this.lastTurn != null) this._expand();
      this.lastTurn = observation.turnNumber;
    }
    this._collapse(observation);
  }

  sample(observation, n, rng, makeUnit) {
    const spot = this._spotSet(observation);
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
      const order = [...hidden].sort((a, b) => a.pc.possible.size - b.pc.possible.size);
      for (const { id, pc } of order) {
        const cands = [...pc.possible].filter(key => {
          const [x, y] = coords(key);
          return !spot.has(key) && !used.has(key) && isWalkable(this.map.tiles, x, y);
        });
        if (cands.length === 0) continue;
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

// Per-game belief store, keyed by the (stable) players array — see games/cs/belief.js.
const beliefStore = new WeakMap();

export function getSurvivBelief(state, myTeam) {
  let byTeam = beliefStore.get(state.players);
  if (!byTeam) { byTeam = new Map(); beliefStore.set(state.players, byTeam); }
  let belief = byTeam.get(myTeam);
  if (!belief) { belief = new SurvivBelief(myTeam, state.gameSpecific.map); byTeam.set(myTeam, belief); }
  return belief;
}
