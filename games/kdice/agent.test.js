import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KDiceGame } from './index.js';
import { KDiceAgent, rankAttacks, evaluatePosition } from './agent.js';
import { makeGreedyAgent } from '../../agents/GreedyAgent.js';
import { sidesEval } from '../evalHelpers.js';
import { GameEngine } from '../../engine/index.js';

const players = (n, agent) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, agent }));

// A small hand-made board: p1 holds a and b, p2 holds c, d and a tail e–f behind them
// (a–c, b–d, c–d, d–e, e–f adjacent), so no two attacks can end the game.
function board(dice, stock = {}) {
  const adjacency = { a: ['b', 'c'], b: ['a', 'd'], c: ['a', 'd'], d: ['b', 'c', 'e'], e: ['d', 'f'], f: ['e'] };
  const owner = { a: 'p1', b: 'p1', c: 'p2', d: 'p2', e: 'p2', f: 'p2' };
  const territories = {};
  for (const id of Object.keys(adjacency)) territories[id] = { id, owner: owner[id], dice: dice[id] ?? 2, neighbors: adjacency[id] };
  return {
    players: [{ id: 'p1' }, { id: 'p2' }], activePlayers: ['p1'], turnNumber: 1,
    board: { territories, adjacency },
    gameSpecific: { eliminatedPlayers: [], stock: { p1: 0, p2: 0, ...stock }, stockMax: 64 },
  };
}

test('kdice AI: does not throw a small stack at a bigger one', () => {
  const s = board({ a: 3, b: 1, c: 6, d: 2 });
  const legal = KDiceGame.getLegalActions(s, 'p1');
  assert.equal(KDiceAgent.chooseAction(s, legal).type, 'end-turn');
});

test('kdice AI: takes a near-certain capture', () => {
  const s = board({ a: 8, b: 1, c: 1, d: 1 });
  const legal = KDiceGame.getLegalActions(s, 'p1');
  const play = KDiceAgent.chooseAction(s, legal);
  assert.equal(play.type, 'attack');
  assert.equal(play.from, 'a');
});

test('kdice AI: a full reserve makes an even fight worth taking', () => {
  // 8 against 8 is a 47% shot. With nothing in reserve, losing leaves a one-die
  // territory facing an 8; with a full reserve the lost dice are refilled at once.
  const legal = (s) => KDiceGame.getLegalActions(s, 'p1');
  const poor = board({ a: 8, b: 8, c: 8, d: 8 });
  const rich = board({ a: 8, b: 8, c: 8, d: 8 }, { p1: 64 });
  const v = (s) => rankAttacks(s, legal(s))[0].value;
  assert.ok(v(rich) > v(poor), `reserve should make the attack better (${v(rich)} vs ${v(poor)})`);
  assert.equal(KDiceAgent.chooseAction(rich, legal(rich)).type, 'attack');
});

test('kdice AI: a bigger connected region is worth more', () => {
  const joined = board({ a: 2, b: 2, c: 2, d: 2 });
  const split = { ...joined, board: { ...joined.board, adjacency: { ...joined.board.adjacency, a: ['c'], b: ['d'] } } };
  assert.ok(evaluatePosition(joined, 'p1') > evaluatePosition(split, 'p1'));
});

test('kdice AI: finishes a 7-player game', async () => {
  const engine = new GameEngine(KDiceGame, players(7, KDiceAgent), { maxTurns: 400 });
  const { result } = await engine.run();
  assert.equal(result?.outcome, 'win');
});

test('kdice AI: beats the old greedy agent as the lone seat at a 7-player table', async () => {
  // The old greedy agent: the generic 1-ply agent on the territories+dice leaf the game
  // had before the KDice AI. An equal agent would win 1 in 7; demo/kdice-bench.mjs
  // measures ~35-40% over hundreds of games. This is a smoke check, so it asks only
  // for clearly more than an equal share (7 of 35 = 20% against 14%; at the measured rate
  // that fails well under 1% of runs).
  const oldGame = {
    ...KDiceGame,
    evaluateState: (st, p) => sidesEval(Object.values(st.board.territories), p, t => 10 + (t.dice ?? 0), t => t.owner),
  };
  const greedy = makeGreedyAgent(oldGame);
  const old = { id: 'greedy', chooseAction: (st, l) => greedy.chooseAction(st, l, oldGame) };
  let wins = 0;
  const games = 35;
  for (let g = 0; g < games; g++) {
    const seat = g % 7;
    const ps = players(7, old).map((p, i) => (i === seat ? { ...p, agent: KDiceAgent } : p));
    const { result } = await new GameEngine(KDiceGame, ps, { maxTurns: 300 }).run();
    if (result?.winnerId === `p${seat + 1}`) wins++;
  }
  assert.ok(wins >= 7, `lone KDice AI won ${wins}/${games}`);
});
