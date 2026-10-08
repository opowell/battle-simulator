import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CombatMissionGame as G } from './index.js';
import { createUnit } from './units.js';
import { TURN_TICKS, ticksLeft, apLeft } from './rules.js';
import { num } from '../coord.js';
import { GameEngine } from '../../engine/index.js';

// A plain open field (the border is wall, as on every CM map) with optional wall tiles.
function field(walls = [], w = 16, h = 10) {
  const tiles = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) =>
    (x === 0 || y === 0 || x === w - 1 || y === h - 1 || walls.some(([wx, wy]) => wx === x && wy === y)) ? '#' : '.'));
  return { width: w, height: h, tiles };
}
const players = (agents = []) => [
  { id: 'allied', name: 'Allies', agent: agents[0] },
  { id: 'axis', name: 'Axis', agent: agents[1] },
];
const unit = (id, type, ownerId, x, y) => createUnit(id, type, ownerId, { x, y });

function setup(units, { walls = [], ...config } = {}) {
  const s = G.createInitialState(players(), { units, ...config });
  return { ...s, board: field(walls) };
}
const fireActs = (s, pid, unitId) => G.getLegalActions(s, pid).filter(a => a.type === 'fire' && a.unitId === unitId);
const WALL_X8 = Array.from({ length: 8 }, (_, i) => [8, i + 1]);

// ── defaults ─────────────────────────────────────────────────────────────────

test('combatmission defaults: fog on, simultaneous turns, continuous time', () => {
  const opt = (id) => G.gameOptions.find(o => o.id === id);
  assert.equal(opt('fogOfWar').default, true);
  assert.equal(opt('time').default, 'continuous');
  assert.equal(G.uiDefaults.config.simultaneousTurns, true, 'the setup form starts on we-go');
  assert.equal(G.defaultConfig.simultaneousTurns, true, 'an API session plays we-go too');
  const s = G.createInitialState(players(), { simultaneousTurns: true });
  assert.deepEqual([s.gameSpecific.spacetime.time, s.gameSpecific.spacetime.play], ['continuous', 'simultaneous']);
  assert.ok(s.units.every(u => u.perTurn.time === TURN_TICKS), 'every unit starts with the whole minute');
  const d = G.createInitialState(players(), { time: 'discrete' });
  assert.equal(d.gameSpecific.spacetime.play, 'sequential');
  assert.ok(d.units.every(u => u.perTurn.ap === 2));
});

// ── aimed fire ───────────────────────────────────────────────────────────────

test('combatmission fire: an enemy is a target only while the shooter can see it', () => {
  const s = setup([
    unit('a', 'rifle-squad', 'allied', 5.5, 5.5),
    unit('near', 'volks-squad', 'axis', 7.5, 5.5),     // in range, in sight
    unit('hidden', 'volks-squad', 'axis', 9.5, 5.5),   // in range, behind the wall
    unit('far', 'volks-squad', 'axis', 14.5, 5.5),     // out of range
  ], { walls: WALL_X8 });
  const targets = fireActs(s, 'allied', 'a').filter(a => a.targetId).map(a => a.targetId);
  assert.deepEqual(targets, ['near']);
  assert.equal(G.isActionLegal(s, 'allied', { type: 'fire', unitId: 'a', targetId: 'hidden' }), false);
  assert.equal(G.isActionLegal(s, 'allied', { type: 'fire', unitId: 'a', targetId: 'near' }), true);
});

test('combatmission fire: under fog only enemies the side has spotted can be aimed at', () => {
  const sniper = unit('s', 'sniper', 'allied', 2.5, 2.5);
  const enemy = unit('e', 'volks-squad', 'axis', 10.5, 2.5);   // 8 away: in the sniper's range, beyond vision
  const fogged = setup([sniper, enemy], { fogOfWar: true });
  assert.equal(fireActs(fogged, 'allied', 's').some(a => a.targetId === 'e'), false);
  const open = setup([sniper, enemy], { fogOfWar: false });
  assert.equal(fireActs(open, 'allied', 's').some(a => a.targetId === 'e'), true);
  const spotted = setup([sniper, enemy, unit('scout', 'rifle-squad', 'allied', 8.5, 3.5)], { fogOfWar: true });
  assert.equal(fireActs(spotted, 'allied', 's').some(a => a.targetId === 'e'), true, 'a scout spots for the sniper');
});

// ── area fire ────────────────────────────────────────────────────────────────

test('combatmission area fire: needs range, and sight of the spot unless the weapon is indirect', () => {
  const s = setup([
    unit('r', 'rifle-squad', 'allied', 5.5, 5.5),
    unit('m', 'mortar-team', 'allied', 5.5, 7.5),
    unit('e', 'volks-squad', 'axis', 14.5, 8.5),
  ], { walls: WALL_X8 });
  const at = (unitId, x, y) => G.isActionLegal(s, 'allied', { type: 'fire', unitId, target: { x: String(x), y: String(y) } });
  assert.equal(at('r', 7.5, 3.5), true, 'open ground in sight');
  assert.equal(at('r', 9.5, 5.5), false, 'behind the wall');
  assert.equal(at('r', 5.5, 1.2), true);
  assert.equal(at('r', 12.5, 5.5), false, 'out of range');
  assert.equal(at('m', 9.5, 5.5), true, 'a mortar lobs over the wall');
  // Every unit that can fire has a representative area shot in the legal set.
  assert.ok(fireActs(s, 'allied', 'r').some(a => a.target && a.label === 'Area fire'));
});

test('combatmission area fire: shoots every enemy inside the blast, nobody else', () => {
  const s = setup([
    unit('r', 'rifle-squad', 'allied', 3.5, 5.5),
    unit('mate', 'rifle-squad', 'allied', 6.5, 5.9),
    unit('in1', 'volks-squad', 'axis', 6.5, 5.0),
    unit('in2', 'volks-squad', 'axis', 7.0, 5.5),
    unit('out', 'volks-squad', 'axis', 6.5, 7.5),
  ], { time: 'discrete' });
  const next = G.applyActions(s, [{ playerId: 'allied', action: { type: 'fire', unitId: 'r', target: { x: '6.5', y: '5.5' } } }], () => 0);
  const hp = (id) => next.units.find(u => u.id === id).hp;
  assert.ok(hp('in1') < 10 && hp('in2') < 10, 'both enemies in the blast are hit');
  assert.equal(hp('out'), 10, 'outside the blast');
  assert.equal(hp('mate'), 10, 'no friendly fire');
  assert.equal(next.units.find(u => u.id === 'out').suppression, 0);
  assert.equal(apLeft(next.units.find(u => u.id === 'r')), 1, 'a burst costs one AP');
  assert.deepEqual(next.gameSpecific.lastCombat.hits.map(h => h.targetId).sort(), ['in1', 'in2']);
});

// ── time ─────────────────────────────────────────────────────────────────────

test('combatmission continuous time: a walk costs its length in time, a burst a fixed share', () => {
  // A rifle squad covers moveRange × ap = 4 cells a minute: one cell is 15 s.
  const s = setup([unit('r', 'rifle-squad', 'allied', 3.5, 5.5), unit('e', 'volks-squad', 'axis', 6.5, 5.5)]);
  const step = (st, action) => G.applyActions(st, [{ playerId: 'allied', action }], () => 0.99);
  const r = (st) => st.units.find(u => u.id === 'r');
  let t = step(s, { type: 'move', unitId: 'r', to: { x: '4.5', y: '5.5' } });
  assert.equal(ticksLeft(r(t)), TURN_TICKS - 150);
  t = step(t, { type: 'fire', unitId: 'r', targetId: 'e' });
  assert.equal(ticksLeft(r(t)), TURN_TICKS - 450);
  assert.equal(G.isActionLegal(t, 'allied', { type: 'fire', unitId: 'r', targetId: 'e' }), false, '15 s left is too little for a burst');
  assert.equal(G.isActionLegal(t, 'allied', { type: 'move', unitId: 'r', to: { x: '4.5', y: '6.5' } }), true, '…but enough for one more cell');
  assert.equal(G.isActionLegal(t, 'allied', { type: 'move', unitId: 'r', to: { x: '4.5', y: '7.5' } }), false, 'not two');
  // A long run spends the whole minute in one go — further than any single discrete move.
  assert.equal(G.isActionLegal(s, 'allied', { type: 'move', unitId: 'r', to: { x: '3.5', y: '1.5' } }), true);
  const d = setup([unit('r', 'rifle-squad', 'allied', 3.5, 5.5), unit('e', 'volks-squad', 'axis', 9.5, 5.5)], { time: 'discrete' });
  assert.equal(G.isActionLegal(d, 'allied', { type: 'move', unitId: 'r', to: { x: '3.5', y: '1.5' } }), false);
});

test('combatmission turns: a turn closes once every side has ended it, refreshing everyone', () => {
  const s = setup([unit('r', 'rifle-squad', 'allied', 3.5, 5.5), unit('e', 'volks-squad', 'axis', 9.5, 5.5)]);
  const act = (st, pid, action) => G.applyActions(st, [{ playerId: pid, action }]);
  const moved = act(s, 'allied', { type: 'move', unitId: 'r', to: { x: '4.5', y: '5.5' } });
  const a = act(moved, 'allied', { type: 'end-turn', unitId: '__player__' });
  assert.deepEqual(a.activePlayers, ['axis']);
  assert.equal(a.turnNumber, 1);
  assert.equal(ticksLeft(a.units.find(u => u.id === 'r')), TURN_TICKS - 150, 'nothing refreshed yet');
  const b = act(a, 'axis', { type: 'end-turn', unitId: '__player__' });
  assert.equal(b.turnNumber, 2);
  assert.deepEqual(b.activePlayers, ['allied']);
  assert.ok(b.units.every(u => ticksLeft(u) === TURN_TICKS));
});

// ── we-go: a shot follows its target, while it stays visible ─────────────────

function playbook(actions) {
  const script = [...actions];
  return { chooseAction: (_s, legal) => script.shift() ?? legal.find(a => a.type === 'end-turn') };
}
async function weGoRound(alliedOrders, axisOrders, units) {
  const game = { ...G, createInitialState: (ps, cfg) => ({ ...G.createInitialState(ps, { ...cfg, units }), board: field([[8, 1], [8, 2], [8, 3], [8, 4]]) }) };
  const e = new GameEngine(game, players([playbook(alliedOrders), playbook(axisOrders)]), { simultaneousTurns: true, rng: () => 0 });
  await e.step();
  return e;
}

test('combatmission we-go: an aimed shot follows a target that is moving', async () => {
  const e = await weGoRound(
    [{ type: 'fire', unitId: 'mg', targetId: 'tank' }],
    [{ type: 'move', unitId: 'tank', to: { x: '9.5', y: '8.5' } }],
    [unit('mg', 'mg-team', 'allied', 4.5, 6.5), unit('tank', 'stuart', 'axis', 9.5, 6.5)],
  );
  const tank = e.state.units.find(u => u.id === 'tank');
  assert.ok(tank.hp < 12, 'the shot found it');
  assert.equal(num(tank.position.y), 8.5, 'and it still got where it was going');
  assert.ok(e.playback.frames.some(f => f.projectiles?.length), 'the shot is in the playback');
  assert.equal(e.state.turnNumber, 2, 'the round closed the turn');
});

test('combatmission we-go: a target that slips out of sight before the shot is fired is not hit', async () => {
  const units = [unit('r', 'rifle-squad', 'allied', 4.5, 4.5), unit('tank', 'stuart', 'axis', 9.5, 6.5)];
  // The squad walks two cells (30 s) before firing; the Stuart is behind the wall by 22.5 s.
  const e = await weGoRound(
    [{ type: 'move', unitId: 'r', to: { x: '4.5', y: '6.5' } }, { type: 'fire', unitId: 'r', targetId: 'tank' }],
    [{ type: 'move', unitId: 'tank', to: { x: '9.5', y: '3.5' } }],
    units,
  );
  assert.equal(e.state.units.find(u => u.id === 'tank').hp, 12, 'the order fizzled');
  // Control: the same orders against a Stuart that stays put do hit it.
  const c = await weGoRound(
    [{ type: 'move', unitId: 'r', to: { x: '4.5', y: '6.5' } }, { type: 'fire', unitId: 'r', targetId: 'tank' }],
    [],
    units,
  );
  assert.ok(c.state.units.find(u => u.id === 'tank').hp < 12);
});
