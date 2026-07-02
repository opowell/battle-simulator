// ---------------------------------------------------------------------------
// Fog-of-war belief tracking for CardBattle — a stateful information-set
// tracker, sibling of tactical/belief.js and chess/belief.js, but for a
// hand + draw-pile of cards instead of hidden board positions.
//
// Under fog getVisibleState replaces the opponent's hand/deck card VALUES
// with '?' placeholders while preserving array length (so counts are always
// common knowledge — only identities are hidden). What's hidden is which
// permutation of STARTING_DECK currently sits in their hand vs their deck.
//
// Each of our decision points we:
//   1. witness — every card an opponent has ever played is revealed at the
//      moment it's played (applyActions logs it in lastActions), so we
//      accumulate a running count of their plays, turn over turn.
//   2. reconstruct — their hand+deck together must be *some* multiset drawn
//      from STARTING_DECK minus the cards they've already played. We sample
//      a plausible ordering of that remaining pool and split it into a hand
//      of the known (visible) length and a deck of the rest.
//
// Residual limitation: once a player's deck empties mid-game it reshuffles
// fresh from STARTING_DECK (see CardBattleGame.drawCards), and played cards
// are never tracked in a discard pile — they simply vanish. So across a
// reshuffle boundary we cannot precisely account for "STARTING_DECK minus
// everything ever played"; we only subtract plays since the *most recent*
// reshuffle we can infer (approximated here as: once cumulative plays would
// exceed STARTING_DECK's size, we reset the witnessed-plays counter, mirroring
// the game's own reshuffle-from-scratch behaviour). This is a heuristic, not
// an exact replica of engine-internal reshuffle timing — noted as a known gap,
// same spirit as tactical/belief.js's own bounded-uncertainty caveat.
// ---------------------------------------------------------------------------

const STARTING_DECK = [
  'attack', 'attack', 'attack',
  'heavy-attack', 'heavy-attack',
  'block', 'block',
  'heal', 'heal',
];

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class CardBattleBelief {
  constructor(myId, opponentId) {
    this.myId = myId;
    this.opponentId = opponentId;
    this.playedCounts = new Map(); // card -> cumulative count witnessed played
    this.totalPlayed = 0;
    this.lastTurn = null;
  }

  _recordPlay(card) {
    if (card === 'pass' || card == null) return; // 'pass' isn't a real card (heavy-attack skip)
    this.playedCounts.set(card, (this.playedCounts.get(card) ?? 0) + 1);
    this.totalPlayed += 1;
    // Once witnessed plays would exceed a full deck, the engine must have
    // reshuffled at least once from a fresh STARTING_DECK; we can no longer
    // precisely track which cards are "used up", so reset and start fresh —
    // approximating the reshuffle boundary (see header comment).
    if (this.totalPlayed >= STARTING_DECK.length) {
      this.playedCounts.clear();
      this.totalPlayed = 0;
    }
  }

  // Absorb every action the opponent has committed since our last look,
  // reading them out of state.lastActions (both players' actions land there
  // together each step, since CardBattle turns are simultaneous).
  beginTurn(state) {
    if (state.turnNumber === this.lastTurn) return;
    this.lastTurn = state.turnNumber;
    for (const { playerId, action } of state.lastActions ?? []) {
      if (playerId !== this.opponentId) continue;
      if (action?.type === 'play-card') this._recordPlay(action.payload?.card);
    }
  }

  // Build the pool of card values the opponent's hand+deck could plausibly be
  // made of: STARTING_DECK minus everything we've witnessed them play since
  // the last inferred reshuffle.
  _remainingPool() {
    const remaining = [...STARTING_DECK];
    for (const [card, n] of this.playedCounts) {
      for (let i = 0; i < n; i++) {
        const idx = remaining.indexOf(card);
        if (idx >= 0) remaining.splice(idx, 1);
      }
    }
    return remaining;
  }

  /**
   * Draw up to `n` plausible reconstructions of the opponent's hand+deck.
   * Respects the true (visible) counts exactly; samples values from the
   * remaining plausible pool. If the pool is short (more cards needed than
   * remain — can happen right at an inferred reshuffle boundary) it pads
   * with a fresh STARTING_DECK draw, matching the game's own reshuffle rule.
   */
  sample(handCount, deckCount, n, rng) {
    const need = handCount + deckCount;
    const worlds = [];
    for (let i = 0; i < n; i++) {
      let pool = shuffle(this._remainingPool(), rng);
      while (pool.length < need) pool = pool.concat(shuffle(STARTING_DECK, rng));
      worlds.push({ hand: pool.slice(0, handCount), deck: pool.slice(handCount, need) });
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

export function getCardBattleBelief(state, myId) {
  let byPlayer = beliefStore.get(state.players);
  if (!byPlayer) { byPlayer = new Map(); beliefStore.set(state.players, byPlayer); }
  let belief = byPlayer.get(myId);
  if (!belief) {
    const opponentId = state.players.map(p => p.id).find(id => id !== myId);
    belief = new CardBattleBelief(myId, opponentId);
    byPlayer.set(myId, belief);
  }
  return belief;
}
