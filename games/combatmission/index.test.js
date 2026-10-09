import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CombatMissionGame } from './index.js';
import { num, BigNumber } from '../coord.js';
import { isPassable, isPassableContinuous } from './map.js';
import { ticksLeft, apLeft } from './rules.js';
import { GameEngine } from '../../engine/index.js';
import { RandomAgent } from '../../agents/index.js';

function players() {
  return [
    { id: 'allied', name: 'Allied', agent: RandomAgent },
    { id: 'axis',   name: 'Axis',   agent: RandomAgent },
  ];
}

function endTurn(state, playerId) {
  return CombatMissionGame.applyActions(state, [{ playerId, action: { type: 'end-turn', unitId: '__player__' } }]);
}

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

test('combatmission: both sides have units', () => {
  const state = CombatMissionGame.createInitialState(players());
  assert.ok(state.units.some(u => u.ownerId === 'allied' && u.alive));
  assert.ok(state.units.some(u => u.ownerId === 'axis'   && u.alive));
});

test('combatmission: units start with a turn to spend (a minute, or AP in discrete time)', () => {
  const state = CombatMissionGame.createInitialState(players());
  assert.ok(state.units.every(u => ticksLeft(u) > 0));
  const discrete = CombatMissionGame.createInitialState(players(), { time: 'discrete' });
  assert.ok(discrete.units.every(u => apLeft(u) > 0));
});

test('combatmission: allied player goes first', () => {
  const state = CombatMissionGame.createInitialState(players());
  assert.deepEqual(state.activePlayers, ['allied']);
});

// ---------------------------------------------------------------------------
// getLegalActions
// ---------------------------------------------------------------------------

test('combatmission: getLegalActions includes end-turn and move', () => {
  const state = CombatMissionGame.createInitialState(players());
  const actions = CombatMissionGame.getLegalActions(state, 'allied');
  assert.ok(actions.some(a => a.type === 'end-turn'));
  assert.ok(actions.some(a => a.type === 'move'));
});

test('combatmission: getLegalActions includes skip-unit', () => {
  const state = CombatMissionGame.createInitialState(players());
  const actions = CombatMissionGame.getLegalActions(state, 'allied');
  assert.ok(actions.some(a => a.type === 'skip-unit'));
});

// ---------------------------------------------------------------------------
// applyActions
// ---------------------------------------------------------------------------

test('combatmission: end-turn by allied switches to axis', () => {
  const state = CombatMissionGame.createInitialState(players());
  const next  = endTurn(state, 'allied');
  assert.deepEqual(next.activePlayers, ['axis']);
});

test('combatmission: end-turn by axis returns to allied and increments turn', () => {
  const state = CombatMissionGame.createInitialState(players());
  const s2    = endTurn(endTurn(state, 'allied'), 'axis');
  assert.equal(s2.turnNumber, 2);
  assert.deepEqual(s2.activePlayers, ['allied']);
});

test('combatmission: end-turn restores AP for the next player', () => {
  const state = CombatMissionGame.createInitialState(players());
  // Spend all AP for allied
  const noAP = { ...state, units: state.units.map(u => u.ownerId === 'allied' ? { ...u, perTurn: { ap: 0 } } : u) };
  const next = endTurn(noAP, 'allied');
  // Axis units should have full AP now
  const axisUnits = next.units.filter(u => u.ownerId === 'axis');
  assert.ok(axisUnits.every(u => ticksLeft(u) > 0));
});

test('combatmission: move updates unit position', () => {
  const state = CombatMissionGame.createInitialState(players());
  const move  = CombatMissionGame.getLegalActions(state, 'allied').find(a => a.type === 'move');
  if (!move) return;
  const next  = CombatMissionGame.applyActions(state, [{ playerId: 'allied', action: move }]);
  const moved = next.units.find(u => u.id === move.unitId);
  // Positions are authoritative BigNumbers now (continuous coordinates); compare in
  // Number-space (see games/coord.js).
  assert.equal(num(moved.position.x), move.to.x);
  assert.equal(num(moved.position.y), move.to.y);
});

test('combatmission: skip-unit spends the rest of that unit\'s turn', () => {
  const state = CombatMissionGame.createInitialState(players());
  const skip  = CombatMissionGame.getLegalActions(state, 'allied').find(a => a.type === 'skip-unit');
  const next  = CombatMissionGame.applyActions(state, [{ playerId: 'allied', action: skip }]);
  assert.equal(ticksLeft(next.units.find(u => u.id === skip.unitId)), 0);
});

// ---------------------------------------------------------------------------
// Where units stand: the middle of a square, never against the map's edge
// ---------------------------------------------------------------------------

const SCENARIOS = ['bocage', 'river_line', 'hill_woods', 'ambush'];
// Exactly x.5 — the authoritative BigNumber, not a float that happens to print so.
const centred = (v) => v.minus(v.integerValue(BigNumber.ROUND_FLOOR)).eq(0.5);

for (const scenario of SCENARIOS) {
  test(`combatmission (${scenario}): units deploy in the middle of open squares, clear of the edge`, () => {
    const state = CombatMissionGame.createInitialState(players(), { scenario });
    const { board } = state;
    const drawn = new Map(CombatMissionGame.toGrid(state).units.map(u => [u.id, u]));
    for (const u of state.units) {
      const { x, y } = u.position;
      assert.ok(centred(x) && centred(y), `${u.id} stands at (${x}, ${y}), not a square's middle`);
      assert.ok(isPassable(board, x, y) && isPassableContinuous(board, num(x), num(y)), `${u.id} starts on open ground`);
      // The token as the board draws it (its footprint) stays off the border ring.
      const f = drawn.get(u.id).footprint;
      const [hx, hy] = f.shape === 'circle' ? [f.r, f.r]
        : [Math.abs(f.w / 2 * Math.cos(f.ang)) + Math.abs(f.h / 2 * Math.sin(f.ang)),
           Math.abs(f.w / 2 * Math.sin(f.ang)) + Math.abs(f.h / 2 * Math.cos(f.ang))];
      assert.ok(num(x) - hx >= 1 && num(y) - hy >= 1 && num(x) + hx <= board.width - 1 && num(y) + hy <= board.height - 1,
        `${u.id} (${u.type}) is drawn over the map's edge`);
      // The wire carries the exact decimal.
      assert.equal(drawn.get(u.id).x, x.toString());
    }
  });
}

test('combatmission: every enumerated move ends in the middle of a square, in either time', () => {
  for (const time of ['continuous', 'discrete']) {
    const state = CombatMissionGame.createInitialState(players(), { time });
    const moves = CombatMissionGame.getLegalActions(state, 'allied').filter(a => a.type === 'move');
    assert.ok(moves.length > 0);
    for (const m of moves) assert.ok([m.to.x, m.to.y].every(v => v % 1 === 0.5), `${time}: move to (${m.to.x}, ${m.to.y})`);
    // …and lands there exactly.
    const next = CombatMissionGame.applyActions(state, [{ playerId: 'allied', action: moves[0] }]);
    const p = next.units.find(u => u.id === moves[0].unitId).position;
    assert.ok(centred(p.x) && centred(p.y));
  }
});

test('combatmission: the border ring is wall to free movement on every side', () => {
  const { board } = CombatMissionGame.createInitialState(players());
  const W = board.width, H = board.height;
  for (const [x, y] of [[0.5, 5.5], [5.5, 0.5], [W - 0.5, 5.5], [5.5, H - 0.5], [0.99, 1.5], [1.5, 0.99]])
    assert.equal(isPassableContinuous(board, x, y), false, `(${x}, ${y}) is border`);
  assert.equal(isPassableContinuous(board, 1, 1.5), isPassable(board, 1, 1), 'the first square starts at 1');
});

// ---------------------------------------------------------------------------
// getResult
// ---------------------------------------------------------------------------

test('combatmission: getResult null while both sides have units', () => {
  assert.equal(CombatMissionGame.getResult(CombatMissionGame.createInitialState(players())), null);
});

test('combatmission: getResult win when axis has no alive units', () => {
  const state = CombatMissionGame.createInitialState(players());
  const noAxis = { ...state, units: state.units.map(u => u.ownerId === 'axis' ? { ...u, alive: false, hp: 0 } : u) };
  const result = CombatMissionGame.getResult(noAxis);
  assert.equal(result.outcome, 'win');
  assert.equal(result.winnerId, 'allied');
});

// ---------------------------------------------------------------------------
// Self-play
// ---------------------------------------------------------------------------

test('combatmission: self-play completes with a valid result', async () => {
  const engine = new GameEngine(CombatMissionGame, players(), { maxTurns: 150 });
  const { result } = await engine.run();
  assert.ok(['win', 'draw'].includes(result.outcome));
});
