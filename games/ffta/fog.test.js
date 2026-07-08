import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FFTAGame } from './FFTAGame.js';
import { FftaBelief, FFTA_VISION } from './belief.js';
import { anySeesPoint, viewersOf } from '../vision.js';
import { ObscuroAgent } from '../../agents/ObscuroAgent.js';
import { RandomAgent } from '../../agents/RandomAgent.js';
import { GameEngine } from '../../engine/index.js';

const players = () => [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];
// Mirror the game's own visibility (range + facing cone) so the fog oracle can't drift
// from getVisibleState — the whole point of the shared games/vision.js predicate.
const canSee = (viewerUnits, myId, pos) =>
  anySeesPoint(viewersOf(viewerUnits, myId, FFTA_VISION, p => [p.x, p.y]), pos.x, pos.y, FFTA_VISION);

test('ffta fog: getVisibleState hides distant enemies and stores a roster', () => {
  const s = FFTAGame.createInitialState(players(), { fogOfWar: true });
  const view = FFTAGame.getVisibleState(s, s.activePlayers[0]);
  assert.ok(s.units.length > 0);
  assert.equal(s.gameSpecific.startRoster.length, s.units.length, 'startRoster is common knowledge');
  const myId = s.activePlayers[0];
  assert.equal(view.units.filter(u => u.ownerId !== myId).length,
    s.units.filter(u => u.ownerId !== myId && u.alive && canSee(s.units, myId, u.position)).length,
    'only enemies in a unit\'s vision cone are visible');
});

test('ffta fog: a unit sees enemies inside its facing cone but not behind it', () => {
  // getVisibleState only reads unit position/owner/facing, so a hand-built state is enough.
  const state = { units: [
    { id: 'me',     ownerId: 'p1', alive: true, position: { x: 5, y: 5 }, facing: 0 }, // faces east
    { id: 'ahead',  ownerId: 'p2', alive: true, position: { x: 6, y: 5 } },            // 1 tile east
    { id: 'behind', ownerId: 'p2', alive: true, position: { x: 4, y: 5 } },            // 1 tile west
    { id: 'flank',  ownerId: 'p2', alive: true, position: { x: 5, y: 4 } },            // 1 tile north
  ] };
  const seen = FFTAGame.getVisibleState(state, 'p1').units.map(u => u.id);
  assert.ok(seen.includes('ahead'),   'enemy ahead is visible');
  assert.ok(!seen.includes('behind'), 'enemy directly behind is hidden');
  assert.ok(!seen.includes('flank'),  'enemy 90° to the side is hidden');
});

test('ffta fog: sampleWorlds places in-bounds, hidden enemies', () => {
  const s = FFTAGame.createInitialState(players(), { fogOfWar: true });
  const myId = s.activePlayers[0];
  const view = FFTAGame.getVisibleState(s, myId);
  const worlds = FFTAGame.sampleWorlds(view, myId, 8);
  const seen = new Set(view.units.map(u => u.id));
  for (const w of worlds) {
    for (const L of w.units.filter(u => u.ownerId !== myId && !seen.has(u.id))) {
      assert.ok(!canSee(view.units, myId, L.position), 'placed outside our vision cone');
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
