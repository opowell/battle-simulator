import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FFTAGame } from './FFTAGame.js';
import { FftaBelief } from './belief.js';
import { ObscuroAgent } from '../../agents/ObscuroAgent.js';
import { RandomAgent } from '../../agents/RandomAgent.js';
import { GameEngine } from '../../engine/index.js';

const players = () => [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];

test('ffta fog: getVisibleState hides distant enemies and stores a roster', () => {
  const s = FFTAGame.createInitialState(players(), { fogOfWar: true });
  const view = FFTAGame.getVisibleState(s, s.activePlayers[0]);
  assert.ok(s.units.length > 0);
  assert.equal(s.gameSpecific.startRoster.length, s.units.length, 'startRoster is common knowledge');
  const myId = s.activePlayers[0];
  assert.equal(view.units.filter(u => u.ownerId !== myId).length,
    s.units.filter(u => u.ownerId !== myId && u.alive &&
      s.units.some(m => m.ownerId === myId && Math.max(Math.abs(m.position.x - u.position.x), Math.abs(m.position.y - u.position.y)) <= 2)).length,
    'only nearby enemies visible');
});

test('ffta fog: sampleWorlds places in-bounds, hidden enemies', () => {
  const s = FFTAGame.createInitialState(players(), { fogOfWar: true });
  const myId = s.activePlayers[0];
  const view = FFTAGame.getVisibleState(s, myId);
  const worlds = FFTAGame.sampleWorlds(view, myId, 8);
  const seen = new Set(view.units.map(u => u.id));
  const myUnits = view.units.filter(u => u.ownerId === myId && u.alive);
  for (const w of worlds) {
    for (const L of w.units.filter(u => u.ownerId !== myId && !seen.has(u.id))) {
      const visible = myUnits.some(m =>
        Math.max(Math.abs(m.position.x - L.position.x), Math.abs(m.position.y - L.position.y)) <= 2);
      assert.ok(!visible, 'placed outside our vision');
    }
  }
});

test('ffta fog: sampleWorlds returns [] when fog is off', () => {
  const s = FFTAGame.createInitialState(players(), { fogOfWar: false });
  const myId = s.activePlayers[0];
  assert.deepEqual(FFTAGame.sampleWorlds(FFTAGame.getVisibleState(s, myId), myId, 4), []);
});

test('ffta fog: witnessed death is never resurrected', () => {
  const s = FFTAGame.createInitialState(players(), { fogOfWar: true });
  const roster = s.gameSpecific.startRoster.filter(u => u.ownerId === 'p2');
  const belief = new FftaBelief('p1', roster, s.board);
  const enemyId = roster[0].id;
  const dead = {
    ...s, turnNumber: 1,
    units: [
      { id: 'p1-u', ownerId: 'p1', job: 'soldier', position: { x: roster[0].position.x - 1, y: roster[0].position.y }, alive: true, hp: 20 },
      { id: enemyId, ownerId: 'p2', job: roster[0].job, position: roster[0].position, alive: false, hp: 0 },
    ],
  };
  belief.beginTurn(dead);
  assert.equal(belief.pieces.get(enemyId).alive, false);
  const worlds = belief.sample(dead, 5, Math.random, (id, job, ownerId, position) => ({ id, ownerId, job, position, alive: true, hp: 1 }));
  for (const w of worlds) assert.ok(!w.units.some(u => u.id === enemyId && u.alive), 'no resurrection');
});

test('ffta fog: Obscuro plays a fog game to completion', async () => {
  const ps = players().map((p, i) => ({
    ...p, agent: i === 0 ? new ObscuroAgent(FFTAGame, { particles: 3, rows: 4, cols: 4, iters: 40 }) : RandomAgent,
  }));
  const { result } = await new GameEngine(FFTAGame, ps, { maxTurns: 20, fogOfWar: true }).run();
  assert.ok(result && typeof result.outcome === 'string');
});
