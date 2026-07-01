import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DoomGame } from './index.js';
import { DoomBelief } from './belief.js';
import { hasLOS } from './map.js';
import { ObscuroAgent } from '../../agents/ObscuroAgent.js';
import { RandomAgent } from '../../agents/RandomAgent.js';
import { GameEngine } from '../../engine/index.js';

const players = () => [{ id: 'p1', name: 'Marine' }, { id: 'p2', name: 'Demons' }];

test('doom fog: getVisibleState hides distant demons and stores a roster', () => {
  const s = DoomGame.createInitialState(players(), { fogOfWar: true });
  const view = DoomGame.getVisibleState(s, s.activePlayers[0]); // marine's view
  assert.equal(view.units.filter(u => u.ownerId === 'marine').length, 1, 'sees own marine');
  assert.equal(view.units.filter(u => u.ownerId === 'demon').length, 0, 'far demons hidden');
  assert.equal(s.gameSpecific.startRoster.length, s.units.length);
});

test('doom fog: sampleWorlds places demons outside vision+LOS', () => {
  const s = DoomGame.createInitialState(players(), { fogOfWar: true });
  const view = DoomGame.getVisibleState(s, 'p1');
  const worlds = DoomGame.sampleWorlds(view, 'p1', 8);
  assert.ok(worlds.length > 0);
  const seen = new Set(view.units.map(u => u.id));
  const myUnits = view.units.filter(u => u.ownerId === 'marine' && u.alive);
  for (const w of worlds) {
    for (const L of w.units.filter(u => u.ownerId === 'demon' && !seen.has(u.id))) {
      const visible = myUnits.some(m =>
        Math.max(Math.abs(m.position.x - L.position.x), Math.abs(m.position.y - L.position.y)) <= 6 &&
        hasLOS(m.position.x, m.position.y, L.position.x, L.position.y));
      assert.ok(!visible, 'placed where we could not already see it');
      assert.ok(L.hp > 0, 'placed demon is alive with hp');
    }
  }
});

test('doom fog: sampleWorlds returns [] when fog is off', () => {
  const s = DoomGame.createInitialState(players(), { fogOfWar: false });
  assert.deepEqual(DoomGame.sampleWorlds(DoomGame.getVisibleState(s, 'p1'), 'p1', 4), []);
});

test('doom fog: belief pins a sighting then keeps it in reach after it hides', () => {
  const s = DoomGame.createInitialState(players(), { fogOfWar: true });
  const roster = s.gameSpecific.startRoster.filter(u => u.ownerId === 'demon');
  const belief = new DoomBelief('marine', roster);
  const e = roster.find(u => u.type === 'zombieman') ?? roster[0];
  const reach = e.moveRange * e.maxAP;

  belief.beginTurn({
    ...s, turnNumber: 1,
    units: [
      { id: 'marine-1', ownerId: 'marine', type: 'marine', position: { x: e.position.x - 1, y: e.position.y }, alive: true, hp: 100 },
      { id: e.id, ownerId: 'demon', type: e.type, position: { ...e.position }, alive: true, hp: 12 },
    ],
  });
  assert.deepEqual([...belief.pieces.get(e.id).possible], [`${e.position.x},${e.position.y}`], 'pinned');
  assert.equal(belief.pieces.get(e.id).hp, 12, 'remembers last-seen hp');

  belief.beginTurn({
    ...s, turnNumber: 2,
    units: [{ id: 'marine-1', ownerId: 'marine', type: 'marine', position: { x: 1, y: 1 }, alive: true, hp: 100 }],
  });
  const possible = [...belief.pieces.get(e.id).possible].map(key => key.split(',').map(Number));
  assert.ok(possible.length > 0);
  const maxDist = Math.max(...possible.map(([x, y]) => Math.max(Math.abs(x - e.position.x), Math.abs(y - e.position.y))));
  assert.ok(maxDist <= reach, `within one turn of travel of last sighting (got ${maxDist} <= ${reach})`);
});

test('doom fog: witnessed death is never resurrected', () => {
  const s = DoomGame.createInitialState(players(), { fogOfWar: true });
  const roster = s.gameSpecific.startRoster.filter(u => u.ownerId === 'demon');
  const belief = new DoomBelief('marine', roster);
  const e = roster[0];
  const dead = {
    ...s, turnNumber: 1,
    units: [
      { id: 'marine-1', ownerId: 'marine', type: 'marine', position: { x: e.position.x - 1, y: e.position.y }, alive: true, hp: 100 },
      { id: e.id, ownerId: 'demon', type: e.type, position: { ...e.position }, alive: false, hp: 0 },
    ],
  };
  belief.beginTurn(dead);
  assert.equal(belief.pieces.get(e.id).alive, false);
  const worlds = belief.sample(dead, 5, Math.random, (id, ownerId, type, x, y) => ({ id, ownerId, type, position: { x, y }, alive: true, hp: 1 }));
  for (const w of worlds) assert.ok(!w.units.some(u => u.id === e.id && u.alive), 'no resurrection');
});

test('doom fog: Obscuro plays a fog game to completion', async () => {
  const ps = players().map((p, i) => ({
    ...p, agent: i === 0 ? new ObscuroAgent(DoomGame, { particles: 2, rows: 4, cols: 4, iters: 30 }) : RandomAgent,
  }));
  const { result } = await new GameEngine(DoomGame, ps, { maxTurns: 10, fogOfWar: true }).run();
  assert.ok(result && typeof result.outcome === 'string');
});
