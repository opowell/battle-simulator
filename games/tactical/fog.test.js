import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TacticalGame } from './index.js';
import { TacticalBelief } from './belief.js';
import { ObscuroAgent } from '../../agents/ObscuroAgent.js';
import { RandomAgent } from '../../agents/RandomAgent.js';
import { GameEngine } from '../../engine/index.js';

const players = () => [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];

test('tactical fog: getVisibleState hides distant enemies and stores a roster', () => {
  const s = TacticalGame.createInitialState(players(), { fogOfWar: true });
  const view = TacticalGame.getVisibleState(s, s.activePlayers[0]);
  assert.equal(s.units.length, 6);
  assert.equal(view.units.filter(u => u.ownerId === 'p1').length, 3, 'sees own units');
  assert.equal(view.units.filter(u => u.ownerId === 'p2').length, 0, 'far enemies hidden');
  assert.equal(s.gameSpecific.startRoster.length, 6, 'startRoster is common knowledge');
});

test('tactical fog: sampleWorlds places in-bounds, hidden enemies', () => {
  const s = TacticalGame.createInitialState(players(), { fogOfWar: true });
  const view = TacticalGame.getVisibleState(s, 'p1');
  const worlds = TacticalGame.sampleWorlds(view, 'p1', 8);
  assert.ok(worlds.length > 0);
  const seen = new Set(view.units.map(u => u.id));
  const myUnits = view.units.filter(u => u.ownerId === 'p1' && u.alive);
  for (const w of worlds) {
    for (const L of w.units.filter(u => u.ownerId === 'p2' && !seen.has(u.id))) {
      assert.ok(L.position.x >= 0 && L.position.x < 8 && L.position.y >= 0 && L.position.y < 8, 'in bounds');
      const visible = myUnits.some(m =>
        Math.max(Math.abs(m.position.x - L.position.x), Math.abs(m.position.y - L.position.y)) <= 2);
      assert.ok(!visible, 'placed outside our vision');
    }
  }
});

test('tactical fog: sampleWorlds returns [] when fog is off', () => {
  const s = TacticalGame.createInitialState(players(), { fogOfWar: false });
  assert.deepEqual(TacticalGame.sampleWorlds(TacticalGame.getVisibleState(s, 'p1'), 'p1', 4), []);
});

test('tactical fog: belief pins a sighting then localises it after it hides', () => {
  const s = TacticalGame.createInitialState(players(), { fogOfWar: true });
  const roster = s.gameSpecific.startRoster.filter(u => u.ownerId === 'p2');
  const belief = new TacticalBelief('p1', roster, s.board);
  const enemyId = roster[0].id;

  // Turn 1: a p1 unit stands adjacent to an enemy at (4,4).
  belief.beginTurn({
    ...s, turnNumber: 1,
    units: [
      { id: 'p1-warrior', ownerId: 'p1', type: 'warrior', position: { x: 3, y: 4 }, alive: true, hp: 30 },
      { id: enemyId, ownerId: 'p2', type: roster[0].type, position: { x: 4, y: 4 }, alive: true, hp: 12 },
    ],
  });
  assert.deepEqual([...belief.pieces.get(enemyId).possible], ['4,4'], 'pinned where seen');
  assert.equal(belief.pieces.get(enemyId).hp, 12, 'remembers last-seen hp');

  // Turn 2: our unit backs away so the enemy is no longer visible.
  belief.beginTurn({
    ...s, turnNumber: 2,
    units: [{ id: 'p1-warrior', ownerId: 'p1', type: 'warrior', position: { x: 0, y: 0 }, alive: true, hp: 30 }],
  });
  const possible = [...belief.pieces.get(enemyId).possible].map(key => key.split(',').map(Number));
  assert.ok(possible.length > 0, 'still tracked');
  const maxDist = Math.max(...possible.map(([x, y]) => Math.max(Math.abs(x - 4), Math.abs(y - 4))));
  assert.ok(maxDist <= 2, `stays within one move of the last sighting (got ${maxDist})`);
});

test('tactical fog: witnessed death is never resurrected', () => {
  const s = TacticalGame.createInitialState(players(), { fogOfWar: true });
  const roster = s.gameSpecific.startRoster.filter(u => u.ownerId === 'p2');
  const belief = new TacticalBelief('p1', roster, s.board);
  const enemyId = roster[0].id;
  const dead = {
    ...s, turnNumber: 1,
    units: [
      { id: 'p1-warrior', ownerId: 'p1', type: 'warrior', position: { x: 3, y: 4 }, alive: true, hp: 30 },
      { id: enemyId, ownerId: 'p2', type: roster[0].type, position: { x: 4, y: 4 }, alive: false, hp: 0 },
    ],
  };
  belief.beginTurn(dead);
  assert.equal(belief.pieces.get(enemyId).alive, false);
  const worlds = belief.sample(dead, 5, Math.random, (id, ownerId, type, x, y) => ({ id, ownerId, type, position: { x, y }, alive: true, hp: 1 }));
  for (const w of worlds) assert.ok(!w.units.some(u => u.id === enemyId && u.alive), 'no resurrection');
});

test('tactical fog: Obscuro plays a fog game to completion', async () => {
  const ps = players().map((p, i) => ({
    ...p, agent: i === 0 ? new ObscuroAgent(TacticalGame, { particles: 3, rows: 4, cols: 4, iters: 40 }) : RandomAgent,
  }));
  const { result } = await new GameEngine(TacticalGame, ps, { maxTurns: 20, fogOfWar: true }).run();
  assert.ok(result && typeof result.outcome === 'string');
});
