import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '#core/engine/index.js';
import { RandomAgent } from '#core/agents/RandomAgent.js';
import { ArenaGame, UNIT_TYPES } from './index.js';
import { segmentCells, segmentCost, lineOfSight } from './geometry.js';
import { strikeDamage, MAX_WAIT } from './ArenaGame.js';

const PLAYERS = [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];

// A small open board with exactly the units given: [owner, type, x, y].
function arena(config, units) {
  const state = ArenaGame.createInitialState(PLAYERS, {
    width: 10, height: 6, terrain: {}, ...config,
    units: units.map(([ownerId, type, x, y], i) => ({ id: `${ownerId}-${i}`, ownerId, type, position: { x, y }, alive: true, hp: UNIT_TYPES[type].hp })),
  });
  return state;
}
const act = (state, playerId, action) => ArenaGame.applyActions(state, [{ playerId, action }]);
const unit = (state, id) => state.units.find(u => u.id === id);
const END = { type: 'end-turn', unitId: '__player__' };

// ── Geometry ────────────────────────────────────────────────────────────────

test('segmentCells measures exactly how much of a segment lies in each cell', () => {
  const cells = segmentCells(0.5, 0.5, 3.5, 1.2);
  const total = cells.reduce((s, c) => s + c.len, 0);
  assert.ok(Math.abs(total - Math.hypot(3, 0.7)) < 1e-12);
  assert.deepEqual(cells.map(c => `${c.cx},${c.cy}`), ['0,0', '1,0', '2,0', '2,1', '3,1']);
  // Straight through a corner: no zero-length cell is reported.
  const diag = segmentCells(0.5, 0.5, 2.5, 2.5);
  assert.deepEqual(diag.map(c => `${c.cx},${c.cy}`), ['0,0', '1,1', '2,2']);
  assert.deepEqual(segmentCells(0.5, 0.5, 3.5, 1.5).map(c => `${c.cx},${c.cy}`), ['0,0', '1,0', '2,1', '3,1']);
});

test('segmentCost prices terrain by the length crossed; impassable ground is Infinity', () => {
  const board = { width: 5, height: 1, terrain: { '2,0': 'forest', '4,0': 'water' } };
  // 0.5 + 1 open, 1 forest (cost 2), 0.5 open
  assert.ok(Math.abs(segmentCost(board, 0.5, 0.5, 3.5, 0.5) - (0.5 + 1 + 2 + 0.5)) < 1e-12);
  assert.equal(segmentCost(board, 0.5, 0.5, 4.5, 0.5), Infinity);
  assert.equal(segmentCost(board, 0.5, 0.5, 5.5, 0.5), Infinity); // off the board
});

test('rock blocks sight, water does not, and endpoint cells never block', () => {
  const board = { width: 5, height: 1, terrain: { '2,0': 'rock', '1,0': 'water' } };
  assert.equal(lineOfSight(board, 0.5, 0.5, 4.5, 0.5), false);
  assert.equal(lineOfSight(board, 0.5, 0.5, 1.5, 0.5), true);
  assert.equal(lineOfSight(board, 2.5, 0.5, 4.5, 0.5), true);
});

// ── Setup ───────────────────────────────────────────────────────────────────

test('positions take the active space\'s form: cells, or the centres of cells', () => {
  const d = ArenaGame.createInitialState(PLAYERS, {});
  const c = ArenaGame.createInitialState(PLAYERS, { space: 'continuous' });
  for (const [a, b] of d.units.map((u, i) => [u, c.units[i]])) {
    assert.ok(Number.isInteger(a.position.x) && Number.isInteger(a.position.y));
    assert.deepEqual(b.position, { x: a.position.x + 0.5, y: a.position.y + 0.5 });
  }
  assert.equal(d.units.length, 10);
  assert.ok(d.units.every(u => u.stats && u.stats.speed > 0));
});

// ── Discrete time ───────────────────────────────────────────────────────────

test('discrete space: a move is a terrain-priced path, made once a turn', () => {
  let s = arena({ terrain: { '2,0': 'forest' } }, [['p1', 'infantry', 0, 0], ['p2', 'infantry', 9, 5]]);
  const moves = ArenaGame.getLegalActions(s, 'p1').filter(a => a.type === 'move');
  const tos = new Set(moves.map(m => `${m.to.x},${m.to.y}`));
  assert.ok(tos.has('3,0'), 'speed 3 reaches (3,0) around or through the wood');
  assert.ok(!tos.has('4,0'));
  s = act(s, 'p1', moves.find(m => m.to.x === 1 && m.to.y === 0));
  assert.deepEqual(unit(s, 'p1-0').position, { x: 1, y: 0 });
  assert.ok(!ArenaGame.getLegalActions(s, 'p1').some(a => a.type === 'move'), 'one move a turn');
});

test('a strike deals the deterministic formula, with cover raising defense', () => {
  const s = arena({ terrain: { '1,0': 'forest' } }, [['p1', 'knight', 0, 0], ['p2', 'infantry', 1, 0], ['p2', 'infantry', 0, 1]]);
  const k = unit(s, 'p1-0');
  // 6² / (6 + 4) = 3.6 → 3 in the open; 36 / (6 + 4·1.5) = 3 in the forest
  assert.equal(strikeDamage(s, k, unit(s, 'p2-2')), 3);
  assert.equal(strikeDamage(s, k, unit(s, 'p2-1')), 3);
  const after = act(s, 'p1', { type: 'attack', unitId: 'p1-0', targetId: 'p2-2' });
  assert.equal(unit(after, 'p2-2').hp, 7);
  assert.ok(!ArenaGame.getLegalActions(after, 'p1').some(a => a.type === 'attack'), 'rate 1: one strike a turn');
});

test('a missile needs a clear line; melee does not', () => {
  const s = arena({ terrain: { '2,0': 'rock' } }, [['p1', 'archer', 0, 0], ['p2', 'infantry', 4, 0], ['p2', 'infantry', 3, 1]]);
  const targets = ArenaGame.getLegalActions(s, 'p1').filter(a => a.type === 'attack').map(a => a.targetId);
  assert.deepEqual(targets, ['p2-2']);
});

test('a turn ends once every seat has ended it — in either order (we-go safe)', () => {
  const s = arena({}, [['p1', 'infantry', 0, 0], ['p2', 'infantry', 9, 5]]);
  const used = act(act(s, 'p1', ArenaGame.getLegalActions(s, 'p1').find(a => a.type === 'move')), 'p2',
    ArenaGame.getLegalActions(s, 'p2').find(a => a.type === 'move'));
  for (const order of [['p1', 'p2'], ['p2', 'p1']]) {
    const mid = act(used, order[0], END);
    assert.equal(mid.turnNumber, 1);
    const next = act(mid, order[1], END);
    assert.equal(next.turnNumber, 2);
    assert.deepEqual(next.activePlayers, ['p1']);
    assert.ok(next.units.every(u => u.perTurn.moveLeft === u.stats.speed), 'budgets reset for everyone');
  }
});

test('continuous space: any reachable point is a legal move, priced exactly', () => {
  const s = arena({ space: 'continuous', terrain: { '1,0': 'forest' } }, [['p1', 'infantry', 0, 0], ['p2', 'infantry', 9, 5]]);
  const move = (to) => ({ type: 'move', unitId: 'p1-0', from: { x: 0.5, y: 0.5 }, to });
  assert.ok(ArenaGame.isActionLegal(s, 'p1', move({ x: 2.4, y: 0.5 })), '0.5 + 2 + 0.4 = 2.9 ≤ 3');
  assert.ok(!ArenaGame.isActionLegal(s, 'p1', move({ x: 2.6, y: 0.5 })), '3.1 > 3');
  const after = act(s, 'p1', move({ x: 2.4, y: 0.5 }));
  assert.deepEqual(unit(after, 'p1-0').position, { x: 2.4, y: 0.5 });
  // The lattice: points all round, those off the board or out of budget dropped.
  const lattice = ArenaGame.getLegalActions(s, 'p1').filter(a => a.type === 'move');
  assert.ok(lattice.length >= 8);
  assert.ok(lattice.every(m => ArenaGame.isActionLegal(s, 'p1', m)));
});

// ── Continuous time ─────────────────────────────────────────────────────────

test('continuous time: an order is a task, and the clock runs when nobody has a decision', () => {
  let s = arena({ time: 'continuous' }, [['p1', 'infantry', 0, 0], ['p2', 'infantry', 9, 5]]);
  assert.equal(s.gameSpecific.rt.clock, 0);
  assert.deepEqual(s.activePlayers, ['p1']);
  const move = ArenaGame.getLegalActions(s, 'p1').find(a => a.type === 'move' && a.to.x === 3 && a.to.y === 0);
  assert.equal(ArenaGame.getActionDuration(s, move), 1, '3 open cells at speed 3: one window');
  s = act(s, 'p1', move);
  assert.ok(unit(s, 'p1-0').task, 'p1-0 is under way');
  assert.deepEqual(s.activePlayers, ['p2']);
  s = act(s, 'p2', { type: 'wait', unitId: 'p2-1', duration: 1.5 });
  // Nobody can decide at t=0 any more: the clock ran to the arrival at t=1.
  assert.equal(s.gameSpecific.rt.clock, 1);
  assert.deepEqual(unit(s, 'p1-0').position, { x: 3, y: 0 });
  assert.deepEqual(s.activePlayers, ['p1']);
});

test('continuous time: strikes landing at the same instant all land', () => {
  let s = arena({ time: 'continuous', simultaneousTurns: true }, [['p1', 'infantry', 0, 0], ['p2', 'infantry', 1, 0]]);
  assert.deepEqual(s.activePlayers, ['p1', 'p2'], 'simultaneous: both seats on move at once');
  s = ArenaGame.applyActions(s, [
    { playerId: 'p1', action: { type: 'attack', unitId: 'p1-0', targetId: 'p2-1' } },
    { playerId: 'p2', action: { type: 'attack', unitId: 'p2-1', targetId: 'p1-0' } },
  ]);
  assert.equal(s.gameSpecific.rt.clock, 0.5);
  assert.equal(unit(s, 'p1-0').hp, 8);
  assert.equal(unit(s, 'p2-1').hp, 8);
});

test('continuous time: a wait may be any length in range, not only the offered ones', () => {
  const s = arena({ time: 'continuous' }, [['p1', 'infantry', 0, 0], ['p2', 'infantry', 9, 5]]);
  assert.ok(ArenaGame.isActionLegal(s, 'p1', { type: 'wait', unitId: 'p1-0', duration: 0.37 }));
  assert.ok(!ArenaGame.isActionLegal(s, 'p1', { type: 'wait', unitId: 'p1-0', duration: MAX_WAIT + 1 }));
  assert.ok(!ArenaGame.isActionLegal(s, 'p1', { type: 'wait', unitId: 'p1-0', duration: 0 }));
});

test('continuous time: a moving unit can be struck where it is mid-journey', () => {
  let s = arena({ time: 'continuous', space: 'continuous' }, [['p1', 'archer', 0, 0], ['p2', 'cavalry', 9, 0]]);
  // p2 rides toward the archer; it ends its decision, the archer looses at once.
  s = act(s, 'p1', { type: 'wait', unitId: 'p1-0', duration: 0.5 });
  s = act(s, 'p2', { type: 'move', unitId: 'p2-1', from: { x: 9.5, y: 0.5 }, to: { x: 3.5, y: 0.5 } });
  assert.equal(s.gameSpecific.rt.clock, 0.5);
  assert.ok(Math.abs(unit(s, 'p2-1').position.x - 6.5) < 1e-9, 'halfway: 3 of 6 at speed 6');
});

test('a standoff — nothing happening and everyone passing — is a draw', () => {
  let s = arena({ time: 'continuous' }, [['p1', 'infantry', 0, 0], ['p2', 'infantry', 9, 5]]);
  for (let i = 0; i < 200 && !ArenaGame.getResult(s); i++) s = act(s, s.activePlayers[0], END);
  assert.deepEqual(ArenaGame.getResult(s), { outcome: 'draw', winnerId: null, reason: 'standoff' });
});

// ── Fog ─────────────────────────────────────────────────────────────────────

test('fog hides what no unit sees, and the result reads the survivor counts', () => {
  const s = arena({ fogOfWar: true }, [['p1', 'infantry', 0, 0], ['p2', 'infantry', 9, 5], ['p2', 'scout', 3, 0]]);
  const view = ArenaGame.getVisibleState(s, 'p1');
  assert.deepEqual(view.units.map(u => u.id).sort(), ['p1-0', 'p2-2']);
  assert.equal(ArenaGame.getResult(view), null, 'a hidden army is not a dead one');
});

// ── Through the engine, in every corner ─────────────────────────────────────

test('all eight (space × time × play) modes play to a finish through the engine', async () => {
  for (const space of ['discrete', 'continuous']) for (const time of ['discrete', 'continuous']) for (const sim of [false, true]) {
    const players = PLAYERS.map(p => ({ ...p, agent: RandomAgent }));
    const e = new GameEngine(ArenaGame, players, { space, time, simultaneousTurns: sim, maxTurns: 12 });
    const { result } = await e.run();
    assert.ok(result, `${space}/${time}/${sim}`);
  }
});

test('continuous time is never wrapped in we-go planning, even with one seat on move', async () => {
  const players = PLAYERS.map(p => ({ ...p, agent: RandomAgent }));
  const e = new GameEngine(ArenaGame, players, { time: 'continuous', simultaneousTurns: true, maxTurns: 3 });
  await e.run();
  assert.ok(e.log.every(entry => !entry.simultaneous));
});
