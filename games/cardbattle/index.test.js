import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CardBattleGame } from './index.js';
import { GameEngine } from '../../engine/index.js';
import { RandomAgent } from '../../agents/index.js';

function players() {
  return [
    { id: 'p1', name: 'P1', agent: RandomAgent },
    { id: 'p2', name: 'P2', agent: RandomAgent },
  ];
}

function forceHands(state, hands) {
  return { ...state, gameSpecific: { ...state.gameSpecific, hands } };
}

function act(state, p1Card, p2Card) {
  const p1Hero = state.units.find(u => u.ownerId === 'p1');
  const p2Hero = state.units.find(u => u.ownerId === 'p2');
  return CardBattleGame.applyActions(state, [
    { playerId: 'p1', action: { type: 'play-card', unitId: p1Hero.id, payload: { card: p1Card, handIndex: 0, targetId: p2Hero.id } } },
    { playerId: 'p2', action: { type: 'play-card', unitId: p2Hero.id, payload: { card: p2Card, handIndex: 0, targetId: p1Hero.id } } },
  ]);
}

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

test('cardbattle: both heroes start alive at max HP', () => {
  const state = CardBattleGame.createInitialState(players());
  const heroes = state.units.filter(u => u.type === 'hero');
  assert.equal(heroes.length, 2);
  assert.ok(heroes.every(h => h.alive && h.hp === 30));
});

test('cardbattle: both players start with 4 cards in hand', () => {
  const state = CardBattleGame.createInitialState(players());
  for (const p of state.players) {
    assert.equal(state.gameSpecific.hands[p.id].length, 4);
  }
});

test('cardbattle: both players are simultaneously active', () => {
  const state = CardBattleGame.createInitialState(players());
  assert.deepEqual(state.activePlayers.sort(), ['p1', 'p2']);
});

// ---------------------------------------------------------------------------
// getLegalActions
// ---------------------------------------------------------------------------

test('cardbattle: getLegalActions returns one action per hand card', () => {
  const state = CardBattleGame.createInitialState(players());
  const actions = CardBattleGame.getLegalActions(state, 'p1');
  assert.equal(actions.length, 4);
  assert.ok(actions.every(a => a.type === 'play-card'));
});

test('cardbattle: skipping player only has pass action', () => {
  const state = CardBattleGame.createInitialState(players());
  const skipping = { ...state, gameSpecific: { ...state.gameSpecific, skipping: { p1: true, p2: false } } };
  const actions = CardBattleGame.getLegalActions(skipping, 'p1');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].payload.card, 'pass');
});

// ---------------------------------------------------------------------------
// applyActions
// ---------------------------------------------------------------------------

test('cardbattle: attack card reduces enemy HP', () => {
  const state = forceHands(CardBattleGame.createInitialState(players()), {
    p1: ['attack', 'attack', 'attack', 'attack'],
    p2: ['block',  'block',  'block',  'block'],
  });
  const next = act(state, 'attack', 'block');
  const p2After = next.units.find(u => u.ownerId === 'p2');
  assert.ok(p2After.hp < 30, 'attack should reduce enemy HP');
});

test('cardbattle: block halves incoming damage', () => {
  const stateNoBlock = forceHands(CardBattleGame.createInitialState(players()), {
    p1: ['attack', 'attack', 'attack', 'attack'],
    p2: ['attack', 'attack', 'attack', 'attack'],
  });
  const stateBlock = forceHands(CardBattleGame.createInitialState(players()), {
    p1: ['attack', 'attack', 'attack', 'attack'],
    p2: ['block',  'block',  'block',  'block'],
  });
  const noBlock = act(stateNoBlock, 'attack', 'attack');
  const withBlock = act(stateBlock, 'attack', 'block');
  const p2NoBlock = noBlock.units.find(u => u.ownerId === 'p2');
  const p2Block   = withBlock.units.find(u => u.ownerId === 'p2');
  assert.ok(p2Block.hp > p2NoBlock.hp, 'block should reduce incoming damage');
});

test('cardbattle: heal restores HP', () => {
  const base = CardBattleGame.createInitialState(players());
  const wounded = {
    ...base,
    units: base.units.map(u => u.ownerId === 'p1' ? { ...u, hp: 20 } : u),
  };
  const state = forceHands(wounded, {
    p1: ['heal',  'heal',  'heal',  'heal'],
    p2: ['block', 'block', 'block', 'block'],
  });
  const next = act(state, 'heal', 'block');
  const p1After = next.units.find(u => u.ownerId === 'p1');
  assert.ok(p1After.hp > 20, 'heal should restore HP');
});

test('cardbattle: heavy-attack sets skip flag for next turn', () => {
  const state = forceHands(CardBattleGame.createInitialState(players()), {
    p1: ['heavy-attack', 'heavy-attack', 'heavy-attack', 'heavy-attack'],
    p2: ['block',        'block',        'block',        'block'],
  });
  const next = act(state, 'heavy-attack', 'block');
  assert.equal(next.gameSpecific.skipping['p1'], true);
});

test('cardbattle: hand is replenished to 4 cards after playing', () => {
  const state = CardBattleGame.createInitialState(players());
  const next = act(state, state.gameSpecific.hands['p1'][0], state.gameSpecific.hands['p2'][0]);
  assert.equal(next.gameSpecific.hands['p1'].length, 4);
  assert.equal(next.gameSpecific.hands['p2'].length, 4);
});

// ---------------------------------------------------------------------------
// getResult
// ---------------------------------------------------------------------------

test('cardbattle: getResult null while both heroes alive', () => {
  const state = CardBattleGame.createInitialState(players());
  assert.equal(CardBattleGame.getResult(state), null);
});

test('cardbattle: getResult win when one hero dies', () => {
  const state = CardBattleGame.createInitialState(players());
  const dead = { ...state, units: state.units.map(u => u.ownerId === 'p2' ? { ...u, hp: 0, alive: false } : u) };
  const result = CardBattleGame.getResult(dead);
  assert.equal(result.outcome, 'win');
  assert.equal(result.winnerId, 'p1');
});

test('cardbattle: getResult draw when both heroes die simultaneously', () => {
  const state = CardBattleGame.createInitialState(players());
  const bothDead = { ...state, units: state.units.map(u => ({ ...u, hp: 0, alive: false })) };
  const result = CardBattleGame.getResult(bothDead);
  assert.equal(result.outcome, 'draw');
});

// ---------------------------------------------------------------------------
// Self-play
// ---------------------------------------------------------------------------

test('cardbattle: self-play completes with a valid result', async () => {
  const engine = new GameEngine(CardBattleGame, players(), { maxTurns: 100 });
  const { result } = await engine.run();
  assert.ok(['win', 'draw'].includes(result.outcome));
});
