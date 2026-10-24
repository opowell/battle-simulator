/**
 * The checks every game's own agents.test.js runs against the core's generic
 * agents, so a game carries them with it:
 *
 *   - greedy (GreedyAgent, the low-memory 1-ply heuristic AI that ships for
 *     every game) chooses a legal opening move and drives a short game to a
 *     result;
 *   - rollout (the generic ObscuroAgent) plays a game wired with an
 *     evaluateState hook, whose leaf eval must be finite and signed. These are
 *     slow — minutes for some games — so they run only with SLOW_TESTS=1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGreedyAgent } from './GreedyAgent.js';
import { ObscuroAgent } from './ObscuroAgent.js';
import { RandomAgent } from './RandomAgent.js';
import { GameEngine } from '../engine/index.js';

const SLOW = process.env.SLOW_TESTS ? false : 'slow: set SLOW_TESTS=1 to run it';

/** @param {string} name  @param {object} game  @param {string[]} [seats] the game's own seat ids */
export function greedyChecks(name, game, seats = ['p1', 'p2']) {
  test(`greedy: ${name} — legal opening move and a completed game`, async () => {
    const state = game.createInitialState(seats.map(id => ({ id, name: id })), {});
    const me = state.activePlayers[0];

    // Choosing from the engine-supplied legal list must return one of its members
    // (for discrete games) — never a fabricated/re-rolled action.
    const legal = game.getLegalActions(state, me);
    const agent = makeGreedyAgent(game);
    const action = await agent.chooseAction(state, legal, game);
    assert.ok(action != null, `${name}: greedy returned no action`);
    if (!game.getSearchActions && !game.getSearchLegalActions) {
      assert.ok(legal.includes(action), `${name}: greedy must pick from the supplied legal list`);
    }

    // A short game against RandomAgent completes with a well-formed result.
    const players = seats.map((id, i) => ({ id, name: id, agent: i === 0 ? agent : RandomAgent }));
    const { result } = await new GameEngine(game, players, { maxTurns: 12 }).run();
    assert.ok(result && typeof result.outcome === 'string', `${name}: no result produced`);
  });
}

/** @param {string} name  @param {object} game */
export function rolloutChecks(name, game) {
  test(`rollout: ${name} exposes evaluateState and Obscuro plays it`, { skip: SLOW }, async () => {
    assert.equal(typeof game.evaluateState, 'function', `${name} must expose evaluateState`);

    const state = game.createInitialState([{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }], {});
    const me = state.activePlayers[0];
    const v = game.evaluateState(state, me);
    assert.equal(typeof v, 'number', `${name} evaluateState must return a number`);
    assert.ok(Number.isFinite(v), `${name} evaluateState must be finite`);

    // Zero-sum sanity: from the mover's view the value is the negation of the
    // opponent's view (holds for every helper-based eval).
    const opp = state.players.find(p => p.id !== me)?.id ?? me;
    if (opp !== me) {
      assert.ok(v * game.evaluateState(state, opp) <= 0 || v === 0,
        `${name} eval should flip sign between the two sides`);
    }

    // The agent must return a legal opening move.
    const legal = game.getLegalActions(state, me);
    const agent = new ObscuroAgent(game, { particles: 2, rows: 4, cols: 4, iters: 30 });
    const action = await agent.chooseAction(state, legal);
    assert.ok(action != null, `${name}: agent returned no action`);

    // And a short game against RandomAgent completes with a result.
    const players = state.players.map((p, i) => ({
      ...p, agent: i === 0 ? agent : RandomAgent,
    }));
    const { result } = await new GameEngine(game, players, { maxTurns: 10 }).run();
    assert.ok(result && typeof result.outcome === 'string', `${name}: no result produced`);
  });
}
