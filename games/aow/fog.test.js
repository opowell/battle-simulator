import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AowGame } from './AowGame.js';
import { AowBelief } from './belief.js';
import { ObscuroAgent } from '../../agents/ObscuroAgent.js';
import { RandomAgent } from '../../agents/RandomAgent.js';
import { GameEngine } from '../../engine/index.js';

const players = () => [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];

test('aow fog: getVisibleState hides distant enemies and stores a roster', () => {
  const s = AowGame.createInitialState(players(), { fogOfWar: true });
  const view = AowGame.getVisibleState(s, s.activePlayers[0]);
  assert.ok(s.units.length > 0);
  assert.equal(view.units.filter(u => u.ownerId === 'p2').length, 0, 'far enemies hidden');
  assert.equal(s.gameSpecific.startRoster.length, s.units.length, 'startRoster is common knowledge');
});

test('aow fog: sampleWorlds places in-bounds, hidden enemies', () => {
  const s = AowGame.createInitialState(players(), { fogOfWar: true });
  const view = AowGame.getVisibleState(s, 'p1');
  const worlds = AowGame.sampleWorlds(view, 'p1', 8);
  assert.ok(worlds.length > 0);
  const seen = new Set(view.units.map(u => u.id));
  const myUnits = view.units.filter(u => u.ownerId === 'p1' && u.alive);
  for (const w of worlds) {
    for (const L of w.units.filter(u => u.ownerId === 'p2' && !seen.has(u.id))) {
      assert.ok(L.position.x >= 0 && L.position.x < s.board.width && L.position.y >= 0 && L.position.y < s.board.height, 'in bounds');
      const visible = myUnits.some(m =>
        Math.max(Math.abs(m.position.x - L.position.x), Math.abs(m.position.y - L.position.y)) <= 2);
      assert.ok(!visible, 'placed outside our vision');
    }
  }
});

test('aow fog: sampleWorlds returns [] when fog is off', () => {
  const s = AowGame.createInitialState(players(), { fogOfWar: false });
  assert.deepEqual(AowGame.sampleWorlds(AowGame.getVisibleState(s, 'p1'), 'p1', 4), []);
});

test('aow fog: witnessed death is never resurrected', () => {
  const s = AowGame.createInitialState(players(), { fogOfWar: true });
  const roster = s.gameSpecific.startRoster.filter(u => u.ownerId === 'p2');
  const belief = new AowBelief('p1', roster, s.board);
  const enemyId = roster[0].id;
  const dead = {
    ...s, turnNumber: 1,
    units: [
      { id: 'p1-u', ownerId: 'p1', type: 'warrior', position: { x: roster[0].position.x - 1, y: roster[0].position.y }, alive: true, hp: 10 },
      { id: enemyId, ownerId: 'p2', type: roster[0].type, position: roster[0].position, alive: false, hp: 0 },
    ],
  };
  belief.beginTurn(dead);
  assert.equal(belief.pieces.get(enemyId).alive, false);
  const worlds = belief.sample(dead, 5, Math.random, (ownerId, type, x, y) => ({ id: 'x', ownerId, type, position: { x, y }, alive: true, hp: 1 }));
  for (const w of worlds) assert.ok(!w.units.some(u => u.id === enemyId && u.alive), 'no resurrection');
});

test('aow fog: Obscuro plays a fog game to completion', async () => {
  const ps = players().map((p, i) => ({
    ...p, agent: i === 0 ? new ObscuroAgent(AowGame, { particles: 3, rows: 4, cols: 4, iters: 40 }) : RandomAgent,
  }));
  const { result } = await new GameEngine(AowGame, ps, { maxTurns: 20, fogOfWar: true }).run();
  assert.ok(result && typeof result.outcome === 'string');
});
