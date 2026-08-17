import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RiskGame, TERRITORY_IDS, ADJACENCY, resolveCombat } from './index.js';
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

// World Domination seats the full table — you plus five AI rivals (api-server's
// defaultPlayers) — the largest game the starting-army table covers, and the one
// where the 42 territories are stretched thinnest: 7 apiece, 20 armies each.
test('risk: a 6-player table splits the board evenly and places every army', () => {
  const six = Array.from({ length: 6 }, (_, i) => ({ id: 'p' + (i + 1), name: 'P' + (i + 1), agent: RandomAgent }));
  const state = RiskGame.createInitialState(six);
  const territories = Object.values(state.board.territories);
  for (const p of six) {
    const owned = territories.filter(t => t.owner === p.id);
    assert.equal(owned.length, TERRITORY_IDS.length / 6);
    assert.equal(owned.reduce((s, t) => s + t.armies, 0), 20);
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

test('risk: placing the last army ends the reinforce phase by itself', () => {
  const state = RiskGame.createInitialState(players());
  const p1Terr = Object.values(state.board.territories).find(t => t.owner === 'p1');
  const oneLeft = { ...state, gameSpecific: { ...state.gameSpecific, reinforcementsLeft: 1 } };
  const next = RiskGame.applyActions(oneLeft, [{
    playerId: 'p1',
    action: { type: 'place-armies', territoryId: p1Terr.id, count: 1 },
  }]);
  assert.equal(next.gameSpecific.reinforcementsLeft, 0);
  assert.equal(next.currentPhase, 'attack');
});

test('risk: the last army does NOT end the phase while a card set could still be turned in', () => {
  const state = RiskGame.createInitialState(players());
  const p1Terr = Object.values(state.board.territories).find(t => t.owner === 'p1');
  const withSet = {
    ...state,
    gameSpecific: {
      ...state.gameSpecific,
      reinforcementsLeft: 1,
      cards: { ...state.gameSpecific.cards, p1: [
        { type: 'infantry', territory: 'alaska' },
        { type: 'infantry', territory: 'peru' },
        { type: 'infantry', territory: 'egypt' },
      ] },
    },
  };
  const next = RiskGame.applyActions(withSet, [{
    playerId: 'p1',
    action: { type: 'place-armies', territoryId: p1Terr.id, count: 1 },
  }]);
  assert.equal(next.currentPhase, 'reinforce');
  const actions = RiskGame.getLegalActions(next, 'p1');
  assert.ok(actions.some(a => a.type === 'turn-in-cards'));
  assert.ok(actions.some(a => a.type === 'end-reinforce'));
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

// ---------------------------------------------------------------------------
// Rule options
// ---------------------------------------------------------------------------

// Puts p1 in the attack phase with a stack big enough to take a one-army neighbour,
// so what happens AFTER the capture can be examined.
function attackReady(config = {}) {
  const state = RiskGame.createInitialState(players(), config);
  const territories = { ...state.board.territories };
  const mine = Object.values(territories).find(t =>
    t.owner === 'p1' && (ADJACENCY[t.id] ?? []).some(id => territories[id].owner !== 'p1'));
  const target = (ADJACENCY[mine.id] ?? []).find(id => territories[id].owner !== 'p1');
  territories[mine.id] = { ...territories[mine.id], armies: 10 };
  territories[target] = { ...territories[target], armies: 1 };
  return {
    state: {
      ...state,
      currentPhase: 'attack',
      board: { ...state.board, territories },
      gameSpecific: { ...state.gameSpecific, reinforcementsLeft: 0 },
    },
    from: mine.id,
    to: target,
  };
}

// Rigged rng: resolveCombat rolls the attacker's dice first and the defender's after,
// so the first `dice` calls come out 6 and the rest 1. The capture is then certain and
// the test is about what follows it, not about luck.
function riggedRng(dice) {
  let call = 0;
  return () => (call++ < dice ? 0.999 : 0);
}

test('risk: a capture asks how many armies follow the dice in (postCaptureFortify on)', () => {
  const { state, from, to } = attackReady();
  const after = RiskGame.applyActions(state,
    [{ playerId: 'p1', action: { type: 'attack', from, to, attackerDice: 3 } }], riggedRng(3));
  assert.equal(after.board.territories[to].owner, 'p1');
  const pending = after.gameSpecific.pendingOccupy;
  assert.ok(pending, 'expected a pending occupy after the capture');
  // A phase of its own while it lasts, so the UI can say what it's waiting for.
  assert.equal(after.currentPhase, 'occupy');
  assert.equal(pending.from, from);
  assert.equal(pending.to, to);
  // Everything above the one army that must hold the attacking territory may follow.
  assert.equal(pending.max, after.board.territories[from].armies - 1);

  // Nothing else is legal until it is answered, and every choice is an `occupy`.
  const actions = RiskGame.getLegalActions(after, 'p1');
  assert.ok(actions.length > 1);
  assert.ok(actions.every(a => a.type === 'occupy'));

  const moved = RiskGame.applyActions(after,
    [{ playerId: 'p1', action: { type: 'occupy', from, to, armies: 2 } }]);
  assert.equal(moved.gameSpecific.pendingOccupy, null);
  assert.equal(moved.currentPhase, 'attack', 'the attack phase resumes once occupied');
  assert.equal(moved.board.territories[to].armies, after.board.territories[to].armies + 2);
  assert.equal(moved.board.territories[from].armies, after.board.territories[from].armies - 2);
});

test('risk: with postCaptureFortify off, only the dice move in', () => {
  const { state, from, to } = attackReady({ postCaptureFortify: false });
  const after = RiskGame.applyActions(state,
    [{ playerId: 'p1', action: { type: 'attack', from, to, attackerDice: 3 } }], riggedRng(3));
  assert.equal(after.board.territories[to].owner, 'p1');
  assert.equal(after.gameSpecific.pendingOccupy, null);
  assert.equal(after.board.territories[to].armies, 3);
  assert.ok(RiskGame.getLegalActions(after, 'p1').some(a => a.type === 'end-attack'));
});

test('risk: card sets are worth a flat 6 by default, and escalate on request', () => {
  const set = [
    { type: 'infantry', territory: null },
    { type: 'infantry', territory: null },
    { type: 'infantry', territory: null },
  ];
  const withHand = (config, cardSetCount) => {
    const s = RiskGame.createInitialState(players(), config);
    return {
      ...s,
      gameSpecific: {
        ...s.gameSpecific, cardSetCount, reinforcementsLeft: 0,
        cards: { ...s.gameSpecific.cards, p1: [...set] },
      },
    };
  };
  const turnIn = (state) => RiskGame.applyActions(state,
    [{ playerId: 'p1', action: { type: 'turn-in-cards', cardIndices: [0, 1, 2] } }]).gameSpecific.reinforcementsLeft;

  assert.equal(turnIn(withHand({}, 0)), 6);
  assert.equal(turnIn(withHand({}, 4)), 6);
  assert.equal(turnIn(withHand({ cardSetValues: 'increasing' }, 0)), 4);
  assert.equal(turnIn(withHand({ cardSetValues: 'increasing' }, 4)), 12);
});

test('risk: unlimited fortify keeps offering moves after the first', () => {
  const base = RiskGame.createInitialState(players(), { fortifyMoves: 'unlimited' });
  const state = { ...base, currentPhase: 'fortify', gameSpecific: { ...base.gameSpecific, hasFortified: true } };
  assert.ok(RiskGame.getLegalActions(state, 'p1').some(a => a.type === 'fortify'));

  const once = RiskGame.createInitialState(players(), {});
  const onceState = { ...once, currentPhase: 'fortify', gameSpecific: { ...once.gameSpecific, hasFortified: true } };
  assert.ok(!RiskGame.getLegalActions(onceState, 'p1').some(a => a.type === 'fortify'));
});

test('risk: random reinforcements place themselves and start the turn at the attack phase', () => {
  const state = RiskGame.createInitialState(players(), { reinforcePlacement: 'random' });
  assert.equal(state.gameSpecific.reinforcementsLeft, 0);
  assert.equal(state.currentPhase, 'attack');
  const mine = Object.values(state.board.territories).filter(t => t.owner === 'p1');
  assert.ok(mine.reduce((s, t) => s + t.armies, 0) > mine.length);
  assert.ok(!RiskGame.getLegalActions(state, 'p1').some(a => a.type === 'place-armies'));
});

test('risk: turn-in-cards actions carry a label naming the cards and the bonus', () => {
  const s = RiskGame.createInitialState(players());
  const state = {
    ...s,
    gameSpecific: {
      ...s.gameSpecific,
      cards: { ...s.gameSpecific.cards, p1: [
        { type: 'infantry', territory: 'alaska' },
        { type: 'cavalry', territory: 'peru' },
        { type: 'artillery', territory: 'egypt' },
      ] },
    },
  };
  const action = RiskGame.getLegalActions(state, 'p1').find(a => a.type === 'turn-in-cards');
  assert.ok(action, 'expected a turn-in-cards action');
  assert.match(action.label, /INF/);
  assert.match(action.label, /Alaska/);
  assert.match(action.label, /\+6 armies/);
});

test('risk: toGrid reports reinforcements left and the hand as status chips', () => {
  const s = RiskGame.createInitialState(players());
  const state = {
    ...s,
    gameSpecific: {
      ...s.gameSpecific, reinforcementsLeft: 4,
      cards: { ...s.gameSpecific.cards, p1: [{ type: 'cavalry', territory: 'peru' }] },
    },
  };
  const chips = RiskGame.toGrid(state).statusChips.p1;
  assert.ok(chips.some(c => String(c.value).includes('4 to place')));
  assert.ok(chips.some(c => c.value === 'CAV'));
});
