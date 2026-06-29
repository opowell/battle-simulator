import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RiskGame, TERRITORY_IDS, resolveCombat } from './index.js';
import { GameEngine } from '../../engine/index.js';
import { RandomAgent } from '../../agents/index.js';

function players() {
  return [
    { id: 'p1', name: 'P1', agent: RandomAgent },
    { id: 'p2', name: 'P2', agent: RandomAgent },
  ];
}

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

test('risk: all territories are owned and have at least 1 army', () => {
  const state = RiskGame.createInitialState(players());
  const territories = Object.values(state.board.territories);
  assert.equal(territories.length, TERRITORY_IDS.length);
  assert.ok(territories.every(t => t.owner !== null && t.armies >= 1));
});

test('risk: starts in reinforce phase', () => {
  const state = RiskGame.createInitialState(players());
  assert.equal(state.currentPhase, 'reinforce');
  assert.equal(state.activePlayers.length, 1);
});

test('risk: each player has at least one territory', () => {
  const state = RiskGame.createInitialState(players());
  const territories = Object.values(state.board.territories);
  for (const p of state.players) {
    assert.ok(territories.some(t => t.owner === p.id));
  }
});

// ---------------------------------------------------------------------------
// getLegalActions
// ---------------------------------------------------------------------------

test('risk: in reinforce phase, can place-armies or end-reinforce', () => {
  const state = RiskGame.createInitialState(players());
  const actions = RiskGame.getLegalActions(state, 'p1');
  assert.ok(actions.some(a => a.type === 'place-armies' || a.type === 'end-reinforce'));
});

test('risk: can only place-armies on own territories', () => {
  const state = RiskGame.createInitialState(players());
  const place = RiskGame.getLegalActions(state, 'p1').filter(a => a.type === 'place-armies');
  const ownedIds = new Set(
    Object.values(state.board.territories).filter(t => t.owner === 'p1').map(t => t.id)
  );
  assert.ok(place.every(a => ownedIds.has(a.territoryId)));
});

test('risk: in attack phase, can attack adjacent enemy territory', () => {
  const state = RiskGame.createInitialState(players());
  // Force past reinforce by exhausting reinforcements
  const noReinf = { ...state, gameSpecific: { ...state.gameSpecific, reinforcementsLeft: 0 } };
  const endReinf = RiskGame.applyActions(noReinf, [{ playerId: 'p1', action: { type: 'end-reinforce' } }]);
  assert.equal(endReinf.currentPhase, 'attack');
  const actions = RiskGame.getLegalActions(endReinf, 'p1');
  assert.ok(actions.some(a => a.type === 'attack' || a.type === 'end-attack'));
});

// ---------------------------------------------------------------------------
// applyActions
// ---------------------------------------------------------------------------

test('risk: place-armies increases territory army count', () => {
  const state = RiskGame.createInitialState(players());
  const p1Terr = Object.values(state.board.territories).find(t => t.owner === 'p1');
  const before = p1Terr.armies;
  const next = RiskGame.applyActions(state, [{
    playerId: 'p1',
    action: { type: 'place-armies', territoryId: p1Terr.id, count: 1 },
  }]);
  assert.equal(next.board.territories[p1Terr.id].armies, before + 1);
});

test('risk: place-armies decrements reinforcementsLeft', () => {
  const state = RiskGame.createInitialState(players());
  const before = state.gameSpecific.reinforcementsLeft;
  const p1Terr = Object.values(state.board.territories).find(t => t.owner === 'p1');
  const next = RiskGame.applyActions(state, [{
    playerId: 'p1',
    action: { type: 'place-armies', territoryId: p1Terr.id, count: 1 },
  }]);
  assert.equal(next.gameSpecific.reinforcementsLeft, before - 1);
});

test('risk: end-reinforce transitions to attack phase', () => {
  const state = RiskGame.createInitialState(players());
  const noReinf = { ...state, gameSpecific: { ...state.gameSpecific, reinforcementsLeft: 0 } };
  const next = RiskGame.applyActions(noReinf, [{ playerId: 'p1', action: { type: 'end-reinforce' } }]);
  assert.equal(next.currentPhase, 'attack');
});

test('risk: end-attack transitions to fortify phase', () => {
  const state = RiskGame.createInitialState(players());
  const noReinf = { ...state, gameSpecific: { ...state.gameSpecific, reinforcementsLeft: 0 } };
  const s1 = RiskGame.applyActions(noReinf, [{ playerId: 'p1', action: { type: 'end-reinforce' } }]);
  const s2 = RiskGame.applyActions(s1, [{ playerId: 'p1', action: { type: 'end-attack' } }]);
  assert.equal(s2.currentPhase, 'fortify');
});

// ---------------------------------------------------------------------------
// resolveCombat
// ---------------------------------------------------------------------------

test('risk: resolveCombat total losses ≤ min(attackerDice, defenderDice)', () => {
  for (let i = 0; i < 100; i++) {
    const result = resolveCombat(5, 3, 3, Math.random);
    assert.ok(result.attackerLosses + result.defenderLosses <= 2);
    assert.ok(result.attackerRolls.length >= 1 && result.attackerRolls.length <= 3);
    assert.ok(result.defenderRolls.length >= 1 && result.defenderRolls.length <= 2);
  }
});

test('risk: resolveCombat rolls are sorted descending', () => {
  for (let i = 0; i < 50; i++) {
    const { attackerRolls, defenderRolls } = resolveCombat(4, 2, 3, Math.random);
    for (let j = 1; j < attackerRolls.length; j++) assert.ok(attackerRolls[j - 1] >= attackerRolls[j]);
    for (let j = 1; j < defenderRolls.length; j++) assert.ok(defenderRolls[j - 1] >= defenderRolls[j]);
  }
});

// ---------------------------------------------------------------------------
// getResult
// ---------------------------------------------------------------------------

test('risk: getResult null while game is ongoing', () => {
  const state = RiskGame.createInitialState(players());
  assert.equal(RiskGame.getResult(state), null);
});

// ---------------------------------------------------------------------------
// Self-play
// ---------------------------------------------------------------------------

test('risk: self-play completes with a valid result', async () => {
  const engine = new GameEngine(RiskGame, players(), { maxTurns: 80 });
  const { result } = await engine.run();
  assert.ok(['win', 'draw', 'victory'].includes(result.outcome));
});
