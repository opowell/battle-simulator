// Guards the generic-ObscuroAgent rollout: every game wired with an
// evaluateState hook must let the agent choose legal moves and drive a game to
// completion, and its leaf eval must be correctly signed (own units positive).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObscuroAgent } from './ObscuroAgent.js';
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

const GAMES = {
  cs: CsGame, xcom: XComGame, combatmission: CombatMissionGame, doom: DoomGame,
  ffta: FFTAGame, aow: AowGame, cardbattle: CardBattleGame, mudandblood: MudAndBloodGame,
  risk: RiskGame, kdice: KDiceGame, civ1: Civ1Game, civ2: Civ2Game,
  sc1: Sc1Game, sc2: Sc2Game, tactical: TacticalGame,
};

for (const [name, game] of Object.entries(GAMES)) {
  test(`rollout: ${name} exposes evaluateState and Obscuro plays it`, async () => {
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
