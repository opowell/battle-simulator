// ---------------------------------------------------------------------------
// Fog-of-war belief tracking for Risk — a stateful information-set tracker,
// sibling of chess/belief.js, cs/belief.js and tactical/belief.js, but for a
// different flavour of hidden information: a HAND OF CARDS rather than hidden
// unit positions.
//
// getVisibleState (RiskGame.js) zeroes out every other player's `cards` hand
// to `[]`, but leaves `gameSpecific.deck` (the face-down draw pile) untouched —
// its exact contents are visible, they're just not attributed to a player yet.
// Because the full card pool is fully deterministic (allCardsInGame(): one
// card per territory + 2 wilds, no randomness in composition — only in deal
// order), a single observation already tells us the exact multiset of cards
// held by "everyone but me combined":
//
//     opponentsCombinedHand = allCardsInGame() − deck − myHand − turnedIn
//
// (turnedIn accounts for cards permanently removed from circulation by
// 'turn-in-cards' — this game has no discard pile, so a set that's cashed in
// just vanishes; we know the COUNT from gameSpecific.cardSetCount * 3 but not
// which specific cards, so we trim the remainder down to the right size by
// dropping that many at random — see reconstructHands.)
//
// The only remaining real uncertainty is how the combined remainder is split across
// multiple opponents (for a 2-player game there's no uncertainty at all: the
// lone opponent holds exactly that remainder). To split it for 3+ players we
// track a believed hand-SIZE per opponent — how many cards they hold, not
// which ones — updated turn over turn from `observation.lastActions`:
//   • 'end-attack' with a conquest and a deck that got shorter since we last
//     looked  ⇒  that player just drew one card (deck.length is our clock).
//   • 'turn-in-cards'  ⇒  that player's hand shrinks by 3.
//   • an elimination-by-capture (visible as the *victim's* tracked size
//     dropping to 0 and the attacker's hand growing) transfers the victim's
//     whole tracked hand to the attacker.
// A single observation carries no turn history, so this only works if the
// same belief instance is reused turn after turn (WeakMap-keyed store below,
// same convention as every other belief.js in this repo).
//
// Residual limitation: for 3+ players we only ever track hand *sizes*, not
// identities, so when several opponents are ambiguous the combined remainder
// is split proportionally to tracked size (falling back to an even split when
// nothing has been tracked yet) and the *specific* cards each gets is an
// arbitrary-but-consistent partition of the remainder — never a fabricated or
// duplicated card. This is exact for 2 players and approximate, but never
// crashing or inconsistent, for 3+.
// ---------------------------------------------------------------------------

import { allCardsInGame } from './RiskGame.js';

function cardKey(c) {
  return `${c.type}:${c.territory ?? ''}`;
}

// Multiset subtract: remove one occurrence of each card in `remove` from `from`.
function subtractCards(from, remove) {
  const counts = new Map();
  for (const c of remove) counts.set(cardKey(c), (counts.get(cardKey(c)) ?? 0) + 1);
  const remainder = [];
  for (const c of from) {
    const k = cardKey(c);
    const n = counts.get(k) ?? 0;
    if (n > 0) { counts.set(k, n - 1); continue; }
    remainder.push(c);
  }
  return remainder;
}

export class RiskBelief {
  constructor(myId, playerIds) {
    this.myId = myId;
    this.opponentIds = playerIds.filter(id => id !== myId);
    this.handSize = new Map(this.opponentIds.map(id => [id, 0])); // believed # cards held
    this.lastDeckLength = null;
  }

  // Reconcile believed hand sizes against what happened since we last looked.
  // Cheap and approximate on purpose: we only ever see our OWN hand contents,
  // so opponents' hand sizes are inferred, never read directly.
  update(observation) {
    const gs = observation.gameSpecific;
    const deckLen = gs.deck.length;

    if (this.lastDeckLength === null) {
      // First time we see this game: nothing yet attributed to anyone. Any
      // cards already out there (e.g. resuming mid-game) are folded into the
      // "unattributed remainder" and split evenly at sample time.
      this.lastDeckLength = deckLen;
    }

    const last = observation.lastActions?.[0];
    if (last) {
      const { playerId, action } = last;
      if (action.type === 'end-attack' && deckLen < this.lastDeckLength && this.opponentIds.includes(playerId)) {
        // This player's conquest drew them a card from the deck.
        this.handSize.set(playerId, (this.handSize.get(playerId) ?? 0) + 1);
      }
      if (action.type === 'turn-in-cards' && this.opponentIds.includes(playerId)) {
        const n = Math.min(3, this.handSize.get(playerId) ?? 0);
        this.handSize.set(playerId, (this.handSize.get(playerId) ?? 0) - n);
      }
    }

    // Elimination transfer: a defeated opponent's whole tracked hand moves to
    // whichever player captured their last territory. We can detect this from
    // gameSpecific.eliminatedPlayers growing, and hand the tracked size to the
    // attacker of the most recent action (the only player who could have just
    // eliminated someone).
    const eliminatedNow = new Set(gs.eliminatedPlayers ?? []);
    for (const oid of this.opponentIds) {
      if (eliminatedNow.has(oid) && (this.handSize.get(oid) ?? 0) > 0) {
        const transferred = this.handSize.get(oid);
        this.handSize.set(oid, 0);
        if (last && last.playerId !== oid) {
          this.handSize.set(last.playerId, (this.handSize.get(last.playerId) ?? 0) + transferred);
        }
      }
    }

    this.lastDeckLength = deckLen;
  }

  /**
   * Reconstruct up to `n` plausible worlds' worth of opponent hands from a
   * single observation. Returns a Map<opponentId, Card[]> per world (an
   * array of length `n`, or shorter/empty if there's nothing to distribute).
   */
  reconstructHands(observation, n, rng) {
    const gs = observation.gameSpecific;
    const myHand = gs.cards[this.myId] ?? [];
    let remainder = subtractCards(subtractCards(allCardsInGame(), gs.deck), myHand);

    // Turned-in card sets are permanently removed from circulation (this game
    // has no discard pile), so `allCards - deck - myHand` overcounts by
    // 3 * cardSetCount. WHICH specific cards were turned in is genuinely lost
    // information from a single observation, so we just trim the remainder
    // down to the right SIZE (arbitrary-but-rng-varied choice of which cards
    // to drop) so it matches the true total count of opponent-held cards.
    const turnedIn = Math.min(remainder.length, 3 * (gs.cardSetCount ?? 0));
    if (turnedIn > 0) remainder = this._dropRandom(remainder, turnedIn, rng);

    if (remainder.length === 0 || this.opponentIds.length === 0) return [];

    // 2-player game: no uncertainty — the lone opponent holds exactly the
    // remainder. One deterministic world is correct and sufficient.
    if (this.opponentIds.length === 1) {
      return [new Map([[this.opponentIds[0], remainder]])];
    }

    const worlds = [];
    const count = Math.max(1, n);
    for (let w = 0; w < count; w++) {
      worlds.push(this._splitOnce(remainder, rng));
    }
    return worlds;
  }

  // Drop `count` cards chosen uniformly at random (used to model the cards
  // lost to permanently-discarded turned-in sets, whose identity we can't
  // recover from a single observation).
  _dropRandom(cards, count, rng) {
    const pool = [...cards];
    for (let i = 0; i < count && pool.length > 0; i++) {
      const idx = Math.floor(rng() * pool.length);
      pool.splice(idx, 1);
    }
    return pool;
  }

  // One random-but-size-consistent partition of `remainder` across opponents,
  // proportional to tracked hand sizes (even split as a fallback). Never
  // fabricates or duplicates a card — every card in `remainder` is placed with
  // exactly one opponent (extras beyond total tracked size are round-robined).
  _splitOnce(remainder, rng) {
    const shuffled = [...remainder];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const sizes = this.opponentIds.map(id => this.handSize.get(id) ?? 0);
    const totalTracked = sizes.reduce((a, b) => a + b, 0);

    const target = totalTracked > 0
      ? sizes.map(s => Math.round((s / totalTracked) * shuffled.length))
      : this.opponentIds.map(() => Math.floor(shuffled.length / this.opponentIds.length));

    const hands = new Map(this.opponentIds.map(id => [id, []]));
    let idx = 0;
    this.opponentIds.forEach((id, i) => {
      const take = Math.min(target[i] ?? 0, shuffled.length - idx);
      for (let k = 0; k < take; k++) hands.get(id).push(shuffled[idx++]);
    });
    // Round-robin any leftover (rounding, or nothing tracked yet) across opponents.
    let ri = 0;
    while (idx < shuffled.length) {
      const id = this.opponentIds[ri % this.opponentIds.length];
      hands.get(id).push(shuffled[idx++]);
      ri++;
    }
    return hands;
  }
}

// ---------------------------------------------------------------------------
// Per-game belief store, keyed by the (stable) players array so each game —
// and each player within it — keeps its own belief, and a new game starts
// fresh. Matches the convention of every other belief.js in this repo.
// ---------------------------------------------------------------------------

const beliefStore = new WeakMap();

export function getRiskBelief(state, myId) {
  let byPlayer = beliefStore.get(state.players);
  if (!byPlayer) { byPlayer = new Map(); beliefStore.set(state.players, byPlayer); }
  let belief = byPlayer.get(myId);
  if (!belief) {
    belief = new RiskBelief(myId, state.players.map(p => p.id));
    byPlayer.set(myId, belief);
  }
  return belief;
}
