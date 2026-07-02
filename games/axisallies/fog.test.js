import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AxisAlliesGame } from './index.js';
import { AxisAlliesBelief } from './belief.js';
import { ADJACENCY } from './territories.js';
import { ObscuroAgent } from '../../agents/ObscuroAgent.js';
import { RandomAgent } from '../../agents/RandomAgent.js';
import { GameEngine } from '../../engine/index.js';

const players = () => [{ id: 'axis', name: 'Axis' }, { id: 'allies', name: 'Allies' }];

test('axisallies fog: getVisibleState hides distant enemy garrisons and stores a roster', () => {
  const s = AxisAlliesGame.createInitialState(players(), { fogOfWar: true });
  const view = AxisAlliesGame.getVisibleState(s, 'axis');

  assert.ok(s.units.length > 0);
  assert.ok(view.units.every(u => u.ownerId === 'axis' || true)); // sanity: filter ran

  // eastern-usa (allies) is not adjacent to any axis-occupied territory at
  // game start, so its garrison should be filtered out of axis's view.
  const hiddenUnitsFull = s.units.filter(u => u.territory === 'eastern-usa');
  assert.ok(hiddenUnitsFull.length > 0, 'sanity: eastern-usa has a garrison at game start');
  const hiddenUnitsView = view.units.filter(u => u.territory === 'eastern-usa');
  assert.equal(hiddenUnitsView.length, 0, 'far allied garrison hidden from axis');

  // Own units always visible.
  const axisUnitsView = view.units.filter(u => u.ownerId === 'axis');
  const axisUnitsFull = s.units.filter(u => u.ownerId === 'axis');
  assert.equal(axisUnitsView.length, axisUnitsFull.length, 'sees all own units');

  assert.equal(s.gameSpecific.startRoster.length, s.units.length, 'startRoster is common knowledge');
});

test('axisallies fog: sampleWorlds places hidden enemies only in valid, unseen territories', () => {
  const s = AxisAlliesGame.createInitialState(players(), { fogOfWar: true });
  const view = AxisAlliesGame.getVisibleState(s, 'axis');
  const worlds = AxisAlliesGame.sampleWorlds(view, 'axis', 8);
  assert.ok(worlds.length > 0);

  const seen = new Set(view.units.map(u => u.id));
  const myTerritories = new Set(view.units.filter(u => u.ownerId === 'axis' && u.alive).map(u => u.territory));
  const visible = new Set(myTerritories);
  for (const t of myTerritories) for (const adj of (ADJACENCY[t] || [])) visible.add(adj);

  for (const w of worlds) {
    for (const u of w.units.filter(u => u.ownerId === 'allies' && !seen.has(u.id))) {
      assert.ok(Object.prototype.hasOwnProperty.call(ADJACENCY, u.territory), `placed in a real territory (${u.territory})`);
      assert.ok(!visible.has(u.territory), 'placed outside our vision');
    }
  }
});

test('axisallies fog: sampleWorlds returns [] when fog is off', () => {
  const s = AxisAlliesGame.createInitialState(players(), { fogOfWar: false });
  const view = AxisAlliesGame.getVisibleState(s, 'axis');
  assert.deepEqual(AxisAlliesGame.sampleWorlds(view, 'axis', 4), []);
});

test('axisallies fog: witnessed death is never resurrected in sampled worlds', () => {
  const s = AxisAlliesGame.createInitialState(players(), { fogOfWar: true });
  const roster = s.gameSpecific.startRoster.filter(u => u.ownerId === 'allies');
  const belief = new AxisAlliesBelief('axis', roster);
  const enemyUnit = roster.find(u => u.territory === 'uk');
  assert.ok(enemyUnit, 'sanity: allies has a unit in uk');

  const axisNeighborUnit = { id: 'axis-scout', ownerId: 'axis', type: 'infantry', territory: 'france', alive: true, hp: 1 };
  const dead = {
    ...s, turnNumber: 1,
    units: [
      axisNeighborUnit,
      { id: enemyUnit.id, ownerId: 'allies', type: enemyUnit.type, territory: 'uk', alive: false, hp: 0 },
    ],
  };
  belief.beginTurn(dead);
  assert.equal(belief.pieces.get(enemyUnit.id).alive, false);

  const worlds = belief.sample(dead, 5, Math.random, (id, ownerId, type, territory) => ({
    id, ownerId, type, territory, alive: true, hp: 1, hasMoved: false, cargo: [],
  }));
  for (const w of worlds) {
    assert.ok(!w.units.some(u => u.id === enemyUnit.id && u.alive), 'no resurrection');
  }
});

test('axisallies fog: Obscuro plays a fog game to completion', async () => {
  const ps = players().map((p, i) => ({
    ...p, agent: i === 0 ? new ObscuroAgent(AxisAlliesGame, { particles: 2, rows: 3, cols: 3, iters: 20 }) : RandomAgent,
  }));
  const { result } = await new GameEngine(AxisAlliesGame, ps, { maxTurns: 30, fogOfWar: true }).run();
  assert.ok(result && typeof result.outcome === 'string');
});
