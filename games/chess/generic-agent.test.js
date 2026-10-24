// The core's generic AI (src/agents/generic/) on a game it was not written for:
// it reads chess's pieces off their algebraic squares, and picks a legal move.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGenericAgent } from '#core/agents/generic/GenericAgent.js';
import { readBattle } from '#core/agents/generic/battleView.js';
import { ChessGame } from './index.js';

const seats = () => [{ id: 'white' }, { id: 'black' }];

test('the generic AI reads every piece onto the board', () => {
  const pieces = readBattle(ChessGame, ChessGame.createInitialState(seats(), {})).units;
  assert.ok(pieces.length === 32 && pieces.every(u => u.point && u.point.x >= 0 && u.point.x < 8));
});

test('the generic AI plays chess legally', () => {
  const chess = ChessGame.createInitialState(seats(), {});
  const legal = ChessGame.getLegalActions(chess, 'white');
  const pick = makeGenericAgent(ChessGame, { timeMs: 50 }).chooseAction(chess, legal, ChessGame);
  assert.ok(legal.some(a => JSON.stringify(a) === JSON.stringify(pick)));
});
