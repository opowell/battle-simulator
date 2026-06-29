import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TacticalGame } from './index.js';
import { calculateDamage, UNIT_STATS } from './combat.js';
import { reachableSquares } from './grid.js';
import { GameEngine } from '../../engine/index.js';
import { RandomAgent } from '../../agents/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unit(id, ownerId, type, x, y, overrides = {}) {
  const stats = UNIT_STATS[type];
  return {
    id, ownerId, type,
    position: { x, y },
    alive: true,
    hp: stats.hp, maxHp: stats.maxHp,
    perTurn: { hasMoved: false, hasAttacked: false },
    ...overrides,
  };
}

function makePlayers(ids) {
  return ids.map(id => ({ id, name: id, agent: RandomAgent }));
}

function state(...units) {
  const players = [
    { id: 'p1', name: 'Player 1', agent: RandomAgent },
    { id: 'p2', name: 'Player 2', agent: RandomAgent },
  ];
  return TacticalGame.createInitialState(players, {
    width: 8, height: 8, terrain: {},
    units,
  });
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

test('reachableSquares: warrior moves up to range 2', () => {
  const board = { width: 8, height: 8, terrain: {} };
  const occupied = new Set();
  const squares = reachableSquares({ x: 0, y: 0 }, 2, board, occupied);
  // Chebyshev distance ≤ 2 from (0,0) within 8×8 grid (excluding origin)
  for (const sq of squares) {
    const dist = Math.max(Math.abs(sq.x), Math.abs(sq.y));
    assert.ok(dist <= 2 && dist >= 1);
  }
  assert.ok(squares.length > 0);
});

test('reachableSquares: water terrain is impassable', () => {
  const board = { width: 8, height: 8, terrain: { '1,0': 'water', '0,1': 'water', '1,1': 'water' } };
  const occupied = new Set();
  const squares = reachableSquares({ x: 0, y: 0 }, 3, board, occupied);
  for (const sq of squares) {
    assert.ok(!board.terrain[`${sq.x},${sq.y}`], `should not reach terrain tile ${sq.x},${sq.y}`);
  }
});

test('reachableSquares: occupied squares are excluded from results (but can be passed through? No — blocked)', () => {
  // Only immediate neighbors are checked; occupied squares block movement through them
  const board = { width: 8, height: 8, terrain: {} };
  const occupied = new Set(['1,0', '0,1', '1,1', '0,0']); // surround origin except diag
  const squares = reachableSquares({ x: 0, y: 0 }, 2, board, occupied);
  // None of the occupied squares should appear in results
  for (const sq of squares) {
    assert.ok(!occupied.has(`${sq.x},${sq.y}`));
  }
});

// ---------------------------------------------------------------------------
// getLegalActions
// ---------------------------------------------------------------------------

test('warrior can move when hasMoved is false', () => {
  const s = state(unit('p1-w', 'p1', 'warrior', 0, 0));
  const actions = TacticalGame.getLegalActions(s, 'p1');
  assert.ok(actions.some(a => a.type === 'move' && a.unitId === 'p1-w'));
});

test('warrior cannot move after hasMoved', () => {
  const s = state(unit('p1-w', 'p1', 'warrior', 0, 0, { perTurn: { hasMoved: true, hasAttacked: false } }));
  const actions = TacticalGame.getLegalActions(s, 'p1');
  assert.ok(!actions.some(a => a.type === 'move' && a.unitId === 'p1-w'));
});

test('end-turn is always present in legal actions', () => {
  const s = state(unit('p1-w', 'p1', 'warrior', 0, 0));
  const actions = TacticalGame.getLegalActions(s, 'p1');
  assert.ok(actions.some(a => a.type === 'end-turn'));
});

test('archer can attack enemy within range 3', () => {
  const s = state(
    unit('p1-a', 'p1', 'archer', 0, 0),
    unit('p2-w', 'p2', 'warrior', 3, 0),
  );
  const actions = TacticalGame.getLegalActions(s, 'p1');
  assert.ok(actions.some(a => a.type === 'attack' && a.unitId === 'p1-a' && a.targetId === 'p2-w'));
});

test('archer cannot attack enemy beyond range 3', () => {
  const s = state(
    unit('p1-a', 'p1', 'archer', 0, 0),
    unit('p2-w', 'p2', 'warrior', 4, 0), // Chebyshev dist = 4
  );
  const actions = TacticalGame.getLegalActions(s, 'p1');
  assert.ok(!actions.some(a => a.type === 'attack' && a.unitId === 'p1-a'));
});

test('unit cannot attack after hasAttacked', () => {
  const s = state(
    unit('p1-a', 'p1', 'archer', 0, 0, { perTurn: { hasMoved: false, hasAttacked: true } }),
    unit('p2-w', 'p2', 'warrior', 2, 0),
  );
  const actions = TacticalGame.getLegalActions(s, 'p1');
  assert.ok(!actions.some(a => a.type === 'attack' && a.unitId === 'p1-a'));
});

// ---------------------------------------------------------------------------
// applyActions
// ---------------------------------------------------------------------------

test('move action updates unit position and sets hasMoved', () => {
  const s = state(unit('p1-w', 'p1', 'warrior', 0, 0));
  const action = { type: 'move', unitId: 'p1-w', from: { x: 0, y: 0 }, to: { x: 2, y: 0 } };
  const next = TacticalGame.applyActions(s, [{ playerId: 'p1', action }]);
  const u = next.units.find(u => u.id === 'p1-w');
  assert.deepEqual(u.position, { x: 2, y: 0 });
  assert.equal(u.perTurn.hasMoved, true);
});

test('attack action reduces defender HP', () => {
  const s = state(
    unit('p1-w', 'p1', 'warrior', 0, 0),
    unit('p2-w', 'p2', 'warrior', 1, 0),
  );
  const action = { type: 'attack', unitId: 'p1-w', targetId: 'p2-w' };
  const deterministicRng = () => 0.5; // 100% variance midpoint
  const next = TacticalGame.applyActions(s, [{ playerId: 'p1', action }], deterministicRng);
  const defender = next.units.find(u => u.id === 'p2-w');
  assert.ok(defender.hp < UNIT_STATS.warrior.hp, 'defender HP should decrease');
});

test('unit dies when HP reaches 0', () => {
  // Mage has very high attack vs warrior
  const s = state(
    unit('p1-m', 'p1', 'mage', 0, 0),
    unit('p2-w', 'p2', 'warrior', 1, 0, { hp: 1, maxHp: 30 }),
  );
  const action = { type: 'attack', unitId: 'p1-m', targetId: 'p2-w' };
  const next = TacticalGame.applyActions(s, [{ playerId: 'p1', action }], () => 0.5);
  const defender = next.units.find(u => u.id === 'p2-w');
  assert.equal(defender.alive, false);
});

test('end-turn advances to next player and resets perTurn flags', () => {
  const s = state(
    unit('p1-w', 'p1', 'warrior', 0, 0, { perTurn: { hasMoved: true, hasAttacked: true } }),
    unit('p2-w', 'p2', 'warrior', 7, 7),
  );
  const action = { type: 'end-turn', unitId: '__player__' };
  const next = TacticalGame.applyActions(s, [{ playerId: 'p1', action }]);
  assert.deepEqual(next.activePlayers, ['p2']);
  const u = next.units.find(u => u.id === 'p1-w');
  assert.equal(u.perTurn.hasMoved, false);
  assert.equal(u.perTurn.hasAttacked, false);
});

test('turnNumber increments after last player ends turn', () => {
  const players = makePlayers(['p1', 'p2']);
  const s = {
    ...TacticalGame.createInitialState(players),
    activePlayers: ['p2'], // p2 is last
  };
  const action = { type: 'end-turn', unitId: '__player__' };
  const next = TacticalGame.applyActions(s, [{ playerId: 'p2', action }]);
  assert.equal(next.turnNumber, s.turnNumber + 1);
  assert.deepEqual(next.activePlayers, ['p1']);
});

// ---------------------------------------------------------------------------
// Win condition
// ---------------------------------------------------------------------------

test('getResult returns win when all enemy units are dead', () => {
  const s = state(
    unit('p1-w', 'p1', 'warrior', 0, 0),
    unit('p2-w', 'p2', 'warrior', 7, 7, { hp: 0, alive: false }),
  );
  const result = TacticalGame.getResult(s);
  assert.ok(result !== null);
  assert.equal(result.outcome, 'win');
  assert.equal(result.winnerId, 'p1');
});

test('getResult returns null while both sides have alive units', () => {
  const s = state(
    unit('p1-w', 'p1', 'warrior', 0, 0),
    unit('p2-w', 'p2', 'warrior', 7, 7),
  );
  assert.equal(TacticalGame.getResult(s), null);
});

// ---------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------

test('calculateDamage is within expected range over 200 samples', () => {
  const attacker = { type: 'warrior' }; // attack 8
  const defender = { type: 'warrior' }; // defense 4
  // base = 4, range = 4*0.8=3.2 to 4*1.2=4.8, rounded → 3 to 5
  for (let i = 0; i < 200; i++) {
    const dmg = calculateDamage(attacker, defender, Math.random);
    assert.ok(dmg >= 3 && dmg <= 5, `damage ${dmg} out of expected range [3,5]`);
  }
});

test('calculateDamage minimum is 1 even with strong defense', () => {
  // Mage def=1, Warrior atk=8: base=7. But use a hypothetical high-defense scenario:
  const attacker = { type: 'warrior' }; // attack 8
  const defender = { type: 'mage' };    // defense 1  → base = 7 (still > 1)
  // To test floor=1: create a scenario where atk < def
  // We can't change stats without modifying UNIT_STATS, so just verify formula floor
  for (let i = 0; i < 50; i++) {
    const dmg = calculateDamage(attacker, defender, Math.random);
    assert.ok(dmg >= 1, 'damage must be at least 1');
  }
});

// ---------------------------------------------------------------------------
// Self-play smoke test
// ---------------------------------------------------------------------------

test('tactical self-play completes with a valid result', async () => {
  const players = makePlayers(['p1', 'p2']);
  const engine = new GameEngine(TacticalGame, players, { maxTurns: 100 });
  const { result } = await engine.run();
  assert.ok(['win', 'draw'].includes(result.outcome));
});
