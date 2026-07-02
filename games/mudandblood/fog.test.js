import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MudAndBloodGame } from './MudAndBloodGame.js';
import { MudAndBloodBelief } from './belief.js';
import { ObscuroAgent } from '../../agents/ObscuroAgent.js';
import { RandomAgent } from '../../agents/RandomAgent.js';
import { GameEngine } from '../../engine/index.js';

const players = () => [{ id: 'allies', name: 'Allies' }, { id: 'axis', name: 'Axis' }];

test('mudandblood fog: getVisibleState hides distant enemies and stores a roster', () => {
  const s = MudAndBloodGame.createInitialState(players(), { fogOfWar: true });
  const view = MudAndBloodGame.getVisibleState(s, 'allies');
  assert.ok(s.units.length > 0);
  assert.equal(s.gameSpecific.startRoster.length, s.units.length, 'startRoster is common knowledge');
  // Axis wave 1 spawns at y=0, allies sit around y=7-8 — beyond VISION=5 manhattan.
  assert.equal(view.units.filter(u => u.ownerId === 'axis').length, 0, 'far axis units hidden');
});

test('mudandblood fog: getVisibleState is a no-op when fog is off', () => {
  const s = MudAndBloodGame.createInitialState(players(), { fogOfWar: false });
  assert.deepEqual(MudAndBloodGame.getVisibleState(s, 'allies'), s);
});

test('mudandblood fog: sampleWorlds places in-bounds, hidden enemies', () => {
  const s = MudAndBloodGame.createInitialState(players(), { fogOfWar: true });
  const view = MudAndBloodGame.getVisibleState(s, 'allies');
  const worlds = MudAndBloodGame.sampleWorlds(view, 'allies', 8);
  assert.ok(worlds.length > 0);
  const seen = new Set(view.units.map(u => u.id));
  const myUnits = view.units.filter(u => u.ownerId === 'allies' && u.alive);
  for (const w of worlds) {
    for (const L of w.units.filter(u => u.ownerId === 'axis' && !seen.has(u.id))) {
      assert.ok(L.position.x >= 0 && L.position.x < s.board.width && L.position.y >= 0 && L.position.y < s.board.height, 'in bounds');
      const visible = myUnits.some(m =>
        Math.abs(m.position.x - L.position.x) + Math.abs(m.position.y - L.position.y) <= 5);
      assert.ok(!visible, 'placed outside our vision');
    }
  }
});

test('mudandblood fog: sampleWorlds returns [] when fog is off', () => {
  const s = MudAndBloodGame.createInitialState(players(), { fogOfWar: false });
  assert.deepEqual(MudAndBloodGame.sampleWorlds(MudAndBloodGame.getVisibleState(s, 'allies'), 'allies', 4), []);
});

test('mudandblood fog: a later wave is registered the first time it is spotted', () => {
  const s = MudAndBloodGame.createInitialState(players(), { fogOfWar: true });
  const belief = new MudAndBloodBelief('allies', s.gameSpecific.startRoster.filter(u => u.ownerId === 'axis'), s.board);
  const wave2Unit = { id: 'axis-w2-99', ownerId: 'axis', type: 'mg42', position: { x: 10, y: 4 }, alive: true, hp: 8 };
  belief.beginTurn({ ...s, turnNumber: 1, units: [...s.units.filter(u => u.ownerId === 'allies'), wave2Unit] });
  assert.ok(belief.pieces.has('axis-w2-99'), 'unseen-before enemy is now tracked');
});

test('mudandblood fog: witnessed death is never resurrected', () => {
  const s = MudAndBloodGame.createInitialState(players(), { fogOfWar: true });
  const roster = s.gameSpecific.startRoster.filter(u => u.ownerId === 'axis');
  const belief = new MudAndBloodBelief('allies', roster, s.board);
  const enemyId = roster[0].id;
  const dead = {
    ...s, turnNumber: 1,
    units: [
      { id: 'allies-x', ownerId: 'allies', type: 'rifleman', position: { x: roster[0].position.x, y: roster[0].position.y + 1 }, alive: true, hp: 8 },
      { id: enemyId, ownerId: 'axis', type: roster[0].type, position: roster[0].position, alive: false, hp: 0 },
    ],
  };
  belief.beginTurn(dead);
  assert.equal(belief.pieces.get(enemyId).alive, false);
  const worlds = belief.sample(dead, 5, Math.random, (id, type, ownerId, position) => ({ id, ownerId, type, position, alive: true, hp: 1 }));
  for (const w of worlds) assert.ok(!w.units.some(u => u.id === enemyId && u.alive), 'no resurrection');
});

test('mudandblood fog: Obscuro plays a fog game to completion', async () => {
  const ps = players().map((p, i) => ({
    ...p, agent: i === 0 ? new ObscuroAgent(MudAndBloodGame, { particles: 3, rows: 4, cols: 4, iters: 40 }) : RandomAgent,
  }));
  const { result } = await new GameEngine(MudAndBloodGame, ps, { maxTurns: 20, fogOfWar: true }).run();
  assert.ok(result && typeof result.outcome === 'string');
});
