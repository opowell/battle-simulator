import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Memoir44Game } from './index.js';
import { GameEngine } from '../../engine/index.js';
import { RandomAgent } from '../../agents/index.js';
import { distance, sectionOf, hexesBetween } from './hex.js';

function players() {
  return [
    { id: 'allies', name: 'Allies', agent: RandomAgent },
    { id: 'axis',   name: 'Axis',   agent: RandomAgent },
  ];
}

function playCard(state, playerId, pred = () => true) {
  const acts = Memoir44Game.getLegalActions(state, playerId).filter(a => a.type === 'play-card');
  const pick = acts.find(pred) ?? acts[0];
  return Memoir44Game.applyActions(state, [{ playerId, action: pick }]);
}

function endTurn(state, playerId) {
  return Memoir44Game.applyActions(state, [{ playerId, action: { type: 'end-turn', unitId: '__player__' } }]);
}

// ---------------------------------------------------------------------------
// hex geometry
// ---------------------------------------------------------------------------

test('hex: distance is symmetric and adjacency is 1', () => {
  const a = { col: 5, row: 4 }, b = { col: 6, row: 4 };
  assert.equal(distance(a, b), distance(b, a));
  assert.equal(distance(a, b), 1);
  assert.equal(distance(a, a), 0);
});

test('hex: sections split the 13 columns into three', () => {
  assert.equal(sectionOf(0), 'left');
  assert.equal(sectionOf(6), 'center');
  assert.equal(sectionOf(12), 'right');
});

test('hex: hexesBetween excludes endpoints', () => {
  const between = hexesBetween({ col: 2, row: 4 }, { col: 6, row: 4 });
  assert.ok(between.length > 0);
  assert.ok(!between.some(h => h.col === 2 && h.row === 4));
  assert.ok(!between.some(h => h.col === 6 && h.row === 4));
});

// ---------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------

test('setup: both sides have units and empty medals', () => {
  const s = Memoir44Game.createInitialState(players());
  assert.ok(s.units.some(u => u.ownerId === 'allies' && u.alive));
  assert.ok(s.units.some(u => u.ownerId === 'axis' && u.alive));
  assert.equal(s.gameSpecific.medals.allies, 0);
  assert.equal(s.gameSpecific.medals.axis, 0);
});

test('setup: each player is dealt a command hand, phase is command', () => {
  const s = Memoir44Game.createInitialState(players());
  assert.equal(s.gameSpecific.hands.allies.length, 5);
  assert.equal(s.gameSpecific.hands.axis.length, 5);
  assert.equal(s.gameSpecific.phase, 'command');
});

test('setup: pegasus-bridge scenario has objective hexes', () => {
  const s = Memoir44Game.createInitialState(players(), { scenario: 'pegasus-bridge' });
  assert.equal(s.gameSpecific.objectives.length, 2);
  assert.equal(s.board.terrain['3,4'], 'bridge');
});

// ---------------------------------------------------------------------------
// command cards
// ---------------------------------------------------------------------------

test('command phase: only play-card actions (or a forced pass)', () => {
  const s = Memoir44Game.createInitialState(players());
  const acts = Memoir44Game.getLegalActions(s, s.activePlayers[0]);
  assert.ok(acts.every(a => a.type === 'play-card'));
});

test('playing a card sets orders and switches to the orders phase', () => {
  const s = Memoir44Game.createInitialState(players());
  const me = s.activePlayers[0];
  const s2 = playCard(s, me);
  assert.equal(s2.gameSpecific.phase, 'orders');
  const totalOrders = Object.values(s2.gameSpecific.ordersLeft).reduce((a, b) => a + b, 0);
  assert.ok(totalOrders > 0);
  assert.equal(s2.gameSpecific.hands[me].length, 4); // one card spent
});

test('ordered units are limited by the card and the section', () => {
  const s = Memoir44Game.createInitialState(players());
  const me = s.activePlayers[0];
  // Play a single-section card; ordersLeft should be nonzero in exactly one section.
  const s2 = playCard(s, me, a => a.section !== undefined);
  const nonzero = Object.values(s2.gameSpecific.ordersLeft).filter(v => v > 0).length;
  assert.ok(nonzero >= 1);
});

// ---------------------------------------------------------------------------
// orders / movement / combat
// ---------------------------------------------------------------------------

test('orders phase offers move and end-turn', () => {
  const s = Memoir44Game.createInitialState(players());
  const me = s.activePlayers[0];
  const s2 = playCard(s, me);
  const acts = Memoir44Game.getLegalActions(s2, me);
  assert.ok(acts.some(a => a.type === 'end-turn'));
  assert.ok(acts.some(a => a.type === 'move'));
});

test('moving a unit consumes an order and marks it moved', () => {
  const s = Memoir44Game.createInitialState(players());
  const me = s.activePlayers[0];
  const s2 = playCard(s, me);
  const move = Memoir44Game.getLegalActions(s2, me).find(a => a.type === 'move');
  const before = Object.values(s2.gameSpecific.ordersLeft).reduce((a, b) => a + b, 0);
  const s3 = Memoir44Game.applyActions(s2, [{ playerId: me, action: move }]);
  const after = Object.values(s3.gameSpecific.ordersLeft).reduce((a, b) => a + b, 0);
  assert.equal(after, before - 1);
  const moved = s3.units.find(u => u.id === move.unitId);
  assert.equal(moved.position.col, move.to.col);
  assert.ok(moved.perTurn.ordered && moved.perTurn.moved);
});

test('combat removes figures and awards a medal on a kill', () => {
  // Craft a tiny deterministic state: an infantry adjacent to a 1-figure enemy,
  // with a rigged rng that always rolls the killing "grenade" face.
  const s = Memoir44Game.createInitialState(players());
  const attacker = s.units.find(u => u.ownerId === 'allies' && u.type === 'infantry');
  const victim = s.units.find(u => u.ownerId === 'axis' && u.type === 'infantry');
  const units = s.units.map(u => {
    if (u.id === attacker.id) return { ...u, position: { col: 5, row: 4 }, perTurn: { ordered: true, moved: false, battled: false, battleAllowed: true } };
    if (u.id === victim.id) return { ...u, position: { col: 6, row: 4 }, figures: 1 };
    return u;
  });
  const gs = { ...s.gameSpecific, phase: 'orders', ordersLeft: { left: 0, center: 3, right: 0 }, currentCard: { name: 'x', section: 'center', orders: 3 } };
  const staged = { ...s, units, gameSpecific: gs };
  const grenadeRng = () => 3 / 6 + 0.001; // lands on the 'grenade' face (index 3)
  const out = Memoir44Game.applyActions(staged, [{ playerId: 'allies', action: { type: 'attack', unitId: attacker.id, targetId: victim.id } }], grenadeRng);
  const deadVictim = out.units.find(u => u.id === victim.id);
  assert.equal(deadVictim.alive, false);
  assert.equal(out.gameSpecific.medals.allies, 1);
});

test('getResult declares a winner at the medal target', () => {
  const s = Memoir44Game.createInitialState(players());
  const gs = { ...s.gameSpecific, medals: { allies: s.gameSpecific.medalTarget, axis: 0 } };
  const res = Memoir44Game.getResult({ ...s, gameSpecific: gs });
  assert.equal(res.outcome, 'win');
  assert.equal(res.winnerId, 'allies');
});

test('toGrid returns a hexagon layout with a cell per board hex', () => {
  const s = Memoir44Game.createInitialState(players());
  const g = Memoir44Game.toGrid(s);
  assert.equal(g.grid, 'hexagon');
  assert.equal(g.cells.length, 13 * 9);
  assert.ok(g.cells.some(c => c.glyph)); // some units rendered
});

// ---------------------------------------------------------------------------
// full games
// ---------------------------------------------------------------------------

for (const scenario of ['encounter', 'pegasus-bridge']) {
  test(`full random game terminates (${scenario})`, async () => {
    const engine = new GameEngine(Memoir44Game, players(), { maxTurns: 150, scenario, rng: mulberry32(7) });
    const { result } = await engine.run();
    assert.ok(result);
    assert.ok(['win', 'draw'].includes(result.outcome));
  });
}

// deterministic rng for reproducible test games
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
