// ---------------------------------------------------------------------------
// Fog-of-war belief tracking for KDice — a stateful information-set tracker,
// sibling of tactical/belief.js and mudandblood/belief.js, but adapted to a
// hex TERRITORY GRAPH rather than a grid of moving units.
//
// KDice has no units: a territory's owner and dice count ARE the hidden state,
// and territories themselves never move — only their owner/dice-count values
// change hands over time. So this belief is closer in spirit to a hidden-value
// tracker (like an opponent's hand of cards) than the position-set trackers
// used by the grid games: per hidden territory we track a small "what we last
// knew" anchor (owner, dice, how long ago) rather than a set of possible tiles.
//
// Under fog getVisibleState reveals a territory's true owner/dice only if it
// is ours or graph-adjacent (hop distance 1) to one of ours; everything else
// is reported with owner/dice nulled out. This maintains, per territory we
// don't currently see:
//   1. expand   — a turn has elapsed since we last looked; the true owner may
//                 have flipped (a neighbour captured it) and its dice count
//                 may have grown (end-of-turn bonus, up to MAX_DICE) or reset
//                 to 1 (it lost a battle). We don't shrink certainty, we just
//                 note that the last reading is one turn staler.
//   2. collapse — reconcile with what's newly visible this turn: pin owner and
//                 dice exactly for every territory we can now see, and record
//                 the ownership of newly-visible territories as a prior for
//                 their still-hidden neighbours.
//   3. sample   — draw concrete worlds: for each hidden territory pick a
//                 plausible owner (weighted toward its last-known owner, or —
//                 if never seen — toward the owner of a known adjacent
//                 territory, since territories tend to change hands between
//                 neighbours; falls back to uniform over all players) and a
//                 plausible dice count (weighted toward its last-known value
//                 when recent, otherwise uniform over 1..MAX_DICE).
//
// KDice is N-player, so a hidden territory isn't "the enemy's" — it can belong
// to any player other than us (or even us, transiently invisible to our own
// bookkeeping is impossible since our own territories are always visible, but
// we still guard for it).
// ---------------------------------------------------------------------------

const MAX_DICE = 8;
const STALE_CAP = 6; // after this many unseen turns, treat the last reading as fully uncertain

function weightedPick(items, weights, rng) {
  let total = 0;
  for (const w of weights) total += w;
  if (total <= 0) return items[Math.floor(rng() * items.length)];
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

// Territories visible to `myId`: owned by us, or graph-adjacent (hop 1) to one we own.
export function visibleTerritoryIds(territories, adjacency, myId) {
  const vis = new Set();
  for (const [id, t] of Object.entries(territories)) {
    if (t.owner === myId) {
      vis.add(id);
      for (const nid of (adjacency[id] ?? [])) vis.add(nid);
    }
  }
  return vis;
}

export class KDiceBelief {
  constructor(myId, allPlayerIds) {
    this.myId = myId;
    this.allPlayerIds = allPlayerIds;
    // id -> { owner, dice, ownerKnown, diceKnown, staleness }
    this.knowledge = new Map();
    this.lastTurn = null;
  }

  // 1. Propagation: a turn elapsed since our last look — every still-hidden
  // territory's reading gets one turn staler (over-estimate uncertainty).
  _expand() {
    for (const rec of this.knowledge.values()) {
      if (rec.seenThisTurn) continue;
      rec.staleness = Math.min(STALE_CAP, rec.staleness + 1);
    }
  }

  // 2. Collapse: reconcile with what's newly visible this turn.
  _collapse(observation) {
    const { territories, adjacency } = observation.board;
    const vis = visibleTerritoryIds(territories, adjacency, this.myId);

    for (const id of Object.keys(territories)) {
      let rec = this.knowledge.get(id);
      if (!rec) {
        rec = { owner: null, dice: null, ownerKnown: false, diceKnown: false, staleness: STALE_CAP };
        this.knowledge.set(id, rec);
      }
      if (vis.has(id)) {
        const t = territories[id];
        rec.owner = t.owner;
        rec.dice = t.dice;
        rec.ownerKnown = true;
        rec.diceKnown = true;
        rec.staleness = 0;
        rec.seenThisTurn = true;
      } else {
        rec.seenThisTurn = false;
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
   * Draw up to `n` plausible full worlds consistent with `observation`
   * (a getVisibleState output: hidden territories have owner/dice === null).
   * Each hidden territory gets a sampled owner and dice count.
   */
  sample(observation, n, rng) {
    const { territories, adjacency } = observation.board;
    const hiddenIds = Object.keys(territories).filter(id => territories[id].owner == null);
    if (hiddenIds.length === 0) return [];

    const worlds = [];
    for (let p = 0; p < n; p++) {
      const filled = {};
      // First pass: decide owners (so neighbour-owner priors can reference
      // already-sampled neighbours drawn earlier in this same world too).
      const owners = {};
      for (const id of hiddenIds) {
        const rec = this.knowledge.get(id);
        owners[id] = this._sampleOwner(id, rec, territories, adjacency, owners, rng);
      }
      for (const id of hiddenIds) {
        const rec = this.knowledge.get(id);
        const dice = this._sampleDice(rec, rng);
        filled[id] = { ...territories[id], owner: owners[id], dice };
      }
      const nextTerritories = { ...territories, ...filled };
      worlds.push({ ...observation, board: { ...observation.board, territories: nextTerritories } });
    }
    return worlds;
  }

  _sampleOwner(id, rec, territories, adjacency, ownersSoFar, rng) {
    const candidates = this.allPlayerIds;

    // Weight toward last-known owner (decaying with staleness), then toward
    // the owner of any currently-known-or-sampled neighbour (capture prior),
    // else uniform.
    const weights = candidates.map(pid => {
      let w = 1; // uniform floor
      if (rec?.ownerKnown && rec.owner === pid) {
        w += Math.max(1, STALE_CAP - rec.staleness) * 3;
      }
      const neighborBonus = (adjacency[id] ?? []).reduce((acc, nid) => {
        const nOwner = territories[nid]?.owner ?? ownersSoFar[nid] ?? null;
        return acc + (nOwner === pid ? 1 : 0);
      }, 0);
      w += neighborBonus * 2;
      return w;
    });
    return weightedPick(candidates, weights, rng);
  }

  _sampleDice(rec, rng) {
    if (rec?.diceKnown && rec.staleness <= 0) return rec.dice;
    if (rec?.diceKnown) {
      // Blend last-known value with a uniform draw, decaying confidence with staleness.
      const confidence = Math.max(0, 1 - rec.staleness / STALE_CAP);
      if (rng() < confidence) {
        const drift = Math.round((rng() - 0.5) * 2 * (1 - confidence) * MAX_DICE);
        return Math.min(MAX_DICE, Math.max(1, rec.dice + drift));
      }
    }
    return Math.max(1, Math.min(MAX_DICE, Math.floor(rng() * MAX_DICE) + 1));
  }
}

// ---------------------------------------------------------------------------
// Per-game belief store, keyed by the (stable) players array so each game —
// and each player within it — keeps its own belief, and a new game starts fresh.
// ---------------------------------------------------------------------------

const beliefStore = new WeakMap();

export function getKDiceBelief(state, myId) {
  let byPlayer = beliefStore.get(state.players);
  if (!byPlayer) { byPlayer = new Map(); beliefStore.set(state.players, byPlayer); }
  let belief = byPlayer.get(myId);
  if (!belief) {
    belief = new KDiceBelief(myId, state.players.map(p => p.id));
    byPlayer.set(myId, belief);
  }
  return belief;
}
