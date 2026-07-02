import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RiskGame } from './index.js';
import { allCardsInGame } from './RiskGame.js';
import { getRiskBelief } from './belief.js';
import { GameEngine } from '../../engine/index.js';
import { RandomAgent } from '../../agents/index.js';
import { ObscuroAgent } from '../../agents/ObscuroAgent.js';

function players() {
  return [
    { id: 'p1', name: 'P1', agent: RandomAgent },
    { id: 'p2', name: 'P2', agent: RandomAgent },
  ];
}

function cardKey(c) { return `${c.type}:${c.territory ?? ''}`; }
function multiset(cards) {
  const m = new Map();
  for (const c of cards) m.set(cardKey(c), (m.get(cardKey(c)) ?? 0) + 1);
  return m;
}
function multisetsEqual(a, b) {
  const ma = multiset(a), mb = multiset(b);
  if (ma.size !== mb.size) return false;
  for (const [k, v] of ma) if (mb.get(k) !== v) return false;
  return true;
}

// Deal cards to players by simulating a few real turns with RandomAgent so
// hands/deck evolve exactly as gameplay would (draws on conquest, occasional
// turn-ins), giving us a realistic mid-game state to test against.
async function playToMidGame(maxTurns = 20, maxSteps = 600, extraPlayers = []) {
  const ps = extraPlayers.length ? [...players(), ...extraPlayers] : players();
  const engine = new GameEngine(RiskGame, ps, { maxTurns });
  let steps = 0;
  while (steps < maxSteps) {
    const { done } = await engine.step();
    steps++;
    if (done) break;
  }
  return engine.state;
}

// ---------------------------------------------------------------------------
// (a) 2-player: reconstructed opponent hand deterministically equals the
//     legitimate remainder (allCards − deck − myHand − turned-in sets).
// ---------------------------------------------------------------------------

test('risk fog: 2-player sampleWorlds reconstructs the exact opponent hand (no cards turned in yet)', async () => {
  // Exact card-identity reconstruction is only guaranteed while no set has
  // been turned in: once a set is cashed in, this game has no discard pile,
  // so WHICH specific cards were turned in becomes genuinely unrecoverable
  // from a single observation (see belief.js's header comment) — only the
  // remaining COUNT is exact past that point (covered by the next test).
  let matchedAtLeastOnce = false;
  for (let trial = 0; trial < 30; trial++) {
    const state = await playToMidGame(6, 100);
    if (state.gameSpecific.cardSetCount > 0) continue; // outside the exact-identity regime

    const view = RiskGame.getVisibleState(state, 'p1');
    assert.deepEqual(view.gameSpecific.cards.p2, [], 'opponent hand is hidden in the observation');

    const worlds = RiskGame.sampleWorlds(view, 'p1', 4, Math.random);
    const actualP2Hand = state.gameSpecific.cards.p2;

    if (actualP2Hand.length === 0) {
      // Nothing hidden this trial (p2 never drew/holds a card) — sampleWorlds
      // is allowed to return [] in the degenerate no-uncertainty case.
      continue;
    }

    assert.equal(worlds.length, 1, '2-player case is fully deterministic: exactly one reconstructed world');
    const reconstructed = worlds[0].gameSpecific.cards.p2;
    assert.ok(
      multisetsEqual(reconstructed, actualP2Hand),
      `reconstructed hand must equal actual hand as a multiset\n got: ${JSON.stringify(reconstructed)}\n want: ${JSON.stringify(actualP2Hand)}`
    );
    matchedAtLeastOnce = true;
  }
  assert.ok(matchedAtLeastOnce, 'at least one trial produced a non-trivial hand to verify');
});

test('risk fog: 2-player sampleWorlds reconstructs the exact opponent hand SIZE (even after turn-ins)', async () => {
  let matchedAtLeastOnce = false;
  for (let trial = 0; trial < 10; trial++) {
    const state = await playToMidGame();
    const view = RiskGame.getVisibleState(state, 'p1');
    const worlds = RiskGame.sampleWorlds(view, 'p1', 4, Math.random);
    const actualP2Hand = state.gameSpecific.cards.p2;
    if (actualP2Hand.length === 0) continue;

    assert.equal(worlds.length, 1, '2-player case is fully deterministic: exactly one reconstructed world');
    assert.equal(worlds[0].gameSpecific.cards.p2.length, actualP2Hand.length, 'reconstructed hand size must match exactly');
    matchedAtLeastOnce = true;
  }
  assert.ok(matchedAtLeastOnce, 'at least one trial produced a non-trivial hand to verify');
});

// ---------------------------------------------------------------------------
// (b) sampleWorlds never fabricates or duplicates cards: every card handed to
//     an opponent must come from the legitimate remaining pool (not in the
//     deck, not already in my hand, and a real member of the full deterministic
//     deck).
// ---------------------------------------------------------------------------

test('risk fog: sampleWorlds only draws from the legitimate remaining pool', async () => {
  const fullPoolKeys = new Set(allCardsInGame().map(cardKey));

  for (let trial = 0; trial < 10; trial++) {
    const state = await playToMidGame();
    const view = RiskGame.getVisibleState(state, 'p1');
    const myHandKeys = multiset(view.gameSpecific.cards.p1);
    const deckKeys = multiset(view.gameSpecific.deck);

    const worlds = RiskGame.sampleWorlds(view, 'p1', 4, Math.random);
    for (const w of worlds) {
      const reconstructed = w.gameSpecific.cards.p2 ?? [];
      for (const c of reconstructed) {
        assert.ok(fullPoolKeys.has(cardKey(c)), `card ${cardKey(c)} must be a real card from the deterministic deck`);
      }
      // No duplicate beyond how many actually exist of that card in the full deck.
      const gotCounts = multiset(reconstructed);
      const fullCounts = multiset(allCardsInGame());
      for (const [k, n] of gotCounts) {
        assert.ok(n <= (fullCounts.get(k) ?? 0), `must not fabricate more copies of ${k} than exist in the deck`);
      }
      // Never hands the opponent a card that's still face-down in the deck.
      for (const [k, n] of gotCounts) {
        assert.ok(n <= (fullCounts.get(k) ?? 0) - (deckKeys.get(k) ?? 0), `card ${k} still in the deck must not be given to an opponent`);
      }
      // Never hands the opponent a card that's actually in my own hand.
      for (const c of reconstructed) {
        const key = cardKey(c);
        const mineOfThisKey = myHandKeys.get(key) ?? 0;
        assert.ok(mineOfThisKey === 0 || gotCounts.get(key) <= (fullCounts.get(key) ?? 0) - mineOfThisKey,
          `card ${key} held in my own hand must not be duplicated into an opponent's hand`);
      }
    }
  }
});

test('risk fog: sampleWorlds returns [] when no opponent holds any card', () => {
  const state = RiskGame.createInitialState(players(), { rng: Math.random });
  const view = RiskGame.getVisibleState(state, 'p1');
  const worlds = RiskGame.sampleWorlds(view, 'p1', 4, Math.random);
  assert.deepEqual(worlds, [], 'nothing hidden at the start of the game (no cards dealt yet)');
});

// ---------------------------------------------------------------------------
// N-player: never crashes, hand sizes stay non-negative and bounded by the
// full deck, and every world's cards are drawn from the legitimate pool.
// ---------------------------------------------------------------------------

test('risk fog: 4-player sampleWorlds never crashes and stays within the legitimate pool', async () => {
  const extra = [
    { id: 'p3', name: 'P3', agent: RandomAgent },
    { id: 'p4', name: 'P4', agent: RandomAgent },
  ];
  const state = await playToMidGame(20, 800, extra);
  const view = RiskGame.getVisibleState(state, 'p1');
  const belief = getRiskBelief(view, 'p1');
  belief.update(view);

  const worlds = RiskGame.sampleWorlds(view, 'p1', 5, Math.random);
  const fullCounts = multiset(allCardsInGame());
  const deckKeys = multiset(view.gameSpecific.deck);
  const myHandKeys = multiset(view.gameSpecific.cards.p1);

  for (const w of worlds) {
    for (const oid of ['p2', 'p3', 'p4']) {
      const hand = w.gameSpecific.cards[oid] ?? [];
      const counts = multiset(hand);
      for (const [k, n] of counts) {
        const cap = (fullCounts.get(k) ?? 0) - (deckKeys.get(k) ?? 0) - (myHandKeys.get(k) ?? 0);
        assert.ok(n <= Math.max(0, cap), `world must not over-allocate card ${k} to ${oid}`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// (c) Full ObscuroAgent-vs-RandomAgent game completes without crashing, with
//     sampleWorlds wired in via fogOfWar.
// ---------------------------------------------------------------------------

test('risk fog: ObscuroAgent (with sampleWorlds) plays a full game to completion', async () => {
  const ps = [
    { id: 'p1', name: 'P1', agent: new ObscuroAgent(RiskGame, { particles: 3, rows: 4, cols: 4, iters: 40 }) },
    { id: 'p2', name: 'P2', agent: RandomAgent },
  ];
  const engine = new GameEngine(RiskGame, ps, { maxTurns: 12, fogOfWar: true });
  const { result } = await engine.run();
  assert.ok(result && typeof result.outcome === 'string', 'fog game produced a result');
  assert.ok(['win', 'draw', 'victory'].includes(result.outcome));
});

test('risk fog: ObscuroAgent plays a full 3-player game to completion', async () => {
  const ps = [
    { id: 'p1', name: 'P1', agent: new ObscuroAgent(RiskGame, { particles: 3, rows: 4, cols: 4, iters: 40 }) },
    { id: 'p2', name: 'P2', agent: RandomAgent },
    { id: 'p3', name: 'P3', agent: RandomAgent },
  ];
  const engine = new GameEngine(RiskGame, ps, { maxTurns: 10, fogOfWar: true });
  const { result } = await engine.run();
  assert.ok(result && typeof result.outcome === 'string', 'fog game produced a result');
});
