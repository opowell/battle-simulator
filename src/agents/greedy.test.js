// Guards the generic GreedyAgent (src/agents/GreedyAgent.js): the low-memory 1-ply
// heuristic AI that ships for every game. Its terminal-value override must make it
// pick a game-winning move when one exists. That every game lets it choose a legal
// opening move and drive a short game to a result is each game's own agents.test.js
// (agentChecks.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GreedyAgent, greedyChoose } from './GreedyAgent.js';

// Terminal awareness: given a synthetic 1-move-to-win game, greedy takes the win
// rather than a heuristically "richer" but non-winning move.
test('greedy: prefers a game-winning move over a higher-eval non-winning one', () => {
  const game = {
    getLegalActions: () => [{ type: 'win' }, { type: 'stall' }],
    applyActions: (s, [{ action }]) => ({ ...s, done: action.type === 'win' }),
    // 'stall' scores higher on the heuristic, but 'win' ends the game in our favour.
    evaluateState: (s) => (s.done ? 0 : 5),
    getResult: (s) => (s.done ? { outcome: 'win', winnerId: 'p1' } : null),
  };
  const state = { activePlayers: ['p1'], players: [{ id: 'p1' }, { id: 'p2' }] };
  const { action } = greedyChoose(state, game.getLegalActions(), game, () => 0.5);
  assert.equal(action.type, 'win');
});

// The zero-alloc singleton reads the game from the 3rd argument and still works.
test('greedy: GreedyAgent singleton uses the engine-supplied game arg', () => {
  const game = {
    getLegalActions: () => [{ type: 'a' }, { type: 'b' }],
    applyActions: (s, [{ action }]) => ({ ...s, pick: action.type }),
    evaluateState: (s) => (s.pick === 'b' ? 1 : -1),
  };
  const state = { activePlayers: ['p1'], players: [{ id: 'p1' }] };
  const action = GreedyAgent.chooseAction(state, game.getLegalActions(), game);
  assert.equal(action.type, 'b');
});
