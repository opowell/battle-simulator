// The generic ObscuroAgent on games that are only the GameDefinition contract: Arena,
// and a stub with no fog or eval hooks. How it plays chess is chess's own
// generic-obscuro.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObscuroAgent } from './ObscuroAgent.js';
import { RandomAgent } from './RandomAgent.js';
import { ArenaGame } from '../../games/arena/index.js';
import { GameEngine } from '../engine/index.js';

// ---------------------------------------------------------------------------
// Generality: the SAME agent drives a completely different game (Arena). Arena
// has no evaluateState, so the search judges by terminals alone — the contract
// is all it needs to play legally.
// ---------------------------------------------------------------------------

test('generic obscuro: runs on Arena and returns a legal action', async () => {
  const players = [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];
  const state = ArenaGame.createInitialState(players, {});
  const legal = ArenaGame.getLegalActions(state, 'p1');
  const agent = new ObscuroAgent(ArenaGame, { rng: () => 0.5 });
  const action = await agent.chooseAction(state, legal);
  assert.ok(legal.includes(action), 'chosen Arena action must be one of the legal actions');
});

// About a minute, so it runs only with SLOW_TESTS=1.
test('generic obscuro: an Arena game vs RandomAgent completes', { skip: !process.env.SLOW_TESTS && 'slow: set SLOW_TESTS=1 to run it' }, async () => {
  const players = [
    { id: 'p1', name: 'P1', agent: new ObscuroAgent(ArenaGame, { rows: 5, cols: 5, iters: 60 }) },
    { id: 'p2', name: 'P2', agent: RandomAgent },
  ];
  const engine = new GameEngine(ArenaGame, players, { maxTurns: 20 });
  const { result } = await engine.run();
  assert.ok(result && typeof result.outcome === 'string', 'arena game should produce a result');
});

// ---------------------------------------------------------------------------
// Degradation: a game with NO imperfect-information hooks at all still gets a
// working, legality-respecting agent.
// ---------------------------------------------------------------------------

test('generic obscuro: works on a game with no fog/eval hooks', async () => {
  // Minimal coin-grab game: two players, whoever holds more coins when the pile
  // empties wins. No evaluateState, no sampleWorlds.
  const StubGame = {
    name: 'Stub',
    createInitialState: (players) => ({
      gameName: 'Stub', turnNumber: 1, activePlayers: [players[0].id], currentPhase: 'action',
      players, units: [], board: {}, lastActions: null,
      gameSpecific: { pile: 4, coins: { [players[0].id]: 0, [players[1].id]: 0 } },
    }),
    getLegalActions: (state) => state.gameSpecific.pile > 0 ? [{ type: 'take' }, { type: 'pass' }] : [],
    applyActions: (state, [{ playerId, action }]) => {
      const gs = { ...state.gameSpecific, coins: { ...state.gameSpecific.coins } };
      if (action.type === 'take' && gs.pile > 0) { gs.pile -= 1; gs.coins[playerId] += 1; }
      const other = state.players.find(p => p.id !== playerId).id;
      return { ...state, gameSpecific: gs, activePlayers: [other], lastActions: [{ playerId, action }] };
    },
    getResult: (state) => {
      if (state.gameSpecific.pile > 0) return null;
      const [a, b] = state.players;
      const ca = state.gameSpecific.coins[a.id], cb = state.gameSpecific.coins[b.id];
      if (ca === cb) return { outcome: 'draw', winnerId: null, reason: 'tie' };
      return { outcome: 'win', winnerId: ca > cb ? a.id : b.id, reason: 'more-coins' };
    },
    renderState: () => '',
  };

  const state = StubGame.createInitialState([{ id: 'p1' }, { id: 'p2' }]);
  const agent = new ObscuroAgent(StubGame, { rng: () => 0 });
  const legal = StubGame.getLegalActions(state, 'p1');
  const action = await agent.chooseAction(state, legal);
  // With getResult-only leaves it cannot tell 'take' from 'pass' yet (neither
  // ends the game), but it must still return one of the legal actions.
  assert.ok(legal.includes(action), 'must return a legal action even with no hooks');
});
