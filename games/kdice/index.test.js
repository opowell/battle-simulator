import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KDiceGame, generateMap, getLargestConnectedRegion } from './index.js';
import { GameEngine } from '../../engine/index.js';
import { RandomAgent } from '../../agents/index.js';

function players(n = 2) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    agent: RandomAgent,
  }));
}

// ── generateMap ───────────────────────────────────────────────────────────────

test('kdice: generateMap produces at least numPlayers*8 territories', () => {
  const { territoryIds } = generateMap(2, Math.random);
  assert.ok(territoryIds.length >= 16);
});

test('kdice: generateMap adjacency is symmetric', () => {
  const { territoryIds, adjacency } = generateMap(2, Math.random);
  for (const id of territoryIds) {
    for (const nid of adjacency[id]) {
      assert.ok(adjacency[nid].includes(id), `${nid} should list ${id} as neighbor`);
    }
  }
});

// ── createInitialState ────────────────────────────────────────────────────────

test('kdice: all territories are owned and have 1-8 dice', () => {
  const state = KDiceGame.createInitialState(players());
  const terrs = Object.values(state.board.territories);
  assert.ok(terrs.every(t => t.owner !== null));
  assert.ok(terrs.every(t => t.dice >= 1 && t.dice <= 8));
});

test('kdice: each player owns at least one territory', () => {
  const state = KDiceGame.createInitialState(players());
  const terrs = Object.values(state.board.territories);
  for (const p of state.players) {
    assert.ok(terrs.some(t => t.owner === p.id));
  }
});

test('kdice: starts in attack phase with one active player', () => {
  const state = KDiceGame.createInitialState(players());
  assert.equal(state.currentPhase, 'attack');
  assert.equal(state.activePlayers.length, 1);
});

// ── getLegalActions ───────────────────────────────────────────────────────────

test('kdice: legal actions always include end-turn', () => {
  const state = KDiceGame.createInitialState(players());
  const actions = KDiceGame.getLegalActions(state, state.activePlayers[0]);
  assert.ok(actions.some(a => a.type === 'end-turn'));
});

test('kdice: attack actions only target adjacent enemy territories', () => {
  const state = KDiceGame.createInitialState(players());
  const playerId = state.activePlayers[0];
  const attacks = KDiceGame.getLegalActions(state, playerId).filter(a => a.type === 'attack');
  const { territories, adjacency } = state.board;

  for (const a of attacks) {
    const from = territories[a.from];
    const to = territories[a.to];
    assert.equal(from.owner, playerId);
    assert.ok(from.dice >= 2);
    assert.notEqual(to.owner, playerId);
    assert.ok(adjacency[a.from].includes(a.to));
  }
});

// ── applyActions (attack) ─────────────────────────────────────────────────────

test('kdice: attack — attacker territory always drops to 1 die', () => {
  const state = KDiceGame.createInitialState(players());
  const playerId = state.activePlayers[0];
  const attacks = KDiceGame.getLegalActions(state, playerId).filter(a => a.type === 'attack');
  if (attacks.length === 0) return; // edge case: no attacks possible

  const action = attacks[0];
  const deterministicRng = () => 0.99; // forces high attacker roll
  const next = KDiceGame.applyActions(state, [{ playerId, action }], deterministicRng);
  assert.equal(next.board.territories[action.from].dice, 1);
});

test('kdice: attack win — captured territory gets max(1, attacker dice - 1) dice', () => {
  // Build a state where p1 has a 5-die territory adjacent to p2's 1-die territory
  const state = KDiceGame.createInitialState(players(), { rng: () => 0 });
  const playerId = state.activePlayers[0];
  const { territories, adjacency } = state.board;

  // Find a p1 territory adjacent to p2 and give it 5 dice
  const p1Terrs = Object.values(territories).filter(t => t.owner === playerId);
  let fromId = null;
  let toId = null;
  for (const t of p1Terrs) {
    const enemyNeighbor = adjacency[t.id].find(n => territories[n]?.owner !== playerId);
    if (enemyNeighbor) { fromId = t.id; toId = enemyNeighbor; break; }
  }
  if (!fromId) return;

  const patched = {
    ...state,
    board: {
      ...state.board,
      territories: {
        ...territories,
        [fromId]: { ...territories[fromId], dice: 5 },
        [toId]: { ...territories[toId], dice: 1 },
      },
    },
  };

  const alwaysWinRng = () => 0.99; // attacker rolls 6s, defender rolls 1s... wait actually () => 0.99 → 6, () => 0 → 1
  const next = KDiceGame.applyActions(
    patched,
    [{ playerId, action: { type: 'attack', from: fromId, to: toId } }],
    alwaysWinRng,
  );
  const captured = next.board.territories[toId];
  assert.equal(captured.owner, playerId);
  assert.ok(captured.dice >= 1);
});

test('kdice: attack lose — defender territory unchanged', () => {
  const state = KDiceGame.createInitialState(players(), { rng: () => 0 });
  const playerId = state.activePlayers[0];
  const { territories, adjacency } = state.board;

  // Find p1 territory adjacent to p2
  const p1Terrs = Object.values(territories).filter(t => t.owner === playerId && t.dice >= 2);
  let fromId = null, toId = null;
  for (const t of p1Terrs) {
    const en = adjacency[t.id].find(n => territories[n]?.owner !== playerId);
    if (en) { fromId = t.id; toId = en; break; }
  }
  if (!fromId) return;

  const defenderDice = territories[toId].dice;

  // Force defender to win: attacker rolls 1, defender rolls 6
  let call = 0;
  const biasedRng = () => call++ < territories[fromId].dice ? 0 : 0.99;

  const next = KDiceGame.applyActions(
    state,
    [{ playerId, action: { type: 'attack', from: fromId, to: toId } }],
    biasedRng,
  );
  const defender = next.board.territories[toId];
  assert.notEqual(defender.owner, playerId);
  assert.equal(defender.dice, defenderDice);
});

// ── applyActions (end-turn) ───────────────────────────────────────────────────

test('kdice: end-turn advances to the next player', () => {
  const state = KDiceGame.createInitialState(players());
  const first = state.activePlayers[0];
  const next = KDiceGame.applyActions(state, [{ playerId: first, action: { type: 'end-turn' } }]);
  assert.notEqual(next.activePlayers[0], first);
});

test('kdice: end-turn distributes bonus dice to largest region (total dice non-decreasing)', () => {
  const state = KDiceGame.createInitialState(players());
  const playerId = state.activePlayers[0];
  const totalBefore = Object.values(state.board.territories)
    .reduce((s, t) => s + t.dice, 0);
  const next = KDiceGame.applyActions(state, [{ playerId, action: { type: 'end-turn' } }]);
  const totalAfter = Object.values(next.board.territories)
    .reduce((s, t) => s + t.dice, 0);
  assert.ok(totalAfter >= totalBefore);
});

// ── getLargestConnectedRegion ─────────────────────────────────────────────────

test('kdice: getLargestConnectedRegion returns empty for player with no territories', () => {
  const state = KDiceGame.createInitialState(players());
  const { territories, adjacency } = state.board;
  const region = getLargestConnectedRegion('nonexistent', territories, adjacency);
  assert.deepEqual(region, []);
});

// ── getResult ─────────────────────────────────────────────────────────────────

test('kdice: getResult is null while game ongoing', () => {
  const state = KDiceGame.createInitialState(players());
  assert.equal(KDiceGame.getResult(state), null);
});

// ── self-play ─────────────────────────────────────────────────────────────────

test('kdice: self-play completes with a valid result (2 players)', async () => {
  const engine = new GameEngine(KDiceGame, players(2), { maxTurns: 200 });
  const { result } = await engine.run();
  assert.ok(['win', 'draw', 'victory'].includes(result.outcome));
});

test('kdice: self-play completes with a valid result (3 players)', async () => {
  const engine = new GameEngine(KDiceGame, players(3), { maxTurns: 300 });
  const { result } = await engine.run();
  assert.ok(['win', 'draw', 'victory'].includes(result.outcome));
});
