// Tests for chess in the three non-standard quadrants (games/chess/spacetime.js).
// Standard and fog chess are covered by index.test.js and are only checked here for
// the one thing this change could break: that they still take the old code path.

import { test } from 'node:test';
import assert from 'node:assert';

import { ChessGame } from './ChessGame.js';
import {
  geometricMoves, contactWindow, resolveVariant, isSpacetimeVariant,
  sqOf, gridOf, PIECE_SPEED, HITBOX_R,
} from './spacetime.js';

const PLAYERS = [{ id: 'white', name: 'White' }, { id: 'black', name: 'Black' }];
const CONFIG = {
  clockwork: { space: 'discrete', time: 'continuous' },
  melee: { space: 'continuous', time: 'continuous' },
  sliding: { space: 'continuous', time: 'discrete' },
};

const start = (variant) => ChessGame.createInitialState(PLAYERS, CONFIG[variant]);
const apply = (state, playerId, action) => ChessGame.applyActions(state, [{ playerId, action }]);
const legal = (state, playerId) => ChessGame.getLegalActions(state, playerId);
const unit = (state, id) => state.units.find((u) => u.id === id);
const at = (state, sq) => {
  const c = gridOf(sq);
  return state.units.find((u) => u.alive && (u.cell ? u.cell.x === c.x && u.cell.y === c.y
    : gridOf(u.position).x === c.x && gridOf(u.position).y === c.y));
};
const find = (state, playerId, pred) => {
  const a = legal(state, playerId).find(pred);
  assert.ok(a, 'expected such an action to be legal');
  return a;
};
/** Both sides pass, which is what makes the clock run (continuous time only). */
const runClock = (state) => {
  const w = apply(state, 'white', { type: 'wait', unitId: '__player__' });
  return apply(w, w.activePlayers[0], { type: 'wait', unitId: '__player__' });
};

// ── Which quadrant is in force ──────────────────────────────────────────────

test('resolveVariant maps the four quadrants onto the four variants', () => {
  const v = (cfg) => resolveVariant(ChessGame, cfg).variant;
  assert.equal(v({}), 'standard');
  assert.equal(v({ space: 'discrete', time: 'discrete' }), 'standard');
  assert.equal(v({ space: 'discrete', time: 'continuous' }), 'clockwork');
  assert.equal(v({ space: 'continuous', time: 'continuous' }), 'melee');
  assert.equal(v({ space: 'continuous', time: 'discrete' }), 'sliding');
});

test('standard and fog chess keep the old code path, in both spellings', () => {
  for (const cfg of [{}, { fogOfWar: true }, { space: 'discrete', time: 'discrete' }]) {
    const s = ChessGame.createInitialState(PLAYERS, cfg);
    assert.equal(isSpacetimeVariant(s), false);
    assert.ok(s.board.e2, 'the algebraic board is still the state');
    assert.ok(legal(s, 'white').every((a) => a.type === 'move' || a.type === 'castle'));
  }
});

test('every non-standard variant is full-information and won on the king', () => {
  for (const variant of Object.keys(CONFIG)) {
    const s = ChessGame.createInitialState(PLAYERS, { ...CONFIG[variant], fogOfWar: true });
    assert.equal(s.gameSpecific.fogOfWar, false, `${variant} must not claim to have fog`);
    assert.equal(ChessGame.getVisibleState(s, 'white'), s);
    assert.equal(ChessGame.getResult(s), null);
    const noKing = { ...s, units: s.units.filter((u) => !(u.type === 'king' && u.ownerId === 'black')) };
    assert.deepEqual(ChessGame.getResult(noKing),
      { outcome: 'win', winnerId: 'white', reason: 'king-destroyed' });
  }
});

// ── Move geometry ────────────────────────────────────────────────────────────

test('a knight walks its L, and every one of the three routes is on offer', () => {
  const moves = geometricMoves({ type: 'knight', ownerId: 'white' }, gridOf('e4'));
  const toF6 = moves.filter((m) => sqOf(m.to.x, m.to.y) === 'f6');
  assert.equal(toF6.length, 3, 'three orders reach f6, differing only in the route');
  assert.deepEqual(new Set(toF6.map((m) => m.path.map((c) => sqOf(c.x, c.y)).join('-'))),
    new Set(['f4-f5-f6', 'e5-f5-f6', 'e5-e6-f6']));
  // Every step is a single orthogonal square — no jumping.
  for (const m of toF6) {
    let cur = gridOf('e4');
    for (const step of m.path) {
      assert.equal(Math.abs(step.x - cur.x) + Math.abs(step.y - cur.y), 1);
      cur = step;
    }
  }
});

test('a knight on the rim only offers routes that stay on the board', () => {
  const moves = geometricMoves({ type: 'knight', ownerId: 'white' }, gridOf('a1'));
  assert.ok(moves.every((m) => m.path.every((c) => c.x >= 0 && c.x < 8 && c.y >= 0 && c.y < 8)));
  assert.deepEqual(new Set(moves.map((m) => sqOf(m.to.x, m.to.y))), new Set(['b3', 'c2']));
});

test('slider destinations run past occupied squares, because the board will have changed', () => {
  const s = start('clockwork');
  const rookMoves = geometricMoves({ type: 'rook', ownerId: 'white' }, gridOf('a1'));
  const dests = new Set(rookMoves.map((m) => sqOf(m.to.x, m.to.y)));
  assert.ok(dests.has('a8'), 'the whole file is a destination even with pieces in the way');
  assert.ok(dests.has('h1'));
  // …but nothing may be ORDERED through a square its own side is standing on right now.
  assert.equal(legal(s, 'white').filter((a) => a.unitId === 'wR1').length, 0);
});

test('a pawn aims at its capture diagonals whether or not anything is standing there', () => {
  const moves = geometricMoves({ type: 'pawn', ownerId: 'white' }, gridOf('e2'));
  assert.deepEqual(new Set(moves.map((m) => sqOf(m.to.x, m.to.y))), new Set(['e3', 'e4', 'd3', 'f3']));
  // Black advances the other way, and only pawns on their home rank get the double push.
  const black = geometricMoves({ type: 'pawn', ownerId: 'black' }, gridOf('e5'));
  assert.deepEqual(new Set(black.map((m) => sqOf(m.to.x, m.to.y))), new Set(['e4', 'd4', 'f4']));
});

// ── Clockwork: discrete space, continuous time ──────────────────────────────

test('clockwork: an order is walked one square per cooldown, not teleported', () => {
  let s = start('clockwork');
  s = apply(s, 'white', find(s, 'white', (a) => a.unitId === 'wP5' && a.to === 'e4'));
  assert.equal(s.gameSpecific.rt.clock, 0, 'giving an order costs no clock');

  // A piece that is not cooling down sets off at once, so the first hop lands on the
  // same instant the order was given; only the SECOND costs a cooldown.
  s = runClock(s);
  assert.equal(at(s, 'e3')?.id, 'wP5');
  assert.equal(s.gameSpecific.rt.clock, 0);
  assert.ok(s.gameSpecific.rt.orders.wP5, 'still on its way');

  s = runClock(s);
  assert.equal(at(s, 'e4')?.id, 'wP5');
  // A pawn covers PIECE_SPEED.pawn squares per turn window, so one square is one window.
  assert.equal(s.gameSpecific.rt.clock, 1 / PIECE_SPEED.pawn);
  assert.equal(s.gameSpecific.rt.orders.wP5, undefined, 'arrived, so free to be re-ordered');
});

test('clockwork: a piece already on its way cannot be re-aimed, only called off', () => {
  let s = start('clockwork');
  s = apply(s, 'white', find(s, 'white', (a) => a.unitId === 'wP5' && a.to === 'e4'));
  // One decision per piece per instant: having just been ordered, it offers nothing more
  // until the clock has moved — otherwise ordering and un-ordering, both free, could go
  // round for ever and time would never pass.
  assert.equal(legal(s, 'white').filter((a) => a.unitId === 'wP5').length, 0);

  s = runClock(s);
  const mine = legal(s, 'white').filter((a) => a.unitId === 'wP5');
  assert.deepEqual(mine.map((a) => a.type), ['cancel'], 'committed: call it off or leave it');

  s = apply(s, 'white', mine[0]);
  assert.equal(s.gameSpecific.rt.orders.wP5, undefined);
  assert.equal(legal(s, 'white').filter((a) => a.unitId === 'wP5').length, 0);
  assert.ok(legal(runClock(s), 'white').some((a) => a.type === 'order' && a.unitId === 'wP5'));
});

test('clockwork: hopping onto an enemy takes it and the journey carries on', () => {
  // A white rook on a1 with the file cleared, aimed at a8: it should eat the black
  // pawn on a7 on the way and land on a8.
  let s = start('clockwork');
  s = { ...s, units: s.units.filter((u) => !['wP1', 'bR1'].includes(u.id)) };
  s = { ...s, board: Object.fromEntries(Object.entries(s.board).filter(([, p]) => p && !['wP1', 'bR1'].includes(p.id))) };

  s = apply(s, 'white', find(s, 'white', (a) => a.unitId === 'wR1' && a.to === 'a8'));
  for (let i = 0; i < 30 && s.gameSpecific.rt.orders.wR1; i++) s = runClock(s);

  assert.equal(at(s, 'a8')?.id, 'wR1');
  assert.equal(unit(s, 'bP1').alive, false, 'the pawn it hopped onto is gone');
  assert.equal(s.gameSpecific.rt.orders.bP1, undefined, 'and is not still under orders');
});

test('clockwork: hopping onto a friend calls the order off and still costs the cooldown', () => {
  // wR1 is behind wP1. Reach that position by hand rather than through the action
  // filter, which (deliberately) will not offer such an order in the first place.
  let s = start('clockwork');
  s = {
    ...s,
    gameSpecific: {
      ...s.gameSpecific,
      rt: { ...s.gameSpecific.rt, orders: { wR1: { path: [gridOf('a3')].map((c) => ({ ...c })), idx: 0, pathId: 0 } } },
    },
  };
  // a2 is its own pawn, and the rook's route runs through it.
  s = { ...s, gameSpecific: { ...s.gameSpecific, rt: { ...s.gameSpecific.rt, orders: { wR1: { path: [gridOf('a2'), gridOf('a3')], idx: 0, pathId: 0 } } } } };
  s = runClock(s);

  assert.equal(at(s, 'a1')?.id, 'wR1', 'it did not move');
  assert.equal(s.gameSpecific.rt.orders.wR1, undefined, 'the order is off');
  assert.equal(s.gameSpecific.rt.ready.wR1, s.gameSpecific.rt.clock + 1 / PIECE_SPEED.rook,
    'the bounce cost a full hop of cooldown — otherwise the clock could never move');
});

test('clockwork: a faster piece gets more hops out of the same stretch of clock', () => {
  let s = start('clockwork');
  // Clear a diagonal for the bishop and a file for the pawn, then aim both.
  s = { ...s, units: s.units.filter((u) => !['wP4', 'wP5'].includes(u.id)) };
  s = { ...s, board: Object.fromEntries(Object.entries(s.board).filter(([, p]) => p && !['wP4', 'wP5'].includes(p.id))) };
  s = apply(s, 'white', find(s, 'white', (a) => a.unitId === 'wB3' && a.to === 'g5'));
  s = apply(s, 'white', find(s, 'white', (a) => a.unitId === 'wP1' && a.to === 'a4'));
  for (let i = 0; i < 12 && s.gameSpecific.rt.clock < 1; i++) s = runClock(s);

  // One turn window in, the pawn (speed 1) has managed a square and a bit; the bishop
  // (speed 4) is three diagonal steps down the board. The exact counts are not the
  // point — that the same stretch of clock buys the faster piece more of it is.
  const pawnSteps = 6 - unit(s, 'wP1').cell.y;
  const bishopSteps = unit(s, 'wB3').cell.x - 2;
  assert.ok(bishopSteps > pawnSteps, `bishop ${bishopSteps} steps vs pawn ${pawnSteps}`);
  assert.ok(bishopSteps >= 3, 'and it is a long way ahead, not one square ahead');
});

// ── Contact geometry (the two continuous-space variants) ────────────────────

test('contactWindow solves the entry and exit of a straight-line pass', () => {
  // Head-on: a disk at the origin closing on one 5 away at unit speed, radii summing to 1.
  const w = contactWindow({ x: 5, y: 0 }, { x: -1, y: 0 }, 1);
  assert.ok(Math.abs(w.enter - 4) < 1e-9);
  assert.ok(Math.abs(w.exit - 6) < 1e-9);
  // A pass wide of the mark never touches.
  assert.equal(contactWindow({ x: 5, y: 3 }, { x: -1, y: 0 }, 1), null);
  // Already overlapping and not moving relative to each other: in contact forever.
  const stuck = contactWindow({ x: 0.1, y: 0 }, { x: 0, y: 0 }, 1);
  assert.equal(stuck.enter, -Infinity);
  assert.equal(stuck.exit, Infinity);
});

// ── Sliding: continuous space, discrete time ────────────────────────────────

test('sliding: a turn is one order, played out to a standstill, then the turn passes', () => {
  let s = start('sliding');
  assert.ok(legal(s, 'white').every((a) => a.type === 'move'), 'no clock to wait on here');

  const before = { ...unit(s, 'wP5').position };
  s = apply(s, 'white', find(s, 'white', (a) => a.unitId === 'wP5' && a.to === 'e4'));
  assert.deepEqual(s.activePlayers, ['black']);
  assert.notDeepEqual(unit(s, 'wP5').position, before);
  // It really arrived — a slide is resolved within the turn, not left in flight.
  assert.deepEqual(unit(s, 'wP5').position, { x: 4.5, y: 4.5 });
  assert.equal(Object.keys(s.gameSpecific.rt.orders).length, 0);
});

test('sliding: equal pieces that meet destroy each other; a queen shrugs a pawn off', () => {
  let s = start('sliding');
  s = apply(s, 'white', find(s, 'white', (a) => a.unitId === 'wP5' && a.to === 'e4'));
  s = apply(s, 'black', find(s, 'black', (a) => a.unitId === 'bP4' && a.to === 'd5'));
  // exd5: the pawns are the same piece, so contact is a mutual kill.
  s = apply(s, 'white', find(s, 'white', (a) => a.unitId === 'wP5' && a.to === 'd5'));
  assert.equal(unit(s, 'bP4').alive, false);
  assert.equal(unit(s, 'wP5').alive, false);

  // The same collision against a queen goes the other way entirely.
  let q = start('sliding');
  q = { ...q, units: q.units.map((u) => (u.id === 'bP4' ? { ...u, type: 'queen', hp: 90, maxHp: 90 } : u)) };
  q = apply(q, 'white', find(q, 'white', (a) => a.unitId === 'wP5' && a.to === 'e4'));
  q = apply(q, 'black', find(q, 'black', (a) => a.unitId === 'bP4' && a.to === 'd5'));
  q = apply(q, 'white', find(q, 'white', (a) => a.unitId === 'wP5' && a.to === 'd5'));
  assert.equal(unit(q, 'wP5').alive, false, 'the pawn walked into a queen');
  assert.equal(unit(q, 'bP4').alive, true);
  assert.ok(unit(q, 'bP4').hp > 85, 'and barely scratched her');
});

test('sliding: a slide stops on contact with its own side, without overlapping it', () => {
  // Rook a1 aimed at a8 straight through its own pawn on a2 — an order the legal list
  // will not offer, so it is placed by hand to check what the physics does with it.
  let s = start('sliding');
  const path = ['a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'].map(gridOf);
  s = apply(s, 'white', { type: 'move', unitId: 'wR1', from: 'a1', to: 'a8', path, pathId: 0 });

  const rook = unit(s, 'wR1'), pawn = unit(s, 'wP1');
  const gap = Math.hypot(rook.position.x - pawn.position.x, rook.position.y - pawn.position.y);
  assert.ok(gap >= 2 * HITBOX_R - 1e-6, `bodies must not interpenetrate (gap ${gap})`);
  assert.ok(rook.position.y < 7.5, 'it did set off');
  assert.ok(pawn.alive, 'and did not hurt its own pawn');
});

test('sliding: a piece dies mid-slide and the killer carries on to its destination', () => {
  // A white queen sweeps the d-file into a lone black pawn on d5 and finishes on d7.
  let s = start('sliding');
  const keep = new Set(['wQ4', 'bP4', 'wK5', 'bK5']);
  s = { ...s, units: s.units.filter((u) => keep.has(u.id)) };
  s = { ...s, units: s.units.map((u) => (u.id === 'bP4' ? { ...u, cell: gridOf('d5'), position: { x: 3.5, y: 3.5 } } : u)) };

  s = apply(s, 'white', find(s, 'white', (a) => a.unitId === 'wQ4' && a.to === 'd7'));
  assert.equal(unit(s, 'bP4').alive, false);
  assert.deepEqual(unit(s, 'wQ4').position, { x: 3.5, y: 1.5 });
  assert.ok(unit(s, 'wQ4').hp > 85);
});

// ── Melee: continuous space, continuous time ────────────────────────────────

test('melee: both sides order into the same instant before the clock moves', () => {
  let s = start('melee');
  assert.deepEqual(s.activePlayers, ['white']);
  s = apply(s, 'white', find(s, 'white', (a) => a.unitId === 'wP5' && a.to === 'e4'));
  assert.deepEqual(s.activePlayers, ['white'], 'ordering is free; keep going');

  s = apply(s, 'white', { type: 'wait', unitId: '__player__' });
  assert.deepEqual(s.activePlayers, ['black'], 'now the other side plans the same instant');
  assert.equal(s.gameSpecific.rt.clock, 0);

  s = apply(s, 'black', find(s, 'black', (a) => a.unitId === 'bP5' && a.to === 'e5'));
  s = apply(s, 'black', { type: 'wait', unitId: '__player__' });
  assert.ok(s.gameSpecific.rt.clock > 0, 'both have waited, so time passes');
  assert.deepEqual(s.activePlayers, ['white']);
});

test('melee: pieces are somewhere between squares while they travel', () => {
  let s = start('melee');
  s = apply(s, 'white', find(s, 'white', (a) => a.unitId === 'wP5' && a.to === 'e4'));
  s = runClock(s);
  const p = unit(s, 'wP5').position;
  assert.ok(p.y < 6.5 && p.y > 4.5, `mid-slide, not snapped to a square (y=${p.y})`);
  assert.ok(s.gameSpecific.rt.orders.wP5, 'and still under way');
});

test('melee: the clock never stalls, whatever the players do', () => {
  let s = start('melee');
  let clock = s.gameSpecific.rt.clock;
  for (let i = 0; i < 20; i++) {
    const next = runClock(s);
    assert.ok(next.gameSpecific.rt.clock > clock,
      `the clock must advance on every mutual wait (stuck at ${clock})`);
    clock = next.gameSpecific.rt.clock;
    s = next;
  }
});

// ── End to end ──────────────────────────────────────────────────────────────

test('every variant plays out to a decisive result under the greedy agent', async () => {
  const { GameEngine } = await import('../../engine/index.js');
  const { makeGreedyAgent } = await import('../../agents/GreedyAgent.js');
  for (const variant of Object.keys(CONFIG)) {
    const players = PLAYERS.map((p) => ({ ...p, agent: makeGreedyAgent(ChessGame) }));
    const engine = new GameEngine(ChessGame, players, { ...CONFIG[variant], maxTurns: 300, stepLimit: 60000 });
    const { result, finalState } = await engine.run();
    assert.ok(['win', 'draw'].includes(result.outcome), `${variant}: ${JSON.stringify(result)}`);
    assert.notEqual(result.reason, 'step-limit', `${variant} ran out of steps without ending`);
    assert.ok(typeof ChessGame.renderState(finalState) === 'string');
    assert.ok(ChessGame.toGrid(finalState).units.length >= 0);
  }
});
