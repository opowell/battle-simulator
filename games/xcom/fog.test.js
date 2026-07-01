import { test } from 'node:test';
import assert from 'node:assert/strict';
import { XComGame } from './index.js';
import { XcomBelief } from './belief.js';
import { hasLOS } from './los.js';
import { ObscuroAgent } from '../../agents/ObscuroAgent.js';
import { RandomAgent } from '../../agents/RandomAgent.js';
import { GameEngine } from '../../engine/index.js';

const players = () => [{ id: 'xcom', name: 'XCOM' }, { id: 'aliens', name: 'Aliens' }];

test('xcom fog: getVisibleState hides distant enemies and stores a roster', () => {
  const s = XComGame.createInitialState(players(), { fogOfWar: true });
  const view = XComGame.getVisibleState(s, s.activePlayers[0]);
  assert.equal(s.units.length, 8);
  assert.equal(view.units.filter(u => u.ownerId === 'xcom').length, 4, 'sees own squad');
  assert.equal(view.units.filter(u => u.ownerId === 'aliens').length, 0, 'far aliens hidden');
  assert.equal(s.gameSpecific.startRoster.length, 8);
});

test('xcom fog: sampleWorlds places in-bounds enemies outside vision+LOS', () => {
  const s = XComGame.createInitialState(players(), { fogOfWar: true });
  const view = XComGame.getVisibleState(s, 'xcom');
  const worlds = XComGame.sampleWorlds(view, 'xcom', 8);
  assert.ok(worlds.length > 0);
  const seen = new Set(view.units.map(u => u.id));
  const myUnits = view.units.filter(u => u.ownerId === 'xcom' && u.alive);
  const { width, height } = s.board;
  for (const w of worlds) {
    for (const L of w.units.filter(u => u.ownerId === 'aliens' && !seen.has(u.id))) {
      assert.ok(L.position.x >= 0 && L.position.x < width && L.position.y >= 0 && L.position.y < height, 'in bounds');
      const visible = myUnits.some(m =>
        Math.max(Math.abs(m.position.x - L.position.x), Math.abs(m.position.y - L.position.y)) <= 5 &&
        hasLOS(s.board, m.position, L.position));
      assert.ok(!visible, 'placed where we could not already see it');
    }
  }
});

test('xcom fog: sampleWorlds returns [] when fog is off', () => {
  const s = XComGame.createInitialState(players(), { fogOfWar: false });
  assert.deepEqual(XComGame.sampleWorlds(XComGame.getVisibleState(s, 'xcom'), 'xcom', 4), []);
});

test('xcom fog: belief pins a sighting then keeps it in reach after it hides', () => {
  const s = XComGame.createInitialState(players(), { fogOfWar: true });
  const roster = s.gameSpecific.startRoster.filter(u => u.ownerId === 'aliens');
  const belief = new XcomBelief('xcom', roster, s.board);
  const e = roster[0];
  const reach = e.moveRange * e.maxAP;

  // Turn 1: a soldier is right next to the alien at its start, in the open.
  const near = { x: e.position.x - 1, y: e.position.y };
  belief.beginTurn({
    ...s, turnNumber: 1,
    units: [
      { id: 'xcom-1', ownerId: 'xcom', type: 'soldier', position: near, alive: true, hp: 8, attrs: { moveRange: 3, maxAP: 2 } },
      { id: e.id, ownerId: 'aliens', type: e.type, position: { ...e.position }, alive: true, hp: 3, attrs: { moveRange: 3, maxAP: 2 } },
    ],
  });
  assert.deepEqual([...belief.pieces.get(e.id).possible], [`${e.position.x},${e.position.y}`], 'pinned where seen');
  assert.equal(belief.pieces.get(e.id).hp, 3, 'remembers last-seen hp');

  // Turn 2: soldier retreats far away; alien no longer visible.
  belief.beginTurn({
    ...s, turnNumber: 2,
    units: [{ id: 'xcom-1', ownerId: 'xcom', type: 'soldier', position: { x: 0, y: 0 }, alive: true, hp: 8, attrs: { moveRange: 3, maxAP: 2 } }],
  });
  const possible = [...belief.pieces.get(e.id).possible].map(key => key.split(',').map(Number));
  assert.ok(possible.length > 0, 'still tracked');
  const maxDist = Math.max(...possible.map(([x, y]) => Math.max(Math.abs(x - e.position.x), Math.abs(y - e.position.y))));
  assert.ok(maxDist <= reach, `stays within one turn of travel of the last sighting (got ${maxDist} <= ${reach})`);
});

test('xcom fog: witnessed death is never resurrected', () => {
  const s = XComGame.createInitialState(players(), { fogOfWar: true });
  const roster = s.gameSpecific.startRoster.filter(u => u.ownerId === 'aliens');
  const belief = new XcomBelief('xcom', roster, s.board);
  const e = roster[0];
  const dead = {
    ...s, turnNumber: 1,
    units: [
      { id: 'xcom-1', ownerId: 'xcom', type: 'soldier', position: { x: e.position.x - 1, y: e.position.y }, alive: true, hp: 8 },
      { id: e.id, ownerId: 'aliens', type: e.type, position: { ...e.position }, alive: false, hp: 0 },
    ],
  };
  belief.beginTurn(dead);
  assert.equal(belief.pieces.get(e.id).alive, false);
  const worlds = belief.sample(dead, 5, Math.random, (id, ownerId, type, x, y) => ({ id, ownerId, type, position: { x, y }, alive: true, hp: 1 }));
  for (const w of worlds) assert.ok(!w.units.some(u => u.id === e.id && u.alive), 'no resurrection');
});

test('xcom fog: Obscuro plays a fog game to completion', async () => {
  const ps = players().map((p, i) => ({
    ...p, agent: i === 0 ? new ObscuroAgent(XComGame, { particles: 3, rows: 4, cols: 4, iters: 40 }) : RandomAgent,
  }));
  const { result } = await new GameEngine(XComGame, ps, { maxTurns: 16, fogOfWar: true }).run();
  assert.ok(result && typeof result.outcome === 'string');
});
