import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CardBattleGame } from './index.js';
import { CardBattleBelief } from './belief.js';
import { ObscuroAgent } from '../../agents/ObscuroAgent.js';
import { RandomAgent } from '../../agents/RandomAgent.js';
import { GameEngine } from '../../engine/index.js';

const CARD_TYPES = new Set(['attack', 'heavy-attack', 'block', 'heal']);

const players = () => [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];

test('cardbattle fog: getVisibleState hides opponent card values but keeps counts', () => {
  const s = CardBattleGame.createInitialState(players());
  const view = CardBattleGame.getVisibleState(s, 'p1');
  assert.deepEqual(view.gameSpecific.hands.p1, s.gameSpecific.hands.p1, 'own hand fully visible');
  assert.equal(view.gameSpecific.hands.p2.length, s.gameSpecific.hands.p2.length, 'opponent hand count preserved');
  assert.ok(view.gameSpecific.hands.p2.every(c => c === '?'), 'opponent hand values hidden');
  assert.equal(view.gameSpecific.decks.p2.length, s.gameSpecific.decks.p2.length, 'opponent deck count preserved');
  assert.ok(view.gameSpecific.decks.p2.every(c => c === '?'), 'opponent deck values hidden');
});

test('cardbattle fog: sampleWorlds reconstructs hand/deck values from the legit card pool', () => {
  const s = CardBattleGame.createInitialState(players());
  const view = CardBattleGame.getVisibleState(s, 'p1');
  const worlds = CardBattleGame.sampleWorlds(view, 'p1', 10, Math.random);
  assert.ok(worlds.length > 0, 'produced worlds');
  for (const w of worlds) {
    for (const card of w.gameSpecific.hands.p2) assert.ok(CARD_TYPES.has(card), `hand card "${card}" is a legit type`);
    for (const card of w.gameSpecific.decks.p2) assert.ok(CARD_TYPES.has(card), `deck card "${card}" is a legit type`);
  }
});

test('cardbattle fog: sampleWorlds preserves true hidden counts exactly', () => {
  const s = CardBattleGame.createInitialState(players());
  const trueHandCount = s.gameSpecific.hands.p2.length;
  const trueDeckCount = s.gameSpecific.decks.p2.length;
  const view = CardBattleGame.getVisibleState(s, 'p1');
  const worlds = CardBattleGame.sampleWorlds(view, 'p1', 10, Math.random);
  for (const w of worlds) {
    assert.equal(w.gameSpecific.hands.p2.length, trueHandCount, 'hand count matches true hidden count');
    assert.equal(w.gameSpecific.decks.p2.length, trueDeckCount, 'deck count matches true hidden count');
  }
});

test('cardbattle fog: sampleWorlds returns [] when nothing is hidden (no fog filtering applied)', () => {
  const s = CardBattleGame.createInitialState(players());
  // Pass the raw (unfiltered) state directly — no '?' placeholders present.
  assert.deepEqual(CardBattleGame.sampleWorlds(s, 'p1', 4, Math.random), []);
});

test('cardbattle fog: belief excludes cards witnessed played by the opponent', () => {
  const s = CardBattleGame.createInitialState(players());
  const belief = new CardBattleBelief('p1', 'p2');
  const withPlay = {
    ...s,
    turnNumber: 2,
    lastActions: [
      { playerId: 'p1', action: { type: 'play-card', unitId: 'p1-hero', payload: { card: 'block', handIndex: 0 } } },
      { playerId: 'p2', action: { type: 'play-card', unitId: 'p2-hero', payload: { card: 'heavy-attack', handIndex: 0 } } },
    ],
  };
  belief.beginTurn(withPlay);
  assert.equal(belief.playedCounts.get('heavy-attack'), 1, 'records the opponent play');
  assert.ok(!belief.playedCounts.has('block'), 'does not record our own play');

  const pool = belief._remainingPool();
  const heavyCount = pool.filter(c => c === 'heavy-attack').length;
  assert.equal(heavyCount, 1, 'one heavy-attack removed from the plausible pool (2 total minus 1 witnessed)');
});

test('cardbattle fog: belief sample respects requested hand/deck counts', () => {
  const belief = new CardBattleBelief('p1', 'p2');
  const worlds = belief.sample(4, 5, 6, Math.random);
  assert.equal(worlds.length, 6);
  for (const w of worlds) {
    assert.equal(w.hand.length, 4);
    assert.equal(w.deck.length, 5);
    for (const c of [...w.hand, ...w.deck]) assert.ok(CARD_TYPES.has(c));
  }
});

test('cardbattle fog: Obscuro plays a fog game to completion against Random', async () => {
  const ps = players().map((p, i) => ({
    ...p, agent: i === 0 ? new ObscuroAgent(CardBattleGame, { particles: 3, rows: 4, cols: 4, iters: 40 }) : RandomAgent,
  }));
  const { result } = await new GameEngine(CardBattleGame, ps, { maxTurns: 60, fogOfWar: true }).run();
  assert.ok(result && typeof result.outcome === 'string');
});

test('cardbattle fog: Obscuro vs Obscuro plays a fog game to completion', async () => {
  const ps = players().map(p => ({
    ...p, agent: new ObscuroAgent(CardBattleGame, { particles: 3, rows: 4, cols: 4, iters: 40 }),
  }));
  const { result } = await new GameEngine(CardBattleGame, ps, { maxTurns: 60, fogOfWar: true }).run();
  assert.ok(result && typeof result.outcome === 'string');
});
