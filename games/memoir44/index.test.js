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

test('playing a card sets orders and switches to the move phase', () => {
  const s = Memoir44Game.createInitialState(players());
  const me = s.activePlayers[0];
  const s2 = playCard(s, me);
  assert.equal(s2.gameSpecific.phase, 'move');
  const totalOrders = Object.values(s2.gameSpecific.ordersLeft).reduce((a, b) => a + b, 0);
  assert.ok(totalOrders > 0);
  assert.equal(s2.gameSpecific.hands[me].length, 4); // one card spent
});

test('ordered units are limited by the card and the section', () => {
  const s = Memoir44Game.createInitialState(players());
  const me = s.activePlayers[0];
  // Play a single-section card; ordersLeft should be nonzero in at least one section.
  const s2 = playCard(s, me, a => a.section !== undefined);
  const nonzero = Object.values(s2.gameSpecific.ordersLeft).filter(v => v > 0).length;
  assert.ok(nonzero >= 1);
});

// ---------------------------------------------------------------------------
// move phase → battle phase → combat
// ---------------------------------------------------------------------------

// Play a command card and skip the move phase to reach the battle phase.
function toBattlePhase(state, me) {
  const s = playCard(state, me);
  return Memoir44Game.applyActions(s, [{ playerId: me, action: { type: 'end-move', unitId: '__player__' } }]);
}

test('move phase offers move and end-move (not attacks)', () => {
  const s = Memoir44Game.createInitialState(players());
  const me = s.activePlayers[0];
  const s2 = playCard(s, me);
  const acts = Memoir44Game.getLegalActions(s2, me);
  assert.ok(acts.some(a => a.type === 'end-move'));
  assert.ok(acts.some(a => a.type === 'move'));
  assert.ok(!acts.some(a => a.type === 'attack'));
});

test('battle phase offers attacks and end-turn', () => {
  const s = Memoir44Game.createInitialState(players());
  const me = s.activePlayers[0];
  const s2 = toBattlePhase(s, me);
  const acts = Memoir44Game.getLegalActions(s2, me);
  assert.ok(acts.some(a => a.type === 'end-turn'));
  assert.ok(!acts.some(a => a.type === 'move'));
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

// Build a battle-phase state with two named units placed as specified.
function stageBattle(overrides = {}) {
  const s = Memoir44Game.createInitialState(players());
  const attacker = s.units.find(u => u.ownerId === 'allies' && u.type === (overrides.attackerType ?? 'infantry'));
  const victim = s.units.find(u => u.ownerId === 'axis' && u.type === 'infantry');
  const units = s.units.map(u => {
    if (u.id === attacker.id) return { ...u, position: overrides.attackerPos ?? { col: 5, row: 4 }, perTurn: { ordered: true, moved: false, battled: false, battleAllowed: true, overrunDone: false } };
    if (u.id === victim.id) return { ...u, position: overrides.victimPos ?? { col: 6, row: 4 }, figures: overrides.victimFigures ?? 1 };
    return u;
  });
  const gs = { ...s.gameSpecific, phase: 'battle', pendingAdvance: null, ordersLeft: { left: 0, center: 3, right: 0 }, currentCard: { name: 'x', section: 'center', orders: 3 } };
  return { state: { ...s, units, currentPhase: 'battle', gameSpecific: gs }, attacker, victim };
}

const GRENADE_RNG = () => 3 / 6 + 0.001; // always lands on 'grenade' (index 3) — a hit on anything
const FLAG_RNG = () => 5 / 6 + 0.001;    // always lands on 'flag' (index 5) — forces retreat

test('combat removes figures and awards a medal on a kill', () => {
  const { state, attacker, victim } = stageBattle();
  const out = Memoir44Game.applyActions(state, [{ playerId: 'allies', action: { type: 'attack', unitId: attacker.id, targetId: victim.id } }], GRENADE_RNG);
  assert.equal(out.units.find(u => u.id === victim.id).alive, false);
  assert.equal(out.gameSpecific.medals.allies, 1);
});

test('a close-assault kill offers Take Ground into the vacated hex', () => {
  const { state, attacker, victim } = stageBattle();
  const out = Memoir44Game.applyActions(state, [{ playerId: 'allies', action: { type: 'attack', unitId: attacker.id, targetId: victim.id } }], GRENADE_RNG);
  assert.ok(out.gameSpecific.pendingAdvance);
  const acts = Memoir44Game.getLegalActions(out, 'allies');
  assert.deepEqual(acts.map(a => a.type).sort(), ['decline-advance', 'take-ground']);
  const tg = acts.find(a => a.type === 'take-ground');
  assert.deepEqual(tg.to, { col: 6, row: 4 }); // the hex the enemy was eliminated from
  const advanced = Memoir44Game.applyActions(out, [{ playerId: 'allies', action: tg }]);
  const moved = advanced.units.find(u => u.id === attacker.id);
  assert.deepEqual(moved.position, { col: 6, row: 4 }); // now stands where the enemy was
  assert.equal(advanced.gameSpecific.pendingAdvance, null);
});

test('armor may make a single overrun combat after taking ground', () => {
  const { state, attacker } = stageBattle({ attackerType: 'armor' });
  const out = Memoir44Game.applyActions(state, [{ playerId: 'allies', action: { type: 'attack', unitId: attacker.id, targetId: state.units.find(u => u.ownerId === 'axis' && u.type === 'infantry').id } }], GRENADE_RNG);
  assert.equal(out.gameSpecific.pendingAdvance.allowOverrun, true);
  const advanced = Memoir44Game.applyActions(out, [{ playerId: 'allies', action: { type: 'take-ground', unitId: attacker.id, to: out.gameSpecific.pendingAdvance.hex } }]);
  const armor = advanced.units.find(u => u.id === attacker.id);
  assert.equal(armor.perTurn.overrunDone, true);
  assert.equal(armor.perTurn.battled, false); // free to battle once more
});

test('a unit adjacent to an enemy must close assault (cannot fire past it)', () => {
  // Attacker at (5,4) adjacent to an enemy at (6,4); a distant enemy sits at (8,4).
  const s = Memoir44Game.createInitialState(players());
  const attacker = s.units.find(u => u.ownerId === 'allies' && u.type === 'artillery');
  const [near, far] = s.units.filter(u => u.ownerId === 'axis').slice(0, 2);
  const units = s.units.map(u => {
    if (u.id === attacker.id) return { ...u, position: { col: 5, row: 4 }, perTurn: { ordered: true, moved: false, battled: false, battleAllowed: true, overrunDone: false } };
    if (u.id === near.id) return { ...u, position: { col: 6, row: 4 } };
    if (u.id === far.id) return { ...u, position: { col: 8, row: 4 } };
    return u;
  });
  const gs = { ...s.gameSpecific, phase: 'battle', pendingAdvance: null, ordersLeft: { left: 0, center: 3, right: 0 } };
  const acts = Memoir44Game.getLegalActions({ ...s, units, gameSpecific: gs }, 'allies');
  const targets = acts.filter(a => a.type === 'attack' && a.unitId === attacker.id).map(a => a.targetId);
  assert.deepEqual(targets, [near.id]); // only the adjacent enemy
});

test('a unit that enters must-stop terrain may not battle that turn', () => {
  // Stage a lone infantry next to a forest hex and move it in.
  const s = Memoir44Game.createInitialState(players());
  const inf = s.units.find(u => u.ownerId === 'allies' && u.type === 'infantry');
  const units = s.units.map(u => u.id === inf.id
    ? { ...u, position: { col: 5, row: 3 }, perTurn: { ordered: false, moved: false, battled: false, battleAllowed: true, overrunDone: false } }
    : u);
  const board = { ...s.board, terrain: { ...s.board.terrain, '5,4': 'forest' } };
  const gs = { ...s.gameSpecific, phase: 'move', ordersLeft: { left: 0, center: 3, right: 0 } };
  const staged = { ...s, units, board, currentPhase: 'move', gameSpecific: gs };
  const out = Memoir44Game.applyActions(staged, [{ playerId: 'allies', action: { type: 'move', unitId: inf.id, from: { col: 5, row: 3 }, to: { col: 5, row: 4 } } }]);
  assert.equal(out.units.find(u => u.id === inf.id).perTurn.battleAllowed, false);
});

test('sandbags let the defender ignore the first flag (no retreat)', () => {
  // Infantry FIRES from range 2 (5,4 -> 5,2): 2 base dice - 1 for sandbags = 1 die.
  const { state, attacker } = stageBattle({ attackerPos: { col: 5, row: 4 }, victimPos: { col: 5, row: 2 }, victimFigures: 4 });
  const board = { ...state.board, terrain: { ...state.board.terrain, '5,2': 'sandbags' } };
  const staged = { ...state, board };
  const victim = staged.units.find(u => u.ownerId === 'axis' && u.type === 'infantry');
  const before = { ...victim.position };
  const out = Memoir44Game.applyActions(staged, [{ playerId: 'allies', action: { type: 'attack', unitId: attacker.id, targetId: victim.id } }], FLAG_RNG);
  const after = out.units.find(u => u.id === victim.id);
  assert.deepEqual(after.position, before); // the single flag is ignored → stayed put
  assert.equal(after.figures, 4);           // flags don't remove figures here
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
