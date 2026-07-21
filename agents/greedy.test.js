// Guards the generic GreedyAgent (agents/GreedyAgent.js): the low-memory 1-ply
// heuristic AI that ships for every game. Every game must let it choose a legal
// opening move and drive a short game to a result, and its terminal-value
// override must make it pick a game-winning move when one exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGreedyAgent, GreedyAgent, greedyChoose } from './GreedyAgent.js';
import { RandomAgent } from './RandomAgent.js';
import { GameEngine } from '../engine/index.js';

import { CsGame } from '../games/cs/index.js';
import { XComGame } from '../games/xcom/index.js';
import { CombatMissionGame } from '../games/combatmission/index.js';
import { DoomGame } from '../games/doom/index.js';
import { FFTAGame } from '../games/ffta/index.js';
import { AowGame } from '../games/aow/index.js';
import { CardBattleGame } from '../games/cardbattle/index.js';
import { MudAndBloodGame } from '../games/mudandblood/index.js';
import { RiskGame } from '../games/risk/index.js';
import { KDiceGame } from '../games/kdice/index.js';
import { Civ1Game } from '../games/civ1/index.js';
import { Civ2Game } from '../games/civ2/index.js';
import { Sc1Game } from '../games/sc1/index.js';
import { Sc2Game } from '../games/sc2/index.js';
import { TacticalGame } from '../games/tactical/index.js';
import { AxisAlliesGame } from '../games/axisallies/index.js';
import { WarodDotsGame } from '../games/warofdots/index.js';
import { SurvivGame } from '../games/surviv/index.js';
import { ChessGame } from '../games/chess/index.js';

const PIDS = {
  chess: ['white', 'black'], axisallies: ['allies', 'axis'], xcom: ['xcom', 'aliens'],
  cs: ['ct', 't'], doom: ['marine', 'demons'], mudandblood: ['allies', 'axis'],
  warofdots: ['player', 'ai'], surviv: ['blue', 'red'],
};

const GAMES = {
  cs: CsGame, xcom: XComGame, combatmission: CombatMissionGame, doom: DoomGame,
  ffta: FFTAGame, aow: AowGame, cardbattle: CardBattleGame, mudandblood: MudAndBloodGame,
  risk: RiskGame, kdice: KDiceGame, civ1: Civ1Game, civ2: Civ2Game, sc1: Sc1Game,
  sc2: Sc2Game, tactical: TacticalGame, axisallies: AxisAlliesGame,
  warofdots: WarodDotsGame, surviv: SurvivGame, chess: ChessGame,
};

for (const [name, game] of Object.entries(GAMES)) {
  test(`greedy: ${name} — legal opening move and a completed game`, async () => {
    const ids = PIDS[name] ?? ['p1', 'p2'];
    const state = game.createInitialState(ids.map(id => ({ id, name: id })), {});
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
    const players = ids.map((id, i) => ({ id, name: id, agent: i === 0 ? agent : RandomAgent }));
    const { result } = await new GameEngine(game, players, { maxTurns: 12 }).run();
    assert.ok(result && typeof result.outcome === 'string', `${name}: no result produced`);
  });
}

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
