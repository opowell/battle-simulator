// ---------------------------------------------------------------------------
// Fog-of-war belief tracking for Rogue — a stateful information-set tracker,
// sibling of games/tactical/belief.js and games/xcom/belief.js.
//
// Rogue is single-player: the only real agent is the hero (players[0]); every
// monster is owned by 'dungeon' and moves automatically inside applyActions.
// There is no opposing agent to reason about strategically here — the "fog"
// is classic roguelike exploration fog (unseen dungeon tiles + unseen/unlit
// monsters), and ObscuroAgent's existing machinery treats this as expectimax
// over the hidden monster placement (see agents/ObscuroAgent.js's
// `_chooseWithFog`: since activePlayers stays [hero] after applyActions
// resolves the monsters' automatic reactions, every row/world pair is a
// forced leaf — no opponent-reply search needed).
//
// A monster is "visible" to the hero if it is within VISION (Chebyshev) and
// has line-of-sight (map.js's hasLOS), mirroring xcom/tactical's pattern.
// The one Rogue-specific wrinkle: 'phantom' monsters (specialAbility
// 'invisible') are hidden unless adjacent, matching the existing render rule
// in map.js's renderMap (`ability === 'invisible' && !seeInvisible && dist > 1`).
//
// Per-turn belief update, mirroring xcom/tactical:
//   1. expand   — an unseen-but-known monster may have taken one monster turn
//                 of movement (monsters here move exactly one tile per hero
//                 action, see RogueGame.js's runMonsters), so grow its
//                 possible-tile set by one step of reach.
//   2. collapse — pin monsters we can currently see to their exact tile
//                 (updating hp, marking witnessed deaths), and drop from every
//                 unseen monster's set the tiles we can now see but don't find
//                 it on.
//   3. sample   — draw worlds, placing each believed-alive unseen monster from
//                 its localised possible set, PLUS (residual approximation,
//                 see below) a coarse allowance for monsters the hero simply
//                 hasn't encountered yet this floor.
//
// Residual limitation (same spirit as tactical/belief.js's header note): once
// a monster has been sighted at least once we track its specific id and a
// bounded possible-tile set precisely. But monsters never yet seen on the
// current floor are not individually identified — spawnMonsters()'s own
// level-appropriate pool is used to approximate "there are probably N more
// monsters somewhere on this floor", placed anonymously in unexplored rooms
// with plausible types for the current dungeon level. This is intentionally
// coarse: it does not attempt to pin exact monster count or identity ahead of
// the first sighting, since Rogue's own applyActions/spawnMonsters logic is
// the only source of truth for that and re-deriving it exactly would require
// duplicating floor-generation internals here.
// ---------------------------------------------------------------------------

import { hasLOS, manhattan } from './map.js';
import { createMonster, spawnMonsters } from './units.js';

export const VISION = 6; // hero sight radius (Chebyshev), matches getVisibleState
const MAX_POSSIBLE = 24; // cap a monster's possible-tile set so sampling stays cheap

const k = (x, y) => `${x},${y}`;
const coords = key => key.split(',').map(Number);
const cheby = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// A monster is visible to the hero this turn if within VISION and has LOS,
// respecting the phantom/invisible special case (hidden unless adjacent).
export function isMonsterVisible(tiles, hero, monster) {
  if (!hero || !hero.alive) return false;
  const dist = manhattan(hero.position, monster.position);
  if (monster.attrs?.specialAbility === 'invisible') return dist <= 1;
  return cheby(hero.position, monster.position) <= VISION &&
         hasLOS(tiles, hero.position.x, hero.position.y, monster.position.x, monster.position.y);
}

function neighbors4(tiles, pos) {
  const out = [];
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const x = pos.x + dx, y = pos.y + dy;
    if (tiles[k(x, y)] === '.') out.push({ x, y });
  }
  return out;
}

export class RogueBelief {
  constructor(myId) {
    this.myId = myId;
    this.dungeonLevel = null;
    this.pieces = new Map(); // id -> { type, possible:Set, anchor, alive, seen, hp, attrs }
    this.lastTurn = null;
  }

  _resetForFloor(observation) {
    this.dungeonLevel = observation.gameSpecific.dungeonLevel;
    this.pieces.clear();
    this.lastTurn = null;
    // Seed with whatever monsters are already visible/known on this floor
    // (including any witnessed dead, so a death already seen stays witnessed
    // rather than being forgotten and re-sampled as possibly alive).
    for (const u of observation.units) {
      if (u.ownerId !== 'dungeon') continue;
      this.pieces.set(u.id, {
        type: u.type,
        possible: new Set([k(u.position.x, u.position.y)]),
        anchor: { ...u.position }, alive: u.alive, seen: true,
        hp: u.hp, attrs: { ...u.attrs },
      });
    }
  }

  // 1. Propagation: every unseen-but-known monster may have taken one step.
  _expand(tiles) {
    for (const pc of this.pieces.values()) {
      if (!pc.alive) continue;
      const next = new Set(pc.possible); // staying put is always possible
      for (const key of pc.possible) {
        const [x, y] = coords(key);
        for (const t of neighbors4(tiles, { x, y })) next.add(k(t.x, t.y));
      }
      pc.possible = next.size > MAX_POSSIBLE
        ? new Set([...next].sort((a, b) => {
            const [ax, ay] = coords(a), [bx, by] = coords(b);
            return cheby({ x: ax, y: ay }, pc.anchor) - cheby({ x: bx, y: by }, pc.anchor);
          }).slice(0, MAX_POSSIBLE))
        : next;
    }
  }

  // 2. Collapse: reconcile with what the hero actually observes this turn.
  _collapse(observation) {
    const tiles = observation.board.tiles;
    const hero = observation.units.find(u => u.type === 'rogue');
    const seenNow = new Set();

    for (const u of observation.units) {
      if (u.ownerId !== 'dungeon') continue;
      const pc = this.pieces.get(u.id);
      if (!pc) {
        // Newly discovered monster (e.g. spawned by a scroll, or first sighting).
        this.pieces.set(u.id, {
          type: u.type,
          possible: new Set([k(u.position.x, u.position.y)]),
          anchor: { ...u.position }, alive: u.alive, seen: true,
          hp: u.hp, attrs: { ...u.attrs },
        });
        seenNow.add(u.id);
        continue;
      }
      seenNow.add(u.id);
      pc.alive = u.alive;
      pc.hp = u.hp;
      pc.attrs = { ...u.attrs };
      pc.anchor = { ...u.position };
      pc.possible = new Set([k(u.position.x, u.position.y)]);
      pc.seen = true;
    }

    for (const [id, pc] of this.pieces) {
      if (seenNow.has(id)) continue;
      pc.seen = false;
      if (!pc.alive) continue;
      // An unseen monster cannot be on any tile currently visible to the hero.
      for (const key of [...pc.possible]) {
        const [x, y] = coords(key);
        if (hero && isMonsterVisible(tiles, hero, { position: { x, y }, attrs: pc.attrs })) {
          pc.possible.delete(key);
        }
      }
      if (pc.possible.size === 0) {
        const reach = neighbors4(tiles, pc.anchor).map(t => k(t.x, t.y))
          .filter(key => {
            const [x, y] = coords(key);
            return !hero || !isMonsterVisible(tiles, hero, { position: { x, y }, attrs: pc.attrs });
          });
        pc.possible = new Set(reach.length ? reach : [k(pc.anchor.x, pc.anchor.y)]);
      }
    }
  }

  beginTurn(observation) {
    if (observation.gameSpecific.dungeonLevel !== this.dungeonLevel) {
      this._resetForFloor(observation);
      return;
    }
    if (observation.turnNumber !== this.lastTurn) {
      if (this.lastTurn !== null) this._expand(observation.board.tiles);
      this.lastTurn = observation.turnNumber;
    }
    this._collapse(observation);
  }

  /**
   * Draw up to `n` worlds. Each is the observation plus:
   *  - every believed-alive, currently-unseen KNOWN monster placed from its
   *    possible-tile set;
   *  - a coarse allowance of anonymous, level-appropriate monsters placed in
   *    unexplored rooms, approximating monsters not yet encountered this
   *    floor (residual limitation — see file header).
   */
  sample(observation, n, rng, rooms) {
    const tiles = observation.board.tiles;
    const hero = observation.units.find(u => u.type === 'rogue');
    const seenIds = new Set(observation.units.filter(u => u.ownerId === 'dungeon').map(u => u.id));

    const hidden = [];
    for (const [id, pc] of this.pieces) if (pc.alive && !seenIds.has(id)) hidden.push({ id, pc });

    // Expected total monster count for this floor (from spawnMonsters' own
    // formula) minus what we already know about, gives a coarse residual.
    const dungeonLevel = observation.gameSpecific.dungeonLevel;
    const expectedTotal = 2 + Math.floor(dungeonLevel * 1.5);
    const knownCount = this.pieces.size;
    const residualCount = Math.max(0, expectedTotal - knownCount);

    if (hidden.length === 0 && residualCount === 0) return [];

    const worlds = [];
    for (let p = 0; p < n; p++) {
      const used = new Set(observation.units.filter(u => u.alive).map(u => k(u.position.x, u.position.y)));
      const placed = [];

      const order = [...hidden].sort((a, b) => a.pc.possible.size - b.pc.possible.size);
      for (const { id, pc } of order) {
        const cands = [...pc.possible].filter(key => {
          const [x, y] = coords(key);
          return !used.has(key) && (!hero || !isMonsterVisible(tiles, hero, { position: { x, y }, attrs: pc.attrs }));
        });
        if (cands.length === 0) continue;
        const key = cands[Math.floor(rng() * cands.length)];
        used.add(key);
        const [x, y] = coords(key);
        placed.push({ ...createMonster(id, pc.type, { x, y }, rng), hp: pc.hp, alive: true, attrs: { ...pc.attrs } });
      }

      // Residual anonymous monsters: use spawnMonsters' own pool/placement
      // logic (the source of truth for what's plausible at this level) to get
      // level-appropriate types, but only keep placements outside current LOS.
      if (residualCount > 0 && rooms && rooms.length > 0) {
        const existing = observation.units.filter(u => u.alive).map(u => ({ position: u.position, alive: true }));
        const spawned = spawnMonsters(rooms, dungeonLevel, [...existing, ...placed.map(m => ({ position: m.position, alive: true }))], rng);
        for (const m of spawned.slice(0, residualCount)) {
          const key = k(m.position.x, m.position.y);
          if (used.has(key)) continue;
          if (hero && isMonsterVisible(tiles, hero, m)) continue;
          used.add(key);
          placed.push({ ...m, id: `${m.id}-residual-${p}` });
        }
      }

      worlds.push({ ...observation, units: [...observation.units, ...placed] });
    }
    return worlds;
  }
}

// ---------------------------------------------------------------------------
// Per-game belief store, keyed by the (stable) players array so each game
// keeps its own belief, and a new game starts fresh.
// ---------------------------------------------------------------------------

const beliefStore = new WeakMap();

export function getRogueBelief(state, myId) {
  let byPlayer = beliefStore.get(state.players);
  if (!byPlayer) { byPlayer = new Map(); beliefStore.set(state.players, byPlayer); }
  let belief = byPlayer.get(myId);
  if (!belief) {
    belief = new RogueBelief(myId);
    byPlayer.set(myId, belief);
  }
  return belief;
}
